/**
 * Liquidity Overlay — server-side store.
 *
 * Owns the authoritative overlay state in Supabase (`market_overlays`) and is
 * the ONLY place that seeds/advances/persists it. Everything the client sees
 * flows through here, which guarantees the "server-shared" property: every
 * user reads the same row, and the deterministic engine means two clients that
 * advance the same stored state to the same wall-clock time compute identical
 * values even before the write lands.
 *
 * All writes use the service-role client (`supabaseAdmin`), so the table's RLS
 * (public read, no anon write) is respected.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { overlayEngine, advanceToNow } from './engine';
import type { MarketOverlayState } from './types';

const TABLE = 'market_overlays';

interface MarketRef {
  marketId: string | null;
  symbol: string;
  basePrice: number;
}

/** Resolve a market's uuid + a sensible anchor price for seeding. */
async function resolveMarketRef(symbol: string): Promise<MarketRef> {
  const sym = symbol.toUpperCase();
  let marketId: string | null = null;
  let basePrice = 1;

  try {
    const { data: market } = await supabaseAdmin
      .from('markets')
      .select('id, symbol, market_identifier, tick_size')
      .or(`market_identifier.ilike.${sym},symbol.ilike.${sym}`)
      .limit(1)
      .maybeSingle();

    if (market) {
      marketId = market.id ?? null;
      if (market.tick_size && Number(market.tick_size) > 0) {
        basePrice = Number(market.tick_size);
      }
      if (marketId) {
        const { data: ticker } = await supabaseAdmin
          .from('market_tickers')
          .select('mark_price')
          .eq('market_id', marketId)
          .maybeSingle();
        if (ticker?.mark_price && Number(ticker.mark_price) > 0) {
          basePrice = Number(ticker.mark_price) / 1_000_000;
        }
      }
    }
  } catch {
    // markets/tickers unavailable — fall back to a neutral anchor.
  }

  return { marketId, symbol: sym, basePrice };
}

async function readState(symbol: string): Promise<MarketOverlayState | null> {
  const sym = symbol.toUpperCase();
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('state')
      .eq('symbol', sym)
      .maybeSingle();
    if (error) return null; // table may not exist yet / RLS — degrade gracefully
    return (data?.state as MarketOverlayState) ?? null;
  } catch {
    return null;
  }
}

async function persistState(state: MarketOverlayState): Promise<void> {
  try {
    await supabaseAdmin.from(TABLE).upsert(
      {
        symbol: state.symbol,
        market_id: state.marketId,
        state,
        mark_price: state.markPrice,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'symbol' }
    );
  } catch {
    // Persistence is best-effort; a failed write just means we re-advance next read.
  }
}

/**
 * Get the full, freshly-advanced overlay state for one market. Seeds a new row
 * if none exists, and persists any advancement. Safe to call frequently.
 */
export async function getAdvancedOverlay(symbol: string): Promise<MarketOverlayState> {
  const sym = symbol.toUpperCase();
  const existing = await readState(sym);

  if (!existing) {
    const ref = await resolveMarketRef(sym);
    const seeded = overlayEngine.seed(ref);
    await persistState(seeded);
    return seeded;
  }

  const advanced = advanceToNow(existing);
  if (advanced !== existing) {
    await persistState(advanced);
  }
  return advanced;
}

/**
 * Batch platform-wide mark prices for a set of symbols.
 *
 * Reads stored state and advances it *in memory* (no write) for freshness —
 * because the engine is deterministic, this stays consistent across users, and
 * durable persistence is handled by per-market views and the tick cron. Any
 * symbols without a row are seeded (a single write each) so they start moving.
 */
export async function getOverlayMarkPrices(symbols: string[]): Promise<Record<string, number>> {
  const syms = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (!syms.length) return {};

  const out: Record<string, number> = {};
  let rows: any[] = [];
  try {
    const { data } = await supabaseAdmin
      .from(TABLE)
      .select('symbol, state')
      .in('symbol', syms);
    rows = data ?? [];
  } catch {
    return {};
  }

  const found = new Set<string>();
  for (const row of rows) {
    const state = row?.state as MarketOverlayState | undefined;
    if (!state) continue;
    found.add(row.symbol);
    const advanced = advanceToNow(state);
    out[row.symbol] = advanced.markPrice;
  }

  // Seed any symbols we've never seen so future reads have live data.
  const missing = syms.filter((s) => !found.has(s));
  for (const sym of missing) {
    try {
      const ref = await resolveMarketRef(sym);
      const seeded = overlayEngine.seed(ref);
      await persistState(seeded);
      out[sym] = seeded.markPrice;
    } catch {
      // ignore individual seed failures
    }
  }

  return out;
}

/**
 * Advance + persist every existing overlay row. Intended for a cron/tick
 * endpoint so prices keep moving even for markets nobody is actively viewing.
 * Returns the number of rows advanced.
 */
export async function advanceAllOverlays(): Promise<number> {
  let rows: any[] = [];
  try {
    const { data } = await supabaseAdmin.from(TABLE).select('state');
    rows = data ?? [];
  } catch {
    return 0;
  }

  let count = 0;
  for (const row of rows) {
    const state = row?.state as MarketOverlayState | undefined;
    if (!state) continue;
    const advanced = advanceToNow(state);
    if (advanced !== state) {
      await persistState(advanced);
      count += 1;
    }
  }
  return count;
}
