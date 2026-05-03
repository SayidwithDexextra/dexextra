/**
 * Optimistic Event System
 * 
 * Dispatches optimistic updates for positions and balances to provide
 * instant UI feedback without waiting for blockchain confirmation.
 * 
 * Events:
 * - optimisticPositionUpdate: Updates positions in MarketActivityTabs immediately
 * - optimisticBalanceUpdate: Updates balances in Header immediately
 */

export interface OptimisticPositionUpdate {
  traceId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  sizeDelta: number; // positive for increase, negative for decrease
  entryPrice: number;
  timestamp: number;
  trader: string;
  /** True if this is a new position (not modifying existing) */
  isNewPosition?: boolean;
  /** True if this is closing a position entirely */
  isClosing?: boolean;
}

export interface OptimisticBalanceUpdate {
  traceId: string;
  trader: string;
  /** Change in available cash (negative when opening position) */
  availableCashDelta: number;
  /** Change in margin used (positive when opening position) */
  marginUsedDelta: number;
  /** Estimated collateral locked for this position */
  collateralLocked: number;
  timestamp: number;
}

export interface OptimisticTradeDetails {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  notionalValue: number;
  leverage: number;
  marginRequired: number;
  trader: string;
  txHash?: string;
  orderType: 'MARKET' | 'LIMIT';
}

/**
 * Dispatches an optimistic position update event.
 * MarketActivityTabs listens for this to update positions immediately.
 */
export function dispatchOptimisticPositionUpdate(update: OptimisticPositionUpdate): void {
  if (typeof window === 'undefined') return;
  
  console.log('[OptimisticEvents] Dispatching optimisticPositionUpdate', update);
  
  window.dispatchEvent(new CustomEvent('optimisticPositionUpdate', {
    detail: update
  }));
  
  // Also dispatch the existing positionsRefreshRequested for compatibility
  // but with a flag indicating it's optimistic (no actual refresh needed yet)
  window.dispatchEvent(new CustomEvent('positionsRefreshRequested', {
    detail: {
      traceId: update.traceId,
      symbol: update.symbol,
      optimistic: true,
      timestamp: update.timestamp,
    }
  }));
}

/**
 * Dispatches an optimistic balance update event.
 * Header listens for this to update portfolio/cash values immediately.
 */
export function dispatchOptimisticBalanceUpdate(update: OptimisticBalanceUpdate): void {
  if (typeof window === 'undefined') return;
  
  console.log('[OptimisticEvents] Dispatching optimisticBalanceUpdate', update);
  
  window.dispatchEvent(new CustomEvent('optimisticBalanceUpdate', {
    detail: update
  }));
}

/**
 * Dispatches all optimistic updates for a new trade.
 * Call this immediately after trade submission for instant UI feedback.
 */
export function dispatchOptimisticTradeUpdates(details: OptimisticTradeDetails): void {
  if (typeof window === 'undefined') return;
  
  const now = Date.now();
  const traceId = `optimistic:${details.symbol}:${now}`;
  
  console.log('[OptimisticEvents] Dispatching full optimistic trade updates', details);
  
  // 1. Position update
  const sizeDelta = details.side === 'LONG' ? details.size : -details.size;
  dispatchOptimisticPositionUpdate({
    traceId,
    symbol: details.symbol,
    side: details.side,
    sizeDelta,
    entryPrice: details.entryPrice,
    timestamp: now,
    trader: details.trader,
    isNewPosition: true,
  });
  
  // 2. Balance update
  dispatchOptimisticBalanceUpdate({
    traceId,
    trader: details.trader,
    availableCashDelta: -details.marginRequired,
    marginUsedDelta: details.marginRequired,
    collateralLocked: details.marginRequired,
    timestamp: now,
  });
  
  // 3. Also dispatch coreVaultSummary for Header to pick up immediately
  // This works with the existing Header listener
  window.dispatchEvent(new CustomEvent('coreVaultSummaryDelta', {
    detail: {
      traceId,
      availableCollateralDelta: -details.marginRequired,
      marginUsedDelta: details.marginRequired,
      timestamp: now,
      isOptimistic: true,
    }
  }));
}

/**
 * Default delay before showing Position Opened modal (milliseconds).
 * This provides instant gratification without waiting for blockchain.
 */
export const OPTIMISTIC_MODAL_DELAY_MS = 3000;
