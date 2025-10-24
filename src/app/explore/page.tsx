import { TrendingDemo } from "@/components/trending";
import { MarketTickerCardDemo } from "@/components/MarketTickerCard";
import TopPerformerDualDemo from "@/components/TopPerformer/TopPerformerDualDemo";
import CountdownTickerDemo from "@/components/CountdownTicker/CountdownTickerDemo";
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Explore Markets | Dexetera',
  description: 'Discover trending markets and top performers on Dexetera',
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