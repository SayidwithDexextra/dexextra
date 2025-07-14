'use client';

import { useState, useEffect, useCallback } from 'react';

interface ETHPriceData {
  price: number;
  changePercent24h: number;
  isLoading: boolean;
  error?: string;
}

// Fallback data in case of API failures
const FALLBACK_ETH_DATA = {
  price: 2965, // Approximate ETH price
  changePercent24h: 0,
};

// Fetch ETH price using our API route to avoid CORS issues
async function fetchETHPrice() {
  try {
    const response = await fetch('/api/eth-price', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(`API error: ${data.error}`);
    }
    
    return {
      price: data.price || 0,
      changePercent24h: data.changePercent24h || 0,
    };
  } catch (error) {
    // Only log detailed errors in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ETH Price fetch error:', {
        error: error instanceof Error ? error.message : error,
        timestamp: new Date().toISOString(),
        url: '/api/eth-price'
      });
    }
    throw error;
  }
}

export const useETHPrice = () => {
  const [ethData, setEthData] = useState<ETHPriceData>({
    price: 0,
    changePercent24h: 0,
    isLoading: true,
  });

  const fetchPrice = useCallback(async (retryCount = 0) => {
    try {
      const { price, changePercent24h } = await fetchETHPrice();
      setEthData({
        price,
        changePercent24h,
        isLoading: false,
      });
    } catch (error) {
      // Retry up to 3 times with exponential backoff
      if (retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        setTimeout(() => fetchPrice(retryCount + 1), delay);
        return;
      }
      
      // After all retries failed, use fallback data
      setEthData({
        price: FALLBACK_ETH_DATA.price,
        changePercent24h: FALLBACK_ETH_DATA.changePercent24h,
        isLoading: false,
        error: process.env.NODE_ENV === 'development' 
          ? error instanceof Error ? error.message : 'Failed to fetch ETH price'
          : undefined, // Don't show error in production, just use fallback
      });
    }
  }, []);

  useEffect(() => {
    // Fetch price immediately
    fetchPrice();

    // Set up interval to fetch price every 2 minutes to reduce API calls
    const interval = setInterval(() => fetchPrice(), 120000);

    return () => clearInterval(interval);
  }, [fetchPrice]);

  return ethData;
}; 