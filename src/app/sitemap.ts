import type { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dexetera.org';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Regenerate at most once an hour so newly created markets get indexed
// without rebuilding, while keeping Supabase load minimal.
export const revalidate = 3600;

type MarketRow = {
  market_identifier: string | null;
  symbol: string | null;
  updated_at: string | null;
  created_at: string | null;
};

const STATIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
}> = [
  { path: '/', changeFrequency: 'daily', priority: 1.0 },
  { path: '/markets', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/explore', changeFrequency: 'daily', priority: 0.8 },
  { path: '/leaderboard', changeFrequency: 'daily', priority: 0.6 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/support', changeFrequency: 'monthly', priority: 0.3 },
];

async function fetchMarkets(): Promise<MarketRow[]> {
  if (!supabaseUrl || !supabaseKey) return [];
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('markets')
      .select('market_identifier, symbol, updated_at, created_at')
      .eq('is_active', true)
      .limit(50000);
    if (error) {
      console.error('sitemap: failed to fetch markets', error);
      return [];
    }
    return data ?? [];
  } catch (error) {
    console.error('sitemap: unexpected error fetching markets', error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${baseUrl}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const markets = await fetchMarkets();
  const seen = new Set<string>();
  const marketEntries: MetadataRoute.Sitemap = [];

  for (const market of markets) {
    const slug = market.market_identifier || market.symbol;
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const lastModified =
      market.updated_at || market.created_at || now.toISOString();

    marketEntries.push({
      url: `${baseUrl}/token/${encodeURIComponent(slug)}`,
      lastModified: new Date(lastModified),
      changeFrequency: 'hourly',
      priority: 0.7,
    });
  }

  return [...staticEntries, ...marketEntries];
}
