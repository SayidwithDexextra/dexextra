/**
 * Shared shape + helpers for the ratio/indexed subset of markets.market_config.
 *
 * Keeps the three DB write paths (finalize, save, create) and the read paths
 * (settlement engine, token page) in agreement about how ratio/indexed market
 * metadata is stored off-chain.
 */

import type { MarketType } from './computeDerived';

export interface MarketLegConfig {
  label: string;
  sources: string[];
  readMethod?: string;
  valueAtCreation?: number;
}

export interface MarketBaselineConfig {
  A0: number;
  B0: number;
  V0: number;
  asOf: string;
}

/** The subset of market_config that describes a ratio/indexed market. */
export interface MarketTypeConfig {
  market_type: MarketType;
  operator: 'A' | 'A/B';
  base_value?: number;
  manifest_cid?: string;
  manifest_url?: string;
  manifest_sha256?: string;
  legs?: {
    numerator: MarketLegConfig;
    denominator?: MarketLegConfig;
  };
  baseline?: MarketBaselineConfig;
}

/**
 * Build the market_config subset to merge into the row at creation time.
 * Returns an empty object for single markets so callers can spread it safely.
 */
export function buildMarketTypeConfig(input: {
  marketType: MarketType;
  baseValue?: number;
  manifestCid?: string;
  manifestUrl?: string;
  manifestSha256?: string;
  legs?: MarketTypeConfig['legs'];
  baseline?: MarketBaselineConfig;
}): Partial<MarketTypeConfig> {
  if (input.marketType === 'single') {
    return { market_type: 'single', operator: 'A' };
  }
  return {
    market_type: input.marketType,
    operator: 'A/B',
    base_value: input.baseValue,
    manifest_cid: input.manifestCid,
    manifest_url: input.manifestUrl,
    manifest_sha256: input.manifestSha256,
    legs: input.legs,
    baseline: input.baseline,
  };
}

/**
 * Read the market type + config out of a markets row (market_type column with
 * market_config fallback). Defaults to single.
 */
export function readMarketTypeConfig(row: {
  market_type?: string | null;
  market_config?: Record<string, unknown> | null;
}): MarketTypeConfig {
  const cfg = (row.market_config || {}) as Record<string, unknown>;
  const type = (row.market_type ||
    (cfg.market_type as string) ||
    'single') as MarketType;
  return {
    market_type: type,
    operator: (cfg.operator as 'A' | 'A/B') || (type === 'single' ? 'A' : 'A/B'),
    base_value: cfg.base_value as number | undefined,
    manifest_cid: cfg.manifest_cid as string | undefined,
    manifest_url: cfg.manifest_url as string | undefined,
    manifest_sha256: cfg.manifest_sha256 as string | undefined,
    legs: cfg.legs as MarketTypeConfig['legs'] | undefined,
    baseline: cfg.baseline as MarketBaselineConfig | undefined,
  };
}

export function isTwoLegMarket(type: MarketType | string | null | undefined): boolean {
  return type === 'ratio' || type === 'indexed';
}
