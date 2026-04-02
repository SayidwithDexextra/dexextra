import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Receiver } from '@upstash/qstash';
import { ethers } from 'ethers';
import { scheduleMarketLifecycle, scheduleSettlementFinalize, proportionalDurations, ONCHAIN_SETTLE_BUFFER_SEC } from '@/lib/qstash-scheduler';
import { runSettlementTick, runSingleSettlementCheck, forceStartSettlementWindow, settlementSyncLifecycleOnChain } from '@/lib/settlement-engine';
import type { MarketRow } from '@/lib/settlement-engine';
import { deployMarket } from '@/lib/deploy-market';
import {
  shortAddr, phaseHeader, phaseDivider, phaseFooter,
  stepLog as vStep,
} from '@/lib/console-logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function getRpcProvider(): ethers.JsonRpcProvider | null {
  const rpc = process.env.RPC_URL || process.env.JSON_RPC_URL;
  if (!rpc) return null;
  return new ethers.JsonRpcProvider(rpc);
}

function getAdminWallet(provider: ethers.JsonRpcProvider): ethers.Wallet | null {
  const pk = process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) return null;
  return new ethers.Wallet(pk, provider);
}

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function log(step: string, status: string, data?: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({
      area: 'market_lifecycle_cron', step, status,
      timestamp: new Date().toISOString(), ...(data || {}),
    }));
  } catch {}
}

// ---------------------------------------------------------------------------
// Timeframe formatting for rolled-over contracts
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LOWER = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function formatActiveTimeframe(start: Date, end: Date): { display: string; symbolSuffix: string } {
  const durationMs = end.getTime() - start.getTime();
  const durationHours = durationMs / (1000 * 60 * 60);
  const pad2 = (n: number) => String(n).padStart(2, '0');

  const formatTime12 = (d: Date) => {
    let h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return m === 0 ? `${h} ${ampm}` : `${h}:${pad2(m)} ${ampm}`;
  };

  if (durationHours < 24) {
    const startTime = formatTime12(start);
    const endTime = formatTime12(end);
    const sameDay = start.getUTCFullYear() === end.getUTCFullYear()
      && start.getUTCMonth() === end.getUTCMonth()
      && start.getUTCDate() === end.getUTCDate();

    const endDateStr = `${MONTHS_SHORT[end.getUTCMonth()]} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;

    const display = sameDay
      ? `${startTime} – ${endTime} ${endDateStr}`
      : `${startTime} ${MONTHS_SHORT[start.getUTCMonth()]} ${start.getUTCDate()} – ${endTime} ${endDateStr}`;

    const symDate = `${pad2(start.getUTCDate())}${MONTHS_LOWER[start.getUTCMonth()]}${String(start.getUTCFullYear()).slice(2)}`;
    const symStart = `${pad2(start.getUTCHours())}${pad2(start.getUTCMinutes())}`;
    const symEnd = `${pad2(end.getUTCHours())}${pad2(end.getUTCMinutes())}`;

    return { display, symbolSuffix: `${symDate}-${symStart}-${symEnd}` };
  }

  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();

  if (durationHours < 24 * 90) {
    const display = sameYear
      ? `${MONTHS_SHORT[start.getUTCMonth()]} ${start.getUTCDate()} – ${MONTHS_SHORT[end.getUTCMonth()]} ${end.getUTCDate()}, ${end.getUTCFullYear()}`
      : `${MONTHS_SHORT[start.getUTCMonth()]} ${start.getUTCDate()}, ${start.getUTCFullYear()} – ${MONTHS_SHORT[end.getUTCMonth()]} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;

    const symStart = `${pad2(start.getUTCDate())}${MONTHS_LOWER[start.getUTCMonth()]}${String(start.getUTCFullYear()).slice(2)}`;
    const symEnd = `${pad2(end.getUTCDate())}${MONTHS_LOWER[end.getUTCMonth()]}${String(end.getUTCFullYear()).slice(2)}`;
    return { display, symbolSuffix: `${symStart}-${symEnd}` };
  }

  return {
    display: `${MONTHS_SHORT[start.getUTCMonth()]} ${start.getUTCFullYear()} – ${MONTHS_SHORT[end.getUTCMonth()]} ${end.getUTCFullYear()}`,
    symbolSuffix: `${MONTHS_LOWER[start.getUTCMonth()]}${String(start.getUTCFullYear()).slice(2)}-${MONTHS_LOWER[end.getUTCMonth()]}${String(end.getUTCFullYear()).slice(2)}`,
  };
}

// ---------------------------------------------------------------------------
// Auth – verify caller is QStash or Vercel Cron
// ---------------------------------------------------------------------------

async function verifyQStashSignature(req: Request, body: string): Promise<boolean> {
  const sigKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!sigKey || !nextKey) return false;

  const receiver = new Receiver({ currentSigningKey: sigKey, nextSigningKey: nextKey });
  const signature = req.headers.get('upstash-signature') || '';
  if (!signature) return false;

  try {
    await receiver.verify({ signature, body });
    return true;
  } catch {
    return false;
  }
}

function verifyVercelCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

// ---------------------------------------------------------------------------
// On-chain – syncLifecycle
// ---------------------------------------------------------------------------

const LIFECYCLE_ABI = [
  'function syncLifecycle() external returns (uint8 previousState, uint8 newState)',
  'function getLifecycleState() external view returns (uint8)',
  'function getSettlementTimestamp() external view returns (uint256)',
  'function getRolloverWindowStart() external view returns (uint256)',
  'function isInRolloverWindow() external view returns (bool)',
  'function getMarketLineage() external view returns (address parent, address child)',
  'function linkRolloverChildByAddress(address childMarket, uint256 childSettlementTimestamp) external returns (bool)',
];

async function syncLifecycleOnChain(marketAddress: string): Promise<{ ok: boolean; previousState?: number; newState?: number; error?: string }> {
  const provider = getRpcProvider();
  if (!provider) return { ok: false, error: 'rpc_not_configured' };
  const wallet = getAdminWallet(provider);
  if (!wallet) return { ok: false, error: 'admin_key_not_configured' };

  if (!ethers.isAddress(marketAddress)) return { ok: false, error: 'invalid_market_address' };

  try {
    const contract = new ethers.Contract(marketAddress, LIFECYCLE_ABI, wallet);
    const tx = await contract.syncLifecycle();
    const receipt = await tx.wait();

    const iface = new ethers.Interface(LIFECYCLE_ABI);
    let previousState: number | undefined;
    let newState: number | undefined;
    for (const rlog of receipt?.logs || []) {
      try {
        const parsed = iface.parseLog({ topics: rlog.topics as string[], data: rlog.data });
        if (parsed?.name === 'LifecycleSync') {
          previousState = Number(parsed.args[2]);
          newState = Number(parsed.args[3]);
        }
      } catch {}
    }

    return { ok: true, previousState, newState };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ---------------------------------------------------------------------------
// On-chain – link rollover child
// ---------------------------------------------------------------------------

async function linkRolloverChild(
  parentAddress: string,
  childAddress: string,
  childSettlementTs: number,
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  const provider = getRpcProvider();
  if (!provider) return { ok: false, error: 'rpc_not_configured' };
  const wallet = getAdminWallet(provider);
  if (!wallet) return { ok: false, error: 'admin_key_not_configured' };

  try {
    const contract = new ethers.Contract(parentAddress, LIFECYCLE_ABI, wallet);
    const tx = await contract.linkRolloverChildByAddress(childAddress, childSettlementTs);
    const receipt = await tx.wait();
    return { ok: true, txHash: receipt?.hash || tx.hash };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ---------------------------------------------------------------------------
// Rollover – create child market and link lineage
// ---------------------------------------------------------------------------

async function handleRollover(marketId: string, marketAddress?: string | null): Promise<Record<string, unknown>> {
  log('rollover', 'start', { marketId, marketAddress });
  const rolloverStart = Date.now();

  phaseHeader('ROLLOVER', `market ${marketId.slice(0, 8)}...`);

  const supabase = getSupabase();
  if (!supabase) {
    vStep('[1/7] Fetch parent market', 'error', 'supabase not configured');
    return { ok: false, error: 'supabase_not_configured' };
  }

  vStep('[1/7] Fetch parent market', 'start');
  const { data: market, error: fetchErr } = await supabase
    .from('markets')
    .select('*')
    .eq('id', marketId)
    .maybeSingle();

  if (fetchErr || !market) {
    vStep('[1/7] Fetch parent market', 'error', fetchErr?.message || 'not found');
    log('rollover', 'error', { error: fetchErr?.message || 'market_not_found' });
    return { ok: false, error: fetchErr?.message || 'market_not_found' };
  }
  vStep('[1/7] Fetch parent market', 'success', market.symbol || market.market_identifier || marketId.slice(0, 8));

  const effectiveAddress = marketAddress || market.market_address;
  if (!effectiveAddress) {
    vStep('[1/7] Fetch parent market', 'error', 'no market address');
    return { ok: false, error: 'no_market_address' };
  }

  const existingConfig = (typeof market.market_config === 'object' && market.market_config) || {};
  const rolloverConfig = (existingConfig as any)?.rollover || {};
  if (rolloverConfig.child_market_id) {
    vStep('[1/7] Fetch parent market', 'success', 'child already exists, skipping');
    log('rollover', 'success', { reason: 'child_already_exists', childId: rolloverConfig.child_market_id });
    phaseFooter('Rollover skipped', Date.now() - rolloverStart, true);
    return { ok: true, skipped: true, reason: 'child_already_exists', childId: rolloverConfig.child_market_id };
  }

  // Skip syncLifecycle during rollover — the dedicated challenge_open
  // trigger handles the on-chain state transition at T0, independent of
  // AI price discovery. Calling syncLifecycle here would push the state
  // to ChallengeWindow too early.
  vStep('[2/7] Sync lifecycle on-chain', 'skip', 'deferred to challenge_open trigger');
  log('rollover_sync', 'skipped', { reason: 'deferred_to_challenge_open' });

  // 2. Derive CREATOR wallet for rollover markets (gets 100% of fees)
  vStep('[3/7] Derive creator wallet', 'start');
  const funderPk = process.env.CREATOR_PRIVATE_KEY;
  let funderAddress: string | null = null;
  if (funderPk) {
    try {
      funderAddress = new ethers.Wallet(funderPk).address;
    } catch {}
  }
  vStep('[3/7] Derive creator wallet', 'success', funderAddress ? shortAddr(funderAddress) : 'none (will use parent creator)');

  // 3. Ensure the parent market belongs to a series (create one if needed)
  vStep('[4/7] Resolve market series', 'start');
  const baseSymbol = market.symbol || market.market_identifier || 'UNKNOWN';
  let seriesId: string | null = market.series_id || null;
  let parentSequence: number = market.series_sequence ?? 0;

  if (!seriesId) {
    const seriesSlug = `${baseSymbol}-SERIES`;
    log('rollover_series', 'start', { seriesSlug });

    const { data: existing } = await supabase
      .from('market_series')
      .select('id')
      .eq('slug', seriesSlug)
      .maybeSingle();

    if (existing?.id) {
      seriesId = existing.id;
    } else {
      const { data: created, error: createErr } = await supabase
        .from('market_series')
        .insert({
          slug: seriesSlug,
          underlying_symbol: baseSymbol,
          base_asset: baseSymbol,
          quote_asset: 'USD',
          roll_frequency: 'auto',
        })
        .select('id')
        .single();
      if (createErr || !created) {
        log('rollover_series', 'error', { error: createErr?.message || 'create_failed' });
      } else {
        seriesId = created.id;
      }
    }

    if (seriesId) {
      parentSequence = 1;
      await supabase
        .from('markets')
        .update({ series_id: seriesId, series_sequence: parentSequence, updated_at: new Date().toISOString() })
        .eq('id', marketId);
      log('rollover_series', 'success', { seriesId, parentSequence });
    }
  }
  vStep('[4/7] Resolve market series', 'success', seriesId ? `series ${seriesId.slice(0, 8)}... seq=${parentSequence}` : 'no series');

  const childSequence = parentSequence + 1;

  // Strip any old -RN suffix to derive the true base symbol
  const trueBaseSymbol = baseSymbol.replace(/-R\d+$/, '');

  // 4. Compute child settlement date (same duration as parent)
  vStep('[4/7] Compute settlement date', 'start');
  const parentSettlementDate = market.settlement_date ? new Date(market.settlement_date) : null;
  const parentDeployedAt = market.deployed_at ? new Date(market.deployed_at) : null;
  if (!parentSettlementDate) {
    vStep('[4/7] Compute settlement date', 'error', 'no parent settlement date');
    return { ok: false, error: 'no_parent_settlement_date' };
  }

  let lifecycleDurationMs: number;
  if (parentDeployedAt) {
    lifecycleDurationMs = parentSettlementDate.getTime() - parentDeployedAt.getTime();
  } else {
    lifecycleDurationMs = 365 * 24 * 60 * 60 * 1000;
  }
  if (lifecycleDurationMs <= 0) lifecycleDurationMs = 365 * 24 * 60 * 60 * 1000;

  const childSettlementDate = new Date(parentSettlementDate.getTime() + lifecycleDurationMs);
  const childSettlementUnix = Math.floor(childSettlementDate.getTime() / 1000);
  vStep('[4/7] Compute settlement date', 'success', childSettlementDate.toISOString());
  phaseDivider();

  // Inherit the parent's speed-run / settlement timing config so child
  // markets use the same settlement window, rollover lead, and challenge
  // duration as the parent instead of falling back to proportional defaults.
  const parentSpeedRunConfig = (() => {
    const cfg = existingConfig as any;
    if (cfg?.speed_run && (cfg.rollover_lead_seconds || cfg.challenge_window_seconds || cfg.challenge_duration_seconds)) {
      return {
        rolloverLeadSeconds: Number(cfg.rollover_lead_seconds) || 0,
        challengeWindowSeconds: Number(cfg.challenge_window_seconds || cfg.challenge_duration_seconds) || 0,
      };
    }
    return null;
  })();
  if (parentSpeedRunConfig) {
    log('rollover_speed_run_inherit', 'success', parentSpeedRunConfig);
  }

  const initialOrder = (typeof market.initial_order === 'object' && market.initial_order) || {};
  const rolloverCreator = funderAddress || market.creator_wallet_address || '';
  const childSymbol = trueBaseSymbol;
  const parentStartDate = parentDeployedAt
    || (market.created_at ? new Date(market.created_at) : new Date(parentSettlementDate.getTime() - lifecycleDurationMs));
  const timeframe = formatActiveTimeframe(parentStartDate, parentSettlementDate);
  const expiredSymbol = `${trueBaseSymbol}-${timeframe.symbolSuffix}`;
  const parentDisplayName = market.name || `${trueBaseSymbol} Futures`;
  const childName = parentDisplayName.replace(/\s*\((?:Rollover #\d+|Legacy \d+|[^)]+\s*[–\u2013-]\s*[^)]+)\)\s*$/, '');
  const expiredName = `${childName} (${timeframe.display})`;
  const metricUrl = (initialOrder as any)?.metricUrl || (initialOrder as any)?.metric_url || '';
  const dataSource = (initialOrder as any)?.dataSource || 'rollover';
  const tags = Array.isArray(market.category) ? market.category : ['CUSTOM'];

  // Inherit the parent's current mark price so the child market starts where the parent left off
  let startPrice: string;
  const { data: parentTicker } = await supabase
    .from('market_tickers')
    .select('mark_price')
    .eq('market_id', marketId)
    .maybeSingle();

  if (parentTicker?.mark_price && parentTicker.mark_price > 0) {
    startPrice = String(parentTicker.mark_price / 1_000_000);
    log('rollover_start_price', 'success', { source: 'parent_mark_price', startPrice, rawMark: parentTicker.mark_price });
  } else {
    startPrice = String((initialOrder as any)?.startPrice || '1');
    log('rollover_start_price', 'success', { source: 'initial_order_fallback', startPrice });
  }

  // 5. Deploy child market on-chain (inline — mirrors new-market page pattern)
  let deployResult;
  try {
    vStep('[5/7] Deploy child market', 'start', `${childSymbol} settlement=${childSettlementDate.toISOString()}`);
    log('rollover_deploy', 'start', { childSymbol, childSettlementUnix });
    deployResult = await deployMarket(
      {
        symbol: childSymbol,
        metricUrl,
        settlementTs: childSettlementUnix,
        startPrice6: ethers.parseUnits(startPrice, 6),
        dataSource,
        tags,
        creatorWalletAddress: rolloverCreator || null,
        feeRecipient: rolloverCreator || null,
        isRollover: true,
        speedRunConfig: parentSpeedRunConfig,
      },
      (step, status, data) => log(`rollover_deploy_${step}`, status, data),
    );
    vStep('[5/7] Deploy child market', 'success', `orderBook=${shortAddr(deployResult.orderBook)}`);
    log('rollover_deploy', 'success', {
      orderBook: deployResult.orderBook,
      txHash: deployResult.transactionHash,
    });
  } catch (e: any) {
    vStep('[5/7] Deploy child market', 'error', e?.message || String(e));
    log('rollover_deploy', 'error', { error: e?.message || String(e) });
    phaseFooter('Rollover failed (deploy)', Date.now() - rolloverStart, false);
    return { ok: false, error: 'child_market_deploy_failed', details: e?.message || String(e) };
  }

  // 5b. Rename parent market with its active timeframe so the child can take the original identifier
  vStep('[5b] Rename parent (timeframe)', 'start', expiredSymbol);
  try {
    await supabase.from('markets').update({
      market_identifier: expiredSymbol.toUpperCase(),
      symbol: expiredSymbol,
      name: expiredName,
      updated_at: new Date().toISOString(),
    }).eq('id', marketId);
    vStep('[5b] Rename parent (timeframe)', 'success', `${baseSymbol} -> ${expiredSymbol}`);
    log('rollover_rename_parent', 'success', { expiredSymbol, expiredName });
  } catch (e: any) {
    vStep('[5b] Rename parent (timeframe)', 'error', e?.message || String(e));
    log('rollover_rename_parent', 'error', { error: e?.message || String(e) });
    phaseFooter('Rollover failed (rename parent)', Date.now() - rolloverStart, false);
    return { ok: false, error: 'parent_rename_failed', details: e?.message || String(e) };
  }

  // 6. Save to DB via /api/markets/save (lightweight — same as new-market page)
  vStep('[6/7] Save child to DB', 'start');
  const baseUrl =
    process.env.APP_URL?.replace(/\/+$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  let savedMarketId: string | null = null;
  try {
    log('rollover_save', 'start');
    const saveRes = await fetch(`${baseUrl}/api/markets/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marketIdentifier: childSymbol,
        symbol: childSymbol,
        name: childName,
        description: market.description || `Futures market for ${trueBaseSymbol}`,
        category: tags,
        settlementDate: childSettlementUnix,
        initialOrder: { metricUrl, startPrice, dataSource, tags },
        marketAddress: deployResult.orderBook,
        marketIdBytes32: deployResult.marketIdBytes32,
        transactionHash: deployResult.transactionHash,
        blockNumber: deployResult.blockNumber,
        gasUsed: deployResult.gasUsed,
        chainId: deployResult.chainId,
        networkName: deployResult.network,
        creatorWalletAddress: rolloverCreator,
        iconImageUrl: market.icon_image_url || null,
        bannerImageUrl: market.banner_image_url || null,
        skipSettlementDateValidation: true,
        speedRunConfig: parentSpeedRunConfig,
      }),
    });
    const saveData = await saveRes.json().catch(() => ({}));
    if (!saveRes.ok) {
      vStep('[6/7] Save child to DB', 'error', `status ${saveRes.status}`);
      log('rollover_save', 'error', { status: saveRes.status, data: saveData });
      phaseFooter('Rollover failed (save)', Date.now() - rolloverStart, false);
      return { ok: false, error: 'child_market_save_failed', details: saveData };
    }
    savedMarketId = (saveData as any)?.id || null;
    vStep('[6/7] Save child to DB', 'success', `id=${savedMarketId?.slice(0, 8)}...`);
    log('rollover_save', 'success', { childMarketId: savedMarketId });
  } catch (e: any) {
    vStep('[6/7] Save child to DB', 'error', e?.message || String(e));
    log('rollover_save', 'error', { error: e?.message || String(e) });
    phaseFooter('Rollover failed (save)', Date.now() - rolloverStart, false);
    return { ok: false, error: 'child_market_save_exception', details: e?.message };
  }

  // 7. Rollover-specific: assign series, update parent, link on-chain
  //    Run DB writes and on-chain link in parallel to save a big-block wait.
  vStep('[7/7] Finalize lineage', 'start');

  const lineageTasks: Promise<void>[] = [];

  if (savedMarketId && seriesId) {
    lineageTasks.push((async () => {
      try {
        await supabase.from('markets').update({
          series_id: seriesId,
          series_sequence: childSequence,
          updated_at: new Date().toISOString(),
        }).eq('id', savedMarketId);
        vStep('[7/7] Assign child to series', 'success', `seq=${childSequence}`);
        log('rollover_series_child', 'success', { seriesId, sequence: childSequence });
      } catch (e: any) {
        vStep('[7/7] Assign child to series', 'error', e?.message || String(e));
        log('rollover_series_child', 'error', { error: e?.message || String(e) });
      }
    })());
  }

  if (savedMarketId) {
    lineageTasks.push((async () => {
      try {
        const parentCfg = (typeof market.market_config === 'object' && market.market_config) || {};
        await supabase.from('markets').update({
          market_config: {
            ...(parentCfg as any),
            rollover: {
              child_market_id: savedMarketId,
              child_address: deployResult.orderBook,
              child_settlement_date: childSettlementDate.toISOString(),
              rolled_over_at: new Date().toISOString(),
            },
          },
          updated_at: new Date().toISOString(),
        }).eq('id', marketId);
        vStep('[7/7] Update parent config', 'success', `child=${savedMarketId.slice(0, 8)}...`);
        log('rollover_update_parent', 'success', { parentMarketId: marketId });
      } catch (e: any) {
        vStep('[7/7] Update parent config', 'error', e?.message || String(e));
        log('rollover_update_parent', 'error', { error: e?.message || String(e) });
      }
    })());
  }

  if (effectiveAddress && deployResult.orderBook) {
    lineageTasks.push((async () => {
      const provider = getRpcProvider();
      const adminWallet = provider ? getAdminWallet(provider) : null;
      if (!adminWallet) {
        vStep('[7/7] Link on-chain', 'skip', 'no admin wallet');
        return;
      }

      // Step A: Link rollover child on-chain
      let linkSuccess = false;
      try {
        vStep('[7/7] Link on-chain', 'start', `${shortAddr(effectiveAddress)} -> ${shortAddr(deployResult.orderBook)}`);
        const lifecycleAbi = ['function linkRolloverChildByAddress(address,uint256) external returns (bool)'];
        const parentContract = new ethers.Contract(effectiveAddress, lifecycleAbi, adminWallet);
        const linkTx = await parentContract.linkRolloverChildByAddress(deployResult.orderBook, childSettlementUnix);
        const linkRc = await linkTx.wait();
        vStep('[7/7] Link on-chain', 'success', `tx ${linkRc?.hash?.slice(0, 10) || linkTx.hash.slice(0, 10)}...`);
        log('rollover_link_onchain', 'success', { tx: linkRc?.hash || linkTx.hash });
        linkSuccess = true;
      } catch (e: any) {
        vStep('[7/7] Link on-chain', 'error', e?.shortMessage || e?.message || String(e));
        log('rollover_link_onchain', 'error', { error: e?.message || String(e) });
      }

      // Step B: Refund bond (only if link succeeded and bond manager is configured)
      if (!linkSuccess || !market.market_id_bytes32) return;

      const bondManagerAddr = process.env.MARKET_BOND_MANAGER_ADDRESS;
      if (!bondManagerAddr || !ethers.isAddress(bondManagerAddr)) {
        vStep('[7/7] Refund bond', 'skip', 'no bond manager configured');
        log('rollover_bond_refund', 'skipped', { reason: 'no_bond_manager_address' });
        return;
      }

      try {
        vStep('[7/7] Refund bond', 'start', `market ${shortAddr(effectiveAddress)}`);
        const bondAbi = [
          'function onMarketRollover(bytes32 marketId, address orderBook) external',
          'function bondByMarket(bytes32) view returns (address creator, uint96 amount, bool refunded)',
        ];
        const bondMgr = new ethers.Contract(bondManagerAddr, bondAbi, adminWallet);

        const [bondCreator, bondAmount, bondRefunded] = await bondMgr.bondByMarket(market.market_id_bytes32);
        if (bondCreator === ethers.ZeroAddress) {
          vStep('[7/7] Refund bond', 'skip', 'no bond recorded (exempt or pre-V2)');
          log('rollover_bond_refund', 'skipped', { reason: 'no_bond_recorded' });
          return;
        }
        if (bondRefunded) {
          vStep('[7/7] Refund bond', 'skip', 'already refunded');
          log('rollover_bond_refund', 'skipped', { reason: 'already_refunded' });
          return;
        }

        const bondTx = await bondMgr.onMarketRollover(market.market_id_bytes32, effectiveAddress);
        const bondRc = await bondTx.wait();
        const refundedAmount = ethers.formatUnits(bondAmount, 6);
        vStep('[7/7] Refund bond', 'success', `${refundedAmount} USDC → ${shortAddr(bondCreator)} tx ${bondRc?.hash?.slice(0, 10) || bondTx.hash.slice(0, 10)}...`);
        log('rollover_bond_refund', 'success', {
          tx: bondRc?.hash || bondTx.hash,
          marketIdBytes32: market.market_id_bytes32,
          creator: bondCreator,
          amount: refundedAmount,
        });
      } catch (e: any) {
        vStep('[7/7] Refund bond', 'error', e?.shortMessage || e?.message || String(e));
        log('rollover_bond_refund', 'error', { error: e?.message || String(e) });
      }
    })());
  }

  await Promise.allSettled(lineageTasks);

  log('rollover', 'success', {
    parentId: marketId,
    parentRenamedTo: expiredSymbol,
    childMarketId: savedMarketId,
    childSymbol,
    childSettlementDate: childSettlementDate.toISOString(),
    orderBook: deployResult.orderBook,
    seriesId,
    childSequence,
  });

  phaseFooter(`Rollover ${childSymbol} (parent → ${expiredSymbol})`, Date.now() - rolloverStart, true);

  return {
    ok: true,
    parentId: marketId,
    parentRenamedTo: expiredSymbol,
    childMarketId: savedMarketId,
    childSymbol,
    childSettlementDate: childSettlementDate.toISOString(),
    orderBook: deployResult.orderBook,
    seriesId,
    childSequence,
  };
}

// ---------------------------------------------------------------------------
// Cron scan – safety net that picks up any missed markets
// ---------------------------------------------------------------------------

async function runSafetyNetScan(): Promise<Record<string, unknown>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'supabase_not_configured' };

  const now = new Date();
  const nowIso = now.toISOString();
  const results: Record<string, unknown>[] = [];

  // 1. Settlement tick – run inline settlement engine
  const settlementResult = supabase ? await runSettlementTick(supabase) : { ok: false, error: 'supabase_not_configured' };
  results.push({ type: 'settlement_tick', ...settlementResult });

  // 2. Rollover scan – find ACTIVE markets whose rollover window has started but no child exists
  try {
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const { data: rolloverCandidates, error: rollErr } = await supabase
      .from('markets')
      .select('id, market_identifier, market_address, settlement_date, market_config, deployed_at, symbol')
      .eq('market_status', 'ACTIVE')
      .eq('is_active', true)
      .lte('settlement_date', thirtyDaysFromNow.toISOString())
      .gt('settlement_date', nowIso)
      .order('settlement_date', { ascending: true })
      .limit(10);

    if (rollErr) {
      results.push({ type: 'rollover_scan', ok: false, error: rollErr.message });
    } else {
      for (const m of rolloverCandidates || []) {
        const cfg = (typeof m.market_config === 'object' && m.market_config) || {};
        if ((cfg as any)?.rollover?.child_market_id) continue; // already rolled over

        // Check if rollover window is actually open (using same math as qstash-scheduler)
        const settlementMs = new Date(m.settlement_date).getTime();
        const deployedMs = m.deployed_at ? new Date(m.deployed_at).getTime() : 0;
        const lifecycleDurationMs = deployedMs > 0 ? (settlementMs - deployedMs) : 365 * 24 * 60 * 60 * 1000;
        const { rolloverLead } = proportionalDurations(Math.floor(lifecycleDurationMs / 1000));
        const rolloverWindowStart = settlementMs - rolloverLead * 1000;

        if (now.getTime() < rolloverWindowStart) continue;

        const rolloverResult = await handleRollover(m.id, m.market_address);
        results.push({ type: 'rollover', marketId: m.id, ...rolloverResult });
      }
    }
  } catch (e: any) {
    results.push({ type: 'rollover_scan', ok: false, error: e?.message });
  }

  return { ok: true, mode: 'safety_net_scan', timestamp: nowIso, results };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  if (!verifyVercelCron(req)) {
    return json(401, { ok: false, error: 'unauthorized' });
  }

  log('cron_get', 'start');
  const result = await runSafetyNetScan();
  log('cron_get', 'success', result);
  return json(200, result);
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  const isQStash = await verifyQStashSignature(req, rawBody);
  const isCron = verifyVercelCron(req);

  if (!isQStash && !isCron) {
    return json(401, { ok: false, error: 'unauthorized' });
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    if (isCron) {
      log('cron_post', 'start');
      const result = await runSafetyNetScan();
      log('cron_post', 'success', result);
      return json(200, result);
    }
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const action = String(body.action || 'scan');
  const marketId = typeof body.marketId === 'string' ? body.marketId
    : typeof body.market_id === 'string' ? body.market_id : '';
  const marketAddress = typeof body.marketAddress === 'string' ? body.marketAddress
    : typeof body.market_address === 'string' ? body.market_address : null;

  log('dispatch', 'start', { action, marketId, source: isQStash ? 'qstash' : 'cron' });

  switch (action) {
    case 'rollover':
    case 'rollover_start': {
      if (!marketId) return json(400, { ok: false, error: 'market_id_required' });
      const result = await handleRollover(marketId, marketAddress);
      log('dispatch_rollover', 'success', result);
      return json(200, result);
    }

    case 'challenge_open': {
      if (!marketId) return json(400, { ok: false, error: 'market_id_required' });
      const sb = getSupabase();
      if (!sb) return json(500, { ok: false, error: 'supabase_not_configured' });

      const { data: mktData, error: mktErr } = await sb
        .from('markets')
        .select('id, market_identifier, market_address, market_status, settlement_date, market_config')
        .eq('id', marketId)
        .maybeSingle();

      if (mktErr || !mktData) {
        return json(404, { ok: false, error: 'market_not_found' });
      }

      if (!['ACTIVE', 'SETTLEMENT_REQUESTED'].includes(mktData.market_status)) {
        log('challenge_open', 'skipped', { reason: `status_is_${mktData.market_status}` });
        return json(200, { ok: true, skipped: true, reason: `status_is_${mktData.market_status}` });
      }

      const syncResult = await settlementSyncLifecycleOnChain(mktData as MarketRow);
      log('challenge_open', syncResult.ok ? 'success' : 'error', syncResult);

      if (!syncResult.ok) {
        return json(200, { ok: false, error: syncResult.error, action: 'challenge_open' });
      }

      return json(200, {
        ok: true,
        action: 'challenge_open',
        previousState: syncResult.previousState,
        newState: syncResult.newState,
      });
    }

    case 'settlement_start': {
      const sb = getSupabase();
      if (!sb) return json(500, { ok: false, error: 'supabase_not_configured' });
      if (marketId) {
        const result = await forceStartSettlementWindow(sb, marketId);
        log('dispatch_settlement_start', 'success', result);
        return json(200, result);
      }
      const result = await runSettlementTick(sb);
      return json(200, result);
    }

    case 'settlement_finalize': {
      const sb = getSupabase();
      if (!sb) return json(500, { ok: false, error: 'supabase_not_configured' });
      if (marketId) {
        const result = await runSingleSettlementCheck(sb, marketId);
        log('dispatch_settlement_finalize', 'success', result);

        const singleResult = result.result;
        if (singleResult && !singleResult.ok && singleResult.reason === 'window_not_expired' && singleResult.settlementDate) {
          const retryAtUnix = Math.floor(new Date(singleResult.settlementDate).getTime() / 1000) + ONCHAIN_SETTLE_BUFFER_SEC;
          if (retryAtUnix > Math.floor(Date.now() / 1000)) {
            try {
              const retryId = await scheduleSettlementFinalize(marketId, retryAtUnix, {
                marketAddress: marketAddress || undefined,
                symbol: typeof body.symbol === 'string' ? body.symbol : undefined,
                settlementDateUnix: typeof body.settlement_date_unix === 'number' ? body.settlement_date_unix : undefined,
              });
              log('dispatch_settlement_finalize_retry', 'success', {
                marketId, retryAt: new Date(retryAtUnix * 1000).toISOString(), retryId,
              });
            } catch (e: any) {
              log('dispatch_settlement_finalize_retry', 'error', { error: e?.message });
            }
          }
        }

        return json(200, result);
      }
      const result = await runSettlementTick(sb);
      return json(200, result);
    }

    case 'reschedule': {
      if (!marketId) return json(400, { ok: false, error: 'market_id_required' });
      const settlementUnix = typeof body.settlement_date_unix === 'number' ? body.settlement_date_unix : 0;
      if (!settlementUnix) return json(400, { ok: false, error: 'settlement_date_unix_required' });
      const symbol = typeof body.symbol === 'string' ? body.symbol : undefined;
      try {
        const ids = await scheduleMarketLifecycle(marketId, settlementUnix, {
          marketAddress: marketAddress || undefined,
          symbol,
        });
        const sb = getSupabase();
        if (sb) {
          try {
            await sb.from('markets').update({ qstash_schedule_ids: ids }).eq('id', marketId);
          } catch {}
        }
        log('dispatch_reschedule', 'success', { marketId, ids });
        return json(200, { ok: true, action: 'reschedule', marketId, ids });
      } catch (e: any) {
        log('dispatch_reschedule', 'error', { error: e?.message });
        return json(500, { ok: false, error: e?.message });
      }
    }

    case 'scan':
    default: {
      const result = await runSafetyNetScan();
      log('dispatch_scan', 'success', result);
      return json(200, result);
    }
  }
}
