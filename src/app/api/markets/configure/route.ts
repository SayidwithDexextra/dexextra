import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import {
  OBOrderPlacementFacetABI,
  CoreVaultABI,
} from '@/lib/contracts';
import MetaTradeFacetArtifact from '@/lib/abis/facets/MetaTradeFacet.json';
import { getPusherServer } from '@/lib/pusher-server';
import type { PipelineConfigureState } from '@/types/marketDraft';
import {
  shortAddr, shortTx,
  phaseHeader, phaseDivider, phaseFooter,
  stepLog as vStep,
  laneLog, laneOverview, phaseSummary,
} from '@/lib/console-logger';
import { scheduleMarketLifecycle } from '@/lib/qstash-scheduler';

export const runtime = 'nodejs';
export const maxDuration = 300;

function logStep(step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) {
  try {
    console.log(JSON.stringify({
      area: 'market_creation',
      context: 'markets_configure',
      step, status,
      timestamp: new Date().toISOString(),
      ...((data && typeof data === 'object') ? data : {})
    }));
  } catch {}
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function getTxOverrides(provider: ethers.Provider) {
  try {
    const fee = await provider.getFeeData();
    const minPriority = ethers.parseUnits('0.1', 'gwei');
    const minMax = ethers.parseUnits('1', 'gwei');
    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
      const maxPriority = fee.maxPriorityFeePerGas > minPriority ? fee.maxPriorityFeePerGas : minPriority;
      let maxFee = fee.maxFeePerGas + maxPriority;
      if (maxFee < minMax) maxFee = minMax;
      return { maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPriority } as const;
    }
    const base = fee.gasPrice || ethers.parseUnits('0.5', 'gwei');
    const bumped = (base * 12n) / 10n;
    const minLegacy = ethers.parseUnits('1', 'gwei');
    return { gasPrice: bumped > minLegacy ? bumped : minLegacy } as const;
  } catch {
    return { gasPrice: ethers.parseUnits('1', 'gwei') } as const;
  }
}

async function createNonceManager(signer: ethers.Wallet) {
  const address = await signer.getAddress();
  let next = await signer.provider!.getTransactionCount(address, 'pending');
  return {
    async nextOverrides() {
      const fee = await getTxOverrides(signer.provider!);
      const ov: any = { ...fee, nonce: next };
      next += 1;
      return ov;
    },
    async resync() {
      next = await signer.provider!.getTransactionCount(address, 'pending');
      return next;
    },
  } as const;
}

function extractError(e: any) {
  try {
    return e?.shortMessage || e?.reason || e?.error?.message || e?.message || String(e);
  } catch { return String(e); }
}

function normalizePk(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

async function checkpointConfigure(
  supabase: ReturnType<typeof getSupabase>,
  draftId: string,
  configState: PipelineConfigureState,
) {
  if (!draftId || !supabase) return;
  try {
    const { data: draft } = await supabase
      .from('market_drafts')
      .select('pipeline_state')
      .eq('id', draftId)
      .maybeSingle();
    const existing = draft?.pipeline_state || {};
    await supabase.from('market_drafts').update({
      pipeline_state: { ...existing, configure: configState },
    }).eq('id', draftId);
  } catch {}
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const draftId = typeof body?.draftId === 'string' ? String(body.draftId) : '';
    const orderBook = typeof body?.orderBook === 'string' ? String(body.orderBook) : '';
    const pipelineId = typeof body?.pipelineId === 'string' ? String(body.pipelineId) : '';
    const isRollover = body?.isRollover === true;
    const feeRecipient = (body?.feeRecipient && ethers.isAddress(body.feeRecipient)) ? body.feeRecipient : null;
    const creatorWalletAddress = (body?.creatorWalletAddress && ethers.isAddress(body.creatorWalletAddress)) ? String(body.creatorWalletAddress).toLowerCase() : null;
    const speedRunConfig = (body?.speedRunConfig && typeof body.speedRunConfig === 'object')
      ? {
          rolloverLeadSeconds: Number(body.speedRunConfig.rolloverLeadSeconds) || 0,
          challengeDurationSeconds: Number(body.speedRunConfig.challengeDurationSeconds) || 0,
          settlementWindowSeconds: Number(body.speedRunConfig.settlementWindowSeconds) || 0,
        }
      : null;

    if (!orderBook || !ethers.isAddress(orderBook)) {
      return NextResponse.json({ error: 'Valid orderBook address is required' }, { status: 400 });
    }

    const pusher = pipelineId ? getPusherServer() : null;
    const pusherChannel = pipelineId ? `deploy-${pipelineId}` : '';
    const logS = (step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) => {
      logStep(step, status, data);
      if (pusher && pusherChannel) {
        try {
          (pusher as any)['pusher'].trigger(pusherChannel, 'progress', {
            step, status, data: data || {}, timestamp: new Date().toISOString(),
          });
        } catch {}
      }
    };

    const supabase = getSupabase();

    // Load existing pipeline state to skip completed steps
    let existingState: PipelineConfigureState = {};
    if (draftId && supabase) {
      try {
        const { data: draft } = await supabase
          .from('market_drafts')
          .select('pipeline_state')
          .eq('id', draftId)
          .maybeSingle();
        if (draft?.pipeline_state?.configure) {
          existingState = draft.pipeline_state.configure as PipelineConfigureState;
        }
      } catch {}

      await supabase.from('market_drafts').update({ pipeline_stage: 'configuring' }).eq('id', draftId);
    }

    const configState: PipelineConfigureState = { ...existingState };

    const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL;
    const pk = process.env.ADMIN_PRIVATE_KEY;
    const coreVaultAddress = process.env.CORE_VAULT_ADDRESS || (process.env as any).NEXT_PUBLIC_CORE_VAULT_ADDRESS;
    const placementFacet = process.env.OB_ORDER_PLACEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET;

    if (!rpcUrl) return NextResponse.json({ error: 'RPC_URL not configured' }, { status: 400 });
    if (!pk) return NextResponse.json({ error: 'ADMIN_PRIVATE_KEY not configured' }, { status: 400 });
    if (!coreVaultAddress || !ethers.isAddress(coreVaultAddress)) {
      return NextResponse.json({ error: 'CoreVault address not configured' }, { status: 400 });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    const nonceMgr = await createNonceManager(wallet);
    const ownerAddress = await wallet.getAddress();

    // ── Secondary signer for CoreVault role grants (parallel lane) ──
    const secondaryPk =
      process.env.ROLE_GRANTER_PRIVATE_KEY ||
      process.env.RELAYER_PRIVATE_KEY;
    const normalizedSecondaryPk = secondaryPk ? normalizePk(secondaryPk) : null;
    const normalizedPrimaryPk = normalizePk(pk);
    const useParallelSigners =
      normalizedSecondaryPk &&
      /^0x[a-fA-F0-9]{64}$/.test(normalizedSecondaryPk) &&
      normalizedSecondaryPk.toLowerCase() !== normalizedPrimaryPk.toLowerCase();

    let vaultWallet: ethers.Wallet;
    let vaultNonceMgr: Awaited<ReturnType<typeof createNonceManager>>;
    if (useParallelSigners) {
      vaultWallet = new ethers.Wallet(normalizedSecondaryPk, provider);
      vaultNonceMgr = await createNonceManager(vaultWallet);
      logS('parallel_signers', 'success', {
        diamondOwner: ownerAddress,
        vaultAdmin: await vaultWallet.getAddress(),
      });
    } else {
      vaultWallet = wallet;
      vaultNonceMgr = nonceMgr;
    }

    const vaultAddr = await vaultWallet.getAddress();

    phaseHeader('CONFIGURE MARKET', shortAddr(orderBook));
    laneOverview(
      !!useParallelSigners,
      { signer: shortAddr(ownerAddress), tasks: 'Selectors, Registry, Fees, Speed-run' },
      useParallelSigners
        ? { signer: shortAddr(vaultAddr), tasks: 'CoreVault Role Grants' }
        : undefined,
    );
    const configureStart = Date.now();

    // =========================================================================
    // Phase 1: Parallel reads – determine what work each lane needs to do
    // =========================================================================

    const registryAddress = process.env.SESSION_REGISTRY_ADDRESS || (process.env as any).NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS || '';
    const hasRegistry = registryAddress && ethers.isAddress(registryAddress);

    const LoupeABI = ['function facetAddress(bytes4) view returns (address)'];
    const loupe = new ethers.Contract(orderBook, LoupeABI, provider);
    const placementSigs = [
      'placeLimitOrder(uint256,uint256,bool)',
      'placeMarginLimitOrder(uint256,uint256,bool)',
      'placeMarketOrder(uint256,bool)',
      'placeMarginMarketOrder(uint256,bool)',
      'placeMarketOrderWithSlippage(uint256,bool,uint256)',
      'placeMarginMarketOrderWithSlippage(uint256,bool,uint256)',
      'cancelOrder(uint256)',
    ];
    const requiredSelectors = placementSigs.map((sig) => ethers.id(sig).slice(0, 10));

    const regAbi = [
      'function allowedOrderbook(address) view returns (bool)',
      'function setAllowedOrderbook(address,bool) external',
    ];

    const [selectorResults, registryAllowed, currentRegistry, tradingParams] = await Promise.all([
      !configState.selectors_verified
        ? Promise.all(requiredSelectors.map(async (sel) => {
            try {
              const addr: string = await loupe.facetAddress(sel);
              return (!addr || addr.toLowerCase() === ethers.ZeroAddress.toLowerCase()) ? sel : null;
            } catch { return sel; }
          }))
        : Promise.resolve([]),
      hasRegistry && !configState.session_registry_attached
        ? new ethers.Contract(registryAddress, regAbi, provider).allowedOrderbook(orderBook).catch(() => false)
        : Promise.resolve(true),
      hasRegistry && !configState.session_registry_attached
        ? new ethers.Contract(orderBook, (MetaTradeFacetArtifact as any).abi, provider).sessionRegistry().catch(() => ethers.ZeroAddress)
        : Promise.resolve(registryAddress),
      (!configState.fee_recipient_set)
        ? new ethers.Contract(orderBook, [
            'function getTradingParameters() view returns (uint256,uint256,address)',
          ], provider).getTradingParameters().catch(() => [0n, 0n, ethers.ZeroAddress])
        : Promise.resolve([0n, 0n, ethers.ZeroAddress]),
    ]);

    const missingSelectors = selectorResults.filter((s): s is string => s !== null);
    const needSelectors = !configState.selectors_verified && missingSelectors.length > 0;
    const needRegistryAllow = hasRegistry && !configState.session_registry_attached && !registryAllowed;
    const needRegistryAttach = hasRegistry && !configState.session_registry_attached &&
      (!currentRegistry || String(currentRegistry).toLowerCase() !== String(registryAddress).toLowerCase());
    const needRoles = !configState.roles_granted?.ORDERBOOK_ROLE || !configState.roles_granted?.SETTLEMENT_ROLE;
    const needFees = !configState.fees_configured || !configState.fee_recipient_set;

    logS('parallel_reads', 'success', {
      missingSelectors: missingSelectors.length,
      needRegistryAllow,
      needRegistryAttach,
      needRoles,
      needFees,
    });

    // =========================================================================
    // Phase 2: Parallel writes across two signers
    //   Lane A (diamond owner / ADMIN_PRIVATE_KEY):
    //     selectors, allow orderbook, attach session registry, fees, speed-run
    //   Lane B (vault admin / ROLE_GRANTER_PRIVATE_KEY):
    //     CoreVault role grants (ORDERBOOK_ROLE, SETTLEMENT_ROLE)
    // =========================================================================

    // Lane A: diamond owner operations
    const laneA = async () => {
      laneLog('A', 'Starting lane', 'start', `signer=${shortAddr(ownerAddress)}`);

      // 1. Ensure selectors
      if (!configState.selectors_verified) {
        if (needSelectors && placementFacet && ethers.isAddress(placementFacet)) {
          try {
            laneLog('A', 'Ensure selectors', 'start', `${missingSelectors.length} missing`);
            logS('ensure_selectors_missing', 'start', { missingCount: missingSelectors.length });
            const CutABI = ['function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)'];
            const diamondCut = new ethers.Contract(orderBook, CutABI, wallet);
            const cutData = [{ facetAddress: placementFacet, action: 0, functionSelectors: missingSelectors }];
            const ov = await nonceMgr.nextOverrides();
            const txCut = await diamondCut.diamondCut(cutData as any, ethers.ZeroAddress, '0x', ov as any);
            laneLog('A', 'Ensure selectors', 'start', `tx sent ${shortTx(txCut.hash)}`);
            logS('ensure_selectors_diamondCut_sent', 'success', { tx: txCut.hash });
            await txCut.wait();
            laneLog('A', 'Ensure selectors', 'success', 'mined');
            logS('ensure_selectors_diamondCut_mined', 'success', { tx: txCut.hash });
          } catch (e: any) {
            laneLog('A', 'Ensure selectors', 'error', e?.shortMessage || e?.message || String(e));
            logS('ensure_selectors', 'error', { error: e?.message || String(e) });
          }
        } else {
          laneLog('A', 'Ensure selectors', 'success', 'all present');
          logS('ensure_selectors', 'success', { message: 'All placement selectors present' });
        }
        configState.selectors_verified = true;
        await checkpointConfigure(supabase, draftId, configState);
      }

      // 2. Allow orderbook on registry (requires diamond owner / ADMIN_PRIVATE_KEY)
      if (needRegistryAllow) {
        try {
          laneLog('A', 'Allow orderbook on registry', 'start');
          const registry = new ethers.Contract(registryAddress, regAbi, wallet);
          const ov = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
          const txAllow = await registry.setAllowedOrderbook(orderBook, true, ov as any);
          laneLog('A', 'Allow orderbook on registry', 'start', `tx sent ${shortTx(txAllow.hash)}`);
          logS('attach_session_registry_sent', 'success', { tx: txAllow.hash, action: 'allow_orderbook' });
          const rcAllow = await txAllow.wait();
          laneLog('A', 'Allow orderbook on registry', 'success', 'mined');
          logS('attach_session_registry_mined', 'success', { action: 'allow_orderbook', tx: rcAllow?.hash || txAllow.hash });
        } catch (e: any) {
          laneLog('A', 'Allow orderbook on registry', 'error', e?.shortMessage || e?.message || String(e));
          logS('attach_session_registry', 'error', { error: e?.message || String(e), action: 'allow_orderbook' });
        }
      }

      // 3. Attach session registry on MetaTradeFacet (diamond owner only)
      if (needRegistryAttach) {
        try {
          laneLog('A', 'Attach session registry', 'start', shortAddr(registryAddress));
          logS('attach_session_registry', 'start', { orderBook, registry: registryAddress });
          const meta = new ethers.Contract(orderBook, (MetaTradeFacetArtifact as any).abi, wallet);
          const ov = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
          const txSet = await meta.setSessionRegistry(registryAddress, ov);
          laneLog('A', 'Attach session registry', 'start', `tx sent ${shortTx(txSet.hash)}`);
          logS('attach_session_registry_sent', 'success', { tx: txSet.hash, action: 'set_session_registry' });
          await txSet.wait();
          laneLog('A', 'Attach session registry', 'success', 'mined');
          logS('attach_session_registry_mined', 'success', { action: 'set_session_registry' });
        } catch (e: any) {
          laneLog('A', 'Attach session registry', 'error', e?.shortMessage || e?.message || String(e));
          logS('attach_session_registry', 'error', { error: e?.message || String(e), action: 'set_session_registry' });
        }
      }
      if (needRegistryAllow || needRegistryAttach) {
        configState.session_registry_attached = true;
        await checkpointConfigure(supabase, draftId, configState);
      }

      // 4. Configure fees (fire both with pre-allocated nonces)
      if (needFees) {
        const defaultProtocolRecipient = process.env.PROTOCOL_FEE_RECIPIENT || (process.env as any).NEXT_PUBLIC_PROTOCOL_FEE_RECIPIENT || '';
        const protocolFeeRecipient = isRollover && feeRecipient && ethers.isAddress(feeRecipient)
          ? feeRecipient : defaultProtocolRecipient;
        const creatorAddr = isRollover && feeRecipient && ethers.isAddress(feeRecipient)
          ? feeRecipient : (creatorWalletAddress || ownerAddress);

        const feePromises: Promise<any>[] = [];

        if (!configState.fees_configured && protocolFeeRecipient && ethers.isAddress(protocolFeeRecipient)) {
          laneLog('A', 'Configure fee structure', 'start');
          logS('configure_fees', 'start', { orderBook });
          feePromises.push((async () => {
            const obFee = new ethers.Contract(orderBook,
              ['function updateFeeStructure(uint256,uint256,address,uint256) external'], wallet);
            const feeTx = await obFee.updateFeeStructure(7, 3, protocolFeeRecipient, 8000, await nonceMgr.nextOverrides());
            laneLog('A', 'Configure fee structure', 'start', `tx sent ${shortTx(feeTx.hash)}`);
            logS('configure_fees_sent', 'success', { tx: feeTx.hash });
            const feeRc = await feeTx.wait();
            configState.fees_configured = { tx: feeRc?.hash || feeTx.hash };
            laneLog('A', 'Configure fee structure', 'success', 'mined');
            logS('configure_fees_mined', 'success', { tx: feeRc?.hash || feeTx.hash });
          })().catch((e: any) => {
            laneLog('A', 'Configure fee structure', 'error', e?.message || String(e));
            logS('configure_fees', 'error', { error: e?.message || String(e) });
          }));
        }

        if (!configState.fee_recipient_set) {
          laneLog('A', 'Set fee recipient', 'start', shortAddr(creatorAddr));
          logS('set_fee_recipient', 'start', { orderBook, creator: creatorAddr });
          feePromises.push((async () => {
            const obTrade = new ethers.Contract(orderBook, [
              'function updateTradingParameters(uint256,uint256,address) external',
            ], wallet);
            const [marginBps, tradingFee] = tradingParams;
            const recipientTx = await obTrade.updateTradingParameters(marginBps, tradingFee, creatorAddr, await nonceMgr.nextOverrides());
            laneLog('A', 'Set fee recipient', 'start', `tx sent ${shortTx(recipientTx.hash)}`);
            logS('set_fee_recipient_sent', 'success', { tx: recipientTx.hash });
            const recipientRc = await recipientTx.wait();
            configState.fee_recipient_set = { tx: recipientRc?.hash || recipientTx.hash };
            laneLog('A', 'Set fee recipient', 'success', `mined -> ${shortAddr(creatorAddr)}`);
            logS('set_fee_recipient_mined', 'success', { tx: recipientRc?.hash || recipientTx.hash, feeRecipient: creatorAddr });
          })().catch((e: any) => {
            laneLog('A', 'Set fee recipient', 'error', e?.message || String(e));
            logS('set_fee_recipient', 'error', { error: e?.message || String(e) });
          }));
        }

        await Promise.all(feePromises);
        await checkpointConfigure(supabase, draftId, configState);
      }

      // 5. Speed-run lifecycle overrides
      if (speedRunConfig && speedRunConfig.rolloverLeadSeconds > 0 && speedRunConfig.challengeDurationSeconds > 0 && !configState.speed_run_set) {
        try {
          laneLog('A', 'Speed-run overrides', 'start', `rollover=${speedRunConfig.rolloverLeadSeconds}s challenge=${speedRunConfig.challengeDurationSeconds}s`);
          logS('speed_run_testing_mode', 'start', { orderBook, speedRunConfig });
          const lifecycleContract = new ethers.Contract(orderBook, [
            'function enableTestingMode(bool enabled) external',
            'function setLeadTimes(uint256 rolloverLeadSeconds, uint256 challengeLeadSeconds) external',
          ], wallet);
          const ov1 = await nonceMgr.nextOverrides();
          const ov2 = await nonceMgr.nextOverrides();
          const txEnable = await lifecycleContract.enableTestingMode(true, ov1);
          const txLead = await lifecycleContract.setLeadTimes(
            speedRunConfig.rolloverLeadSeconds, speedRunConfig.challengeDurationSeconds, ov2,
          );
          await Promise.all([txEnable.wait(), txLead.wait()]);
          laneLog('A', 'Speed-run overrides', 'success', 'testing mode enabled');
          logS('speed_run_testing_mode', 'success');
          configState.speed_run_set = true;
          await checkpointConfigure(supabase, draftId, configState);
        } catch (e: any) {
          laneLog('A', 'Speed-run overrides', 'error', e?.shortMessage || e?.message || String(e));
          logS('speed_run_testing_mode', 'error', { error: e?.message || String(e) });
        }
      }

      laneLog('A', 'Lane complete', 'success');
    };

    // Lane B: vault admin operations (CoreVault role grants)
    const laneB = async () => {
      laneLog('B', 'Starting lane', 'start', `signer=${shortAddr(vaultAddr)}`);

      if (needRoles) {
        laneLog('B', 'Grant CoreVault roles', 'start', shortAddr(coreVaultAddress));
        logS('grant_roles', 'start', { coreVault: coreVaultAddress, orderBook });
        const coreVault = new ethers.Contract(coreVaultAddress, CoreVaultABI as any, vaultWallet);
        const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
        const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));

        const ov1 = await vaultNonceMgr.nextOverrides();
        const ov2 = await vaultNonceMgr.nextOverrides();
        const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook, ov1);
        laneLog('B', 'ORDERBOOK_ROLE', 'start', `tx sent ${shortTx(tx1.hash)}`);
        logS('grant_ORDERBOOK_ROLE_sent', 'success', { tx: tx1.hash });
        const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook, ov2);
        laneLog('B', 'SETTLEMENT_ROLE', 'start', `tx sent ${shortTx(tx2.hash)}`);
        logS('grant_SETTLEMENT_ROLE_sent', 'success', { tx: tx2.hash });

        const [r1, r2] = await Promise.all([tx1.wait(), tx2.wait()]);
        laneLog('B', 'ORDERBOOK_ROLE', 'success', `mined block ${r1?.blockNumber}`);
        laneLog('B', 'SETTLEMENT_ROLE', 'success', `mined block ${r2?.blockNumber}`);
        configState.roles_granted = {
          ORDERBOOK_ROLE: { tx: r1?.hash || tx1.hash, block: r1?.blockNumber },
          SETTLEMENT_ROLE: { tx: r2?.hash || tx2.hash, block: r2?.blockNumber },
        };
        logS('grant_roles', 'success');
        await checkpointConfigure(supabase, draftId, configState);
      } else {
        laneLog('B', 'Roles already granted', 'success', 'skipped');
      }

      laneLog('B', 'Lane complete', 'success');
    };

    // Run both lanes in parallel
    const [laneAResult, laneBResult] = await Promise.allSettled([laneA(), laneB()]);

    phaseSummary(laneAResult, laneBResult, Date.now() - configureStart);

    if (laneBResult.status === 'rejected') {
      logS('grant_roles', 'error', { error: extractError(laneBResult.reason) });
      return NextResponse.json({ error: 'Role grant failed', details: extractError(laneBResult.reason) }, { status: 500 });
    }

    // ---- Recalculate settlement date from configuration completion ----
    // The original settlement date was computed at the START of creation, but
    // deployment + configuration can take 5+ minutes. For speed-run markets,
    // this eats significantly into trading time. Recalculate from NOW so
    // traders get the full intended window.
    if (speedRunConfig && supabase) {
      try {
        const { data: mkt } = await supabase
          .from('markets')
          .select('id, settlement_date, market_config, symbol, market_identifier')
          .eq('market_address', orderBook)
          .maybeSingle();

        if (mkt?.id) {
          const tradingDurationSec = 30 * 60;
          const newSettlementUnix = Math.floor(Date.now() / 1000) + tradingDurationSec;
          const newSettlementIso = new Date(newSettlementUnix * 1000).toISOString();
          const oldSettlementIso = mkt.settlement_date;

          vStep('Recalculate settlement', 'start', `old=${oldSettlementIso}`);
          logS('recalculate_settlement', 'start', { oldSettlement: oldSettlementIso, newSettlement: newSettlementIso });

          await supabase.from('markets').update({
            settlement_date: newSettlementIso,
            updated_at: new Date().toISOString(),
          }).eq('id', mkt.id);

          vStep('Recalculate settlement', 'success', `new=${newSettlementIso} (+30 min from now)`);
          logS('recalculate_settlement', 'success', { marketId: mkt.id, newSettlement: newSettlementIso });

          // Reschedule QStash lifecycle triggers with the new settlement date
          try {
            const symbolStr = mkt.symbol || mkt.market_identifier || '';
            const scheduleIds = await scheduleMarketLifecycle(mkt.id, newSettlementUnix, {
              marketAddress: orderBook,
              symbol: symbolStr,
              rolloverLeadSeconds: speedRunConfig.rolloverLeadSeconds,
              challengeDurationSeconds: speedRunConfig.challengeDurationSeconds,
            });
            vStep('Reschedule QStash', 'success', `${Object.keys(scheduleIds).length} events`);
            logS('reschedule_qstash', 'success', { marketId: mkt.id, scheduleIds });

            // Persist updated schedule IDs
            const existingCfg = (typeof mkt.market_config === 'object' && mkt.market_config) || {};
            await supabase.from('markets').update({
              qstash_schedule_ids: scheduleIds,
              market_config: {
                ...(existingCfg as any),
                qstash_lifecycle: {
                  schedule_ids: scheduleIds,
                  rollover_trigger_at: newSettlementUnix - speedRunConfig.rolloverLeadSeconds,
                  settlement_trigger_at: newSettlementUnix,
                  finalize_trigger_at: newSettlementUnix + speedRunConfig.challengeDurationSeconds,
                  scheduled_at: Math.floor(Date.now() / 1000),
                },
                settlement_recalculated: true,
                settlement_recalculated_at: new Date().toISOString(),
              },
            }).eq('id', mkt.id);
          } catch (e: any) {
            vStep('Reschedule QStash', 'error', e?.message || String(e));
            logS('reschedule_qstash', 'error', { error: e?.message || String(e) });
          }
        }
      } catch (e: any) {
        vStep('Recalculate settlement', 'error', e?.message || String(e));
        logS('recalculate_settlement', 'error', { error: e?.message || String(e) });
      }
    }

    configState.completed_at = new Date().toISOString();

    // Checkpoint: configured
    if (draftId && supabase) {
      try {
        const { data: draft } = await supabase
          .from('market_drafts')
          .select('pipeline_state')
          .eq('id', draftId)
          .maybeSingle();
        const existing = draft?.pipeline_state || {};
        await supabase.from('market_drafts').update({
          pipeline_stage: 'configured',
          pipeline_state: { ...existing, configure: configState },
        }).eq('id', draftId);
      } catch (e: any) {
        console.warn('[configure] checkpoint failed', e?.message || String(e));
      }
    }

    // Fire-and-forget inspect
    try {
      const baseUrl = process.env.APP_URL || 'http://localhost:3000';
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 8000);
      fetch(`${baseUrl}/api/markets/inspect-gasless`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderBook, pipelineId }),
        cache: 'no-store',
        signal: ctrl.signal,
      }).then(() => clearTimeout(timeout)).catch(() => clearTimeout(timeout));
    } catch {}

    logS('configure_complete', 'success', { orderBook, draftId });

    return NextResponse.json({
      ok: true,
      orderBook,
      configured: true,
      draftId,
      configState,
    });
  } catch (e: any) {
    logStep('unhandled_error', 'error', { error: e?.message || String(e) });
    return NextResponse.json({ error: e?.message || 'Configure failed' }, { status: 500 });
  }
}
