'use client';

import { useEffect, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';

interface UseMarketSettlementRealtimeOptions {
  marketId: string | null;
  currentStatus: string | null;
  onSettlementStarted: () => void;
  onSettled?: () => void;
  /** Fired when proposed_settlement_value changes (e.g. AI bot reveals a price). */
  onProposalUpdated?: () => void;
}

/**
 * Subscribes to Supabase realtime changes on the markets table for a specific
 * market. Fires callbacks when:
 *  - market_status transitions to SETTLEMENT_REQUESTED
 *  - market_status transitions to SETTLED
 *  - proposed_settlement_value changes (AI bot proposes / updates a price)
 */
export function useMarketSettlementRealtime({
  marketId,
  currentStatus,
  onSettlementStarted,
  onSettled,
  onProposalUpdated,
}: UseMarketSettlementRealtimeOptions) {
  const callbackRef = useRef(onSettlementStarted);
  const settledCallbackRef = useRef(onSettled);
  const proposalCallbackRef = useRef(onProposalUpdated);
  const statusRef = useRef(currentStatus);
  const lastProposedRef = useRef<number | null>(null);

  useEffect(() => {
    callbackRef.current = onSettlementStarted;
  }, [onSettlementStarted]);

  useEffect(() => {
    settledCallbackRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    proposalCallbackRef.current = onProposalUpdated;
  }, [onProposalUpdated]);

  useEffect(() => {
    statusRef.current = currentStatus;
  }, [currentStatus]);

  useEffect(() => {
    if (!marketId) return;

    const supabase = getSupabaseClient();
    const channelName = `market-settlement-${marketId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'markets',
          filter: `id=eq.${marketId}`,
        },
        (payload: any) => {
          const newRow = payload.new;
          const newStatus = newRow?.market_status;

          if (
            newStatus === 'SETTLEMENT_REQUESTED' &&
            statusRef.current !== 'SETTLEMENT_REQUESTED'
          ) {
            statusRef.current = newStatus;
            callbackRef.current();
          }
          if (
            newStatus === 'SETTLED' &&
            statusRef.current !== 'SETTLED'
          ) {
            statusRef.current = newStatus;
            settledCallbackRef.current?.();
          }

          const newProposed = newRow?.proposed_settlement_value ?? null;
          if (
            newProposed !== null &&
            newProposed !== lastProposedRef.current
          ) {
            lastProposedRef.current = newProposed;
            proposalCallbackRef.current?.();
          }
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [marketId]);
}
