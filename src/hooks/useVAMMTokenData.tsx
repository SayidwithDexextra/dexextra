'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TokenData } from '@/types/token';
import { VAMMMarket } from './useVAMMMarkets';

interface UseVAMMTokenDataReturn {
  tokenData: TokenData | null;
  vammMarket: VAMMMarket | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Global cache to prevent duplicate API calls
const tokenDataCache = new Map<string, {
  data: { tokenData: TokenData; vammMarket: VAMMMarket };
  timestamp: number;
  promise?: Promise<any>;
}>();

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

export function useVAMMTokenData(symbol: string): UseVAMMTokenDataReturn {
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [vammMarket, setVammMarket] = useState<VAMMMarket | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchVAMMTokenData = useCallback(async () => {
    if (!symbol) {
      setError('No symbol provided');
      setIsLoading(false);
      return;
    }

    const cacheKey = symbol.toLowerCase();
    const cached = tokenDataCache.get(cacheKey);
    
    // Check if we have valid cached data
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      console.log('🎯 Using cached VAMM data for symbol:', symbol);
      setTokenData(cached.data.tokenData);
      setVammMarket(cached.data.vammMarket);
      setIsLoading(false);
      setError(null);
      return;
    }

    // If there's already a pending request for this symbol, wait for it
    if (cached?.promise) {
      console.log('⏳ Waiting for existing request for symbol:', symbol);
      try {
        await cached.promise;
        const updatedCache = tokenDataCache.get(cacheKey);
        if (updatedCache && isMountedRef.current) {
          setTokenData(updatedCache.data.tokenData);
          setVammMarket(updatedCache.data.vammMarket);
          setIsLoading(false);
          setError(null);
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to fetch VAMM token data');
          setIsLoading(false);
        }
      }
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      console.log('🔍 Fetching fresh VAMM market data for symbol:', symbol);

      // Create a promise for this request and cache it
      const fetchPromise = (async () => {
        const response = await fetch(`/api/markets?limit=1&symbol=${encodeURIComponent(symbol)}`, {
          headers: {
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch VAMM market: ${response.status}`);
        }

        const data = await response.json();
        console.log('📦 VAMM API response:', data);

        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch VAMM market');
        }

        const markets = data.markets || [];
        const market = markets.find((m: VAMMMarket) => 
          m.symbol.toLowerCase() === symbol.toLowerCase()
        );

        if (!market) {
          throw new Error(`VAMM market not found for symbol: ${symbol}`);
        }

        console.log('🎯 Found VAMM market:', market);

        // Transform VAMM market data to TokenData format
        const transformedTokenData = transformVAMMToTokenData(market);

        // Cache the result
        tokenDataCache.set(cacheKey, {
          data: { tokenData: transformedTokenData, vammMarket: market },
          timestamp: Date.now(),
        });

        return { tokenData: transformedTokenData, vammMarket: market };
      })();

      // Cache the promise to prevent duplicate requests
      tokenDataCache.set(cacheKey, {
        data: tokenDataCache.get(cacheKey)?.data || { tokenData: null as any, vammMarket: null as any },
        timestamp: tokenDataCache.get(cacheKey)?.timestamp || 0,
        promise: fetchPromise,
      });

      const result = await fetchPromise;
      
      if (isMountedRef.current) {
        setTokenData(result.tokenData);
        setVammMarket(result.vammMarket);
      }

    } catch (err) {
      console.error('❌ Error fetching VAMM token data:', err);
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch VAMM token data');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [symbol]);

  // Refetch function for manual refresh
  const refetch = useCallback(async () => {
    // Clear cache for this symbol
    const cacheKey = symbol.toLowerCase();
    tokenDataCache.delete(cacheKey);
    await fetchVAMMTokenData();
  }, [symbol, fetchVAMMTokenData]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchVAMMTokenData();
    
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchVAMMTokenData]);

  return { tokenData, vammMarket, isLoading, error, refetch };
}

function transformVAMMToTokenData(vammMarket: VAMMMarket): TokenData {
  // Calculate some derived values for the trading interface
  const currentPrice = vammMarket.initial_price;
  
  // Generate realistic trading data based on the market
  const priceChange24h = generateRealisticPriceChange();
  const marketCap = currentPrice * 1000000; // Assume 1M token supply for calculation
  const volume24h = marketCap * 0.1; // 10% of market cap as daily volume
  const marketCapChange24h = priceChange24h + (Math.random() - 0.5) * 5; // Slightly different from price change

  return {
    symbol: vammMarket.symbol,
    name: `${vammMarket.symbol} Futures`,
    price: currentPrice,
    priceChange24h,
    marketCap,
    marketCapChange24h,
    volume24h,
    fullyDilutedValuation: marketCap,
    chain: 'BASE', // VAMM contracts are deployed on Base
    logo: vammMarket.icon_image_url || vammMarket.banner_image_url,
    description: vammMarket.description || `${vammMarket.symbol} futures trading market on Base network`,
    website: undefined, // Could add if available in market data
    twitter: undefined,
    telegram: undefined,
    circulating_supply: 1000000, // Mock supply for display
    total_supply: 1000000,
    max_supply: 1000000,
    created_at: vammMarket.created_at,
    updated_at: vammMarket.created_at,
  };
}

function generateRealisticPriceChange(): number {
  // Generate a realistic price change percentage (-20% to +20%)
  // Using a normal distribution approximation for more realistic values
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  
  // Scale to a reasonable range for crypto price changes
  return Math.max(-20, Math.min(20, z0 * 5));
} 