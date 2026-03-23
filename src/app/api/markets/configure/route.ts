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

    // ---- 1. Ensure placement selectors ----
    if (!configState.selectors_verified) {
      try {
        logS('ensure_selectors', 'start', { orderBook });
        const LoupeABI = ['function facetAddress(bytes4) view returns (address)'];
        const CutABI = ['function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)'];
        const loupe = new ethers.Contract(orderBook, LoupeABI, wallet);
        const diamondCut = new ethers.Contract(orderBook, CutABI, wallet);
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
        const selectorResults = await Promise.all(
          requiredSelectors.map(async (sel) => {
            try {
              const addr: string = await loupe.facetAddress(sel);
              return (!addr || addr.toLowerCase() === ethers.ZeroAddress.toLowerCase()) ? sel : null;
            } catch { return sel; }
          })
        );
        const missing = selectorResults.filter((s): s is string => s !== null);
        if (missing.length > 0 && placementFacet && ethers.isAddress(placementFacet)) {
          logS('ensure_selectors_missing', 'start', { missingCount: missing.length });
          const cutData = [{ facetAddress: placementFacet, action: 0, functionSelectors: missing }];
          const ov = await nonceMgr.nextOverrides();
          const txCut = await diamondCut.diamondCut(cutData as any, ethers.ZeroAddress, '0x', ov as any);
          logS('ensure_selectors_diamondCut_sent', 'success', { tx: txCut.hash });
          const rc = await txCut.wait();
          logS('ensure_selectors_diamondCut_mined', 'success', { tx: rc?.hash || txCut.hash });
        } else {
          logS('ensure_selectors', 'success', { message: 'All placement selectors present' });
        }
        configState.selectors_verified = true;
      } catch (e: any) {
        logS('ensure_selectors', 'error', { error: e?.message || String(e) });
      }
    }

    // ---- 2. Attach session registry ----
    if (!configState.session_registry_attached) {
      try { await nonceMgr.resync(); } catch {}
      try {
        const registryAddress = process.env.SESSION_REGISTRY_ADDRESS || (process.env as any).NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS || '';
        if (!registryAddress || !ethers.isAddress(registryAddress)) {
          logS('attach_session_registry', 'error', { error: 'Missing SESSION_REGISTRY_ADDRESS' });
        } else {
          logS('attach_session_registry', 'start', { orderBook, registry: registryAddress });
          // Allow orderbook on registry
          try {
            const regAbi = [
              'function allowedOrderbook(address) view returns (bool)',
              'function setAllowedOrderbook(address,bool) external',
            ];
            const registry = new ethers.Contract(registryAddress, regAbi, wallet);
            const allowed: boolean = await registry.allowedOrderbook(orderBook);
            if (!allowed) {
              const ovAllow = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
              const txAllow = await registry.setAllowedOrderbook(orderBook, true, ovAllow as any);
              logS('attach_session_registry_sent', 'success', { tx: txAllow.hash, action: 'allow_orderbook' });
              await txAllow.wait();
              logS('attach_session_registry_mined', 'success', { action: 'allow_orderbook' });
            }
          } catch (e: any) {
            logS('attach_session_registry', 'error', { error: e?.message || String(e), action: 'allow_orderbook' });
          }
          // Set session registry on MetaTradeFacet
          try {
            const meta = new ethers.Contract(orderBook, (MetaTradeFacetArtifact as any).abi, wallet);
            const current = await meta.sessionRegistry();
            if (!current || String(current).toLowerCase() !== String(registryAddress).toLowerCase()) {
              const ov = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
              const txSet = await meta.setSessionRegistry(registryAddress, ov);
              logS('attach_session_registry_sent', 'success', { tx: txSet.hash, action: 'set_session_registry' });
              await txSet.wait();
              logS('attach_session_registry_mined', 'success', { action: 'set_session_registry' });
            } else {
              logS('attach_session_registry', 'success', { message: 'Already set' });
            }
          } catch (e: any) {
            logS('attach_session_registry', 'error', { error: e?.message || String(e), action: 'set_session_registry' });
          }
          configState.session_registry_attached = true;
        }
      } catch (e: any) {
        logS('attach_session_registry', 'error', { error: e?.message || String(e) });
      }
    }

    // ---- 3. Grant CoreVault roles ----
    if (!configState.roles_granted?.ORDERBOOK_ROLE || !configState.roles_granted?.SETTLEMENT_ROLE) {
      logS('grant_roles', 'start', { coreVault: coreVaultAddress, orderBook });
      const coreVault = new ethers.Contract(coreVaultAddress, CoreVaultABI as any, wallet);
      const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
      const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
      try {
        const ov1 = await nonceMgr.nextOverrides();
        const ov2 = await nonceMgr.nextOverrides();
        const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook, ov1);
        logS('grant_ORDERBOOK_ROLE_sent', 'success', { tx: tx1.hash });
        const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook, ov2);
        logS('grant_SETTLEMENT_ROLE_sent', 'success', { tx: tx2.hash });
        const [r1, r2] = await Promise.all([tx1.wait(), tx2.wait()]);
        configState.roles_granted = {
          ORDERBOOK_ROLE: { tx: r1?.hash || tx1.hash, block: r1?.blockNumber },
          SETTLEMENT_ROLE: { tx: r2?.hash || tx2.hash, block: r2?.blockNumber },
        };
        logS('grant_roles', 'success');
      } catch (e: any) {
        logS('grant_roles', 'error', { error: extractError(e) });
        return NextResponse.json({ error: 'Role grant failed', details: extractError(e) }, { status: 500 });
      }
    }

    // ---- 4. Configure fees ----
    if (!configState.fees_configured || !configState.fee_recipient_set) {
      const defaultProtocolRecipient = process.env.PROTOCOL_FEE_RECIPIENT || (process.env as any).NEXT_PUBLIC_PROTOCOL_FEE_RECIPIENT || '';
      const protocolFeeRecipient = isRollover && feeRecipient && ethers.isAddress(feeRecipient)
        ? feeRecipient : defaultProtocolRecipient;
      const takerFeeBps = 7;
      const makerFeeBps = 3;
      const protocolShareBps = 8000;
      const creatorAddr = isRollover && feeRecipient && ethers.isAddress(feeRecipient)
        ? feeRecipient : (creatorWalletAddress || ownerAddress);

      const feeTxPromises: Promise<any>[] = [];

      if (!configState.fees_configured && protocolFeeRecipient && ethers.isAddress(protocolFeeRecipient)) {
        logS('configure_fees', 'start', { orderBook });
        const feeJob = (async () => {
          const obFee = new ethers.Contract(orderBook,
            ['function updateFeeStructure(uint256,uint256,address,uint256) external'], wallet);
          const feeTx = await obFee.updateFeeStructure(
            takerFeeBps, makerFeeBps, protocolFeeRecipient, protocolShareBps,
            await nonceMgr.nextOverrides()
          );
          logS('configure_fees_sent', 'success', { tx: feeTx.hash });
          const feeRc = await feeTx.wait();
          configState.fees_configured = { tx: feeRc?.hash || feeTx.hash };
          logS('configure_fees_mined', 'success', { tx: feeRc?.hash || feeTx.hash });
        })().catch((e: any) => logS('configure_fees', 'error', { error: e?.message || String(e) }));
        feeTxPromises.push(feeJob);
      }

      if (!configState.fee_recipient_set) {
        logS('set_fee_recipient', 'start', { orderBook, creator: creatorAddr });
        const recipientJob = (async () => {
          const obTrade = new ethers.Contract(orderBook, [
            'function updateTradingParameters(uint256,uint256,address) external',
            'function getTradingParameters() view returns (uint256,uint256,address)',
          ], wallet);
          const [marginBps, tradingFee] = await obTrade.getTradingParameters();
          const recipientTx = await obTrade.updateTradingParameters(
            marginBps, tradingFee, creatorAddr, await nonceMgr.nextOverrides()
          );
          logS('set_fee_recipient_sent', 'success', { tx: recipientTx.hash });
          const recipientRc = await recipientTx.wait();
          configState.fee_recipient_set = { tx: recipientRc?.hash || recipientTx.hash };
          logS('set_fee_recipient_mined', 'success', { tx: recipientRc?.hash || recipientTx.hash, feeRecipient: creatorAddr });
        })().catch((e: any) => logS('set_fee_recipient', 'error', { error: e?.message || String(e) }));
        feeTxPromises.push(recipientJob);
      }

      await Promise.all(feeTxPromises);
    }

    // ---- 5. Speed-run lifecycle overrides ----
    if (speedRunConfig && speedRunConfig.rolloverLeadSeconds > 0 && speedRunConfig.challengeDurationSeconds > 0 && !configState.speed_run_set) {
      try {
        logS('speed_run_testing_mode', 'start', { orderBook, speedRunConfig });
        const lifecycleContract = new ethers.Contract(orderBook, [
          'function enableTestingMode(bool enabled) external',
          'function setLeadTimes(uint256 rolloverLeadSeconds, uint256 challengeLeadSeconds) external',
        ], wallet);
        const ov1 = await nonceMgr.nextOverrides();
        const txEnable = await lifecycleContract.enableTestingMode(true, ov1);
        await txEnable.wait();
        logS('speed_run_testing_mode', 'success', { tx: txEnable.hash });

        const ov2 = await nonceMgr.nextOverrides();
        const txLead = await lifecycleContract.setLeadTimes(
          speedRunConfig.rolloverLeadSeconds, speedRunConfig.challengeDurationSeconds, ov2
        );
        await txLead.wait();
        logS('speed_run_lead_times', 'success', { tx: txLead.hash });
        configState.speed_run_set = true;
      } catch (e: any) {
        logS('speed_run_testing_mode', 'error', { error: e?.message || String(e) });
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
