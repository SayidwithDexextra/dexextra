'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import {
  getFromCacheOrStorage,
  setCache,
  isDataStale,
  CACHE_KEYS,
} from '@/lib/dataCache';

export interface MarketOverviewRow {
  market_id: string;
  market_identifier?: string;
  symbol: string;
  name: string;
  category: string;
  icon_image_url?: string | null;
  banner_image_url?: string | null;
  market_address?: string | null;
  chain_id: number;
  network: string;
  tick_size: number;
  decimals: number;
  is_active: boolean;
  market_status: string;
  settlement_date?: string | null;
  total_volume?: number | null;
  total_trades?: number | null;
  mark_price?: number | null;
  last_update?: string | null;
  is_stale?: boolean | null;
}

export function useMarketOverview({ 
  limit = 50, 
  status, 
  category, 
  search, 
  autoRefresh = true, 
  refreshInterval = 5000, 
  realtime = true,
  realtimeDebounce = 1000 // Add debounce for realtime updates
}: {
  limit?: number;
  status?: string | string[];
  category?: string;
  search?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
  realtime?: boolean;
  realtimeDebounce?: number;
}) {
  // Create a stable, serialized representation of status to avoid effect loops
  const serializedStatus = useMemo(() => {
    if (!status) return '';
    if (Array.isArray(status)) {
      // Sort to ensure stability across equivalent arrays with different orders
      return status
        .filter(Boolean)
        .slice()
        .sort()
        .join(',');
    }
    return status;
  }, [Array.isArray(status) ? [...(status as string[])].sort().join(',') : status]);

  // Generate cache key based on params
  const cacheKey = useMemo(() => {
    const parts = [CACHE_KEYS.MARKET_OVERVIEW, limit, serializedStatus, category, search].filter(Boolean);
    return parts.join(':');
  }, [limit, serializedStatus, category, search]);

  /**
   * IMPORTANT (Next.js SSR hydration):
   * Do NOT read from sessionStorage during the initial render.
   *
   * If we initialize state from sessionStorage, the server render (no access)
   * will produce "loading/empty", while the client can synchronously render
   * cached markets during hydration, causing a hydration mismatch.
   *
   * Instead: start with a deterministic empty/loading state, then load cache
   * after mount in an effect (SWR-style).
   */
  const [data, setData] = useState<MarketOverviewRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasMountedRef = useRef(false);

  async function fetchOverview() {
    try {
      // Only show loading on first fetch if no cache
      if (!hasMountedRef.current) {
        const cached = getFromCacheOrStorage<MarketOverviewRow[]>(cacheKey);
        if (!cached) {
          setIsLoading(true);
        }
      } else {
        setIsLoading(true);
      }

      const params = new URLSearchParams();
      params.set('limit', String(limit));
      if (serializedStatus) params.set('status', serializedStatus);
      if (category) params.set('category', category);
      if (search) params.set('search', search);

      const res = await fetch(`/api/market-overview?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load market overview');
      
      const markets = json.markets || [];
      setData(markets);
      setError(null);

      // Cache the data
      setCache<MarketOverviewRow[]>(cacheKey, markets);
      hasMountedRef.current = true;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Load cached data for new params after mount (safe for SSR hydration)
    const cached = getFromCacheOrStorage<MarketOverviewRow[]>(cacheKey);
    if (cached) {
      setData(cached);
      // Only skip loading if cache is fresh
      if (!isDataStale(cacheKey)) setIsLoading(false);
    }

    fetchOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchOverview, refreshInterval);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, refreshInterval, limit, serializedStatus, category, search]);

  // Debounced state updates for realtime data
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, any>>({});
  
  // Apply pending updates after debounce
  useEffect(() => {
    if (Object.keys(pendingUpdates).length === 0) return;
    
    const timeoutId = setTimeout(() => {
      setData(prev => prev.map(d => {
        const update = pendingUpdates[d.market_id];
        if (!update) return d;
        return {
          ...d,
          mark_price: update.mark_price ?? d.mark_price,
          last_update: update.last_update ?? d.last_update,
          is_stale: update.is_stale ?? d.is_stale,
        };
      }));
      setPendingUpdates({});
    }, realtimeDebounce);
    
    return () => clearTimeout(timeoutId);
  }, [pendingUpdates, realtimeDebounce]);

  // Realtime updates on market_tickers with debouncing
  useEffect(() => {
    if (!realtime) return;
    
    const channel = supabase
      .channel('market_tickers_overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'market_tickers' }, (payload: any) => {
        const row = payload.new || payload.old;
        if (!row?.market_id) return;
        
        setPendingUpdates(prev => ({
          ...prev,
          [row.market_id]: {
            mark_price: payload.new?.mark_price,
            last_update: payload.new?.last_update,
            is_stale: payload.new?.is_stale,
          }
        }));
      })
      .subscribe();

    return () => {
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [realtime]);

  return { data, isLoading, error, refetch: fetchOverview };
}


