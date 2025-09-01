import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ metric_id: string }> }
) {
  try {
    const { metric_id } = await params;

    console.log('🔍 Fetching orderbook market by metric_id:', metric_id);

    // Query the orderbook_markets table
    const { data: market, error } = await supabase
      .from('orderbook_markets')
      .select(`
        id,
        metric_id,
        description,
        category,
        decimals,
        minimum_order_size,
        tick_size,
        requires_kyc,
        settlement_date,
        trading_end_date,
        data_request_window_seconds,
        auto_settle,
        oracle_provider,
        initial_order,
        banner_image_url,
        icon_image_url,
        supporting_photo_urls,
        creation_fee,
        is_active,
        market_address,
        factory_address,
        central_vault_address,
        order_router_address,
        uma_oracle_manager_address,
        chain_id,
        deployment_transaction_hash,
        deployment_block_number,
        deployment_gas_used,
        market_status,
        total_volume,
        total_trades,
        open_interest_long,
        open_interest_short,
        last_trade_price,
        settlement_value,
        settlement_timestamp,
        creator_wallet_address,
        creator_user_id,
        metric_resolution_id,
        created_at,
        updated_at,
        deployed_at
      `)
      .eq('metric_id', metric_id)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        console.log('❌ Market not found:', metric_id);
        return NextResponse.json(
          { 
            error: 'Market not found',
            message: `No active market found with metric_id: ${metric_id}`
          },
          { status: 404 }
        );
      }

      console.error('❌ Database query error:', error);
      return NextResponse.json(
        { 
          error: 'Failed to fetch market',
          details: error.message
        },
        { status: 500 }
      );
    }

    console.log(`✅ Retrieved market: ${market.metric_id}`);

    // Also fetch recent orders, trade matches, and positions for this market
    const [ordersResult, tradesResult, positionsResult] = await Promise.allSettled([
      // Fetch recent off-chain orders
      supabase
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
        .eq('market_id', market.id)
        .order('created_at', { ascending: false })
        .limit(20),
      
      // Fetch recent trade matches (transactions)
      supabase
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
        .eq('market_id', market.id)
        .order('matched_at', { ascending: false })
        .limit(20),
      
      // Fetch active user positions
      supabase
        .from('user_positions')
        .select(`
          id,
          position_id,
          trader_wallet_address,
          side,
          quantity,
          entry_price,
          current_price,
          unrealized_pnl,
          position_status,
          opened_at,
          last_modified_at
        `)
        .eq('market_id', market.id)
        .in('position_status', ['OPEN', 'PARTIALLY_CLOSED'])
    ]);

    const orders = ordersResult.status === 'fulfilled' ? ordersResult.value.data || [] : [];
    const trades = tradesResult.status === 'fulfilled' ? tradesResult.value.data || [] : [];
    const positions = positionsResult.status === 'fulfilled' ? positionsResult.value.data || [] : [];

    console.log(`📊 Market ${market.metric_id} stats: ${orders.length} recent orders, ${trades.length} recent trades, ${positions.length} open positions`);

    const responseData = {
      success: true,
      market,
      orders,
      trades,
      positions,
      metadata: {
        total_orders: orders.length,
        total_trades: trades.length,
        total_positions: positions.length,
        deployment_status: market.market_address ? 'deployed' : 'pending'
      }
    };

    const jsonResponse = NextResponse.json(responseData);
    // Cache for 30 seconds, allow stale content for 60 seconds
    jsonResponse.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    
    return jsonResponse;

  } catch (error) {
    console.error('❌ GET API Error:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

