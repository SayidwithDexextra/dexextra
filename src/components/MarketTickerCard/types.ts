export interface MarketTickerCardProps {
  id: string;
  title: string;
  categories: string[];
  price: number;
  currency?: string;
  imageUrl?: string;
  imageAlt?: string;
  onLongPosition?: () => void;
  onShortPosition?: () => void;
  className?: string;
  isDisabled?: boolean;
  // Additional props for orderbook markets
  marketStatus?: string;
  totalVolume?: number;
  totalTrades?: number;
  settlementDate?: string;
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
} 