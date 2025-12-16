'use client';

import { useEffect, useRef, useState } from 'react';

export interface MarketTicker {
  market_id: string;
  mark_price: number;
  last_update: string;
  is_stale: boolean;
}

export function useMarketTicker({ marketId, identifier, refreshInterval = 5000, enabled = true }: {
  marketId?: string;
  identifier?: string;
  refreshInterval?: number;
  enabled?: boolean;
}) {
  const [data, setData] = useState<MarketTicker | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const backoffRef = useRef<number>(refreshInterval);
  const refreshRef = useRef<number>(refreshInterval);

  useEffect(() => {
    refreshRef.current = refreshInterval;
  }, [refreshInterval]);

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNext = (ms: number) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      void fetchTicker();
    }, Math.max(250, ms));
  };

  async function fetchTicker() {
    if (!enabled) {
      clearTimer();
      abortRef.current?.abort();
      abortRef.current = null;
      setIsLoading(false);
      setError(null);
      return;
    }
    if (!marketId && !identifier) {
      clearTimer();
      setIsLoading(false);
      setError(null);
      setData(null);
      return;
    }
    try {
      setIsLoading(true);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const params = new URLSearchParams();
      if (marketId) params.set('market_id', marketId);
      if (identifier) params.set('identifier', identifier);
      const res = await fetch(`/api/market-ticker?${params.toString()}`, {
        signal: ac.signal,
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({} as any));

      // Treat "not ready" as non-fatal (avoid spamming console & backend).
      if (!res.ok) {
        if (res.status === 404) {
          setData(null);
          setError(null);
          backoffRef.current = Math.max(refreshRef.current, 60_000);
          return;
        }
        throw new Error(json?.error || `Failed to load ticker (HTTP ${res.status})`);
      }
      if (!json?.success) {
        throw new Error(json?.error || 'Failed to load ticker');
      }

      setData(json?.ticker || null);
      setError(null);
      backoffRef.current = refreshRef.current;
    } catch (e) {
      // Ignore aborts.
      const msg = (e as any)?.name === 'AbortError' ? null : (e as Error).message;
      if (msg) setError(msg);
      // Backoff on transient errors.
      backoffRef.current = Math.min(Math.max(refreshRef.current, 5000) * 2, 60_000);
    } finally {
      setIsLoading(false);
      // Schedule next poll with adaptive backoff.
      if (enabled && (marketId || identifier)) {
        scheduleNext(backoffRef.current);
      }
    }
  }

  useEffect(() => {
    backoffRef.current = refreshInterval;
    void fetchTicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId, identifier, refreshInterval, enabled]);

  useEffect(() => {
    return () => {
      clearTimer();
      abortRef.current?.abort();
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, isLoading, error, refetch: fetchTicker };
}


