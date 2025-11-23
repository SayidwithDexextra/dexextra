import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { archivePage } from '@/lib/archivePage';
import {
  OBAdminFacetABI,
  OBPricingFacetABI,
  OBOrderPlacementFacetABI,
  OBTradeExecutionFacetABI,
  OBLiquidationFacetABI,
  OBViewFacetABI,
  OBSettlementFacetABI,
  CoreVaultABI,
} from '@/lib/contracts';
import { MarketLifecycleFacetABI } from '@/lib/contracts';
import MarketLifecycleFacetArtifact from '@/lib/abis/facets/MarketLifecycleFacet.json';
import MetaTradeFacetArtifact from '@/lib/abis/facets/MetaTradeFacet.json';
import { getPusherServer } from '@/lib/pusher-server';

function shortAddr(a: any) {
  const s = String(a || '');
  return (s.startsWith('0x') && s.length === 42) ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function trunc(s: any, n = 120) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function friendly(step: string) {
  const map: Record<string, string> = {
    validate_input: 'Validate Input',
    wallet_ready: 'Wallet Ready',
    facet_cut_built: 'Build Diamond Cut',
    factory_static_call: 'Factory Static Call',
    factory_send_tx_prep: 'Prepare Tx',
    factory_send_tx: 'Send Tx',
    factory_send_tx_sent: 'Tx Sent',
    factory_confirm: 'Confirm Tx',
    factory_confirm_mined: 'Mined',
    factory_static_call_meta: 'Factory Static Call (Meta)',
    factory_send_tx_meta: 'Send Tx (Meta)',
    factory_send_tx_meta_sent: 'Tx Sent (Meta)',
    factory_confirm_meta: 'Confirm (Meta)',
    factory_confirm_meta_mined: 'Mined (Meta)',
    ensure_selectors: 'Ensure Placement Selectors',
    ensure_selectors_missing: 'Patch Missing Selectors',
    diamond_cut: 'Diamond Cut',
    attach_session_registry: 'Attach Session Registry',
    attach_session_registry_sent: 'Attach Session Registry (Sent)',
    attach_session_registry_mined: 'Attach Session Registry (Mined)',
    grant_roles: 'Grant CoreVault Roles',
    grant_ORDERBOOK_ROLE_sent: 'Grant ORDERBOOK_ROLE (Sent)',
    grant_ORDERBOOK_ROLE_mined: 'Grant ORDERBOOK_ROLE (Mined)',
    grant_SETTLEMENT_ROLE_sent: 'Grant SETTLEMENT_ROLE (Sent)',
    grant_SETTLEMENT_ROLE_mined: 'Grant SETTLEMENT_ROLE (Mined)',
    // Removed: configure_market and immediate OB param updates to speed deploys
    save_market: 'Save Market (DB)',
    unhandled_error: 'Unhandled Error',
  };
  return map[step] || step;
}

function summarizeData(data?: Record<string, any>) {
  if (!data || typeof data !== 'object') return '';
  const parts: string[] = [];
  if (data.orderBook) parts.push(`orderBook=${shortAddr(data.orderBook)}`);
  if (data.marketId) parts.push(`marketId=${trunc(data.marketId, 12)}`);
  if (data.hash) parts.push(`tx=${trunc(data.hash, 12)}`);
  if (data.block != null || data.blockNumber != null) parts.push(`block=${data.block ?? data.blockNumber}`);
  if (data.missingCount != null) parts.push(`missing=${data.missingCount}`);
  if (data.nonce != null) parts.push(`nonce=${data.nonce}`);
  if (Array.isArray((data as any).cutSummary)) parts.push(`facets=${(data as any).cutSummary.length}`);
  if ((data as any).balanceEth != null) parts.push(`bal=${(data as any).balanceEth}`);
  if (data.error) parts.push(`error=${trunc(data.error, 100)}`);
  return parts.length ? ` — ${parts.join(' ')}` : '';
}

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
};

function logStep(step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) {
  try {
    const ts = new Date().toISOString();
    const tag = `${COLORS.bold}${COLORS.cyan}[CreateMarket]${COLORS.reset}`;
    const name = friendly(step);
    const emoji = status === 'start' ? '🟦' : status === 'success' ? '✅' : '❌';
    const color =
      status === 'start' ? COLORS.yellow :
      status === 'success' ? COLORS.green :
      COLORS.red;
    const human = `${tag} ${emoji} ${color}${name}${COLORS.reset}${summarizeData(data)}  ${COLORS.dim}${ts}${COLORS.reset}`;
    // Human-friendly line
    console.log(human);
    // Structured line (machine-readable)
    console.log(JSON.stringify({
      area: 'market_creation',
      context: 'markets_create',
      step,
      status,
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

function selectorsFromAbi(abi: any[]): string[] {
  try {
    const iface = new ethers.Interface(abi as any);
    return (iface.fragments as any[])
      .filter((frag) => frag?.type === 'function')
      .map((frag) => ethers.id((frag as any).format('sighash')).slice(0, 10));
  } catch (e: any) {
    try {
      return (abi || [])
        .filter((f: any) => f && typeof f === 'object' && f.type === 'function')
        .map((f: any) => {
          const sig = `${f.name}(${(f.inputs || []).map((i: any) => i.type).join(',')})`;
          return ethers.id(sig).slice(0, 10);
        });
    } catch {
      return [];
    }
  }
}

function loadFacetAbi(contractName: string, fallbackAbi: any[]): any[] {
  try {
    const artifactPath = path.join(
      process.cwd(),
      'Dexetrav5',
      'artifacts',
      'src',
      'diamond',
      'facets',
      `${contractName}.sol`,
      `${contractName}.json`
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const artifact = require(artifactPath);
    if (artifact && Array.isArray(artifact.abi)) return artifact.abi;
  } catch {}
  return fallbackAbi;
}

async function getTxOverrides(provider: ethers.Provider) {
  try {
    const fee = await provider.getFeeData();
    const minPriority = ethers.parseUnits('2', 'gwei');
    const minMax = ethers.parseUnits('20', 'gwei');
    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
      const maxPriority = fee.maxPriorityFeePerGas > minPriority ? fee.maxPriorityFeePerGas : minPriority;
      let maxFee = fee.maxFeePerGas + maxPriority;
      if (maxFee < minMax) maxFee = minMax;
      return { maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPriority } as const;
    }
    const base = fee.gasPrice || ethers.parseUnits('10', 'gwei');
    const bumped = (base * 12n) / 10n; // +20%
    const minLegacy = ethers.parseUnits('20', 'gwei');
    return { gasPrice: bumped > minLegacy ? bumped : minLegacy } as const;
  } catch {
    return { gasPrice: ethers.parseUnits('20', 'gwei') } as const;
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
    }
  } as const;
}

function extractError(e: any) {
  try {
    return (
      e?.shortMessage ||
      e?.reason ||
      e?.error?.message ||
      (typeof e?.data === 'string' ? e.data : undefined) ||
      (typeof e?.info?.error?.data === 'string' ? e.info.error.data : undefined) ||
      e?.message ||
      String(e)
    );
  } catch {
    return String(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const pipelineId = typeof body?.pipelineId === 'string' ? String(body.pipelineId) : '';
    const pusher = pipelineId ? getPusherServer() : null;
    const pusherChannel = pipelineId ? `deploy-${pipelineId}` : '';
    const logS = (step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) => {
      logStep(step, status, data);
      if (pusher && pusherChannel) {
        try {
          (pusher as any)['pusher'].trigger(pusherChannel, 'progress', {
            step, status, data: data || {}, timestamp: new Date().toISOString(),
          });
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn('[create/route] pusher broadcast failed', e?.message || String(e));
        }
      }
    };
    const rawSymbol = String(body?.symbol || '').trim();
    const symbol = rawSymbol.toUpperCase();
    const metricUrl = String(body?.metricUrl || '').trim();
    const startPrice = String(body?.startPrice || '1');
    const dataSource = String(body?.dataSource || 'User Provided');
    const tags = Array.isArray(body?.tags) ? body.tags.slice(0, 10).map((t: any) => String(t)) : [];
    const creatorWalletAddress = (body?.creatorWalletAddress && ethers.isAddress(body.creatorWalletAddress)) ? body.creatorWalletAddress : null;
    const clientCutArg = Array.isArray(body?.cutArg) ? body.cutArg : (Array.isArray(body?.cut) ? body.cut : null);
    const iconImageUrl = body?.iconImageUrl ? String(body.iconImageUrl).trim() : null;
    const aiSourceLocator = body?.aiSourceLocator || null;
    const settlementTs = typeof body?.settlementDate === 'number' && body.settlementDate > 0
      ? Math.floor(body.settlementDate)
      : Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

    logS('validate_input', 'start');
    if (!symbol) return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
    if (!metricUrl) return NextResponse.json({ error: 'Metric URL is required' }, { status: 400 });
    logS('validate_input', 'success');

    // Env configuration
    const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL;
    // Use ADMIN wallet specifically for factory creation (gasless or legacy)
    const pk = process.env.ADMIN_PRIVATE_KEY || process.env.ROLE_ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY;
    const factoryAddress = process.env.FUTURES_MARKET_FACTORY_ADDRESS || (process.env as any).NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS;
    const initFacet = process.env.ORDER_BOOK_INIT_FACET || (process.env as any).NEXT_PUBLIC_ORDER_BOOK_INIT_FACET;
    const adminFacet = process.env.OB_ADMIN_FACET || (process.env as any).NEXT_PUBLIC_OB_ADMIN_FACET;
    const pricingFacet = process.env.OB_PRICING_FACET || (process.env as any).NEXT_PUBLIC_OB_PRICING_FACET;
    const placementFacet = process.env.OB_ORDER_PLACEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET;
    const execFacet = process.env.OB_TRADE_EXECUTION_FACET || (process.env as any).NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET;
    const liqFacet = process.env.OB_LIQUIDATION_FACET || (process.env as any).NEXT_PUBLIC_OB_LIQUIDATION_FACET;
    const viewFacet = process.env.OB_VIEW_FACET || (process.env as any).NEXT_PUBLIC_OB_VIEW_FACET;
    const settleFacet = process.env.OB_SETTLEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_SETTLEMENT_FACET;
    const lifecycleFacet = process.env.MARKET_LIFECYCLE_FACET || (process.env as any).NEXT_PUBLIC_MARKET_LIFECYCLE_FACET;
    const metaTradeFacet = process.env.META_TRADE_FACET || (process.env as any).NEXT_PUBLIC_META_TRADE_FACET;
    const coreVaultAddress = process.env.CORE_VAULT_ADDRESS || (process.env as any).NEXT_PUBLIC_CORE_VAULT_ADDRESS;

    if (!rpcUrl) return NextResponse.json({ error: 'RPC_URL not configured' }, { status: 400 });
    if (!pk) return NextResponse.json({ error: 'ADMIN_PRIVATE_KEY not configured' }, { status: 400 });
    if (!factoryAddress || !ethers.isAddress(factoryAddress)) return NextResponse.json({ error: 'Factory address not configured' }, { status: 400 });
    if (!initFacet || !ethers.isAddress(initFacet)) return NextResponse.json({ error: 'Init facet address not configured' }, { status: 400 });
    if (!adminFacet || !pricingFacet || !placementFacet || !execFacet || !liqFacet || !viewFacet || !settleFacet || !lifecycleFacet || !metaTradeFacet) {
      return NextResponse.json({ error: 'One or more facet addresses are missing' }, { status: 400 });
    }
    if (!coreVaultAddress || !ethers.isAddress(coreVaultAddress)) {
      return NextResponse.json({ error: 'CoreVault address not configured' }, { status: 400 });
    }

    // Provider and signer
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    const nonceMgr = await createNonceManager(wallet);
    const ownerAddress = await wallet.getAddress();
    try {
      const [net, bal] = await Promise.all([
        provider.getNetwork(),
        provider.getBalance(ownerAddress),
      ]);
      const balanceEth = ethers.formatEther(bal);
      logS('wallet_ready', 'success', { ownerAddress, chainId: Number(net.chainId), balanceWei: bal.toString(), balanceEth });
    } catch {
      logS('wallet_ready', 'success', { ownerAddress });
    }

    // Load ABIs (prefer compiled artifacts to prevent selector drift)
    const adminAbi = loadFacetAbi('OBAdminFacet', OBAdminFacetABI as any[]);
    const pricingAbi = loadFacetAbi('OBPricingFacet', OBPricingFacetABI as any[]);
    const placementAbi = loadFacetAbi('OBOrderPlacementFacet', OBOrderPlacementFacetABI as any[]);
    const execAbi = loadFacetAbi('OBTradeExecutionFacet', OBTradeExecutionFacetABI as any[]);
    const liqAbi = loadFacetAbi('OBLiquidationFacet', OBLiquidationFacetABI as any[]);
    const viewAbi = loadFacetAbi('OBViewFacet', OBViewFacetABI as any[]);
    const settleAbi = loadFacetAbi('OBSettlementFacet', OBSettlementFacetABI as any[]);
    const lifecycleAbi = loadFacetAbi('MarketLifecycleFacet', (MarketLifecycleFacetArtifact as any)?.abi || (MarketLifecycleFacetABI as any[]));
    const metaFacetAbi = (MetaTradeFacetArtifact as any)?.abi || [];

    let cut = [
      { facetAddress: adminFacet, action: 0, functionSelectors: selectorsFromAbi(adminAbi) },
      { facetAddress: pricingFacet, action: 0, functionSelectors: selectorsFromAbi(pricingAbi) },
      { facetAddress: placementFacet, action: 0, functionSelectors: selectorsFromAbi(placementAbi) },
      { facetAddress: execFacet, action: 0, functionSelectors: selectorsFromAbi(execAbi) },
      { facetAddress: liqFacet, action: 0, functionSelectors: selectorsFromAbi(liqAbi) },
      { facetAddress: viewFacet, action: 0, functionSelectors: selectorsFromAbi(viewAbi) },
      { facetAddress: settleFacet, action: 0, functionSelectors: selectorsFromAbi(settleAbi) },
      { facetAddress: lifecycleFacet, action: 0, functionSelectors: selectorsFromAbi(lifecycleAbi) },
      { facetAddress: metaTradeFacet, action: 0, functionSelectors: selectorsFromAbi(metaFacetAbi) },
    ];
  try {
    const cutSummary = cut.map((c) => ({ facetAddress: c.facetAddress, selectorCount: (c.functionSelectors || []).length }));
    logS('facet_cut_built', 'success', { cutSummary, cut });
  } catch {}
    const emptyFacets = cut.filter(c => !c.functionSelectors?.length).map(c => c.facetAddress);
    if (emptyFacets.length) {
      return NextResponse.json({ error: 'Facet selectors could not be built', emptyFacets }, { status: 500 });
    }
    let cutArg = cut.map((c) => [c.facetAddress, 0, c.functionSelectors]);

    // If client provided cutArg and gasless is enabled, prefer client order to ensure identical hashing/signature
    if (String(process.env.GASLESS_CREATE_ENABLED || '').toLowerCase() === 'true' && Array.isArray(clientCutArg)) {
      try {
        const normalized = (clientCutArg as any[]).map((e: any) => [e?.[0], Number(e?.[1] ?? 0), Array.isArray(e?.[2]) ? e[2] : []]);
        // Basic validation: addresses and selectors look sane
        const bad = normalized.find((e) => !e?.[0] || !ethers.isAddress(e[0]) || !Array.isArray(e[2]));
        if (!bad) {
          cutArg = normalized as any;
          // eslint-disable-next-line no-console
          console.log('[SIGNCHECK][server] usingClientCutArg', true, { entries: cutArg.length });
        }
      } catch {}
    }

    // Resolve factory
    const factoryArtifact = await import('@/lib/abis/FuturesMarketFactory.json');
    const baseFactoryAbi = (factoryArtifact as any)?.default?.abi || (factoryArtifact as any)?.abi || (factoryArtifact as any)?.default || (factoryArtifact as any);
    const gaslessEnabled = String(process.env.GASLESS_CREATE_ENABLED || '').toLowerCase() === 'true';
    const metaAbi = [
      'function metaCreateFuturesMarketDiamond(string,string,uint256,uint256,string,string[],address,(address,uint8,bytes4[])[],address,address,uint256,uint256,bytes) returns (address,bytes32)',
      'function metaCreateNonce(address) view returns (uint256)',
    ];
    const factoryAbi = Array.isArray(baseFactoryAbi) ? [...baseFactoryAbi, ...(gaslessEnabled ? metaAbi : [])] : (gaslessEnabled ? metaAbi : baseFactoryAbi);
    const factory = new ethers.Contract(factoryAddress, factoryAbi, wallet);

    // Params
    const startPrice6 = ethers.parseUnits(startPrice, 6);
    const feeRecipient = (body?.feeRecipient && ethers.isAddress(body.feeRecipient)) ? body.feeRecipient : (creatorWalletAddress || ownerAddress);

    // Preflight bytecode checks
    try {
      const [factoryCode, initCode, ...facetCodes] = await Promise.all([
        provider.getCode(factoryAddress),
        provider.getCode(initFacet),
        ...cutArg.map((c: any) => provider.getCode(c?.[0]))
      ]);
      const noFactory = !factoryCode || factoryCode === '0x' || factoryCode === '0x0';
      const noInit = !initCode || initCode === '0x' || initCode === '0x0';
      const badFacets = facetCodes.reduce((acc: number[], code: string, idx: number) => { if (!code || code === '0x' || code === '0x0') acc.push(idx); return acc; }, []);
      if (noFactory || noInit || badFacets.length) {
        return NextResponse.json({ error: 'One or more contract addresses have no bytecode', details: { noFactory, noInit, badFacets } }, { status: 400 });
      }
    } catch {}

    let tx: ethers.TransactionResponse;
    let receipt: ethers.TransactionReceipt | null;
    if (gaslessEnabled) {
      // Gasless via meta-create: require user signature
      const creator = creatorWalletAddress;
      if (!creator) {
        return NextResponse.json({ error: 'creatorWalletAddress required for gasless create' }, { status: 400 });
      }
      const signature = typeof body?.signature === 'string' ? String(body.signature) : null;
      const nonceStr = typeof body?.nonce !== 'undefined' ? String(body.nonce) : null;
      const deadlineStr = typeof body?.deadline !== 'undefined' ? String(body.deadline) : null;
      if (!signature || nonceStr == null || deadlineStr == null) {
        return NextResponse.json({ error: 'signature, nonce, and deadline required when GASLESS_CREATE_ENABLED' }, { status: 400 });
      }
      const nonce = BigInt(nonceStr);
      const deadline = BigInt(deadlineStr);

      // Build typed data and verify off-chain
      const net = await provider.getNetwork();
      const domain = {
        name: String(process.env.EIP712_FACTORY_DOMAIN_NAME || 'DexetraFactory'),
        version: String(process.env.EIP712_FACTORY_DOMAIN_VERSION || '1'),
        chainId: Number(net.chainId),
        verifyingContract: factoryAddress,
      } as const;
      // hash tags
      const tagsHash = ethers.keccak256(ethers.solidityPacked(new Array(tags.length).fill('string'), tags));
      // hash cut
      const perCutHashes: string[] = [];
      for (const c of cutArg) {
        const selectorsHash = ethers.keccak256(ethers.solidityPacked(new Array((c?.[2] || []).length).fill('bytes4'), c?.[2] || []));
        const enc = ethers.AbiCoder.defaultAbiCoder().encode(['address','uint8','bytes32'], [c?.[0], c?.[1], selectorsHash]);
        perCutHashes.push(ethers.keccak256(enc));
      }
      const cutHash = ethers.keccak256(ethers.solidityPacked(new Array(perCutHashes.length).fill('bytes32'), perCutHashes));
      const types = {
        MetaCreate: [
          { name: 'marketSymbol', type: 'string' },
          { name: 'metricUrl', type: 'string' },
          { name: 'settlementDate', type: 'uint256' },
          { name: 'startPrice', type: 'uint256' },
          { name: 'dataSource', type: 'string' },
          { name: 'tagsHash', type: 'bytes32' },
          { name: 'diamondOwner', type: 'address' },
          { name: 'cutHash', type: 'bytes32' },
          { name: 'initFacet', type: 'address' },
          { name: 'creator', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      } as const;
      const message = {
        marketSymbol: symbol,
        metricUrl,
        settlementDate: settlementTs,
        startPrice: startPrice6.toString(),
        dataSource,
        tagsHash,
        diamondOwner: ownerAddress,
        cutHash,
        initFacet,
        creator,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
      };
      try {
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] creator', creator);
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] factory', factoryAddress);
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] chainId', Number(net.chainId));
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] domain', domain);
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] hashes', { tagsHash, cutHash });
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] message', message);
      } catch {}
      try {
        const recovered = ethers.verifyTypedData(domain as any, types as any, message as any, signature);
        try {
          // eslint-disable-next-line no-console
          console.log('[SIGNCHECK][server] recovered', recovered);
        } catch {}
        if (!recovered || recovered.toLowerCase() !== creator.toLowerCase()) {
          return NextResponse.json({ error: 'bad_sig', recovered, expected: creator }, { status: 400 });
        }
      } catch (e: any) {
        return NextResponse.json({ error: 'verify_failed', details: e?.message || String(e) }, { status: 400 });
      }
      try {
        const onchainNonce = await factory.metaCreateNonce(creator);
        try {
          // eslint-disable-next-line no-console
          console.log('[SIGNCHECK][server] nonce', { provided: String(nonce), onchain: String(onchainNonce) });
        } catch {}
        if (String(onchainNonce) !== String(nonce)) {
          return NextResponse.json({ error: 'bad_nonce', expected: String(onchainNonce), got: String(nonce) }, { status: 400 });
        }
      } catch {}

      // Static call for revert reasons
      logS('factory_static_call_meta', 'start');
      try {
        await factory.getFunction('metaCreateFuturesMarketDiamond').staticCall(
          symbol,
          metricUrl,
          settlementTs,
          startPrice6,
          dataSource,
          tags,
          ownerAddress,
          cutArg,
          initFacet,
          creator,
          nonce,
          deadline,
          signature
        );
        logS('factory_static_call_meta', 'success');
      } catch (e: any) {
        const raw = e?.shortMessage || e?.reason || e?.message || 'static call failed (no reason)';
        const hint = 'Possible causes: restricted creation for creator; insufficient Vault balance for the creator; invalid facets/addresses; or network mismatch.';
        const msg = `${raw}`;
        logS('factory_static_call_meta', 'error', { error: msg, code: e?.code, hint });
        return NextResponse.json({ error: msg, hint }, { status: 400 });
      }

      // Send tx (relayer pays gas)
      logS('factory_send_tx_meta', 'start');
      const overrides = await nonceMgr.nextOverrides();
      logS('factory_send_tx_meta_prep', 'success', { nonce: (overrides as any)?.nonce, ...('maxFeePerGas' in overrides ? { maxFeePerGas: (overrides as any).maxFeePerGas?.toString?.() } : {}), ...('maxPriorityFeePerGas' in overrides ? { maxPriorityFeePerGas: (overrides as any).maxPriorityFeePerGas?.toString?.() } : {}), ...('gasPrice' in overrides ? { gasPrice: (overrides as any).gasPrice?.toString?.() } : {}) });
      tx = await factory.getFunction('metaCreateFuturesMarketDiamond')(
        symbol,
        metricUrl,
        settlementTs,
        startPrice6,
        dataSource,
        tags,
        ownerAddress,
        cutArg,
        initFacet,
        creator,
        nonce,
        deadline,
        signature,
        overrides as any
      );
      logS('factory_send_tx_meta_sent', 'success', { hash: tx.hash, nonce: (tx as any)?.nonce });
      logS('factory_confirm_meta', 'start');
      receipt = await tx.wait();
      logS('factory_confirm_meta_mined', 'success', { hash: receipt?.hash || tx.hash, block: receipt?.blockNumber });
    } else {
      // Legacy direct create (relayer submits and pays gas)
      // Static call for revert reasons
      logS('factory_static_call', 'start');
      try {
        await factory.getFunction('createFuturesMarketDiamond').staticCall(
          symbol,
          metricUrl,
          settlementTs,
          startPrice6,
          dataSource,
          tags,
          ownerAddress,
          cutArg,
          initFacet,
          '0x'
        );
        logS('factory_static_call', 'success');
      } catch (e: any) {
        const raw = e?.shortMessage || e?.reason || e?.message || 'static call failed (no reason)';
        const hint = 'Possible causes: public creation disabled; creation fee required without sufficient CoreVault balance for the Deployer; invalid facet/addresses; or network mismatch.';
        const msg = `${raw}`;
        logS('factory_static_call', 'error', { error: msg, code: e?.code, hint });
        return NextResponse.json({ error: msg, hint }, { status: 400 });
      }
      // Send tx
      logS('factory_send_tx', 'start');
      const overrides = await nonceMgr.nextOverrides();
      logS('factory_send_tx_prep', 'success', { nonce: (overrides as any)?.nonce, ...('maxFeePerGas' in overrides ? { maxFeePerGas: (overrides as any).maxFeePerGas?.toString?.() } : {}), ...('maxPriorityFeePerGas' in overrides ? { maxPriorityFeePerGas: (overrides as any).maxPriorityFeePerGas?.toString?.() } : {}), ...('gasPrice' in overrides ? { gasPrice: (overrides as any).gasPrice?.toString?.() } : {}) });
      tx = await factory.getFunction('createFuturesMarketDiamond')(
        symbol,
        metricUrl,
        settlementTs,
        startPrice6,
        dataSource,
        tags,
        ownerAddress,
        cutArg,
        initFacet,
        '0x',
        overrides as any
      );
      logS('factory_send_tx_sent', 'success', { hash: tx.hash, nonce: (tx as any)?.nonce });
      // Confirm
      logS('factory_confirm', 'start');
      receipt = await tx.wait();
      logS('factory_confirm_mined', 'success', { hash: receipt?.hash || tx.hash, block: receipt?.blockNumber });
    }

    // Confirm
    logS('factory_confirm', 'start');
    // Parse event
    const iface = new ethers.Interface(factoryAbi);
    let orderBook: string | null = null;
    let marketId: string | null = null;
    for (const log of (receipt as any)?.logs || []) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'FuturesMarketCreated') {
          orderBook = parsed.args?.orderBook as string;
          marketId = parsed.args?.marketId as string;
          break;
        }
      } catch {}
    }
    if (!orderBook || !marketId) return NextResponse.json({ error: 'Could not parse created market' }, { status: 500 });

  // Ensure required placement selectors exist on the Diamond (defensive)
  try {
    logS('ensure_selectors', 'start', { orderBook });
    const LoupeABI = ['function facetAddress(bytes4) view returns (address)'];
    const CutABI = [
      'function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)',
    ];
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
    const missing: string[] = [];
    for (const sel of requiredSelectors) {
      try {
        const addr: string = await loupe.facetAddress(sel);
        if (!addr || addr.toLowerCase() === '0x0000000000000000000000000000000000000000') {
          missing.push(sel);
        }
      } catch {
        missing.push(sel);
      }
    }
    if (missing.length > 0) {
      logS('ensure_selectors_missing', 'start', { missingCount: missing.length });
      const cut = [{ facetAddress: placementFacet, action: 0, functionSelectors: missing }];
      const ov = await nonceMgr.nextOverrides();
      const txCut = await diamondCut.diamondCut(cut as any, ethers.ZeroAddress, '0x', ov as any);
      logS('ensure_selectors_diamondCut_sent', 'success', { tx: txCut.hash });
      await txCut.wait();
      logS('ensure_selectors_diamondCut_mined', 'success');
    } else {
      logS('ensure_selectors', 'success', { message: 'All placement selectors present' });
    }
  } catch (e: any) {
    logS('ensure_selectors', 'error', { error: e?.message || String(e) });
  }

    // Allow new OrderBook on GlobalSessionRegistry and attach session registry for gasless
    try {
      const registryAddress =
        process.env.SESSION_REGISTRY_ADDRESS ||
        (process.env as any).NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS ||
        '';
      if (!registryAddress || !ethers.isAddress(registryAddress)) {
        logS('attach_session_registry', 'error', { error: 'Missing SESSION_REGISTRY_ADDRESS' });
      } else {
        // Prefer a dedicated registry-owner signer if provided
        const registryPk =
          process.env.SESSION_REGISTRY_OWNER_PRIVATE_KEY ||
          (process.env as any).REGISTRY_OWNER_PRIVATE_KEY ||
          process.env.RELAYER_PRIVATE_KEY || // fallback (may not have permission)
          (process.env as any).NEXT_PUBLIC_RELAYER_PRIVATE_KEY ||
          (process.env as any).NEXT_PUBLIC_SESSION_REGISTRY_OWNER_PRIVATE_KEY ||
          (process.env as any).NEXT_PUBLIC_REGISTRY_OWNER_PRIVATE_KEY ||
          (process.env as any).REGISTRY_SIGNER_PRIVATE_KEY ||
          (process.env as any).REGISTRY_SIGNER_PK ||
          (process.env as any).SESSION_REGISTRY_SIGNER_PRIVATE_KEY ||
          (process.env as any).SESSION_REGISTRY_SIGNER_PK ||
          null;
        const regWallet = registryPk ? new ethers.Wallet(registryPk, provider) : wallet;
        const regNonceMgr = await createNonceManager(regWallet as any);
        try { logS('attach_session_registry', 'start', { registrySigner: await (regWallet as any).getAddress?.() }); } catch {}

        // 1) Ensure this OrderBook is allowed in the registry
        try {
          const regAbi = [
            'function allowedOrderbook(address) view returns (bool)',
            'function setAllowedOrderbook(address,bool) external',
          ];
          const registry = new ethers.Contract(registryAddress, regAbi, regWallet);
          const allowed: boolean = await registry.allowedOrderbook(orderBook);
          if (!allowed) {
            const ovAllow = await regNonceMgr.nextOverrides();
            const txAllow = await registry.setAllowedOrderbook(orderBook, true, ovAllow as any);
            logS('attach_session_registry_sent', 'success', { tx: txAllow.hash, action: 'allow_orderbook' });
            await txAllow.wait();
            logS('attach_session_registry_mined', 'success', { action: 'allow_orderbook' });
          } else {
            logS('attach_session_registry', 'success', { message: 'OrderBook already allowed', action: 'allow_orderbook' });
          }
        } catch (e: any) {
          logS('attach_session_registry', 'error', { error: e?.message || String(e), action: 'allow_orderbook' });
        }

        // 2) Attach session registry on MetaTradeFacet (if not set)
        try {
          logS('attach_session_registry', 'start', { orderBook, registry: registryAddress });
          const meta = new ethers.Contract(orderBook, (MetaTradeFacetArtifact as any).abi, wallet);
          const current = await meta.sessionRegistry();
          if (!current || String(current).toLowerCase() !== String(registryAddress).toLowerCase()) {
            const ov = await nonceMgr.nextOverrides();
            const txSet = await meta.setSessionRegistry(registryAddress, ov);
            logS('attach_session_registry_sent', 'success', { tx: txSet.hash, action: 'set_session_registry' });
            await txSet.wait();
            logS('attach_session_registry_mined', 'success', { action: 'set_session_registry' });
          } else {
            logS('attach_session_registry', 'success', { message: 'Session registry already set', action: 'set_session_registry' });
          }
        } catch (e: any) {
          logS('attach_session_registry', 'error', { error: e?.message || String(e), action: 'set_session_registry' });
        }
      }
    } catch (e: any) {
      logS('attach_session_registry', 'error', { error: e?.message || String(e) });
    }

    // Grant roles on CoreVault
    logS('grant_roles', 'start', { coreVault: coreVaultAddress, orderBook });
    const coreVault = new ethers.Contract(coreVaultAddress, CoreVaultABI as any, wallet);
    const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
    try {
      const ov1 = await nonceMgr.nextOverrides();
      const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook, ov1);
      logS('grant_ORDERBOOK_ROLE_sent', 'success', { tx: tx1.hash, nonce: (tx1 as any)?.nonce });
      const r1 = await tx1.wait();
      logS('grant_ORDERBOOK_ROLE_mined', 'success', { tx: r1?.hash || tx1.hash, blockNumber: r1?.blockNumber });
      const ov2 = await nonceMgr.nextOverrides();
      const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook, ov2);
      logS('grant_SETTLEMENT_ROLE_sent', 'success', { tx: tx2.hash, nonce: (tx2 as any)?.nonce });
      const r2 = await tx2.wait();
      logS('grant_SETTLEMENT_ROLE_mined', 'success', { tx: r2?.hash || tx2.hash, blockNumber: r2?.blockNumber });
      logS('grant_roles', 'success');
    } catch (e: any) {
      logS('grant_roles', 'error', { error: extractError(e) });
      return NextResponse.json({ error: 'Admin role grant failed', details: extractError(e) }, { status: 500 });
    }

    // Removed: Immediate trading parameter updates to shorten deployment time

    // Save to Supabase
    let archivedWaybackUrl: string | null = null;
    let archivedWaybackTs: string | null = null;
    logS('save_market', 'start');
    try {
      const supabase = getSupabase();
      // Attempt to archive the metric URL via SavePageNow (server-side, authenticated if keys exist)
      if (supabase) {
        const network = await provider.getNetwork();
        try {
          const access = process.env.WAYBACK_API_ACCESS_KEY as string | undefined;
          const secret = process.env.WAYBACK_API_SECRET as string | undefined;
          const authHeader = access && secret ? `LOW ${access}:${secret}` : undefined;
          const archiveRes = await archivePage(metricUrl, {
            captureOutlinks: false,
            captureScreenshot: true,
            skipIfRecentlyArchived: true,
            headers: {
              ...(authHeader ? { Authorization: authHeader } : {}),
              'User-Agent': `Dexextra/1.0 (+${process.env.APP_URL || 'http://localhost:3000'})`,
            },
          });
          if (archiveRes?.success && archiveRes.waybackUrl) {
            archivedWaybackUrl = String(archiveRes.waybackUrl);
            archivedWaybackTs = archiveRes.timestamp ? String(archiveRes.timestamp) : null;
          } else {
            try { console.warn('[markets/create] Wayback archive failed', archiveRes?.error); } catch {}
          }
        } catch (e: any) {
          try { console.warn('[markets/create] Wayback archive error', e?.message || String(e)); } catch {}
        }
        const insertPayload: any = {
          market_identifier: symbol,
          symbol,
          name: `${(symbol.split('-')[0] || symbol).toUpperCase()} Futures`,
          description: `OrderBook market for ${symbol}`,
          category: Array.isArray(tags) && tags.length ? tags[0] : 'CUSTOM',
          decimals: 6,
          minimum_order_size: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
          tick_size: Number(process.env.DEFAULT_TICK_SIZE || 0.01),
          requires_kyc: false,
          settlement_date: settlementTs ? new Date(settlementTs * 1000).toISOString() : null,
          trading_end_date: null,
          data_request_window_seconds: Number(process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600),
          auto_settle: true,
          oracle_provider: null,
          initial_order: { metricUrl, startPrice: String(startPrice), dataSource, tags, waybackUrl: archivedWaybackUrl || null, waybackTimestamp: archivedWaybackTs || null },
          market_config: {
            ...(aiSourceLocator ? { ai_source_locator: aiSourceLocator } : {}),
            wayback_snapshot: archivedWaybackUrl ? { url: archivedWaybackUrl, timestamp: archivedWaybackTs, source_url: metricUrl } : null,
          },
          chain_id: Number(network.chainId),
          network: String(process.env.NEXT_PUBLIC_NETWORK_NAME || process.env.NETWORK_NAME || ''),
          creator_wallet_address: creatorWalletAddress,
          banner_image_url: null,
          icon_image_url: iconImageUrl,
          supporting_photo_urls: [],
          market_address: orderBook,
          market_id_bytes32: marketId,
          deployment_transaction_hash: receipt?.hash || tx.hash,
          deployment_block_number: receipt?.blockNumber != null ? Number(receipt.blockNumber) : null,
          deployment_gas_used: (receipt as any)?.gasUsed ? Number((receipt as any).gasUsed) : null,
          deployment_status: 'DEPLOYED',
          market_status: 'ACTIVE',
          deployed_at: new Date().toISOString(),
        };
        await supabase.from('markets').insert(insertPayload).select('id').single();
      }
      logS('save_market', 'success');
    } catch (e: any) {
      // Non-fatal; continue
      logS('save_market', 'error', { error: e?.message || String(e) });
    }

    // Respond
    return NextResponse.json({
      ok: true,
      symbol,
      orderBook,
      marketId,
      transactionHash: receipt?.hash || tx.hash,
      feeRecipient,
      waybackUrl: archivedWaybackUrl,
    });
  } catch (e: any) {
    logStep('unhandled_error', 'error', { error: e?.message || String(e) });
    return NextResponse.json({ error: e?.message || 'Failed to create market' }, { status: 500 });
  }
}


