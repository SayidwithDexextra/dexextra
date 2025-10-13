'use client';

import { useState, useEffect, useCallback } from 'react';
import { OrderbookMarket } from './useOrderbookMarkets';
import { shouldFetchOrderbookData, resolveSymbolToMetricId } from '@/lib/market-utils';

export interface OrderbookMarketOrder {
  id: string;
  order_id: number;
  market_id: string;
  trader_wallet_address: string;
  trader_user_id?: string;
  order_type: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number;
  filled_quantity: number;
  order_status: string;
  time_in_force: string;
  expiry_time?: string;
  stop_price?: number;
  iceberg_quantity?: number;
  post_only: boolean;
  is_initial_order: boolean;
  creation_transaction_hash?: string;
  creation_block_number?: number;
  created_at: string;
  updated_at: string;
}

export interface OrderbookMarketPosition {
  id: string;
  position_id: number;
  market_id: string;
  trader_wallet_address: string;
  trader_user_id?: string;
  is_long: boolean;
  quantity: number;
  entry_price: number;
  collateral: number;
  is_settled: boolean;
  settlement_payout?: number;
  settlement_pnl?: number;
  creation_transaction_hash?: string;
  creation_block_number?: number;
  settlement_transaction_hash?: string;
  settlement_block_number?: number;
  created_at: string;
  updated_at: string;
  settled_at?: string;
}

export interface OrderbookMarketData {
  market: OrderbookMarket;
  orders: OrderbookMarketOrder[];
  positions: OrderbookMarketPosition[];
  metadata: {
    total_orders: number;
    total_positions: number;
    deployment_status: 'deployed' | 'pending';
  };
}

interface UseOrderbookMarketOptions {
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
}

interface UseOrderbookMarketReturn {
  marketData: OrderbookMarketData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useOrderbookMarket(
  metricId: string,
  options: UseOrderbookMarketOptions = {}
): UseOrderbookMarketReturn {
  const {
    autoRefresh = true,
    refreshInterval = 30000 // 30 seconds default
  } = options;

  const [marketData, setMarketData] = useState<OrderbookMarketData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMarketData = useCallback(async () => {
    if (!metricId || metricId.trim() === '') {
      setError('Invalid metric ID');
      setIsLoading(false);
      return;
    }

    // Skip API call for tokens that are unlikely to be orderbook markets
    if (!shouldFetchOrderbookData(metricId)) {
      console.log(`ℹ️ Skipping orderbook fetch for standard token: ${metricId}`);
      setMarketData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    // Resolve the symbol to the correct metric ID dynamically (e.g., "aluminum_v2" -> "ALUMINUM_V2")
    const resolvedMetricId = await resolveSymbolToMetricId(metricId);

    console.log(`🔍 Fetching orderbook market data:`, {
      originalSymbol: metricId,
      resolvedMetricId: resolvedMetricId,
      shouldFetch: shouldFetchOrderbookData(metricId)
    });

    try {
      setError(null);
      
      const response = await fetch(`/api/orderbook-markets/${encodeURIComponent(resolvedMetricId)}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        // Remove no-store to allow browser caching
        cache: 'default'
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText };
        }
        
        if (response.status === 404) {
          // Market not found - this is expected for tokens that don't have orderbook markets
          // Don't log as error, just set market data to null
          console.log(`ℹ️ No orderbook market found for ${metricId} (this is normal for standard tokens)`);
          setMarketData(null);
          setError(null); // Don't set this as an error state
          return;
        }
        
        // Only log actual errors (not 404s)
        console.error('❌ API Response Error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as {
        success: boolean;
        error?: string;
        market?: OrderbookMarket;
        orders?: OrderbookMarketOrder[];
        positions?: OrderbookMarketPosition[];
        metadata?: {
          total_orders: number;
          total_positions: number;
          deployment_status: 'deployed' | 'pending';
        };
      };
      
      if (!data.success) {
        throw new Error(data.error || 'API request failed');
      }

      console.log(`✅ Successfully fetched market data for ${metricId}:`, {
        marketStatus: data.market?.market_status,
        deploymentStatus: data.metadata?.deployment_status,
        ordersCount: data.orders?.length || 0,
        positionsCount: data.positions?.length || 0
      });

      setMarketData({
        market: data.market!,
        orders: data.orders || [],
        positions: data.positions || [],
        metadata: data.metadata || {
          total_orders: 0,
          total_positions: 0,
          deployment_status: 'pending'
        }
      });
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch market data';
      console.error('❌ Error fetching orderbook market:', errorMessage);
      setError(errorMessage);
      
      // Don't clear existing market data on error for better UX
    } finally {
      setIsLoading(false);
    }
  }, [metricId]);

  // Initial fetch
  useEffect(() => {
    fetchMarketData();
  }, [fetchMarketData]);

  // Auto-refresh setup
  useEffect(() => {
    if (!autoRefresh || !metricId) return;

    const interval = setInterval(() => {
      // Only auto-refresh if there's no error and we're not currently loading
      if (!error && !isLoading) {
        fetchMarketData();
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchMarketData, error, isLoading, metricId]);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    await fetchMarketData();
  }, [fetchMarketData]);

  return {
    marketData,
    isLoading,
    error,
    refetch
  };
}