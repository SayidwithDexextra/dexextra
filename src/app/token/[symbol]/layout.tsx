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

  const title = `${data.name} | Dexetera`;
  const description = data.found
    ? `${data.name} at ${data.priceFormatted}. Settlement ${data.settlementDateFormatted}. Trade any metric on Dexetera.`
    : `Trade ${data.symbol} on Dexetera's decentralized trading platform. View real-time prices, charts, and trading data.`;

  return {
    title,
    description,
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
