'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

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
  const [data, setData] = useState<MarketOverviewRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchOverview() {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      if (status) {
        if (Array.isArray(status)) {
          const combined = status.filter(Boolean).join(',');
          if (combined) params.set('status', combined);
        } else {
          params.set('status', status);
        }
      }
      if (category) params.set('category', category);
      if (search) params.set('search', search);

      const res = await fetch(`/api/market-overview?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load market overview');
      setData(json.markets || []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, status, category, search]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchOverview, refreshInterval);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, refreshInterval, limit, status, category, search]);

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


