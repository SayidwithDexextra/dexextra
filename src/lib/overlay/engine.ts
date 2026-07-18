/**
 * Liquidity Overlay — pluggable engine.
 *
 * The engine is the "brain" that produces overlay values. It is intentionally
 * behind a small interface so the current stub (a deterministic random walk +
 * placeholder book/tape) can later be swapped for a real seeding strategy
 * without touching the server store, the API, or any UI wiring.
 *
 * Contract:
 *   - `seed()`   creates fresh state anchored to a real base price.
 *   - `advance()` moves state forward N discrete steps (deterministically,
 *                 given the state's seed + tick), returning a NEW state.
 *
 * Determinism matters: state is persisted server-side and advanced lazily on
 * read, so the same (seed, tick) must always yield the same result.
 */

import { OVERLAY_CONFIG } from './config';
import type {
  MarketOverlayState,
  OverlayLevel,
  OverlayTrade,
  OverlaySide,
} from './types';

export interface OverlaySeedParams {
  symbol: string;
  marketId: string | null;
  /** Real anchor price (human units). Falls back to 1 if unknown. */
  basePrice: number;
  /** Optional explicit seed (else derived from symbol). */
  seed?: number;
}

export interface OverlayEngine {
  readonly id: string;
  seed(params: OverlaySeedParams): MarketOverlayState;
  advance(state: MarketOverlayState, steps: number): MarketOverlayState;
}

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) — tiny, fast, reproducible.
// ---------------------------------------------------------------------------
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (for deriving a seed from a symbol). */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Box–Muller standard normal from a uniform generator. */
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Stub engine
// ---------------------------------------------------------------------------
export class StubOverlayEngine implements OverlayEngine {
  readonly id = 'stub-v1';

  seed(params: OverlaySeedParams): MarketOverlayState {
    const symbol = params.symbol.toUpperCase();
    const base = Number.isFinite(params.basePrice) && params.basePrice > 0 ? params.basePrice : 1;
    const seed = params.seed ?? hashString(symbol);
    const now = Date.now();

    const state: MarketOverlayState = {
      marketId: params.marketId,
      symbol,
      basePrice: base,
      markPrice: base,
      bids: [],
      asks: [],
      trades: [],
      seed,
      tick: 0,
      updatedAt: now,
    };

    // Build the initial book/tape so first render already has liquidity.
    state.bids = this.buildBook(state, 'bid');
    state.asks = this.buildBook(state, 'ask');
    return state;
  }

  advance(state: MarketOverlayState, steps: number): MarketOverlayState {
    if (steps <= 0) return state;

    let markPrice = state.markPrice;
    let tick = state.tick;
    let trades = state.trades.slice();
    const base = state.basePrice;

    for (let i = 0; i < steps; i++) {
      tick += 1;
      const rng = mulberry32((state.seed ^ (tick * 0x9e3779b1)) >>> 0);

      // --- mark price: mean-reverting random walk, clamped to a band ---
      const shock = gaussian(rng) * OVERLAY_CONFIG.volatilityPerTick;
      const reversion = OVERLAY_CONFIG.meanReversion * ((base - markPrice) / base);
      markPrice = markPrice * (1 + shock + reversion);

      const maxUp = base * (1 + OVERLAY_CONFIG.maxDriftFraction);
      const maxDown = base * (1 - OVERLAY_CONFIG.maxDriftFraction);
      markPrice = Math.min(maxUp, Math.max(maxDown, markPrice));
      if (!Number.isFinite(markPrice) || markPrice <= 0) markPrice = base;

      // --- synthetic trades around the new mark ---
      if (rng() < OVERLAY_CONFIG.tradeChancePerTick) {
        const nTrades = 1 + Math.floor(rng() * OVERLAY_CONFIG.tradesPerTickMax);
        for (let t = 0; t < nTrades; t++) {
          const side: OverlaySide = rng() < 0.5 ? 'bid' : 'ask';
          const priceJitter = (rng() - 0.5) * 2 * (OVERLAY_CONFIG.bookHalfSpreadBps / 10_000);
          const price = round(markPrice * (1 + priceJitter), 8);
          // USD-notional sizing → unit size derived from price.
          const notionalUsd =
            OVERLAY_CONFIG.tradeUsdBase * (1 + (rng() - 0.5) * OVERLAY_CONFIG.tradeUsdJitter);
          const size = round(notionalUsd / Math.max(price, 0.000001), 6);
          trades.unshift({
            id: `ovl-${state.symbol}-${tick}-${t}`,
            price,
            size: Math.max(size, 0.000001),
            side,
            timestamp: state.updatedAt + i * OVERLAY_CONFIG.tickIntervalMs,
            synthetic: true,
          });
        }
      }
    }

    if (trades.length > OVERLAY_CONFIG.maxTrades) {
      trades = trades.slice(0, OVERLAY_CONFIG.maxTrades);
    }

    const next: MarketOverlayState = {
      ...state,
      markPrice,
      tick,
      trades,
      updatedAt: Date.now(),
    };

    // Rebuild the book around the new mark, preserving level identity and any
    // previously-consumed `remaining` so the future matcher stays coherent.
    next.bids = this.buildBook(next, 'bid', state.bids);
    next.asks = this.buildBook(next, 'ask', state.asks);
    return next;
  }

  /**
   * Placeholder book generator. Levels float with the mark but keep stable ids
   * (`<symbol>-<side>-<index>`) so consumption state survives across ticks.
   *
   * `prev` carries forward the consumed fraction of each level's size.
   */
  private buildBook(
    state: MarketOverlayState,
    side: OverlaySide,
    prev?: OverlayLevel[]
  ): OverlayLevel[] {
    const levels: OverlayLevel[] = [];
    const mark = state.markPrice;
    const dir = side === 'bid' ? -1 : 1;
    const half = OVERLAY_CONFIG.bookHalfSpreadBps / 10_000;
    const step = OVERLAY_CONFIG.bookStepBps / 10_000;

    const prevById = new Map<string, OverlayLevel>();
    for (const lv of prev ?? []) prevById.set(lv.id, lv);

    for (let i = 0; i < OVERLAY_CONFIG.bookLevels; i++) {
      const id = `${state.symbol}-${side}-${i}`;
      const offset = half + i * step;
      const price = round(mark * (1 + dir * offset), 8);
      if (price <= 0) continue;

      // Deterministic per-level USD notional (grows with depth), jittered by
      // tick; unit size is derived from price so total liquidity is price-agnostic.
      const rng = mulberry32((state.seed ^ hashString(id) ^ (state.tick * 2654435761)) >>> 0);
      const growth = 1 + i * OVERLAY_CONFIG.bookLevelUsdGrowth;
      const jitter = 1 + (rng() - 0.5) * OVERLAY_CONFIG.bookUsdJitter;
      const notionalUsd = OVERLAY_CONFIG.bookLevelUsdBase * growth * jitter;
      const size = round(Math.max(notionalUsd / price, 0.000001), 6);

      // Preserve consumed fraction from the previous version of this level.
      const before = prevById.get(id);
      let remaining = size;
      if (before && before.size > 0) {
        const consumedFraction = Math.max(0, Math.min(1, 1 - before.remaining / before.size));
        remaining = round(size * (1 - consumedFraction), 6);
      }

      levels.push({ id, side, price, size, remaining });
    }

    return levels;
  }
}

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

/** The engine currently in use. Swap this to change overlay behaviour. */
export const overlayEngine: OverlayEngine = new StubOverlayEngine();

/**
 * Advance a persisted state to "now", replaying at most `maxCatchupTicks`
 * steps based on elapsed wall-clock time. Returns the same state if it's
 * already fresh.
 */
export function advanceToNow(state: MarketOverlayState): MarketOverlayState {
  const elapsed = Date.now() - state.updatedAt;
  if (elapsed < OVERLAY_CONFIG.staleAfterMs) return state;
  const steps = Math.min(
    OVERLAY_CONFIG.maxCatchupTicks,
    Math.max(1, Math.floor(elapsed / OVERLAY_CONFIG.tickIntervalMs))
  );
  return overlayEngine.advance(state, steps);
}
