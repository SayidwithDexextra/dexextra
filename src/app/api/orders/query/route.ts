import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * GET /api/orders/query - Fetch orders from Supabase
 * Query parameters:
 * - metricId: Market identifier (can be metric_id or symbol)
 * - limit: Number of orders to fetch (default: 100)
 * - trader: Optional trader address to filter by
 * - status: Optional status filter (PENDING, FILLED, PARTIAL, etc.)
 */

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isBytes32(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

async function resolveMarketIdFrom(table: 'orderbook_markets_resolved' | 'orderbook_markets', input: string): Promise<string | null> {
  // Address -> metric_id
  if (isHexAddress(input)) {
    const byAddr = await supabaseAdmin
      .from(table)
      .select('metric_id')
      .eq('market_address', input.toLowerCase())
      .single();
    if (!byAddr.error && byAddr.data?.metric_id) return byAddr.data.metric_id as string;
  }

  // bytes32 -> metric_id
  if (isBytes32(input)) {
    const byHash = await supabaseAdmin
      .from(table)
      .select('metric_id')
      .eq('market_id_bytes32', input.toLowerCase())
      .single();
    if (!byHash.error && byHash.data?.metric_id) return byHash.data.metric_id as string;
  }

  // exact metric_id or symbol
  const exact = await supabaseAdmin
    .from(table)
    .select('metric_id')
    .or(`eq.metric_id.${input},eq.symbol.${input}`)
    .single();
  if (!exact.error && exact.data?.metric_id) return exact.data.metric_id as string;

  // case-insensitive metric_id or symbol
  const ci = await supabaseAdmin
    .from(table)
    .select('metric_id')
    .or(`ilike.metric_id.${input},ilike.symbol.${input}`)
    .single();
  if (!ci.error && ci.data?.metric_id) return ci.data.metric_id as string;

  return null;
}

async function resolveMarketIdDynamic(input: string): Promise<string> {
  // Prefer resolved view, then base table
  const fromResolved = await resolveMarketIdFrom('orderbook_markets_resolved', input);
  if (fromResolved) return fromResolved;
  const fromBase = await resolveMarketIdFrom('orderbook_markets', input);
  if (fromBase) return fromBase;
  return input; // fallback
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

    // Resolve to market_id dynamically from DB
    const resolvedMarketId = await resolveMarketIdDynamic(metricId);
    console.log(`🔍 [ORDERS_API] Resolved market identifier: "${metricId}" → "${resolvedMarketId}"`);

    // Build query using resolved market_id
    // Build base query function so we can retry with a fallback client if needed
    const buildQuery = (client: any) => client
      .from('user_orders_snapshot')
      .select(`
        order_id,
        market_metric_id,
        trader_wallet_address,
        order_type,
        side,
        price,
        quantity,
        filled_quantity,
        order_status,
        first_seen_at,
        last_update_at
      `)
      .eq('market_metric_id', resolvedMarketId)
      .order('last_update_at', { ascending: false })
      .limit(limit);

    // Add optional filters
    let query = buildQuery(supabaseAdmin);
    if (trader) {
      // Case-insensitive match for wallet address
      query = query.ilike('trader_wallet_address', trader);
    }

    if (status) {
      query = query.eq('order_status', status.toUpperCase());
    }

    let ordersRes;
    try {
      ordersRes = await query;
    } catch (e: any) {
      // Retry with fallback client if network failure occurs
      const isFetchFailed = (e?.message || '').includes('fetch failed');
      if (!isFetchFailed) throw e;
      const fallbackUrl = (env.SUPABASE_URL as unknown as string) || (env.NEXT_PUBLIC_SUPABASE_URL as unknown as string);
      const fallbackKey = (env.SUPABASE_SERVICE_ROLE_KEY as unknown as string) || (env.SUPABASE_ANON_KEY as unknown as string) || (env.NEXT_PUBLIC_SUPABASE_ANON_KEY as unknown as string);
      const fallback = createClient(fallbackUrl, fallbackKey, { auth: { autoRefreshToken: false, persistSession: false } });
      let fallbackQuery = buildQuery(fallback);
      if (trader) fallbackQuery = fallbackQuery.ilike('trader_wallet_address', trader);
      ordersRes = await fallbackQuery;
    }

    const { data: orders, error } = ordersRes as any;

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
      trader_wallet_address: order.trader_wallet_address,
      order_type: order.order_type,
      side: order.side,
      quantity: parseFloat(order.quantity),
      price: order.price ? parseFloat(order.price) : null,
      filled_quantity: parseFloat(order.filled_quantity || 0),
      created_at: order.first_seen_at,
      updated_at: order.last_update_at,
      order_status: order.order_status,
      time_in_force: 'GTC',
      stop_price: null,
      iceberg_quantity: null,
      post_only: false,
      expiry_time: null
    })) || [];

    console.log(`✅ Successfully fetched ${transformedOrders.length} orders for metricId: ${metricId} (resolved to: ${resolvedMarketId})`);

    const res = NextResponse.json({
      success: true,
      orders: transformedOrders,
      total: transformedOrders.length,
      metricId,
      resolvedMarketId
    });
    // Add short cache to dampen bursts from UI
    res.headers.set('Cache-Control', 'public, max-age=5, s-maxage=5, stale-while-revalidate=30');
    return res;

  } catch (error) {
    console.error('❌ Unexpected error in orders query API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}