import React from 'react';

export interface MarketData {
  id: string;
  marketName: string;
  marketSymbol: string;
  icon: string | React.ReactNode;
  longPrice: string;
  shortPrice: string;
  percentChange: number;
  gradientType: GradientType;
  nftGraphicType?: NFTGraphicType;
  nftGraphic?: React.ReactNode;
  onClick?: () => void;
}

// Keep AuctionData for backward compatibility
export interface AuctionData extends MarketData {
  username: string;
  price: string;
}

export type GradientType = 'card1' | 'card2' | 'card3' | 'card4';

export type NFTGraphicType = 'sphere' | 'crystal' | 'fluid' | 'geometric';

export interface TrendingMarketsProps {
  markets: MarketData[];
  className?: string;
  title?: string;
}

// Keep AuctionData version for backward compatibility
export interface TrendingMarketsPropsLegacy {
  auctions: AuctionData[];
  className?: string;
  title?: string;
}

export interface MarketCardProps {
  marketName: string;
  marketSymbol: string;
  icon: string | React.ReactNode;
  longPrice: string;
  shortPrice: string;
  percentChange: number;
  gradientType: GradientType;
  nftGraphic?: React.ReactNode;
  onClick?: () => void;
}

// Keep AuctionCardProps for backward compatibility
export interface AuctionCardProps {
  username: string;
  price: string;
  gradientType: GradientType;
  nftGraphic?: React.ReactNode;
  onClick?: () => void;
}

export interface GradientBackgroundProps {
  type: GradientType;
  className?: string;
}

export interface NFTGraphicProps {
  type: NFTGraphicType;
  className?: string;
}

// Design system color tokens from Trending.json
export const TrendingDesignTokens = {
  colors: {
    backgrounds: {
      section: '#0F0F0F',
      gradients: {
        card1: ['#8B5CF6', '#F59E0B', '#3B82F6'],
        card2: ['#6366F1', '#8B5CF6', '#10B981'],
        card3: ['#8B5CF6', '#EC4899', '#F59E0B'],
        card4: ['#F59E0B', '#EC4899', '#3B82F6']
      }
    },
    text: {
      primary: '#FFFFFF',
      secondary: '#E5E7EB',
      accent: '#F3F4F6'
    }
  },
  typography: {
    sectionTitle: {
      fontSize: '24px',
      fontWeight: '600',
      lineHeight: '1.2'
    },
    cardUsername: {
      fontSize: '14px',
      fontWeight: '500',
      opacity: 0.9
    },
    cardPrice: {
      fontSize: '16px',
      fontWeight: '600'
    }
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '20px',
    xl: '24px',
    xxl: '32px'
  },
  effects: {
    borderRadius: '16px',
    cardHoverTransform: 'translateY(-4px)',
    transition: '0.2s ease-in-out'
  }
} as const; 