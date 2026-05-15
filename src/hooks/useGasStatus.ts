'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Live HyperEVM gas-lane congestion state, sourced from `/api/gas-status`.
 *
 * The endpoint is server-cached (5s) and edge-cached (3s), so polling every
 * 10s here adds at most ~1 RPC round-trip / 10 active tabs.
 *
 * UI contract:
 *   level === 'normal' → no banner, business as usual.
 *   level === 'severe' → "chain congested, we're routing via big blocks
 *                        (~60s confirmation)" banner. Trade route mirrors
 *                        this decision server-side via `recommend === 'big'`.
 *
 * Always reflect the SERVER's recommendation in the UI — never compute the
 * threshold client-side. The server is the source of truth so /api/gasless/trade
 * and the banner can never disagree (otherwise a user sees "fast" but their
 * tx is on the slow lane, or vice versa).
 */

export type CongestionLevel = 'normal' | 'severe';
export type RecommendLane = 'small' | 'big';

export interface GasStatusSnapshot {
  ok: boolean;
  level: CongestionLevel;
  recommend: RecommendLane;
  smallBaseFeeGwei: number;
  bigBaseFeeGwei: number;
  baseFeeFloorGwei: number;
  thresholdGwei: number;
  costEstimate: {
    referenceGas: number;
    hypeUsd: number | null;
    smallHype: number;
    smallUsd: number | null;
    bigHype: number;
    bigUsd: number | null;
  };
  blockNumber: number;
  timestamp: number;
  cacheAgeMs: number;
  error?: string;
}

const DEFAULT_POLL_MS = 10_000;
const RETRY_BACKOFF_MS = 15_000;

async function fetchGasStatus(signal: AbortSignal): Promise<GasStatusSnapshot> {
  const res = await fetch('/api/gas-status', { signal, cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`gas-status ${res.status}`);
  }
  return (await res.json()) as GasStatusSnapshot;
}

export function useGasStatus(pollMs: number = DEFAULT_POLL_MS): {
  status: GasStatusSnapshot | null;
  loading: boolean;
  error: string | null;
} {
  const [status, setStatus] = useState<GasStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const snap = await fetchGasStatus(controller.signal);
        if (!aliveRef.current) return;
        setStatus(snap);
        setError(null);
        setLoading(false);
        timer = setTimeout(tick, pollMs);
      } catch (e: any) {
        if (!aliveRef.current) return;
        if (e?.name === 'AbortError') return;
        // Network blip / endpoint hot-reload: back off briefly and keep last
        // known good snapshot in place so the banner doesn't flicker off.
        setError(String(e?.message || e));
        setLoading(false);
        timer = setTimeout(tick, RETRY_BACKOFF_MS);
      }
    };

    void tick();

    return () => {
      aliveRef.current = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  return { status, loading, error };
}
