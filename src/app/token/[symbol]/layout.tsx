import { Metadata } from 'next';

interface TokenLayoutProps {
  params: Promise<{ symbol: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  
  return {
    title: `${symbol.toUpperCase()} Token | Dexetra`,
    description: `Trade ${symbol.toUpperCase()} on Dexetra's decentralized trading platform. View real-time prices, charts, and trading data.`,
  };
}

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
} 