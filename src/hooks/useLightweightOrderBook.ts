'use client';

import { useEffect, useCallback, useRef } from 'react';
import {
  useLightweightOrderBookStore,
  useOrderBook,
  useOrderBookStats,
  type LightweightOrderBook,
  type ConfirmedFill,
} from '@/stores/lightweightOrderBookStore';

interface UseLightweightOrderBookOptions {
  symbol: string;
  enabled?: boolean;
  onTradeComplete?: (result: { filledPrice: number; filledAmount: number; priceImpact: number }) => void;
}

interface UseLightweightOrderBookResult {
  orderBook: LightweightOrderBook | undefined;
  stats: ReturnType<typeof useOrderBookStats>;
  isInitialized: boolean;

  // Initialize from existing depth data (call this when MarketDataContext loads)
  initializeFromDepth: (depth: {
    bidPrices: number[];
    bidAmounts: number[];
    askPrices: number[];
    askAmounts: number[];
  }, source?: 'api' | 'rpc') => void;

  // Optimistic trade simulation - call this immediately when user places a trade
  simulateTrade: (
    side: 'buy' | 'sell',
    type: 'market' | 'limit',
    price: number,
    amount: number
  ) => { filledPrice: number; filledAmount: number; priceImpact: number };

  // Add/remove liquidity for limit order placement/cancellation
  addLiquidity: (side: 'buy' | 'sell', price: number, amount: number) => void;
  removeLiquidity: (side: 'buy' | 'sell', price: number, amount: number) => void;

  // Get depth for display (merged with optimistic state)
  getDisplayDepth: () => {
    bidPrices: number[];
    bidAmounts: number[];
    askPrices: number[];
    askAmounts: number[];
  } | null;
}

export function useLightweightOrderBook(
  options: UseLightweightOrderBookOptions
): UseLightweightOrderBookResult {
  const { symbol, enabled = true, onTradeComplete } = options;
  const normalizedSymbol = symbol?.toUpperCase() || '';

  const store = useLightweightOrderBookStore();
  const orderBook = useOrderBook(normalizedSymbol);
  const stats = useOrderBookStats(normalizedSymbol);

  const isInitializedRef = useRef(false);

  // Initialize the lightweight order book from depth data
  const initializeFromDepth = useCallback((
    depth: {
      bidPrices: number[];
      bidAmounts: number[];
      askPrices: number[];
      askAmounts: number[];
    },
    source: 'api' | 'rpc' = 'api'
  ) => {
    if (!normalizedSymbol || !enabled) return;

    store.initializeOrderBook(normalizedSymbol, depth, source);
    isInitializedRef.current = true;

    console.log(`[useLightweightOrderBook] Initialized ${normalizedSymbol} from ${source}`);
  }, [normalizedSymbol, enabled, store]);

  // Simulate a trade optimistically
  const simulateTrade = useCallback((
    side: 'buy' | 'sell',
    type: 'market' | 'limit',
    price: number,
    amount: number
  ) => {
    if (!normalizedSymbol || !enabled) {
      return { filledPrice: price, filledAmount: 0, priceImpact: 0 };
    }

    const result = store.simulateTrade(normalizedSymbol, side, type, price, amount);

    if (onTradeComplete) {
      onTradeComplete(result);
    }

    return result;
  }, [normalizedSymbol, enabled, store, onTradeComplete]);

  // Add liquidity (for limit orders resting on book)
  const addLiquidity = useCallback((
    side: 'buy' | 'sell',
    price: number,
    amount: number
  ) => {
    if (!normalizedSymbol || !enabled) return;
    store.addLiquidity(normalizedSymbol, side, price, amount);
  }, [normalizedSymbol, enabled, store]);

  // Remove liquidity (for order cancellations)
  const removeLiquidity = useCallback((
    side: 'buy' | 'sell',
    price: number,
    amount: number
  ) => {
    if (!normalizedSymbol || !enabled) return;
    store.removeLiquidity(normalizedSymbol, side, price, amount);
  }, [normalizedSymbol, enabled, store]);

  // Get display depth in the format expected by TransactionTable
  const getDisplayDepth = useCallback(() => {
    if (!orderBook) return null;

    return {
      bidPrices: orderBook.bids.map(l => l.price),
      bidAmounts: orderBook.bids.map(l => l.amount),
      askPrices: orderBook.asks.map(l => l.price),
      askAmounts: orderBook.asks.map(l => l.amount),
    };
  }, [orderBook]);

  return {
    orderBook,
    stats,
    isInitialized: isInitializedRef.current,
    initializeFromDepth,
    simulateTrade,
    addLiquidity,
    removeLiquidity,
    getDisplayDepth,
  };
}

// Hook to listen to ordersUpdated events and sync with lightweight store
// 
// Event processing rules:
// 1. OUR orders (trader === userAddress) → SKIP, already handled by simulateOptimisticTrade()
// 2. EXTERNAL OrderRested → ADD liquidity (order is confirmed resting on the book)
// 3. EXTERNAL OrderPlaced → SKIP (ambiguous - use OrderRested instead)
// 4. EXTERNAL OrderFilled/TradeExecutionCompleted → Remove liquidity (order got filled)
// 5. EXTERNAL OrderCancelled → Remove liquidity (order was cancelled)
//
// OrderRested vs OrderPlaced:
// - OrderPlaced is emitted for ALL orders including market orders that immediately fill
// - OrderRested is ONLY emitted when an order actually rests on the book
// - OrderRested is the definitive event for UI order book state updates
export function useLightweightOrderBookSync(symbol: string, userAddress?: string | null) {
  const store = useLightweightOrderBookStore();
  const normalizedSymbol = symbol?.toUpperCase() || '';
  const userAddressLower = userAddress?.toLowerCase() || '';

  useEffect(() => {
    if (typeof window === 'undefined' || !normalizedSymbol) return;

    const handleOrdersUpdated = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail) return;

      const eventSymbol = String(detail?.symbol || '').toUpperCase();
      if (eventSymbol !== normalizedSymbol) return;

      const eventType = String(detail?.eventType || detail?.reason || '');
      const price = detail?.price;
      const amount = detail?.amount;
      const isBuy = detail?.isBuy;
      const trader = String(detail?.trader || '').toLowerCase();

      if (price === undefined || amount === undefined || isBuy === undefined) return;

      // Convert from raw bigint format if needed
      let priceNum: number;
      let amountNum: number;

      try {
        const priceVal = typeof price === 'bigint' ? price : 
          (typeof price === 'string' && /^\d+$/.test(price) ? BigInt(price) : null);
        
        if (priceVal !== null) {
          priceNum = Number(priceVal) / 1e6;
        } else {
          priceNum = Number(price);
        }

        const amountVal = typeof amount === 'bigint' ? amount :
          (typeof amount === 'string' && /^\d+$/.test(amount) ? BigInt(amount) : null);
        
        if (amountVal !== null) {
          amountNum = Number(amountVal) / 1e18;
        } else {
          amountNum = Number(amount);
        }
      } catch {
        return;
      }

      if (!Number.isFinite(priceNum) || !Number.isFinite(amountNum)) return;
      if (priceNum <= 0 || amountNum <= 0) return;
      
      // Sanity check: prices should be reasonable human values
      if (priceNum > 100000) {
        console.warn(`[LightweightOBSync] Skipping event with suspiciously high price: ${priceNum}`);
        return;
      }

      const side = isBuy ? 'buy' : 'sell';
      const isOurOrder = !!(userAddressLower && trader && trader === userAddressLower);

      // Skip our own orders - they're already handled by simulateOptimisticTrade()
      if (isOurOrder) {
        console.log(`[LightweightOBSync] Skipping own order event`, { 
          eventType, 
          side, 
          price: priceNum, 
          amount: amountNum,
          trader: trader.slice(0, 10) + '...'
        });
        return;
      }

      // Process external events
      // OrderRested is the definitive event - order is confirmed resting on the book
      if (eventType === 'OrderRested') {
        // External limit order rested on book - add liquidity
        console.log(`[LightweightOBSync] Adding rested order (OrderRested)`, { 
          side, 
          price: priceNum, 
          amount: amountNum,
          trader: trader ? trader.slice(0, 10) + '...' : 'unknown'
        });
        store.addLiquidity(normalizedSymbol, side, priceNum, amountNum);
        return;
      } else if (eventType === 'OrderPlaced' || eventType === 'order-placed') {
        // Skip OrderPlaced - it's ambiguous (emitted for all orders including market orders)
        // Use OrderRested instead for adding liquidity
        console.log(`[LightweightOBSync] Skipping OrderPlaced (use OrderRested instead)`, { 
          side, 
          price: priceNum, 
          amount: amountNum,
          trader: trader ? trader.slice(0, 10) + '...' : 'unknown'
        });
        return;
      } else if (eventType === 'OrderCancelled' || eventType === 'cancel') {
        // External order cancelled - remove liquidity
        console.log(`[LightweightOBSync] Removing cancelled order`, { 
          side, 
          price: priceNum, 
          amount: amountNum 
        });
        store.removeLiquidity(normalizedSymbol, side, priceNum, amountNum);
      } else if (eventType === 'OrderFilled' || eventType === 'TradeExecutionCompleted' || eventType === 'trade-executed') {
        // Order filled - remove the filled order from its side of the book
        // isBuy refers to the order that was filled:
        // - isBuy=true → A BUY order got filled → remove from bids
        // - isBuy=false → A SELL order got filled → remove from asks
        console.log(`[LightweightOBSync] Removing filled order`, { 
          orderSide: side,
          price: priceNum, 
          amount: amountNum 
        });
        store.removeLiquidity(normalizedSymbol, side, priceNum, amountNum);
      }
    };

    window.addEventListener('ordersUpdated', handleOrdersUpdated);
    return () => window.removeEventListener('ordersUpdated', handleOrdersUpdated);
  }, [normalizedSymbol, userAddressLower, store]);
}

// Dispatch an optimistic order event that will be picked up by both the legacy system and lightweight store
export function dispatchOptimisticOrderEvent(
  symbol: string,
  eventType: 'order-placed' | 'cancel' | 'fill',
  side: 'buy' | 'sell',
  price: number,
  amount: number,
  orderId?: string,
  txHash?: string
) {
  if (typeof window === 'undefined') return;

  const detail = {
    symbol: symbol.toUpperCase(),
    eventType,
    isBuy: side === 'buy',
    price: BigInt(Math.round(price * 1e6)).toString(),
    amount: BigInt(Math.round(amount * 1e18)).toString(),
    orderId: orderId || `optimistic-${Date.now()}`,
    txHash: txHash || `0x${Date.now().toString(16)}`,
    traceId: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
  };

  console.log(`[OptimisticOrder] Dispatching ${eventType}:`, detail);
  window.dispatchEvent(new CustomEvent('ordersUpdated', { detail }));
}
