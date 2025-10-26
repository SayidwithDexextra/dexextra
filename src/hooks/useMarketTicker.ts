'use client';

import { useEffect, useState } from 'react';

export interface MarketTicker {
  market_id: string;
  mark_price: number;
  last_update: string;
  is_stale: boolean;
}

export function useMarketTicker({ marketId, identifier, refreshInterval = 5000 }: {
  marketId?: string;
  identifier?: string;
  refreshInterval?: number;
}) {
  const [data, setData] = useState<MarketTicker | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchTicker() {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (marketId) params.set('market_id', marketId);
      if (identifier) params.set('identifier', identifier);
      const res = await fetch(`/api/market-ticker?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load ticker');
      setData(json.ticker || null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchTicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId, identifier]);

  useEffect(() => {
    const id = setInterval(fetchTicker, refreshInterval);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId, identifier, refreshInterval]);

  return { data, isLoading, error, refetch: fetchTicker };
}


