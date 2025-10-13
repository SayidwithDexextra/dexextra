'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './CryptoMarketTicker.module.css';
import { usePusher } from '@/lib/pusher-client';
import { TokenTickerEvent } from '@/lib/pusher-server';
import { fetchTokenPrices } from '@/lib/tokenService';
import { createTokenPriceUpdater } from '@/lib/tokenService';

interface TokenPriceData {
  symbol: string;
  price: number;
  price_change_percentage_24h: number;
}

interface CryptoMarketTickerProps {
  className?: string;
  speed?: number;
  pauseOnHover?: boolean;
}

// Default tokens to display
const DEFAULT_TOKENS = [
  'BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'USDC', 'ADA', 'AVAX', 'DOGE', 'TRX',
  'LINK', 'DOT', 'MATIC', 'UNI', 'LTC', 'BCH', 'NEAR', 'ATOM', 'FTM', 'ALGO', 'GOLD'
];

// Fallback prices in case of API failure
const FALLBACK_PRICES: Record<string, TokenPriceData> = {
  'BTC': { symbol: 'BTC', price: 43500, price_change_percentage_24h: 1.2 },
  'ETH': { symbol: 'ETH', price: 2650, price_change_percentage_24h: -0.8 },
  'XRP': { symbol: 'XRP', price: 0.52, price_change_percentage_24h: 2.1 },
  'BNB': { symbol: 'BNB', price: 315, price_change_percentage_24h: 0.5 },
  'SOL': { symbol: 'SOL', price: 65, price_change_percentage_24h: 3.2 },
  'USDC': { symbol: 'USDC', price: 1.00, price_change_percentage_24h: 0.0 },
  'ADA': { symbol: 'ADA', price: 0.48, price_change_percentage_24h: 1.8 },
  'AVAX': { symbol: 'AVAX', price: 28, price_change_percentage_24h: -1.5 },
  'DOGE': { symbol: 'DOGE', price: 0.085, price_change_percentage_24h: 4.2 },
  'TRX': { symbol: 'TRX', price: 0.11, price_change_percentage_24h: 0.9 }
};

// Cache configuration
const CACHE_KEY = 'crypto_ticker_prices';
const CACHE_TIMESTAMP_KEY = 'crypto_ticker_timestamp';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export default function CryptoMarketTicker({ 
  className = '', 
  speed = 60,
  pauseOnHover = true 
}: CryptoMarketTickerProps) {
  // Pusher integration
  const pusher = usePusher({ enableLogging: false });
  
  // State management
  const [tokenPrices, setTokenPrices] = useState<Record<string, TokenPriceData>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [dataSource, setDataSource] = useState<'live' | 'cached' | 'fallback' | 'pusher'>('live');
  const [retryCount, setRetryCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  
  // Refs
  const tickerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Format price with appropriate decimals
  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return price.toLocaleString('en-US', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
      });
    } else if (price >= 1) {
      return price.toFixed(4);
    } else if (price >= 0.0001) {
      return price.toFixed(6);
    } else {
      return price.toExponential(2);
    }
  };

  // Format percentage change
  const formatPercentage = (change: number): string => {
    const formatted = Math.abs(change).toFixed(2);
    return change >= 0 ? `+${formatted}%` : `-${formatted}%`;
  };

  // Get color class for percentage change
  const getChangeColorClass = (change: number): string => {
    return change >= 0 ? styles.positive : styles.negative;
  };

  // Save data to localStorage cache
  const saveToCache = useCallback((data: Record<string, TokenPriceData>) => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (error) {
      console.warn('Failed to save to cache:', error);
    }
  }, []);

  // Load data from localStorage cache
  const loadFromCache = useCallback((): Record<string, TokenPriceData> | null => {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
      
      if (cached && timestamp) {
        const age = Date.now() - parseInt(timestamp);
        if (age < CACHE_DURATION) {
          return JSON.parse(cached);
        }
      }
    } catch (error) {
      console.warn('Failed to load from cache:', error);
    }
    return null;
  }, []);

  // Handle Pusher ticker updates
  const handleTickerUpdate = useCallback((data: TokenTickerEvent) => {
    if (!isMountedRef.current) return;

     console.log(`📊 Ticker update via Pusher: ${data.symbol} = $${data.price}`);

    const tokenData: TokenPriceData = {
      symbol: data.symbol,
      price: data.price,
      price_change_percentage_24h: data.priceChange24h,
    };

    setTokenPrices(prev => {
      const newPrices = { ...prev, [data.symbol]: tokenData };
      saveToCache(newPrices);
      return newPrices;
    });

    setDataSource('pusher');
    setRetryCount(0);
  }, [saveToCache]);

  // Handle Pusher connection state changes
  const handleConnectionStateChange = useCallback((state: string) => {
    const connected = state === 'connected';
    setIsConnected(connected);

    if (!connected) {
       console.log('🔴 Pusher disconnected, falling back to polling');
      // Don't immediately fall back, give Pusher a chance to reconnect
      setTimeout(() => {
        if (!connected && isMountedRef.current) {
          startFallbackPolling();
        }
      }, 5000);
    } else {
       console.log('🟢 Pusher connected, stopping fallback polling');
      stopFallbackPolling();
    }
  }, []);

  // Fallback polling for when Pusher is not available
  const startFallbackPolling = useCallback(() => {
    if (cleanupRef.current) return; // Already polling

     console.log('🔄 Starting fallback polling for token prices');

    const cleanup = createTokenPriceUpdater((updatedPrices) => {
      if (!isMountedRef.current) return;

      if (Object.keys(updatedPrices).length > 0) {
        setTokenPrices(prev => {
          const newPrices = { ...prev, ...updatedPrices };
          saveToCache(newPrices);
          return newPrices;
        });
        setDataSource('live');
        setRetryCount(0);
      }
    }, DEFAULT_TOKENS);

    cleanupRef.current = cleanup;
  }, [saveToCache]);

  const stopFallbackPolling = useCallback(() => {
    if (cleanupRef.current) {
       console.log('🛑 Stopping fallback polling');
      cleanupRef.current();
      cleanupRef.current = null;
    }
  }, []);

  // Initial data loading
  const loadInitialData = useCallback(async () => {
    if (!isMountedRef.current) return;

    try {
      setIsLoading(true);

      // Try cached data first
      const cached = loadFromCache();
      if (cached && Object.keys(cached).length > 0) {
         console.log('📱 Using cached token prices');
        setTokenPrices(cached);
        setDataSource('cached');
        setIsLoading(false);
      }

      // Fetch fresh data
       console.log('🔍 Fetching fresh token prices');
      const prices = await fetchTokenPrices(DEFAULT_TOKENS);

      if (Object.keys(prices).length > 0) {
         console.log('✅ Successfully loaded fresh price data');
        setTokenPrices(prices);
        setDataSource('live');
        saveToCache(prices);
      } else if (!cached) {
        // No cached data and no fresh data - use fallback
         console.log('⚠️ No price data available, using fallback');
        setTokenPrices(FALLBACK_PRICES);
        setDataSource('fallback');
      }

      setIsLoading(false);
    } catch (error) {
      console.error('❌ Error loading initial token data:', error);
      
      // Try cached data
      const cached = loadFromCache();
      if (cached && Object.keys(cached).length > 0) {
        setTokenPrices(cached);
        setDataSource('cached');
      } else {
        setTokenPrices(FALLBACK_PRICES);
        setDataSource('fallback');
      }
      setIsLoading(false);
    }
  }, [loadFromCache, saveToCache]);

  // Set up Pusher subscription
  useEffect(() => {
    if (!pusher) return;

     console.log('🚀 Setting up Pusher ticker subscription');

    // Subscribe to token ticker updates
    const unsubscribeTicker = pusher.subscribeToTokenTicker(handleTickerUpdate);
    const unsubscribeConnection = pusher.onConnectionStateChange(handleConnectionStateChange);

    unsubscribeRef.current = () => {
      unsubscribeTicker();
      unsubscribeConnection();
    };

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [pusher, handleTickerUpdate, handleConnectionStateChange]);

  // Initialize data loading and fallback logic
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Load initial data
    loadInitialData();

    // Start fallback polling after a delay if Pusher doesn't connect
    const fallbackTimer = setTimeout(() => {
      if (!isConnected && isMountedRef.current) {
         console.log('⏰ Pusher not connected, starting fallback polling');
        startFallbackPolling();
      }
    }, 10000); // Wait 10 seconds for Pusher connection

    return () => {
      clearTimeout(fallbackTimer);
      stopFallbackPolling();
      
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [isConnected, loadInitialData, startFallbackPolling, stopFallbackPolling]);

  // Handle hover events for pause on hover
  const handleMouseEnter = () => {
    if (pauseOnHover) {
      setIsPaused(true);
    }
  };

  const handleMouseLeave = () => {
    if (pauseOnHover) {
      setIsPaused(false);
    }
  };

  // Convert tokenPrices object to array and filter valid entries
  const validTokens = Object.values(tokenPrices).filter(token => 
    token && token.symbol && typeof token.price === 'number' && token.price > 0
  );

  // Show loading state only briefly
  if (isLoading && validTokens.length === 0) {
    return (
      <div className={`${styles.container} ${className}`}>
        <div className={styles.loading}>
          Loading market data...
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.container} ${className}`}>
      <div 
        ref={tickerRef}
        className={`${styles.ticker} ${isPaused ? styles.paused : ''}`}
        style={{ '--ticker-duration': `${speed}s` } as React.CSSProperties}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {validTokens.concat(validTokens).map((token, index) => (
          <div key={`${token.symbol}-${index}`} className={styles.tickerItem}>
            <span className={styles.symbol}>{token.symbol}</span>
            <span className={styles.separator}>•</span>
            <span className={styles.price}>${formatPrice(token.price)}</span>
            <span className={`${styles.change} ${getChangeColorClass(token.price_change_percentage_24h)}`}>
              {formatPercentage(token.price_change_percentage_24h)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
} 