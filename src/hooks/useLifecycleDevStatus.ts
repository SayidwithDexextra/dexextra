'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

type PhaseStatus = 'upcoming' | 'active' | 'complete';

interface QStashMessageInfo {
  messageId: string;
  status: 'pending' | 'delivered' | 'not_found' | 'error';
  notBefore?: number;
}

export interface LifecyclePhase {
  name: string;
  status: PhaseStatus;
  startsAt: number | null;
  endsAt: number | null;
  qstash: QStashMessageInfo | null;
  countdown: number | null;
}

export interface LifecycleDevStatusResult {
  phases: LifecyclePhase[];
  marketStatus: string | null;
  speedRun: boolean;
  isLoading: boolean;
  error: string | null;
}

const POLL_INTERVAL_MS = 5000;
const COUNTDOWN_TICK_MS = 1000;

export function useLifecycleDevStatus(
  marketId: string | null,
  enabled: boolean,
): LifecycleDevStatusResult {
  const [rawPhases, setRawPhases] = useState<Omit<LifecyclePhase, 'countdown'>[]>([]);
  const [marketStatus, setMarketStatus] = useState<string | null>(null);
  const [speedRun, setSpeedRun] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!marketId) return;
    try {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const res = await fetch(`/api/dev/lifecycle-status?marketId=${encodeURIComponent(marketId)}`, {
        signal: ac.signal,
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setRawPhases(data.phases || []);
      setMarketStatus(data.marketStatus || null);
      setSpeedRun(Boolean(data.speedRun));
      setError(null);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e?.message || 'fetch failed');
    } finally {
      setIsLoading(false);
    }
  }, [marketId]);

  // Poll API
  useEffect(() => {
    if (!enabled || !marketId) return;
    setIsLoading(true);
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [enabled, marketId, fetchStatus]);

  // Countdown tick
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), COUNTDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [enabled]);

  // Compute countdowns from raw phases + current tick
  const phases: LifecyclePhase[] = rawPhases.map((p) => {
    let countdown: number | null = null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (p.status === 'upcoming' && p.startsAt !== null) {
      countdown = Math.max(0, p.startsAt - nowSec);
    } else if (p.status === 'active' && p.endsAt !== null) {
      countdown = Math.max(0, p.endsAt - nowSec);
    }
    // suppress unused-var lint for tick (it's used to trigger re-render)
    void tick;
    return { ...p, countdown };
  });

  return { phases, marketStatus, speedRun, isLoading, error };
}
