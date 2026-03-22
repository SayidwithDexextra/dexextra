'use client';

import { useEffect, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';

interface UseMarketSettlementRealtimeOptions {
  marketId: string | null;
  currentStatus: string | null;
  onSettlementStarted: () => void;
  onSettled?: () => void;
}

/**
 * Subscribes to Supabase realtime changes on the markets table for a specific
 * market. Fires onSettlementStarted when market_status transitions to
 * SETTLEMENT_REQUESTED, and onSettled when it transitions to SETTLED.
 */
export function useMarketSettlementRealtime({
  marketId,
  currentStatus,
  onSettlementStarted,
  onSettled,
}: UseMarketSettlementRealtimeOptions) {
  const callbackRef = useRef(onSettlementStarted);
  const settledCallbackRef = useRef(onSettled);
  const statusRef = useRef(currentStatus);

  useEffect(() => {
    callbackRef.current = onSettlementStarted;
  }, [onSettlementStarted]);

  useEffect(() => {
    settledCallbackRef.current = onSettled;
  }, [onSettled]);

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
          const newStatus = payload.new?.market_status;
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
