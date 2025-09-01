import { NextRequest, NextResponse } from 'next/server';
import { ServiceManager } from '@/services/ServiceManager';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { z } from 'zod';

// Query parameters schema
const OrderBookQuerySchema = z.object({
  depth: z.string().regex(/^\d+$/).transform(Number).default('20'),
  aggregation: z.enum(['none', 'tick', 'auto']).default('auto'),
});

/**
 * GET /api/markets/[metricId]/orderbook - Get real-time order book data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { metricId: string } }
) {
  const startTime = Date.now();

  try {
    const metricId = params.metricId;
    
    if (!metricId) {
      return NextResponse.json(
        { error: 'Metric ID is required' },
        { status: 400 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const queryParams = OrderBookQuerySchema.parse({
      depth: searchParams.get('depth') || '20',
      aggregation: searchParams.get('aggregation') || 'auto'
    });

    // Verify market exists
    const { data: market, error: marketError } = await supabaseAdmin
      .from('orderbook_markets')
      .select('id, market_status, tick_size, decimals, description')
      .eq('metric_id', metricId)
      .single();

    if (marketError || !market) {
      return NextResponse.json(
        { error: 'Market not found' },
        { status: 404 }
      );
    }

    if (market.market_status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Market is not active' },
        { status: 400 }
      );
    }

    // Get order book from matching engine
    const serviceManager = ServiceManager.getInstance();
    const matchingEngine = serviceManager.getService('matchingEngine');
    
    if (!matchingEngine) {
      return NextResponse.json(
        { error: 'Matching engine not available' },
        { status: 503 }
      );
    }

    // Fetch real-time order book
    const orderBook = await matchingEngine.getOrderBook(metricId, {
      depth: queryParams.depth,
      aggregation: queryParams.aggregation
    });

    if (!orderBook) {
      return NextResponse.json(
        { error: 'Order book not found for this market' },
        { status: 404 }
      );
    }

    // Format order book data
    const formatOrderLevel = (level: any) => ({
      price: (Number(level.price) / 1e18).toString(),
      quantity: (Number(level.quantity) / 1e18).toString(),
      total: (Number(level.total) / 1e18).toString(),
      orderCount: level.orderCount || 1,
      timestamp: level.timestamp || orderBook.timestamp
    });

    // Calculate market depth metrics
    const bids = orderBook.bids.slice(0, queryParams.depth).map(formatOrderLevel);
    const asks = orderBook.asks.slice(0, queryParams.depth).map(formatOrderLevel);

    const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : null;
    const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : null;
    
    const spread = bestBid && bestAsk ? (bestAsk - bestBid) : null;
    const spreadPercentage = spread && bestBid ? ((spread / bestBid) * 100) : null;
    const midPrice = bestBid && bestAsk ? ((bestBid + bestAsk) / 2) : null;

    // Calculate depth metrics
    const bidVolume = bids.reduce((sum, level) => sum + parseFloat(level.quantity), 0);
    const askVolume = asks.reduce((sum, level) => sum + parseFloat(level.quantity), 0);
    const totalVolume = bidVolume + askVolume;

    const processingTime = Date.now() - startTime;

    return NextResponse.json({
      metricId,
      market: {
        description: market.description,
        status: market.market_status,
        tickSize: market.tick_size,
        decimals: market.decimals
      },
      
      // Order book levels
      bids,
      asks,
      
      // Market metrics
      metrics: {
        bestBid,
        bestAsk,
        spread: spread?.toString(),
        spreadPercentage: spreadPercentage ? `${spreadPercentage.toFixed(4)}%` : null,
        midPrice: midPrice?.toString(),
        
        // Volume metrics
        bidVolume: bidVolume.toString(),
        askVolume: askVolume.toString(),
        totalVolume: totalVolume.toString(),
        volumeImbalance: totalVolume > 0 ? 
          (((bidVolume - askVolume) / totalVolume) * 100).toFixed(2) + '%' : null,
        
        // Depth metrics
        bidDepth: bids.length,
        askDepth: asks.length,
        totalOrders: bids.reduce((sum, b) => sum + b.orderCount, 0) + 
                    asks.reduce((sum, a) => sum + a.orderCount, 0)
      },

      // Request metadata
      requestParams: {
        depth: queryParams.depth,
        aggregation: queryParams.aggregation,
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
        lastUpdate: orderBook.timestamp
      },

      // Market health indicators
      healthIndicators: {
        hasLiquidity: totalVolume > 0,
        isTightSpread: spreadPercentage ? spreadPercentage < 1 : false, // Less than 1% spread
        bidAskBalance: Math.abs(bids.length - asks.length) <= 2, // Relatively balanced
        recentActivity: orderBook.lastTradeTime ? 
          (Date.now() - orderBook.lastTradeTime) < 300000 : false, // Activity within 5 minutes
      }
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('Get order book error:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch order book',
        processingTime: `${processingTime}ms`
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/markets/[metricId]/trades - Get recent trades for market
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { metricId: string } }
) {
  try {
    const metricId = params.metricId;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const since = searchParams.get('since'); // ISO timestamp

    // Get market info
    const { data: market, error: marketError } = await supabaseAdmin
      .from('orderbook_markets')
      .select('id, description')
      .eq('metric_id', metricId)
      .single();

    if (marketError || !market) {
      return NextResponse.json(
        { error: 'Market not found' },
        { status: 404 }
      );
    }

    // Build trades query
    let tradesQuery = supabaseAdmin
      .from('trade_matches')
      .select('*')
      .eq('market_id', market.id)
      .order('matched_at', { ascending: false })
      .limit(limit);

    if (since) {
      tradesQuery = tradesQuery.gte('matched_at', since);
    }

    const { data: trades, error: tradesError } = await tradesQuery;

    if (tradesError) {
      throw tradesError;
    }

    // Format trades
    const formattedTrades = trades?.map(trade => ({
      tradeId: trade.match_id,
      price: trade.trade_price,
      quantity: trade.trade_quantity,
      totalValue: trade.total_value,
      side: trade.buy_order_id ? 'buy' : 'sell', // Determine based on aggressor
      timestamp: trade.matched_at,
      buyerFee: trade.buy_trader_fee,
      sellerFee: trade.sell_trader_fee,
      settlementStatus: trade.settlement_status
    })) || [];

    // Calculate trade statistics
    const tradeStats = formattedTrades.length > 0 ? {
      volume24h: formattedTrades
        .filter(t => new Date(t.timestamp).getTime() > Date.now() - 24 * 60 * 60 * 1000)
        .reduce((sum, t) => sum + parseFloat(t.totalValue), 0),
      
      lastPrice: formattedTrades[0]?.price,
      priceChange24h: formattedTrades.length > 1 ? 
        (parseFloat(formattedTrades[0].price) - parseFloat(formattedTrades[formattedTrades.length - 1].price)).toString() : '0',
      
      averageTradeSize: formattedTrades.length > 0 ?
        (formattedTrades.reduce((sum, t) => sum + parseFloat(t.quantity), 0) / formattedTrades.length).toString() : '0',
      
      totalTrades: formattedTrades.length
    } : null;

    return NextResponse.json({
      metricId,
      market: {
        description: market.description
      },
      trades: formattedTrades,
      statistics: tradeStats,
      metadata: {
        limit,
        since,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Get trades error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trades' },
      { status: 500 }
    );
  }
}

