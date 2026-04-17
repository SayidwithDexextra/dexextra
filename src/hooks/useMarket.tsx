'use client';

import { useState, useEffect } from 'react';
import supabase from '@/lib/supabase-browser';
import { Market } from './useMarkets';

// Explicit columns to fetch - avoids select('*') which pulls unnecessary data
const MARKET_COLUMNS = `
  id, market_identifier, symbol, name, description, category,
  decimals, minimum_order_size, tick_size,
  settlement_date, trading_end_date,
  market_address, market_id_bytes32,
  total_volume, total_trades, open_interest_long, open_interest_short, last_trade_price,
  settlement_value, settlement_timestamp,
  proposed_settlement_value, proposed_settlement_at, proposed_settlement_by,
  alternative_settlement_value, alternative_settlement_at, alternative_settlement_by,
  settlement_disputed, market_status, creator_wallet_address,
  banner_image_url, icon_image_url,
  created_at, deployed_at, chain_id, network,
  initial_order, market_config, ai_source_locator
`.replace(/\s+/g, ' ').trim();

// Minimal columns for view compatibility lookup
const VIEW_COLUMNS = 'metric_id';

// Return type for the hook
interface UseMarketResult {
  market: Market | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch a single market by market_identifier
 * 
 * @param marketIdentifier The market_identifier (formerly metric_id) to fetch
 * @returns Market data, loading state, error state, and refetch function
 */
export function useMarket(marketIdentifier?: string): UseMarketResult {
  const [market, setMarket] = useState<Market | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchMarket = async () => {
    if (!marketIdentifier) {
      setMarket(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // First try to find by market_identifier
      const { data, error: fetchError } = await supabase
        .from('markets')
        .select(MARKET_COLUMNS)
        .eq('market_identifier', marketIdentifier)
        .maybeSingle();

      if (fetchError) {
        throw new Error(`Error fetching market: ${fetchError.message}`);
      }

      if (data) {
        setMarket(data);
      } else {
        // If not found by market_identifier, try by symbol (case insensitive)
        const { data: symbolData, error: symbolError } = await supabase
          .from('markets')
          .select(MARKET_COLUMNS)
          .ilike('symbol', marketIdentifier)
          .maybeSingle();

        if (symbolError) {
          throw new Error(`Error fetching market by symbol: ${symbolError.message}`);
        }

        if (symbolData) {
          setMarket(symbolData);
        } else {
          // For backward compatibility, check if this is a metric_id in the old format
          // Try to find in the compatibility view (only need metric_id)
          const { data: viewData } = await supabase
            .from('orderbook_markets_view')
            .select(VIEW_COLUMNS)
            .eq('metric_id', marketIdentifier)
            .maybeSingle();

          if (viewData) {
            // Convert to new format
            const { data: marketData } = await supabase
              .from('markets')
              .select(MARKET_COLUMNS)
              .eq('market_identifier', viewData.metric_id)
              .maybeSingle();

            if (marketData) {
              setMarket(marketData);
            } else {
              setMarket(null);
              setError(new Error(`Market not found: ${marketIdentifier}`));
            }
          } else {
            setMarket(null);
            setError(new Error(`Market not found: ${marketIdentifier}`));
          }
        }
      }
    } catch (err) {
      console.error('Error in useMarket:', err);
      setError(err instanceof Error ? err : new Error('Unknown error fetching market'));
      setMarket(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMarket();
  }, [marketIdentifier]);

  return { market, isLoading, error, refetch: fetchMarket };
}

export default useMarket;

