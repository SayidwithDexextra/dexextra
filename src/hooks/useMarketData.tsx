'use client';

import { useState, useEffect, useCallback } from 'react';

interface MarketData {
  marketCap: string;
  marketCapChange: number;
  tradingVolume: string;
  isLoading: boolean;
  error: string | null;
}



const useMarketData = () => {
  const [marketData, setMarketData] = useState<MarketData>({
    marketCap: '$3,415,977,522,715',
    marketCapChange: -3.8,
    tradingVolume: '$86,016,835,572',
    isLoading: true,
    error: null,
  });

  const formatCurrency = (value: number): string => {
    // Return exact number with comma formatting
    return `$${value.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    })}`;
  };

  const fetchMarketData = useCallback(async () => {
    try {
      setMarketData(prev => ({ ...prev, isLoading: true, error: null }));
      
      const response = await fetch('/api/market-data', {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`API error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      const marketCap = formatCurrency(data.marketCap);
      const tradingVolume = formatCurrency(data.tradingVolume);
      const marketCapChange = data.marketCapChange;

      setMarketData({
        marketCap,
        marketCapChange,
        tradingVolume,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      console.error('Error fetching market data:', error);
      setMarketData(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch market data',
      }));
    }
  }, []);

  useEffect(() => {
    fetchMarketData();
    
    // Update market data every 5 minutes
    const interval = setInterval(fetchMarketData, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [fetchMarketData]);

  return { ...marketData, refetch: fetchMarketData };
};

export default useMarketData; 