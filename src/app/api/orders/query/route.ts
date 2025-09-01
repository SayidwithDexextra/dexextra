import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const metricId = searchParams.get('metricId');
    const marketId = searchParams.get('marketId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!metricId && !marketId) {
      return NextResponse.json({ error: 'metricId or marketId required' }, { status: 400 });
    }

    let resolvedMarketId = marketId;
    if (!resolvedMarketId && metricId) {
      // console.log(`🔍 [DEBUG] Looking up market for metricId: ${metricId}`);
      const { data: markets, error: mErr } = await supabaseAdmin
        .from('orderbook_markets')
        .select('id')
        .eq('metric_id', metricId)
        .limit(1);
      if (mErr) {
        console.error('❌ [DEBUG] Market lookup error:', mErr);
        return NextResponse.json({ error: 'Market lookup failed', details: mErr.message }, { status: 500 });
      }
      if (!markets || markets.length === 0) {
        console.error('❌ [DEBUG] No market found for metricId:', metricId);
        return NextResponse.json({ error: 'Market not found' }, { status: 404 });
      }
      resolvedMarketId = markets[0].id as string;
      // console.log(`✅ [DEBUG] Resolved marketId: ${resolvedMarketId}`);
    }

    // Query both off-chain orders and trade matches for comprehensive data
    const [ordersResult, tradesResult] = await Promise.allSettled([
      // Fetch off-chain orders
      supabaseAdmin
        .from('off_chain_orders')
        .select(`
          id,
          order_id,
          trader_wallet_address,
          order_type,
          side,
          quantity,
          price,
          filled_quantity,
          remaining_quantity,
          order_status,
          average_fill_price,
          created_at,
          updated_at,
          opened_at,
          closed_at
        `)
        .eq('market_id', resolvedMarketId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
      
      // Fetch trade matches for transaction history
      supabaseAdmin
        .from('trade_matches')
        .select(`
          id,
          match_id,
          trade_price,
          trade_quantity,
          total_value,
          buy_trader_wallet_address,
          sell_trader_wallet_address,
          settlement_status,
          matched_at,
          settled_at
        `)
        .eq('market_id', resolvedMarketId)
        .order('matched_at', { ascending: false })
        .range(offset, offset + limit - 1)
    ]);

    const orders = ordersResult.status === 'fulfilled' ? ordersResult.value.data || [] : [];
    const trades = tradesResult.status === 'fulfilled' ? tradesResult.value.data || [] : [];
    
    // console.log(`📊 [DEBUG] Query results for marketId ${resolvedMarketId}: ${orders.length} orders, ${trades.length} trades`);
    
    if (ordersResult.status === 'rejected') {
      console.error('❌ [DEBUG] Orders query failed:', ordersResult.reason);
      return NextResponse.json({ error: 'Orders query failed', details: ordersResult.reason }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      orders: orders, 
      trades: trades,
      pagination: { 
        limit, 
        offset, 
        total_orders: orders.length,
        total_trades: trades.length
      } 
    });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error', message: (error as Error).message }, { status: 500 });
  }
}


