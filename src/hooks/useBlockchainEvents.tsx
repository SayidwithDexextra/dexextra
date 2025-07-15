'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { SmartContractEvent } from '@/types/events';
import { BlockchainEventQuerier, BlockchainEventFilter, QueryResult, getDefaultBlockchainQuerier } from '@/lib/blockchainEventQuerier';

export interface UseBlockchainEventsOptions extends Partial<BlockchainEventFilter> {
  enabled?: boolean;
  refetchInterval?: number;
  cacheTime?: number;
  staleTime?: number;
  retry?: number;
  retryDelay?: number;
  onSuccess?: (data: QueryResult) => void;
  onError?: (error: string) => void;
}

export interface UseBlockchainEventsResult {
  events: SmartContractEvent[];
  queryResult: QueryResult | null;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => Promise<void>;
  reset: () => void;
}

// Simple cache implementation
interface CacheEntry {
  data: QueryResult;
  timestamp: number;
  key: string;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_CACHE_TIME = 5 * 60 * 1000; // 5 minutes
const DEFAULT_STALE_TIME = 30 * 1000; // 30 seconds

export function useBlockchainEvents(
  contractAddress: string,
  options: UseBlockchainEventsOptions = {}
): UseBlockchainEventsResult {
  const {
    enabled = true,
    refetchInterval,
    cacheTime = DEFAULT_CACHE_TIME,
    staleTime = DEFAULT_STALE_TIME,
    retry = 3,
    retryDelay = 2000,
    onSuccess,
    onError,
    ...filterOptions
  } = options;

  // Memoize filterOptions to prevent unnecessary re-renders
  const memoizedFilterOptions = useMemo(() => filterOptions, [
    filterOptions.eventTypes?.join(','),
    filterOptions.fromBlock,
    filterOptions.toBlock,
    filterOptions.limit,
    filterOptions.maxBlockRange
  ]);

  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const querier = useRef<BlockchainEventQuerier>(getDefaultBlockchainQuerier());
  const refetchIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  // Create cache key based on filter options
  const cacheKey = useMemo(() => {
    const key = JSON.stringify({
      contractAddress: contractAddress?.toLowerCase(),
      ...memoizedFilterOptions
    });
    return `blockchain-events-${key}`;
  }, [contractAddress, memoizedFilterOptions]);

  // Cache functions - these should be stable now
  const getCachedData = useCallback((): QueryResult | null => {
    const cached = cache.get(cacheKey);
    
    if (!cached) return null;
    
    const now = Date.now();
    const isExpired = now - cached.timestamp > cacheTime;
    
    if (isExpired) {
      cache.delete(cacheKey);
      return null;
    }
    
    return cached.data;
  }, [cacheKey, cacheTime]);

  const isCachedDataStale = useCallback((): boolean => {
    const cached = cache.get(cacheKey);
    
    if (!cached) return true;
    
    const now = Date.now();
    return now - cached.timestamp > staleTime;
  }, [cacheKey, staleTime]);

  const setCachedData = useCallback((data: QueryResult) => {
    cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
      key: cacheKey
    });
  }, [cacheKey]);

  // Fetch events function with retry logic
  const fetchEventsWithRetry = useCallback(async (showLoading = true, attempt = 0) => {
    try {
      if (!contractAddress || !enabled) {
        // Clear loading states if disabled
        setIsLoading(false);
        setIsFetching(false);
        return;
      }

      // Check cache first (only on first attempt)
      if (attempt === 0) {
        const cachedData = getCachedData();
        if (cachedData && !isCachedDataStale()) {
          setQueryResult(cachedData);
          setError(null);
          // Clear loading states when using cached data
          setIsLoading(false);
          setIsFetching(false);
          return;
        }
      }

      if (showLoading && attempt === 0) {
        setIsLoading(true);
      }
      setIsFetching(true);
      setError(null);

      console.log('🔍 Fetching blockchain events for:', contractAddress, attempt > 0 ? `(attempt ${attempt + 1})` : '');
      
      const result = await querier.current.queryVAMMEvents({
        contractAddress,
        eventTypes: ['PositionOpened', 'PositionClosed', 'PositionLiquidated'], // Focus on position events
        ...memoizedFilterOptions
      });

      if (!mountedRef.current) return;

      if (result.error) {
        throw new Error(result.error);
      }

      setQueryResult(result);
      setCachedData(result);
      setRetryCount(0);
      
      if (onSuccess) {
        onSuccess(result);
      }

      console.log('✅ Successfully fetched', result.events.length, 'events');
      
      // Success - ALWAYS clear loading states (force clear)
      setIsLoading(false);
      setIsFetching(false);
    } catch (err) {
      try {
        if (!mountedRef.current) return;

        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('❌ Failed to fetch blockchain events:', errorMessage);
        
        // Retry logic
        if (attempt < retry) {
          console.log(`🔄 Retrying in ${retryDelay}ms (attempt ${attempt + 1}/${retry})`);
          setTimeout(() => {
            if (mountedRef.current) {
              setRetryCount(attempt + 1);
              fetchEventsWithRetry(false, attempt + 1);
            }
          }, retryDelay * (attempt + 1));
          return; // Don't set loading to false yet, we're retrying
        } else {
          // Final failure - set error and clear loading states
          setError(errorMessage);
          if (onError) {
            onError(errorMessage);
          }
          if (mountedRef.current) {
            setIsLoading(false);
            setIsFetching(false);
          }
        }
      } catch (nestedErr) {
        // Fallback error handling
        console.error('Critical error in fetchEventsWithRetry:', nestedErr);
        setIsLoading(false);
        setIsFetching(false);
        setError('Critical error occurred');
      }
    }
  }, [
    contractAddress,
    enabled,
    memoizedFilterOptions,
    retry,
    retryDelay,
    onSuccess,
    onError,
    getCachedData,
    isCachedDataStale,
    setCachedData
  ]);

  // Wrapper function for easier calling
  const fetchEvents = useCallback(async (showLoading = true) => {
    await fetchEventsWithRetry(showLoading, 0);
  }, [fetchEventsWithRetry]);

  // Refetch function
  const refetch = useCallback(async () => {
    // Clear cache and retry count
    cache.delete(cacheKey);
    setRetryCount(0);
    
    await fetchEvents(true);
  }, [fetchEvents, cacheKey]);

  // Reset function
  const reset = useCallback(() => {
    setQueryResult(null);
    setError(null);
    setIsLoading(false);
    setIsFetching(false);
    setRetryCount(0);
    
    // Clear cache
    cache.delete(cacheKey);
  }, [cacheKey]);

  // Initial fetch - use ref to prevent infinite loops
  const initialFetchDone = useRef(false);
  useEffect(() => {
    if (!initialFetchDone.current && contractAddress && enabled) {
      initialFetchDone.current = true;
      fetchEvents(true);
    }
  }, [contractAddress, enabled]); // Removed fetchEvents from deps

  // Reset initial fetch flag when contract address changes
  useEffect(() => {
    initialFetchDone.current = false;
  }, [contractAddress]);

  // Set up refetch interval - create a completely independent interval function
  useEffect(() => {
    if (refetchInterval && refetchInterval > 0 && contractAddress && enabled) {
      // Enforce minimum interval of 15 seconds to prevent rate limiting
      const safeInterval = Math.max(refetchInterval, 15000);
      
      if (safeInterval !== refetchInterval) {
        console.warn(`Refetch interval increased from ${refetchInterval}ms to ${safeInterval}ms to prevent rate limiting`);
      }
      
      const intervalFunction = async () => {
        // Create a minimal fetch function that doesn't rely on complex dependencies
        try {
          if (!contractAddress || !enabled) return;
          
          // Simple background fetch without loading states
          const querier = getDefaultBlockchainQuerier();
          const result = await querier.queryVAMMEvents({
            contractAddress,
            eventTypes: ['PositionOpened', 'PositionClosed', 'PositionLiquidated'],
            ...memoizedFilterOptions
          });

          if (result && !result.error && result.events) {
            setQueryResult(result);
            // Update cache directly
            const key = `blockchain-events-${JSON.stringify({
              contractAddress: contractAddress?.toLowerCase(),
              ...memoizedFilterOptions
            })}`;
            cache.set(key, {
              data: result,
              timestamp: Date.now(),
              key
            });
            setError(null);
          }
        } catch (error) {
          console.error('Background fetch error:', error);
          // Don't set error state for background fetches
        }
      };

      refetchIntervalRef.current = setInterval(intervalFunction, safeInterval);

      return () => {
        if (refetchIntervalRef.current) {
          clearInterval(refetchIntervalRef.current);
        }
      };
    }
  }, [refetchInterval, contractAddress, enabled, memoizedFilterOptions]);

  // Force clear loading states when we have results
  useEffect(() => {
    if (queryResult && queryResult.events) {
      setIsLoading(false);
      setIsFetching(false);
    }
  }, [queryResult]);

  // Cleanup
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (refetchIntervalRef.current) {
        clearInterval(refetchIntervalRef.current);
      }
    };
  }, []);

  return {
    events: queryResult?.events || [],
    queryResult,
    isLoading,
    isFetching,
    error,
    isError: !!error,
    isSuccess: !!queryResult && !error,
    refetch,
    reset
  };
}

// Alternative hook for multiple contracts
export function useMultipleBlockchainEvents(
  contractAddresses: string[],
  options: UseBlockchainEventsOptions = {}
): UseBlockchainEventsResult {
  const [combinedResult, setCombinedResult] = useState<QueryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAllEvents = useCallback(async () => {
    if (contractAddresses.length === 0) return;

    setIsLoading(true);
    setError(null);

    try {
      const querier = getDefaultBlockchainQuerier();
      const results = await Promise.all(
        contractAddresses.map(address => 
          querier.queryVAMMEvents({
            contractAddress: address,
            eventTypes: ['PositionOpened', 'PositionClosed', 'PositionLiquidated'],
            ...options
          })
        )
      );

      // Combine all events
      const allEvents = results.flatMap(result => result.events);
      
      // Sort by block number and log index (most recent first)
      allEvents.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return b.blockNumber - a.blockNumber;
        }
        return b.logIndex - a.logIndex;
      });

      // Apply limit if specified
      const limitedEvents = options.limit ? allEvents.slice(0, options.limit) : allEvents;

      const combinedQueryResult: QueryResult = {
        events: limitedEvents,
        fromBlock: Math.min(...results.map(r => r.fromBlock)),
        toBlock: Math.max(...results.map(r => r.toBlock)),
        totalLogs: results.reduce((sum, r) => sum + r.totalLogs, 0),
        queryTime: Math.max(...results.map(r => r.queryTime))
      };

      setCombinedResult(combinedQueryResult);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [contractAddresses, options]);

  useEffect(() => {
    fetchAllEvents();
  }, [fetchAllEvents]);

  return {
    events: combinedResult?.events || [],
    queryResult: combinedResult,
    isLoading,
    isFetching: isLoading,
    error,
    isError: !!error,
    isSuccess: !!combinedResult && !error,
    refetch: fetchAllEvents,
    reset: () => {
      setCombinedResult(null);
      setError(null);
    }
  };
}

// Hook specifically for transaction table
export function useTransactionTableEvents(
  vammAddress?: string,
  options: UseBlockchainEventsOptions = {}
): UseBlockchainEventsResult {
  return useBlockchainEvents(vammAddress || '', {
    eventTypes: ['PositionOpened', 'PositionClosed', 'PositionLiquidated'],
    limit: 100, // Fetch more events to have a good pool for filtering
    enabled: !!vammAddress,
    refetchInterval: 30000, // Refetch every 30 seconds
    ...options
  });
}

// Utility hook for connection testing
export function useBlockchainConnection() {
  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    chainId: number;
    blockNumber: number;
    networkName: string;
    responseTime: number;
    error?: string;
  } | null>(null);

  const [isChecking, setIsChecking] = useState(false);

  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    
    try {
      const querier = getDefaultBlockchainQuerier();
      const result = await querier.testConnection();
      setConnectionStatus(result);
    } catch (error) {
      setConnectionStatus({
        connected: false,
        chainId: 0,
        blockNumber: 0,
        networkName: 'Unknown',
        responseTime: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  return {
    connectionStatus,
    isChecking,
    checkConnection
  };
} 