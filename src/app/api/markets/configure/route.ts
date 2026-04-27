import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import {
  CoreVaultABI,
  resolveFactoryVault,
  FeeRegistryABI,
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
          challengeWindowSeconds: Number(body.speedRunConfig.challengeWindowSeconds) || 0,
        }
      : null;
    const settlementTs = typeof body?.settlementTs === 'number' ? body.settlementTs : 0;

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

    // Resolve the CoreVault the factory actually uses on-chain
    const { effectiveVault: effectiveCoreVaultAddress, mismatch: vaultMismatch } =
      await resolveFactoryVault(provider, coreVaultAddress);
    if (vaultMismatch) {
      logS('vault_mismatch', 'start', {
        envCoreVault: coreVaultAddress,
        factoryVault: effectiveCoreVaultAddress,
        action: 'using factory vault for role grants',
      });
    }

    phaseHeader('CONFIGURE MARKET', shortAddr(orderBook));
    laneOverview(
      !!useParallelSigners,
      { signer: shortAddr(ownerAddress), tasks: 'Registry, Fees, Speed-run' },
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

    const regAbi = [
      'function allowedOrderbook(address) view returns (bool)',
      'function setAllowedOrderbook(address,bool) external',
    ];

    // All markets are V2 (DiamondRegistry) - selectors managed by central FacetRegistry, no per-market patching needed
    configState.selectors_verified = true;

    const [registryAllowed, currentRegistry, tradingParams] = await Promise.all([
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
    const needRegistryAllow = hasRegistry && !configState.session_registry_attached && !registryAllowed;
    const needRegistryAttach = hasRegistry && !configState.session_registry_attached &&
      (!currentRegistry || String(currentRegistry).toLowerCase() !== String(registryAddress).toLowerCase());
    const needRoles = !configState.roles_granted?.ORDERBOOK_ROLE || !configState.roles_granted?.SETTLEMENT_ROLE;
    const needFees = !configState.fees_configured || !configState.fee_recipient_set;

    logS('parallel_reads', 'success', {
      needRegistryAllow,
      needRegistryAttach,
      needRoles,
      needFees,
    });

    // =========================================================================
    // Phase 2: Parallel writes across two signers
    //   Lane A (diamond owner / ADMIN_PRIVATE_KEY):
    //     allow orderbook, attach session registry, fees, speed-run
    //   Lane B (vault admin / ROLE_GRANTER_PRIVATE_KEY):
    //     CoreVault role grants (ORDERBOOK_ROLE, SETTLEMENT_ROLE)
    // =========================================================================

    // Lane A: diamond owner operations
    //
    // All config transactions are sent with pre-allocated nonces without
    // waiting for intermediate confirmations.  On chains with slow block
    // times (e.g. Hyperliquid ~60s big blocks) this collapses 4-5
    // sequential blocks into 1-2, cutting ~4 min down to ~1-2 min.
    const laneA = async () => {
      laneLog('A', 'Starting lane', 'start', `signer=${shortAddr(ownerAddress)}`);
      const laneAStart = Date.now();

      type PendingTx = {
        label: string;
        logKey: string;
        tx: ethers.TransactionResponse;
        sentAt: number;
        successDetail?: string;
        extra?: Record<string, any>;
        onMined?: () => void;
      };
      const pending: PendingTx[] = [];

      // 1. Allow orderbook on registry (requires diamond owner / ADMIN_PRIVATE_KEY)
      if (needRegistryAllow) {
        try {
          laneLog('A', 'Allow orderbook on registry', 'start');
          const registry = new ethers.Contract(registryAddress, regAbi, wallet);
          const ov = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
          const txAllow = await registry.setAllowedOrderbook(orderBook, true, ov as any);
          const sentAt = Date.now();
          laneLog('A', 'Allow orderbook on registry', 'start', `tx sent ${shortTx(txAllow.hash)} +${sentAt - laneAStart}ms`);
          logS('attach_session_registry_sent', 'success', { tx: txAllow.hash, action: 'allow_orderbook', elapsedMs: sentAt - laneAStart });
          pending.push({
            label: 'Allow orderbook on registry', logKey: 'session_registry_allow', tx: txAllow, sentAt,
            onMined: () => { configState.session_registry_attached = true; },
          });
        } catch (e: any) {
          laneLog('A', 'Allow orderbook on registry', 'error', e?.shortMessage || e?.message || String(e));
          logS('attach_session_registry', 'error', { error: e?.message || String(e), action: 'allow_orderbook' });
        }
      }

      // 2. Attach session registry on MetaTradeFacet (diamond owner only)
      if (needRegistryAttach) {
        try {
          laneLog('A', 'Attach session registry', 'start', shortAddr(registryAddress));
          logS('attach_session_registry', 'start', { orderBook, registry: registryAddress });
          const meta = new ethers.Contract(orderBook, (MetaTradeFacetArtifact as any).abi, wallet);
          const ov = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
          const txSet = await meta.setSessionRegistry(registryAddress, ov);
          const sentAt = Date.now();
          laneLog('A', 'Attach session registry', 'start', `tx sent ${shortTx(txSet.hash)} +${sentAt - laneAStart}ms`);
          logS('attach_session_registry_sent', 'success', { tx: txSet.hash, action: 'set_session_registry', elapsedMs: sentAt - laneAStart });
          pending.push({
            label: 'Attach session registry', logKey: 'session_registry_attach', tx: txSet, sentAt,
            onMined: () => { configState.session_registry_attached = true; },
          });
        } catch (e: any) {
          laneLog('A', 'Attach session registry', 'error', e?.shortMessage || e?.message || String(e));
          logS('attach_session_registry', 'error', { error: e?.message || String(e), action: 'set_session_registry' });
        }
      }

      // 3. Configure fees from FeeRegistry (centralized) or fallback to env/defaults
      if (needFees) {
        const feeRegistryAddress = process.env.FEE_REGISTRY_ADDRESS || (process.env as any).NEXT_PUBLIC_FEE_REGISTRY_ADDRESS || '';
        let takerFeeBps = 7;
        let makerFeeBps = 3;
        let protocolFeeRecipient = process.env.PROTOCOL_FEE_RECIPIENT || (process.env as any).NEXT_PUBLIC_PROTOCOL_FEE_RECIPIENT || '';
        let protocolFeeShareBps = 8000;

        // Read from FeeRegistry if configured
        if (feeRegistryAddress && ethers.isAddress(feeRegistryAddress)) {
          try {
            laneLog('A', 'Read fee registry', 'start', shortAddr(feeRegistryAddress));
            logS('read_fee_registry', 'start', { feeRegistry: feeRegistryAddress });
            const feeRegistry = new ethers.Contract(feeRegistryAddress, FeeRegistryABI, provider);
            const [regTakerBps, regMakerBps, regProtocolRecipient, regProtocolShareBps] = await feeRegistry.getFeeStructure();
            takerFeeBps = Number(regTakerBps);
            makerFeeBps = Number(regMakerBps);
            protocolFeeRecipient = regProtocolRecipient;
            protocolFeeShareBps = Number(regProtocolShareBps);
            laneLog('A', 'Read fee registry', 'success', `taker=${takerFeeBps} maker=${makerFeeBps} share=${protocolFeeShareBps}`);
            logS('read_fee_registry', 'success', { takerFeeBps, makerFeeBps, protocolFeeRecipient: shortAddr(protocolFeeRecipient), protocolFeeShareBps });
          } catch (e: any) {
            laneLog('A', 'Read fee registry', 'error', `${e?.message || String(e)} — using defaults`);
            logS('read_fee_registry', 'error', { error: e?.message || String(e), fallback: 'using defaults' });
          }
        }

        // For rollovers, use the existing feeRecipient if provided
        if (isRollover && feeRecipient && ethers.isAddress(feeRecipient)) {
          protocolFeeRecipient = feeRecipient;
        }
        const creatorAddr = isRollover && feeRecipient && ethers.isAddress(feeRecipient)
          ? feeRecipient : (creatorWalletAddress || ownerAddress);

        if (!configState.fees_configured && protocolFeeRecipient && ethers.isAddress(protocolFeeRecipient)) {
          try {
            laneLog('A', 'Configure fee structure', 'start', `taker=${takerFeeBps} maker=${makerFeeBps} share=${protocolFeeShareBps}`);
            logS('configure_fees', 'start', { orderBook, takerFeeBps, makerFeeBps, protocolFeeShareBps });
            const obFee = new ethers.Contract(orderBook,
              ['function updateFeeStructure(uint256,uint256,address,uint256) external'], wallet);
            const feeTx = await obFee.updateFeeStructure(takerFeeBps, makerFeeBps, protocolFeeRecipient, protocolFeeShareBps, await nonceMgr.nextOverrides());
            const sentAt = Date.now();
            laneLog('A', 'Configure fee structure', 'start', `tx sent ${shortTx(feeTx.hash)} +${sentAt - laneAStart}ms`);
            logS('configure_fees_sent', 'success', { tx: feeTx.hash, elapsedMs: sentAt - laneAStart });
            pending.push({
              label: 'Configure fee structure', logKey: 'configure_fees', tx: feeTx, sentAt,
              onMined: () => { configState.fees_configured = { tx: feeTx.hash }; },
            });
          } catch (e: any) {
            laneLog('A', 'Configure fee structure', 'error', e?.message || String(e));
            logS('configure_fees', 'error', { error: e?.message || String(e) });
          }
        }

        if (!configState.fee_recipient_set) {
          try {
            laneLog('A', 'Set fee recipient', 'start', shortAddr(creatorAddr));
            logS('set_fee_recipient', 'start', { orderBook, creator: creatorAddr });
            const obTrade = new ethers.Contract(orderBook, [
              'function updateTradingParameters(uint256,uint256,address) external',
            ], wallet);
            const [marginBps, tradingFee] = tradingParams;
            const recipientTx = await obTrade.updateTradingParameters(marginBps, tradingFee, creatorAddr, await nonceMgr.nextOverrides());
            const sentAt = Date.now();
            laneLog('A', 'Set fee recipient', 'start', `tx sent ${shortTx(recipientTx.hash)} +${sentAt - laneAStart}ms`);
            logS('set_fee_recipient_sent', 'success', { tx: recipientTx.hash, elapsedMs: sentAt - laneAStart });
            pending.push({
              label: 'Set fee recipient', logKey: 'set_fee_recipient', tx: recipientTx, sentAt,
              successDetail: `mined -> ${shortAddr(creatorAddr)}`,
              extra: { feeRecipient: creatorAddr },
              onMined: () => { configState.fee_recipient_set = { tx: recipientTx.hash }; },
            });
          } catch (e: any) {
            laneLog('A', 'Set fee recipient', 'error', e?.message || String(e));
            logS('set_fee_recipient', 'error', { error: e?.message || String(e) });
          }
        }
      }

      // 4. Initialize lifecycle controller with explicit timing
      if (settlementTs > 0 && !configState.lifecycle_initialized) {
        try {
          const hasExplicitTiming = speedRunConfig && speedRunConfig.rolloverLeadSeconds > 0 && speedRunConfig.challengeWindowSeconds > 0;
          const rolloverLead = hasExplicitTiming ? speedRunConfig.rolloverLeadSeconds : 0;
          const challengeWindow = hasExplicitTiming ? speedRunConfig.challengeWindowSeconds : 0;
          laneLog('A', 'Initialize lifecycle', 'start', `settlement=${settlementTs} rollover=${rolloverLead}s challenge=${challengeWindow}s`);
          logS('initialize_lifecycle', 'start', { settlementTs, rolloverLead, challengeWindow });
          const lcContract = new ethers.Contract(orderBook, [
            'function initializeLifecycleWithTiming(uint256 settlementTimestamp, address parent, bool devMode, uint256 rolloverLeadSeconds, uint256 challengeWindowSeconds) external',
          ], wallet);
          const ov = await nonceMgr.nextOverrides();
          const txInit = await lcContract.initializeLifecycleWithTiming(
            settlementTs, ethers.ZeroAddress, false,
            rolloverLead, challengeWindow, ov,
          );
          const sentAt = Date.now();
          laneLog('A', 'Initialize lifecycle', 'start', `tx sent ${shortTx(txInit.hash)} +${sentAt - laneAStart}ms`);
          logS('initialize_lifecycle_sent', 'success', { tx: txInit.hash, elapsedMs: sentAt - laneAStart });
          pending.push({
            label: 'Initialize lifecycle', logKey: 'initialize_lifecycle', tx: txInit, sentAt,
            onMined: () => { configState.lifecycle_initialized = true; configState.speed_run_set = true; },
          });
        } catch (e: any) {
          laneLog('A', 'Initialize lifecycle', 'error', e?.shortMessage || e?.message || String(e));
          logS('initialize_lifecycle', 'error', { error: e?.message || String(e) });
        }
      }

      // Contract with ABIs for bond + operator configuration
      const criticalContract = new ethers.Contract(orderBook, [
        'function setChallengeBondConfig(uint256 bondAmount, address slashRecipient) external',
        'function getChallengeBondConfig() external view returns (uint256 bondAmount, address slashRecipient)',
        'function setLifecycleOperatorBatch(address[] operators, bool authorized) external',
        'function setProposalBondExemptBatch(address[] accounts, bool exempt) external',
        'function isLifecycleOperator(address account) external view returns (bool)',
      ], wallet);

      // 5. Configure challenge bond
      {
        const CHALLENGE_BOND_USDC = 500_000_000; // 500 USDC (6 decimals)
        const CHALLENGE_SLASH_RECIPIENT = '0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306';
        try {
          laneLog('A', 'Challenge bond config', 'start', `bond=${CHALLENGE_BOND_USDC / 1e6} USDC`);
          const bondTx = await criticalContract.setChallengeBondConfig(CHALLENGE_BOND_USDC, CHALLENGE_SLASH_RECIPIENT, await nonceMgr.nextOverrides());
          const sentAt = Date.now();
          laneLog('A', 'Challenge bond config', 'start', `tx sent ${shortTx(bondTx.hash)} +${sentAt - laneAStart}ms`);
          logS('challenge_bond_config_sent', 'start', { tx: bondTx.hash, bondUsdc: 500, market: orderBook });
          pending.push({ label: 'Challenge bond config', logKey: 'challenge_bond_config', tx: bondTx, sentAt, extra: { bondUsdc: 500, slashRecipient: CHALLENGE_SLASH_RECIPIENT, market: orderBook } });
        } catch (e: any) {
          laneLog('A', 'Challenge bond config', 'error', e?.shortMessage || e?.message || String(e));
          logS('challenge_bond_config', 'error', { error: e?.message || String(e), market: orderBook });
        }
      }

      // 6. Register lifecycle operators + grant bond exemptions
      {
        const { loadRelayerPoolFromEnv } = await import('@/lib/relayerKeys');
        let relayerKeys = loadRelayerPoolFromEnv({ pool: 'challenge', jsonEnv: 'RELAYER_PRIVATE_KEYS_CHALLENGE_JSON', allowFallbackSingleKey: false });
        if (!relayerKeys.length) relayerKeys = loadRelayerPoolFromEnv({ pool: 'global_for_ops', globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON', allowFallbackSingleKey: true, excludeJsonEnvs: ['RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON'] });
        const operatorAddrs = relayerKeys.map((k) => k.address);

        if (operatorAddrs.length > 0) {
          try {
            laneLog('A', 'Lifecycle operators', 'start', `${operatorAddrs.length} relayer(s)`);
            const opTx = await criticalContract.setLifecycleOperatorBatch(operatorAddrs, true, await nonceMgr.nextOverrides());
            const sentAt = Date.now();
            laneLog('A', 'Lifecycle operators', 'start', `tx sent ${shortTx(opTx.hash)} +${sentAt - laneAStart}ms`);
            logS('lifecycle_operators_sent', 'start', { tx: opTx.hash, count: operatorAddrs.length, market: orderBook });
            pending.push({ label: 'Lifecycle operators', logKey: 'lifecycle_operators', tx: opTx, sentAt, extra: { count: operatorAddrs.length, market: orderBook } });
          } catch (e: any) {
            laneLog('A', 'Lifecycle operators', 'error', e?.shortMessage || e?.message || String(e));
            logS('lifecycle_operators', 'error', { error: e?.message || String(e), market: orderBook });
          }

          try {
            const exemptTx = await criticalContract.setProposalBondExemptBatch(operatorAddrs, true, await nonceMgr.nextOverrides());
            const sentAt = Date.now();
            laneLog('A', 'Bond exemptions', 'start', `tx sent ${shortTx(exemptTx.hash)} +${sentAt - laneAStart}ms`);
            logS('bond_exempt_sent', 'start', { tx: exemptTx.hash, count: operatorAddrs.length, market: orderBook });
            pending.push({ label: 'Bond exemptions', logKey: 'bond_exempt', tx: exemptTx, sentAt, extra: { count: operatorAddrs.length, market: orderBook } });
          } catch (e: any) {
            laneLog('A', 'Bond exemptions', 'error', e?.shortMessage || e?.message || String(e));
            logS('bond_exempt', 'error', { error: e?.message || String(e), market: orderBook });
          }
        } else {
          laneLog('A', 'Lifecycle operators', 'error', 'NO RELAYER KEYS FOUND — gasless challenges will use admin fallback');
          logS('lifecycle_operators', 'skipped', { reason: 'no relayer keys found', market: orderBook });
        }
      }

      // ── All txs sent — log summary before waiting for confirmations ──
      const allSentAt = Date.now();
      const sentSummary = pending.map((p) => ({ label: p.label, tx: shortTx(p.tx.hash), sentAt: `+${p.sentAt - laneAStart}ms` }));
      console.log(`\n[LANE A] ✅ ALL ${pending.length} TXS SENT in ${allSentAt - laneAStart}ms — waiting for confirmations`);
      console.table(sentSummary);
      logS('lane_a_all_txs_sent', 'success', { count: pending.length, sendDurationMs: allSentAt - laneAStart, txs: sentSummary });

      // Wait for ALL transactions to mine in parallel
      if (pending.length > 0) {
        laneLog('A', 'Awaiting confirmations', 'start', `${pending.length} pending txs`);
        const results = await Promise.allSettled(
          pending.map(({ label, logKey, tx, sentAt, successDetail, extra, onMined }) =>
            tx.wait()
              .then((receipt: any) => {
                const minedAt = Date.now();
                laneLog('A', label, 'success', `${successDetail || 'mined'} +${minedAt - laneAStart}ms (wait: ${minedAt - sentAt}ms)`);
                logS(`${logKey}_mined`, 'success', { tx: receipt?.hash || tx.hash, elapsedMs: minedAt - laneAStart, waitMs: minedAt - sentAt, ...(extra || {}) });
                onMined?.();
              })
              .catch((e: any) => {
                laneLog('A', label, 'error', e?.message || String(e));
                logS(logKey, 'error', { error: e?.message || String(e) });
              })
          ),
        );
        const confirmDone = Date.now();
        const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
        const rejected = results.filter((r) => r.status === 'rejected').length;
        console.log(`[LANE A] Confirmations done: ${fulfilled}/${pending.length} ok, ${rejected} failed, total lane time: ${confirmDone - laneAStart}ms`);
        logS('lane_a_confirmations_done', 'success', { fulfilled, rejected, total: pending.length, totalLaneMs: confirmDone - laneAStart });
      }

      // Verify: challenge bond read-back
      try {
        const [bondAmt, slashAddr] = await criticalContract.getChallengeBondConfig();
        if (BigInt(bondAmt) > 0n && slashAddr !== ethers.ZeroAddress) {
          laneLog('A', 'Challenge bond VERIFIED', 'success', `bond=${Number(bondAmt) / 1e6} USDC`);
          logS('challenge_bond_verify', 'success', { bondAmount: bondAmt.toString(), slashRecipient: slashAddr, market: orderBook });
        } else {
          laneLog('A', 'Challenge bond MISSING', 'error', `bond=${bondAmt} slash=${slashAddr} — retrying`);
          logS('challenge_bond_verify', 'error', { bondAmount: bondAmt.toString(), market: orderBook });
          await nonceMgr.resync();
          const retryTx = await criticalContract.setChallengeBondConfig(500_000_000, '0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306', await nonceMgr.nextOverrides());
          await retryTx.wait();
          laneLog('A', 'Challenge bond retry', 'success', 'confirmed');
        }
      } catch (e: any) {
        laneLog('A', 'Challenge bond verify', 'error', e?.message || String(e));
        logS('challenge_bond_verify', 'error', { critical: true, error: e?.message, market: orderBook });
      }

      await checkpointConfigure(supabase, draftId, configState);
      laneLog('A', 'Lane complete', 'success', `total: ${Date.now() - laneAStart}ms`);
    };

    // Lane B: vault admin operations (CoreVault role grants)
    const laneB = async () => {
      laneLog('B', 'Starting lane', 'start', `signer=${shortAddr(vaultAddr)}`);

      if (needRoles) {
        laneLog('B', 'Grant CoreVault roles', 'start', shortAddr(effectiveCoreVaultAddress));
        logS('grant_roles', 'start', { coreVault: effectiveCoreVaultAddress, orderBook });
        
        // Check which wallet has DEFAULT_ADMIN_ROLE - vault admin may not have it
        const DEFAULT_ADMIN_ROLE = ethers.ZeroHash; // 0x00...00
        const vaultReadOnly = new ethers.Contract(effectiveCoreVaultAddress, CoreVaultABI as any, provider);
        const [adminHasRole, vaultAdminHasRole] = await Promise.all([
          vaultReadOnly.hasRole(DEFAULT_ADMIN_ROLE, ownerAddress).catch(() => false),
          vaultReadOnly.hasRole(DEFAULT_ADMIN_ROLE, vaultAddr).catch(() => false),
        ]);
        
        // Use whichever wallet has admin role (prefer vault wallet for parallelism)
        const roleGranterWallet = vaultAdminHasRole ? vaultWallet : (adminHasRole ? wallet : vaultWallet);
        const roleGranterNonceMgr = vaultAdminHasRole ? vaultNonceMgr : (adminHasRole ? nonceMgr : vaultNonceMgr);
        const roleGranterAddr = await roleGranterWallet.getAddress();
        
        if (!vaultAdminHasRole && adminHasRole) {
          laneLog('B', 'Role granter override', 'start', `vaultAdmin lacks DEFAULT_ADMIN_ROLE, using admin ${shortAddr(roleGranterAddr)}`);
          logS('grant_roles_wallet_override', 'success', { 
            vaultAdminHasRole, adminHasRole, 
            using: roleGranterAddr,
            reason: 'vaultAdmin lacks DEFAULT_ADMIN_ROLE' 
          });
        }
        
        const coreVault = new ethers.Contract(effectiveCoreVaultAddress, CoreVaultABI as any, roleGranterWallet);
        const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
        const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));

        const sendRoleWithRetry = async (
          roleName: string, roleHash: string, maxRetries = 3,
        ): Promise<ethers.TransactionResponse> => {
          let gasBumpMultiplier = 1n;
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              // Always resync nonce before each attempt - the wallet may be used
              // concurrently by other jobs, causing stale nonces even on first try
              await roleGranterNonceMgr.resync();
              const baseOv = await roleGranterNonceMgr.nextOverrides();
              // Apply gas bump if this is a retry due to replacement underpriced
              const ov = gasBumpMultiplier > 1n ? {
                ...baseOv,
                maxFeePerGas: baseOv.maxFeePerGas ? baseOv.maxFeePerGas * gasBumpMultiplier : undefined,
                maxPriorityFeePerGas: baseOv.maxPriorityFeePerGas ? baseOv.maxPriorityFeePerGas * gasBumpMultiplier : undefined,
                gasPrice: baseOv.gasPrice ? baseOv.gasPrice * gasBumpMultiplier : undefined,
              } : baseOv;
              const tx = await coreVault.grantRole(roleHash, orderBook, ov);
              laneLog('B', roleName, 'start', `tx sent ${shortTx(tx.hash)}${attempt > 1 ? ` (retry ${attempt})` : ''}`);
              logS(`grant_${roleName}_sent`, 'success', { tx: tx.hash, attempt, granter: roleGranterAddr });
              return tx;
            } catch (e: any) {
              const msg = e?.shortMessage || e?.error?.message || e?.message || String(e);
              const code = e?.error?.code ?? e?.code;
              const isNonceError = /nonce.*too low|nonce.*already.*used|NONCE_EXPIRED/i.test(msg);
              const isReplacementError = /replacement.*underpriced|REPLACEMENT_UNDERPRICED|replacement fee too low/i.test(msg) || code === 'REPLACEMENT_UNDERPRICED';
              const isAccessControlError = /AccessControl|e2517d3f|unauthorized/i.test(msg) || e?.data?.includes?.('e2517d3f');
              const isTransient =
                isNonceError ||
                isReplacementError ||
                code === -32100 ||
                code === 'UNKNOWN_ERROR' ||
                /unexpected error|timeout|ECONNRESET|ENOTFOUND|socket hang up|rate.?limit|ETIMEDOUT/i.test(msg);
              // Access control errors are not transient - fail fast
              if (isAccessControlError) {
                laneLog('B', roleName, 'error', `ACCESS DENIED: ${roleGranterAddr} lacks DEFAULT_ADMIN_ROLE on CoreVault`);
                throw new Error(`AccessControlUnauthorizedAccount: ${roleGranterAddr} cannot grant roles on CoreVault ${effectiveCoreVaultAddress}`);
              }
              if (!isTransient || attempt === maxRetries) throw e;
              // Bump gas price for replacement errors (need 10%+ increase to replace pending tx)
              if (isReplacementError) gasBumpMultiplier = gasBumpMultiplier === 1n ? 2n : gasBumpMultiplier + 1n;
              laneLog('B', roleName, 'error', `send failed (attempt ${attempt}/${maxRetries}): ${msg}`);
              logS(`grant_${roleName}_retry`, 'error', { attempt, maxRetries, error: msg, isNonceError, isReplacementError, gasBump: Number(gasBumpMultiplier) });
              await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
          }
          throw new Error(`${roleName} grant failed after ${maxRetries} retries`);
        };

        const tx1 = await sendRoleWithRetry('ORDERBOOK_ROLE', ORDERBOOK_ROLE);
        const tx2 = await sendRoleWithRetry('SETTLEMENT_ROLE', SETTLEMENT_ROLE);

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
              challengeWindowSeconds: speedRunConfig.challengeWindowSeconds,
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
                  challenge_open_at: newSettlementUnix,
                  settlement_trigger_at: newSettlementUnix,
                  finalize_trigger_at: newSettlementUnix + speedRunConfig.challengeWindowSeconds,
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
