import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/orders/query - Fetch orders from Supabase
 * Query parameters:
 * - metricId: The market/metric ID to filter orders
 * - limit: Number of orders to fetch (default: 100)
 * - trader: Optional trader address to filter by
 * - status: Optional status filter (PENDING, FILLED, PARTIAL, etc.)
 */
// Symbol to market_id mapping for scalable URL routing
const SYMBOL_TO_MARKET_ID_MAP: Record<string, string> = {
  'aluminum': 'aluminum-v1-001',
  'ALUMINUM_V1_HYPERLIQUID': 'aluminum-v1-001',
  'copper': 'copper-v1-001',
  'COPPER_V1_HYPERLIQUID': 'copper-v1-001', 
  'steel': 'steel-v1-001',
  'STEEL_V1_HYPERLIQUID': 'steel-v1-001',
  'gold': 'gold-v1-001',
  'GOLD_V1_HYPERLIQUID': 'gold-v1-001',
  // Add more mappings as needed
};

// Reverse mapping for backwards compatibility
const MARKET_ID_TO_SYMBOL_MAP = Object.fromEntries(
  Object.entries(SYMBOL_TO_MARKET_ID_MAP).map(([symbol, marketId]) => [marketId, symbol])
);

function resolveMarketId(input: string): string {
  // If input is already a market_id, return as-is
  if (MARKET_ID_TO_SYMBOL_MAP[input]) {
    return input;
  }
  
  // If input is a symbol, map to market_id
  if (SYMBOL_TO_MARKET_ID_MAP[input]) {
    return SYMBOL_TO_MARKET_ID_MAP[input];
  }
  
  // Fallback: return input as-is (for unknown symbols)
  return input;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const metricId = searchParams.get('metricId');
    const limit = parseInt(searchParams.get('limit') || '100');
    const trader = searchParams.get('trader');
    const status = searchParams.get('status');

    if (!metricId) {
      return NextResponse.json(
        { error: 'metricId parameter is required' },
        { status: 400 }
      );
    }

    // Resolve symbol to market_id
    const resolvedMarketId = resolveMarketId(metricId);
    console.log(`🔍 [ORDERS_API] Symbol mapping: "${metricId}" → "${resolvedMarketId}"`);

    // Build query using resolved market_id
    let query = supabaseAdmin
      .from('orders')
      .select(`
        order_id,
        market_id,
        user_address,
        order_type,
        side,
        size,
        price,
        filled,
        status,
        created_at,
        updated_at,
        quantity,
        trader_address
      `)
      .eq('market_id', resolvedMarketId)
      .order('created_at', { ascending: false })
      .limit(limit);

    // Add optional filters
    if (trader) {
      query = query.or(`user_address.eq.${trader},trader_address.eq.${trader}`);
    }

    if (status) {
      query = query.eq('status', status.toUpperCase());
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('❌ Error fetching orders from Supabase:', error);
      return NextResponse.json(
        { error: 'Failed to fetch orders' },
        { status: 500 }
      );
    }

    // Transform Supabase orders to match expected frontend format
    const transformedOrders = orders?.map((order: any) => ({
      order_id: order.order_id,
      trader_wallet_address: order.trader_address || order.user_address,
      order_type: order.order_type,
      side: order.side,
      quantity: parseFloat(order.quantity || order.size),
      price: order.price ? parseFloat(order.price) : null,
      filled_quantity: parseFloat(order.filled), // Map 'filled' to 'filled_quantity'
      created_at: order.created_at,
      updated_at: order.updated_at,
      order_status: order.status,
      time_in_force: 'GTC', // Default value
      stop_price: null,
      iceberg_quantity: null,
      post_only: false,
      expiry_time: null
    })) || [];

    console.log(`✅ Successfully fetched ${transformedOrders.length} orders for metricId: ${metricId} (resolved to: ${resolvedMarketId})`);

    return NextResponse.json({
      success: true,
      orders: transformedOrders,
      total: transformedOrders.length,
      metricId,
      resolvedMarketId
    });

  } catch (error) {
    console.error('❌ Unexpected error in orders query API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}