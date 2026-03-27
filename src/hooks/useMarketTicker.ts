'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';

export interface MarketTicker {
  market_id: string;
  mark_price: number;
  last_update: string;
  is_stale: boolean;
}

/**
 * Subscribes to Supabase Realtime on `market_tickers` for instant updates,
 * with a single initial HTTP fetch and a low-frequency fallback poll.
 *
 * Accepts either `marketId` (UUID) or `identifier` (symbol). When `marketId`
 * is provided the Realtime channel binds immediately; otherwise the ID is
 * resolved from the initial fetch response.
 */
export function useMarketTicker({ marketId, identifier, refreshInterval = 60_000, enabled = true }: {
  marketId?: string;
  identifier?: string;
  refreshInterval?: number;
  enabled?: boolean;
}) {
  const [data, setData] = useState<MarketTicker | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolvedIdRef = useRef<string | null>(marketId || null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (marketId) resolvedIdRef.current = marketId;
  }, [marketId]);

  const clearFallback = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const fetchOnce = useCallback(async () => {
    if (!enabled) return;
    if (!marketId && !identifier) return;
    try {
      const params = new URLSearchParams();
      if (marketId) params.set('market_id', marketId);
      if (identifier) params.set('identifier', identifier);
      const res = await fetch(`/api/market-ticker?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        if (res.status === 404) {
          setData(null);
          setError(null);
          return;
        }
        throw new Error(json?.error || `Failed to load ticker (HTTP ${res.status})`);
      }
      if (!json?.success) {
        throw new Error(json?.error || 'Failed to load ticker');
      }

      const ticker = json?.ticker as MarketTicker | null;
      if (ticker) {
        setData(ticker);
        if (ticker.market_id) resolvedIdRef.current = ticker.market_id;
      }
      setError(null);
    } catch (e) {
      if ((e as any)?.name !== 'AbortError') {
        setError((e as Error).message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [marketId, identifier, enabled]);

  // Initial fetch + fallback poll
  useEffect(() => {
    if (!enabled || (!marketId && !identifier)) {
      setIsLoading(false);
      setError(null);
      clearFallback();
      return;
    }

    void fetchOnce();

    const interval = Math.max(30_000, refreshInterval);
    const id = setInterval(() => { void fetchOnce(); }, interval);
    fallbackTimerRef.current = id as unknown as ReturnType<typeof setTimeout>;

    return () => {
      clearInterval(id);
      clearFallback();
    };
  }, [marketId, identifier, refreshInterval, enabled, fetchOnce, clearFallback]);

  // Supabase Realtime subscription
  useEffect(() => {
    const id = marketId || resolvedIdRef.current;
    if (!enabled || !id) return;

    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`market-ticker-rt:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'market_tickers', filter: `market_id=eq.${id}` },
        (payload: any) => {
          const rec = payload.new || payload.old;
          if (!rec || rec.market_id !== id) return;

          const markPrice =
            typeof rec.mark_price === 'number' ? rec.mark_price
            : typeof rec.mark_price === 'string' ? Number(rec.mark_price)
            : null;

          setData({
            market_id: rec.market_id,
            mark_price: Number.isFinite(markPrice) ? markPrice! : 0,
            last_update: rec.last_update || new Date().toISOString(),
            is_stale: Boolean(rec.is_stale),
          });
          setError(null);
          setIsLoading(false);
        },
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [enabled, marketId]);

  return { data, isLoading, error, refetch: fetchOnce };
}
