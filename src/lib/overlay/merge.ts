/**
 * Liquidity Overlay — merge helpers.
 *
 * Pure functions that fold synthetic overlay liquidity into the real data
 * shapes the UI already consumes, so the display layer needs only tiny edits.
 * These are visual-only: they never mutate on-chain state.
 */

import type { MarketOverlayPayload, OverlayTrade } from './types';

export interface DepthShape {
  bidPrices: number[];
  bidAmounts: number[];
  askPrices: number[];
  askAmounts: number[];
}

/** OnChain-trade-compatible shape (mirrors useAllTrades.OnChainTrade). */
export interface TradeRowShape {
  tradeId: string;
  buyer: string;
  seller: string;
  price: number;
  amount: number;
  timestamp: number; // unix seconds
  tradeValue: number;
  buyerFee: number;
  sellerFee: number;
}

/**
 * Fold overlay levels into a real depth snapshot. Overlay uses each level's
 * `remaining` size (what's left after any future matching) so a partially
 * consumed level shows correctly.
 */
export function mergeOverlayDepth(
  real: DepthShape | null | undefined,
  overlay: MarketOverlayPayload | null | undefined
): DepthShape {
  const base: DepthShape = {
    bidPrices: real?.bidPrices ? [...real.bidPrices] : [],
    bidAmounts: real?.bidAmounts ? [...real.bidAmounts] : [],
    askPrices: real?.askPrices ? [...real.askPrices] : [],
    askAmounts: real?.askAmounts ? [...real.askAmounts] : [],
  };

  if (!overlay || !overlay.enabled) return base;

  for (const lv of overlay.bids || []) {
    if (lv.remaining > 0 && lv.price > 0) {
      base.bidPrices.push(lv.price);
      base.bidAmounts.push(lv.remaining);
    }
  }
  for (const lv of overlay.asks || []) {
    if (lv.remaining > 0 && lv.price > 0) {
      base.askPrices.push(lv.price);
      base.askAmounts.push(lv.remaining);
    }
  }

  return base;
}

/** Map a synthetic overlay trade to the on-chain trade row shape. */
export function overlayTradeToRow(t: OverlayTrade): TradeRowShape {
  return {
    tradeId: t.id,
    buyer: '',
    seller: '',
    price: t.price,
    amount: t.size,
    timestamp: Math.floor(t.timestamp / 1000),
    tradeValue: t.price * t.size,
    buyerFee: 0,
    sellerFee: 0,
  };
}

/**
 * Merge overlay trades into a real trade list, newest first, capped. De-dupes
 * by trade id. Overlay trade ids are `ovl-…` so they never collide with real
 * ones.
 */
export function mergeOverlayTrades<T extends TradeRowShape>(
  real: T[] | null | undefined,
  overlay: MarketOverlayPayload | null | undefined,
  cap = 200
): (T | TradeRowShape)[] {
  const realList = real || [];
  if (!overlay || !overlay.enabled || !(overlay.trades?.length)) return realList;

  const seen = new Set(realList.map((t) => t.tradeId));
  const overlayRows = overlay.trades
    .map(overlayTradeToRow)
    .filter((r) => !seen.has(r.tradeId));

  return [...overlayRows, ...realList]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, cap);
}
