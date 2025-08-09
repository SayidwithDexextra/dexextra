'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface ETHPriceData {
  price: number;
  changePercent24h: number;
  isLoading: boolean;
  error?: string;
  source?: string;
  lastUpdated?: number;
  isStale?: boolean;
}

interface StoredPriceData {
  price: number;
  changePercent24h: number;
  source: string;
  timestamp: number;
}

// Enhanced fallback data
const FALLBACK_ETH_DATA = {
  price: 2965,
  changePercent24h: 0,
  source: 'Static Fallback',
  timestamp: Date.now(),
};

// Cache constants
const STORAGE_KEY = 'eth-price-cache';
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes
const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
const MAX_RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY = 1000; // 1 second

class LocalStorageCache {
  static save(data: StoredPriceData): void {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
    } catch (error) {
      console.warn('Failed to save ETH price to localStorage:', error);
    }
  }

  static load(): StoredPriceData | null {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const data = JSON.parse(stored);
          // Validate the stored data
          if (data.price && data.timestamp && data.source) {
            return data;
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load ETH price from localStorage:', error);
    }
    return null;
  }

  static isValid(data: StoredPriceData): boolean {
    const age = Date.now() - data.timestamp;
    return age < CACHE_DURATION;
  }

  static isStale(data: StoredPriceData): boolean {
    const age = Date.now() - data.timestamp;
    return age > STALE_THRESHOLD;
  }
}

async function fetchETHPrice(): Promise<StoredPriceData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

  try {
    const response = await fetch('/api/eth-price', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const data = await response.json();
    
    // Handle both success and fallback responses from the API
    if (!data.price || isNaN(data.price)) {
      throw new Error('Invalid price data received from API');
    }
    
    const result: StoredPriceData = {
      price: data.price,
      changePercent24h: data.changePercent24h || 0,
      source: data.source || 'API',
      timestamp: data.timestamp || Date.now(),
    };

    // Save to localStorage for future use
    LocalStorageCache.save(result);
    
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export const useETHPrice = () => {
  const [ethData, setEthData] = useState<ETHPriceData>({
    price: 0,
    changePercent24h: 0,
    isLoading: true,
  });

  const retryCountRef = useRef(0);
  const isActiveRef = useRef(true);

  const updateEthData = useCallback((data: StoredPriceData, isStale = false, error?: string) => {
    if (!isActiveRef.current) return;
    
    setEthData({
      price: data.price,
      changePercent24h: data.changePercent24h,
      source: data.source,
      lastUpdated: data.timestamp,
      isLoading: false,
      isStale,
      error,
    });
  }, []);

  const fetchPrice = useCallback(async (retryCount = 0): Promise<void> => {
    if (!isActiveRef.current) return;

    try {
      // First, try to load from cache if it's the first attempt
      if (retryCount === 0) {
        const cachedData = LocalStorageCache.load();
        if (cachedData) {
          if (LocalStorageCache.isValid(cachedData)) {
            // Cache is still valid, use it and don't fetch
            updateEthData(cachedData);
            return;
          } else if (!LocalStorageCache.isStale(cachedData)) {
            // Cache is expired but not stale, show it while fetching new data
            updateEthData(cachedData, true);
          }
        }
      }

      const result = await fetchETHPrice();
      retryCountRef.current = 0; // Reset retry count on success
      updateEthData(result);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch ETH price';
      
      if (retryCount < MAX_RETRY_ATTEMPTS) {
        // Exponential backoff with jitter
        const baseDelay = BASE_RETRY_DELAY * Math.pow(2, retryCount);
        const jitter = Math.random() * 1000; // Add up to 1 second of jitter
        const delay = baseDelay + jitter;
        
        console.warn(`ETH price fetch attempt ${retryCount + 1} failed, retrying in ${Math.round(delay)}ms:`, errorMessage);
        
        setTimeout(() => {
          if (isActiveRef.current) {
            fetchPrice(retryCount + 1);
          }
        }, delay);
        return;
      }

      // All retries exhausted, try to use stored data or fallback
      console.error('All ETH price fetch attempts failed:', errorMessage);
      
      const cachedData = LocalStorageCache.load();
      if (cachedData) {
        console.warn('Using stale cached ETH price data');
        updateEthData(cachedData, true, `Using cached data: ${errorMessage}`);
      } else {
        console.warn('Using fallback ETH price data');
        updateEthData(FALLBACK_ETH_DATA, true, `Using fallback data: ${errorMessage}`);
      }
    }
  }, [updateEthData]);

  // Manual refresh function
  const refreshPrice = useCallback(() => {
    retryCountRef.current = 0;
    setEthData(prev => ({ ...prev, isLoading: true, error: undefined }));
    fetchPrice(0);
  }, [fetchPrice]);

  useEffect(() => {
    isActiveRef.current = true;
    
    // Initial fetch
    fetchPrice();

    // Set up interval to fetch price every 2 minutes
    const interval = setInterval(() => {
      if (isActiveRef.current) {
        fetchPrice();
      }
    }, 120000);

    return () => {
      isActiveRef.current = false;
      clearInterval(interval);
    };
  }, []);

  return {
    ...ethData,
    refreshPrice,
  };
}; 