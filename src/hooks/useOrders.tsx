'use client';

import { useState, useEffect, useCallback } from 'react';
import { Address } from 'viem';
import { orderService } from '@/lib/orderService';
import { Order, MarketDepth, Transaction } from '@/types/orders';

interface UseOrdersOptions {
  trader?: Address;
  metricId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseOrdersReturn {
  orders: Order[];
  transactions: Transaction[];
  marketDepth: MarketDepth | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch orders from smart contracts using Viem
 */
export function useOrders(options: UseOrdersOptions = {}): UseOrdersReturn {
  const {
    trader,
    metricId,
    autoRefresh = true,
    refreshInterval = 30000 // 30 seconds
  } = options;

  const [orders, setOrders] = useState<Order[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [marketDepth, setMarketDepth] = useState<MarketDepth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setError(null);
      
      let fetchedOrders: Order[] = [];

      if (trader) {
        // Fetch user-specific orders
        console.log('🔍 Fetching orders for trader:', trader);
        
        // Get both active orders and recent history
        const [activeOrders, orderHistory] = await Promise.all([
          orderService.getUserActiveOrders(trader),
          orderService.getUserOrderHistory(trader, 50, 0)
        ]);

        // Combine and deduplicate
        const allUserOrders = [...activeOrders, ...orderHistory];
        const uniqueOrders = allUserOrders.filter((order, index, self) => 
          index === self.findIndex(o => o.id === order.id)
        );

        fetchedOrders = uniqueOrders;
        
        // If we have a specific metricId, filter for it
        if (metricId) {
          fetchedOrders = fetchedOrders.filter(order => order.metricId === metricId);
        }
      } else if (metricId) {
        // Fetch all orders for a specific metric using our new query API
        console.log('🔍 Fetching orders for metric:', metricId);
        
        try {
          const response = await fetch(`/api/orders/query?metricId=${encodeURIComponent(metricId)}&limit=100`);
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.orders) {
              // Transform Supabase orders to frontend Order format
              fetchedOrders = data.orders.map((order: any) => ({
                id: order.order_id.toString(),
                trader: order.trader_wallet_address,
                metricId: metricId,
                type: order.order_type.toLowerCase(),
                side: order.side.toLowerCase(),
                quantity: order.quantity,
                price: order.price,
                filledQuantity: order.filled_quantity,
                timestamp: new Date(order.created_at).getTime(),
                expiryTime: order.expiry_time ? new Date(order.expiry_time).getTime() : null,
                status: order.order_status.toLowerCase(),
                timeInForce: order.time_in_force.toLowerCase(),
                stopPrice: order.stop_price,
                icebergQty: order.iceberg_quantity,
                postOnly: order.post_only,
              }));
            }
          } else {
            console.warn('Failed to fetch orders from query API, falling back to orderService');
            fetchedOrders = await orderService.getMetricOrders(metricId, 100);
          }
        } catch (error) {
          console.warn('Error fetching from query API, falling back to orderService:', error);
          fetchedOrders = await orderService.getMetricOrders(metricId, 100);
        }
      }

      // Construct market depth from fetched orders
      let depth: MarketDepth | null = null;
      if (metricId && fetchedOrders.length > 0) {
        console.log('📊 Constructing market depth from orders for:', metricId);
        
        // Filter pending orders only
        const activeOrders = fetchedOrders.filter(order => order.status === 'pending');
        
        // Separate buy and sell orders
        const buyOrders = activeOrders.filter(order => order.side === 'buy');
        const sellOrders = activeOrders.filter(order => order.side === 'sell');
        
        // Convert to order book entries
        const bids = buyOrders.map(order => ({
          id: order.id,
          price: order.price,
          quantity: order.quantity - order.filledQuantity,
          total: order.price * (order.quantity - order.filledQuantity),
          side: 'bid' as const,
          timestamp: order.timestamp,
          trader: order.trader,
        })).sort((a, b) => b.price - a.price); // Highest bid first
        
        const asks = sellOrders.map(order => ({
          id: order.id,
          price: order.price,
          quantity: order.quantity - order.filledQuantity,
          total: order.price * (order.quantity - order.filledQuantity),
          side: 'ask' as const,
          timestamp: order.timestamp,
          trader: order.trader,
        })).sort((a, b) => a.price - b.price); // Lowest ask first
        
        // Calculate spread and mid price
        const bestBid = bids.length > 0 ? bids[0].price : 0;
        const bestAsk = asks.length > 0 ? asks[0].price : 0;
        const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
        const midPrice = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : bestAsk || bestBid || 0;
        
        depth = { bids, asks, spread, midPrice };
        setMarketDepth(depth);
      } else if (metricId) {
        // Set empty market depth if no orders
        setMarketDepth({
          bids: [],
          asks: [],
          spread: 0,
          midPrice: 0,
        });
      }

      // Transform orders to transactions for backward compatibility
      const transformedTransactions = orderService.transformOrdersToTransactions(fetchedOrders);

      setOrders(fetchedOrders);
      setTransactions(transformedTransactions);

      console.log(`✅ Successfully fetched ${fetchedOrders.length} orders and ${transformedTransactions.length} transactions`);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch orders';
      console.error('❌ Error fetching orders:', errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [trader, metricId]);

  // Initial fetch
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Auto-refresh setup
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      // Only auto-refresh if there's no error and we're not currently loading
      if (!error && !isLoading) {
        fetchOrders();
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchOrders, error, isLoading]);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    await fetchOrders();
  }, [fetchOrders]);

  return {
    orders,
    transactions,
    marketDepth,
    isLoading,
    error,
    refetch
  };
}

/**
 * Hook specifically for user orders
 */
export function useUserOrders(trader: Address | undefined, autoRefresh = true) {
  return useOrders({
    trader,
    autoRefresh,
    refreshInterval: 30000
  });
}

/**
 * Hook specifically for market orders and depth
 */
export function useMarketOrders(metricId: string | undefined, autoRefresh = true) {
  return useOrders({
    metricId,
    autoRefresh,
    refreshInterval: 15000 // More frequent updates for market data
  });
}

/**
 * Hook for combined user and market data
 */
export function useUserMarketOrders(trader: Address | undefined, metricId: string | undefined, autoRefresh = true) {
  return useOrders({
    trader,
    metricId,
    autoRefresh,
    refreshInterval: 20000
  });
}
