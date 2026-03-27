'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Address } from 'viem';
import { useMarketEventHub } from '@/services/realtime/marketEventHub';

interface SettlementEventDetail {
  eventName?: string;
  oldState?: number;
  newState?: number;
  previousState?: number;
  settledOnChain?: boolean;
  challenger?: string;
  alternativePrice?: string;
  challengerWon?: boolean;
  challengeWindowStart?: string;
  challengeWindowEnd?: string;
  symbol?: string;
  source?: string;
  txHash?: string;
  blockNumber?: number;
  timestamp?: number;
}

interface UseSettlementContractEventsOptions {
  symbol: string;
  orderBookAddress: string | null | undefined;
  onSettlementEvent?: (detail: SettlementEventDetail) => void;
  onLifecycleStateChanged?: (oldState: number, newState: number) => void;
  onMarketSettled?: () => void;
  onChallengeWindowStarted?: () => void;
  onChallengeSubmitted?: (challenger: string) => void;
  onChallengeResolved?: (challengerWon: boolean) => void;
  onEvidenceCommitted?: () => void;
  enabled?: boolean;
}

/**
 * Watches on-chain settlement/lifecycle contract events via WebSocket.
 * Triggers callbacks immediately when settlement state changes happen,
 * eliminating the need for users to reload the page.
 */
export function useSettlementContractEvents({
  symbol,
  orderBookAddress,
  onSettlementEvent,
  onLifecycleStateChanged,
  onMarketSettled,
  onChallengeWindowStarted,
  onChallengeSubmitted,
  onChallengeResolved,
  onEvidenceCommitted,
  enabled = true,
}: UseSettlementContractEventsOptions) {
  const callbackRefs = useRef({
    onSettlementEvent,
    onLifecycleStateChanged,
    onMarketSettled,
    onChallengeWindowStarted,
    onChallengeSubmitted,
    onChallengeResolved,
    onEvidenceCommitted,
  });

  useEffect(() => {
    callbackRefs.current = {
      onSettlementEvent,
      onLifecycleStateChanged,
      onMarketSettled,
      onChallengeWindowStarted,
      onChallengeSubmitted,
      onChallengeResolved,
      onEvidenceCommitted,
    };
  });

  const handleSettlementChanged = useCallback(() => {
    // no-op: routing is done via the DOM event listener below
  }, []);

  const addr = enabled && orderBookAddress ? (orderBookAddress as Address) : null;

  useMarketEventHub(
    enabled ? symbol : '',
    addr,
    {
      onSettlementChanged: handleSettlementChanged,
      dispatchDomEvents: true,
    }
  );

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SettlementEventDetail>).detail;
      if (!detail) return;

      const eventSymbol = String(detail.symbol || '').toUpperCase();
      const ourSymbol = String(symbol || '').toUpperCase();
      if (eventSymbol && ourSymbol && eventSymbol !== ourSymbol) return;

      const cb = callbackRefs.current;
      cb.onSettlementEvent?.(detail);

      const eventName = detail.eventName || '';

      if (eventName === 'LifecycleStateChanged' || eventName === 'LifecycleSync') {
        const oldState = detail.oldState ?? detail.previousState;
        const newState = detail.newState;
        if (oldState !== undefined && newState !== undefined) {
          cb.onLifecycleStateChanged?.(oldState, newState);
        }
        if (newState === 3) {
          cb.onMarketSettled?.();
        }
      }

      if (eventName === 'LifecycleSettled') {
        cb.onMarketSettled?.();
      }

      if (eventName === 'SettlementChallengeWindowStarted') {
        cb.onChallengeWindowStarted?.();
      }

      if (eventName === 'SettlementChallenged') {
        const challenger = detail.challenger;
        if (challenger) cb.onChallengeSubmitted?.(challenger);
      }

      if (eventName === 'ChallengeResolved') {
        cb.onChallengeResolved?.(Boolean(detail.challengerWon));
      }

      if (eventName === 'EvidenceCommitted') {
        cb.onEvidenceCommitted?.();
      }
    };

    window.addEventListener('settlementUpdated', handler);
    return () => window.removeEventListener('settlementUpdated', handler);
  }, [enabled, symbol]);
}
