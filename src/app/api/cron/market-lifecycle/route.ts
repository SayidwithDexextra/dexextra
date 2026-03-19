import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Receiver } from '@upstash/qstash';
import { ethers } from 'ethers';
import { scheduleMarketLifecycle } from '@/lib/qstash-scheduler';
import { runSettlementTick, runSingleSettlementCheck } from '@/lib/settlement-engine';

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

  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'supabase_not_configured' };

  const { data: market, error: fetchErr } = await supabase
    .from('markets')
    .select('*')
    .eq('id', marketId)
    .maybeSingle();

  if (fetchErr || !market) {
    log('rollover', 'error', { error: fetchErr?.message || 'market_not_found' });
    return { ok: false, error: fetchErr?.message || 'market_not_found' };
  }

  const effectiveAddress = marketAddress || market.market_address;
  if (!effectiveAddress) return { ok: false, error: 'no_market_address' };

  const existingConfig = (typeof market.market_config === 'object' && market.market_config) || {};
  const rolloverConfig = (existingConfig as any)?.rollover || {};
  if (rolloverConfig.child_market_id) {
    log('rollover', 'success', { reason: 'child_already_exists', childId: rolloverConfig.child_market_id });
    return { ok: true, skipped: true, reason: 'child_already_exists', childId: rolloverConfig.child_market_id };
  }

  // 1. Sync lifecycle on-chain
  const syncResult = await syncLifecycleOnChain(effectiveAddress);
  log('rollover_sync', syncResult.ok ? 'success' : 'error', syncResult as any);

  // 2. Derive CREATOR wallet for rollover markets (gets 100% of fees)
  const funderPk = process.env.CREATOR_PRIVATE_KEY;
  let funderAddress: string | null = null;
  if (funderPk) {
    try {
      funderAddress = new ethers.Wallet(funderPk).address;
    } catch {}
  }

  // 3. Ensure the parent market belongs to a series (create one if needed)
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

  const childSequence = parentSequence + 1;

  // 4. Compute child settlement date (same duration as parent)
  const parentSettlementDate = market.settlement_date ? new Date(market.settlement_date) : null;
  const parentDeployedAt = market.deployed_at ? new Date(market.deployed_at) : null;
  if (!parentSettlementDate) return { ok: false, error: 'no_parent_settlement_date' };

  let lifecycleDurationMs: number;
  if (parentDeployedAt) {
    lifecycleDurationMs = parentSettlementDate.getTime() - parentDeployedAt.getTime();
  } else {
    lifecycleDurationMs = 365 * 24 * 60 * 60 * 1000;
  }
  if (lifecycleDurationMs <= 0) lifecycleDurationMs = 365 * 24 * 60 * 60 * 1000;

  const childSettlementDate = new Date(parentSettlementDate.getTime() + lifecycleDurationMs);
  const childSettlementUnix = Math.floor(childSettlementDate.getTime() / 1000);

  // 5. Publish child market creation via QStash (async, avoids Vercel timeout)
  const baseUrl =
    process.env.APP_URL?.replace(/\/+$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const initialOrder = (typeof market.initial_order === 'object' && market.initial_order) || {};
  const rolloverCreator = funderAddress || market.creator_wallet_address || '';

  const childSymbol = `${baseSymbol}-R${childSequence}`;

  const createPayload: Record<string, unknown> = {
    symbol: childSymbol,
    name: `${baseSymbol} Futures (Rollover #${childSequence - 1})`,
    description: market.description || `Rollover market for ${baseSymbol}`,
    metricUrl: (initialOrder as any)?.metricUrl || (initialOrder as any)?.metric_url || '',
    settlementDate: childSettlementUnix,
    startPrice: (initialOrder as any)?.startPrice || 1,
    dataSource: (initialOrder as any)?.dataSource || 'rollover',
    tags: Array.isArray(market.category) ? market.category : ['CUSTOM'],
    creatorWalletAddress: rolloverCreator,
    feeRecipient: rolloverCreator,
    isRollover: true,
    parentMarketAddress: effectiveAddress,
    parentMarketId: market.id,
    seriesId,
    childSequence,
  };

  const qstashToken = process.env.QSTASH_TOKEN;
  const createEndpoint = `${baseUrl}/api/markets/create`;

  if (qstashToken) {
    // Publish via QStash so the create route runs in its own function invocation
    try {
      const qstashBase = process.env.QSTASH_URL || 'https://qstash.upstash.io';
      const publishRes = await fetch(`${qstashBase}/v2/publish/${createEndpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${qstashToken}`,
          'Content-Type': 'application/json',
          'Upstash-Retries': '2',
        },
        body: JSON.stringify(createPayload),
      });
      const publishResult = await publishRes.json().catch(() => null);
      if (!publishRes.ok) {
        log('rollover_qstash_publish', 'error', { status: publishRes.status, result: publishResult });
        return { ok: false, error: 'qstash_publish_failed', details: publishResult };
      }
      log('rollover_qstash_publish', 'success', { messageId: (publishResult as any)?.messageId });
    } catch (e: any) {
      log('rollover_qstash_publish', 'error', { error: e?.message });
      return { ok: false, error: 'qstash_publish_exception', details: e?.message };
    }
  } else {
    // Fallback: direct fetch (will block but works without QStash)
    try {
      const createRes = await fetch(createEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload),
      });
      const childResult = await createRes.json().catch(() => null);
      if (!createRes.ok) {
        log('rollover_create_child', 'error', { status: createRes.status, result: childResult });
        return { ok: false, error: 'child_market_creation_failed', details: childResult };
      }
      log('rollover_create_child', 'success', childResult as any);
    } catch (e: any) {
      log('rollover_create_child', 'error', { error: e?.message });
      return { ok: false, error: 'child_market_creation_exception', details: e?.message };
    }
  }

  log('rollover', 'success', {
    parentId: marketId,
    childSymbol,
    childSettlementDate: childSettlementDate.toISOString(),
    seriesId,
    childSequence,
    async: !!qstashToken,
  });

  return {
    ok: true,
    parentId: marketId,
    childSymbol,
    childSettlementDate: childSettlementDate.toISOString(),
    seriesId,
    childSequence,
    async: !!qstashToken,
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

        // Check if rollover window is actually open
        const settlementMs = new Date(m.settlement_date).getTime();
        const deployedMs = m.deployed_at ? new Date(m.deployed_at).getTime() : 0;
        const lifecycleDuration = deployedMs > 0 ? (settlementMs - deployedMs) : 365 * 24 * 60 * 60 * 1000;
        const rolloverLead = Math.floor(lifecycleDuration / 12);
        const rolloverWindowStart = settlementMs - rolloverLead;

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

    case 'settlement_start': {
      const sb = getSupabase();
      if (!sb) return json(500, { ok: false, error: 'supabase_not_configured' });
      if (marketId) {
        const syncRes = marketAddress ? await syncLifecycleOnChain(marketAddress) : null;
        const result = await runSingleSettlementCheck(sb, marketId);
        log('dispatch_settlement_start', 'success', { syncRes, ...result });
        return json(200, { ...result, syncLifecycle: syncRes });
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
