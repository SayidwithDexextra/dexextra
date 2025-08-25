'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';

interface OrderbookMarkPriceData {
  markPrice: number;
  fundingRate: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  lastUpdateTime: number;
}

interface UseOrderbookMarkPriceOptions {
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
}

interface UseOrderbookMarkPriceReturn {
  markPriceData: OrderbookMarkPriceData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  dataSource: 'contract' | 'fallback' | 'none';
}

// Basic OrderBook ABI for mark price queries (new contracts)
const ORDERBOOK_ABI = [
  // Returns MarketStats struct; we only need lastPrice
  'function getMarketStats() external view returns (tuple(uint256 lastPrice,uint256 volume24h,uint256 high24h,uint256 low24h,int256 priceChange24h,uint256 totalTrades,uint256 bestBid,uint256 bestAsk,uint256 spread))',
  'function decimals() external view returns (uint8)'
];

export function useOrderbookMarkPrice(
  marketAddress: string | undefined,
  chainId: number,
  fallbackPrice?: number,
  options: UseOrderbookMarkPriceOptions = {}
): UseOrderbookMarkPriceReturn {
  const {
    autoRefresh = true,
    refreshInterval = 15000 // 15 seconds default for price data
  } = options;

  const [markPriceData, setMarkPriceData] = useState<OrderbookMarkPriceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'contract' | 'fallback' | 'none'>('none');

  const fetchMarkPrice = useCallback(async () => {
    try {
      setError(null);

      // If no market address, use fallback data
      if (!marketAddress || !ethers.isAddress(marketAddress)) {
        console.log('📊 No valid market address, using fallback price data');
        
        if (fallbackPrice && fallbackPrice > 0) {
          setMarkPriceData({
            markPrice: fallbackPrice,
            fundingRate: 0.0001, // Mock funding rate
            priceChange24h: 0,
            priceChangePercent24h: 0,
            lastUpdateTime: Date.now()
          });
          setDataSource('fallback');
        } else {
          setMarkPriceData(null);
          setDataSource('none');
        }
        setIsLoading(false);
        return;
      }

      console.log('🔍 Fetching mark price from contract:', marketAddress);

      // Get provider based on chain ID
      let rpcUrl: string;
      switch (chainId) {
        case 137: // Polygon Mainnet
          rpcUrl = process.env.NEXT_PUBLIC_POLYGON_RPC_URL || 'https://polygon-rpc.com';
          break;
        case 80001: // Polygon Mumbai (deprecated but might be used in testing)
          rpcUrl = process.env.NEXT_PUBLIC_POLYGON_MUMBAI_RPC_URL || 'https://rpc-mumbai.maticvigil.com';
          break;
        case 80002: // Polygon Amoy
          rpcUrl = process.env.NEXT_PUBLIC_POLYGON_AMOY_RPC_URL || 'https://rpc-amoy.polygon.technology';
          break;
        case 1: // Ethereum Mainnet
          rpcUrl = process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL || 'https://eth.public-rpc.com';
          break;
        case 11155111: // Sepolia
          rpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://sepolia.gateway.tenderly.co';
          break;
        default:
          throw new Error(`Unsupported chain ID: ${chainId}`);
      }

      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(marketAddress, ORDERBOOK_ABI, provider);

      // Fetch contract data in parallel (use getMarketStats for lastPrice)
      const [statsResult, decimalsResult] = await Promise.allSettled([
        contract.getMarketStats(),
        contract.decimals().catch(() => 18)
      ]);

      // Process results
      const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
      const lastPriceBigInt: bigint = stats && stats[0] ? stats[0] : BigInt(0); // lastPrice is first tuple item
      let decimals = decimalsResult.status === 'fulfilled' ? decimalsResult.value : 18;

      // Heuristic: many USD-quoted markets use 6 decimals; prefer 6 on Polygon if contract doesn't specify
      if ((decimals as any) === undefined || decimals === null) {
        decimals = chainId === 137 ? 6 : 18;
      }

      // Choose best available price: lastPrice > 0, else fallback
      let chosenPriceBigInt = lastPriceBigInt;

      // If still zero, fall back to provided fallback price
      if (chosenPriceBigInt === BigInt(0)) {
        if (fallbackPrice && fallbackPrice > 0) {
          console.warn('⚠️ Contract prices unavailable; using provided fallback price');
          setMarkPriceData({
            markPrice: fallbackPrice,
            fundingRate: 0,
            priceChange24h: 0,
            priceChangePercent24h: 0,
            lastUpdateTime: Date.now()
          });
          setDataSource('fallback');
          setIsLoading(false);
          return;
        }
        throw new Error('No valid price available from contract');
      }

      // Convert to human-readable numbers
      const markPrice = parseFloat(ethers.formatUnits(chosenPriceBigInt, decimals));
      const fundingRate = 0; // Not available in OrderBook contracts; default to 0

      // For now, set 24h changes to 0 since we don't have historical data
      // In a production system, you'd fetch this from your database or a price oracle
      const priceChange24h = 0;
      const priceChangePercent24h = 0;

      console.log(`✅ Successfully fetched mark price for ${marketAddress}:`, {
        markPrice,
        fundingRate,
        chainId,
        decimals
      });

      setMarkPriceData({
        markPrice,
        fundingRate,
        priceChange24h,
        priceChangePercent24h,
        lastUpdateTime: Date.now()
      });
      setDataSource('contract');

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch mark price';
      console.error('❌ Error fetching mark price:', errorMessage);
      setError(errorMessage);

      // Fall back to provided fallback price
      if (fallbackPrice && fallbackPrice > 0) {
        console.log('🔄 Using fallback price due to contract error:', fallbackPrice);
        setMarkPriceData({
          markPrice: fallbackPrice,
          fundingRate: 0,
          priceChange24h: 0,
          priceChangePercent24h: 0,
          lastUpdateTime: Date.now()
        });
        setDataSource('fallback');
      } else {
        setMarkPriceData(null);
        setDataSource('none');
      }
    } finally {
      setIsLoading(false);
    }
  }, [marketAddress, chainId, fallbackPrice]);

  // Initial fetch
  useEffect(() => {
    fetchMarkPrice();
  }, [fetchMarkPrice]);

  // Auto-refresh setup
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      // Only auto-refresh if we have a market address and we're not currently loading
      if (marketAddress && !isLoading) {
        fetchMarkPrice();
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchMarkPrice, marketAddress, isLoading]);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    await fetchMarkPrice();
  }, [fetchMarkPrice]);

  return {
    markPriceData,
    isLoading,
    error,
    refetch,
    dataSource
  };
}

