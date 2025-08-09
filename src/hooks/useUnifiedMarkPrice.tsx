/**
 * 🎯 Unified Mark Price Hook
 * 
 * This hook provides a single source of truth for mark price data across the application.
 * It combines real-time contract data with fallback to cached/historical data.
 * Used by both TokenHeader and Chart components to ensure consistency.
 */

'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPublicClient, http, formatEther } from 'viem';
import { polygon } from 'viem/chains';
import { VAMMMarket } from './useVAMMMarkets';

interface UnifiedMarkPriceData {
  currentPrice: number;
  markPrice: string;
  fundingRate: string;
  priceChange24h: number;
  priceChangePercent24h: number;
  isLoading: boolean;
  error: string | null;
  lastUpdated: number;
  dataSource: 'contract' | 'initial' | 'fallback';
  vammAddress: string | null;
}

interface UseUnifiedMarkPriceOptions {
  pollingInterval?: number;
  enablePolling?: boolean;
  enableContractFetch?: boolean;
}

// Direct VAMM ABI for mark price queries
const VAMM_MARK_PRICE_ABI = [
  {
    name: 'getMetricMarkPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'metricId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'getMetricFundingRate', 
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'metricId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'int256' }]
  }
] as const;

/**
 * Get metric ID from VAMM market data
 */
function getMetricIdFromMarket(vammMarket: VAMMMarket): string {
  if (vammMarket.metric_id && vammMarket.metric_id.startsWith('0x')) {
    return vammMarket.metric_id;
  }
  
  // Fallback: Generate from symbol
  const encoder = new TextEncoder();
  const data = encoder.encode(vammMarket.symbol.toLowerCase());
  const hash = new Uint8Array(32);
  for (let i = 0; i < Math.min(data.length, 32); i++) {
    hash[i] = data[i];
  }
  return `0x${Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

export function useUnifiedMarkPrice(
  vammMarket?: VAMMMarket,
  options: UseUnifiedMarkPriceOptions = {}
) {
  const { 
    pollingInterval = 30000, 
    enablePolling = true,
    enableContractFetch = true
  } = options;

  const [priceData, setPriceData] = useState<UnifiedMarkPriceData>({
    currentPrice: 0,
    markPrice: '0',
    fundingRate: '0',
    priceChange24h: 0,
    priceChangePercent24h: 0,
    isLoading: false,
    error: null,
    lastUpdated: 0,
    dataSource: 'initial',
    vammAddress: null,
  });

  const publicClient = useRef<any>(null);
  const pollingInterval_ref = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Initialize viem client
  const initializeClient = useCallback(async () => {
    if (!publicClient.current) {
      publicClient.current = createPublicClient({
        chain: polygon,
        transport: http(process.env.NEXT_PUBLIC_POLYGON_RPC_URL || 'https://polygon-rpc.com')
      });
      console.log('✅ Unified mark price client initialized');
    }
  }, []);

  // Fetch real-time mark price from contract
  const fetchContractMarkPrice = useCallback(async (): Promise<{
    markPrice: string;
    fundingRate: string;
    success: boolean;
  }> => {
    if (!vammMarket?.vamm_address || !publicClient.current || !enableContractFetch) {
      return { markPrice: '0', fundingRate: '0', success: false };
    }

    try {
      const metricId = getMetricIdFromMarket(vammMarket);
      
      const [markPriceResult, fundingRateResult] = await Promise.allSettled([
        publicClient.current.readContract({
          address: vammMarket.vamm_address as `0x${string}`,
          abi: VAMM_MARK_PRICE_ABI,
          functionName: 'getMetricMarkPrice',
          args: [metricId as `0x${string}`]
        }),
        publicClient.current.readContract({
          address: vammMarket.vamm_address as `0x${string}`,
          abi: VAMM_MARK_PRICE_ABI,
          functionName: 'getMetricFundingRate',
          args: [metricId as `0x${string}`]
        })
      ]);

      let markPrice = vammMarket.initial_price.toString();
      let fundingRate = '0';

      if (markPriceResult.status === 'fulfilled') {
        markPrice = formatEther(markPriceResult.value as bigint);
      }

      if (fundingRateResult.status === 'fulfilled') {
        const fundingRateBigInt = fundingRateResult.value as bigint;
        fundingRate = (Number(fundingRateBigInt) / 10000).toString();
      }

      console.log(`✅ Contract mark price for ${vammMarket.symbol}: $${markPrice}`);
      return { markPrice, fundingRate, success: true };

    } catch (error) {
      console.error('❌ Error fetching contract mark price:', error);
      return { markPrice: '0', fundingRate: '0', success: false };
    }
  }, [vammMarket, enableContractFetch]);

  // Main price update function
  const updatePriceData = useCallback(async () => {
    if (!vammMarket || !isMountedRef.current) return;

    setPriceData(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Try to get real-time contract data first
      const contractData = await fetchContractMarkPrice();
      
      let currentPrice = vammMarket.initial_price;
      let markPrice = vammMarket.initial_price.toString();
      let fundingRate = '0';
      let dataSource: 'contract' | 'initial' | 'fallback' = 'initial';

      if (contractData.success && parseFloat(contractData.markPrice) > 0) {
        markPrice = contractData.markPrice;
        currentPrice = parseFloat(markPrice);
        fundingRate = contractData.fundingRate;
        dataSource = 'contract';
      }

      // Calculate 24h price change
      const priceChange24h = vammMarket.initial_price > 0 
        ? currentPrice - vammMarket.initial_price
        : 0;
      
      const priceChangePercent24h = vammMarket.initial_price > 0 
        ? (priceChange24h / vammMarket.initial_price) * 100
        : 0;

      if (isMountedRef.current) {
        setPriceData({
          currentPrice,
          markPrice,
          fundingRate,
          priceChange24h,
          priceChangePercent24h,
          isLoading: false,
          error: null,
          lastUpdated: Date.now(),
          dataSource,
          vammAddress: vammMarket.vamm_address,
        });

        console.log(`🎯 Unified price updated for ${vammMarket.symbol}: $${currentPrice} (${dataSource})`);
      }

    } catch (error) {
      console.error('❌ Error updating unified price data:', error);
      
      if (isMountedRef.current) {
        setPriceData(prev => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch price data',
        }));
      }
    }
  }, [vammMarket, fetchContractMarkPrice]);

  // Manual refresh function
  const refreshPrice = useCallback(async () => {
    if (!isMountedRef.current) return;
    console.log('🔄 Manual unified price refresh triggered');
    await updatePriceData();
  }, [updatePriceData]);

  // Setup polling
  useEffect(() => {
    if (!enablePolling || !vammMarket?.vamm_address) return;

    const startPolling = () => {
      if (pollingInterval_ref.current) {
        clearInterval(pollingInterval_ref.current);
      }

      pollingInterval_ref.current = setInterval(() => {
        if (isMountedRef.current) {
          updatePriceData();
        } else {
          if (pollingInterval_ref.current) {
            clearInterval(pollingInterval_ref.current);
            pollingInterval_ref.current = null;
          }
        }
      }, pollingInterval);

      console.log(`🔄 Started unified price polling every ${pollingInterval}ms for ${vammMarket.symbol}`);
    };

    startPolling();

    return () => {
      if (pollingInterval_ref.current) {
        clearInterval(pollingInterval_ref.current);
        pollingInterval_ref.current = null;
        console.log(`🛑 Stopped unified price polling for ${vammMarket.symbol}`);
      }
    };
  }, [enablePolling, pollingInterval, vammMarket?.vamm_address, vammMarket?.symbol]);

  // Initialize and fetch initial price
  useEffect(() => {
    isMountedRef.current = true;
    
    const init = async () => {
      if (!vammMarket) return;
      
      console.log(`🚀 Initializing unified mark price for ${vammMarket.symbol}`);
      
      await initializeClient();
      
      if (isMountedRef.current) {
        await updatePriceData();
      }
    };

    init();

    return () => {
      console.log(`🧹 Cleaning up unified mark price for ${vammMarket?.symbol}`);
      isMountedRef.current = false;
      
      if (pollingInterval_ref.current) {
        clearInterval(pollingInterval_ref.current);
        pollingInterval_ref.current = null;
      }
    };
  }, [vammMarket]);

  // Memoized return value to prevent unnecessary re-renders
  return useMemo(() => ({
    // Current price data
    currentPrice: priceData.currentPrice,
    markPrice: priceData.markPrice,
    fundingRate: priceData.fundingRate,
    
    // Price change data
    priceChange24h: priceData.priceChange24h,
    priceChangePercent24h: priceData.priceChangePercent24h,
    
    // Status and metadata
    isLoading: priceData.isLoading,
    error: priceData.error,
    lastUpdated: priceData.lastUpdated,
    dataSource: priceData.dataSource,
    vammAddress: priceData.vammAddress,
    
    // Actions
    refreshPrice,
    
    // Compatibility aliases
    refreshMarkPrice: refreshPrice,
    refreshData: refreshPrice,
  }), [priceData, refreshPrice]);
} 