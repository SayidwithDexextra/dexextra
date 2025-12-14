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

export async function createMarketOnChain(params: {
  symbol: string;
  metricUrl: string;
  startPrice: string | number;
  dataSource?: string;
  tags?: string[];
  feeRecipient?: string; // optional override; defaults to connected wallet
  onProgress?: (event: ProgressEvent) => void;
  pipelineId?: string; // optional: used for server push progress via Pusher
}) {
  if (typeof window === 'undefined' || !(window as any).ethereum) {
    throw new Error('No injected wallet found. Please install MetaMask or a compatible wallet.');
  }

  const { symbol, metricUrl, startPrice, dataSource = 'User Provided', tags = [], feeRecipient, onProgress, pipelineId } = params;
  if (!symbol || !metricUrl) throw new Error('Symbol and metricUrl are required');
  const symbolNormalized = String(symbol).trim().toUpperCase();
  const metricUrlNormalized = String(metricUrl).trim();

  // Build cutArg and initFacet from server (source of truth, compiled artifacts)
  let initFacet: string | null = null;
  let cutArg: Array<[string, number, string[]]> = [];
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
    // Nudge UI to next step consistently even when server provides the cut
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
  // Helper ABI to mirror on-chain hashing/domain (added in FuturesMarketFactory)
  const helperAbi = [
    'function computeTagsHash(string[] tags) view returns (bytes32)',
    'function computeCutHash((address facetAddress,uint8 action,bytes4[] functionSelectors)[] cut) view returns (bytes32)',
    'function metaCreateNonce(address) view returns (uint256)',
    'function eip712DomainInfo() view returns (string name,string version,uint256 chainId,address verifyingContract,bytes32 domainSeparator)',
  ];
  const gaslessEnabled = String((process.env as any).NEXT_PUBLIC_GASLESS_CREATE_ENABLED || '').toLowerCase() === 'true';
  const mergedAbi = Array.isArray(factoryAbi) ? [...factoryAbi, ...(gaslessEnabled ? helperAbi : [])] : (gaslessEnabled ? helperAbi : factoryAbi);
  const factory = new ethers.Contract(factoryAddress, mergedAbi, signer);

  // Params
  const startPrice6 = ethers.parseUnits(String(startPrice ?? '1'), 6);
  const settlementTs = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const owner = feeRecipient && ethers.isAddress(feeRecipient) ? feeRecipient : signerAddress;

  // Prevent zero/invalid start price before signing
  const startPriceNum = Number(startPrice);
  if (!Number.isFinite(startPriceNum) || startPriceNum <= 0) {
    throw new Error('Start price must be greater than zero');
  }

  if (gaslessEnabled) {
    // Gasless path: sign typed data and submit via backend relayer
    onProgress?.({ step: 'meta_prepare', status: 'start' });
    // helpers to hash arrays consistent with contract (prefer on-chain helper)
    let tagsHash: string;
    let cutHash: string;
    try {
      tagsHash = await factory.computeTagsHash(tags);
    } catch {
      tagsHash = ethers.keccak256(ethers.solidityPacked(new Array(tags.length).fill('string'), tags));
    }
    try {
      const helperCut = cutArg.map((c) => ({ facetAddress: c[0], action: c[1], functionSelectors: c[2] }));
      cutHash = await factory.computeCutHash(helperCut as any);
    } catch {
      const perCutHashes: string[] = [];
      for (const entry of cutArg) {
        const selectorsHash = ethers.keccak256(ethers.solidityPacked(new Array((entry?.[2] || []).length).fill('bytes4'), entry?.[2] || []));
        const enc = ethers.AbiCoder.defaultAbiCoder().encode(['address','uint8','bytes32'], [entry?.[0], entry?.[1], selectorsHash]);
        perCutHashes.push(ethers.keccak256(enc));
      }
      cutHash = ethers.keccak256(ethers.solidityPacked(new Array(perCutHashes.length).fill('bytes32'), perCutHashes));
    }
    // fetch meta nonce
    let nonceBn: bigint = 0n;
    try {
      nonceBn = await factory.metaCreateNonce(signerAddress);
    } catch {}
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60); // 15 minutes
    // Domain: prefer on-chain helper to avoid env drift
    let domainName = String((process.env as any).NEXT_PUBLIC_EIP712_FACTORY_DOMAIN_NAME || 'DexeteraFactory');
    let domainVersion = String((process.env as any).NEXT_PUBLIC_EIP712_FACTORY_DOMAIN_VERSION || '1');
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
    // Diamond owner must match what the server will pass to metaCreate (admin wallet by default)
    const envDiamondOwner =
      (process.env as any).NEXT_PUBLIC_FACTORY_DIAMOND_OWNER ||
      (globalThis as any).process?.env?.NEXT_PUBLIC_FACTORY_DIAMOND_OWNER;
    const diamondOwner =
      (typeof envDiamondOwner === 'string' && ethers.isAddress(envDiamondOwner))
        ? envDiamondOwner
        : owner;
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
      marketSymbol: symbolNormalized,
      metricUrl: metricUrlNormalized,
      settlementDate: settlementTs,
      startPrice: startPrice6.toString(),
      dataSource,
      tagsHash,
      diamondOwner,
      cutHash,
      initFacet,
      creator: signerAddress,
      nonce: nonceBn.toString(),
      deadline: deadline.toString(),
    };
    // Debug: ensure signer === creator and domain/message are aligned
    try {
      // eslint-disable-next-line no-console
      console.log('[SIGNCHECK][client] signer', signerAddress);
      // eslint-disable-next-line no-console
      console.log('[SIGNCHECK][client] creator', message.creator, 'equal?', String(message.creator).toLowerCase() === String(signerAddress).toLowerCase());
      // eslint-disable-next-line no-console
      console.log('[SIGNCHECK][client] factory', factoryAddress);
      // eslint-disable-next-line no-console
      console.log('[SIGNCHECK][client] chainId', Number(network.chainId));
      // eslint-disable-next-line no-console
      console.log('[SIGNCHECK][client] domain', domain);
      // eslint-disable-next-line no-console
      console.log('[SIGNCHECK][client] hashes', { tagsHash, cutHash });
      // eslint-disable-next-line no-console
      console.log('[SIGNCHECK][client] diamondOwner', diamondOwner);
      // eslint-disable-next-line no-console
      console.log('[SIGNCHECK][client] message', message);
    } catch {}
    const signature = await (signer as any).signTypedData(domain as any, types as any, message as any);
    // Local verification to ensure the signature matches the connected wallet
    try {
      const recoveredLocal = ethers.verifyTypedData(domain as any, types as any, message as any, signature);
      if (recoveredLocal.toLowerCase() !== signerAddress.toLowerCase()) {
      // eslint-disable-next-line no-console
      console.warn('[LOCAL_SIG_MISMATCH]', { recoveredLocal, signerAddress, domain, message, signature });
      throw new Error(`Signature recovered ${recoveredLocal} but expected ${signerAddress}`);
      }
    } catch (err: any) {
      throw new Error(`Signature self-check failed: ${err?.message || String(err)}`);
    }
    try {
      const recovered = ethers.verifyTypedData(domain as any, types as any, message as any, signature);
      // eslint-disable-next-line no-console
      console.log('[SIGNCHECK][client] recovered', recovered);
    } catch {}
    onProgress?.({ step: 'meta_signature', status: 'success' });

    // Submit to backend
    onProgress?.({ step: 'relayer_submit', status: 'start' });
    const res = await fetch('/api/markets/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: symbolNormalized,
        metricUrl: metricUrlNormalized,
        startPrice: String(startPrice),
        startPrice6: startPrice6.toString(), // send scaled value to keep hashing aligned
        dataSource,
        tags,
        creatorWalletAddress: signerAddress,
        settlementDate: settlementTs,
        signature,
        nonce: message.nonce,
        deadline: message.deadline,
        cutArg, // pass client-side cut order to match server hashing
        pipelineId: pipelineId || null,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`relayer http ${res.status}: ${text}`);
    }
    const json = await res.json();
    onProgress?.({ step: 'relayer_submit', status: 'success', data: { hash: json?.transactionHash, orderBook: json?.orderBook, marketId: json?.marketId } });
    // High‑visibility identifiers as soon as they are available (gasless path)
    logMarketIdentifiers(json?.orderBook, json?.marketId);
    return {
      orderBook: json?.orderBook,
      marketId: json?.marketId,
      transactionHash: json?.transactionHash,
      chainId: Number(network.chainId),
      receipt: undefined,
    };
  }
  // Legacy direct on-chain tx
  {
    // Preflight static call (non-fatal)
    try {
      onProgress?.({ step: 'static_call', status: 'start' });
      await factory.getFunction('createFuturesMarketDiamond').staticCall(
        symbol,
        metricUrl,
        settlementTs,
        startPrice6,
        dataSource,
        tags,
        owner,
        cutArg,
        initFacet,
        '0x'
      );
      onProgress?.({ step: 'static_call', status: 'success' });
    } catch (_) {
      onProgress?.({ step: 'static_call', status: 'error' });
    }

    // Send tx
    onProgress?.({ step: 'send_tx', status: 'start' });
    const tx = await factory.getFunction('createFuturesMarketDiamond')(
      symbol,
      metricUrl,
      settlementTs,
      startPrice6,
      dataSource,
      tags,
      owner,
      cutArg,
      initFacet,
      '0x'
    );
    console.info('[createMarketOnChain] sent tx:', tx.hash);
    onProgress?.({ step: 'send_tx', status: 'sent', data: { hash: tx.hash } });
    onProgress?.({ step: 'confirm', status: 'start' });
    const receipt = await tx.wait();
    console.info('[createMarketOnChain] mined tx:', { hash: receipt?.hash || tx.hash, blockNumber: (receipt as any)?.blockNumber });
    onProgress?.({ step: 'confirm', status: 'mined', data: { hash: receipt?.hash || tx.hash, blockNumber: (receipt as any)?.blockNumber } });

    // Parse event
    const iface = new ethers.Interface(factoryAbi);
    let orderBook: string | null = null;
    let marketId: string | null = null;
    for (const log of (receipt as any).logs || []) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'FuturesMarketCreated') {
          orderBook = parsed.args?.orderBook as string;
          marketId = parsed.args?.marketId as string;
          break;
        }
      } catch {}
    }
    if (!orderBook || !marketId) {
      throw new Error('Failed to parse FuturesMarketCreated event');
    }
    onProgress?.({ step: 'parse_event', status: 'success', data: { orderBook, marketId } });
    // High‑visibility identifiers as soon as they are available (direct tx path)
    logMarketIdentifiers(orderBook, marketId);
    // Ensure required placement selectors exist (mirror server-side defensive step)
    try {
      const LoupeABI = ['function facetAddress(bytes4) view returns (address)'];
      const CutABI = [
        'function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)',
      ];
      const loupe = new ethers.Contract(orderBook, LoupeABI, signer);
      const diamondCut = new ethers.Contract(orderBook, CutABI, signer);
      // Identify placement facet address from cut (match any known placement selector); fallback to env
      const placementSelectorsKnown = [
        'placeLimitOrder(uint256,uint256,bool)',
        'placeMarginLimitOrder(uint256,uint256,bool)',
        'placeMarketOrder(uint256,bool)',
        'placeMarginMarketOrder(uint256,bool)',
        'placeMarketOrderWithSlippage(uint256,bool,uint256)',
        'placeMarginMarketOrderWithSlippage(uint256,bool,uint256)',
        'cancelOrder(uint256)',
      ];
      const knownSelectorSet = new Set(placementSelectorsKnown.map((s) => ethers.id(s).slice(0, 10)));
      let placementFacetAddr: string | undefined;
      for (const entry of cutArg) {
        const facetAddr = entry?.[0] as string;
        const selectors = entry?.[2] as string[] | undefined;
        if (Array.isArray(selectors) && selectors.some((sel: string) => knownSelectorSet.has(sel))) {
          placementFacetAddr = facetAddr;
          break;
        }
      }
      if (!placementFacetAddr) {
        const envPlacement =
          (process.env as any).NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET ||
          (globalThis as any).process?.env?.NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET;
        if (envPlacement && ethers.isAddress(envPlacement)) {
          placementFacetAddr = envPlacement;
        }
      }
      // Explicit list of required placement selectors
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
      console.info('[createMarketOnChain] selector check', { placementFacetAddr, missingCount: missing.length });
      onProgress?.({
        step: 'verify_selectors',
        status: missing.length > 0 ? 'missing' : 'ok',
        data: { missingCount: missing.length },
      });
      if (missing.length > 0 && placementFacetAddr && ethers.isAddress(placementFacetAddr)) {
        const cutArg = [{ facetAddress: placementFacetAddr, action: 0, functionSelectors: missing }];
        const txCut = await diamondCut.diamondCut(cutArg as any, ethers.ZeroAddress, '0x');
        console.info('[createMarketOnChain] diamondCut sent to add missing selectors', { tx: txCut.hash, facet: placementFacetAddr, missing });
        onProgress?.({ step: 'diamond_cut', status: 'sent', data: { hash: txCut.hash, facet: placementFacetAddr, missing } });
        await txCut.wait();
        console.info('[createMarketOnChain] diamondCut mined for missing selectors');
        onProgress?.({ step: 'diamond_cut', status: 'mined' });
      } else if (missing.length > 0) {
        console.warn('[createMarketOnChain] missing selectors but no placement facet address available to patch', { missing });
      } else {
        console.info('[createMarketOnChain] all required placement selectors present');
      }
    } catch (_) {
      // Non-fatal safety step
    }

    // Attach GlobalSessionRegistry on MetaTradeFacet so gasless sessions work out of the box
    try {
      const registry =
        (process.env as any).NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS ||
        (globalThis as any).process?.env?.NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS ||
        '';
      if (registry && ethers.isAddress(registry)) {
        const meta = new ethers.Contract(orderBook, (MetaTradeFacetArtifact as any).abi, signer);
        let current: string | null = null;
        try {
          current = await meta.sessionRegistry();
        } catch {}
        // Styled diagnostics
        const banner = 'background: #111827; color: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-weight: 700;';
        const kv = 'color:#93c5fd;';
        const good = 'color:#22c55e; font-weight:700;';
        const bad = 'color:#ef4444; font-weight:700;';
        const meh = 'color:#f59e0b; font-weight:700;';
        // Attempt to read diamond owner (if EIP-173 exposed)
        let diamondOwner: string | null = null;
        try {
          const own = new ethers.Contract(orderBook, ['function owner() view returns (address)'], signer);
          diamondOwner = await own.owner();
        } catch {
          diamondOwner = null;
        }
        // eslint-disable-next-line no-console
        console.groupCollapsed('%c🔐 GASLESS SESSION REGISTRY — CLIENT', banner);
        // eslint-disable-next-line no-console
        console.log('%corderBook', kv, orderBook, `(${shortAddr(orderBook)})`);
        // eslint-disable-next-line no-console
        console.log('%cexpectedRegistry (env)', kv, registry, `(${shortAddr(registry)})`);
        // eslint-disable-next-line no-console
        console.log('%ccurrentRegistry (on-chain)', kv, current || '0x0000000000000000000000000000000000000000', `(${shortAddr(current)})`);
        // eslint-disable-next-line no-console
        console.log('%csigner', kv, await signer.getAddress(), `(${shortAddr(await signer.getAddress())})`);
        // eslint-disable-next-line no-console
        console.log('%cdiamondOwner()', kv, diamondOwner || 'unavailable', diamondOwner ? `(${shortAddr(diamondOwner)})` : '');
        // Best-effort: registry allowlist status
        try {
          const reg = new ethers.Contract(registry, ['function allowedOrderbook(address) view returns (bool)'], signer);
          const allowed = await reg.allowedOrderbook(orderBook);
          // eslint-disable-next-line no-console
          console.log(allowed ? '%c✅ registry.allowedOrderbook = true' : '%c⚠️ registry.allowedOrderbook = false', allowed ? good : meh);
        } catch {
          // eslint-disable-next-line no-console
          console.log('%cℹ️ registry.allowedOrderbook check unavailable (ABI/RPC)', meh);
        }
        if (!current || String(current).toLowerCase() !== String(registry).toLowerCase()) {
          onProgress?.({ step: 'attach_session_registry', status: 'start' });
          if (!current || String(current).toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
            // eslint-disable-next-line no-console
            console.warn('%c❌ meta.sessionRegistry.nonzero — sessionRegistryOnDiamond = 0x0000…0000', bad);
          } else {
            // eslint-disable-next-line no-console
            console.warn('%c❌ meta.sessionRegistry.matches_env — expected %s', bad, shortAddr(registry));
          }
          // eslint-disable-next-line no-console
          console.log('%cAttempting setSessionRegistry(registry)…', kv);
          const txSet = await meta.setSessionRegistry(registry);
          onProgress?.({ step: 'attach_session_registry', status: 'sent', data: { hash: txSet.hash } });
          // eslint-disable-next-line no-console
          console.log('%ctx sent', kv, { hash: txSet.hash });
          await txSet.wait();
          // Post‑verify
          try {
            const after = await meta.sessionRegistry();
            const ok = String(after).toLowerCase() === String(registry).toLowerCase();
            // eslint-disable-next-line no-console
            console.log(ok ? '%c✅ sessionRegistry updated' : '%c⚠️ sessionRegistry update not reflected', ok ? good : meh, { after, short: shortAddr(after) });
          } catch {}
          onProgress?.({ step: 'attach_session_registry', status: 'mined' });
        } else {
          onProgress?.({ step: 'attach_session_registry', status: 'ok', data: { message: 'already_set' } });
          // eslint-disable-next-line no-console
          console.log('%c✅ meta.sessionRegistry ok — already set', good);
        }
        // eslint-disable-next-line no-console
        console.groupEnd();
      } else {
        onProgress?.({ step: 'attach_session_registry', status: 'error', data: { error: 'Missing NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS' } });
        const bad = 'color:#ef4444; font-weight:700;';
        // eslint-disable-next-line no-console
        console.warn('%c⚠️ Missing NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS — cannot attach session registry', bad);
      }
    } catch (e: any) {
      onProgress?.({ step: 'attach_session_registry', status: 'error', data: { error: e?.message || String(e) } });
      const bad = 'color:#ef4444; font-weight:700;';
      // eslint-disable-next-line no-console
      console.error('%c❌ attach_session_registry failed', bad, e?.shortMessage || e?.reason || e?.message || String(e));
    }

    return {
      orderBook,
      marketId,
      transactionHash: (receipt as any)?.hash || tx.hash,
      chainId: Number(network.chainId),
      receipt,
    };
  }

  // (legacy bottom block removed; selector verification and returns are handled in the code paths above)
}


