'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { TokenData } from '@/types/token';
import { VAMMMarket } from './useVAMMMarkets';
// Remove unused imports: createPublicClient, http, formatEther, polygon

interface UseVAMMTokenDataReturn {
  tokenData: TokenData | null;
  vammMarket: VAMMMarket | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  // Remove contractData since price data should come from useUnifiedMarkPrice
}

// Global cache to prevent duplicate API calls
const tokenDataCache = new Map<string, {
  data: { tokenData: TokenData; vammMarket: VAMMMarket };
  timestamp: number;
  promise?: Promise<any>;
}>();

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

// Remove UNIFIED_VAMM_ABI since we're not fetching contract data anymore

export function useVAMMTokenData(symbol: string): UseVAMMTokenDataReturn {
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [vammMarket, setVammMarket] = useState<VAMMMarket | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Remove contractData state since we're not fetching price data anymore
  const isMountedRef = useRef(true);
  // Remove publicClientRef since we're not making contract calls

  // Remove the initializeClient function since we're not making contract calls

  // Remove the fetchContractData function since we're not fetching price data anymore
  // Price data should come from useUnifiedMarkPrice hook

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
      // Remove contractData setting
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
          // Remove contractData setting
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

        if (!data.markets || data.markets.length === 0) {
          throw new Error(`No VAMM market found for symbol: ${symbol}`);
        }

        const vammMarket = data.markets[0];
        console.log('📊 VAMM market data received:', vammMarket);

        // Transform VAMM market data to token data format
        const tokenData = transformVAMMToTokenData(vammMarket);
        
        // Cache the result
        const result = { tokenData, vammMarket };
        tokenDataCache.set(cacheKey, {
          data: result,
          // Remove contractData from cache
          timestamp: Date.now()
        });

        return result;
      })();

      // Store the promise in cache
      tokenDataCache.set(cacheKey, {
        data: { tokenData: null, vammMarket: null },
        timestamp: Date.now(),
        promise: fetchPromise
      });

      const result = await fetchPromise;

      if (isMountedRef.current) {
        setTokenData(result.tokenData);
        setVammMarket(result.vammMarket);
        // Remove contractData setting
        setIsLoading(false);
        setError(null);
      }

    } catch (err) {
      console.error('❌ Error fetching VAMM token data:', err);
      
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch VAMM token data');
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
  }, [symbol]);

  return {
    tokenData,
    vammMarket,
    isLoading,
    error,
    refetch: fetchVAMMTokenData,
    // Remove contractData from return
  };
}

function transformVAMMToTokenData(vammMarket: VAMMMarket): TokenData {
  // Use real-time contract price if available, otherwise use initial price
  const currentPrice = vammMarket.initial_price;
  
  // Calculate price change based on contract vs initial price
  const priceChange24h = vammMarket.initial_price > 0 
    ? ((currentPrice - vammMarket.initial_price) / vammMarket.initial_price) * 100
    : generateRealisticPriceChange();

  // Use contract volume if available, otherwise estimate
  const volume24h = vammMarket.initial_price * 100000; // Estimated volume
    
  const marketCap = currentPrice * 1000000; // Assume 1M token supply for calculation
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
    chain: 'POLYGON', // VAMM contracts are deployed on Polygon
    logo: vammMarket.icon_image_url || vammMarket.banner_image_url,
    description: vammMarket.description || `${vammMarket.symbol} futures trading market on Polygon network`,
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
  
  // Scale to reasonable range for crypto/futures (-20% to +20%, with most values near 0)
  return Math.max(-20, Math.min(20, z0 * 5));
} 