'use client';

import { useEffect, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';

interface MarketConfigState {
  uma_assertion_id?: string;
  uma_escalated_at?: string;
  uma_resolved?: boolean;
  uma_challenger_won?: boolean;
  uma_resolved_at?: string;
}

interface UseMarketSettlementRealtimeOptions {
  marketId: string | null;
  currentStatus: string | null;
  onSettlementStarted: () => void;
  onSettled?: () => void;
  /** Fired when proposed_settlement_value changes (e.g. AI bot reveals a price). */
  onProposalUpdated?: () => void;
  /** Fired when a dispute is escalated to UMA (uma_assertion_id is set). */
  onUmaEscalated?: () => void;
  /** Fired when UMA resolves the dispute (uma_resolved becomes true). */
  onUmaResolved?: (challengerWon: boolean) => void;
  /** Fired when settlement_disputed changes. */
  onDisputeStatusChanged?: (disputed: boolean) => void;
}

/**
 * Subscribes to Supabase realtime changes on the markets table for a specific
 * market. Fires callbacks when:
 *  - market_status transitions to SETTLEMENT_REQUESTED
 *  - market_status transitions to SETTLED
 *  - proposed_settlement_value changes (AI bot proposes / updates a price)
 *  - settlement_disputed changes (challenge submitted or resolved)
 *  - market_config.uma_assertion_id is set (escalated to UMA)
 *  - market_config.uma_resolved becomes true (UMA DVM resolved)
 */
export function useMarketSettlementRealtime({
  marketId,
  currentStatus,
  onSettlementStarted,
  onSettled,
  onProposalUpdated,
  onUmaEscalated,
  onUmaResolved,
  onDisputeStatusChanged,
}: UseMarketSettlementRealtimeOptions) {
  const callbackRef = useRef(onSettlementStarted);
  const settledCallbackRef = useRef(onSettled);
  const proposalCallbackRef = useRef(onProposalUpdated);
  const umaEscalatedCallbackRef = useRef(onUmaEscalated);
  const umaResolvedCallbackRef = useRef(onUmaResolved);
  const disputeStatusCallbackRef = useRef(onDisputeStatusChanged);

  const statusRef = useRef(currentStatus);
  const lastProposedRef = useRef<number | null>(null);
  const lastDisputedRef = useRef<boolean | null>(null);
  const lastConfigRef = useRef<MarketConfigState | null>(null);

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
    umaEscalatedCallbackRef.current = onUmaEscalated;
  }, [onUmaEscalated]);

  useEffect(() => {
    umaResolvedCallbackRef.current = onUmaResolved;
  }, [onUmaResolved]);

  useEffect(() => {
    disputeStatusCallbackRef.current = onDisputeStatusChanged;
  }, [onDisputeStatusChanged]);

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

          const newDisputed = newRow?.settlement_disputed ?? null;
          if (
            newDisputed !== null &&
            newDisputed !== lastDisputedRef.current
          ) {
            lastDisputedRef.current = newDisputed;
            disputeStatusCallbackRef.current?.(newDisputed);
          }

          const newConfig = (newRow?.market_config ?? {}) as MarketConfigState;
          const prevConfig = lastConfigRef.current;

          const newAssertionId = newConfig.uma_assertion_id;
          const prevAssertionId = prevConfig?.uma_assertion_id;
          if (newAssertionId && newAssertionId !== prevAssertionId) {
            umaEscalatedCallbackRef.current?.();
          }

          const newUmaResolved = newConfig.uma_resolved === true;
          const prevUmaResolved = prevConfig?.uma_resolved === true;
          if (newUmaResolved && !prevUmaResolved) {
            const challengerWon = newConfig.uma_challenger_won === true;
            umaResolvedCallbackRef.current?.(challengerWon);
          }

          lastConfigRef.current = newConfig;
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
