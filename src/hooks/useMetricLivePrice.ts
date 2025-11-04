'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
      const { data, error: e } = await supabase
        .from('metrics')
        .select('market_id, value, updated_at')
        .eq('market_id', marketId)
        .maybeSingle();
      if (!e && data) {
        const n = typeof data.value === 'number' ? data.value : Number(data.value as any);
        if (Number.isFinite(n)) setValue(n);
        setUpdatedAt(data.updated_at || null);
      }
      setIsLoading(false);
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
        try { console.log('[useMetricLivePrice] invoking startMetricWorker', { marketId }); } catch {}
        await supabase.functions.invoke('startMetricWorker', { body: { marketId } });
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to start worker');
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      void supabase.from('metric_subscriptions').delete().eq('market_id', marketId).eq('client_id', clientIdRef.current);
    };
  }, [canRun, heartbeatMs, supabase, marketId]);

  return { value, updatedAt, isLoading, error };
}

export default useMetricLivePrice;

