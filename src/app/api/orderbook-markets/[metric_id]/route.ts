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
      .eq('metric_id', metric_id.toUpperCase())
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

    // Also fetch recent orders and positions for this market
    const [ordersResult, positionsResult] = await Promise.allSettled([
      supabase
        .from('market_orders')
        .select('*')
        .eq('market_id', market.id)
        .order('created_at', { ascending: false })
        .limit(10),
      
      supabase
        .from('market_positions')
        .select('*')
        .eq('market_id', market.id)
        .eq('is_settled', false)
    ]);

    const orders = ordersResult.status === 'fulfilled' ? ordersResult.value.data || [] : [];
    const positions = positionsResult.status === 'fulfilled' ? positionsResult.value.data || [] : [];

    console.log(`📊 Market ${market.metric_id} stats: ${orders.length} recent orders, ${positions.length} open positions`);

    const responseData = {
      success: true,
      market,
      orders,
      positions,
      metadata: {
        total_orders: orders.length,
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

