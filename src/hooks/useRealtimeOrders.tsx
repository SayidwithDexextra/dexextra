'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Address } from 'viem';
import { PusherClientService } from '@/lib/pusher-client';
import { orderService } from '@/lib/orderService';
import { Order, MarketDepth, Transaction } from '@/types/orders';

interface UseRealtimeOrdersOptions {
  trader?: Address;
  metricId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
  enableRealtime?: boolean;
}

interface UseRealtimeOrdersReturn {
  orders: Order[];
  transactions: Transaction[];
  marketDepth: MarketDepth | null;
  isLoading: boolean;
  isConnected: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface OrderUpdate {
  orderId: string;
  trader: string;
  metricId: string;
  orderType: string;
  side: string;
  quantity: number;
  price: number;
  filledQuantity?: number;
  status?: string;
  eventType: string;
  timestamp: number;
  source?: string;
  txHash?: string;
}

/**
 * Enhanced hook with real-time Pusher subscriptions for live order updates
 */
export function useRealtimeOrders(options: UseRealtimeOrdersOptions = {}): UseRealtimeOrdersReturn {
  const {
    trader,
    metricId,
    autoRefresh = true,
    refreshInterval = 15000,
    enableRealtime = true
  } = options;
  
  console.log('🔍 [REALTIME] useRealtimeOrders hook called with:', { trader, metricId, autoRefresh, enableRealtime });

  const [orders, setOrders] = useState<Order[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [marketDepth, setMarketDepth] = useState<MarketDepth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize Pusher client
  const pusherClient = useMemo(() => {
    if (!enableRealtime) return null;
    return new PusherClientService({ enableLogging: false });
  }, [enableRealtime]);

  // Fetch orders function (same as original hook)
  const fetchOrders = useCallback(async () => {
    console.log('🔍 [REALTIME] fetchOrders called with:', { trader, metricId });
    
    try {
      setError(null);
      
      let fetchedOrders: Order[] = [];

      if (trader) {
        // Fetch user-specific orders using HyperLiquid OrderBook contract
        console.log('🔍 [REALTIME] Fetching orders for trader:', trader);
        console.log('🔍 [REALTIME] Using HyperLiquid OrderBook getUserOrders...');
        
        // Use HyperLiquid OrderBook contract directly
        const orderBookOrders = await orderService.getUserOrdersFromOrderBook(trader, metricId);

        console.log('📊 [REALTIME] HyperLiquid OrderBook getUserOrders result:', {
          orderCount: orderBookOrders.length,
          orders: orderBookOrders.slice(0, 2), // Log first 2 for debugging
          trader,
          metricId
        });

        fetchedOrders = orderBookOrders;
        
        // If we have a specific metricId, filter for it
        if (metricId) {
          fetchedOrders = fetchedOrders.filter(order => order.metricId === metricId);
        }
      } else if (metricId) {
        // Fetch all orders for a specific metric using our new query API
        console.log('🔍 [REALTIME] Fetching orders for metric:', metricId);
        
        try {
          const url = `/api/orders/query?metricId=${encodeURIComponent(metricId)}&limit=100`;
          console.log('🔍 [REALTIME] Fetching orders for metricId:', metricId);
          console.log('🔍 [REALTIME] Full URL:', url);
          
          const response = await fetch(url);
          console.log('🔍 [REALTIME] Response status:', response.status, response.ok);
          
          if (response.ok) {
            const data = await response.json();
            console.log('🔍 [REALTIME] Raw API response:', data);
            
            if ((data as any).success && (data as any).orders) {
              console.log('🔍 [REALTIME] Sample order data:', (data as any).orders[0]);
              
              // Transform Supabase orders to frontend Order format
              fetchedOrders = (data as any).orders.map((order: any) => ({
                id: order.order_id?.toString() || `order-${Date.now()}`,
                trader: order.trader_wallet_address || order.user_address || '0x0000000000000000000000000000000000000000',
                metricId: metricId,
                type: (order.order_type || 'limit').toLowerCase() as any,
                side: (order.side || 'buy').toLowerCase() as any,
                quantity: order.quantity || order.size || 0,
                price: order.price, // Keep null for market orders
                filledQuantity: order.filled_quantity || order.filled || 0,
                timestamp: order.created_at ? new Date(order.created_at).getTime() : Date.now(),
                expiryTime: order.expiry_time ? new Date(order.expiry_time).getTime() : null,
                status: (order.order_status || order.status || 'pending').toLowerCase().replace('partial', 'partially_filled') as any,
                timeInForce: (order.time_in_force || 'gtc').toLowerCase() as any,
                stopPrice: order.stop_price || null,
                icebergQty: order.iceberg_quantity || null,
                postOnly: order.post_only || false,
              }));
              console.log('🔍 [REALTIME] Transformed orders:', fetchedOrders.length, 'orders');
            } else {
              console.warn('🔍 [REALTIME] API response missing success or orders field:', data);
            }
          } else {
            console.warn('🔍 [REALTIME] Failed to fetch orders from query API, status:', response.status);
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
        console.log('📊 [REALTIME] Constructing market depth from orders for:', metricId);
        console.log('📊 [REALTIME] Total fetched orders:', fetchedOrders.length);
        console.log('📊 [REALTIME] Order statuses:', fetchedOrders.map(o => o.status));
        
        // Filter active orders (pending and partially filled orders with remaining quantity)
        const activeOrders = fetchedOrders.filter(order => 
          (order.status === 'pending' || order.status === 'partially_filled' || (order.status as any) === 'partial') &&
          (order.quantity - order.filledQuantity) > 0
        );
        
        console.log('📊 [REALTIME] Active orders after filtering:', activeOrders.length);
        
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

      console.log(`✅ [REALTIME] Successfully fetched ${fetchedOrders.length} orders and ${transformedTransactions.length} transactions`);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch orders';
      console.error('❌ [REALTIME] Error fetching orders:', errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [trader, metricId]);

  // Transform order update to frontend format
  const transformOrderUpdate = useCallback((update: OrderUpdate): Transaction => {
    return {
      id: `${update.orderId}-${update.timestamp}`,
      type: update.side.toLowerCase() === 'buy' ? 'long' : 'short',
      amount: update.quantity,
      price: update.price,
      timestamp: update.timestamp,
      status: update.status?.toLowerCase() === 'filled' ? 'closed' : 'open',
      pnl: 0, // Will be calculated separately
      leverage: 1,
      fees: 0
    };
  }, []);

  // Handle real-time order updates
  const handleOrderUpdate = useCallback((update: OrderUpdate) => {
    console.log('📡 [REALTIME] Received order update:', update);

    // Filter updates based on current context
    if (metricId && update.metricId !== metricId) {
      return; // Not for this market
    }
    if (trader && update.trader.toLowerCase() !== trader.toLowerCase()) {
      return; // Not for this trader
    }

    // Create transaction for recent activity display
    const newTransaction = transformOrderUpdate(update);

    // Update transactions list
    setTransactions(prev => {
      // Add new transaction at the beginning and keep only last 100
      const updated = [newTransaction, ...prev.filter(tx => tx.id !== newTransaction.id)];
      return updated.slice(0, 100);
    });

    // Update orders list if needed
    setOrders(prev => {
      const orderIndex = prev.findIndex(order => order.id === update.orderId);
      
      if (orderIndex >= 0) {
        // Update existing order
        const updatedOrders = [...prev];
        updatedOrders[orderIndex] = {
          ...updatedOrders[orderIndex],
          filledQuantity: update.filledQuantity || updatedOrders[orderIndex].filledQuantity,
          status: (update.status as any)?.toLowerCase() || updatedOrders[orderIndex].status,
          timestamp: update.timestamp
        };
        return updatedOrders;
      } else if (update.eventType === 'placed') {
        // Add new order
        const newOrder: Order = {
          id: update.orderId,
          trader: update.trader as any,
          metricId: update.metricId,
          type: update.orderType.toLowerCase() as any,
          side: update.side.toLowerCase() as any,
          quantity: update.quantity,
          price: update.price,
          filledQuantity: update.filledQuantity || 0,
          timestamp: update.timestamp,
          status: (update.status?.toLowerCase() || 'pending') as any,
          timeInForce: 'gtc',
          stopPrice: 0,
          icebergQty: 0,
          postOnly: false,
          expiryTime: null
        };
        return [newOrder, ...prev];
      }
      
      return prev;
    });

    console.log(`✅ [REALTIME] Applied order update for ${update.orderId}`);
  }, [metricId, trader, transformOrderUpdate]);

  // Set up real-time subscriptions
  useEffect(() => {
    if (!pusherClient || !enableRealtime) return;

    const subscriptions: string[] = [];
    const unsubscribeFunctions: (() => void)[] = [];

    console.log('🚀 [REALTIME] Setting up real-time subscriptions...', { metricId, trader, enableRealtime });

    // Subscribe to connection status
    const connectionUnsubscribe = pusherClient.onConnectionStateChange((state) => {
      setIsConnected(state === 'connected');
      console.log(`📡 [REALTIME] Pusher connection state: ${state}`);
    });
    unsubscribeFunctions.push(connectionUnsubscribe);

    // 1. Subscribe to market-specific updates if metricId is provided
    if (metricId) {
      const marketChannel = `market-${metricId}`;
      const unsubscribeMarket = pusherClient.subscribeToChannel(marketChannel, {
        'order-update': handleOrderUpdate,
        'new-order': handleOrderUpdate
      });
      subscriptions.push(marketChannel);
      unsubscribeFunctions.push(unsubscribeMarket);
      console.log(`📡 [REALTIME] Subscribed to ${marketChannel}`);
    }

    // 2. Subscribe to user-specific updates if trader is provided
    if (trader) {
      const userChannel = `user-${trader}`;
      const unsubscribeUser = pusherClient.subscribeToChannel(userChannel, {
        'order-update': handleOrderUpdate
      });
      subscriptions.push(userChannel);
      unsubscribeFunctions.push(unsubscribeUser);
      console.log(`📡 [REALTIME] Subscribed to ${userChannel}`);
    }

    // 3. Subscribe to global recent transactions for general activity
    if (!trader && !metricId) {
      const globalChannel = 'recent-transactions';
      const unsubscribeGlobal = pusherClient.subscribeToChannel(globalChannel, {
        'new-order': handleOrderUpdate
      });
      subscriptions.push(globalChannel);
      unsubscribeFunctions.push(unsubscribeGlobal);
      console.log(`📡 [REALTIME] Subscribed to ${globalChannel}`);
    }

    console.log(`📡 [REALTIME] Total subscriptions created: ${subscriptions.length}`);

    // Cleanup subscriptions
    return () => {
      console.log(`🧹 [REALTIME] Cleaning up ${unsubscribeFunctions.length} subscriptions...`);
      unsubscribeFunctions.forEach((unsubscribe, index) => {
        try {
          unsubscribe();
          console.log(`✅ [REALTIME] Unsubscribed ${index + 1}/${unsubscribeFunctions.length}`);
        } catch (error) {
          console.error(`❌ [REALTIME] Error unsubscribing ${index + 1}:`, error);
        }
      });
    };
  }, [pusherClient, enableRealtime, metricId, trader, handleOrderUpdate]);

  // Initial fetch
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Auto-refresh setup (reduced frequency since we have real-time updates)
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
    isConnected,
    error,
    refetch
  };
}

/**
 * Hook specifically for real-time user orders
 */
export function useRealtimeUserOrders(trader: Address | undefined, autoRefresh = true) {
  return useRealtimeOrders({
    trader,
    autoRefresh,
    refreshInterval: 30000,
    enableRealtime: true
  });
}

/**
 * Hook specifically for real-time market orders and depth with live updates
 */
export function useRealtimeMarketOrders(metricId: string | undefined, autoRefresh = true) {
  console.log('🔍 [REALTIME_MARKET_ORDERS] Called with metricId:', metricId, 'autoRefresh:', autoRefresh);
  
  return useRealtimeOrders({
    metricId,
    autoRefresh,
    refreshInterval: 30000, // Longer interval since we have real-time updates
    enableRealtime: true
  });
}

/**
 * Hook for combined real-time user and market data
 */
export function useRealtimeUserMarketOrders(trader: Address | undefined, metricId: string | undefined, autoRefresh = true) {
  return useRealtimeOrders({
    trader,
    metricId,
    autoRefresh,
    refreshInterval: 45000, // Longer interval since we have real-time updates
    enableRealtime: true
  });
}
