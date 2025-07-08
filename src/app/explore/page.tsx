import { TrendingDemo } from "@/components/trending";
import MarketTickerCardDemo from "@/components/MarketTickerCard/demo";
import TopPerformerDualDemo from "@/components/TopPerformer/TopPerformerDualDemo";
import CountdownTickerDemo from "@/components/CountdownTicker/CountdownTickerDemo";
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