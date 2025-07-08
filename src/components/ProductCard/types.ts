export interface ProductCardProps {
  id: string;
  title: string;
  subtitle?: string;
  author: string;
  price: number;
  currency?: string;
  imageUrl: string;
  imageAlt?: string;
  href?: string;
  onCardClick?: (id: string) => void;
  onActionClick?: (id: string) => void;
  onViewMarket?: (productData: ProductCardData) => void;
  className?: string;
}

export interface ProductCardData {
  id: string;
  title: string;
  subtitle?: string;
  author: string;
  price: number;
  currency?: string;
  imageUrl: string;
  imageAlt?: string;
  href?: string;
}

export interface ProductCardVariant {
  backgroundColor: string;
  textColor: string;
  accentColor?: string;
}

export interface ProductCardConfig {
  showCurrency: boolean;
  showAuthor: boolean;
  showSubtitle: boolean;
  actionText: string;
  pricePrefix: string;
} 