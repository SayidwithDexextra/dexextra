'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useMarket } from '@/hooks/useMarket';
import { useMarketTicker } from '@/hooks/useMarketTicker';
import { useOrderBookContractData } from '@/hooks/useOrderBookContractData';
import { useOrderBook } from '@/hooks/useOrderBook';
import { usePositions as usePositionsHook } from '@/hooks/usePositions';
import { useLightweightOrderBookStore, useOrderBook as useLightweightOB } from '@/stores/lightweightOrderBookStore';
import { usePusher } from '@/lib/pusher-client';
import type { Market } from '@/hooks/useMarkets';
import type { TokenData } from '@/types/token';
import type { Address } from 'viem';

interface MarketDataContextValue {
  symbol: string;
  market: Market | null;
  isLoading: boolean;
  error: Error | string | null;
  refetchMarket: () => Promise<void>;

  // OrderBook live data (read-only)
  orderBookAddress?: string | null;
  bestBid?: number | null;
  bestAsk?: number | null;
  markPrice?: number | null;
  lastTradePrice?: number | null;
  volume24h?: number | null;
  totalTrades?: number | null;
  /** Total number of active BUY orders in the market (not capped by UI depth rendering). */
  activeBuyOrders?: number | null;
  /** Total number of active SELL orders in the market (not capped by UI depth rendering). */
  activeSellOrders?: number | null;
  depth?: {
    bidPrices: number[];
    bidAmounts: number[];
    askPrices: number[];
    askAmounts: number[];
  } | null;
  recentTrades?: Array<{
    tradeId: string;
    price: number;
    amount: number;
    timestamp: number;
    buyer?: string;
    seller?: string;
    tradeValue?: number;
    buyerFee?: number;
    sellerFee?: number;
  }> | null;
  lastUpdated: string | null;

  // Unified token data
  tokenData: TokenData | null;

  // Resolved display price
  resolvedPrice: number;

  // OrderBook actions/state (single shared instance)
  orderBookState: ReturnType<typeof useOrderBook>[0];
  orderBookActions: ReturnType<typeof useOrderBook>[1];

  // Positions (gated polling)
  positionsState: ReturnType<typeof usePositionsHook>;
  enablePositions: () => void;
  disablePositions: () => void;

  // Lightweight order book for optimistic updates (fast UI)
  lightweightOrderBook: ReturnType<typeof useLightweightOB>;
  simulateOptimisticTrade: (
    side: 'buy' | 'sell',
    type: 'market' | 'limit',
    price: number,
    amount: number
  ) => { filledPrice: number; filledAmount: number; priceImpact: number };
  // Record that we initiated a trade as taker (to avoid double-counting on event receipt)
  recordTakerTrade: (price: number) => void;
}

const MarketDataContext = createContext<MarketDataContextValue | undefined>(undefined);

interface ProviderProps {
  symbol: string;
  children: React.ReactNode;
  /** Disable ticker realtime subscription (useful during deployment/bootstrapping). Default: true */
  tickerEnabled?: boolean;
}

export function MarketDataProvider({ symbol, children, tickerEnabled = true }: ProviderProps) {
  const { market, isLoading: isLoadingMarket, error: marketError, refetch } = useMarket(symbol);
  const { data: dbTicker } = useMarketTicker({
    marketId: (market as any)?.id || undefined,
    identifier: symbol,
    refreshInterval: 60_000,
    enabled: tickerEnabled,
  });

  // Shared OrderBook read-only live data (one instance)
  const { data: obLive, isLoading: obLoading, error: obError } = useOrderBookContractData(symbol, {
    refreshInterval: 15000,
    orderBookAddress: (market as any)?.market_address || undefined,
    marketIdBytes32: (market as any)?.market_id_bytes32 || undefined,
    // Fetch more depth levels so the BOOK tab isn't capped at 10 per side.
    // Server API currently clamps to max 25.
    levels: 25,
  });

  // Shared OrderBook actions/state (one instance across the page)
  const [orderBookState, orderBookActions] = useOrderBook(symbol);

  // Positions gating
  const [positionsEnabled, setPositionsEnabled] = useState<boolean>(false);
  const positionsState = usePositionsHook(symbol, { enabled: positionsEnabled });

  // Lightweight order book for instant UI updates
  const lightweightStore = useLightweightOrderBookStore();
  const lightweightOrderBook = useLightweightOB(symbol);

  // Function to record that we placed a trade as taker (called from TradingPanel via context)
  // This is a simple no-op now since we rely on polling for updates
  const recordTakerTrade = useCallback((_price: number) => {
    // No-op: polling handles all updates now
  }, []);

  // Market address for polling
  const marketAddress = (market as any)?.market_address as Address | undefined;

  // ============================================================================
  // SIMPLE POLLING: Fetch order book every 2 seconds for reliable real-time updates
  // This is the most robust approach - works on any chain, no WebSocket dependencies
  // ============================================================================
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPollTimeRef = useRef<number>(0);
  const pollCountRef = useRef<number>(0);

  useEffect(() => {
    // Start polling even before marketAddress is available
    // The API can resolve the market by symbol
    if (!symbol) {
      console.log('[OrderBookPoll] No symbol, skipping');
      return;
    }

    const POLL_INTERVAL = 2000; // 2 seconds for snappy updates

    const refreshOrderBook = async () => {
      const now = Date.now();
      pollCountRef.current += 1;
      const pollNum = pollCountRef.current;

      try {
        const url = `/api/orderbook/live?symbol=${encodeURIComponent(symbol)}&levels=25`;
        const response = await fetch(url);
        
        if (!response.ok) {
          console.warn(`[OrderBookPoll] #${pollNum} API error: ${response.status}`);
          return;
        }

        const json = await response.json();
        // API returns { ok: true, data: { depth: {...} } }
        const depth = json?.data?.depth;
        
        if (!depth) {
          // Only log occasionally to avoid spam
          if (pollNum % 10 === 1) {
            console.warn(`[OrderBookPoll] #${pollNum} No depth in response`, { ok: json?.ok, hasData: !!json?.data });
          }
          return;
        }

        const bidCount = depth.bidPrices?.length || 0;
        const askCount = depth.askPrices?.length || 0;

        if (bidCount === 0 && askCount === 0) {
          return;
        }

        // Update the zustand store - this triggers React re-renders
        lightweightStore.initializeOrderBook(symbol, depth, 'api');
        lastPollTimeRef.current = now;

        // Log every 5th poll to avoid spam
        if (pollNum % 5 === 1) {
          console.log(`[OrderBookPoll] #${pollNum} ${symbol}: ${bidCount} bids, ${askCount} asks`);
        }
      } catch (err) {
        console.error(`[OrderBookPoll] #${pollNum} Error:`, err);
      }
    };

    // Initial fetch immediately
    refreshOrderBook();

    // Set up interval
    pollIntervalRef.current = setInterval(refreshOrderBook, POLL_INTERVAL);

    // Listen for ordersUpdated events - but skip refresh for local optimistic updates
    // since those are already reflected in the zustand store (prevents flicker)
    const handleOrdersUpdated = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      const eventSymbol = String(detail?.symbol || '').toUpperCase();
      
      // Only respond to events for this market
      if (eventSymbol && eventSymbol !== symbol.toUpperCase()) return;

      // Skip refresh for local optimistic updates - the store already has the data
      const source = String(detail?.source || '').toLowerCase();
      if (source === 'optimistic' || source === 'local') {
        return;
      }
      
      // For external events (pusher, webhooks), schedule a refresh
      setTimeout(refreshOrderBook, 500);
    };

    window.addEventListener('ordersUpdated', handleOrdersUpdated);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      window.removeEventListener('ordersUpdated', handleOrdersUpdated);
    };
  }, [symbol, lightweightStore]);

  // ============================================================================
  // PUSHER SUBSCRIPTION: Listen for events from other users via Pusher
  // This provides immediate updates when another user places/cancels an order
  // ============================================================================
  const pusher = usePusher();

  useEffect(() => {
    if (!symbol || !pusher) return;

    const channel = `market-${symbol}`;
    
    const handlers = {
      'order-update': (data: any) => {
        const eventType = String(data?.eventType || '');
        console.log(`[Pusher] order-update received for ${symbol}:`, eventType);
        
        // Dispatch ordersUpdated event so polling and other listeners can react
        window.dispatchEvent(new CustomEvent('ordersUpdated', {
          detail: {
            symbol,
            source: 'pusher',
            eventType: eventType || 'order-update',
            orderId: data?.orderId,
            price: data?.price,
            amount: data?.amount || data?.filledAmount,
            isBuy: data?.isBuy,
            trader: data?.trader,
            timestamp: Date.now(),
          }
        }));
      },
      'trading-event': (data: any) => {
        console.log(`[Pusher] trading-event received for ${symbol}`);
        
        // Dispatch ordersUpdated for trades too
        window.dispatchEvent(new CustomEvent('ordersUpdated', {
          detail: {
            symbol,
            source: 'pusher',
            eventType: 'TradeExecutionCompleted',
            price: data?.price,
            amount: data?.amount,
            buyer: data?.buyer,
            seller: data?.seller,
            timestamp: Date.now(),
          }
        }));
      },
    };

    console.log(`[Pusher] Subscribing to channel: ${channel}`);
    const unsub = pusher.subscribeToChannel(channel, handlers);

    return () => {
      console.log(`[Pusher] Unsubscribing from channel: ${channel}`);
      try { unsub?.(); } catch {}
    };
  }, [symbol, pusher]);
  
  // Periodically clean up stale pending trades (every 30 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      lightweightStore.cleanupStaleTrades(120_000); // 2 minute timeout
    }, 30_000);
    return () => clearInterval(interval);
  }, [lightweightStore]);

  // Initialize lightweight order book when depth data is loaded from API/RPC
  const lastDepthHashRef = useRef<string>('');
  useEffect(() => {
    if (!obLive?.depth) return;
    const depth = obLive.depth;
    if (!depth.bidPrices?.length && !depth.askPrices?.length) return;

    // Create a simple hash to detect changes and avoid re-initializing on same data
    const hash = `${depth.bidPrices[0] || 0}-${depth.askPrices[0] || 0}-${depth.bidPrices.length}-${depth.askPrices.length}`;
    if (hash === lastDepthHashRef.current) return;
    lastDepthHashRef.current = hash;

    lightweightStore.initializeOrderBook(symbol, depth, 'api');
    console.log(`[MarketDataContext] Lightweight order book initialized for ${symbol}`);
  }, [symbol, obLive?.depth, lightweightStore]);

  // Optimistic trade simulation wrapper
  const simulateOptimisticTrade = useMemo(() => {
    return (
      side: 'buy' | 'sell',
      type: 'market' | 'limit',
      price: number,
      amount: number
    ) => {
      return lightweightStore.simulateTrade(symbol, side, type, price, amount);
    };
  }, [symbol, lightweightStore]);

  // Compute resolved price (same strategy used in page previously)
  const resolvedPrice = useMemo(() => {
    // 1) Use real-time OB spread mid if available
    if (obLive?.bestBid && obLive?.bestAsk && obLive.bestBid > 0 && obLive.bestAsk > 0) {
      return (obLive.bestBid + obLive.bestAsk) / 2;
    }
    // 2) Use last trade price if present
    if (obLive?.lastTradePrice && obLive.lastTradePrice > 0) {
      return obLive.lastTradePrice;
    }
    // 3) Use DB ticker mark price (stored with 1e6 precision)
    // Per requirement: ignore stale state; if the table has a price, render it.
    if (dbTicker?.mark_price && dbTicker.mark_price > 0) {
      return dbTicker.mark_price / 1_000_000;
    }
    // 4) Use tick_size as base for new markets
    if ((market as any)?.tick_size && (market as any)?.tick_size > 0) {
      return (market as any).tick_size as number;
    }
    return 1.0;
  }, [obLive?.bestBid, obLive?.bestAsk, obLive?.lastTradePrice, dbTicker?.mark_price, (market as any)?.tick_size]);

  // Compose token data
  const tokenData: TokenData | null = useMemo(() => {
    if (!market) return null;
    const name = (market as any)?.metric_id || symbol;
    const finalPrice = (obLive?.markPrice ?? resolvedPrice) || 1;
    const volume24h = obLive?.volume24h || (market as any)?.total_volume || 0;
    const priceChange24hAbs = obLive?.priceChange24h || 0;
    const priceChangePct = finalPrice > 0 ? (priceChange24hAbs / finalPrice) * 100 : 0;
    return {
      symbol,
      name,
      price: finalPrice,
      priceChange24h: priceChangePct,
      volume24h,
      marketCap: finalPrice * 1000000,
      marketCapChange24h: priceChangePct,
      chain: String((market as any)?.chain_id || 'polygon'),
      logo: (market as any)?.icon_image_url,
      description: (market as any)?.description,
      created_at: (market as any)?.created_at
    };
  }, [symbol, market, obLive?.markPrice, resolvedPrice, obLive?.volume24h, obLive?.priceChange24h]);

  // Dispatch marketMarkPrice for LightweightChart
  const lastPriceRef = useRef<number | null>(null);
  useEffect(() => {
    const price = Number((obLive?.markPrice ?? resolvedPrice) || 0);
    if (!Number.isFinite(price)) return;
    if (lastPriceRef.current === price) return;
    lastPriceRef.current = price;
    try {
      const detail = { symbol, price, timestamp: Date.now() };
      const evt = new CustomEvent('marketMarkPrice', { detail });
      if (typeof window !== 'undefined') window.dispatchEvent(evt);
    } catch {}
  }, [symbol, obLive?.markPrice, resolvedPrice]);

  const isLoading = isLoadingMarket || obLoading;
  const error = (marketError as any) || (obError as any) || null;

  const contextValue: MarketDataContextValue = {
    symbol,
    market,
    isLoading,
    error,
    refetchMarket: async () => {
      try {
        await refetch();
        // Also refresh order book live data and orders where applicable
        try {
          await orderBookActions.refreshOrders();
        } catch {}
      } catch (e) {
        // swallow to avoid breaking callers
      }
    },

    orderBookAddress: (obLive as any)?.orderBookAddress ?? null,
    bestBid: obLive?.bestBid ?? null,
    bestAsk: obLive?.bestAsk ?? null,
    markPrice: obLive?.markPrice ?? null,
    lastTradePrice: obLive?.lastTradePrice ?? null,
    volume24h: obLive?.volume24h ?? null,
    totalTrades: obLive?.totalTrades ?? null,
    activeBuyOrders: (obLive as any)?.activeBuyOrders ?? null,
    activeSellOrders: (obLive as any)?.activeSellOrders ?? null,
    depth: obLive?.depth ?? null,
    recentTrades: obLive?.recentTrades ?? null,
    lastUpdated: obLive?.lastUpdated ?? null,

    tokenData,
    resolvedPrice,

    orderBookState,
    orderBookActions,

    positionsState,
    enablePositions: () => setPositionsEnabled(true),
    disablePositions: () => setPositionsEnabled(false),

    // Lightweight order book
    lightweightOrderBook,
    simulateOptimisticTrade,
    recordTakerTrade,
  };

  // Listen for cross-route deployment completion to force-refresh this market
  useEffect(() => {
    const onMarketDeployed = (e: any) => {
      try {
        const deployedSymbol = String(e?.detail?.symbol || '').toUpperCase();
        if (!deployedSymbol) return;
        if (String(symbol || '').toUpperCase() !== deployedSymbol) return;
        // Refetch market + orderbook
        contextValue.refetchMarket().catch(() => {});
      } catch {}
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('marketDeployed', onMarketDeployed as EventListener);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('marketDeployed', onMarketDeployed as EventListener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  return (
    <MarketDataContext.Provider value={contextValue}>
      {children}
    </MarketDataContext.Provider>
  );
}

export function useMarketData(): MarketDataContextValue {
  const ctx = useContext(MarketDataContext);
  if (!ctx) throw new Error('useMarketData must be used within MarketDataProvider');
  return ctx;
}

/** Non-throwing variant: returns null when not under `MarketDataProvider`. */
export function useMaybeMarketData(): MarketDataContextValue | null {
  return useContext(MarketDataContext) ?? null;
}


