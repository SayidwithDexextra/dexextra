import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  OBAdminFacetABI,
  OBPricingFacetABI,
  OBOrderPlacementFacetABI,
  OBTradeExecutionFacetABI,
  OBLiquidationFacetABI,
  OBViewFacetABI,
  OBSettlementFacetABI,
} from '@/lib/contracts';

function selectorsFromAbi(abi: any[]): string[] {
  return abi
    .filter((f) => f?.type === 'function')
    .map((f) => {
      const sig = `${f.name}(${(f.inputs || []).map((i: any) => i.type).join(',')})`;
      return ethers.id(sig).slice(0, 10);
    });
}

export async function GET() {
  try {
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

    if (!initFacet || !adminFacet || !pricingFacet || !placementFacet || !execFacet || !liqFacet || !viewFacet || !settleFacet) {
      return NextResponse.json({ error: 'Missing one or more facet addresses in env' }, { status: 400 });
    }

    const cut = [
      { facetAddress: adminFacet, action: 0, functionSelectors: selectorsFromAbi(OBAdminFacetABI as any[]) },
      { facetAddress: pricingFacet, action: 0, functionSelectors: selectorsFromAbi(OBPricingFacetABI as any[]) },
      { facetAddress: placementFacet, action: 0, functionSelectors: selectorsFromAbi(OBOrderPlacementFacetABI as any[]) },
      { facetAddress: execFacet, action: 0, functionSelectors: selectorsFromAbi(OBTradeExecutionFacetABI as any[]) },
      { facetAddress: liqFacet, action: 0, functionSelectors: selectorsFromAbi(OBLiquidationFacetABI as any[]) },
      { facetAddress: viewFacet, action: 0, functionSelectors: selectorsFromAbi(OBViewFacetABI as any[]) },
      { facetAddress: settleFacet, action: 0, functionSelectors: selectorsFromAbi(OBSettlementFacetABI as any[]) },
    ];

    return NextResponse.json({ cut, initFacet });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to build facet cut' }, { status: 500 });
  }
}


