// Main components
export { TrendingMarkets } from './TrendingMarkets';
export { MarketCard, AuctionCard } from './AuctionCard';
export { GradientBackground } from './GradientBackground';
export { NFTGraphic } from './NFTGraphics';

// Demo components
export { TrendingDemo, TrendingUsageExample } from './TrendingDemo';

// Types and interfaces
export type {
  MarketData,
  AuctionData,
  GradientType,
  NFTGraphicType,
  TrendingMarketsProps,
  MarketCardProps,
  AuctionCardProps,
  GradientBackgroundProps,
  NFTGraphicProps
} from './types';

// Design tokens
export { TrendingDesignTokens } from './types';

// Utilities and hooks
export { useMockMarketData, useMockAuctionData, generateRandomMarket, generateRandomAuction } from './useMockAuctionData'; 