'use client';

/**
 * useMarketOverlay — per-market overlay poller with instant provisional seed.
 *
 * Fetches the FULL overlay payload (mark price + synthetic order book +
 * synthetic trade tape) for the market a user is currently viewing, polls it
 * on an interval, and pushes it into the shared client cache so the rest of
 * the app (price displays, P&L, etc.) sees the same values.
 *
 * INSTANT LIQUIDITY: the first `/api/overlay/[symbol]` fetch has a round-trip
 * (it also seeds the DB row), which would otherwise leave a visible gap before
 * synthetic liquidity appears. To close that gap we seed a *provisional*
 * overlay on the client the moment any credible base price is known — using
 * the SAME deterministic engine + seed the server uses, so when the
 * authoritative payload arrives it reconciles seamlessly (levels land at
 * essentially the same prices/sizes). The server payload is always
 * authoritative and replaces the provisional one.
 *
 * Returns a disabled/empty payload when the overlay flag is off, so callers
 * can wire it in unconditionally and it becomes a no-op.
 */

import { useEffect, useRef, useState } from 'react';
import { isOverlayEnabledClient, OVERLAY_CONFIG } from '@/lib/overlay/config';
import { overlayCache } from '@/lib/overlay/clientCache';
import { overlayEngine } from '@/lib/overlay/engine';
import { emptyOverlayPayload, toOverlayPayload, type MarketOverlayPayload } from '@/lib/overlay/types';

export function useMarketOverlay(
  symbol: string | null | undefined,
  marketId?: string | null,
  /** Best real price known so far — anchors the instant provisional seed. */
  basePriceHint?: number
): MarketOverlayPayload {
  const enabled = isOverlayEnabledClient();
  const sym = (symbol || '').toUpperCase();
  const [payload, setPayload] = useState<MarketOverlayPayload>(() => emptyOverlayPayload(sym, marketId ?? null));
  const mountedRef = useRef(true);
  const serverArrivedRef = useRef(false);
  const provisionalRef = useRef(false);
  const provisionalBaseRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset provisional/authoritative flags whenever the market changes.
  useEffect(() => {
    serverArrivedRef.current = false;
    provisionalRef.current = false;
    provisionalBaseRef.current = 0;
    if (!enabled || !sym) {
      setPayload(emptyOverlayPayload(sym, marketId ?? null));
    }
  }, [enabled, sym, marketId]);

  // Instant provisional overlay: reuse a warm cache entry, else seed locally as
  // soon as we have a TRUSTED base price. Re-seeds if a materially different
  // anchor arrives before the authoritative payload (e.g. the DB ticker loads a
  // moment after mount) so we never linger on a wrong-scale book.
  useEffect(() => {
    if (!enabled || !sym) return;
    if (serverArrivedRef.current) return;

    // 1) A warm cache entry (e.g. from a prior visit) with real book depth.
    const cached =
      overlayCache.getEntry(sym) || (marketId ? overlayCache.getEntry(marketId) : null);
    if (cached && (cached.bids?.length || cached.asks?.length)) {
      provisionalRef.current = true;
      provisionalBaseRef.current = cached.basePrice ?? cached.markPrice ?? 0;
      setPayload(cached);
      return;
    }

    // 2) Seed locally from the best trusted price available right now.
    const base =
      basePriceHint && basePriceHint > 0
        ? basePriceHint
        : overlayCache.getMarkPrice(sym) ?? 0;
    if (base <= 0) return; // no trusted price yet — wait rather than show wrong scale

    const prevBase = provisionalBaseRef.current;
    const materiallyDifferent =
      prevBase <= 0 || Math.abs(base - prevBase) / prevBase > 0.02;
    if (!provisionalRef.current || materiallyDifferent) {
      provisionalRef.current = true;
      provisionalBaseRef.current = base;
      const seeded = toOverlayPayload(
        overlayEngine.seed({ symbol: sym, marketId: marketId ?? null, basePrice: base }),
        true
      );
      overlayCache.setPayload(seeded);
      setPayload(seeded);
    }
  }, [enabled, sym, marketId, basePriceHint]);

  // Authoritative fetch + poll.
  useEffect(() => {
    if (!enabled || !sym) return;

    overlayCache.registerInterest(sym);
    if (marketId) overlayCache.registerInterest(marketId);

    let cancelled = false;

    const fetchOverlay = async () => {
      try {
        const res = await fetch(`/api/overlay/${encodeURIComponent(sym)}`);
        const json = await res.json();
        const data: MarketOverlayPayload | undefined = json?.data;
        if (!data || cancelled || !mountedRef.current) return;
        // Ensure marketId is populated so cache indexes under the uuid too.
        const enriched: MarketOverlayPayload =
          !data.marketId && marketId ? { ...data, marketId } : data;
        serverArrivedRef.current = true;
        overlayCache.setPayload(enriched);
        setPayload(enriched);
      } catch {
        /* transient — retry next interval */
      }
    };

    fetchOverlay();
    const id = setInterval(fetchOverlay, OVERLAY_CONFIG.clientPollMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, sym, marketId]);

  return payload;
}
