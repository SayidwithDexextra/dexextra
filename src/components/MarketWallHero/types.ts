export interface MarketWallTile {
  /** market_id from MarketOverviewRow */
  id: string;
  /** market_identifier || symbol — used for the /token/[id] href */
  slug: string;
  /** symbol, falling back to market_identifier. Shown as SYMBOL/USDC */
  symbol: string;
  /** name || symbol */
  name: string;
  /** first category that is not "Top Picks" */
  category?: string;
  /** formatted, e.g. "$29,686.80" */
  price: string;
  /** 24h change in percent; null renders as "—" */
  changePct: number | null;
  /** Computed once from changePct. null changePct defaults to 'up'. */
  direction: 'up' | 'down';
  /** price series for the sparkline, oldest to newest */
  series?: number[];
  /** markets.settlement_date; omitted when the row has none */
  settlementDate?: string | null;
}

export interface MarketWallHeroProps {
  tiles: MarketWallTile[];
  /** total active market count for the panel badge; defaults to tiles.length */
  totalMarkets?: number;
  isLoading?: boolean;
  /** how many tiles to render — 6 gives 3x2 at desktop */
  tileCount?: number;
  className?: string;
  /** copy overrides; defaults match the design */
  title?: string;
  subtitle?: string;
  eyebrow?: string;
}
