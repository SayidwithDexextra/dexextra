import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import path from 'path';
// Use statically shipped full ABIs to avoid dynamic filesystem requires
// These JSON files are bundled with the app
// Note: If you update facet contracts, regenerate these JSONs
import OBAdminFacetArtifact from '@/lib/abis/facets/OBAdminFacet.json';
import OBPricingFacetArtifact from '@/lib/abis/facets/OBPricingFacet.json';
import OBOrderPlacementFacetArtifact from '@/lib/abis/facets/OBOrderPlacementFacet.json';
import OBTradeExecutionFacetArtifact from '@/lib/abis/facets/OBTradeExecutionFacet.json';
import OBLiquidationFacetArtifact from '@/lib/abis/facets/OBLiquidationFacet.json';
import OBViewFacetArtifact from '@/lib/abis/facets/OBViewFacet.json';
import OBSettlementFacetArtifact from '@/lib/abis/facets/OBSettlementFacet.json';
import OrderBookVaultAdminFacetArtifact from '@/lib/abis/facets/OrderBookVaultAdminFacet.json';
import MarketLifecycleFacetArtifact from '@/lib/abis/facets/MarketLifecycleFacet.json';
import MetaTradeFacetArtifact from '@/lib/abis/facets/MetaTradeFacet.json';

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
    build_cut: 'Build Diamond Cut',
    validate_env: 'Validate Env',
    respond: 'Respond',
  };
  return map[step] || step;
}

function summarizeData(data?: Record<string, any>) {
  if (!data || typeof data !== 'object') return '';
  const parts: string[] = [];
  if (Array.isArray((data as any).perFacet)) parts.push(`facets=${(data as any).perFacet.length}`);
  if ((data as any).totalSelectors != null) parts.push(`selectors=${(data as any).totalSelectors}`);
  if ((data as any).reason) parts.push(`reason=${trunc((data as any).reason, 40)}`);
  if ((data as any).duplicatesCount != null) parts.push(`dupes=${(data as any).duplicatesCount}`);
  if ((data as any).emptyFacets && Array.isArray((data as any).emptyFacets)) {
    const list = (data as any).emptyFacets.slice(0, 3).map((a: string) => shortAddr(a)).join(',');
    parts.push(`empty=[${list}${(data as any).emptyFacets.length > 3 ? ',…' : ''}]`);
  }
  if ((data as any).missing) parts.push(`missingKeys=${Object.keys((data as any).missing).filter(k => (data as any).missing[k]).length}`);
  if ((data as any).error) parts.push(`error=${trunc((data as any).error, 100)}`);
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
    const tag = `${COLORS.bold}${COLORS.cyan}[OrderBookCut]${COLORS.reset}`;
    const name = friendly(step);
    const emoji = status === 'start' ? '🟦' : status === 'success' ? '✅' : '❌';
    const color =
      status === 'start' ? COLORS.yellow :
      status === 'success' ? COLORS.green :
      COLORS.red;
    const human = `${tag} ${emoji} ${color}${name}${COLORS.reset}${summarizeData(data)}  ${COLORS.dim}${ts}${COLORS.reset}`;
    // Human-friendly line
    console.log(human);
    // Structured JSON (machine-readable)
    console.log(JSON.stringify({
      area: 'market_creation',
      context: 'orderbook_cut',
      step,
      status,
      timestamp: new Date().toISOString(),
      ...((data && typeof data === 'object') ? data : {})
    }));
  } catch {}
}

function selectorsFromAbi(abi: any[]): string[] {
  try {
    // Support string-based ABIs and JSON ABI fragments uniformly via ethers.Interface
    const iface = new ethers.Interface(abi as any);
    return (iface.fragments as any[])
      .filter((frag) => frag?.type === 'function')
      .map((frag) => ethers.id((frag as any).format('sighash')).slice(0, 10));
  } catch (e: any) {
    // Fallback to previous best-effort (may return empty if abi items are strings)
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

function loadFacetAbi(contractName: string): any[] {
  switch (contractName) {
    case 'OBAdminFacet': return (OBAdminFacetArtifact as any)?.abi || [];
    case 'OBPricingFacet': return (OBPricingFacetArtifact as any)?.abi || [];
    case 'OBOrderPlacementFacet': return (OBOrderPlacementFacetArtifact as any)?.abi || [];
    case 'OBTradeExecutionFacet': return (OBTradeExecutionFacetArtifact as any)?.abi || [];
    case 'OBLiquidationFacet': return (OBLiquidationFacetArtifact as any)?.abi || [];
    case 'OBViewFacet': return (OBViewFacetArtifact as any)?.abi || [];
    case 'OBSettlementFacet': return (OBSettlementFacetArtifact as any)?.abi || [];
    case 'OrderBookVaultAdminFacet': return (OrderBookVaultAdminFacetArtifact as any)?.abi || [];
    case 'MarketLifecycleFacet': return (MarketLifecycleFacetArtifact as any)?.abi || [];
    case 'MetaTradeFacet': return (MetaTradeFacetArtifact as any)?.abi || [];
    default: return [];
  }
}

export async function GET() {
  try {
    logStep('build_cut', 'start');
    const initFacet =
      process.env.ORDER_BOOK_INIT_FACET || process.env.NEXT_PUBLIC_ORDER_BOOK_INIT_FACET;

    const adminFacet = process.env.OB_ADMIN_FACET || process.env.NEXT_PUBLIC_OB_ADMIN_FACET;
    const pricingFacet = process.env.OB_PRICING_FACET || process.env.NEXT_PUBLIC_OB_PRICING_FACET;
    const placementFacet =
      process.env.OB_ORDER_PLACEMENT_FACET || process.env.NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET;
    const execFacet =
      process.env.OB_TRADE_EXECUTION_FACET || process.env.NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET;
    const liqFacet = process.env.OB_LIQUIDATION_FACET || process.env.NEXT_PUBLIC_OB_LIQUIDATION_FACET;
    const viewFacet = process.env.OB_VIEW_FACET || process.env.NEXT_PUBLIC_OB_VIEW_FACET;
    const settleFacet = process.env.OB_SETTLEMENT_FACET || process.env.NEXT_PUBLIC_OB_SETTLEMENT_FACET;
    const vaultFacet =
      process.env.ORDERBOOK_VALUT_FACET ||
      process.env.NEXT_PUBLIC_ORDERBOOK_VALUT_FACET ||
      process.env.ORDERBOOK_VAULT_FACET ||
      process.env.NEXT_PUBLIC_ORDERBOOK_VAULT_FACET;
    const lifecycleFacet = process.env.MARKET_LIFECYCLE_FACET || process.env.NEXT_PUBLIC_MARKET_LIFECYCLE_FACET;
    const metaTradeFacet = process.env.META_TRADE_FACET || process.env.NEXT_PUBLIC_META_TRADE_FACET;

    if (!initFacet || !adminFacet || !pricingFacet || !placementFacet || !execFacet || !liqFacet || !viewFacet || !settleFacet || !vaultFacet || !lifecycleFacet || !metaTradeFacet) {
      logStep('validate_env', 'error', {
        missing: {
          initFacet: !initFacet,
          adminFacet: !adminFacet,
          pricingFacet: !pricingFacet,
          placementFacet: !placementFacet,
          execFacet: !execFacet,
          liqFacet: !liqFacet,
          viewFacet: !viewFacet,
          settleFacet: !settleFacet,
          vaultFacet: !vaultFacet,
          lifecycleFacet: !lifecycleFacet,
          metaTradeFacet: !metaTradeFacet,
        }
      });
      return NextResponse.json({ error: 'Missing one or more facet addresses in env' }, { status: 400 });
    }
    logStep('validate_env', 'success');

    // Load ABIs from statically shipped JSON to avoid selector drift/duplication
    const adminAbi = loadFacetAbi('OBAdminFacet');
    const pricingAbi = loadFacetAbi('OBPricingFacet');
    const placementAbi = loadFacetAbi('OBOrderPlacementFacet');
    const execAbi = loadFacetAbi('OBTradeExecutionFacet');
    const liqAbi = loadFacetAbi('OBLiquidationFacet');
    const viewAbi = loadFacetAbi('OBViewFacet');
    const settleAbi = loadFacetAbi('OBSettlementFacet');
    const vaultAbi = loadFacetAbi('OrderBookVaultAdminFacet');
    const lifecycleAbi = loadFacetAbi('MarketLifecycleFacet');
    const metaAbi = loadFacetAbi('MetaTradeFacet');

    const cut = [
      { facetAddress: adminFacet, action: 0, functionSelectors: selectorsFromAbi(adminAbi) },
      { facetAddress: pricingFacet, action: 0, functionSelectors: selectorsFromAbi(pricingAbi) },
      { facetAddress: placementFacet, action: 0, functionSelectors: selectorsFromAbi(placementAbi) },
      { facetAddress: execFacet, action: 0, functionSelectors: selectorsFromAbi(execAbi) },
      { facetAddress: liqFacet, action: 0, functionSelectors: selectorsFromAbi(liqAbi) },
      { facetAddress: viewFacet, action: 0, functionSelectors: selectorsFromAbi(viewAbi) },
      { facetAddress: settleFacet, action: 0, functionSelectors: selectorsFromAbi(settleAbi) },
      { facetAddress: vaultFacet, action: 0, functionSelectors: selectorsFromAbi(vaultAbi) },
      { facetAddress: lifecycleFacet, action: 0, functionSelectors: selectorsFromAbi(lifecycleAbi) },
      { facetAddress: metaTradeFacet, action: 0, functionSelectors: selectorsFromAbi(metaAbi) },
    ];

    // Fail fast if any facet has zero selectors to avoid creating an unusable Diamond
    const emptyFacets = cut
      .filter((c) => !Array.isArray(c.functionSelectors) || c.functionSelectors.length === 0)
      .map((c) => c.facetAddress);
    if (emptyFacets.length > 0) {
      logStep('build_cut', 'error', { reason: 'empty_selectors', emptyFacets });
      return NextResponse.json({ error: 'Facet selectors could not be built', emptyFacets }, { status: 500 });
    }

    // Detect cross-facet duplicate selectors which would revert with "LibDiamond: Selector exists"
    const selectorToFacets: Record<string, string[]> = {};
    for (const entry of cut) {
      for (const sel of entry.functionSelectors) {
        selectorToFacets[sel] = selectorToFacets[sel] || [];
        selectorToFacets[sel].push(entry.facetAddress);
      }
    }
    const duplicates = Object.entries(selectorToFacets)
      .filter(([, arr]) => arr.length > 1)
      .map(([sel, arr]) => ({ selector: sel, facets: arr }));
    if (duplicates.length > 0) {
      logStep('build_cut', 'error', { reason: 'duplicate_selectors', duplicatesCount: duplicates.length, duplicates });
      return NextResponse.json({ error: 'Duplicate selectors across facets', duplicates }, { status: 500 });
    }

    const perFacet = cut.map((c) => ({ facetAddress: c.facetAddress, selectors: c.functionSelectors.length }));
    const totalSelectors = cut.reduce((sum, c) => sum + (c.functionSelectors?.length || 0), 0);
    logStep('build_cut', 'success', { perFacet, totalSelectors });

    logStep('respond', 'start');
    const resp = NextResponse.json({ cut, initFacet });
    logStep('respond', 'success');
    return resp;
  } catch (e: any) {
    logStep('build_cut', 'error', { error: e?.message || String(e) });
    return NextResponse.json({ error: e?.message || 'Failed to build facet cut' }, { status: 500 });
  }
}


