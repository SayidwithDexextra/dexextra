"use client";

import { useMemo } from 'react';
import { MarketTickerCardData } from './types';

/**
 * Mock data hook for MarketTickerCard component
 * Provides sample market data for testing and development
 */
export const useMockMarketTickerData = (): MarketTickerCardData[] => {
  const mockData: MarketTickerCardData[] = useMemo(() => [
    {
      id: '1',
      title: 'Tesla Stock Price',
      categories: ['Tech', 'Automotive'],
      price: 245.67,
      currency: '$',
      imageUrl: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=400&h=300&fit=crop',
      imageAlt: 'Tesla Model S',
      marketStatus: 'active',
      totalVolume: 15420000,
      totalTrades: 8543,
      settlementDate: '2024-03-15'
    },
    {
      id: '2',
      title: 'Bitcoin Price Target',
      categories: ['Crypto', 'Finance'],
      price: 67890.12,
      currency: '$',
      imageUrl: 'https://images.unsplash.com/photo-1518544866330-4e716499beea?w=400&h=300&fit=crop',
      imageAlt: 'Bitcoin cryptocurrency',
      marketStatus: 'active',
      totalVolume: 2340000,
      totalTrades: 12876,
      settlementDate: '2024-03-20'
    },
    {
      id: '3',
      title: 'Apple Earnings Beat',
      categories: ['Tech', 'Earnings'],
      price: 189.43,
      currency: '$',
      imageUrl: 'https://images.unsplash.com/photo-1561154464-82e9adf32764?w=400&h=300&fit=crop',
      imageAlt: 'Apple iPhone',
      marketStatus: 'active',
      totalVolume: 8750000,
      totalTrades: 5432,
      settlementDate: '2024-03-18'
    },
    {
      id: '4',
      title: 'Gold Futures High',
      categories: ['Commodities', 'Precious Metals'],
      price: 2045.80,
      currency: '$',
      imageUrl: 'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=400&h=300&fit=crop',
      imageAlt: 'Gold bars',
      marketStatus: 'active',
      totalVolume: 1250000,
      totalTrades: 3421,
      settlementDate: '2024-03-25'
    },
    {
      id: '5',
      title: 'Nvidia AI Surge',
      categories: ['Tech', 'AI'],
      price: 875.30,
      currency: '$',
      imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=400&h=300&fit=crop',
      imageAlt: 'Computer graphics card',
      marketStatus: 'active',
      totalVolume: 5680000,
      totalTrades: 9876,
      settlementDate: '2024-03-22'
    },
    {
      id: '6',
      title: 'Oil Price Spike',
      categories: ['Energy', 'Commodities'],
      price: 85.40,
      currency: '$',
      imageUrl: 'https://images.unsplash.com/photo-1524946550327-c0ce2c6e2f65?w=400&h=300&fit=crop',
      imageAlt: 'Oil drilling platform',
      marketStatus: 'active',
      totalVolume: 3450000,
      totalTrades: 4567,
      settlementDate: '2024-03-30'
    }
  ], []);

  return mockData;
};

export default useMockMarketTickerData;


