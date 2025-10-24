'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { useAluminumOrderBook } from './useContract';
import DEXETRAV5_CONFIG from '@/lib/contractConfig';

// Market data types
export interface MarketInfo {
  symbol: string;
  name: string;
  marketId: string;
  orderBook: string;
  leverageEnabled: boolean;
  maxLeverage: string;
  marginRequirement: string;
  defaultMargin: string;
  riskLevel: string;
  features: {
    marginRelease: boolean;
    cumulativeTracking: boolean;
    multiPriceLevel: boolean;
  };
}

export interface MarketPrice {
  bestBid: string;
  bestAsk: string;
  midPrice: string;
  lastPrice: string;
  markPrice: string;
  spread: string;
  spreadPercentage: string;
  timestamp: number;
}

export interface MarketDepth {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface OrderBookLevel {
  price: string;
  quantity: string;
  total: string;
}

/**
 * Hook for fetching market data from Dexeterav5 contracts
 */
export function useMarketData(marketKey: string = 'ALUMINUM') {
  const [marketInfo, setMarketInfo] = useState<MarketInfo | null>(null);
  const [marketPrice, setMarketPrice] = useState<MarketPrice | null>(null);
  const [marketDepth, setMarketDepth] = useState<MarketDepth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Get OrderBook contract
  const { contract: orderBookContract, error: contractError } = useAluminumOrderBook();

  // Fetch market info from Dexetrav5 config
  useEffect(() => {
    try {
      const info = (DEXETRAV5_CONFIG as any).MARKET_INFO?.[marketKey] || null;
      if (info) {
        setMarketInfo({
          symbol: info.symbol || '',
          name: info.name || '',
          marketId: info.marketId || '',
          orderBook: info.orderBook || '',
          leverageEnabled: info.leverageEnabled || false,
          maxLeverage: info.maxLeverage || '1x',
          marginRequirement: info.marginRequirement || '100%',
          defaultMargin: info.defaultMargin || '100%',
          riskLevel: info.riskLevel || 'LOW',
          features: {
            marginRelease: info.features?.marginRelease || false,
            cumulativeTracking: info.features?.cumulativeTracking || false,
            multiPriceLevel: info.features?.multiPriceLevel || false,
          },
        });
      }
    } catch (err) {
      console.error('Error fetching market info:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch market info'));
    }
  }, [marketKey]);

  // Fetch market price data
  const fetchMarketPrice = useCallback(async () => {
    // Check if contract and read interface are available
    if (!orderBookContract || !orderBookContract.read) {
      console.warn('OrderBook contract or read interface not available');
      setIsLoading(false);
      setError(new Error('OrderBook contract not initialized or missing read interface'));
      return;
    }

    try {
      setIsLoading(true);

      // Check if required methods exist
      if (typeof orderBookContract.read.bestBid !== 'function') {
        console.error('bestBid method not found on contract');
        setError(new Error('Contract missing bestBid method'));
        setIsLoading(false);
        return;
      }

      // Get best bid and ask with null checks
      const bestBid = await orderBookContract.read.bestBid();
      const bestAsk = await orderBookContract.read.bestAsk();
      const markPrice = await orderBookContract.read.calculateMarkPrice();
      const lastPrice = await orderBookContract.read.lastTradePrice();

      // Format prices
      const bestBidFormatted = formatUnits(bestBid, 6);
      const bestAskFormatted = formatUnits(bestAsk, 6);
      const markPriceFormatted = formatUnits(markPrice, 6);
      const lastPriceFormatted = formatUnits(lastPrice, 6);

      // Calculate mid price and spread
      const midPrice = (Number(bestBidFormatted) + Number(bestAskFormatted)) / 2;
      const spread = Number(bestAskFormatted) - Number(bestBidFormatted);
      const spreadPercentage = (spread / Number(bestBidFormatted)) * 100;

      setMarketPrice({
        bestBid: bestBidFormatted,
        bestAsk: bestAskFormatted,
        midPrice: midPrice.toString(),
        lastPrice: lastPriceFormatted,
        markPrice: markPriceFormatted,
        spread: spread.toString(),
        spreadPercentage: spreadPercentage.toFixed(2),
        timestamp: Date.now(),
      });

      setIsLoading(false);
      setError(null);
    } catch (err) {
      console.error('Error fetching market price:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch market price'));
      setIsLoading(false);
    }
  }, [orderBookContract]);

  // Fetch market depth
  const fetchMarketDepth = useCallback(async () => {
    // Check if contract and read interface are available
    if (!orderBookContract || !orderBookContract.read) {
      console.warn('OrderBook contract or read interface not available');
      setIsLoading(false);
      setError(new Error('OrderBook contract not initialized or missing read interface'));
      return;
    }

    try {
      setIsLoading(true);

      // Get order book depth (implementation depends on contract methods)
      // This is a placeholder - actual implementation will depend on your contract's API
      const bids: OrderBookLevel[] = [];
      const asks: OrderBookLevel[] = [];

      // Try to get order book data if available
      try {
        // This is just an example - your contract might have different methods
        const orderBook = await orderBookContract.read.getOrderBook([10]);
        
        if (orderBook && Array.isArray(orderBook)) {
          // Process bids and asks based on contract response format
          // This is just a placeholder - adjust based on actual contract response
          const [bidPrices, bidQuantities, askPrices, askQuantities] = orderBook;
          
          for (let i = 0; i < bidPrices.length; i++) {
            bids.push({
              price: formatUnits(bidPrices[i], 6),
              quantity: formatUnits(bidQuantities[i], 18),
              total: (Number(formatUnits(bidPrices[i], 6)) * Number(formatUnits(bidQuantities[i], 18))).toString(),
            });
          }
          
          for (let i = 0; i < askPrices.length; i++) {
            asks.push({
              price: formatUnits(askPrices[i], 6),
              quantity: formatUnits(askQuantities[i], 18),
              total: (Number(formatUnits(askPrices[i], 6)) * Number(formatUnits(askQuantities[i], 18))).toString(),
            });
          }
        }
      } catch (err) {
        console.warn('Order book depth not available:', err);
        // Continue with empty bids/asks
      }

      setMarketDepth({ bids, asks });
      setIsLoading(false);
    } catch (err) {
      console.error('Error fetching market depth:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch market depth'));
      setIsLoading(false);
    }
  }, [orderBookContract]);

  // Fetch data on mount and contract change
  useEffect(() => {
    if (contractError) {
      setError(contractError);
      setIsLoading(false);
      return;
    }

    if (orderBookContract) {
      fetchMarketPrice();
      fetchMarketDepth();
    }
  }, [orderBookContract, contractError, fetchMarketPrice, fetchMarketDepth]);

  // Set up polling for price updates
  useEffect(() => {
    if (!orderBookContract) return;

    const interval = setInterval(() => {
      fetchMarketPrice();
    }, 10000); // Update every 10 seconds

    return () => clearInterval(interval);
  }, [orderBookContract, fetchMarketPrice]);

  // Refetch function for manual updates
  const refetch = useCallback(() => {
    fetchMarketPrice();
    fetchMarketDepth();
  }, [fetchMarketPrice, fetchMarketDepth]);

  return {
    marketInfo,
    marketPrice,
    marketDepth,
    isLoading,
    error,
    refetch,
  };
}

/**
 * Hook for aluminum market data
 */
export function useAluminumMarketData() {
  return useMarketData('ALUMINUM');
}

/**
 * Hook for bitcoin market data
 */
export function useBitcoinMarketData() {
  return useMarketData('BTC');
}