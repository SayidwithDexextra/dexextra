'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useMarket } from '@/hooks/useMarket';
import { useMarketTicker } from '@/hooks/useMarketTicker';
import { useOrderBookContractData } from '@/hooks/useOrderBookContractData';
import { useOrderBook } from '@/hooks/useOrderBook';
import { usePositions as usePositionsHook } from '@/hooks/usePositions';
import { useLightweightOrderBookStore, useOrderBook as useLightweightOB } from '@/stores/lightweightOrderBookStore';
import { useWallet } from '@/hooks/useWallet';
import type { Market } from '@/hooks/useMarkets';
import type { TokenData } from '@/types/token';
import { createPublicClient, http, type Address } from 'viem';
import { CHAIN_CONFIG } from '@/lib/contractConfig';

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
}

const MarketDataContext = createContext<MarketDataContextValue | undefined>(undefined);

interface ProviderProps {
  symbol: string;
  children: React.ReactNode;
  /** Disable ticker realtime subscription (useful during deployment/bootstrapping). Default: true */
  tickerEnabled?: boolean;
}

export function MarketDataProvider({ symbol, children, tickerEnabled = true }: ProviderProps) {
  // Get user's wallet address for filtering own orders from event processing
  const wallet = useWallet() as any;
  const userAddress: string | null = wallet?.walletData?.address ?? wallet?.address ?? null;

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

  // SIMPLE DIRECT BLOCKCHAIN EVENT LISTENER
  // Polls for new events every 3 seconds and updates the order book
  const marketAddress = (market as any)?.market_address as Address | undefined;
  const lastBlockRef = useRef<bigint>(0n);
  
  useEffect(() => {
    if (!marketAddress || !symbol) return;
    
    const ORDER_EVENTS_ABI = [
      {
        type: 'event',
        name: 'OrderPlaced',
        inputs: [
          { indexed: true, name: 'orderId', type: 'uint256' },
          { indexed: true, name: 'trader', type: 'address' },
          { indexed: false, name: 'price', type: 'uint256' },
          { indexed: false, name: 'amount', type: 'uint256' },
          { indexed: false, name: 'isBuy', type: 'bool' },
          { indexed: false, name: 'isMarginOrder', type: 'bool' },
        ],
      },
      {
        type: 'event',
        name: 'OrderRested',
        inputs: [
          { indexed: true, name: 'orderId', type: 'uint256' },
          { indexed: true, name: 'trader', type: 'address' },
          { indexed: false, name: 'price', type: 'uint256' },
          { indexed: false, name: 'amount', type: 'uint256' },
          { indexed: false, name: 'isBuy', type: 'bool' },
          { indexed: false, name: 'isMarginOrder', type: 'bool' },
        ],
      },
      {
        type: 'event',
        name: 'TradeExecutionCompleted',
        inputs: [
          { indexed: true, name: 'buyer', type: 'address' },
          { indexed: true, name: 'seller', type: 'address' },
          { indexed: false, name: 'price', type: 'uint256' },
          { indexed: false, name: 'amount', type: 'uint256' },
        ],
      },
    ] as const;
    
    const pollEvents = async () => {
      try {
        const client = createPublicClient({
          transport: http(CHAIN_CONFIG.rpcUrl),
        });
        
        const currentBlock = await client.getBlockNumber();
        
        // Initialize from 10 blocks ago on first run
        if (lastBlockRef.current === 0n) {
          lastBlockRef.current = currentBlock > 10n ? currentBlock - 10n : 0n;
        }
        
        if (currentBlock <= lastBlockRef.current) return;
        
        const logs = await client.getLogs({
          address: marketAddress,
          events: ORDER_EVENTS_ABI,
          fromBlock: lastBlockRef.current + 1n,
          toBlock: currentBlock,
        });
        
        lastBlockRef.current = currentBlock;
        
        if (logs.length === 0) return;
        
        for (const log of logs) {
          const eventName = (log as any).eventName;
          const args = (log as any).args || {};
          const myAddress = userAddress?.toLowerCase() || '';
          
          // Scale values: price is 1e6, amount is 1e18
          const price = args.price ? Number(args.price) / 1e6 : 0;
          const amount = args.amount ? Number(args.amount) / 1e18 : 0;
          const isBuy = args.isBuy;
          
          // Get trader address - different field names for different events
          const trader = args.trader ? String(args.trader).toLowerCase() : '';
          const buyer = args.buyer ? String(args.buyer).toLowerCase() : '';
          const seller = args.seller ? String(args.seller).toLowerCase() : '';
          
          // Check if this is our own order/trade
          const isOwnOrder = myAddress && (
            trader === myAddress || 
            buyer === myAddress || 
            seller === myAddress
          );
          
          // Skip ALL events involving our address - already handled by optimistic updates
          if (isOwnOrder) continue;
          
          if (eventName === 'OrderRested') {
            // Limit order rested on book - ADD liquidity
            const side = isBuy ? 'buy' : 'sell';
            lightweightStore.addLiquidity(symbol, side, price, amount);
          } else if (eventName === 'TradeExecutionCompleted') {
            // Trade executed - REMOVE liquidity from BOTH sides (we don't know which was maker)
            lightweightStore.removeLiquidity(symbol, 'buy', price, amount);
            lightweightStore.removeLiquidity(symbol, 'sell', price, amount);
          }
        }
      } catch (err) {
        console.error('[BlockchainEvents] Error polling events:', err);
      }
    };
    
    // Poll immediately and then every 3 seconds
    pollEvents();
    const interval = setInterval(pollEvents, 3000);
    
    return () => clearInterval(interval);
  }, [marketAddress, symbol, userAddress, lightweightStore]);
  
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


