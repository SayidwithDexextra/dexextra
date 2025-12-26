'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useMarket } from '@/hooks/useMarket';
import { useMarketTicker } from '@/hooks/useMarketTicker';
import { useOrderBookContractData } from '@/hooks/useOrderBookContractData';
import { useOrderBook } from '@/hooks/useOrderBook';
import { usePositions as usePositionsHook } from '@/hooks/usePositions';
import type { Market } from '@/hooks/useMarkets';
import type { TokenData } from '@/types/token';

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
  depth?: {
    bidPrices: number[];
    bidAmounts: number[];
    askPrices: number[];
    askAmounts: number[];
  } | null;
  recentTrades?: Array<{ tradeId: string; price: number; amount: number; timestamp: number }> | null;
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
}

const MarketDataContext = createContext<MarketDataContextValue | undefined>(undefined);

interface ProviderProps {
  symbol: string;
  children: React.ReactNode;
  /** Disable ticker polling (useful during deployment/bootstrapping). Default: true */
  tickerEnabled?: boolean;
}

export function MarketDataProvider({ symbol, children, tickerEnabled = true }: ProviderProps) {
  const { market, isLoading: isLoadingMarket, error: marketError, refetch } = useMarket(symbol);
  const { data: dbTicker } = useMarketTicker({ identifier: symbol, refreshInterval: 10000, enabled: tickerEnabled });

  // Shared OrderBook read-only live data (one instance)
  const { data: obLive, isLoading: obLoading, error: obError } = useOrderBookContractData(symbol, {
    refreshInterval: 15000,
    orderBookAddress: (market as any)?.market_address || undefined,
    marketIdBytes32: (market as any)?.market_id_bytes32 || undefined
  });

  // Shared OrderBook actions/state (one instance across the page)
  const [orderBookState, orderBookActions] = useOrderBook(symbol);

  // Positions gating
  const [positionsEnabled, setPositionsEnabled] = useState<boolean>(false);
  const positionsState = usePositionsHook(symbol, { enabled: positionsEnabled });

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
    // 3) Use DB ticker mark price if not stale (stored with 1e6 precision)
    if (dbTicker?.mark_price && dbTicker.mark_price > 0 && !dbTicker.is_stale) {
      return dbTicker.mark_price / 1_000_000;
    }
    // 4) Use tick_size as base for new markets
    if ((market as any)?.tick_size && (market as any)?.tick_size > 0) {
      return (market as any).tick_size as number;
    }
    return 1.0;
  }, [obLive?.bestBid, obLive?.bestAsk, obLive?.lastTradePrice, dbTicker?.mark_price, dbTicker?.is_stale, (market as any)?.tick_size]);

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
    depth: obLive?.depth ?? null,
    recentTrades: obLive?.recentTrades ?? null,
    lastUpdated: obLive?.lastUpdated ?? null,

    tokenData,
    resolvedPrice,

    orderBookState,
    orderBookActions,

    positionsState,
    enablePositions: () => setPositionsEnabled(true),
    disablePositions: () => setPositionsEnabled(false)
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


