'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../lib/supabase-browser';

export interface UseMetricLivePriceOptions {
  enabled?: boolean;
}

export interface UseMetricLivePriceResult {
  value: number | null;
  updatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  retryStartWorker: () => Promise<boolean>;
}

export function useMetricLivePrice(marketId: string, options?: UseMetricLivePriceOptions): UseMetricLivePriceResult {
  const supabase = getSupabaseClient();
  const enabled = options?.enabled ?? true;

  const [value, setValue] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const canRun = useMemo(() => enabled && typeof marketId === 'string' && marketId.length > 0, [enabled, marketId]);

  const startWorkerOnce = useCallback(async (): Promise<boolean> => {
    if (!canRun) return false;
    try {
      // NOTE:
      // Calling Supabase Edge Functions directly from the browser can fail due to CORS.
      // Proxy via our Next.js API route (same-origin) to avoid CORS issues.
      try { console.log('[useMetricLivePrice] invoking startMetricWorker (via API proxy)', { marketId }); } catch {}
      const res = await fetch('/api/metric-worker/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`startMetricWorker failed: HTTP ${res.status}${txt ? ` - ${txt}` : ''}`);
      }
      setError(null);
      return true;
    } catch (e: any) {
      setError(e?.message || 'Failed to start worker');
      return false;
    }
  }, [canRun, marketId]);

  useEffect(() => {
    if (!canRun) return;
    setIsLoading(true);
    setError(null);

    let channel = supabase
      .channel(`market_ticker:${marketId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'market_tickers', filter: `market_id=eq.${marketId}` },
        (payload) => {
          const rec: any = payload.new || payload.old;
          if (rec?.market_id === marketId) {
            if (typeof rec?.mark_price === 'number') setValue(rec.mark_price);
            else if (typeof rec?.mark_price === 'string' && rec.mark_price !== null) {
              const n = Number(rec.mark_price);
              if (Number.isFinite(n)) setValue(n);
            }
            setUpdatedAt(rec?.last_update || new Date().toISOString());
          }
        }
      )
      .subscribe();

    const loadInitial = async () => {
      try {
        const { data, error: e } = await supabase
          .from('market_tickers')
          .select('market_id, mark_price, last_update')
          .eq('market_id', marketId)
          .maybeSingle();
        if (e) throw e;
        if (data) {
          const n = typeof data.mark_price === 'number' ? data.mark_price : Number(data.mark_price as any);
          if (Number.isFinite(n)) setValue(n);
          setUpdatedAt(data.last_update || null);
        }
      } catch (e: any) {
        // Non-fatal: the UI can still show fallback value and/or the source URL.
        // We keep the error surface for debug/telemetry, but don't throw.
        setError((prev) => prev || (e?.message || 'Failed to load initial metric'));
      } finally {
        setIsLoading(false);
      }
    };
    void loadInitial();

    return () => {
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [canRun, supabase, marketId]);

  useEffect(() => {
    if (!canRun) return;
    // Best-effort only; live reads now come from market_tickers.
    void startWorkerOnce();
  }, [canRun, startWorkerOnce]);

  return { value, updatedAt, isLoading, error, retryStartWorker: startWorkerOnce };
}

export default useMetricLivePrice;

