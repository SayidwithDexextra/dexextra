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
    const symbol = searchParams.get('symbol');

    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    console.log(`🔍 Resolving symbol to metric_id: "${symbol}"`);

    // Try multiple strategies to find the market:
    // 1. Exact match on metric_id
    // 2. Case-insensitive match on metric_id
    // 3. Match based on description containing the symbol
    
    const { data: markets, error } = await supabase
      .from('orderbook_markets')
      .select('metric_id, description, market_address')
      .eq('is_active', true)
      .or(`metric_id.eq.${symbol},metric_id.ilike.${symbol},description.ilike.%${symbol}%`)
      .order('created_at', { ascending: false }); // Prefer newer markets

    if (error) {
      console.error('❌ Database query error:', error);
      return NextResponse.json(
        { error: 'Database query failed' },
        { status: 500 }
      );
    }

    if (!markets || markets.length === 0) {
      console.log(`ℹ️ No market found for symbol: ${symbol}`);
      return NextResponse.json(
        { 
          error: 'Market not found',
          message: `No active market found for symbol: ${symbol}`
        },
        { status: 404 }
      );
    }

    // Prioritize exact matches, then case-insensitive matches
    let bestMatch = markets.find(m => m.metric_id === symbol);
    
    if (!bestMatch) {
      bestMatch = markets.find(m => m.metric_id.toLowerCase() === symbol.toLowerCase());
    }
    
    if (!bestMatch) {
      // Fall back to first result if no exact match
      bestMatch = markets[0];
    }

    console.log(`✅ Resolved "${symbol}" to metric_id: "${bestMatch.metric_id}"`);

    return NextResponse.json({
      success: true,
      symbol,
      metric_id: bestMatch.metric_id,
      description: bestMatch.description,
      market_address: bestMatch.market_address,
      total_matches: markets.length
    });

  } catch (error: any) {
    console.error('❌ Error resolving market:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
