import { Metadata } from 'next';
import Script from 'next/script';

interface TokenLayoutProps {
  params: Promise<{ symbol: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  
  return {
    title: `${symbol.toUpperCase()} Token | Dexetera`,
    description: `Trade ${symbol.toUpperCase()} on Dexetera's decentralized trading platform. View real-time prices, charts, and trading data.`,
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