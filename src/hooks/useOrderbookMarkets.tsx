'use client';

import { useState, useEffect, useCallback } from 'react';

export interface OrderbookMarket {
  id: string;
  metric_id: string;
  description: string;
  category: string;
  decimals: number;
  minimum_order_size: number;
  tick_size: number;
  settlement_date: string;
  trading_end_date: string;
  market_address?: string;
  factory_address?: string;
  total_volume?: number;
  total_trades?: number;
  open_interest_long?: number;
  open_interest_short?: number;
  last_trade_price?: number;
  market_status: 'PENDING' | 'DEPLOYING' | 'ACTIVE' | 'TRADING_ENDED' | 'SETTLEMENT_REQUESTED' | 'SETTLED' | 'EXPIRED' | 'PAUSED' | 'ERROR';
  creator_wallet_address: string;
  banner_image_url?: string;
  icon_image_url?: string;
  created_at: string;
  deployed_at?: string;
  chain_id: number;
  network?: string;
}

interface UseOrderbookMarketsOptions {
  status?: string;
  category?: string;
  limit?: number;
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
}

interface UseOrderbookMarketsReturn {
  markets: OrderbookMarket[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  total: number;
}

export function useOrderbookMarkets(options: UseOrderbookMarketsOptions = {}): UseOrderbookMarketsReturn {
  const {
    status = 'ACTIVE', // Default to active markets only
    category,
    limit = 50,
    autoRefresh = true,
    refreshInterval = 60000 // 1 minute default
  } = options;

  const [markets, setMarkets] = useState<OrderbookMarket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const fetchMarkets = useCallback(async () => {
    try {
      setError(null);
      
      // Build query parameters
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: '0'
      });
      
      if (status) {
        params.append('status', status);
      }
      
      if (category) {
        params.append('category', category);
      }

      console.log('🔍 Fetching orderbook markets with params:', { status, category, limit });

      const response = await fetch(`/api/orderbook-markets?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('❌ API Response Error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText };
        }
        
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'API request failed');
      }

      console.log(`✅ Successfully fetched ${data.markets?.length || 0} orderbook markets`);
      
      setMarkets(data.markets || []);
      setTotal(data.pagination?.total || data.markets?.length || 0);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch orderbook markets';
      console.error('❌ Error fetching orderbook markets:', errorMessage);
      setError(errorMessage);
      
      // Don't clear existing markets on error, just show the error
      // This allows for better UX when network is temporarily unavailable
    } finally {
      setIsLoading(false);
    }
  }, [status, category, limit]);

  // Initial fetch
  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  // Auto-refresh setup
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      // Only auto-refresh if there's no error and we're not currently loading
      if (!error && !isLoading) {
        fetchMarkets();
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchMarkets, error, isLoading]);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    await fetchMarkets();
  }, [fetchMarkets]);

  return {
    markets,
    isLoading,
    error,
    refetch,
    total
  };
}
