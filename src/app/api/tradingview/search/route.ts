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

    // Build Supabase query for active vAMM markets
    let supabaseQuery = supabase
      .from('vamm_markets')
      .select('symbol, description, category, vamm_address, vault_address, initial_price, created_at')
      .eq('is_active', true)
      .eq('deployment_status', 'deployed')
      .not('vamm_address', 'is', null);

    // Add search filter if query provided
    if (query.trim()) {
      const searchLower = query.toLowerCase();
      supabaseQuery = supabaseQuery.or(
        `symbol.ilike.%${searchLower}%,description.ilike.%${searchLower}%`
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
    const symbols = (markets || []).map(market => {
      // Determine market type from category
      let marketType = 'futures'; // Default for vAMM markets
      if (Array.isArray(market.category)) {
        if (market.category.includes('crypto')) marketType = 'crypto';
        else if (market.category.includes('stock')) marketType = 'stock';
        else if (market.category.includes('index')) marketType = 'index';
        else if (market.category.includes('commodity')) marketType = 'commodity';
      }

      return {
        symbol: market.symbol,
        full_name: `VAMM:${market.symbol}`,
        description: market.description || `${market.symbol} vAMM Market`,
        exchange: 'VAMM',
        ticker: market.symbol,
        type: marketType,
        category: Array.isArray(market.category) ? market.category.join(', ') : market.category,
        vamm_address: market.vamm_address,
        vault_address: market.vault_address,
        initial_price: market.initial_price,
        created_at: market.created_at
      };
    });

    console.log(`✅ Found ${symbols.length} vAMM markets for query: "${query}"`);

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