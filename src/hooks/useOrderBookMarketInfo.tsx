"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Address } from 'viem';
import { publicClient } from '@/lib/viemClient';

// OrderBook ABI for getMarketInfo function (based on our smart contract analysis)
const ORDERBOOK_MARKET_INFO_ABI = [
  {
    inputs: [],
    name: "getMarketInfo",
    outputs: [
      {
        components: [
          { internalType: "bytes32", name: "marketId", type: "bytes32" },
          { internalType: "string", name: "symbol", type: "string" },
          { internalType: "string", name: "metricId", type: "string" },
          { internalType: "uint256", name: "currentPrice", type: "uint256" },
          { internalType: "uint256", name: "lastPrice", type: "uint256" },
          { internalType: "uint256", name: "openInterest", type: "uint256" },
          { internalType: "uint256", name: "volume24h", type: "uint256" },
          { internalType: "uint256", name: "funding", type: "uint256" },
          { internalType: "uint256", name: "lastFundingTime", type: "uint256" },
          { internalType: "bool", name: "isActive", type: "bool" },
          { internalType: "bool", name: "isCustomMetric", type: "bool" },
        ],
        internalType: "struct OrderBook.Market",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getBestPrices",
    outputs: [
      { internalType: "uint256", name: "bestBidPrice", type: "uint256" },
      { internalType: "uint256", name: "bestAskPrice", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

interface MarketInfo {
  marketId: string;
  symbol: string;
  metricId: string;
  currentPrice: number; // Mark/reference price (may be 0)
  lastPrice: number; // Last executed trade price (our target)
  openInterest: number;
  volume24h: number;
  funding: number;
  lastFundingTime: number;
  isActive: boolean;
  isCustomMetric: boolean;
}

interface OrderBookPrices {
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spread: number;
}

interface UseOrderBookMarketInfoReturn {
  marketInfo: MarketInfo | null;
  orderBookPrices: OrderBookPrices | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  lastUpdated: string | null;
}

interface UseOrderBookMarketInfoOptions {
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

const DEFAULT_OPTIONS: UseOrderBookMarketInfoOptions = {
  autoRefresh: true,
  refreshInterval: 15000, // 15 seconds
};

// Price precision from the smart contract (6 decimals for USDC compatibility)
const PRICE_PRECISION = 1e6;

export function useOrderBookMarketInfo(
  orderBookAddress?: string,
  options: UseOrderBookMarketInfoOptions = {}
): UseOrderBookMarketInfoReturn {
  const { autoRefresh, refreshInterval } = { ...DEFAULT_OPTIONS, ...options };
  
  const [marketInfo, setMarketInfo] = useState<MarketInfo | null>(null);
  const [orderBookPrices, setOrderBookPrices] = useState<OrderBookPrices | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchMarketInfo = useCallback(async (): Promise<void> => {
    if (!orderBookAddress) {
      setError('No order book address provided');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('📊 Fetching market info from OrderBook contract:', orderBookAddress);

      // Fetch market info and best prices in parallel with better error handling
      const [marketInfoResult, bestPricesResult] = await Promise.all([
        publicClient.readContract({
          address: orderBookAddress as Address,
          abi: ORDERBOOK_MARKET_INFO_ABI,
          functionName: 'getMarketInfo',
        }).catch((err) => {
          console.warn('⚠️ getMarketInfo failed, trying alternative approach:', err.message);
          throw err; // Re-throw to handle in outer catch
        }),
        publicClient.readContract({
          address: orderBookAddress as Address,
          abi: ORDERBOOK_MARKET_INFO_ABI,
          functionName: 'getBestPrices',
        }).catch((err) => {
          console.warn('⚠️ getBestPrices failed, using zero values:', err.message);
          return [0n, 0n]; // Fallback to zero prices if getBestPrices fails
        }),
      ]);

      // Parse market info - handle both array and object tuple formats
      console.log('🔍 Raw marketInfoResult:', marketInfoResult);
      console.log('🔍 Type:', typeof marketInfoResult, 'Array?', Array.isArray(marketInfoResult));
      
      let marketId, symbol, metricId, currentPrice, lastPrice, openInterest, volume24h, funding, lastFundingTime, isActive, isCustomMetric;
      
      if (Array.isArray(marketInfoResult)) {
        // Array format (expected from array destructuring)
        [marketId, symbol, metricId, currentPrice, lastPrice, openInterest, volume24h, funding, lastFundingTime, isActive, isCustomMetric] = marketInfoResult;
      } else if (marketInfoResult && typeof marketInfoResult === 'object') {
        // Object format (tuple with named properties)
        ({marketId, symbol, metricId, currentPrice, lastPrice, openInterest, volume24h, funding, lastFundingTime, isActive, isCustomMetric} = marketInfoResult);
      } else {
        // Try accessing by index (fallback)
        marketId = marketInfoResult[0];
        symbol = marketInfoResult[1];
        metricId = marketInfoResult[2];
        currentPrice = marketInfoResult[3];
        lastPrice = marketInfoResult[4];
        openInterest = marketInfoResult[5];
        volume24h = marketInfoResult[6];
        funding = marketInfoResult[7];
        lastFundingTime = marketInfoResult[8];
        isActive = marketInfoResult[9];
        isCustomMetric = marketInfoResult[10];
      }

      // Convert prices from contract units (6 decimal precision) to display prices
      const currentPriceFormatted = parseFloat(currentPrice.toString()) / PRICE_PRECISION;
      const lastPriceFormatted = parseFloat(lastPrice.toString()) / PRICE_PRECISION;
      const volume24hFormatted = parseFloat(volume24h.toString()) / PRICE_PRECISION;
      const openInterestFormatted = parseFloat(openInterest.toString()) / PRICE_PRECISION;
      const fundingFormatted = parseFloat(funding.toString()) / PRICE_PRECISION;

      // Parse best prices
      const [bestBidRaw, bestAskRaw] = bestPricesResult as [bigint, bigint];
      const bestBid = parseFloat(bestBidRaw.toString()) / PRICE_PRECISION;
      const bestAsk = parseFloat(bestAskRaw.toString()) / PRICE_PRECISION;
      const midPrice = (bestBid > 0 && bestAsk > 0) ? (bestBid + bestAsk) / 2 : 0;
      const spread = (bestBid > 0 && bestAsk > 0) ? bestAsk - bestBid : 0;

      const newMarketInfo: MarketInfo = {
        marketId: marketId as string,
        symbol: symbol as string,
        metricId: metricId as string,
        currentPrice: currentPriceFormatted,
        lastPrice: lastPriceFormatted,
        openInterest: openInterestFormatted,
        volume24h: volume24hFormatted,
        funding: fundingFormatted,
        lastFundingTime: Number(lastFundingTime),
        isActive: isActive as boolean,
        isCustomMetric: isCustomMetric as boolean,
      };

      const newOrderBookPrices: OrderBookPrices = {
        bestBid,
        bestAsk,
        midPrice,
        spread,
      };

      console.log('✅ Market info fetched successfully:', {
        contractAddress: orderBookAddress,
        symbol: newMarketInfo.symbol,
        metricId: newMarketInfo.metricId,
        currentPrice: `$${currentPriceFormatted.toFixed(6)}`,
        lastPrice: `$${lastPriceFormatted.toFixed(6)}`, // This is our target field!
        bestBid: `$${bestBid.toFixed(6)}`,
        bestAsk: `$${bestAsk.toFixed(6)}`,
        midPrice: `$${midPrice.toFixed(6)}`,
        isActive: newMarketInfo.isActive,
        volume24h: `$${volume24hFormatted.toFixed(2)}`,
        openInterest: `$${openInterestFormatted.toFixed(2)}`,
        parsedData: {
          marketId: marketId?.toString(),
          symbol,
          metricId,
          currentPrice: currentPrice?.toString(),
          lastPrice: lastPrice?.toString(),
          isActive,
          isCustomMetric,
        },
        rawValues: {
          currentPrice: currentPrice?.toString(),
          lastPrice: lastPrice?.toString(),
          bestBid: bestBidRaw.toString(),
          bestAsk: bestAskRaw.toString(),
        },
      });

      setMarketInfo(newMarketInfo);
      setOrderBookPrices(newOrderBookPrices);
      setLastUpdated(new Date().toISOString());

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('❌ Failed to fetch market info:', {
        contractAddress: orderBookAddress,
        error: errorMessage,
        errorType: err instanceof Error ? err.constructor.name : typeof err,
        errorDetails: err,
        stack: err instanceof Error ? err.stack : undefined,
      });
      
      // Set a more user-friendly error message
      const friendlyError = errorMessage.includes('ETIMEDOUT') 
        ? 'Network timeout - please check your connection'
        : errorMessage.includes('execution reverted')
        ? 'Smart contract call failed - contract may not support this function'
        : errorMessage.includes('network')
        ? 'Network connection error'
        : errorMessage;
        
      setError(friendlyError);
    } finally {
      setIsLoading(false);
    }
  }, [orderBookAddress]);

  // Setup auto-refresh
  useEffect(() => {
    if (!orderBookAddress) return;

    // Initial fetch
    fetchMarketInfo();

    // Setup auto-refresh if enabled
    if (autoRefresh && refreshInterval > 0) {
      intervalRef.current = setInterval(fetchMarketInfo, refreshInterval);
    }

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [orderBookAddress, autoRefresh, refreshInterval, fetchMarketInfo]);

  // Manual refetch function
  const refetch = useCallback(async () => {
    await fetchMarketInfo();
  }, [fetchMarketInfo]);

  return {
    marketInfo,
    orderBookPrices,
    isLoading,
    error,
    refetch,
    lastUpdated,
  };
}
