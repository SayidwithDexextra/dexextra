import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/markets - Get list of available markets with real-time data
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const includeStats = searchParams.get('includeStats') === 'true';

    // Build base query
    let query = supabaseAdmin
      .from('orderbook_markets')
      .select(`
        id,
        metric_id,
        description,
        category,
        decimals,
        minimum_order_size,
        tick_size,
        settlement_date,
        trading_end_date,
        market_status,
        total_volume,
        total_trades,
        open_interest_long,
        open_interest_short,
        last_trade_price,
        settlement_value,
        created_at,
        updated_at,
        banner_image_url,
        icon_image_url
      `)
      .order('total_volume', { ascending: false })
      .range(offset, offset + limit - 1);

    // Add filters
    if (status) {
      query = query.eq('market_status', status.toUpperCase());
    }
    
    if (category) {
      query = query.eq('category', category);
    }

    const { data: markets, error } = await query;

    if (error) {
      throw error;
    }

    if (!markets || markets.length === 0) {
      return NextResponse.json({
        markets: [],
        pagination: { limit, offset, total: 0, hasMore: false }
      });
    }

    // For now, return markets without real-time stats
    // TODO: Implement real-time order book data integration
    const marketData = markets;

    // Format response
    const formattedMarkets = marketData.map(market => ({
      id: market.id,
      metricId: market.metric_id,
      description: market.description,
      category: market.category,
      decimals: market.decimals,
      minimumOrderSize: market.minimum_order_size,
      tickSize: market.tick_size,
      settlementDate: market.settlement_date,
      tradingEndDate: market.trading_end_date,
      status: market.market_status,
      
      // Trading statistics
      statistics: {
        totalVolume: market.total_volume,
        totalTrades: market.total_trades,
        openInterest: {
          long: market.open_interest_long,
          short: market.open_interest_short,
          total: (parseFloat(market.open_interest_long || '0') + parseFloat(market.open_interest_short || '0')).toString()
        },
        lastTradePrice: market.last_trade_price,
        settlementValue: market.settlement_value
      },

      // Real-time data (if requested)
      ...(includeStats && market.realTimeData && {
        realTime: {
          bestBid: market.realTimeData.bestBid,
          bestAsk: market.realTimeData.bestAsk,
          spread: market.realTimeData.spread,
          spreadPercentage: market.realTimeData.bestBid && market.realTimeData.bestAsk 
            ? (((parseFloat(market.realTimeData.bestAsk) - parseFloat(market.realTimeData.bestBid)) / parseFloat(market.realTimeData.bestBid)) * 100).toFixed(4) + '%'
            : null,
          volume24h: market.realTimeData.volume24h,
          orderBookDepth: {
            bids: market.realTimeData.bidDepth,
            asks: market.realTimeData.askDepth
          },
          lastUpdate: market.realTimeData.lastUpdateTime
        }
      }),

      // Media
      images: {
        banner: market.banner_image_url,
        icon: market.icon_image_url
      },

      // Timestamps
      createdAt: market.created_at,
      updatedAt: market.updated_at,

      // Market health indicators
      healthIndicators: {
        isActive: market.market_status === 'ACTIVE',
        hasLiquidity: market.total_volume > 0,
        timeToSettlement: market.settlement_date ? 
          Math.max(0, new Date(market.settlement_date).getTime() - Date.now()) : null,
        timeToTradingEnd: market.trading_end_date ? 
          Math.max(0, new Date(market.trading_end_date).getTime() - Date.now()) : null
      }
    }));

    return NextResponse.json({
      markets: formattedMarkets,
      pagination: {
        limit,
        offset,
        total: formattedMarkets.length,
        hasMore: formattedMarkets.length === limit
      },
      metadata: {
        includeStats,
        totalActiveMarkets: formattedMarkets.filter(m => m.status === 'ACTIVE').length,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Get markets error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch markets' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/markets - Create a new market (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    // For now, return not implemented
    // Market creation should go through the MarketWizard component
    return NextResponse.json(
      { 
        error: 'Market creation via API not implemented',
        suggestion: 'Use the Market Wizard interface to create new markets'
      },
      { status: 501 }
    );

  } catch (error) {
    console.error('Market creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

