import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const SEO_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || 'https://dexetera.org';

export interface MarketSeoData {
  /** The raw route param (used for URLs / OG image even when the market isn't found). */
  symbolParam: string;
  found: boolean;
  id: string | null;
  name: string;
  symbol: string;
  marketIdentifier: string | null;
  description: string | null;
  category: string[];
  price: number;
  priceFormatted: string;
  settlementDateRaw: string | null;
  settlementDateFormatted: string;
  totalVolume: number | null;
  totalVolumeFormatted: string | null;
  marketStatus: string | null;
  statusLabel: string;
  updatedAt: string | null;
  createdAt: string | null;
  pageUrl: string;
  ogImageUrl: string;
}

export function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price > 0) return `$${price.toPrecision(4)}`;
  return '$0.00';
}

export function formatSettlementDate(dateStr: string | null): string {
  if (!dateStr) return 'TBD';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return 'TBD';
  }
}

function formatVolume(volume: number | null): string | null {
  if (volume == null || !Number.isFinite(volume) || volume <= 0) return null;
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(1)}K`;
  return `$${volume.toFixed(0)}`;
}

function normalizeCategory(category: unknown): string[] {
  if (Array.isArray(category)) {
    return category.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
  }
  if (typeof category === 'string' && category.trim().length > 0) return [category];
  return [];
}

function statusToLabel(status: string | null): string {
  switch ((status || '').toUpperCase()) {
    case 'ACTIVE':
      return 'Live';
    case 'PENDING':
    case 'DEPLOYING':
      return 'Pending';
    case 'SETTLEMENT_REQUESTED':
      return 'In settlement';
    case 'SETTLED':
      return 'Settled';
    case 'PAUSED':
      return 'Paused';
    default:
      return 'Inactive';
  }
}

/**
 * Server-only, request-deduped fetch of the data needed for a market's SEO
 * surface (metadata, JSON-LD, and the rendered "About" section). Wrapped in
 * React `cache()` so `generateMetadata` and the layout body share one query.
 */
export const getMarketSeoData = cache(
  async (symbolParam: string): Promise<MarketSeoData> => {
    const symbolUpper = symbolParam.toUpperCase();
    const pageUrl = `${SEO_BASE_URL}/token/${encodeURIComponent(symbolParam)}`;
    const ogImageUrl = `${SEO_BASE_URL}/api/og/market/${encodeURIComponent(symbolParam)}`;

    const fallback: MarketSeoData = {
      symbolParam,
      found: false,
      id: null,
      name: symbolUpper,
      symbol: symbolUpper,
      marketIdentifier: null,
      description: null,
      category: [],
      price: 0,
      priceFormatted: '$0.00',
      settlementDateRaw: null,
      settlementDateFormatted: 'TBD',
      totalVolume: null,
      totalVolumeFormatted: null,
      marketStatus: null,
      statusLabel: 'Inactive',
      updatedAt: null,
      createdAt: null,
      pageUrl,
      ogImageUrl,
    };

    if (!supabaseUrl || !supabaseKey) return fallback;

    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data: market } = await supabase
        .from('markets')
        .select(
          'id, name, symbol, market_identifier, description, last_trade_price, settlement_date, category, total_volume, market_status, updated_at, created_at'
        )
        .or(`market_identifier.eq.${symbolParam},symbol.eq.${symbolParam}`)
        .eq('is_active', true)
        .single();

      if (!market) return fallback;

      const { data: ticker } = await supabase
        .from('market_tickers')
        .select('mark_price')
        .eq('market_id', market.id)
        .maybeSingle();

      const price = (ticker?.mark_price ?? market.last_trade_price ?? 0) / 1_000_000;

      return {
        symbolParam,
        found: true,
        id: market.id ?? null,
        name: market.name || symbolUpper,
        symbol: market.symbol || symbolUpper,
        marketIdentifier: market.market_identifier ?? null,
        description: market.description ?? null,
        category: normalizeCategory(market.category),
        price,
        priceFormatted: formatPrice(price),
        settlementDateRaw: market.settlement_date ?? null,
        settlementDateFormatted: formatSettlementDate(market.settlement_date ?? null),
        totalVolume: market.total_volume ?? null,
        totalVolumeFormatted: formatVolume(market.total_volume ?? null),
        marketStatus: market.market_status ?? null,
        statusLabel: statusToLabel(market.market_status ?? null),
        updatedAt: market.updated_at ?? null,
        createdAt: market.created_at ?? null,
        pageUrl,
        ogImageUrl,
      };
    } catch (error) {
      console.error('getMarketSeoData: failed to fetch market', error);
      return fallback;
    }
  }
);
