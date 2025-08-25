'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';

// Interface matching the actual OrderBook MarketStats struct
interface OrderbookMarketData {
  lastPrice: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  priceChange24h: number;
  totalTrades: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  lastUpdateTime: number;
}

interface UseOrderbookMarketStatsOptions {
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
}

interface UseOrderbookMarketStatsReturn {
  marketData: OrderbookMarketData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  dataSource: 'contract' | 'fallback' | 'none';
}

// OrderBook ABI matching the actual contract interface
const ORDERBOOK_ABI = [
  // Returns MarketStats struct from the actual contract
  'function getMarketStats() external view returns (tuple(uint256 lastPrice,uint256 volume24h,uint256 high24h,uint256 low24h,int256 priceChange24h,uint256 totalTrades,uint256 bestBid,uint256 bestAsk,uint256 spread))',
  'function decimals() external view returns (uint8)'
];

export function useOrderbookMarketStats(
  marketAddress: string | undefined,
  chainId: number,
  fallbackPrice?: number,
  options: UseOrderbookMarketStatsOptions = {}
): UseOrderbookMarketStatsReturn {
  const {
    autoRefresh = true,
    refreshInterval = 15000 // 15 seconds default for market data
  } = options;

  const [marketData, setMarketData] = useState<OrderbookMarketData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'contract' | 'fallback' | 'none'>('none');

  const fetchMarketStats = useCallback(async () => {
    try {
      setError(null);
      
      if (!marketAddress || !ethers.isAddress(marketAddress)) {
        throw new Error('Invalid market address provided');
      }

      console.log(`🔍 Fetching market stats for OrderBook: ${marketAddress}`);

      // Create provider for the specified chain
      let provider: ethers.Provider;
      
      // For reads, prefer public RPC to avoid wallet network issues
      if (chainId === 137) { // Polygon
        provider = new ethers.JsonRpcProvider('https://polygon-rpc.com');
      } else if (chainId === 1) { // Ethereum
        provider = new ethers.JsonRpcProvider('https://cloudflare-eth.com');
      } else {
        // Try to use wallet provider as fallback
        if (typeof globalThis !== 'undefined' && (globalThis as any).window && (globalThis as any).window.ethereum) {
          provider = new ethers.BrowserProvider((globalThis as any).window.ethereum);
        } else {
          throw new Error(`Unsupported chain ID: ${chainId}`);
        }
      }

      const contract = new ethers.Contract(marketAddress, ORDERBOOK_ABI, provider);

      // Fetch market stats and decimals
      const [statsResult, decimalsResult] = await Promise.allSettled([
        contract.getMarketStats(),
        contract.decimals().catch(() => 6) // Default to 6 decimals for USD markets
      ]);

      // Process results
      const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
      let decimals = decimalsResult.status === 'fulfilled' ? decimalsResult.value : 6;

      if (!stats) {
        throw new Error('Unable to fetch market statistics from contract');
      }

      // Extract values from MarketStats tuple
      const [
        lastPriceBigInt,
        volume24hBigInt, 
        high24hBigInt,
        low24hBigInt,
        priceChange24hBigInt,
        totalTradesBigInt,
        bestBidBigInt,
        bestAskBigInt,
        spreadBigInt
      ] = stats;

      // Convert BigInt values to numbers using appropriate decimals
      const lastPrice = parseFloat(ethers.formatUnits(lastPriceBigInt || BigInt(0), decimals));
      const volume24h = parseFloat(ethers.formatUnits(volume24hBigInt || BigInt(0), decimals));
      const high24h = parseFloat(ethers.formatUnits(high24hBigInt || BigInt(0), decimals));
      const low24h = parseFloat(ethers.formatUnits(low24hBigInt || BigInt(0), decimals));
      const priceChange24h = parseFloat(ethers.formatUnits(priceChange24hBigInt || BigInt(0), decimals));
      const totalTrades = Number(totalTradesBigInt || BigInt(0));
      const bestBid = parseFloat(ethers.formatUnits(bestBidBigInt || BigInt(0), decimals));
      const bestAsk = parseFloat(ethers.formatUnits(bestAskBigInt || BigInt(0), decimals));
      const spread = parseFloat(ethers.formatUnits(spreadBigInt || BigInt(0), decimals));

      // Use fallback if no last price available from contract
      if (lastPrice === 0 && fallbackPrice && fallbackPrice > 0) {
        console.warn('⚠️ No last trade price available; using provided fallback');
        setMarketData({
          lastPrice: fallbackPrice,
          volume24h: 0,
          high24h: fallbackPrice,
          low24h: fallbackPrice,
          priceChange24h: 0,
          totalTrades: 0,
          bestBid: 0,
          bestAsk: 0,
          spread: 0,
          lastUpdateTime: Date.now()
        });
        setDataSource('fallback');
        setIsLoading(false);
        return;
      }

      console.log(`✅ Successfully fetched market stats for ${marketAddress}:`, {
        lastPrice,
        volume24h,
        high24h,
        low24h,
        priceChange24h,
        totalTrades,
        bestBid,
        bestAsk,
        spread,
        decimals
      });

      setMarketData({
        lastPrice,
        volume24h,
        high24h,
        low24h,
        priceChange24h,
        totalTrades,
        bestBid,
        bestAsk,
        spread,
        lastUpdateTime: Date.now()
      });
      setDataSource('contract');
      setIsLoading(false);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch market statistics';
      console.error('❌ Error fetching market stats:', errorMessage);
      setError(errorMessage);

      // Fall back to provided fallback price if available
      if (fallbackPrice && fallbackPrice > 0) {
        console.warn('⚠️ Contract call failed; using provided fallback price');
        setMarketData({
          lastPrice: fallbackPrice,
          volume24h: 0,
          high24h: fallbackPrice,
          low24h: fallbackPrice,
          priceChange24h: 0,
          totalTrades: 0,
          bestBid: 0,
          bestAsk: 0,
          spread: 0,
          lastUpdateTime: Date.now()
        });
        setDataSource('fallback');
      } else {
        setDataSource('none');
      }
      setIsLoading(false);
    }
  }, [marketAddress, chainId, fallbackPrice]);

  // Auto-refresh effect
  useEffect(() => {
    if (!marketAddress) {
      setIsLoading(false);
      return;
    }

    // Initial fetch
    fetchMarketStats();

    if (!autoRefresh) return;

    // Set up interval for auto-refresh
    const interval = setInterval(fetchMarketStats, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchMarketStats, autoRefresh, refreshInterval, marketAddress]);

  return {
    marketData,
    isLoading,
    error,
    refetch: fetchMarketStats,
    dataSource
  };
}