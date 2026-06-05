import { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import ShareRedirect from './ShareRedirect';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price > 0) return `$${price.toPrecision(4)}`;
  return '$0.00';
}

function formatSettlementDate(dateStr: string): string {
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

function resolveVariant(value: string): 'image' | 'chart' {
  return value === 'chart' ? 'chart' : 'image';
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { symbol } = await params;
  const sp = await searchParams;
  const variant = resolveVariant(firstParam(sp.variant));

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dexetera.org';
  // Link unfurls use the landscape (1.91:1) image — the universal card size.
  const ogImageUrl = `${baseUrl}/api/og/market/${symbol}?variant=${variant}`;
  const pageUrl = `${baseUrl}/token/${symbol}`;

  let title = `${symbol.toUpperCase()} | Dexetera`;
  let description = `Trade ${symbol.toUpperCase()} on Dexetera's decentralized trading platform.`;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: market } = await supabase
      .from('markets')
      .select('id, name, symbol, last_trade_price, settlement_date, category')
      .or(`market_identifier.eq.${symbol},symbol.eq.${symbol}`)
      .eq('is_active', true)
      .single();

    if (market) {
      // mark_price lives on market_tickers, not markets.
      const { data: ticker } = await supabase
        .from('market_tickers')
        .select('mark_price')
        .eq('market_id', market.id)
        .maybeSingle();
      const price = (ticker?.mark_price ?? market.last_trade_price ?? 0) / 1_000_000;
      const settlementDate = market.settlement_date
        ? formatSettlementDate(market.settlement_date)
        : 'TBD';
      title = `${market.name || symbol.toUpperCase()} | Dexetera`;
      description = `${market.name || symbol.toUpperCase()} at ${formatPrice(price)}. Settlement ${settlementDate}. Trade any metric on Dexetera.`;
    }
  } catch (error) {
    console.error('Failed to fetch market metadata for share route:', error);
  }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'Dexetera',
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
      creator: '@dexeteralabs',
      site: '@dexeteralabs',
    },
  };
}

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { symbol } = await params;
  const sp = await searchParams;
  const variant = resolveVariant(firstParam(sp.variant));
  const query = variant === 'chart' ? '?variant=chart' : '';
  return <ShareRedirect href={`/token/${encodeURIComponent(symbol)}${query}`} />;
}
