export interface TokenData {
  icon: string;
  name: string;
  price: string;
  change: number;
  isPositive: boolean;
  symbol?: string;
  market_identifier?: string;
}

export interface MarketData {
  marketCap: string;
  marketCapChange: number;
  tradingVolume: string;
  chartData?: number[];
}

export interface SectionData {
  title: string;
  icon: string;
  tokens: TokenData[];
  viewMoreLink: string;
}

export interface ChartData {
  data: number[];
  color: string;
  width: number;
  height: number;
} 