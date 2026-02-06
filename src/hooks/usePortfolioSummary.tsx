'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { publicClient } from '@/lib/viemClient';
import { fetchPortfolioSummary, type PortfolioSummary } from '@/lib/portfolioSummary';

export type UsePortfolioSummaryResult = {
  summary: PortfolioSummary | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
};

function toAddressMaybe(addr: string | undefined | null): Address | null {
  if (!addr) return null;
  const a = String(addr);
  if (!a.startsWith('0x')) return null;
  if (a.length !== 42) return null;
  return a as Address;
}

/**
 * Portfolio summary aligned with InteractiveTrader's detailed portfolio analysis:
 * - Available cash: CoreVault.getUnifiedMarginSummary().availableCollateral (6 decimals)
 * - Unrealized P&L: recomputed from getUserPositions + per-market mark price (18 decimals)
 */
export function usePortfolioSummary(walletAddress?: string | null, options?: { enabled?: boolean; refreshIntervalMs?: number }) : UsePortfolioSummaryResult {
  const enabled = options?.enabled ?? true;
  const refreshIntervalMs = options?.refreshIntervalMs ?? 15_000;

  const user = useMemo(() => toAddressMaybe(walletAddress), [walletAddress]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const inflightRef = useRef<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const summaryRef = useRef<PortfolioSummary | null>(null);
  const errorMsgRef = useRef<string>('');

  // Keep a ref so background refreshes can avoid toggling state.
  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  const run = useCallback(async () => {
    if (!enabled || !user) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (inflightRef.current) return;
    inflightRef.current = true;
    const isInitialLoad = !summaryRef.current;
    // Only show "loading" on initial load; background refreshes should not cause UI re-animations.
    if (isInitialLoad) setIsLoading(true);
    try {
      const next = await fetchPortfolioSummary({
        client: publicClient,
        userAddress: user,
      });

      const prev = summaryRef.current;
      const changed =
        !prev ||
        prev.availableCash6 !== next.availableCash6 ||
        prev.unrealizedPnl18 !== next.unrealizedPnl18;

      if (changed) {
        setSummary(next);
      }

      if (error) setError(null);
      errorMsgRef.current = '';
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const msg = String(err.message || err);
      // Avoid spamming state updates on repeated transient errors.
      if (msg !== errorMsgRef.current) {
        errorMsgRef.current = msg;
        setError(err);
      }
    } finally {
      inflightRef.current = false;
      if (!summaryRef.current) setIsLoading(false);
    }
  }, [enabled, user, error]);

  // Initial + reactive refresh
  useEffect(() => {
    void run();
  }, [run]);

  // Interval refresh (best-effort)
  useEffect(() => {
    if (!enabled || !user) return;
    if (refreshIntervalMs <= 0) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => void run(), refreshIntervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, user, refreshIntervalMs, run]);

  return {
    summary,
    isLoading,
    error,
    refresh: () => void run(),
  };
}

