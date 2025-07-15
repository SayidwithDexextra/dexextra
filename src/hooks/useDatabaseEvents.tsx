import { useState, useEffect, useCallback, useRef } from 'react';
import { SmartContractEvent } from '@/types/events';

interface UseDatabaseEventsOptions {
  enabled?: boolean;
  refetchInterval?: number;
  eventTypes?: string[];
  userAddress?: string;
  limit?: number;
  onSuccess?: (events: SmartContractEvent[]) => void;
  onError?: (error: string) => void;
}

interface UseDatabaseEventsResult {
  events: SmartContractEvent[];
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => void;
}

export function useDatabaseEvents(
  contractAddress: string,
  options: UseDatabaseEventsOptions = {}
): UseDatabaseEventsResult {
  const {
    enabled = true,
    refetchInterval = 30000,
    eventTypes = ['PositionOpened', 'PositionClosed', 'PositionLiquidated'],
    userAddress,
    limit = 100,
    onSuccess,
    onError
  } = options;

  const [events, setEvents] = useState<SmartContractEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const fetchIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const fetchEvents = useCallback(async (showLoading = true) => {
    if (!contractAddress || !enabled) return;

    try {
      if (showLoading) {
        setIsLoading(true);
      }
      setIsFetching(true);
      setError(null);
      setIsError(false);

      console.log('📦 Fetching events from database for:', contractAddress);

      // Build query parameters
      const params = new URLSearchParams({
        contractAddress: contractAddress.toLowerCase(),
        limit: limit.toString(),
      });

      if (eventTypes.length > 0) {
        params.append('eventTypes', eventTypes.join(','));
      }

      if (userAddress) {
        params.append('userAddress', userAddress.toLowerCase());
      }

      // Fetch from database API
      const response = await fetch(`/api/events?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch events');
      }

      if (!mountedRef.current) return;

      console.log('✅ Successfully fetched', data.events.length, 'events from database');
      
      setEvents(data.events);
      setIsSuccess(true);
      setIsError(false);

      if (onSuccess) {
        onSuccess(data.events);
      }

    } catch (err) {
      if (!mountedRef.current) return;

      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('❌ Database event fetch failed:', errorMessage);
      
      setError(errorMessage);
      setIsError(true);
      setIsSuccess(false);

      if (onError) {
        onError(errorMessage);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsFetching(false);
      }
    }
  }, [contractAddress, enabled, eventTypes, userAddress, limit, onSuccess, onError]);

  const refetch = useCallback(() => {
    fetchEvents(true);
  }, [fetchEvents]);

  // Initial fetch
  useEffect(() => {
    if (enabled && contractAddress) {
      fetchEvents(true);
    }
  }, [fetchEvents, enabled, contractAddress]);

  // Set up polling interval
  useEffect(() => {
    if (!enabled || !refetchInterval) return;

    fetchIntervalRef.current = setInterval(() => {
      fetchEvents(false); // Don't show loading on interval fetches
    }, refetchInterval);

    return () => {
      if (fetchIntervalRef.current) {
        clearInterval(fetchIntervalRef.current);
      }
    };
  }, [fetchEvents, enabled, refetchInterval]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (fetchIntervalRef.current) {
        clearInterval(fetchIntervalRef.current);
      }
    };
  }, []);

  return {
    events,
    isLoading,
    isFetching,
    error,
    isError,
    isSuccess,
    refetch
  };
}

// Specialized hook for transaction table events from database
export function useTransactionTableDatabaseEvents(
  contractAddress?: string,
  options: UseDatabaseEventsOptions = {}
): UseDatabaseEventsResult {
  return useDatabaseEvents(contractAddress || '', {
    enabled: !!contractAddress,
    eventTypes: ['PositionOpened', 'PositionClosed', 'PositionLiquidated'],
    limit: 100,
    refetchInterval: 30000,
    ...options
  });
} 