'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Transaction, OrderBookEntry } from '@/types/orders';
// Legacy useSupabaseRealtimeOrders import removed
import { AnimatedOrderRow } from '@/components/ui/AnimatedOrderRow';
// Legacy useOrderAnimations import removed
import { OrderBookAnimatedQuantity } from '@/components/ui/AnimatedQuantity';
import { useMarketData } from '@/contexts/MarketDataContext';

interface TransactionTableProps {
  marketId?: string; // UUID from markets table
  marketIdentifier?: string; // Market identifier (e.g., 'ALU-USD')
  currentPrice?: number;
  height?: string | number;
  orderBookAddress?: string; // Optional explicit OB address to bypass symbol resolution
}

// Helper function to transform market depth to order book entries
const transformMarketDepthToOrderBook = (bids: OrderBookEntry[], asks: OrderBookEntry[]): OrderBookEntry[] => {
  // Combine and sort all orders by price
  const allOrders = [...bids, ...asks];
  return allOrders.sort((a, b) => b.price - a.price); // Sort by price descending
};

interface OrderFromAPI {
  order_id: string;
  side: string;
  order_status: string;
  price: number | null;
  quantity: number;
  filled_quantity: number;
  created_at: string;
  trader_wallet_address: string;
}

function toIsoFromTimestamp(ts: unknown): string {
  let numeric = 0;
  if (typeof ts === 'number') numeric = ts;
  else if (typeof ts === 'bigint') numeric = Number(ts);
  else if (typeof ts === 'string') numeric = Number(ts);

  if (!Number.isFinite(numeric) || numeric < 0) numeric = 0;
  const ms = numeric < 1e12 ? numeric * 1000 : numeric;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

// Port of interactive-trader formatting behavior for display consistency in the UI
function formatPriceDisplay(value: number, displayDecimals = 4): string {
  if (!value || value === 0) return '0.00';
  if (value < 0.000001 && value > 0) {
    // Very small prices get more precision to avoid scientific notation
    return value.toFixed(8);
  }
  if (value >= 1) {
    // Human-friendly formatting for larger prices (commas + 2 decimals)
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }
  // Sub-dollar values keep finer precision (default 4dp)
  return value.toFixed(Math.max(2, displayDecimals));
}

function formatAmountDisplay(value: number, displayDecimals = 4): string {
  if (!value || value === 0) return '0.0000';
  if (value < 0.00000001 && value > 0) {
    // Very small amounts get more precision
    return value.toFixed(12);
  }
  return value.toFixed(displayDecimals);
}

export default function TransactionTable({ marketId, marketIdentifier, currentPrice, height = '100%', orderBookAddress }: TransactionTableProps) {
  const [view, setView] = useState<'transactions' | 'orderbook'>('orderbook');
  const [sortBy, setSortBy] = useState<'timestamp' | 'price' | 'amount'>('timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  // Log when market ID or identifier changes
  const prevMarketId = React.useRef(marketId);
  const prevMarketIdentifier = React.useRef(marketIdentifier);
  useEffect(() => {
    if (prevMarketId.current !== marketId) {
      console.log('🔍 [TRANSACTION_TABLE] Market ID changed:', { from: prevMarketId.current, to: marketId });
      prevMarketId.current = marketId;
    }
    if (prevMarketIdentifier.current !== marketIdentifier) {
      console.log('🔍 [TRANSACTION_TABLE] Market identifier changed:', { from: prevMarketIdentifier.current, to: marketIdentifier });
      prevMarketIdentifier.current = marketIdentifier;
    }
  }, [marketId, marketIdentifier]);

  const md = useMarketData();
  const validMarketIdentifier = useMemo(() => {
    const id = (marketIdentifier || md.symbol || '').trim();
    if (!id) {
      console.warn('[TransactionTable] Empty market identifier provided');
      return '';
    }
    return id;
  }, [marketIdentifier, md.symbol]);

  // --- Realtime optimistic overlay for OrderBook depth (no polling) ---
  // Applies small, short-lived deltas from `ordersUpdated` events so the BOOK tab updates instantly.
  const depthOverlayRef = React.useRef<{
    bidsDelta: Map<string, { delta: number; expiresAt: number }>;
    asksDelta: Map<string, { delta: number; expiresAt: number }>;
    seenTrace: Map<string, number>;
  }>({ bidsDelta: new Map(), asksDelta: new Map(), seenTrace: new Map() });
  const [depthOverlayTick, setDepthOverlayTick] = useState(0);

  const bigintToFloat = (x: bigint, decimals: number, maxFraction = 8): number => {
    const TEN = 10n;
    const base = TEN ** BigInt(decimals);
    const intPart = x / base;
    const fracPart = x % base;
    const fracStrFull = fracPart.toString().padStart(decimals, '0');
    const fracStr = maxFraction > 0 ? fracStrFull.slice(0, Math.min(maxFraction, decimals)) : '';
    const str = fracStr ? `${intPart.toString()}.${fracStr}` : intPart.toString();
    return parseFloat(str);
  };

  // When fresh depth arrives, clear overlay so we don't "double count" (base has caught up).
  useEffect(() => {
    try {
      const bids = depthOverlayRef.current.bidsDelta;
      const asks = depthOverlayRef.current.asksDelta;
      if (bids.size === 0 && asks.size === 0) return;
      bids.clear();
      asks.clear();
      // eslint-disable-next-line no-console
      console.log('[RealTimeToken] ui:orderbook:overlay:cleared', { market: validMarketIdentifier });
      setDepthOverlayTick((x) => x + 1);
    } catch {}
  }, [md.lastUpdated, validMarketIdentifier]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOrdersUpdated = (e: any) => {
      const detail = (e as CustomEvent)?.detail as any;
      const sym = String(detail?.symbol || '').trim().toUpperCase();
      const mySym = String(validMarketIdentifier || '').trim().toUpperCase();
      if (!sym || !mySym) return;
      if (sym !== mySym) return;

      const now = Date.now();
      const eventType = String(detail?.eventType || detail?.reason || '').trim();
      const isCancelOrFill =
        eventType === 'OrderCancelled' ||
        eventType === 'cancel' ||
        eventType === 'OrderFilled';
      const isPlacement =
        eventType === 'OrderPlaced' ||
        eventType === 'order-placed';
      // Only apply depth deltas for known lifecycle events
      if (!isCancelOrFill && !isPlacement) return;

      // We can only optimistically adjust depth when we have price+amount+side.
      if (!detail?.price || !detail?.amount || detail?.isBuy === undefined) return;

      // Strong dedupe: txHash if present; else fall back to orderId+fields.
      // This prevents double-counting when we receive the same placement via onchain + pusher.
      const txHash = String(detail?.txHash || detail?.transactionHash || '');
      const orderId = detail?.orderId !== undefined ? String(detail.orderId) : '';
      const priceRaw = String(detail?.price || '');
      const amountRaw = String(detail?.amount || '');
      const isBuyRaw = detail?.isBuy === undefined ? '' : (Boolean(detail.isBuy) ? 'B' : 'S');
      const eventKey = txHash
        ? `tx:${txHash}:${sym}:${orderId || isBuyRaw}`
        : `oid:${orderId || 'noOrderId'}:${sym}:${eventType}:${priceRaw}:${amountRaw}:${isBuyRaw}`;
      {
        const prev = depthOverlayRef.current.seenTrace.get(eventKey) || 0;
        if (now - prev < 10_000) return;
        depthOverlayRef.current.seenTrace.set(eventKey, now);
      }

      let price = 0;
      let amount = 0;
      try {
        price = bigintToFloat(BigInt(String(detail.price)), 6, 8); // 6dp
      } catch {}
      try {
        amount = bigintToFloat(BigInt(String(detail.amount)), 18, 8); // 18dp
      } catch {}
      if (!Number.isFinite(price) || !Number.isFinite(amount) || price <= 0 || amount <= 0) return;

      const isBuy = Boolean(detail.isBuy);
      const ttlMs = 8_000;

      // Place adds liquidity at a level; cancel/fill removes liquidity at a level (best-effort).
      const sign = isCancelOrFill ? -1 : 1;
      const map = isBuy ? depthOverlayRef.current.bidsDelta : depthOverlayRef.current.asksDelta;
      const priceKey = price.toFixed(8);
      const existing = map.get(priceKey);
      const nextDelta = (existing?.delta || 0) + sign * amount;
      map.set(priceKey, { delta: nextDelta, expiresAt: now + ttlMs });

      // eslint-disable-next-line no-console
      console.log('[RealTimeToken] ui:orderbook:patched', { eventKey, symbol: sym, eventType, price, amount, isBuy, delta: nextDelta });
      setDepthOverlayTick((x) => x + 1);
    };

    window.addEventListener('ordersUpdated', onOrdersUpdated as EventListener);
    return () => window.removeEventListener('ordersUpdated', onOrdersUpdated as EventListener);
  }, [validMarketIdentifier]);

  const obData = useMemo(() => ({
    depth: md.depth,
    bestBid: md.bestBid ?? 0,
    bestAsk: md.bestAsk ?? 0,
    orderBookAddress: md.orderBookAddress,
    recentTrades: md.recentTrades ?? [],
    lastUpdated: md.lastUpdated ?? new Date().toISOString()
  }), [md.depth, md.bestBid, md.bestAsk, md.orderBookAddress, md.recentTrades, md.lastUpdated]);

  const obLoading = md.isLoading;
  const obError = md.error;
  const [recentTrades, setRecentTrades] = useState<OrderFromAPI[]>([]);
  const [isLoadingTrades, setIsLoadingTrades] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);

  // Fetch recent trades and log on any order book update
  useEffect(() => {
    console.log('validMarketIdentifierx', validMarketIdentifier);
    console.log('obDatax', obData);
    console.log('recentTradesx', recentTrades);
    try {
      setIsLoadingTrades(true);
      const trades = obData?.recentTrades || [];
      // Map recent trades (price 6dp, amount 18dp, timestamp seconds) to UI rows
      const formattedTrades = trades.map((t, i, arr) => {
        const prevPrice = i > 0 ? arr[i - 1].price : (arr.length > 1 ? arr[i + 1]?.price ?? t.price : t.price);
        const side = (t.price ?? 0) >= (prevPrice ?? 0) ? 'BUY' : 'SELL';
        return {
          order_id: `${(t as any).tradeId || t.timestamp || i}`,
          side,
          order_status: 'FILLED',
          price: t.price ?? 0,
          quantity: t.amount ?? 0,
          filled_quantity: t.amount ?? 0,
          created_at: toIsoFromTimestamp(t.timestamp),
          trader_wallet_address: '0x0000000000000000000000000000000000000000'
        } as OrderFromAPI;
      });
      setRecentTrades(formattedTrades);
      setTradeError(null);
    } catch (err) {
      console.error('Failed to transform recent trades:', err);
      setTradeError((err as Error).message || 'Failed to transform recent trades');
    } finally {
      setIsLoadingTrades(false);
    }
  }, [obData?.lastUpdated]);

  const isLoading = view === 'orderbook' ? obLoading : isLoadingTrades;
  const error = view === 'orderbook' 
    ? (obError ? ((obError as any).message || String(obError)) : null)
    : tradeError;
  const isConnected = !!obData?.orderBookAddress;
  const refetch = () => {};

  // Only log connection status changes, not every render
  const prevIsConnected = React.useRef(isConnected);
  const prevTradesCount = React.useRef(recentTrades.length);
  
  useEffect(() => {
    if (prevIsConnected.current !== isConnected) {
      console.log('📡 [TRANSACTION_TABLE] Connection status changed:', isConnected);
      prevIsConnected.current = isConnected;
    }
  }, [isConnected]);

  useEffect(() => {
    const currentCount = recentTrades.length;
    if (prevTradesCount.current !== currentCount) {
      console.log('📊 [TRANSACTION_TABLE] Trades count changed:', { from: prevTradesCount.current, to: currentCount });
      prevTradesCount.current = currentCount;
    }
  }, [recentTrades.length]);


  // Legacy animation hook removed - using placeholder values
  const isOrderNew = () => false;
  const getAnimationDelay = () => 0;

  // Only log state changes when significant changes occur
  const prevState = React.useRef<{ tradesCount: number; isLoading: boolean; error: string | null }>({ 
    tradesCount: 0, 
    isLoading: true, 
    error: null 
  });
  
  useEffect(() => {
    const currentState = {
      tradesCount: recentTrades.length,
      isLoading,
      error
    };
    
    if (JSON.stringify(prevState.current) !== JSON.stringify(currentState)) {
      console.log('🔍 [TRANSACTION_TABLE] State changed:', {
        ...currentState,
        tradesWithPrice: recentTrades.filter(t => t.price !== null).length,
      });
      prevState.current = currentState;
    }
  }, [recentTrades.length, isLoading, error]);

  // Get pending orders for BOOK tab (unfilled limit orders)
  const pendingOrders = useMemo<OrderFromAPI[]>(() => [], []);

  // Get filled orders for TRADES tab (completed trades)
  const filledOrders = useMemo(() => {
    console.log('🔍 [TRANSACTIONS] Found', recentTrades.length, 'recent trades');
    return recentTrades;
  }, [recentTrades]);

  // Separate bids and asks for traditional orderbook display (prefer on-chain depth when available)
  const { bids, asks } = useMemo(() => {
    if (obData?.depth) {
      const nowIso = new Date().toISOString();
      const bidOrders = (obData.depth.bidPrices || []).map((price, i) => ({
        order_id: `BID-${price}-${i}`,
        side: 'BUY',
        order_status: 'PENDING',
        price,
        quantity: (obData.depth?.bidAmounts?.[i] ?? 0),
        filled_quantity: 0,
        created_at: nowIso,
        trader_wallet_address: '0x0000000000000000000000000000000000000000'
      })).sort((a, b) => (b.price || 0) - (a.price || 0)); // Highest bid first

      const askOrders = (obData.depth.askPrices || []).map((price, i) => ({
        order_id: `ASK-${price}-${i}`,
        side: 'SELL',
        order_status: 'PENDING',
        price,
        quantity: (obData.depth?.askAmounts?.[i] ?? 0),
        filled_quantity: 0,
        created_at: nowIso,
        trader_wallet_address: '0x0000000000000000000000000000000000000000'
      })).sort((a, b) => (b.price || 0) - (a.price || 0)); // Highest ask first for descending display

      console.log('🔍 [ORDERBOOK][ONCHAIN] Bids:', bidOrders.length, 'Asks:', askOrders.length);
      // Apply optimistic overlay deltas (best-effort) so the book updates instantly on events
      try {
        const now = Date.now();
        const overlay = depthOverlayRef.current;
        const applySide = (side: 'bid' | 'ask', arr: any[]) => {
          const map = side === 'bid' ? overlay.bidsDelta : overlay.asksDelta;
          // prune expired
          for (const [p, rec] of map.entries()) {
            if (!rec || rec.expiresAt <= now) map.delete(p);
          }
          if (map.size === 0) return arr;
          const out = [...arr];
          const idxMap = new Map<number, number>();
          out.forEach((o, i) => idxMap.set(Number(o.price || 0), i));
          for (const [pKey, rec] of map.entries()) {
            const p = parseFloat(pKey);
            const i = idxMap.get(p);
            if (i !== undefined) {
              const q = Number(out[i].quantity || 0) + Number(rec.delta || 0);
              out[i] = { ...out[i], quantity: q > 0 ? q : 0 };
            } else if (rec.delta > 0) {
              out.push({
                order_id: `${side.toUpperCase()}-RT-${p}-${now}`,
                side: side === 'bid' ? 'BUY' : 'SELL',
                order_status: 'PENDING',
                price: p,
                quantity: rec.delta,
                filled_quantity: 0,
                created_at: nowIso,
                trader_wallet_address: '0x0000000000000000000000000000000000000000'
              });
            }
          }
          const cleaned = out.filter((o) => Number(o.quantity || 0) > 0);
          // sort by price descending (matches existing)
          cleaned.sort((a, b) => (Number(b.price || 0) - Number(a.price || 0)));
          return cleaned;
        };
        return { bids: applySide('bid', bidOrders), asks: applySide('ask', askOrders) };
      } catch {
        return { bids: bidOrders, asks: askOrders };
      }
    }

    // Fallback to pending orders from DB (if any)
    const buyOrders = pendingOrders
      .filter(order => order.side.toLowerCase() === 'buy')
      .sort((a, b) => (b.price || 0) - (a.price || 0)); // Highest bid first
    const sellOrders = pendingOrders
      .filter(order => order.side.toLowerCase() === 'sell')
      .sort((a, b) => (b.price || 0) - (a.price || 0)); // Highest ask first for descending display
    console.log('🔍 [ORDERBOOK][DB] Bids:', buyOrders.length, 'Asks:', sellOrders.length);
    return { bids: buyOrders, asks: sellOrders };
  }, [obData?.depth, pendingOrders, depthOverlayTick]);

  // Best Bid/Ask derived from depth with on-chain fallback values
  const bestBidPrice = useMemo(() => {
    const p = (bids && bids.length > 0) ? bids[0].price : null;
    return (p ?? obData?.bestBid ?? 0) || 0;
  }, [bids, obData?.bestBid]);

  const bestAskPrice = useMemo(() => {
    const p = (asks && asks.length > 0) ? asks[asks.length - 1].price : null;
    return (p ?? obData?.bestAsk ?? 0) || 0;
  }, [asks, obData?.bestAsk]);

  // Filtered and sorted data based on current view
  const filteredAndSortedData = useMemo(() => {
    // Choose data source based on view
    let filtered = view === 'orderbook' ? pendingOrders : filledOrders;

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue, bValue;
      
      switch (sortBy) {
        case 'timestamp':
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        case 'price':
          aValue = a.price || 0;
          bValue = b.price || 0;
          break;
        case 'amount':
          aValue = a.quantity;
          bValue = b.quantity;
          break;
        default:
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
      }

      if (sortOrder === 'asc') {
        return aValue - bValue;
      } else {
        return bValue - aValue;
      }
    });

    return filtered;
  }, [view, pendingOrders, filledOrders, sortBy, sortOrder]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const getStatusColor = (status: Transaction['status']) => {
    switch (status) {
      case 'open':
        return 'text-blue-400';
      case 'closed':
        return 'text-green-400';
      case 'liquidated':
        return 'text-red-400';
      default:
        return 'text-gray-200';
    }
  };

  const getPnLColor = (pnl?: number) => {
    if (!pnl) return 'text-gray-200';
    return pnl >= 0 ? 'text-[#00D084]' : 'text-[#FF4747]';
  };

  const handleSort = (newSortBy: typeof sortBy) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('desc');
    }
  };

  return (
    <div className="bg-[#0A0A0A] border border-[#333333] rounded-md p-3 flex flex-col overflow-y-auto transaction-table-container" style={{ height }}>
      {/* Header with View Toggle - Ultra Compact */}
      <div className="mb-2">
        <div className="flex bg-[#1A1A1A] rounded p-0.5 w-full">
          <button
            onClick={() => setView('orderbook')}
            className={`flex-1 py-1 px-1.5 rounded text-[10px] font-medium transition-colors ${
              view === 'orderbook'
                ? 'bg-[#333333] text-white'
                : 'text-gray-200 hover:text-white'
            }`}
          >
            BOOK
          </button>
          <button
            onClick={() => setView('transactions')}
            className={`flex-1 py-1 px-1.5 rounded text-[10px] font-medium transition-colors ${
              view === 'transactions'
                ? 'bg-[#333333] text-white'
                : 'text-gray-200 hover:text-white'
            }`}
          >
            TRADES
          </button>
        </div>

      </div>

      {/* Filters - Ultra Compact */}
      <div className="mb-2">
        {/* Loading/Error States */}
        {error ? (
          <div className="text-[10px] text-red-500 text-center py-2">
            {error}
          </div>
        ) : view === 'transactions' ? (
          <div className="text-[10px] text-gray-200 text-center py-1">
            {filteredAndSortedData.length} filled
                {!marketIdentifier && (
                  <span className="block text-[9px] text-gray-300">
                    Connect wallet to see orders
                  </span>
                )}
          </div>
        ) : (
          <div className="text-[10px] text-gray-200 text-center py-1">
            Order Book
                {!marketIdentifier && (
                  <span className="block text-[9px] text-gray-300">
                    Market data unavailable
                  </span>
                )}
          </div>
        )}
      </div>

      {/* Table Headers */}
      <div className="mb-1">
        {view === 'orderbook' ? (
          <div className="grid grid-cols-[2fr_1.5fr_1.5fr] gap-2 text-[10px] font-medium text-gray-200 px-1">
            <div className="flex items-center justify-center">PRICE</div>
            <div className="flex items-center justify-center">SIZE (UNITS)</div>
            <div className="flex items-center justify-center">TOTAL (USD)</div>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_1fr_0.8fr] gap-1 text-[10px] font-medium text-gray-200 px-1">
            <div className="text-right">SIZE (UNITS)</div>
            <div className="text-right">PRICE</div>
            <div className="text-right">TIME</div>
          </div>
        )}
      </div>

      {/* Orders/Trades Table */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {view === 'orderbook' ? (
          /* Traditional OrderBook Display */
          <div className="flex-1 flex flex-col">
            {/* Ask Orders (Sell Orders) - Just above spread */}
            <div className="overflow-hidden flex flex-col justify-end" style={{ minHeight: '200px' }}>
              <div className="overflow-y-auto orders-table-scroll flex-grow-0" style={{ maxHeight: '200px' }}>
                {asks.length === 0 ? (
                  <div className="text-[10px] text-gray-200 text-center py-2">
                    No sell orders
                  </div>
                ) : (
                  <div className="space-y-0 flex flex-col justify-end">
                    {(() => { let cumulativeAskUsd = 0; return [...asks].slice(0, 10).map((order, index) => {
                      const remainingQuantity = order.quantity - order.filled_quantity;
                      const maxQuantity = Math.max(...asks.map(o => o.quantity - o.filled_quantity));
                      const fillPercentage = maxQuantity > 0 ? (remainingQuantity / maxQuantity) * 100 : 0;
                      const lineUsd = (remainingQuantity * (order.price || 0));
                      // Removed cumulativeAskUsd += lineUsd; to avoid cumulative total
                      
                      return (
                        <AnimatedOrderRow
                          key={order.order_id}
                          orderId={order.order_id}
                          side="SELL"
                          isNew={false}
                          animationDelay={0}
                          className="hover:bg-[#1A1A1A] transition-colors group cursor-pointer"
                        >
                          {/* Background depth bar */}
                          <div 
                            className="absolute right-0 top-0 h-full opacity-10 bg-[#FF4747]"
                            style={{ width: `${fillPercentage}%` }}
                          />
                          
                          {/* Content */}
                          <div className="relative grid grid-cols-[2fr_1.5fr_1.5fr] gap-2 py-0.5 px-1 text-[11px]">
                            <div className="flex items-center justify-center text-[#FF4747] font-mono font-medium tabular-nums">
                              ${order.price !== undefined && order.price !== null ? formatPriceDisplay(order.price, 4) : '0.0000'}
                            </div>
                            <div className="flex items-center justify-center text-gray-300 font-mono tabular-nums">
                              {formatAmountDisplay(remainingQuantity, 4)}
                            </div>
                            <div className="flex items-center justify-center text-gray-200 font-mono text-[10px] tabular-nums">
                              {formatCurrency(lineUsd)}
                            </div>
                          </div>
                        </AnimatedOrderRow>
                      );
                    }) })()}
                  </div>
                )}
              </div>
            </div>

            {/* Ask Orders Label */}
            <div className="text-[9px] text-gray-200 px-1 py-0.5 flex items-center justify-between">
              <span>ASKS (SELL)</span>
              <span className="text-[#FF4747]">{asks.length} orders</span>
            </div>

            {/* Spread Display */}
            <div className="pt-0 pb-1 px-1 bg-[#1A1A1A] border-y border-gray-700">
              <div className="text-[10px] text-gray-200 text-center font-mono tabular-nums">
                {bestAskPrice > 0 && bestBidPrice > 0 ? (
                  <>
                    Spread: ${((bestAskPrice - bestBidPrice)).toFixed(4)}
                    <span className="text-[9px] text-gray-200 ml-2">
                      ({((((bestAskPrice - bestBidPrice) / (bestBidPrice || 1)) * 100).toFixed(2))}%)
                    </span>
                  </>
                ) : (
                  'No spread data'
                )}
              </div>
            </div>

            {/* Bid Orders (Buy Orders) - Bottom half */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="text-[9px] text-gray-200 mb-1 px-1 flex items-center justify-between">
                <span>BIDS (BUY)</span>
                <span className="text-[#00D084]">{bids.length} orders</span>
              </div>
              <div className="flex-1 overflow-y-auto orders-table-scroll">
                {bids.length === 0 ? (
                  <div className="text-[10px] text-gray-200 text-center py-2">
                    No buy orders
                  </div>
                ) : (
                  <div className="space-y-0">
                    {(() => { let cumulativeBidUsd = 0; return bids.slice(0, 10).map((order, index) => {
                      const remainingQuantity = order.quantity - order.filled_quantity;
                      const maxQuantity = Math.max(...bids.map(o => o.quantity - o.filled_quantity));
                      const fillPercentage = maxQuantity > 0 ? (remainingQuantity / maxQuantity) * 100 : 0;
                      const lineUsd = (remainingQuantity * (order.price || 0));
                      // Removed cumulativeBidUsd += lineUsd; to avoid cumulative total
                      
                      return (
                        <AnimatedOrderRow
                          key={order.order_id}
                          orderId={order.order_id}
                          side="BUY"
                          isNew={false}
                          animationDelay={0}
                          className="hover:bg-[#1A1A1A] transition-colors group cursor-pointer"
                        >
                          {/* Background depth bar */}
                          <div 
                            className="absolute left-0 top-0 h-full opacity-10 bg-[#00D084]"
                            style={{ width: `${fillPercentage}%` }}
                          />
                          
                          {/* Content */}
                          <div className="relative grid grid-cols-[2fr_1.5fr_1.5fr] gap-2 py-0.5 px-1 text-[11px]">
                            <div className="flex items-center justify-center text-[#00D084] font-mono font-medium tabular-nums">
                              ${order.price !== undefined && order.price !== null ? formatPriceDisplay(order.price, 4) : '0.0000'}
                            </div>
                            <div className="flex items-center justify-center text-gray-300 font-mono tabular-nums">
                              {formatAmountDisplay(remainingQuantity, 4)}
                            </div>
                            <div className="flex items-center justify-center text-gray-200 font-mono text-[10px] tabular-nums">
                              {formatCurrency(lineUsd)}
                            </div>
                          </div>
                        </AnimatedOrderRow>
                      );
                    }) })()}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Traditional Trades Display */
          <div className="overflow-y-auto orders-table-scroll">
            {filteredAndSortedData.length === 0 ? (
              <div className="text-[10px] text-gray-200 text-center py-4">
                No filled orders found
                {!marketIdentifier && (
                  <div className="text-[9px] text-gray-300 mt-1">
                    Market data unavailable
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-0">
                {filteredAndSortedData.map((order, index) => {
                  const fillPercentage = Math.max(...filteredAndSortedData.map(o => o.quantity)) > 0 
                    ? (order.quantity / Math.max(...filteredAndSortedData.map(o => o.quantity))) * 100 
                    : 0;
                  
                  return (
                    <AnimatedOrderRow
                      key={order.order_id}
                      orderId={order.order_id}
                      side={order.side.toUpperCase() as 'BUY' | 'SELL'}
                      isNew={false}
                      animationDelay={0}
                      className="hover:bg-[#1A1A1A] transition-colors group cursor-pointer"
                    >
                      {/* Background depth bar */}
                      <div 
                        className={`absolute left-0 top-0 h-full opacity-12 rounded-xl ${
                                                      order.side.toLowerCase() === 'buy' ? 'bg-[#00D084]' : 'bg-[#FF4747]'
                        }`}
                        style={{ width: `${fillPercentage}%` }}
                      />
                      
                      {/* Content */}
                      <div className="relative grid grid-cols-[1fr_1fr_0.8fr] gap-1 py-0.5 px-1 text-[11px]">
                        <div className="text-right text-gray-300 font-mono flex items-center justify-end tabular-nums">
                          <OrderBookAnimatedQuantity
                            orderId={order.order_id}
                            quantity={order.quantity}
                            side={order.side.toUpperCase() as 'BUY' | 'SELL'}
                            isNewOrder={false}
                            className="text-gray-300"
                            formatQuantity={(q) => formatAmountDisplay(q, 4)}
                          />
                        </div>
                        <div className={`text-right font-mono font-medium flex items-center justify-end tabular-nums ${order.side.toLowerCase() === 'buy' ? 'text-[#00D084]' : 'text-[#FF4747]'}`}>
                          {order.price ? `$${formatPriceDisplay(order.price, 4)}` : 'MARKET'}
                        </div>
                        <div className="text-right text-gray-200 font-mono text-[10px] flex items-center justify-end tabular-nums">
                          {formatTime(order.created_at)}
                        </div>
                      </div>
                    </AnimatedOrderRow>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}