import { TrendingDemo } from "@/components/trending";
import MarketTickerCardDemo from "@/components/MarketTickerCard/demo";
import TopPerformerDualDemo from "@/components/TopPerformer/TopPerformerDualDemo";
import CountdownTickerDemo from "@/components/CountdownTicker/CountdownTickerDemo";
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Explore Markets | Dexetra',
  description: 'Discover trending markets and top performers on Dexetra',
};

export default function ExplorePage() {
  return (
    <>
      <TrendingDemo title="Trending Markets" />
      <MarketTickerCardDemo />
      <TopPerformerDualDemo />
      <CountdownTickerDemo />
    </>
  )
} 