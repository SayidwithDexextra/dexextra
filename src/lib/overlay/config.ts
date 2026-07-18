/**
 * Liquidity Overlay — configuration + feature flag.
 *
 * The whole overlay system is gated by a single flag so it can be cleanly
 * switched off (falling back to 100% real data).
 *
 *   Server:  LIQUIDITY_OVERLAY_ENABLED=true
 *   Client:  NEXT_PUBLIC_LIQUIDITY_OVERLAY_ENABLED=true
 *
 * For local experimentation you can also force it on/off at runtime from the
 * browser console with:  window.__OVERLAY_FORCE__ = true | false
 */

/** Server-side flag check (safe to call in API routes / node runtime). */
export function isOverlayEnabledServer(): boolean {
  return (
    process.env.LIQUIDITY_OVERLAY_ENABLED === 'true' ||
    process.env.NEXT_PUBLIC_LIQUIDITY_OVERLAY_ENABLED === 'true'
  );
}

/** Client-side flag check (respects a runtime override for debugging). */
export function isOverlayEnabledClient(): boolean {
  if (typeof window !== 'undefined') {
    const forced = (window as any).__OVERLAY_FORCE__;
    if (typeof forced === 'boolean') return forced;
  }
  return process.env.NEXT_PUBLIC_LIQUIDITY_OVERLAY_ENABLED === 'true';
}

/**
 * Tunable knobs for the stub engine and distribution layer.
 *
 * NOTE: the order-book seeding numbers here are placeholders — per the current
 * scope we are only building the *infrastructure* that can carry synthetic
 * liquidity, not the real seeding strategy. Swap `bookLevels`/sizes later.
 */
export const OVERLAY_CONFIG = {
  // ---- Advance timing (used by lazy advance-on-read) ----
  /** One synthetic step represents this much wall-clock time. */
  tickIntervalMs: 3_000,
  /** Cap how many steps a single lazy advance will replay after a gap. */
  maxCatchupTicks: 40,
  /** Re-advance server state only if it's older than this. */
  staleAfterMs: 2_500,

  // ---- Mark-price random walk ----
  /** Std-dev of per-tick return, as a fraction of price. */
  volatilityPerTick: 0.0009,
  /** Gentle pull back toward the anchor so the walk doesn't run away. */
  meanReversion: 0.02,
  /** Hard clamp: overlay mark stays within this band around basePrice. */
  maxDriftFraction: 0.25,

  // ---- Order-book generation (STUB — replace seeding later) ----
  // Sizing is USD-notional so total displayed liquidity stays consistent
  // regardless of a market's price (unit size = notionalUsd / price). Tuned
  // small for the closed beta (~100 testers, max 100 USDC deposit): each side
  // is a few hundred USD at most, not thousands.
  bookLevels: 12,
  /** Half-spread from mark, in basis points. */
  bookHalfSpreadBps: 6,
  /** Spacing between adjacent levels, in basis points. */
  bookStepBps: 5,
  /** Base USD notional per level. Unit size is derived: usd / price.
   *  Sized so a ~100 USDC account (leveraged notional a few hundred USD) can
   *  clearly fill against the top of book — each side totals ~$1–1.5k. */
  bookLevelUsdBase: 90,
  /** Levels farther from mark hold proportionally more notional. */
  bookLevelUsdGrowth: 0.06,
  /** Multiplicative notional jitter (0 = none, 0.5 = ±50%). */
  bookUsdJitter: 0.5,

  // ---- Trade tape generation ----
  maxTrades: 60,
  /** Max synthetic trades minted per tick. */
  tradesPerTickMax: 2,
  /** Probability a given tick emits any trades at all. */
  tradeChancePerTick: 0.7,
  /** Base USD notional per synthetic trade. Unit size is derived: usd / price. */
  tradeUsdBase: 35,
  tradeUsdJitter: 0.8,

  // ---- Client polling ----
  /** How often the per-market overlay hook re-fetches the full payload. */
  clientPollMs: 3_000,
  /** How often the platform-wide price cache batch-refreshes. */
  clientBatchPollMs: 5_000,
} as const;

export type OverlayConfig = typeof OVERLAY_CONFIG;
