'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient as getClient, getSupabaseClient } from '@/lib/supabase-browser';

export interface SeriesRoutingInfo {
  seriesId: string;
  seriesSlug: string;
  primaryMarketId: string | null;
}

export interface ActivePairInfo {
  seriesId: string;
  seriesSlug: string;
  fromMarketId: string;
  toMarketId: string;
}

export interface SeriesMarket {
  marketId: string;
  symbol: string;
  description: string | null;
  iconImageUrl: string | null;
  sequence: number;
  isPrimary: boolean;
}

export function useActivePairByMarketId(marketId?: string | null) {
  const [pair, setPair] = useState<ActivePairInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      if (!marketId) {
        setPair(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const supabase = getClient();
        // Look for an active pair where this market is either from or to
        const { data: fromRows, error: errFrom } = await supabase
          .from('v_active_rollover_pairs')
          .select('series_id, series_slug, from_market_id, to_market_id')
          .eq('from_market_id', marketId)
          .limit(1);
        if (errFrom) throw errFrom;
        if (fromRows && fromRows.length > 0) {
          const row = fromRows[0] as any;
          setPair({
            seriesId: row.series_id,
            seriesSlug: row.series_slug,
            fromMarketId: row.from_market_id,
            toMarketId: row.to_market_id
          });
          setLoading(false);
          return;
        }
        const { data: toRows, error: errTo } = await supabase
          .from('v_active_rollover_pairs')
          .select('series_id, series_slug, from_market_id, to_market_id')
          .eq('to_market_id', marketId)
          .limit(1);
        if (errTo) throw errTo;
        if (toRows && toRows.length > 0) {
          const row = toRows[0] as any;
          setPair({
            seriesId: row.series_id,
            seriesSlug: row.series_slug,
            fromMarketId: row.from_market_id,
            toMarketId: row.to_market_id
          });
        } else {
          setPair(null);
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load active pair');
        setPair(null);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [marketId]);

  return { pair, loading, error };
}

export async function fetchSeriesMarkets(seriesId: string): Promise<SeriesMarket[]> {
  const supabase = getSupabaseClient();
  // Join series_markets with markets to obtain symbols and descriptions
  const { data, error } = await supabase
    .from('series_markets')
    .select('sequence, is_primary, market_id, markets!inner(id, symbol, description, icon_image_url)')
    .eq('series_id', seriesId)
    .order('sequence', { ascending: true });
  if (error) throw error;
  const rows = (data || []) as any[];
  return rows.map((r) => ({
    marketId: r.market_id,
    symbol: r.markets?.symbol || '',
    description: r.markets?.description || null,
    iconImageUrl: r.markets?.icon_image_url || null,
    sequence: r.sequence,
    isPrimary: !!r.is_primary
  }));
}

export function useSeriesMarkets(seriesId?: string | null) {
  const [markets, setMarkets] = useState<SeriesMarket[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      if (!seriesId) {
        setMarkets(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await fetchSeriesMarkets(seriesId);
        setMarkets(data);
      } catch (e: any) {
        setError(e?.message || 'Failed to load series markets');
        setMarkets(null);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [seriesId]);

  return { markets, loading, error };
}


