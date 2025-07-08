export interface TokenData {
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  marketCap: number;
  marketCapChange24h: number;
  volume24h: number;
  fullyDilutedValuation?: number;
  chain: string;
  logo?: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  circulating_supply?: number;
  total_supply?: number;
  max_supply?: number;
  created_at?: string;
  updated_at?: string;
}

export interface PriceData {
  timestamp: number;
  price: number;
  volume: number;
}

export interface ChartData {
  prices: PriceData[];
  timeframe: string;
}

export interface TradingPair {
  base: string;
  quote: string;
  price: number;
  volume24h: number;
  priceChange24h: number;
} 