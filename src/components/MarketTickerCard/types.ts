export interface MarketTickerCardProps {
  id: string;
  title: string;
  categories: string[];
  price: number;
  currency?: string;
  imageUrl?: string;
  imageAlt?: string;
  onViewProduct?: () => void;
  onViewDemo?: () => void;
  className?: string;
  isDisabled?: boolean;
}

export interface MarketTickerCardData {
  id: string;
  title: string;
  categories: string[];
  price: number;
  currency: string;
  imageUrl: string;
  imageAlt: string;
} 