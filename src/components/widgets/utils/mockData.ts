import { TokenData, MarketData, SectionData } from '../types';

export const mockMarketData: MarketData = {
  marketCap: '$3,415,977,522,715',
  marketCapChange: -3.8,
  tradingVolume: '$86,016,835,572',
  chartData: [100, 120, 90, 110, 95, 85, 105, 115, 100, 90, 95, 100]
};

export const mockTrendingTokens: TokenData[] = [
  {
    icon: '🟡',
    name: 'Viction',
    price: '$0.3592',
    change: 126.7,
    isPositive: true,
    symbol: 'VIC'
  },
  {
    icon: '🟡',
    name: 'Bonk',
    price: '$0.000022',
    change: 0.8,
    isPositive: false,
    symbol: 'BONK'
  },
  {
    icon: '⚫',
    name: 'Hyperliquid',
    price: '$39.21',
    change: 0.6,
    isPositive: false,
    symbol: 'HYPE'
  }
];

export const mockTopGainerTokens: TokenData[] = [
  {
    icon: '🟡',
    name: 'Viction',
    price: '$0.3592',
    change: 126.7,
    isPositive: true,
    symbol: 'VIC'
  },
  {
    icon: '🟣',
    name: 'MemeCore',
    price: '$0.161',
    change: 88.9,
    isPositive: true,
    symbol: 'MEME'
  },
  {
    icon: '🔴',
    name: 'Supra',
    price: '$0.002831',
    change: 31.0,
    isPositive: true,
    symbol: 'SUPRA'
  }
];

export const trendingSection: SectionData = {
  title: 'Trending',
  icon: '🔥',
  tokens: mockTrendingTokens,
  viewMoreLink: '/trending'
};

export const topGainersSection: SectionData = {
  title: 'Top Gainers',
  icon: '🚀',
  tokens: mockTopGainerTokens,
  viewMoreLink: '/top-gainers'
};

// Chart data for market overview
export const marketCapChartData = [100, 120, 90, 110, 95, 85, 105, 115, 100, 90, 95, 100];
export const tradingVolumeChartData = [80, 85, 70, 90, 85, 95, 90, 100, 95, 85, 90, 95]; 