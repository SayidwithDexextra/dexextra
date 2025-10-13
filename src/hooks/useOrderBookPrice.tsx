'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import type { Address } from 'viem';
import { formatUnits } from 'viem';
import { publicClient } from '@/lib/viemClient';

// Import OrderBook ABI - minimal ABI for price functions
const ORDERBOOK_ABI = [
  {
    inputs: [],
    name: 'getBestPrices',
    outputs: [
      { name: 'bestBidPrice', type: 'uint256' },
      { name: 'bestAskPrice', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'getLastTradePrice',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

interface OrderBookPriceData {
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  lastTradePrice: number;
  spread: number;
  dataSource: 'contract' | 'none';
  lastUpdated: string;
}

interface UseOrderBookPriceOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseOrderBookPriceReturn {
  priceData: OrderBookPriceData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const DEFAULT_OPTIONS: UseOrderBookPriceOptions = {
  autoRefresh: true,
  refreshInterval: 30000 // 30 seconds
};

export function useOrderBookPrice(
  orderBookAddress?: string,
  options: UseOrderBookPriceOptions = {}
): UseOrderBookPriceReturn {
  const { autoRefresh, refreshInterval } = { ...DEFAULT_OPTIONS, ...options };
  
  const [priceData, setPriceData] = useState<OrderBookPriceData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Require explicit address - no fallback to avoid wrong contract usage
  const contractAddress = orderBookAddress;

  const fetchPriceData = useCallback(async (): Promise<void> => {
    if (!contractAddress) {
      console.warn('⚠️ useOrderBookPrice: No OrderBook address provided, skipping price fetch');
      setError('No OrderBook address provided');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('📊 Fetching price data from OrderBook:', contractAddress);

      // Call getBestPrices function
      const bestPricesResult = await publicClient.readContract({
        address: contractAddress as Address,
        abi: ORDERBOOK_ABI,
        functionName: 'getBestPrices',
      });

      const [bestBidRaw, bestAskRaw] = bestPricesResult;
      
      // Convert from 6-decimal USDC format to regular numbers
      const bestBid = parseFloat(formatUnits(bestBidRaw, 6));
      const bestAsk = parseFloat(formatUnits(bestAskRaw, 6));
      
      // Calculate mid price
      const midPrice = (bestBid > 0 && bestAsk > 0) ? (bestBid + bestAsk) / 2 : (bestBid || bestAsk || 0);
      
      // Calculate spread
      const spread = (bestBid > 0 && bestAsk > 0) ? bestAsk - bestBid : 0;

      // Try to get last trade price (optional - may not exist on all contracts)
      let lastTradePrice = 0;
      try {
        const lastTradePriceResult = await publicClient.readContract({
          address: contractAddress as Address,
          abi: ORDERBOOK_ABI,
          functionName: 'getLastTradePrice',
        });
        lastTradePrice = parseFloat(formatUnits(lastTradePriceResult, 6));
      } catch (lastTradeError) {
        // getLastTradePrice function may not exist, use midPrice as fallback
        lastTradePrice = midPrice;
      }

      const newPriceData: OrderBookPriceData = {
        bestBid,
        bestAsk,
        midPrice,
        lastTradePrice,
        spread,
        dataSource: 'contract',
        lastUpdated: new Date().toISOString()
      };

      console.log('✅ OrderBook price data fetched:', {
        contractAddress,
        bestBid: `$${bestBid}`,
        bestAsk: `$${bestAsk}`,
        midPrice: `$${midPrice}`,
        lastTradePrice: `$${lastTradePrice}`,
        spread: `$${spread}`,
        rawValues: {
          bestBidRaw: bestBidRaw.toString(),
          bestAskRaw: bestAskRaw.toString()
        }
      });

      setPriceData(newPriceData);

    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch OrderBook price data';
      console.error('❌ OrderBook price fetch failed:', {
        contractAddress,
        error: errorMessage,
        fullError: err
      });
      setError(errorMessage);
      
      // Set empty data on error
      setPriceData({
        bestBid: 0,
        bestAsk: 0,
        midPrice: 0,
        lastTradePrice: 0,
        spread: 0,
        dataSource: 'none',
        lastUpdated: new Date().toISOString()
      });
    } finally {
      setIsLoading(false);
    }
  }, [contractAddress]);

  // Auto-refresh effect
  useEffect(() => {
    // Initial fetch
    fetchPriceData();

    if (!autoRefresh || !refreshInterval) return;

    // Set up interval for auto-refresh
    const interval = setInterval(fetchPriceData, refreshInterval);

    return () => clearInterval(interval);
  }, [fetchPriceData, autoRefresh, refreshInterval]);

  return {
    priceData,
    isLoading,
    error,
    refetch: fetchPriceData
  };
}

// Helper hook for just the current price (simplified interface)
export function useOrderBookCurrentPrice(
  orderBookAddress?: string,
  options: UseOrderBookPriceOptions = {}
): {
  currentPrice: number;
  markPrice: number;
  isLoading: boolean;
  error: string | null;
} {
  const { priceData, isLoading, error } = useOrderBookPrice(orderBookAddress, options);

  return useMemo(() => ({
    currentPrice: priceData?.lastTradePrice || priceData?.midPrice || 0,
    markPrice: priceData?.midPrice || 0,
    isLoading,
    error
  }), [priceData, isLoading, error]);
}


