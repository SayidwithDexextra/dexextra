'use client';

import { useState, useEffect, useCallback } from 'react';

interface ETHPriceData {
  price: number;
  changePercent24h: number;
  isLoading: boolean;
  error?: string;
}

// Fetch ETH price using our API route to avoid CORS issues
async function fetchETHPrice() {
  try {
    const response = await fetch('/api/eth-price');
    if (!response.ok) {
      throw new Error('Failed to fetch ETH price');
    }
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    return {
      price: data.price || 0,
      changePercent24h: data.changePercent24h || 0,
    };
  } catch (error) {
    console.error('Error fetching ETH price:', error);
    throw error;
  }
}

export const useETHPrice = () => {
  const [ethData, setEthData] = useState<ETHPriceData>({
    price: 0,
    changePercent24h: 0,
    isLoading: true,
  });

  const fetchPrice = useCallback(async () => {
    try {
      const { price, changePercent24h } = await fetchETHPrice();
      setEthData({
        price,
        changePercent24h,
        isLoading: false,
      });
    } catch (error) {
      setEthData(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch ETH price',
      }));
    }
  }, []);

  useEffect(() => {
    // Fetch price immediately
    fetchPrice();

    // Set up interval to fetch price every 60 seconds
    const interval = setInterval(fetchPrice, 60000);

    return () => clearInterval(interval);
  }, [fetchPrice]);

  return ethData;
}; 