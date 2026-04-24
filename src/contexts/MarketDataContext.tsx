'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useMarket } from '@/hooks/useMarket';
import { useMarketTicker } from '@/hooks/useMarketTicker';
import { useOrderBookContractData } from '@/hooks/useOrderBookContractData';
import { useOrderBook } from '@/hooks/useOrderBook';
import { usePositions as usePositionsHook } from '@/hooks/usePositions';
import { useLightweightOrderBookStore, useOrderBook as useLightweightOB } from '@/stores/lightweightOrderBookStore';
import { useWallet } from '@/hooks/useWallet';
import type { Market } from '@/hooks/useMarkets';
import type { TokenData } from '@/types/token';
import { createPublicClient, webSocket, type Address } from 'viem';
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

  // Track recent trades we initiated as TAKER (to avoid double-counting)
  // Format: Set of "price:timestamp" strings, auto-expires after 30 seconds
  const recentTakerTradesRef = useRef<Set<string>>(new Set());
  
  // Function to record that we placed a trade as taker (called from TradingPanel via context)
  const recordTakerTrade = useCallback((price: number) => {
    const key = `${price.toFixed(6)}:${Date.now()}`;
    recentTakerTradesRef.current.add(key);
    // Auto-cleanup after 30 seconds
    setTimeout(() => {
      recentTakerTradesRef.current.delete(key);
    }, 30000);
  }, []);
  
  // Check if a trade at this price was recently initiated by us as taker
  const isRecentTakerTrade = useCallback((price: number): boolean => {
    const now = Date.now();
    const priceStr = price.toFixed(6);
    for (const key of recentTakerTradesRef.current) {
      const [keyPrice, keyTime] = key.split(':');
      if (keyPrice === priceStr && now - parseInt(keyTime) < 30000) {
        return true;
      }
    }
    return false;
  }, []);

  // Track resting orders by orderId so we can remove liquidity when cancelled
  // Map of orderId -> { price, amount, isBuy }
  const restingOrdersRef = useRef<Map<string, { price: number; amount: number; isBuy: boolean }>>(new Map());

  // WEBSOCKET BLOCKCHAIN EVENT LISTENERS
  // Uses watchContractEvent for real-time event subscriptions
  const marketAddress = (market as any)?.market_address as Address | undefined;
  
  useEffect(() => {
    if (!marketAddress || !symbol) return;
    if (!CHAIN_CONFIG.wsRpcUrl) {
      console.warn('[BlockchainEvents] No WebSocket RPC URL configured, event listeners disabled');
      return;
    }
    
    const ORDER_PLACED_ABI = {
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
    } as const;
    
    const ORDER_RESTED_ABI = {
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
    } as const;
    
    const TRADE_EXECUTED_ABI = {
      type: 'event',
      name: 'TradeExecutionCompleted',
      inputs: [
        { indexed: true, name: 'buyer', type: 'address' },
        { indexed: true, name: 'seller', type: 'address' },
        { indexed: false, name: 'price', type: 'uint256' },
        { indexed: false, name: 'amount', type: 'uint256' },
      ],
    } as const;
    
    const ORDER_CANCELLED_ABI = {
      type: 'event',
      name: 'OrderCancelled',
      inputs: [
        { indexed: true, name: 'orderId', type: 'uint256' },
        { indexed: true, name: 'trader', type: 'address' },
        { indexed: false, name: 'price', type: 'uint256' },
        { indexed: false, name: 'amount', type: 'uint256' },
        { indexed: false, name: 'isBuy', type: 'bool' },
      ],
    } as const;
    
    const client = createPublicClient({
      transport: webSocket(CHAIN_CONFIG.wsRpcUrl),
    });
    
    const myAddress = userAddress?.toLowerCase() || '';
    
    console.log(`[BlockchainEvents] Starting WebSocket listeners for ${symbol} at ${marketAddress}`);
    
    // Watch for OrderPlaced events (dispatched for mark price refresh)
    const unwatchOrderPlaced = client.watchContractEvent({
      address: marketAddress,
      abi: [ORDER_PLACED_ABI],
      eventName: 'OrderPlaced',
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as any;
          const price = args.price ? Number(args.price) / 1e6 : 0;
          const amount = args.amount ? Number(args.amount) / 1e18 : 0;
          const isBuy = args.isBuy;
          const trader = args.trader ? String(args.trader).toLowerCase() : '';
          const orderId = args.orderId ? String(args.orderId) : '?';
          const rawPrice = args.price ? String(args.price) : '0';
          const rawAmount = args.amount ? String(args.amount) : '0';
          
          console.log(`[BlockchainEvents] OrderPlaced received`, {
            orderId,
            price: price.toFixed(4),
            amount: amount.toFixed(6),
            isBuy,
            trader: trader.slice(0, 10) + '...',
          });
          
          // Dispatch window event for mark price refresh (debounced in listeners)
          try {
            console.log(`[LiveUpdate][dispatch] OrderPlaced symbol=${symbol} price=${price.toFixed(4)}`);
            window.dispatchEvent(new CustomEvent('ordersUpdated', {
              detail: {
                symbol,
                eventType: 'OrderPlaced',
                orderId,
                price: rawPrice,
                amount: rawAmount,
                isBuy,
                trader,
                timestamp: Date.now(),
                source: 'websocket',
              }
            }));
          } catch (err) {
            console.error('[LiveUpdate][dispatch] OrderPlaced error:', err);
          }
        }
      },
      onError: (error) => {
        console.error('[BlockchainEvents] OrderPlaced watcher error:', error);
      },
    });
    
    // Watch for OrderRested events (limit orders resting on the book)
    const unwatchOrderRested = client.watchContractEvent({
      address: marketAddress,
      abi: [ORDER_RESTED_ABI],
      eventName: 'OrderRested',
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as any;
          const orderId = args.orderId ? String(args.orderId) : '';
          const price = args.price ? Number(args.price) / 1e6 : 0;
          const amount = args.amount ? Number(args.amount) / 1e18 : 0;
          const isBuy = args.isBuy;
          const trader = args.trader ? String(args.trader).toLowerCase() : '';
          const rawPrice = args.price ? String(args.price) : '0';
          const rawAmount = args.amount ? String(args.amount) : '0';
          
          console.log(`[BlockchainEvents] OrderRested received`, {
            orderId,
            price: price.toFixed(4),
            amount: amount.toFixed(6),
            isBuy,
            trader: trader.slice(0, 10) + '...',
          });
          
          // Track this resting order so we can remove it if cancelled
          if (orderId) {
            restingOrdersRef.current.set(orderId, { price, amount, isBuy });
          }
          
          // Dispatch window event for mark price refresh (debounced in listeners)
          try {
            console.log(`[LiveUpdate][dispatch] OrderRested symbol=${symbol} price=${price.toFixed(4)}`);
            window.dispatchEvent(new CustomEvent('ordersUpdated', {
              detail: {
                symbol,
                eventType: 'OrderRested',
                orderId,
                price: rawPrice,
                amount: rawAmount,
                isBuy,
                trader,
                timestamp: Date.now(),
                source: 'websocket',
              }
            }));
          } catch (err) {
            console.error('[LiveUpdate][dispatch] OrderRested error:', err);
          }
          
          // Skip own orders for liquidity updates - already handled by optimistic updates
          if (myAddress && trader === myAddress) {
            console.log(`[BlockchainEvents] Skipping own OrderRested liquidity update (but tracked for cancellation)`);
            continue;
          }
          
          const side = isBuy ? 'buy' : 'sell';
          console.log(`[BlockchainEvents] Adding liquidity: ${side.toUpperCase()} ${amount.toFixed(6)} @ ${price.toFixed(4)}`);
          lightweightStore.addLiquidity(symbol, side, price, amount);
        }
      },
      onError: (error) => {
        console.error('[BlockchainEvents] OrderRested watcher error:', error);
      },
    });
    
    // Watch for OrderCancelled events (orders being removed from book)
    const unwatchOrderCancelled = client.watchContractEvent({
      address: marketAddress,
      abi: [ORDER_CANCELLED_ABI],
      eventName: 'OrderCancelled',
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as any;
          const orderId = args.orderId ? String(args.orderId) : '';
          const trader = args.trader ? String(args.trader).toLowerCase() : '';
          const price = args.price ? Number(args.price) / 1e6 : 0;
          const amount = args.amount ? Number(args.amount) / 1e18 : 0;
          const isBuy = args.isBuy;
          
          console.log(`[BlockchainEvents] OrderCancelled received`, {
            orderId,
            price: price.toFixed(4),
            amount: amount.toFixed(6),
            isBuy,
            trader: trader.slice(0, 10) + '...',
          });
          
          // Remove liquidity directly using event data (no need for tracking map)
          if (price > 0 && amount > 0) {
            const side = isBuy ? 'buy' : 'sell';
            console.log(`[BlockchainEvents] Removing cancelled order liquidity: ${side.toUpperCase()} ${amount.toFixed(6)} @ ${price.toFixed(4)}`);
            lightweightStore.removeLiquidity(symbol, side, price, amount);
          }
          
          // Also clean up from tracking map if present
          restingOrdersRef.current.delete(orderId);
        }
      },
      onError: (error) => {
        console.error('[BlockchainEvents] OrderCancelled watcher error:', error);
      },
    });
    
    // Watch for TradeExecutionCompleted events (trades removing liquidity)
    const unwatchTradeExecuted = client.watchContractEvent({
      address: marketAddress,
      abi: [TRADE_EXECUTED_ABI],
      eventName: 'TradeExecutionCompleted',
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as any;
          const price = args.price ? Number(args.price) / 1e6 : 0;
          const amount = args.amount ? Number(args.amount) / 1e18 : 0;
          const buyer = args.buyer ? String(args.buyer).toLowerCase() : '';
          const seller = args.seller ? String(args.seller).toLowerCase() : '';
          
          const isInvolved = myAddress && (buyer === myAddress || seller === myAddress);
          const isTaker = isInvolved && isRecentTakerTrade(price);
          
          console.log(`[LiveUpdate][websocket] TradeExecutionCompleted received for ${symbol}`, {
            price: price.toFixed(4),
            amount: amount.toFixed(6),
            buyer: buyer.slice(0, 10) + '...',
            seller: seller.slice(0, 10) + '...',
            isInvolved,
            isTaker,
          });
          
          // Only skip if we're the TAKER (initiated the trade from TradingPanel)
          // If we're the MAKER (our resting order got filled), we need the UI update
          if (isTaker) {
            console.log(`[BlockchainEvents] Skipping own TAKER trade (already updated optimistically)`);
            continue;
          }
          
          // Remove liquidity from both sides (we don't know which was maker)
          console.log(`[BlockchainEvents] Removing liquidity (trade): ${amount.toFixed(6)} @ ${price.toFixed(4)} from both sides`);
          lightweightStore.removeLiquidity(symbol, 'buy', price, amount);
          lightweightStore.removeLiquidity(symbol, 'sell', price, amount);
          
          // Dispatch window event so other components (TokenHeader, useAllTrades) can react
          try {
            const rawPrice = args.price ? String(args.price) : '0';
            const rawAmount = args.amount ? String(args.amount) : '0';
            console.log(`[LiveUpdate][dispatch] symbol=${symbol} price=${price.toFixed(4)} rawPrice=${rawPrice}`);
            window.dispatchEvent(new CustomEvent('ordersUpdated', {
              detail: {
                symbol,
                eventType: 'TradeExecutionCompleted',
                price: rawPrice,
                amount: rawAmount,
                buyer,
                seller,
                timestamp: Date.now(),
                source: 'websocket',
              }
            }));
          } catch (err) {
            console.error('[LiveUpdate][dispatch] Error:', err);
          }
        }
      },
      onError: (error) => {
        console.error('[BlockchainEvents] TradeExecutionCompleted watcher error:', error);
      },
    });
    
    return () => {
      console.log(`[BlockchainEvents] Stopping WebSocket listeners for ${symbol}`);
      unwatchOrderPlaced();
      unwatchOrderRested();
      unwatchOrderCancelled();
      unwatchTradeExecuted();
    };
  }, [marketAddress, symbol, userAddress, lightweightStore, isRecentTakerTrade]);

  // Listen for DOM events from user's own order cancellations (from MarketActivityTabs)
  // This provides immediate optimistic updates when the user cancels their own orders
  useEffect(() => {
    if (!symbol) return;
    
    const handleOrdersUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.symbol?.toUpperCase() !== symbol.toUpperCase()) return;
      
      if (detail.eventType === 'OrderCancelled') {
        const price = detail.price ? Number(detail.price) / 1e6 : 0;
        const amount = detail.amount ? Number(detail.amount) / 1e18 : 0;
        const isBuy = detail.isBuy;
        const orderId = detail.orderId;
        
        if (price > 0 && amount > 0) {
          const side = isBuy ? 'buy' : 'sell';
          console.log(`[BlockchainEvents] Own order cancelled (DOM event): ${side.toUpperCase()} ${amount.toFixed(6)} @ ${price.toFixed(4)}`);
          lightweightStore.removeLiquidity(symbol, side, price, amount);
          
          // Also remove from our tracking map if present
          if (orderId) {
            restingOrdersRef.current.delete(String(orderId));
          }
        }
      }
    };
    
    window.addEventListener('ordersUpdated', handleOrdersUpdated);
    return () => window.removeEventListener('ordersUpdated', handleOrdersUpdated);
  }, [symbol, lightweightStore]);

  // FALLBACK POLLING: For markets without OrderRested upgrade
  // Periodically fetch fresh order book data from API and re-initialize the lightweight store
  // This ensures the UI stays in sync even without real-time events
  const lastFallbackRefreshRef = useRef<number>(0);
  const hasReceivedEventsRef = useRef<boolean>(false);
  
  useEffect(() => {
    if (!symbol || !marketAddress) return;
    
    const FALLBACK_INTERVAL = 15000; // 15 seconds
    const MIN_REFRESH_INTERVAL = 10000; // Don't refresh more often than every 10 seconds
    
    const refreshFromApi = async () => {
      const now = Date.now();
      
      // Skip if we refreshed recently
      if (now - lastFallbackRefreshRef.current < MIN_REFRESH_INTERVAL) return;
      
      try {
        const response = await fetch(`/api/orderbook/live?symbol=${encodeURIComponent(symbol)}&levels=25`);
        if (!response.ok) return;
        
        const data = await response.json();
        if (!data?.depth) return;
        
        const depth = data.depth;
        if (!depth.bidPrices?.length && !depth.askPrices?.length) return;
        
        // Re-initialize the lightweight order book with fresh data
        lightweightStore.initializeOrderBook(symbol, depth, 'api');
        lastFallbackRefreshRef.current = now;
      } catch (err) {
        // Silently fail - this is just a fallback
      }
    };
    
    // Start fallback polling after a short delay to allow event-based updates to work first
    let intervalId: ReturnType<typeof setInterval> | null = null;
    
    const startDelay = setTimeout(() => {
      refreshFromApi();
      intervalId = setInterval(refreshFromApi, FALLBACK_INTERVAL);
    }, 2000);
    
    return () => {
      clearTimeout(startDelay);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [symbol, marketAddress, lightweightStore]);
  
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


