import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

interface OrderBookLevel {
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  orders: number;
  orderIds: string[];
}

interface OrderBookData {
  marketId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  totalBidVolume: number;
  totalAskVolume: number;
  timestamp: string;
}

interface MarketOrderUpdate {
  type: 'market_order_executed';
  marketId: string;
  timestamp: string;
  data: {
    orderBook: OrderBookData;
    executedOrder: {
      orderId: string;
      side: string;
      size: string;
      type: 'MARKET';
    };
    impact: {
      unitsMatched: number;
      bestBidBefore: number | null;
      bestAskBefore: number | null;
      bestBidAfter: number | null;
      bestAskAfter: number | null;
    };
  };
}

interface UseOrderBookUpdatesOptions {
  marketId?: string;
  autoRefetch?: boolean;
  refreshInterval?: number;
}

/**
 * Hook for real-time order book updates and unit availability tracking
 * Subscribes to market order executions and order book changes
 */
export function useOrderBookUpdates(options: UseOrderBookUpdatesOptions = {}) {
  const { marketId, autoRefetch = true, refreshInterval = 30000 } = options;
  
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

  // Initialize Supabase client
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  /**
   * Fetch current order book data
   */
  const fetchOrderBook = useCallback(async (targetMarketId?: string) => {
    const fetchMarketId = targetMarketId || marketId;
    if (!fetchMarketId) return;

    setIsLoading(true);
    setError(null);

    try {
      console.log(`📊 [ORDER_BOOK] Fetching current data for ${fetchMarketId}`);
      
      // Use the order-book-manager edge function for consolidated data
      const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/order-book-manager?marketId=${fetchMarketId}&action=orderbook`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch order book: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success && result.orderBook) {
        setOrderBook(result.orderBook);
        setLastUpdate(new Date().toISOString());
        console.log(`✅ [ORDER_BOOK] Updated for ${fetchMarketId}:`, {
          bids: result.orderBook.bids?.length || 0,
          asks: result.orderBook.asks?.length || 0,
          bestBid: result.orderBook.bestBid,
          bestAsk: result.orderBook.bestAsk,
          totalBidVolume: result.orderBook.totalBidVolume,
          totalAskVolume: result.orderBook.totalAskVolume
        });
      } else {
        throw new Error(result.error || 'Failed to fetch order book data');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('❌ [ORDER_BOOK] Fetch failed:', errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [marketId, supabase]);

  /**
   * Handle real-time order book updates
   */
  const handleOrderBookUpdate = useCallback((payload: MarketOrderUpdate) => {
    console.log(`📡 [ORDER_BOOK] Real-time update received:`, {
      type: payload.type,
      marketId: payload.marketId,
      executedOrder: payload.data.executedOrder,
      unitsMatched: payload.data.impact.unitsMatched
    });

    // Update order book with new data
    if (payload.data.orderBook) {
      setOrderBook(payload.data.orderBook);
      setLastUpdate(payload.timestamp);
    }

    // Log impact for debugging
    console.log(`📊 [MARKET_IMPACT] Order execution impact:`, {
      orderId: payload.data.executedOrder.orderId,
      side: payload.data.executedOrder.side,
      size: payload.data.executedOrder.size,
      unitsMatched: payload.data.impact.unitsMatched,
      bidPriceChange: {
        before: payload.data.impact.bestBidBefore,
        after: payload.data.impact.bestBidAfter,
        changed: payload.data.impact.bestBidBefore !== payload.data.impact.bestBidAfter
      },
      askPriceChange: {
        before: payload.data.impact.bestAskBefore,
        after: payload.data.impact.bestAskAfter,
        changed: payload.data.impact.bestAskBefore !== payload.data.impact.bestAskAfter
      }
    });
  }, []);

  /**
   * Setup real-time subscriptions
   */
  useEffect(() => {
    if (!marketId) return;

    console.log(`🔗 [SUBSCRIPTION] Setting up real-time subscriptions for ${marketId}`);
    setConnectionStatus('connecting');

    // Subscribe to market-specific channel
    const marketChannel = supabase
      .channel(`market:${marketId}`)
      .on('broadcast', { event: 'order_book_updated' }, (payload) => {
        handleOrderBookUpdate(payload.payload as MarketOrderUpdate);
      })
      .subscribe((status) => {
        console.log(`📡 [SUBSCRIPTION] Market channel status: ${status}`);
        setConnectionStatus(status === 'SUBSCRIBED' ? 'connected' : 'disconnected');
      });

    // Subscribe to global trading activity
    const tradingChannel = supabase
      .channel('trading-activity')
      .on('broadcast', { event: 'market_order_executed' }, (payload) => {
        const update = payload.payload as MarketOrderUpdate;
        // Only handle updates for our market
        if (update.marketId === marketId) {
          handleOrderBookUpdate(update);
        }
      })
      .subscribe((status) => {
        console.log(`📡 [SUBSCRIPTION] Trading channel status: ${status}`);
      });

    // Initial fetch
    fetchOrderBook();

    // Cleanup subscriptions
    return () => {
      console.log(`🔌 [SUBSCRIPTION] Cleaning up subscriptions for ${marketId}`);
      marketChannel.unsubscribe();
      tradingChannel.unsubscribe();
      setConnectionStatus('disconnected');
    };
  }, [marketId, supabase, fetchOrderBook, handleOrderBookUpdate]);

  /**
   * Auto-refresh functionality
   */
  useEffect(() => {
    if (!autoRefetch || !marketId) return;

    const interval = setInterval(() => {
      console.log(`🔄 [AUTO_REFRESH] Refreshing order book for ${marketId}`);
      fetchOrderBook();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefetch, marketId, refreshInterval, fetchOrderBook]);

  /**
   * Manually trigger order book refresh
   */
  const refreshOrderBook = useCallback(() => {
    console.log(`🔄 [MANUAL_REFRESH] User triggered order book refresh`);
    fetchOrderBook();
  }, [fetchOrderBook]);

  /**
   * Get available units for a specific side and price level
   */
  const getAvailableUnits = useCallback((side: 'BUY' | 'SELL', price?: number) => {
    if (!orderBook) return 0;

    const levels = side === 'BUY' ? orderBook.bids : orderBook.asks;
    
    if (price) {
      // Get units at specific price level
      const level = levels.find(l => l.price === price);
      return level?.quantity || 0;
    } else {
      // Get total available units
      return levels.reduce((total, level) => total + level.quantity, 0);
    }
  }, [orderBook]);

  /**
   * Get best available price for market orders
   */
  const getBestMarketPrice = useCallback((side: 'BUY' | 'SELL') => {
    if (!orderBook) return null;
    
    // For buy market orders, we match against sell orders (asks)
    // For sell market orders, we match against buy orders (bids)
    return side === 'BUY' ? orderBook.bestAsk : orderBook.bestBid;
  }, [orderBook]);

  return {
    // Data
    orderBook,
    lastUpdate,
    
    // State
    isLoading,
    error,
    connectionStatus,
    isConnected: connectionStatus === 'connected',
    
    // Actions
    refreshOrderBook,
    fetchOrderBook,
    
    // Helpers
    getAvailableUnits,
    getBestMarketPrice,
    
    // Metrics
    totalBidVolume: orderBook?.totalBidVolume || 0,
    totalAskVolume: orderBook?.totalAskVolume || 0,
    spread: orderBook?.spread || null,
    bestBid: orderBook?.bestBid || null,
    bestAsk: orderBook?.bestAsk || null,
  };
}





