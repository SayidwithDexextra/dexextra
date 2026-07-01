/**
 * Data model for the `/research` smart-money content layer.
 *
 * Unlike `/learn` (hand-written prose), research posts are *data-driven*: a
 * generator/CMS will assemble them from Polymarket-sourced data cached in
 * Supabase. So the body is modeled as an ordered list of typed `segments`
 * rather than a freeform React component. The renderer turns segments into
 * server-rendered HTML; the generator only ever produces this typed shape.
 *
 * Every numeric field is expected to trace back to a stored value (no
 * LLM-invented numbers) — see seo-newsletter-plan.json.
 */

export interface ResearchFaq {
  question: string;
  answer: string;
}

/** A reference to a market (internal Dexetera page or external source URL). */
export interface MarketRef {
  title: string;
  /** Absolute or relative URL. Optional — renders as plain text if absent. */
  url?: string;
}

export interface WhaleWatchItem {
  trader: string;
  traderUrl?: string;
  market: MarketRef;
  side: 'BUY' | 'SELL';
  outcome: string;
  usdNotional: number;
  /** Fill price as a probability in [0, 1]. */
  fillPrice: number;
  /** ISO timestamp. */
  timestamp: string;
}

export interface ConsensusItem {
  market: MarketRef;
  /** Current market price in [0, 1]. */
  marketPrice: number;
  /** Size-weighted smart-money implied price in [0, 1]. */
  smartMoneyImpliedPrice: number;
  /** Signed gap (smartMoney - market). */
  gap: number;
  sharpCount: number;
}

export interface ReversalItem {
  trader: string;
  traderUrl?: string;
  market: MarketRef;
  from: 'YES' | 'NO';
  to: 'YES' | 'NO';
  note?: string;
}

export interface ContrarianItem {
  market: MarketRef;
  publicFavorite: string;
  sharpSide: string;
  note?: string;
}

export interface TraderSpotlight {
  name: string;
  traderUrl?: string;
  specialty: string;
  /** Win rate in [0, 1]. */
  winRate: number;
  decided?: number;
  signatureWin?: string;
}

export interface CategoryHeatItem {
  category: string;
  /** Relative heat score (higher = hotter). */
  score: number;
  direction?: 'up' | 'down' | 'flat';
}

export interface ScorecardCall {
  market: MarketRef;
  /** The call as published, e.g. "YES @ 0.62". */
  call: string;
  result: 'WIN' | 'LOSS' | 'PENDING';
}

export interface SettledScorecard {
  priorIssue?: { title: string; slug: string };
  /** Hit rate in [0, 1]. */
  hitRate?: number;
  calls: ScorecardCall[];
}

interface SegmentBase {
  /** Stable anchor id (used for in-page links). */
  id: string;
  title: string;
  intro?: string;
}

export type ResearchSegment =
  | (SegmentBase & { type: 'whale_watch'; items: WhaleWatchItem[] })
  | (SegmentBase & { type: 'consensus_board'; items: ConsensusItem[] })
  | (SegmentBase & { type: 'reversals'; items: ReversalItem[] })
  | (SegmentBase & { type: 'contrarian_corner'; items: ContrarianItem[] })
  | (SegmentBase & { type: 'trader_of_week'; trader: TraderSpotlight })
  | (SegmentBase & { type: 'category_heat'; items: CategoryHeatItem[] })
  | (SegmentBase & { type: 'settled_scorecard'; scorecard: SettledScorecard })
  | (SegmentBase & { type: 'prose'; paragraphs: string[] });

export type ResearchSegmentType = ResearchSegment['type'];

export interface ResearchPost {
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  datePublished: string;
  dateModified?: string;
  /** Editorial label, e.g. "Smart Money Weekly". */
  category: string;
  keywords: string[];
  readingMinutes: number;
  issueNumber?: number;
  /** ISO timestamp of the underlying data snapshot (shown for trust/GEO). */
  dataAsOf: string;
  segments: ResearchSegment[];
  faqs?: ResearchFaq[];
  /** Generic attribution lines, e.g. "Aggregated from public prediction-market data". */
  sources?: string[];
  /**
   * Illustrative placeholder content. Sample posts render a visible banner and
   * are always excluded from indexing, regardless of the global index flag.
   */
  isSample?: boolean;
}
