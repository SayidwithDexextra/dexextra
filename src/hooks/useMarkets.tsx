'use client';

import { useState, useEffect } from 'react';

// Market type based on the new unified markets table
export interface Market {
  id: string;
  market_identifier: string;
  symbol: string;
  name: string;
  description: string;
  category: string;
  decimals: number;
  minimum_order_size: number;
  tick_size: number;
  settlement_date: string;
  trading_end_date: string;
  market_address: string | null;
  // factory_address removed from DB
  market_id_bytes32: string | null;
  total_volume: number;
  total_trades: number;
  open_interest_long: number;
  open_interest_short: number;
  last_trade_price: number | null;
  market_status: string;
  creator_wallet_address: string;
  banner_image_url: string | null;
  icon_image_url: string | null;
  created_at: string;
  deployed_at: string | null;
  chain_id: number;
  network: string;
  initial_order?: any;
  market_config?: any;
}

interface UseMarketsOptions {
  status?: string;
  category?: string;
  creator?: string;
  search?: string;
  limit?: number;
  offset?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseMarketsResult {
  markets: Market[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export function useMarkets(options: UseMarketsOptions = {}): UseMarketsResult {
  const {
    status,
    category,
    creator,
    search,
    limit = 50,
    offset = 0,
    autoRefresh = false,
    refreshInterval = 60000, // Default 1 minute
  } = options;

  const [markets, setMarkets] = useState<Market[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    limit,
    offset,
    total: 0
  });

  const fetchMarkets = async () => {
    try {
      setIsLoading(true);
      
      // Build query params
      const params = new URLSearchParams();
      if (status) params.append('status', status);
      if (category) params.append('category', category);
      if (creator) params.append('creator', creator);
      if (search) params.append('search', search);
      params.append('limit', limit.toString());
      params.append('offset', offset.toString());
      
      // Fetch data from API
      const response = await fetch(`/api/markets?${params.toString()}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch markets');
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Unknown error fetching markets');
      }
      
      setMarkets(data.markets || []);
      setPagination({
        limit,
        offset,
        total: data.pagination?.total || data.markets?.length || 0
      });
      setError(null);
    } catch (err) {
      console.error('Error fetching markets:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch markets');
    } finally {
      setIsLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchMarkets();
  }, [status, category, creator, search, limit, offset]);

  // Set up auto-refresh if enabled
  useEffect(() => {
    if (!autoRefresh) return;
    
    const intervalId = setInterval(() => {
      fetchMarkets();
    }, refreshInterval);
    
    // Clean up interval on unmount
    return () => clearInterval(intervalId);
  }, [autoRefresh, refreshInterval, status, category, creator, search, limit, offset]);

  return {
    markets,
    isLoading,
    error,
    refetch: fetchMarkets,
    pagination
  };
}

