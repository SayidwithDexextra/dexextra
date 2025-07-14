'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { VAMMMarket } from './useVAMMMarkets';

const VAMM_ABI = [
  "function getMarkPrice() external view returns (uint256)",
  "function getFundingRate() external view returns (int256)",
];

export interface VAMMPriceData {
  markPrice: string;
  fundingRate: string;
  isLoading: boolean;
  error: string | null;
  refreshData: () => Promise<void>;
}

export interface VAMMPriceDataOptions {
  enablePolling?: boolean;
  pollingInterval?: number;
}

export function useVAMMPriceData(
  vammMarket?: VAMMMarket, 
  options?: VAMMPriceDataOptions
): VAMMPriceData {
  const { 
    enablePolling = false, 
    pollingInterval = 30000 
  } = options || {};

  const [priceData, setPriceData] = useState<Omit<VAMMPriceData, 'refreshData'>>({
    markPrice: '0',
    fundingRate: '0',
    isLoading: false,
    error: null,
  });

  const vammContract = useRef<ethers.Contract | null>(null);
  const isInitialized = useRef(false);

  const initializeContract = useCallback(async () => {
    if (!vammMarket?.vamm_address || !window.ethereum) {
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      vammContract.current = new ethers.Contract(
        vammMarket.vamm_address,
        VAMM_ABI,
        provider
      );
      isInitialized.current = true;
      console.log('✅ VAMM price contract initialized:', vammMarket.vamm_address);
    } catch (error) {
      console.error('❌ Error initializing VAMM price contract:', error);
      setPriceData(prev => ({ 
        ...prev, 
        error: 'Failed to initialize price contract' 
      }));
    }
  }, [vammMarket?.vamm_address]);

  const fetchPriceData = useCallback(async () => {
    if (!isInitialized.current || !vammContract.current) {
      return;
    }

    try {
      setPriceData(prev => ({ ...prev, isLoading: true, error: null }));

      const [markPrice, fundingRate] = await Promise.allSettled([
        vammContract.current.getMarkPrice(),
        vammContract.current.getFundingRate()
      ]);

      const markPriceValue = markPrice.status === 'fulfilled' ? markPrice.value : BigInt(0);
      const fundingRateValue = fundingRate.status === 'fulfilled' ? fundingRate.value : BigInt(0);

      console.log('markPriceValue: ', markPriceValue);
      console.log('fundingRateValue: ', fundingRateValue);

      const newMarkPrice = ethers.formatEther(markPriceValue);
      const newFundingRate = fundingRateValue.toString();

      console.log('newMarkPrice: ', newMarkPrice);
      console.log('newFundingRate: ', newFundingRate);

      // Check if price has actually changed to prevent unnecessary updates
      setPriceData(prev => {
        const priceChanged = prev.markPrice !== newMarkPrice;
        const fundingChanged = prev.fundingRate !== newFundingRate;
        
        if (priceChanged || fundingChanged) {
          console.log('📊 Price data updated:', {
            markPrice: {
              old: prev.markPrice,
              new: newMarkPrice,
              changed: priceChanged
            },
            fundingRate: {
              old: prev.fundingRate,
              new: newFundingRate,
              changed: fundingChanged
            }
          });
        } else {
          console.log('📊 Price data unchanged, skipping update');
        }

        return {
          markPrice: newMarkPrice,
          fundingRate: newFundingRate,
          isLoading: false,
          error: null,
        };
      });

    } catch (error) {
      console.error('❌ Error fetching VAMM price data:', error);
      setPriceData(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to fetch price data',
        isLoading: false,
      }));
    }
  }, []);

  // Initialize contract when market changes
  useEffect(() => {
    isInitialized.current = false;
    vammContract.current = null;
    initializeContract();
  }, [initializeContract]);

  // Fetch initial data when contract is ready
  useEffect(() => {
    if (isInitialized.current && vammContract.current) {
      fetchPriceData();
    }
  }, [fetchPriceData]);

  // Set up polling if enabled
  useEffect(() => {
    if (!enablePolling || !isInitialized.current || !vammContract.current) return;

    const interval = setInterval(fetchPriceData, pollingInterval);
    return () => clearInterval(interval);
  }, [enablePolling, pollingInterval, fetchPriceData]);

  // Manual refresh function
  const refreshData = useCallback(async () => {
    console.log('🔄 Manual price refresh triggered');
    await fetchPriceData();
  }, [fetchPriceData]);

  return {
    ...priceData,
    refreshData,
  };
} 