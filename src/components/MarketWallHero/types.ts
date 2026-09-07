export interface MarketWallTile {
  /** market_id from MarketOverviewRow */
  id: string;
  /** market_identifier || symbol — used for the /token/[id] href */
  slug: string;
  /** name || symbol */
  name: string;
  /** formatted, e.g. "$29,686.80" */
  price: string;
  /** 24h change in percent; null renders as "—" */
  changePct: number | null;
  /** Computed once from changePct. null changePct defaults to 'up'. */
  direction: 'up' | 'down';
  /** optional price series for the sparkline; omit to keep the reserved 22px empty */
  series?: number[];
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
