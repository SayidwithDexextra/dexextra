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

// OrderBook ABI for HyperLiquid contracts
const ORDERBOOK_ABI = [
  // HyperLiquid OrderBook interface - compatible with the deployed contracts
  'function getBestPrices() external view returns (uint256 bestBidPrice, uint256 bestAskPrice)',
  'function bestBid() external view returns (uint256)',
  'function bestAsk() external view returns (uint256)',
  'function getMarketInfo() external view returns (tuple(bytes32 marketId,string symbol,string metricId,uint256 currentPrice,uint256 lastPrice,uint256 openInterest,uint256 volume24h,uint256 funding,uint256 lastFundingTime,bool isActive,bool isCustomMetric))'
];

// TradingRouter ABI for unified market access
const TRADING_ROUTER_ABI = [
  'function getMultiMarketPrices(bytes32[] marketIds) external view returns (uint256[] bestBids, uint256[] bestAsks)',
  'function isPaused() external view returns (bool)'
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
      
      console.log(`🔍 Debug: marketAddress="${marketAddress}", chainId=${chainId}`);
      
      if (!marketAddress || !ethers.isAddress(marketAddress)) {
        console.warn(`⚠️ Skipping market stats fetch - invalid or missing market address: "${marketAddress}"`);
        setIsLoading(false);
        setDataSource('none');
        return;
      }

      console.log(`🔍 Fetching HyperLiquid market stats for OrderBook: ${marketAddress}`);

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

      // Try to fetch comprehensive market info first
      try {
        const marketInfo = await contract.getMarketInfo();
        
        // Destructure the market info tuple
        const [
          marketId,
          symbol,
          metricId,
          currentPrice,
          lastPrice,
          openInterest,
          volume24h,
          funding,
          lastFundingTime,
          isActive,
          isCustomMetric
        ] = marketInfo;

        console.log(`✅ Successfully fetched HyperLiquid market info for ${marketAddress}:`, {
          symbol,
          metricId,
          currentPrice: ethers.formatUnits(currentPrice, 18),
          lastPrice: ethers.formatUnits(lastPrice, 18),
          volume24h: ethers.formatUnits(volume24h, 18),
          isActive
        });

        // Convert prices from contract units to display prices
        // Contract stores prices in 6-decimal precision (1e6)
        // Contract price 5000000 → Display price $5.00 (divide by 1000000)
        const PRICE_PRECISION = 1e6;
        const currentPriceFormatted = parseFloat(currentPrice.toString()) / PRICE_PRECISION;
        const lastPriceFormatted = parseFloat(lastPrice.toString()) / PRICE_PRECISION;
        const volume24hFormatted = parseFloat(ethers.formatUnits(volume24h, 18));

        // Use currentPrice as the main price, fallback to lastPrice
        const effectivePrice = currentPriceFormatted > 0 ? currentPriceFormatted : lastPriceFormatted;

        // Get best bid/ask prices
        const [bestBidPrice, bestAskPrice] = await contract.getBestPrices();
        const bestBid = parseFloat(bestBidPrice.toString()) / PRICE_PRECISION;
        const bestAsk = parseFloat(bestAskPrice.toString()) / PRICE_PRECISION;

        // Calculate price change (simplified for now)
        const priceChange24h = effectivePrice > 0 && lastPriceFormatted > 0 
          ? effectivePrice - lastPriceFormatted 
          : 0;

        setMarketData({
          lastPrice: effectivePrice,
          volume24h: volume24hFormatted,
          high24h: Math.max(effectivePrice, lastPriceFormatted),
          low24h: Math.min(effectivePrice > 0 ? effectivePrice : lastPriceFormatted, lastPriceFormatted > 0 ? lastPriceFormatted : effectivePrice),
          priceChange24h,
          totalTrades: 0, // Not available in basic market info
          bestBid,
          bestAsk,
          spread: bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0,
          lastUpdateTime: Date.now()
        });
        setDataSource('contract');
        setIsLoading(false);
        return;

      } catch (marketInfoErr) {
        console.warn('⚠️ getMarketInfo() failed, trying fallback methods:', marketInfoErr);
        
        // Fallback to individual method calls
        try {
          const [bestBidPrice, bestAskPrice] = await contract.getBestPrices();
          const bestBid = parseFloat(ethers.formatUnits(bestBidPrice, 18));
          const bestAsk = parseFloat(ethers.formatUnits(bestAskPrice, 18));

          let derivedPrice = 0;
          if (bestBid > 0 && bestAsk > 0) {
            derivedPrice = (bestBid + bestAsk) / 2; // Mid-price
          } else if (bestBid > 0) {
            derivedPrice = bestBid;
          } else if (bestAsk > 0) {
            derivedPrice = bestAsk;
          }

          if (derivedPrice > 0) {
            setMarketData({
              lastPrice: derivedPrice,
              volume24h: 0,
              high24h: derivedPrice,
              low24h: derivedPrice,
              priceChange24h: 0,
              totalTrades: 0,
              bestBid,
              bestAsk,
              spread: bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0,
              lastUpdateTime: Date.now()
            });
            setDataSource('contract');
            setIsLoading(false);
            return;
          }
        } catch (pricesErr) {
          console.warn('⚠️ getBestPrices() also failed:', pricesErr);
          console.warn(`⚠️ Contract address used: ${marketAddress}, Chain ID: ${chainId}`);
          throw new Error('Unable to fetch market statistics from HyperLiquid contract');
        }
      }

      // If we get here, no price data was available
      if (fallbackPrice && fallbackPrice > 0) {
        console.warn('⚠️ No on-chain price available; using provided fallback');
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

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch market statistics';
      console.error('❌ Error fetching HyperLiquid market stats:', errorMessage);
      console.error(`❌ Debug info - Address: "${marketAddress}", Chain: ${chainId}, Valid address: ${marketAddress ? ethers.isAddress(marketAddress) : false}`);
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
    if (!marketAddress || !ethers.isAddress(marketAddress)) {
      console.log(`ℹ️ Skipping market stats fetch - no valid market address provided`);
      setIsLoading(false);
      setError(null);
      setDataSource('none');
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