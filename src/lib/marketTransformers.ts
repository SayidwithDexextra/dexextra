import { MarketTickerCardData } from '@/components/MarketTickerCard/types';
import { Market } from '@/hooks/useMarkets';
import type { MarketOverviewRow } from '@/hooks/useMarketOverview';

// Legacy type definition since useOrderbookMarkets has been removed
interface OrderbookMarket {
  id: string;
  metric_id: string;
  description?: string;
  market_status: string;
  category: string;
  last_trade_price?: number;
  tick_size?: number;
  icon_image_url?: string;
  banner_image_url?: string;
  total_volume?: number;
  total_trades?: number;
  settlement_date?: string;
  created_at: string;
  updated_at?: string;
}

/**
 * Transforms a Market from the new unified table to MarketTickerCardData format
 */
export function transformMarketToCard(market: Market): MarketTickerCardData {
  // Use last_trade_price if available, otherwise fall back to a sensible default
  // For now, we'll use tick_size as a fallback, but this could be enhanced with real market data
  const price = market.last_trade_price || market.tick_size || 0;
  
  // Use name/symbol as the display title
  const title = market.name || market.symbol || market.market_identifier;
  
  // Convert single category to array format expected by the card
  const categories = [market.category];
  
  // Generate image URL - prefer icon, then banner, then fallback
  const imageUrl = market.icon_image_url || 
                   market.banner_image_url || 
                   '/placeholder-market.svg';
  
  // Generate alt text
  const imageAlt = `${market.symbol || market.market_identifier} market icon`;
  
  return {
    id: market.id,
    title,
    categories,
    price,
    currency: '$',
    imageUrl,
    imageAlt,
    // Additional market data
    marketStatus: market.market_status,
    totalVolume: market.total_volume || 0,
    totalTrades: market.total_trades || 0,
    settlementDate: market.settlement_date,
    metricId: market.market_identifier, // Use market_identifier instead of metric_id
    description: market.description,
  };
}

/**
 * Transforms an array of Markets to MarketTickerCardData format
 */
export function transformMarketsToCards(markets: Market[]): MarketTickerCardData[] {
  return markets.map(transformMarketToCard);
}

// Prefer mark_price from overview when available
export function transformOverviewToCards(rows: MarketOverviewRow[]): MarketTickerCardData[] {
  return rows.map((row) => {
    const raw = (row.mark_price ?? 0) as number;
    // Mark price in Supabase is stored with USDC precision (1e6)
    const price = raw > 0 ? raw / 1_000_000 : (row.tick_size || 0);
    const title = row.name || row.symbol || row.market_identifier || '';
    const categories = [row.category];
  const imageUrl = row.icon_image_url || row.banner_image_url || 'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExaWN2ZTV1YnZreHV3dDl4eTlrMGFtYjd6NWY1MHBtOXM4dmdianh2ZSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/j5rZvWi198VASs4Bpu/giphy.gif';
    const imageAlt = `${row.symbol || row.market_identifier} market icon`;
    return {
      id: row.market_id,
      title,
      categories,
      price,
      currency: '$',
      imageUrl,
      imageAlt,
      marketStatus: row.market_status,
      totalVolume: row.total_volume || 0,
      totalTrades: row.total_trades || 0,
      settlementDate: undefined,
      metricId: row.market_identifier || row.symbol,
      description: '',
    };
  });
}

/**
 * For backward compatibility: transforms an OrderbookMarket to MarketTickerCardData format
 */
export function transformOrderbookMarketToCard(market: OrderbookMarket): MarketTickerCardData {
  // Use last_trade_price if available, otherwise fall back to a sensible default
  const price = market.last_trade_price || market.tick_size || 0;
  
  // Use metric_id as the display title, but could be description in the future
  const title = market.metric_id;
  
  // Convert single category to array format expected by the card
  const categories = [market.category];
  
  // Generate image URL - prefer icon, then banner, then fallback
  const imageUrl = market.icon_image_url || 
                   market.banner_image_url || 
                   '/placeholder-market.svg';
  
  // Generate alt text
  const imageAlt = `${market.metric_id} market icon`;
  
  return {
    id: market.id,
    title,
    categories,
    price,
    currency: '$',
    imageUrl,
    imageAlt,
    // Additional orderbook market data
    marketStatus: market.market_status,
    totalVolume: market.total_volume || 0,
    totalTrades: market.total_trades || 0,
    settlementDate: market.settlement_date,
    metricId: market.metric_id,
    description: market.description,
  };
}

/**
 * For backward compatibility: transforms an array of OrderbookMarkets to MarketTickerCardData format
 */
export function transformOrderbookMarketsToCards(markets: OrderbookMarket[]): MarketTickerCardData[] {
  return markets.map(transformOrderbookMarketToCard);
}

/**
 * Filters markets based on their status for display
 */
export function filterActiveMarkets<T extends { market_status: string }>(markets: T[]): T[] {
  return markets.filter(market => 
    market.market_status === 'ACTIVE' || 
    market.market_status === 'PENDING' ||
    market.market_status === 'DEPLOYING'
  );
}

/**
 * Sorts markets by priority (active first, then by volume, then by creation date)
 * Works with both old OrderbookMarket and new Market types
 */
export function sortMarketsByPriority<T extends { 
  market_status: string, 
  total_volume?: number, 
  created_at: string 
}>(markets: T[]): T[] {
  return [...markets].sort((a, b) => {
    // First priority: Active markets first
    const statusPriority: Record<string, number> = {
      'ACTIVE': 1,
      'DEPLOYING': 2,
      'PENDING': 3,
      'TRADING_ENDED': 4,
      'SETTLEMENT_REQUESTED': 5,
      'SETTLED': 6,
      'PAUSED': 7,
      'EXPIRED': 8,
      'ERROR': 9,
    };
    
    const aStatusPriority = statusPriority[a.market_status] || 10;
    const bStatusPriority = statusPriority[b.market_status] || 10;
    
    if (aStatusPriority !== bStatusPriority) {
      return aStatusPriority - bStatusPriority;
    }
    
    // Second priority: Higher volume first
    const aVolume = a.total_volume || 0;
    const bVolume = b.total_volume || 0;
    
    if (aVolume !== bVolume) {
      return bVolume - aVolume;
    }
    
    // Third priority: More recent creation date
    const aDate = new Date(a.created_at).getTime();
    const bDate = new Date(b.created_at).getTime();
    
    return bDate - aDate;
  });
}