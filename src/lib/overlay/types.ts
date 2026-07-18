/**
 * Liquidity Overlay — shared type definitions.
 *
 * The overlay is a strictly *visual* layer superimposed on top of the real
 * on-chain markets. It never touches contract calls or order submission. Its
 * job is to (a) drive a platform-wide "mark price" that everyone sees and
 * (b) inject synthetic liquidity (order-book levels + a trade tape) on the
 * market page a user is viewing.
 *
 * IMPORTANT (future matching): each synthetic order-book level carries a
 * stable `id` and a `remaining` size. This is intentional — a later matching
 * engine will be able to intercept an incoming user order, consume specific
 * overlay levels (decrementing `remaining`), and mint a *real* trade against
 * them. The data model is therefore designed to be *consumable*, not just
 * *displayable*.
 */

export type OverlaySide = 'bid' | 'ask';

/** A single synthetic order-book level. Consumable by the future matcher. */
export interface OverlayLevel {
  /** Stable identity across ticks. Enables future consumption/matching. */
  id: string;
  side: OverlaySide;
  /** Human units (dollars), same scale the UI renders. */
  price: number;
  /** Original synthetic size in human units (18-decimal equivalent). */
  size: number;
  /** Size not yet consumed by a matched real order. Starts equal to `size`. */
  remaining: number;
}

/** A single synthetic trade shown in the transactions/trades tape. */
export interface OverlayTrade {
  /** Stable id, prefixed `ovl-` so it never collides with on-chain trade ids. */
  id: string;
  /** Human units (dollars). */
  price: number;
  /** Human units. */
  size: number;
  /** Aggressor side: `bid` = buy-side taker (green), `ask` = sell-side taker (red). */
  side: OverlaySide;
  /** Epoch milliseconds. */
  timestamp: number;
  /** Always true — lets consumers distinguish overlay trades from real ones. */
  synthetic: true;
}

/**
 * Full authoritative overlay state for one market. Persisted server-side
 * (Supabase `market_overlays.state`) so every user sees identical values.
 */
export interface MarketOverlayState {
  /** Supabase markets.id (uuid) if known, else null. */
  marketId: string | null;
  /** Uppercase market identifier / symbol used as the primary key. */
  symbol: string;
  /** Real anchor price the walk is seeded from (human units). */
  basePrice: number;
  /** Current overlaid mark price (human units). */
  markPrice: number;
  bids: OverlayLevel[];
  asks: OverlayLevel[];
  /** Most-recent-first, capped. */
  trades: OverlayTrade[];
  /** Deterministic RNG seed for reproducibility. */
  seed: number;
  /** Monotonic tick counter (number of engine advances). */
  tick: number;
  /** Epoch milliseconds of the last advance. */
  updatedAt: number;
}

/**
 * The client-facing payload returned by the overlay API. This is what UI
 * consumers read; it never includes engine internals like the RNG seed.
 */
export interface MarketOverlayPayload {
  enabled: boolean;
  symbol: string;
  marketId: string | null;
  markPrice: number | null;
  basePrice: number | null;
  bids: OverlayLevel[];
  asks: OverlayLevel[];
  trades: OverlayTrade[];
  updatedAt: number;
}

/** Convert an authoritative state into a client payload. */
export function toOverlayPayload(state: MarketOverlayState, enabled: boolean): MarketOverlayPayload {
  return {
    enabled,
    symbol: state.symbol,
    marketId: state.marketId,
    markPrice: state.markPrice,
    basePrice: state.basePrice,
    bids: state.bids,
    asks: state.asks,
    trades: state.trades,
    updatedAt: state.updatedAt,
  };
}

/** A disabled/empty payload, returned when the overlay flag is off. */
export function emptyOverlayPayload(symbol: string, marketId: string | null = null): MarketOverlayPayload {
  return {
    enabled: false,
    symbol: symbol.toUpperCase(),
    marketId,
    markPrice: null,
    basePrice: null,
    bids: [],
    asks: [],
    trades: [],
    updatedAt: 0,
  };
}
