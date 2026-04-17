import { ethers } from 'ethers';
import {
  OBAdminFacetABI,
  OBPricingFacetABI,
  OBOrderPlacementFacetABI,
  OBTradeExecutionFacetABI,
  OBLiquidationFacetABI,
  OBViewFacetABI,
  OBSettlementFacetABI,
  MarketLifecycleFacetABI,
} from '@/lib/contracts';
import FuturesMarketFactoryGenerated from '@/lib/abis/FuturesMarketFactory.json';
import MetaTradeFacetArtifact from '@/lib/abis/facets/MetaTradeFacet.json';
import OrderBookVaultAdminFacetArtifact from '@/lib/abis/facets/OrderBookVaultAdminFacet.json';

type ProgressEvent = {
  step: string;
  status?: 'start' | 'success' | 'error' | 'sent' | 'mined' | 'ok' | 'missing';
  data?: Record<string, any>;
};

function selectorsFromAbi(abi: any[]): string[] {
  try {
    const iface = new ethers.Interface(abi as any);
    return (iface.fragments as any[])
      .filter((frag: any) => frag?.type === 'function')
      .map((frag: any) => ethers.id(frag.format('sighash')).slice(0, 10));
  } catch {
    return [];
  }
}

function shortAddr(a: unknown): string {
  const s = String(a || '');
  return s.startsWith('0x') && s.length === 42 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function logMarketIdentifiers(orderBook: string | null | undefined, marketId: string | null | undefined) {
  try {
    if (!orderBook || !marketId) return;
    const header = 'background: linear-gradient(90deg,#22c55e,#06b6d4); color:#0b1220; padding:3px 8px; border-radius:6px; font-weight:900;';
    const sub = 'color:#93c5fd; font-weight:700;';
    const val = 'color:#e5e7eb; font-weight:700;';
    // eslint-disable-next-line no-console
    console.group('%c✅ MARKET CREATED', header);
    // eslint-disable-next-line no-console
    console.log('%cOrderBook%c %s  (%s)', sub, val, orderBook, shortAddr(orderBook));
    // eslint-disable-next-line no-console
    console.log('%cMarket ID%c   %s', sub, val, marketId);
    // eslint-disable-next-line no-console
    console.groupEnd();
  } catch {}
}

export type PipelineResumeState = {
  draftId: string;
  pipelineStage: string;
  orderbookAddress: string | null;
  marketIdBytes32: string | null;
  transactionHash: string | null;
  blockNumber: number | null;
  chainId: number | null;
};

export type PrefetchedCutData = {
  cutArg: Array<[string, number, string[]]>;
  initFacet: string;
  cutHash?: string;
  emptyTagsHash?: string;
  eip712Domain?: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
};

const HELPER_ABI = [
  'function computeTagsHash(string[] tags) view returns (bytes32)',
  'function computeCutHash((address facetAddress,uint8 action,bytes4[] functionSelectors)[] cut) view returns (bytes32)',
  'function metaCreateNonce(address) view returns (uint256)',
  'function eip712DomainInfo() view returns (string name,string version,uint256 chainId,address verifyingContract,bytes32 domainSeparator)',
];

/**
 * Pre-fetches diamond cut configuration and computes hashes via read-only RPC.
 * Call early (e.g. when user passes wizard step 1) so this data is ready
 * before the user clicks "Create".
 */
export async function prefetchCutData(): Promise<PrefetchedCutData> {
  const res = await fetch('/api/orderbook/cut', { method: 'GET' });
  if (!res.ok) throw new Error(`cut API ${res.status}`);
  const data = await res.json();
  const cut = Array.isArray(data?.cut) ? data.cut : [];
  const initFacet: string = data?.initFacet || '';
  const cutArg: Array<[string, number, string[]]> = cut.map((c: any) => [c.facetAddress, 0, c.functionSelectors]);

  if (!initFacet || !ethers.isAddress(initFacet)) {
    throw new Error('initFacet not available from /api/orderbook/cut');
  }

  let cutHash: string | undefined;
  let emptyTagsHash: string | undefined;
  let eip712Domain: PrefetchedCutData['eip712Domain'] | undefined;

  const rpcUrl = String(
    (process.env as any).NEXT_PUBLIC_RPC_URL || ''
  ).trim();
  const factoryAddress = String(
    (process.env as any).NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS ||
    (globalThis as any).process?.env?.NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS || ''
  ).trim();

  if (rpcUrl && factoryAddress && ethers.isAddress(factoryAddress)) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const factory = new ethers.Contract(factoryAddress, HELPER_ABI, provider);
      const helperCut = cutArg.map((c) => ({ facetAddress: c[0], action: c[1], functionSelectors: c[2] }));

      const [cutHashResult, tagsResult, domainResult] = await Promise.allSettled([
        factory.computeCutHash(helperCut as any),
        factory.computeTagsHash([]),
        factory.eip712DomainInfo(),
      ]);

      if (cutHashResult.status === 'fulfilled') cutHash = cutHashResult.value as string;
      if (tagsResult.status === 'fulfilled') emptyTagsHash = tagsResult.value as string;
      if (domainResult.status === 'fulfilled') {
        const info = domainResult.value;
        if (info?.name && info?.version) {
          eip712Domain = {
            name: info.name,
            version: info.version,
            chainId: Number(info.chainId),
            verifyingContract: info.verifyingContract,
          };
        }
      }
    } catch {}
  }

  // Local fallbacks for hashes if RPC calls failed
  if (!cutHash) {
    try {
      const perCutHashes: string[] = [];
      for (const entry of cutArg) {
        const sels = entry?.[2] || [];
        const selectorsHash = ethers.keccak256(ethers.solidityPacked(new Array(sels.length).fill('bytes4'), sels));
        const enc = ethers.AbiCoder.defaultAbiCoder().encode(['address','uint8','bytes32'], [entry?.[0], entry?.[1], selectorsHash]);
        perCutHashes.push(ethers.keccak256(enc));
      }
      cutHash = ethers.keccak256(ethers.solidityPacked(new Array(perCutHashes.length).fill('bytes32'), perCutHashes));
    } catch {}
  }

  if (!emptyTagsHash) {
    try {
      emptyTagsHash = ethers.keccak256(ethers.solidityPacked([], []));
    } catch {}
  }

  // eslint-disable-next-line no-console
  console.log(
    '%c⚡ Cut data pre-fetched',
    'color:#22c55e; font-weight:700;',
    { facets: cutArg.length, cutHash: cutHash ? `${cutHash.slice(0, 10)}…` : '(none)', eip712Domain: !!eip712Domain }
  );

  return { cutArg, initFacet, cutHash, emptyTagsHash, eip712Domain };
}

export async function createMarketOnChain(params: {
  symbol: string;
  metricUrl: string;
  startPrice: string | number;
  dataSource?: string;
  tags?: string[];
  name?: string;
  description?: string;
  bannerImageUrl?: string | null;
  iconImageUrl?: string | null;
  aiSourceLocator?: any;
  settlementDate?: number;
  speedRunConfig?: {
    rolloverLeadSeconds: number;
    challengeWindowSeconds: number;
  };
  feeRecipient?: string;
  onProgress?: (event: ProgressEvent) => void;
  pipelineId?: string;
  draftId?: string;
  resumeState?: PipelineResumeState;
  prefetchedCut?: PrefetchedCutData;
}) {
  if (typeof window === 'undefined' || !(window as any).ethereum) {
    throw new Error('No injected wallet found. Please install MetaMask or a compatible wallet.');
  }

  const {
    symbol,
    metricUrl,
    startPrice,
    dataSource = 'User Provided',
    tags = [],
    name,
    description,
    bannerImageUrl,
    iconImageUrl,
    aiSourceLocator,
    settlementDate,
    speedRunConfig,
    feeRecipient,
    onProgress,
    pipelineId,
    draftId: paramDraftId,
    resumeState,
    prefetchedCut,
  } = params;

  const draftId = resumeState?.draftId || paramDraftId || '';
  if (!symbol || !metricUrl) throw new Error('Symbol and metricUrl are required');
  const symbolNormalized = String(symbol).trim().toUpperCase();
  const metricUrlNormalized = String(metricUrl).trim();
  // DB constraint guard (Supabase markets.symbol). Prevent wasting an on-chain deploy
  // only to fail at the final "save market" step.
  if (symbolNormalized.length > 100) {
    throw new Error(`Symbol too long (${symbolNormalized.length}/100). Shorten the market name / symbol.`);
  }

  // Build cutArg and initFacet — use prefetched data if available, otherwise fetch live
  let initFacet: string | null = null;
  let cutArg: Array<[string, number, string[]]> = [];
  if (prefetchedCut && prefetchedCut.cutArg.length > 0 && prefetchedCut.initFacet) {
    cutArg = prefetchedCut.cutArg;
    initFacet = prefetchedCut.initFacet;
    // eslint-disable-next-line no-console
    console.log('%c⚡ Using pre-fetched cut data (skipped /api/orderbook/cut)', 'color:#22c55e; font-weight:700;', { facets: cutArg.length });
    onProgress?.({ step: 'cut_fetch', status: 'success', data: { facets: cutArg.length, prefetched: true } });
    onProgress?.({ step: 'cut_build', status: 'success', data: { facets: cutArg.length, prefetched: true } });
  } else {
    try {
      onProgress?.({ step: 'cut_fetch', status: 'start' });
      const res = await fetch('/api/orderbook/cut', { method: 'GET' });
      if (!res.ok) throw new Error(`cut API ${res.status}`);
      const data = await res.json();
      const cut = Array.isArray(data?.cut) ? data.cut : [];
      initFacet = data?.initFacet || null;
      cutArg = cut.map((c: any) => [c.facetAddress, 0, c.functionSelectors]);
      // eslint-disable-next-line no-console
      console.log('%c🧬 Using server-provided cutArg from compiled artifacts', 'color:#22c55e; font-weight:700;', {
        initFacet, facets: cut.map((c: any) => ({ facet: c.facetAddress, selectors: (c.functionSelectors || []).length })),
      });
      onProgress?.({ step: 'cut_fetch', status: 'success', data: { facets: cutArg.length } });
      onProgress?.({ step: 'cut_build', status: 'success', data: { facets: cutArg.length } });
    } catch (e: any) {
      // Fallback: compute from local ABIs + env addresses if API unavailable
      // eslint-disable-next-line no-console
      console.warn('[createMarketOnChain] cut API unavailable; falling back to local ABIs + env addresses:', e?.message || e);
      onProgress?.({ step: 'cut_fetch', status: 'error', data: { fallback: true, error: e?.message || String(e) } });
      const adminAddr = (process.env as any).NEXT_PUBLIC_OB_ADMIN_FACET;
      const pricingAddr = (process.env as any).NEXT_PUBLIC_OB_PRICING_FACET;
      const placementAddr = (process.env as any).NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET;
      const execAddr = (process.env as any).NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET;
      const liqAddr = (process.env as any).NEXT_PUBLIC_OB_LIQUIDATION_FACET;
      const viewAddr = (process.env as any).NEXT_PUBLIC_OB_VIEW_FACET;
      const settleAddr = (process.env as any).NEXT_PUBLIC_OB_SETTLEMENT_FACET;
      const metaAddr = (process.env as any).NEXT_PUBLIC_META_TRADE_FACET;
      const vaultAddr =
        (process.env as any).NEXT_PUBLIC_ORDERBOOK_VALUT_FACET ||
        (process.env as any).NEXT_PUBLIC_ORDERBOOK_VAULT_FACET;
      initFacet = (process.env as any).NEXT_PUBLIC_ORDER_BOOK_INIT_FACET || null;
      const adminSelectors = selectorsFromAbi(OBAdminFacetABI as any[]);
      const pricingSelectors = selectorsFromAbi(OBPricingFacetABI as any[]);
      const placementSelectors = selectorsFromAbi(OBOrderPlacementFacetABI as any[]);
      const execSelectors = selectorsFromAbi(OBTradeExecutionFacetABI as any[]);
      const liqSelectors = selectorsFromAbi(OBLiquidationFacetABI as any[]);
      const viewSelectors = selectorsFromAbi(OBViewFacetABI as any[]);
      const settleSelectors = selectorsFromAbi(OBSettlementFacetABI as any[]);
      const vaultSelectors = selectorsFromAbi(((OrderBookVaultAdminFacetArtifact as any)?.abi || []) as any[]);
      const lifecycleAddr = (process.env as any).NEXT_PUBLIC_MARKET_LIFECYCLE_FACET;
      const lifecycleSelectors = selectorsFromAbi(MarketLifecycleFacetABI as any[]);
      const metaSelectors = selectorsFromAbi(((MetaTradeFacetArtifact as any)?.abi || []) as any[]);
      cutArg = [
        [adminAddr, 0, adminSelectors],
        [pricingAddr, 0, pricingSelectors],
        [placementAddr, 0, placementSelectors],
        [execAddr, 0, execSelectors],
        [liqAddr, 0, liqSelectors],
        [viewAddr, 0, viewSelectors],
        [settleAddr, 0, settleSelectors],
        [vaultAddr, 0, vaultSelectors],
        [lifecycleAddr, 0, lifecycleSelectors],
        [metaAddr, 0, metaSelectors],
      ].filter(([addr]) => typeof addr === 'string' && ethers.isAddress(String(addr))) as any;
      onProgress?.({ step: 'cut_build', status: 'success', data: { facets: cutArg.length } });
    }
  }
  // 🔎 High-visibility diagnostics for cutArg (full + summary)
  try {
    const banner = 'background: linear-gradient(90deg,#7c3aed,#06b6d4); color:#fff; padding:2px 6px; border-radius:4px; font-weight:700;';
    const note = 'color:#93c5fd; font-weight:600;';
    const cutPreview = cutArg.map((entry) => ({
      facetAddress: entry?.[0],
      action: entry?.[1],
      selectorsCount: Array.isArray(entry?.[2]) ? entry[2].length : 0,
    }));
    // Preview (object)
    // eslint-disable-next-line no-console
    console.log('%c🧩 CUT ARG PREVIEW (per facet) %c→ verify selectorsCount matches expectations', banner, note, cutPreview);
    // Full JSON to avoid DevTools collapsing large arrays
    const fullJson = JSON.stringify(cutArg, null, 2);
    // eslint-disable-next-line no-console
    console.log('%c🧩 CUT ARG FULL JSON (for exact comparison)', banner, fullJson);
  } catch {}

  // Ensure initFacet exists before proceeding
  if (!initFacet || !ethers.isAddress(initFacet)) {
    throw new Error('initFacet not available. Ensure /api/orderbook/cut and env are configured.');
  }

  // Connect wallet
  const browserProvider = new ethers.BrowserProvider((window as any).ethereum);
  const signer = await browserProvider.getSigner();
  const signerAddress = await signer.getAddress();
  try {
    const net = await browserProvider.getNetwork();
    const rpcChainIdHex = await (browserProvider as any).send?.('eth_chainId', []);
    const rpcChainIdNum = rpcChainIdHex ? Number(rpcChainIdHex) : undefined;
    // eslint-disable-next-line no-console
    console.log('[SIGNER_CHECK][client]', { signerAddress, chainId: Number(net.chainId), rpcChainIdHex, rpcChainIdNum });
  } catch {}
  // Client-side guard: ensure the signer matches the intended creator (server expects creatorWalletAddress)
  if (feeRecipient && ethers.isAddress(feeRecipient)) {
    const expected = feeRecipient.toLowerCase();
    if (signerAddress.toLowerCase() !== expected) {
      throw new Error(`Connected wallet ${signerAddress} does not match expected creator ${feeRecipient}`);
    }
  }
  const network = await browserProvider.getNetwork();

  // Resolve factory
  const factoryAddress =
    (process.env as any).NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS ||
    (globalThis as any).process?.env?.NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS;
  if (!factoryAddress || !ethers.isAddress(factoryAddress)) {
    throw new Error('NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS not configured');
  }
  const factoryAbi =
    (FuturesMarketFactoryGenerated as any)?.abi ||
    (FuturesMarketFactoryGenerated as any);
  const gaslessEnabled = String((process.env as any).NEXT_PUBLIC_GASLESS_CREATE_ENABLED || '').toLowerCase() === 'true';
  const mergedAbi = Array.isArray(factoryAbi) ? [...factoryAbi, ...(gaslessEnabled ? HELPER_ABI : [])] : (gaslessEnabled ? HELPER_ABI : factoryAbi);
  const factory = new ethers.Contract(factoryAddress, mergedAbi, signer);

  // Params
  const startPrice6 = ethers.parseUnits(String(startPrice ?? '1'), 6);
  const fallbackSettlementTs = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const settlementTs = Number.isFinite(Number(settlementDate)) && Number(settlementDate) > 0
    ? Math.floor(Number(settlementDate))
    : fallbackSettlementTs;
  const owner = feeRecipient && ethers.isAddress(feeRecipient) ? feeRecipient : signerAddress;

  // Prevent zero/invalid start price before signing
  const startPriceNum = Number(startPrice);
  if (!Number.isFinite(startPriceNum) || startPriceNum <= 0) {
    throw new Error('Start price must be greater than zero');
  }

  if (gaslessEnabled) {
    // Gasless path: sign typed data and submit via backend relayer
    onProgress?.({ step: 'meta_prepare', status: 'start' });

    // Compute tagsHash
    let tagsHash: string;
    if (prefetchedCut?.emptyTagsHash && tags.length === 0) {
      tagsHash = prefetchedCut.emptyTagsHash;
    } else {
      try {
        tagsHash = await factory.computeTagsHash(tags);
      } catch {
        // Local fallback
        let packed = '0x';
        for (const tag of tags) {
          packed += Buffer.from(tag).toString('hex');
        }
        tagsHash = ethers.keccak256(packed || '0x');
      }
    }

    // Fetch meta nonce
    let nonceBn: bigint = 0n;
    try {
      nonceBn = await factory.metaCreateNonce(signerAddress);
    } catch {}
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60); // 15 minutes

    // EIP-712 Domain
    let domainName = 'DexeteraFactory';
    let domainVersion = '1';
    let domainChainId = Number(network.chainId);
    let domainVerifying = factoryAddress;
    try {
      const info = await factory.eip712DomainInfo();
      if (info?.name) domainName = info.name;
      if (info?.version) domainVersion = info.version;
      if (info?.chainId) domainChainId = Number(info.chainId);
      if (info?.verifyingContract && ethers.isAddress(info.verifyingContract)) domainVerifying = info.verifyingContract;
    } catch {}

    const domain = {
      name: domainName,
      version: domainVersion,
      chainId: domainChainId,
      verifyingContract: domainVerifying,
    } as const;

    // Diamond owner (admin wallet or user)
    const envDiamondOwner =
      (process.env as any).NEXT_PUBLIC_FACTORY_DIAMOND_OWNER ||
      (globalThis as any).process?.env?.NEXT_PUBLIC_FACTORY_DIAMOND_OWNER;
    const diamondOwner =
      (typeof envDiamondOwner === 'string' && ethers.isAddress(envDiamondOwner))
        ? envDiamondOwner
        : owner;

    const types = {
      MetaCreateV2: [
        { name: 'marketSymbol', type: 'string' },
        { name: 'metricUrl', type: 'string' },
        { name: 'settlementDate', type: 'uint256' },
        { name: 'startPrice', type: 'uint256' },
        { name: 'dataSource', type: 'string' },
        { name: 'tagsHash', type: 'bytes32' },
        { name: 'diamondOwner', type: 'address' },
        { name: 'creator', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    } as const;

    const message = {
      marketSymbol: symbolNormalized,
      metricUrl: metricUrlNormalized,
      settlementDate: settlementTs,
      startPrice: startPrice6.toString(),
      dataSource,
      tagsHash,
      diamondOwner,
      creator: signerAddress,
      nonce: nonceBn.toString(),
      deadline: deadline.toString(),
    };

    // eslint-disable-next-line no-console
    console.log('[GASLESS] Signing request', { domain, message });

    const signature = await (signer as any).signTypedData(domain as any, types as any, message as any);
    
    // Verify signature locally
    try {
      const recoveredLocal = ethers.verifyTypedData(domain as any, types as any, message as any, signature);
      if (recoveredLocal.toLowerCase() !== signerAddress.toLowerCase()) {
        throw new Error(`Signature recovered ${recoveredLocal} but expected ${signerAddress}`);
      }
      // eslint-disable-next-line no-console
      console.log('[GASLESS] Signature verified locally');
    } catch (err: any) {
      throw new Error(`Signature self-check failed: ${err?.message || String(err)}`);
    }
    onProgress?.({ step: 'meta_signature', status: 'success' });

    // ---- STAGE 1: Deploy ----
    let deployResult: { orderBook: string; marketId: string; transactionHash: string; blockNumber?: number; chainId?: number; draftId?: string };

    // Skip deploy if we're resuming from a completed deploy
    if (resumeState && (resumeState.pipelineStage === 'deployed' || resumeState.pipelineStage === 'configured' || resumeState.pipelineStage === 'configuring') && resumeState.orderbookAddress) {
      deployResult = {
        orderBook: resumeState.orderbookAddress,
        marketId: resumeState.marketIdBytes32 || '',
        transactionHash: resumeState.transactionHash || '',
        blockNumber: resumeState.blockNumber ?? undefined,
        chainId: resumeState.chainId ?? undefined,
        draftId: resumeState.draftId,
      };
      onProgress?.({ step: 'deploy_resumed', status: 'success', data: { orderBook: deployResult.orderBook, marketId: deployResult.marketId } });
    } else {
      onProgress?.({ step: 'relayer_deploy', status: 'start' });
      const deployRes = await fetch('/api/markets/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbolNormalized,
          metricUrl: metricUrlNormalized,
          startPrice: String(startPrice),
          startPrice6: startPrice6.toString(),
          dataSource,
          tags,
          creatorWalletAddress: signerAddress,
          settlementDate: settlementTs,
          signature,
          nonce: message.nonce,
          deadline: message.deadline,
          v2: true,
          pipelineId: pipelineId || null,
          draftId: draftId || null,
        }),
      });
      if (!deployRes.ok) {
        const text = await deployRes.text();
        let msg = text;
        try {
          const j = JSON.parse(text) as {
            hint?: string;
            customError?: string;
            error?: string;
            rpcDetail?: string;
            rawData?: string | null;
          };
          if (j?.hint) msg = j.hint;
          else if (j?.rpcDetail) msg = j.rpcDetail;
          else if (typeof j?.error === 'string') msg = j.error;
          if (j?.customError && !msg.includes(String(j.customError))) {
            msg = `${msg} [${j.customError}]`;
          }
          const rd = j?.rawData;
          if (typeof rd === 'string' && rd.startsWith('0x') && rd.length < 500) {
            const head = rd.slice(2, 4).toLowerCase();
            const isTxBlob =
              rd.length > 200 &&
              (head === '01' || head === '02' || head === '03' || head === '04' || head === '05');
            if (!isTxBlob && !msg.includes(rd.slice(0, 14))) {
              msg = `${msg} rawData=${rd}`;
            }
          }
        } catch {
          /* keep raw text */
        }
        throw new Error(`deploy http ${deployRes.status}: ${msg}`);
      }
      deployResult = await deployRes.json();
      onProgress?.({ step: 'relayer_deploy', status: 'success', data: { hash: deployResult.transactionHash, orderBook: deployResult.orderBook, marketId: deployResult.marketId } });
      logMarketIdentifiers(deployResult.orderBook, deployResult.marketId);
    }

    // ---- STAGE 2: Configure ----
    const skipConfigure = resumeState && (resumeState.pipelineStage === 'configured');
    if (!skipConfigure) {
      onProgress?.({ step: 'relayer_configure', status: 'start' });
      const configRes = await fetch('/api/markets/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderBook: deployResult.orderBook,
          draftId: deployResult.draftId || draftId || null,
          pipelineId: pipelineId || null,
          creatorWalletAddress: signerAddress,
          feeRecipient: feeRecipient || signerAddress,
          speedRunConfig: speedRunConfig || undefined,
          settlementTs,
        }),
      });
      if (!configRes.ok) {
        const text = await configRes.text();
        throw new Error(`configure http ${configRes.status}: ${text}`);
      }
      const configJson = await configRes.json();
      onProgress?.({ step: 'relayer_configure', status: 'success', data: configJson });
    } else {
      onProgress?.({ step: 'configure_resumed', status: 'success' });
    }

    // ---- STAGE 3: Finalize ----
    onProgress?.({ step: 'relayer_finalize', status: 'start' });
    const finalizeRes = await fetch('/api/markets/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderBook: deployResult.orderBook,
        marketId: deployResult.marketId,
        transactionHash: deployResult.transactionHash,
        blockNumber: deployResult.blockNumber,
        chainId: deployResult.chainId,
        symbol: symbolNormalized,
        metricUrl: metricUrlNormalized,
        startPrice: String(startPrice),
        dataSource,
        tags,
        name: typeof name === 'string' ? name : undefined,
        description: typeof description === 'string' ? description : undefined,
        bannerImageUrl: bannerImageUrl ?? null,
        iconImageUrl: iconImageUrl ?? null,
        aiSourceLocator: aiSourceLocator ?? null,
        creatorWalletAddress: signerAddress,
        settlementDate: settlementTs,
        feeRecipient: feeRecipient || signerAddress,
        speedRunConfig: speedRunConfig || undefined,
        pipelineId: pipelineId || null,
        draftId: deployResult.draftId || draftId || null,
      }),
    });
    if (!finalizeRes.ok) {
      const text = await finalizeRes.text();
      throw new Error(`finalize http ${finalizeRes.status}: ${text}`);
    }
    const finalJson = await finalizeRes.json();
    onProgress?.({ step: 'relayer_finalize', status: 'success', data: { marketId: finalJson?.marketId, waybackUrl: finalJson?.waybackUrl } });
    logMarketIdentifiers(deployResult.orderBook, finalJson?.marketId);

    return {
      orderBook: deployResult.orderBook,
      marketId: finalJson?.marketId || deployResult.marketId,
      transactionHash: deployResult.transactionHash,
      chainId: Number(network.chainId),
      receipt: undefined,
    };
  }

  // Gasless mode is required - throw if somehow disabled
  throw new Error('Gasless market creation is required. Enable NEXT_PUBLIC_GASLESS_CREATE_ENABLED.');
}


