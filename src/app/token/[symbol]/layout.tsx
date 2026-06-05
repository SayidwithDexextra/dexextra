import { Metadata } from 'next';
import Script from 'next/script';
import { createClient } from '@supabase/supabase-js';

interface TokenLayoutProps {
  params: Promise<{ symbol: string }>;
  children: React.ReactNode;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) {
    return `$${price.toFixed(2)}`;
  }
  if (price > 0) {
    return `$${price.toPrecision(4)}`;
  }
  return '$0.00';
}

function formatSettlementDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'TBD';
  }
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dexetera.org';
  const ogImageUrl = `${baseUrl}/api/og/market/${symbol}`;
  
  let title = `${symbol.toUpperCase()} | Dexetera`;
  let description = `Trade ${symbol.toUpperCase()} on Dexetera's decentralized trading platform. View real-time prices, charts, and trading data.`;
  
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
      const priceFormatted = formatPrice(price);
      const settlementDate = market.settlement_date 
        ? formatSettlementDate(market.settlement_date) 
        : 'TBD';
      
      title = `${market.name || symbol.toUpperCase()} | Dexetera`;
      description = `${market.name || symbol.toUpperCase()} at ${priceFormatted}. Settlement ${settlementDate}. Trade any metric on Dexetera.`;
    }
  } catch (error) {
    console.error('Failed to fetch market metadata:', error);
  }
  
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${baseUrl}/token/${symbol}`,
      siteName: 'Dexetera',
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
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

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Preload TradingView scripts for faster chart initialization */}
      <Script
        id="tradingview-charting-library-preload"
        src="/charting_library/charting_library.js"
        strategy="beforeInteractive"
      />
      <Script
        id="tradingview-udf-datafeed-preload"
        src="/charting_library/datafeeds/udf/dist/bundle.js"
        strategy="beforeInteractive"
      />
      {children}
    </>
  );
} 