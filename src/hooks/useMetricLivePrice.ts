'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '../lib/supabase-browser';

export interface UseMetricLivePriceOptions {
  enabled?: boolean;
  heartbeatMs?: number; // default 20s
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
  const heartbeatMs = Math.max(5000, options?.heartbeatMs ?? 20000);

  const [value, setValue] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const clientIdRef = useRef<string>(
    (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function')
      ? (crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

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
      .channel(`metric:${marketId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'metrics', filter: `market_id=eq.${marketId}` },
        (payload) => {
          const rec: any = payload.new || payload.old;
          if (rec?.market_id === marketId) {
            if (typeof rec?.value === 'number') setValue(rec.value);
            else if (typeof rec?.value === 'string' && rec.value !== null) {
              const n = Number(rec.value);
              if (Number.isFinite(n)) setValue(n);
            }
            setUpdatedAt(rec?.updated_at || new Date().toISOString());
          }
        }
      )
      .subscribe();

    const loadInitial = async () => {
      try {
        const { data, error: e } = await supabase
          .from('metrics')
          .select('market_id, value, updated_at')
          .eq('market_id', marketId)
          .maybeSingle();
        if (e) throw e;
        if (data) {
          const n = typeof data.value === 'number' ? data.value : Number(data.value as any);
          if (Number.isFinite(n)) setValue(n);
          setUpdatedAt(data.updated_at || null);
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
    let cancelled = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const upsertHeartbeat = async () => {
      const now = new Date().toISOString();
      try {
        const { error } = await supabase
          .from('metric_subscriptions')
          .upsert({ market_id: marketId, client_id: clientIdRef.current, last_seen_at: now }, { onConflict: 'market_id,client_id' })
          .select('*')
          .single();
        if (error) throw error;
        try { console.log('[useMetricLivePrice] heartbeat upsert ok', { marketId, clientId: clientIdRef.current }); } catch {}
      } catch (e: any) {
        try { console.log('[useMetricLivePrice] heartbeat upsert error', e?.message || e); } catch {}
      }
    };

    const start = async () => {
      try {
        await upsertHeartbeat();
        heartbeatTimer = setInterval(() => { void upsertHeartbeat(); }, heartbeatMs);
        // Best-effort: worker start is helpful for live updates, but the UI should not hard-fail if it can't start.
        void startWorkerOnce();
      } catch (e: any) {
        if (!cancelled) setError((prev) => prev || (e?.message || 'Failed to start worker'));
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      void supabase.from('metric_subscriptions').delete().eq('market_id', marketId).eq('client_id', clientIdRef.current);
    };
  }, [canRun, heartbeatMs, supabase, marketId, startWorkerOnce]);

  return { value, updatedAt, isLoading, error, retryStartWorker: startWorkerOnce };
}

export default useMetricLivePrice;

