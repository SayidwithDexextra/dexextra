'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Market } from './useMarkets';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
        .select('*')
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
          .select('*')
          .ilike('symbol', marketIdentifier)
          .maybeSingle();

        if (symbolError) {
          throw new Error(`Error fetching market by symbol: ${symbolError.message}`);
        }

        if (symbolData) {
          setMarket(symbolData);
        } else {
          // For backward compatibility, check if this is a metric_id in the old format
          // Try to find in the compatibility view
          const { data: viewData } = await supabase
            .from('orderbook_markets_view')
            .select('*')
            .eq('metric_id', marketIdentifier)
            .maybeSingle();

          if (viewData) {
            // Convert to new format
            const { data: marketData } = await supabase
              .from('markets')
              .select('*')
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

