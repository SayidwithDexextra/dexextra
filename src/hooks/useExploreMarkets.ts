'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';

export type SortMode = 'trending' | 'volume' | 'gainers' | 'losers' | 'newest';

export interface ExploreMarket {
  market_id: string;
  market_identifier: string;
  symbol: string;
  name: string;
  description: string | null;
  category: string | string[];
  icon_image_url: string | null;
  banner_image_url: string | null;
  market_address: string | null;
  chain_id: number;
  network: string;
  market_status: string;
  created_at: string;
  deployed_at: string | null;
  settlement_date: string | null;
  trading_end_date: string | null;
  tick_size: number;
  decimals: number;
  open_interest_long: number;
  open_interest_short: number;

  creator_wallet_address: string | null;
  creator_display_name: string | null;
  creator_profile_image_url: string | null;

  mark_price: number | null;
  is_stale: boolean | null;

  total_volume: number;
  total_trades: number;
  volume_1h: number;
  trades_1h: number;
  price_change_1h: number;
  price_change_24h: number;
  trending_score: number;
}

interface UseExploreMarketsOptions {
  sort?: SortMode;
  search?: string;
  category?: string;
  limit?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useExploreMarkets(options: UseExploreMarketsOptions = {}) {
  const {
    sort = 'trending',
    search = '',
    category = '',
    limit = 50,
    autoRefresh = true,
    refreshInterval = 15000,
  } = options;

  const [data, setData] = useState<ExploreMarket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const paramsKey = useMemo(
    () => JSON.stringify({ sort, search, category, limit }),
    [sort, search, category, limit]
  );

  const fetchMarkets = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('sort', sort);
      params.set('limit', String(limit));
      if (search) params.set('search', search);
      if (category) params.set('category', category);

      const res = await fetch(`/api/explore-markets?${params.toString()}`);
      const json = await res.json();

      if (!mountedRef.current) return;

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to load markets');
      }

      setData(json.markets || []);
      setError(null);
    } catch (e) {
      if (mountedRef.current) {
        setError((e as Error).message);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [sort, search, category, limit]);

  useEffect(() => {
    mountedRef.current = true;
    setIsLoading(true);
    fetchMarkets();
    return () => { mountedRef.current = false; };
  }, [paramsKey, fetchMarkets]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchMarkets, refreshInterval);
    return () => clearInterval(id);
  }, [autoRefresh, refreshInterval, fetchMarkets]);

  return { data, isLoading, error, refetch: fetchMarkets };
}
