import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const query = searchParams.get('query') || '';
    const limit = parseInt(searchParams.get('limit') || '50');
    const type = searchParams.get('type') || '';
    const exchange = searchParams.get('exchange') || '';

    console.log(`🔍 TradingView search: "${query}" (limit: ${limit})`);

    // Build Supabase query for active orderbook markets (unified view)
    let supabaseQuery = supabase
      .from('orderbook_markets_view')
      .select('metric_id, description, category, market_address, central_vault_address, last_trade_price, created_at')
      .eq('is_active', true)
      .eq('deployment_status', 'DEPLOYED')
      .not('market_address', 'is', null);

    // Add search filter if query provided
    if (query.trim()) {
      const searchLower = query.toLowerCase();
      supabaseQuery = supabaseQuery.or(
        `metric_id.ilike.%${searchLower}%,description.ilike.%${searchLower}%`
      );
    }

    // Apply limit
    supabaseQuery = supabaseQuery.limit(limit);

    const { data: markets, error } = await supabaseQuery;

    if (error) {
      console.error('❌ Supabase query error:', error);
      return NextResponse.json(
        { error: 'Database query failed', details: error.message },
        { status: 500 }
      );
    }

    // Transform markets to TradingView format
    const symbols = (markets || []).map((market: any) => {
      // Determine market type from category string
      const cat = (market.category || '').toString().toLowerCase();
      let marketType = 'futures';
      if (cat.includes('crypto')) marketType = 'crypto';
      else if (cat.includes('stock')) marketType = 'stock';
      else if (cat.includes('index')) marketType = 'index';
      else if (cat.includes('commodity')) marketType = 'commodity';

      const symbol = market.metric_id;
      return {
        symbol,
        full_name: `ORDERBOOK:${symbol}`,
        description: market.description || `${symbol} Orderbook Market`,
        exchange: 'ORDERBOOK',
        ticker: symbol,
        type: marketType,
        category: cat,
        market_address: market.market_address,
        vault_address: market.central_vault_address,
        initial_price: market.last_trade_price,
        created_at: market.created_at
      };
    });

    console.log(`✅ Found ${symbols.length} orderbook markets for query: "${query}"`);

    return NextResponse.json({
      symbols,
      total: symbols.length,
      query,
      limit
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('❌ TradingView search error:', error);
    return NextResponse.json(
      { 
        error: 'Search failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
} 