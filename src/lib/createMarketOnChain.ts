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

export async function createMarketOnChain(params: {
  symbol: string;
  metricUrl: string;
  startPrice: string | number;
  dataSource?: string;
  tags?: string[];
  feeRecipient?: string; // optional override; defaults to connected wallet
  onProgress?: (event: ProgressEvent) => void;
}) {
  if (typeof window === 'undefined' || !(window as any).ethereum) {
    throw new Error('No injected wallet found. Please install MetaMask or a compatible wallet.');
  }

  const { symbol, metricUrl, startPrice, dataSource = 'User Provided', tags = [], feeRecipient, onProgress } = params;
  if (!symbol || !metricUrl) throw new Error('Symbol and metricUrl are required');

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
    initFacet = (process.env as any).NEXT_PUBLIC_ORDER_BOOK_INIT_FACET || null;
    const adminSelectors = selectorsFromAbi(OBAdminFacetABI as any[]);
    const pricingSelectors = selectorsFromAbi(OBPricingFacetABI as any[]);
    const placementSelectors = selectorsFromAbi(OBOrderPlacementFacetABI as any[]);
    const execSelectors = selectorsFromAbi(OBTradeExecutionFacetABI as any[]);
    const liqSelectors = selectorsFromAbi(OBLiquidationFacetABI as any[]);
    const viewSelectors = selectorsFromAbi(OBViewFacetABI as any[]);
    const settleSelectors = selectorsFromAbi(OBSettlementFacetABI as any[]);
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
  const factory = new ethers.Contract(factoryAddress, factoryAbi, signer);

  // Params
  const startPrice6 = ethers.parseUnits(String(startPrice ?? '1'), 6);
  const settlementTs = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const owner = feeRecipient && ethers.isAddress(feeRecipient) ? feeRecipient : signerAddress;

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

  return {
    orderBook,
    marketId,
    transactionHash: (receipt as any)?.hash || tx.hash,
    chainId: Number(network.chainId),
    receipt,
  };
}


