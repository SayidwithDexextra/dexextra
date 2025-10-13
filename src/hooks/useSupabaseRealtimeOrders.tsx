'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { RealtimeChannel } from '@supabase/supabase-js';

interface OrderFromDB {
  order_id: string; // Fix: order_id is text in database, not number
  market_id: string;
  user_address: string;
  trader_address: string;
  order_type: string;
  side: string;
  size: number;
  quantity: number;
  price: number | null;
  filled: number;
  status: string;
  created_at: string;
  updated_at: string;
  event_type?: string;
}

interface UseSupabaseRealtimeOrdersOptions {
  metricId?: string;
  userAddress?: string;
  autoRefresh?: boolean;
}

interface UseSupabaseRealtimeOrdersReturn {
  orders: OrderFromDB[];
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  refetch: () => Promise<void>;
}

/**
 * Database-agnostic real-time orders hook using Supabase subscriptions
 * Automatically updates when ANY insert/update/delete happens to the orders table
 */
export function useSupabaseRealtimeOrders(
  options: UseSupabaseRealtimeOrdersOptions = {}
): UseSupabaseRealtimeOrdersReturn {
  const { metricId, userAddress, autoRefresh = true } = options;

  const [orders, setOrders] = useState<OrderFromDB[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Initialize Supabase client - memoized to prevent recreation on every render
  const supabase = useMemo(() => createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), []);

  // Fetch orders function
  const fetchOrders = useCallback(async () => {
    try {
      setError(null);
      
      let query = supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      // Apply filters if provided
      if (metricId) {
        query = query.eq('market_id', metricId);
      }
      
      if (userAddress) {
        query = query.or(`user_address.eq.${userAddress},trader_address.eq.${userAddress}`);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        console.error('❌ [SUPABASE_REALTIME] Fetch error:', fetchError);
        setError(fetchError.message);
        return;
      }

      console.log('✅ [SUPABASE_REALTIME] Fetched orders:', data?.length || 0);
      setOrders(data || []);
      
    } catch (err) {
      console.error('❌ [SUPABASE_REALTIME] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [metricId, userAddress, supabase]);

  // Set up real-time subscriptions
  useEffect(() => {
    let channel: RealtimeChannel | null = null;

    const setupRealtimeSubscription = async () => {
      try {
        console.log('🚀 [SUPABASE_REALTIME] Setting up real-time subscription...', { metricId, userAddress });

        // Create a unique channel name to avoid conflicts
        const channelName = `orders_changes_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Create a channel for the orders table
        channel = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            {
              event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
              schema: 'public',
              table: 'orders',
              // Apply filters for specific markets/users only if provided
              ...(metricId && { filter: `market_id=eq.${metricId}` })
            },
            (payload) => {
              console.log('📡 [SUPABASE_REALTIME] Database change detected:', payload);
              
              const { eventType, new: newRecord, old: oldRecord } = payload;

              // Apply additional filtering on the client side for userAddress since Supabase filters are limited
              if (userAddress && newRecord) {
                const matchesUser = newRecord.user_address === userAddress || newRecord.trader_address === userAddress;
                if (!matchesUser) {
                  console.log('🔍 [SUPABASE_REALTIME] Skipping order update - user filter mismatch');
                  return;
                }
              }

              setOrders(currentOrders => {
                switch (eventType) {
                  case 'INSERT':
                    // Add new order to the beginning of the list
                    if (newRecord) {
                      console.log('➕ [SUPABASE_REALTIME] Adding new order:', newRecord.order_id);
                      
                      // Check if order already exists to prevent duplicates
                      const existingOrder = currentOrders.find(o => o.order_id === newRecord.order_id);
                      if (existingOrder) {
                        console.log('⚠️ [SUPABASE_REALTIME] Order already exists, skipping duplicate');
                        return currentOrders;
                      }
                      
                      return [newRecord as OrderFromDB, ...currentOrders];
                    }
                    break;
                    
                  case 'UPDATE':
                    // Update existing order
                    if (newRecord) {
                      console.log('🔄 [SUPABASE_REALTIME] Updating order:', newRecord.order_id);
                      return currentOrders.map(order => 
                        order.order_id === newRecord.order_id ? newRecord as OrderFromDB : order
                      );
                    }
                    break;
                    
                  case 'DELETE':
                    // Remove deleted order
                    if (oldRecord) {
                      console.log('🗑️ [SUPABASE_REALTIME] Removing order:', oldRecord.order_id);
                      return currentOrders.filter(order => order.order_id !== oldRecord.order_id);
                    }
                    break;
                }
                return currentOrders;
              });
            }
          )
          .subscribe((status) => {
            console.log('📡 [SUPABASE_REALTIME] Subscription status:', status);
            setIsConnected(status === 'SUBSCRIBED');
            
            if (status === 'SUBSCRIPTION_ERROR' || status === 'TIMED_OUT') {
              setError(`Real-time subscription failed: ${status}`);
            } else if (status === 'SUBSCRIBED') {
              setError(null); // Clear any previous errors
            }
          });

      } catch (err) {
        console.error('❌ [SUPABASE_REALTIME] Subscription setup failed:', err);
        setError(err instanceof Error ? err.message : 'Real-time setup failed');
      }
    };

    setupRealtimeSubscription();

    // Cleanup subscription
    return () => {
      if (channel) {
        console.log('🧹 [SUPABASE_REALTIME] Cleaning up subscription...');
        supabase.removeChannel(channel);
      }
    };
  }, [metricId, userAddress, supabase]);

  // Initial fetch
  useEffect(() => {
    if (autoRefresh) {
      fetchOrders();
    }
  }, [fetchOrders, autoRefresh]);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    await fetchOrders();
  }, [fetchOrders]);

  return {
    orders,
    isLoading,
    error,
    isConnected,
    refetch
  };
}

