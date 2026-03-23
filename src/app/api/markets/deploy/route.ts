import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import path from 'path';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  OBAdminFacetABI,
  OBPricingFacetABI,
  OBOrderPlacementFacetABI,
  OBTradeExecutionFacetABI,
  OBLiquidationFacetABI,
  OBViewFacetABI,
  OBSettlementFacetABI,
} from '@/lib/contracts';
import { MarketLifecycleFacetABI } from '@/lib/contracts';
import MarketLifecycleFacetArtifact from '@/lib/abis/facets/MarketLifecycleFacet.json';
import MetaTradeFacetArtifact from '@/lib/abis/facets/MetaTradeFacet.json';
import OrderBookVaultAdminFacetArtifact from '@/lib/abis/facets/OrderBookVaultAdminFacet.json';
import { getPusherServer } from '@/lib/pusher-server';

export const runtime = 'nodejs';
export const maxDuration = 300;

function shortAddr(a: any) {
  const s = String(a || '');
  return (s.startsWith('0x') && s.length === 42) ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function trunc(s: any, n = 120) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function logStep(step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) {
  try {
    console.log(JSON.stringify({
      area: 'market_creation',
      context: 'markets_deploy',
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
      'Dexetrav5', 'artifacts', 'src', 'diamond', 'facets',
      `${contractName}.sol`, `${contractName}.json`
    );
    const raw = readFileSync(artifactPath, 'utf8');
    const artifact = JSON.parse(raw);
    if (artifact && Array.isArray((artifact as any).abi)) return (artifact as any).abi;
  } catch {}
  return fallbackAbi;
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
    return (
      e?.shortMessage || e?.reason || e?.error?.message ||
      (typeof e?.data === 'string' ? e.data : undefined) ||
      e?.message || String(e)
    );
  } catch { return String(e); }
}

function decodeRevert(iface: ethers.Interface, e: any) {
  try {
    const data =
      (typeof e?.data === 'string' && e.data) ||
      (typeof e?.error?.data === 'string' && e.error.data) ||
      (typeof e?.info?.error?.data === 'string' && e.info.error.data) ||
      null;
    if (data && data.startsWith('0x')) {
      try {
        const parsed = iface.parseError(data);
        return { name: parsed?.name || null, args: parsed?.args ? Array.from(parsed.args) : null, data };
      } catch { return { name: null, args: null, data }; }
    }
  } catch {}
  return null;
}

const ERROR_SELECTORS: Record<string, string> = {
  '0x5cd5d233': 'BadSignature',
  '0x7fb0cdec': 'MetaExpired',
  '0x4bd574ec': 'BadNonce',
  '0x6dfe7469': 'MarketCreationRestricted',
  '0xd92e233d': 'ZeroAddress',
  '0x1f8f95a0': 'InvalidOraclePrice',
};

async function checkpointDraft(
  supabase: any,
  draftId: string,
  updates: Record<string, any>,
) {
  if (!supabase || !draftId) return;
  try {
    await supabase
      .from('market_drafts')
      .update(updates)
      .eq('id', draftId);
  } catch (e: any) {
    console.warn('[deploy] checkpoint failed', e?.message || String(e));
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const pipelineId = typeof body?.pipelineId === 'string' ? String(body.pipelineId) : '';
    const draftId = typeof body?.draftId === 'string' ? String(body.draftId) : '';
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

    const symbol = String(body?.symbol || '').trim().toUpperCase();
    const metricUrl = String(body?.metricUrl || '').trim();
    const startPrice = String(body?.startPrice || '1');
    const startPrice6Input = body?.startPrice6;
    const startPrice6 = (startPrice6Input !== undefined && startPrice6Input !== null)
      ? BigInt(String(startPrice6Input))
      : ethers.parseUnits(startPrice, 6);
    const dataSource = String(body?.dataSource || 'User Provided');
    const tags = Array.isArray(body?.tags) ? body.tags.slice(0, 10).map((t: any) => String(t)) : [];
    const creatorWalletAddress = (body?.creatorWalletAddress && ethers.isAddress(body.creatorWalletAddress)) ? String(body.creatorWalletAddress).toLowerCase() : null;
    const clientCutArg = Array.isArray(body?.cutArg) ? body.cutArg : (Array.isArray(body?.cut) ? body.cut : null);
    const isRollover = body?.isRollover === true;

    // Validate settlement date
    if (!body?.settlementDate || typeof body.settlementDate !== 'number' || body.settlementDate <= 0) {
      return NextResponse.json({ error: 'settlementDate is required and must be a valid future Unix timestamp' }, { status: 400 });
    }
    const settlementTs = Math.floor(body.settlementDate);
    const now = Math.floor(Date.now() / 1000);
    if (settlementTs <= now) {
      return NextResponse.json({ error: 'settlementDate must be in the future' }, { status: 400 });
    }

    logS('validate_input', 'start');
    if (!symbol) return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
    if (symbol.length > 100) return NextResponse.json({ error: `Symbol too long (${symbol.length}/100)` }, { status: 400 });
    if (!metricUrl) return NextResponse.json({ error: 'Metric URL is required' }, { status: 400 });
    try {
      if (BigInt(startPrice6) <= 0n) return NextResponse.json({ error: 'startPrice must be > 0' }, { status: 400 });
    } catch { return NextResponse.json({ error: 'Invalid startPrice' }, { status: 400 }); }
    logS('validate_input', 'success');

    // Env configuration
    const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL;
    const pk = process.env.ADMIN_PRIVATE_KEY;
    const factoryAddress = process.env.FUTURES_MARKET_FACTORY_ADDRESS || (process.env as any).NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS;
    let initFacet: string | undefined = process.env.ORDER_BOOK_INIT_FACET || (process.env as any).NEXT_PUBLIC_ORDER_BOOK_INIT_FACET;
    const adminFacet = process.env.OB_ADMIN_FACET || (process.env as any).NEXT_PUBLIC_OB_ADMIN_FACET;
    const pricingFacet = process.env.OB_PRICING_FACET || (process.env as any).NEXT_PUBLIC_OB_PRICING_FACET;
    const placementFacet = process.env.OB_ORDER_PLACEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET;
    const execFacet = process.env.OB_TRADE_EXECUTION_FACET || (process.env as any).NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET;
    const liqFacet = process.env.OB_LIQUIDATION_FACET || (process.env as any).NEXT_PUBLIC_OB_LIQUIDATION_FACET;
    const viewFacet = process.env.OB_VIEW_FACET || (process.env as any).NEXT_PUBLIC_OB_VIEW_FACET;
    const settleFacet = process.env.OB_SETTLEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_SETTLEMENT_FACET;
    const vaultFacet = process.env.ORDERBOOK_VALUT_FACET || process.env.ORDERBOOK_VAULT_FACET || (process.env as any).NEXT_PUBLIC_ORDERBOOK_VALUT_FACET || (process.env as any).NEXT_PUBLIC_ORDERBOOK_VAULT_FACET;
    const lifecycleFacet = process.env.MARKET_LIFECYCLE_FACET || (process.env as any).NEXT_PUBLIC_MARKET_LIFECYCLE_FACET;
    const metaTradeFacet = process.env.META_TRADE_FACET || (process.env as any).NEXT_PUBLIC_META_TRADE_FACET;

    if (!rpcUrl) return NextResponse.json({ error: 'RPC_URL not configured' }, { status: 400 });
    if (!pk) return NextResponse.json({ error: 'ADMIN_PRIVATE_KEY not configured' }, { status: 400 });
    if (!factoryAddress || !ethers.isAddress(factoryAddress)) return NextResponse.json({ error: 'Factory address not configured' }, { status: 400 });
    if (!initFacet || !ethers.isAddress(initFacet)) return NextResponse.json({ error: 'Init facet address not configured' }, { status: 400 });
    if (!adminFacet || !pricingFacet || !placementFacet || !execFacet || !liqFacet || !viewFacet || !settleFacet || !vaultFacet || !lifecycleFacet || !metaTradeFacet) {
      return NextResponse.json({ error: 'One or more facet addresses are missing' }, { status: 400 });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    const nonceMgr = await createNonceManager(wallet);
    const ownerAddress = await wallet.getAddress();
    logS('wallet_ready', 'success', { ownerAddress });

    // Load ABIs
    const adminAbi = loadFacetAbi('OBAdminFacet', OBAdminFacetABI as any[]);
    const pricingAbi = loadFacetAbi('OBPricingFacet', OBPricingFacetABI as any[]);
    const placementAbi = loadFacetAbi('OBOrderPlacementFacet', OBOrderPlacementFacetABI as any[]);
    const execAbi = loadFacetAbi('OBTradeExecutionFacet', OBTradeExecutionFacetABI as any[]);
    const liqAbi = loadFacetAbi('OBLiquidationFacet', OBLiquidationFacetABI as any[]);
    const viewAbi = loadFacetAbi('OBViewFacet', OBViewFacetABI as any[]);
    const settleAbi = loadFacetAbi('OBSettlementFacet', OBSettlementFacetABI as any[]);
    const vaultAbi = loadFacetAbi('OrderBookVaultAdminFacet', (OrderBookVaultAdminFacetArtifact as any)?.abi || []);
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
      { facetAddress: vaultFacet, action: 0, functionSelectors: selectorsFromAbi(vaultAbi) },
      { facetAddress: lifecycleFacet, action: 0, functionSelectors: selectorsFromAbi(lifecycleAbi) },
      { facetAddress: metaTradeFacet, action: 0, functionSelectors: selectorsFromAbi(metaFacetAbi) },
    ];

    // Override from /api/orderbook/cut
    try {
      const baseUrl = process.env.APP_URL || 'http://localhost:3000';
      const resp = await fetch(`${baseUrl}/api/orderbook/cut`, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`cut API ${resp.status}`);
      const data = await resp.json();
      const apiCut = Array.isArray(data?.cut) ? data.cut : [];
      const apiInit = data?.initFacet || null;
      if (!apiCut.length || !apiInit || !ethers.isAddress(apiInit)) throw new Error('cut API returned invalid data');
      cut = apiCut.map((c: any) => ({
        facetAddress: c?.facetAddress, action: c?.action ?? 0,
        functionSelectors: Array.isArray(c?.functionSelectors) ? c.functionSelectors : [],
      }));
      initFacet = apiInit;
    } catch (e: any) {
      console.warn('[deploy] cut API override failed', e?.message || String(e));
    }

    logS('facet_cut_built', 'success', { facetCount: cut.length });
    const emptyFacets = cut.filter(c => !c.functionSelectors?.length).map(c => c.facetAddress);
    if (emptyFacets.length) return NextResponse.json({ error: 'Facet selectors could not be built', emptyFacets }, { status: 500 });

    let cutArg = cut.map((c) => [c.facetAddress, 0, c.functionSelectors]);

    // Prefer client cut order for gasless hashing alignment
    if (String(process.env.GASLESS_CREATE_ENABLED || '').toLowerCase() === 'true' && Array.isArray(clientCutArg)) {
      try {
        const normalized = (clientCutArg as any[]).map((e: any) => [e?.[0], Number(e?.[1] ?? 0), Array.isArray(e?.[2]) ? e[2] : []]);
        const bad = normalized.find((e) => !e?.[0] || !ethers.isAddress(e[0]) || !Array.isArray(e[2]));
        if (!bad) cutArg = normalized as any;
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
    const factoryIface = new ethers.Interface(factoryAbi);
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
        return NextResponse.json({ error: 'One or more contracts have no bytecode', details: { noFactory, noInit, badFacets } }, { status: 400 });
      }
    } catch {}

    // Checkpoint: deploying
    const supabase = getSupabase();
    if (draftId) {
      await checkpointDraft(supabase, draftId, {
        pipeline_stage: 'deploying',
        status: 'deploying',
      });
    }

    let tx: ethers.TransactionResponse;
    let receipt: ethers.TransactionReceipt | null;

    if (gaslessEnabled && !isRollover) {
      // ---- GASLESS META-CREATE ----
      const creator = creatorWalletAddress;
      if (!creator) return NextResponse.json({ error: 'creatorWalletAddress required for gasless' }, { status: 400 });
      const signature = typeof body?.signature === 'string' ? String(body.signature) : null;
      const nonceStr = typeof body?.nonce !== 'undefined' ? String(body.nonce) : null;
      const deadlineStr = typeof body?.deadline !== 'undefined' ? String(body.deadline) : null;
      if (!signature || nonceStr == null || deadlineStr == null) {
        return NextResponse.json({ error: 'signature, nonce, deadline required for gasless' }, { status: 400 });
      }
      const nonce = BigInt(nonceStr);
      const deadline = BigInt(deadlineStr);

      const net = await provider.getNetwork();
      let domainName = String(process.env.EIP712_FACTORY_DOMAIN_NAME || (process.env as any).NEXT_PUBLIC_EIP712_FACTORY_DOMAIN_NAME || 'DexeteraFactory');
      let domainVersion = String(process.env.EIP712_FACTORY_DOMAIN_VERSION || (process.env as any).NEXT_PUBLIC_EIP712_FACTORY_DOMAIN_VERSION || '1');
      let domainChainId = Number(net.chainId);
      let domainVerifying = factoryAddress;

      let tagsHash: string;
      let cutHash: string;
      try {
        const helper = new ethers.Contract(factoryAddress, [
          'function computeTagsHash(string[] tags) view returns (bytes32)',
          'function computeCutHash((address facetAddress,uint8 action,bytes4[] functionSelectors)[] cut) view returns (bytes32)',
          'function eip712DomainInfo() view returns (string name,string version,uint256 chainId,address verifyingContract,bytes32 domainSeparator)',
        ], wallet);
        try {
          const info = await helper.eip712DomainInfo();
          if (info?.name) domainName = String(info.name);
          if (info?.version) domainVersion = String(info.version);
          if (info?.chainId) domainChainId = Number(info.chainId);
          if (info?.verifyingContract && ethers.isAddress(info.verifyingContract)) domainVerifying = info.verifyingContract;
        } catch {}
        tagsHash = await helper.computeTagsHash(tags);
        cutHash = await helper.computeCutHash(cutArg);
      } catch {
        tagsHash = ethers.keccak256(ethers.solidityPacked(new Array(tags.length).fill('string'), tags));
        const perCutHashes: string[] = [];
        for (const c of cutArg) {
          const selectorsHash = ethers.keccak256(ethers.solidityPacked(new Array((c?.[2] || []).length).fill('bytes4'), c?.[2] || []));
          const enc = ethers.AbiCoder.defaultAbiCoder().encode(['address','uint8','bytes32'], [c?.[0], c?.[1], selectorsHash]);
          perCutHashes.push(ethers.keccak256(enc));
        }
        cutHash = ethers.keccak256(ethers.solidityPacked(new Array(perCutHashes.length).fill('bytes32'), perCutHashes));
      }

      const domain = { name: domainName, version: domainVersion, chainId: domainChainId, verifyingContract: domainVerifying } as const;
      const types = {
        MetaCreate: [
          { name: 'marketSymbol', type: 'string' }, { name: 'metricUrl', type: 'string' },
          { name: 'settlementDate', type: 'uint256' }, { name: 'startPrice', type: 'uint256' },
          { name: 'dataSource', type: 'string' }, { name: 'tagsHash', type: 'bytes32' },
          { name: 'diamondOwner', type: 'address' }, { name: 'cutHash', type: 'bytes32' },
          { name: 'initFacet', type: 'address' }, { name: 'creator', type: 'address' },
          { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
        ],
      } as const;
      const message = {
        marketSymbol: symbol, metricUrl, settlementDate: settlementTs,
        startPrice: startPrice6.toString(), dataSource, tagsHash,
        diamondOwner: ownerAddress, cutHash, initFacet,
        creator, nonce: nonce.toString(), deadline: deadline.toString(),
      };

      // Verify signature
      try {
        const recovered = ethers.verifyTypedData(domain as any, types as any, message as any, signature);
        if (!recovered || recovered.toLowerCase() !== creator.toLowerCase()) {
          return NextResponse.json({ error: 'bad_sig', recovered, expected: creator }, { status: 400 });
        }
      } catch (e: any) {
        return NextResponse.json({ error: 'verify_failed', details: e?.message || String(e) }, { status: 400 });
      }

      // Nonce check
      try {
        const onchainNonce = await factory.metaCreateNonce(creator);
        if (String(onchainNonce) !== String(nonce)) {
          return NextResponse.json({ error: 'bad_nonce', expected: String(onchainNonce), got: String(nonce) }, { status: 400 });
        }
      } catch {}

      // Static call
      logS('factory_static_call_meta', 'start');
      try {
        await factory.getFunction('metaCreateFuturesMarketDiamond').staticCall(
          message.marketSymbol, message.metricUrl, Number(message.settlementDate),
          BigInt(message.startPrice), dataSource, tags, ownerAddress,
          cutArg, initFacet, creator, nonce, deadline, signature
        );
        logS('factory_static_call_meta', 'success');
      } catch (e: any) {
        const raw = e?.shortMessage || e?.reason || e?.message || 'static call failed';
        const decoded = decodeRevert(factoryIface, e);
        const rawData = (typeof e?.data === 'string' && e.data) || decoded?.data || null;
        const selector = rawData && rawData.startsWith('0x') ? rawData.slice(0, 10) : null;
        const customError = decoded?.name || (selector ? ERROR_SELECTORS[selector] : null) || null;
        logS('factory_static_call_meta', 'error', { error: raw, customError });
        return NextResponse.json({ error: raw, customError, rawData }, { status: 400 });
      }

      // Send tx
      logS('factory_send_tx_meta', 'start');
      const overrides = await nonceMgr.nextOverrides();
      tx = await factory.getFunction('metaCreateFuturesMarketDiamond')(
        message.marketSymbol, message.metricUrl, Number(message.settlementDate),
        BigInt(message.startPrice), dataSource, tags, ownerAddress,
        cutArg, initFacet, creator, nonce, deadline, signature, overrides as any
      );
      logS('factory_send_tx_meta_sent', 'success', { hash: tx.hash });
      logS('factory_confirm_meta', 'start');
      receipt = await tx.wait();
      logS('factory_confirm_meta_mined', 'success', { hash: receipt?.hash || tx.hash, block: receipt?.blockNumber });
    } else {
      // ---- LEGACY DIRECT CREATE ----
      logS('factory_static_call', 'start');
      try {
        await factory.getFunction('createFuturesMarketDiamond').staticCall(
          symbol, metricUrl, settlementTs, startPrice6, dataSource, tags,
          ownerAddress, cutArg, initFacet, '0x'
        );
        logS('factory_static_call', 'success');
      } catch (e: any) {
        const raw = e?.shortMessage || e?.reason || e?.message || 'static call failed';
        const decoded = decodeRevert(factoryIface, e);
        logS('factory_static_call', 'error', { error: raw, customError: decoded?.name });
        return NextResponse.json({ error: raw, customError: decoded?.name || null, rawData: decoded?.data || null }, { status: 400 });
      }

      logS('factory_send_tx', 'start');
      const overrides = await nonceMgr.nextOverrides();
      tx = await factory.getFunction('createFuturesMarketDiamond')(
        symbol, metricUrl, settlementTs, startPrice6, dataSource, tags,
        ownerAddress, cutArg, initFacet, '0x', overrides as any
      );
      logS('factory_send_tx_sent', 'success', { hash: tx.hash });
      logS('factory_confirm', 'start');
      receipt = await tx.wait();
      logS('factory_confirm_mined', 'success', { hash: receipt?.hash || tx.hash, block: receipt?.blockNumber });
    }

    // Parse FuturesMarketCreated event
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
    if (!orderBook || !marketId) return NextResponse.json({ error: 'Could not parse FuturesMarketCreated event' }, { status: 500 });

    // Checkpoint: deployed
    const network = await provider.getNetwork();
    if (draftId && supabase) {
      await checkpointDraft(supabase, draftId, {
        pipeline_stage: 'deployed',
        status: 'deploying',
        orderbook_address: orderBook,
        market_id_bytes32: marketId,
        transaction_hash: receipt?.hash || tx.hash,
        chain_id: Number(network.chainId),
        block_number: receipt?.blockNumber != null ? Number(receipt.blockNumber) : null,
        pipeline_state: {
          deploy: {
            completed_at: new Date().toISOString(),
            tx_hash: receipt?.hash || tx.hash,
            block_number: receipt?.blockNumber != null ? Number(receipt.blockNumber) : null,
            gas_used: (receipt as any)?.gasUsed ? String((receipt as any).gasUsed) : null,
          },
        },
      });
    }

    logS('deploy_complete', 'success', { orderBook, marketId, draftId });

    return NextResponse.json({
      ok: true,
      orderBook,
      marketId,
      transactionHash: receipt?.hash || tx.hash,
      blockNumber: receipt?.blockNumber != null ? Number(receipt.blockNumber) : null,
      chainId: Number(network.chainId),
      draftId,
    });
  } catch (e: any) {
    logStep('unhandled_error', 'error', { error: e?.message || String(e) });
    return NextResponse.json({ error: e?.message || 'Deploy failed' }, { status: 500 });
  }
}
