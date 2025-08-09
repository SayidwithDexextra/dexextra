'use client';

import { useState, useEffect } from 'react';
import { MarketData, AuctionData, GradientType, NFTGraphicType } from './types';

const mockMarketData: MarketData[] = [
  {
    id: '1',
    marketName: 'Bitcoin',
    marketSymbol: 'BTC',
    icon: '₿',
    longPrice: '$0.4521',
    shortPrice: '$0.5479',
    percentChange: 12.7,
    gradientType: 'card1',
    nftGraphicType: 'sphere'
  },
  {
    id: '2',
    marketName: 'Ethereum',
    marketSymbol: 'ETH',
    icon: '♦',
    longPrice: '$0.6123',
    shortPrice: '$0.3877',
    percentChange: -5.2,
    gradientType: 'card2',
    nftGraphicType: 'crystal'
  },
  {
    id: '3',
    marketName: 'Solana',
    marketSymbol: 'SOL',
    icon: '◆',
    longPrice: '$0.7890',
    shortPrice: '$0.2110',
    percentChange: 45.3,
    gradientType: 'card3',
    nftGraphicType: 'fluid'
  },
  {
    id: '4',
    marketName: 'Bedrock',
    marketSymbol: 'BR',
    icon: '🔷',
    longPrice: '$0.1281',
    shortPrice: '$0.8719',
    percentChange: 60.7,
    gradientType: 'card4',
    nftGraphicType: 'geometric'
  }
];

// Legacy auction data for backward compatibility
const mockAuctionData: AuctionData[] = mockMarketData.map(market => ({
  ...market,
  username: `@${market.marketSymbol.toLowerCase()}`,
  price: market.longPrice
}));

interface UseMockMarketDataOptions {
  count?: number;
  includeClickHandlers?: boolean;
}

// New hook for market data
export const useMockMarketData = (options: UseMockMarketDataOptions = {}) => {
  const { count = 4, includeClickHandlers = false } = options;
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate API loading delay
    const timer = setTimeout(() => {
      const slicedData = mockMarketData.slice(0, count);
      
      const processedData = slicedData.map(market => ({
        ...market,
        onClick: includeClickHandlers 
          ? () =>  console.log(`Clicked market: ${market.marketName} (${market.marketSymbol}) - Long: ${market.longPrice}, Short: ${market.shortPrice}`)
          : undefined
      }));

      setMarkets(processedData);
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [count, includeClickHandlers]);

  const refreshData = () => {
    setLoading(true);
    // Simulate shuffle/refresh
    setTimeout(() => {
      const shuffled = [...mockMarketData]
        .sort(() => Math.random() - 0.5)
        .slice(0, count);
      setMarkets(shuffled);
      setLoading(false);
    }, 300);
  };

  const addMarket = (market: Omit<MarketData, 'id'>) => {
    const newMarket: MarketData = {
      ...market,
      id: Date.now().toString()
    };
    setMarkets(prev => [...prev, newMarket]);
  };

  const removeMarket = (id: string) => {
    setMarkets(prev => prev.filter(market => market.id !== id));
  };

  return {
    markets,
    loading,
    refreshData,
    addMarket,
    removeMarket
  };
};

// Legacy hook for backward compatibility
export const useMockAuctionData = (options: UseMockMarketDataOptions = {}) => {
  const { count = 4, includeClickHandlers = false } = options;
  const [auctions, setAuctions] = useState<AuctionData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate API loading delay
    const timer = setTimeout(() => {
      const slicedData = mockAuctionData.slice(0, count);
      
      const processedData = slicedData.map(auction => ({
        ...auction,
        onClick: includeClickHandlers 
          ? () =>  console.log(`Clicked market: ${auction.username} - ${auction.price}`)
          : undefined
      }));

      setAuctions(processedData);
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [count, includeClickHandlers]);

  const refreshData = () => {
    setLoading(true);
    // Simulate shuffle/refresh
    setTimeout(() => {
      const shuffled = [...mockAuctionData]
        .sort(() => Math.random() - 0.5)
        .slice(0, count);
      setAuctions(shuffled);
      setLoading(false);
    }, 300);
  };

  const addAuction = (auction: Omit<AuctionData, 'id'>) => {
    const newAuction: AuctionData = {
      ...auction,
      id: Date.now().toString()
    };
    setAuctions(prev => [...prev, newAuction]);
  };

  const removeAuction = (id: string) => {
    setAuctions(prev => prev.filter(auction => auction.id !== id));
  };

  return {
    auctions,
    loading,
    refreshData,
    addAuction,
    removeAuction
  };
};

// Helper function to generate random market data
export const generateRandomMarket = (): Omit<MarketData, 'id'> => {
  const markets = [
    { name: 'Bitcoin', symbol: 'BTC', icon: '₿' },
    { name: 'Ethereum', symbol: 'ETH', icon: '♦' },
    { name: 'Solana', symbol: 'SOL', icon: '◆' },
    { name: 'Cardano', symbol: 'ADA', icon: '🔺' },
    { name: 'Polygon', symbol: 'MATIC', icon: '🔷' },
    { name: 'Avalanche', symbol: 'AVAX', icon: '🔶' },
    { name: 'Chainlink', symbol: 'LINK', icon: '🔗' },
    { name: 'Polkadot', symbol: 'DOT', icon: '⚪' }
  ];
  
  const gradientTypes: GradientType[] = ['card1', 'card2', 'card3', 'card4'];
  const nftTypes: NFTGraphicType[] = ['sphere', 'crystal', 'fluid', 'geometric'];
  
  const market = markets[Math.floor(Math.random() * markets.length)];
  const longPrice = (Math.random() * 0.8 + 0.1).toFixed(4);
  const shortPrice = (1 - parseFloat(longPrice)).toFixed(4);
  const percentChange = (Math.random() * 100 - 50); // -50% to +50%
  
  return {
    marketName: market.name,
    marketSymbol: market.symbol,
    icon: market.icon,
    longPrice: `$${longPrice}`,
    shortPrice: `$${shortPrice}`,
    percentChange: parseFloat(percentChange.toFixed(1)),
    gradientType: gradientTypes[Math.floor(Math.random() * gradientTypes.length)],
    nftGraphicType: nftTypes[Math.floor(Math.random() * nftTypes.length)]
  };
};

// Helper function to generate random auction data (legacy)
export const generateRandomAuction = (): Omit<AuctionData, 'id'> => {
  const market = generateRandomMarket();
  return {
    ...market,
    username: `@${market.marketSymbol.toLowerCase()}`,
    price: market.longPrice
  };
}; 