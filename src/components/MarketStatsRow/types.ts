export interface MarketListItem {
  id: string;
  slug: string;
  name: string;
  price: string;
  volume24h: string;
  /** Unformatted mark price; 0 when unknown. */
  priceNum: number;
  /** Unformatted 24h volume; 0 when unknown. */
  volumeNum: number;
  /** 24h change in percent; null when rankings have no tick data */
  changePct: number | null;
  /** Computed once from changePct. null changePct defaults to 'up'. */
  direction: 'up' | 'down';
}

export interface MarketStat {
  label: string;
  value: string;
  delta?: string;
  direction: 'up' | 'down';
  series: number[];
}

export type MarketListValueField = 'price' | 'volume24h';
