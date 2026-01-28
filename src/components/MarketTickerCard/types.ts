export interface MarketTickerCardProps {
  id: string;
  title: string;
  categories: string[];
  price: number;
  currency?: string;
  imageUrl?: string;
  imageAlt?: string;
  onCardClick?: () => void;
  onLongPosition?: () => void;
  onShortPosition?: () => void;
  onWatchlistToggle?: () => void;
  className?: string;
  isDisabled?: boolean;
  isWatchlisted?: boolean;
  isWatchlistLoading?: boolean;
  isWatchlistDisabled?: boolean;
  // Additional props for orderbook markets
  marketStatus?: string;
  totalVolume?: number;
  totalTrades?: number;
  settlementDate?: string;
  metricId?: string;
  // Percentage change for inline card design
  priceChangePercent?: number;
}

export interface MarketTickerCardData {
  id: string;
  title: string;
  categories: string[];
  price: number;
  currency: string;
  imageUrl: string;
  imageAlt: string;
  // Additional data for orderbook markets
  marketStatus?: string;
  totalVolume?: number;
  totalTrades?: number;
  settlementDate?: string;
  metricId?: string;
  description?: string;
  // Percentage change for inline card design
  priceChangePercent?: number;
} 