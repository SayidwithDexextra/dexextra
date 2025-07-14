'use client';

import { useState, useEffect, useCallback } from 'react';

export interface VAMMMarket {
  id: string;
  symbol: string;
  description: string;
  category: string[];
  oracle_address: string;
  initial_price: number;
  price_decimals: number;
  banner_image_url?: string;
  icon_image_url?: string;
  supporting_photo_urls?: string[];
  deployment_fee: number;
  is_active: boolean;
  vamm_address?: string;
  vault_address?: string;
  market_id?: string;
  deployment_status: string;
  created_at: string;
  user_address?: string;
}

interface UseVAMMMarketsReturn {
  markets: VAMMMarket[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface UseVAMMMarketsOptions {
  limit?: number;
  category?: string;
  status?: string;
}

export const useVAMMMarkets = (options: UseVAMMMarketsOptions = {}): UseVAMMMarketsReturn => {
  const [markets, setMarkets] = useState<VAMMMarket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkets = useCallback(async () => {
    try {
      console.log('🚀 Starting fetchMarkets with options:', options);
      setIsLoading(true);
      setError(null);

      // Build query parameters
      const params = new URLSearchParams({
        limit: (options.limit || 10).toString(),
        offset: '0',
      });

      if (options.category) {
        params.append('category', options.category);
      }

      if (options.status) {
        params.append('status', options.status);
      }

      const url = `/api/markets?${params.toString()}`;
      console.log('📡 Fetching URL:', url);

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      console.log('📬 Response status:', response.status);

      if (!response.ok) {
        throw new Error(`Failed to fetch markets: ${response.status}`);
      }

      const data = await response.json();
      console.log('📦 Response data:', data);

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch markets');
      }

      console.log('✅ Setting markets:', data.markets?.length || 0, 'markets');
      setMarkets(data.markets || []);
    } catch (err) {
      console.error('❌ Error fetching vAMM markets:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch markets');
    } finally {
      setIsLoading(false);
      console.log('🏁 fetchMarkets completed');
    }
  }, [options.limit, options.category, options.status]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  return {
    markets,
    isLoading,
    error,
    refetch: fetchMarkets,
  };
}; 