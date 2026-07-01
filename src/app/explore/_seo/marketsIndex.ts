import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface MarketIndexEntry {
  slug: string;
  name: string;
  symbol: string;
  category: string[];
}

function normalizeCategory(category: unknown): string[] {
  if (Array.isArray(category)) {
    return category.filter(
      (c): c is string => typeof c === 'string' && c.trim().length > 0
    );
  }
  if (typeof category === 'string' && category.trim().length > 0) {
    return [category];
  }
  return [];
}

/**
 * Server-only, request-deduped fetch of every active market, ordered by volume.
 * Powers the crawlable "All markets" directory so each `/token/[symbol]` page has
 * an internal link from a high-authority index page (no orphan pages).
 */
export const getMarketsIndex = cache(async (): Promise<MarketIndexEntry[]> => {
  if (!supabaseUrl || !supabaseKey) return [];
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('markets')
      .select('name, symbol, market_identifier, category, total_volume')
      .eq('is_active', true)
      .order('total_volume', { ascending: false, nullsFirst: false })
      .limit(2000);

    if (error || !data) {
      if (error) console.error('getMarketsIndex: failed to fetch markets', error);
      return [];
    }

    const seen = new Set<string>();
    const entries: MarketIndexEntry[] = [];
    for (const m of data) {
      const slug = m.market_identifier || m.symbol;
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      entries.push({
        slug,
        name: m.name || m.symbol || slug,
        symbol: m.symbol || slug,
        category: normalizeCategory(m.category),
      });
    }
    return entries;
  } catch (error) {
    console.error('getMarketsIndex: unexpected error', error);
    return [];
  }
});
