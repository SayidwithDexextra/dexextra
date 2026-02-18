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
  const userKey = useMemo(() => (user ? String(user).toLowerCase() : ''), [user]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  // Sequence-based in-flight guard; also used to ignore stale async results.
  const inflightSeqRef = useRef<number>(0);
  const runSeqRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const summaryRef = useRef<PortfolioSummary | null>(null);
  const errorMsgRef = useRef<string>('');
  const userKeyRef = useRef<string>('');

  // Keep a ref so background refreshes can avoid toggling state.
  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  // Reset state when the wallet address changes.
  // Without this, the previous user's summary can briefly render until the new fetch completes.
  useEffect(() => {
    if (userKeyRef.current === userKey) return;
    userKeyRef.current = userKey;
    // Invalidate any in-flight request and clear cached state.
    inflightSeqRef.current = 0;
    runSeqRef.current += 1;
    summaryRef.current = null;
    setSummary(null);
    setIsLoading(false);
    setError(null);
    errorMsgRef.current = '';
  }, [userKey]);

  const run = useCallback(async () => {
    if (!enabled || !user) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (inflightSeqRef.current) return;
    const seq = (runSeqRef.current += 1);
    inflightSeqRef.current = seq;
    const keyAtStart = userKey;
    const isInitialLoad = !summaryRef.current;
    // Only show "loading" on initial load; background refreshes should not cause UI re-animations.
    if (isInitialLoad) setIsLoading(true);
    try {
      const next = await fetchPortfolioSummary({
        client: publicClient,
        userAddress: user,
      });

      // Ignore stale results (wallet switched, or a newer run started).
      if (inflightSeqRef.current !== seq) return;
      if (userKeyRef.current !== keyAtStart) return;

      const prev = summaryRef.current;
      const changed =
        !prev ||
        prev.availableCash6 !== next.availableCash6 ||
        prev.unrealizedPnl18 !== next.unrealizedPnl18;

      if (changed) {
        setSummary(next);
      }

      setError((prevErr) => (prevErr ? null : prevErr));
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
      if (inflightSeqRef.current === seq) inflightSeqRef.current = 0;
      if (isInitialLoad) setIsLoading(false);
    }
  }, [enabled, user, userKey]);

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

