import { Metadata } from 'next';
import Script from 'next/script';
import { getMarketSeoData } from './_seo/marketSeoData';
import MarketJsonLd from './_seo/MarketJsonLd';
import MarketAboutSection from './_seo/MarketAboutSection';

interface TokenLayoutProps {
  params: Promise<{ symbol: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  const data = await getMarketSeoData(symbol);

  const primaryCategory = data.category[0];
  const categoryPhrase = primaryCategory ? `${primaryCategory} ` : '';

  const title = `Trade ${data.name} (${data.symbol}) Futures`;
  const description = data.found
    ? `Trade ${data.name} (${data.symbol}) futures on Dexetera — a permissionless ${categoryPhrase}prediction market currently at ${data.priceFormatted}, settling ${data.settlementDateFormatted}. View live ${data.symbol} odds, price charts, and settlement details.`
    : `Trade ${data.symbol} futures on Dexetera — a permissionless prediction market on any measurable metric. View live ${data.symbol} odds, price charts, and settlement details.`;

  const keywords = Array.from(
    new Set(
      [
        data.name,
        data.symbol,
        `trade ${data.symbol} futures`,
        `${data.symbol} futures`,
        `${data.symbol} prediction market`,
        `${data.symbol} odds`,
        `${data.symbol} settlement odds`,
        `${data.symbol} price`,
        'permissionless futures',
        'prediction market',
        'trade any metric',
        'Dexetera',
        ...data.category,
        ...data.category.map((c) => `${c} prediction market`),
      ].filter((k): k is string => Boolean(k && k.trim()))
    )
  );

  return {
    title,
    description,
    keywords,
    alternates: {
      canonical: `/token/${data.symbolParam}`,
    },
    openGraph: {
      title,
      description,
      url: data.pageUrl,
      siteName: 'Dexetera',
      images: [
        {
          url: data.ogImageUrl,
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
      images: [data.ogImageUrl],
      creator: '@dexeteralabs',
      site: '@dexeteralabs',
    },
  };
}

export default async function TokenLayout({ params, children }: TokenLayoutProps) {
  const { symbol } = await params;
  const data = await getMarketSeoData(symbol);

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
      <MarketJsonLd data={data} />
      {children}
      <MarketAboutSection data={data} />
    </>
  );
}
