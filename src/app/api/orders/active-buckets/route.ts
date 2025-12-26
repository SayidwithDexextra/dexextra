import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function normalizeStatus(s: any): string {
  return String(s || '').trim().toUpperCase();
}

function isActiveStatus(status: string): boolean {
  // Be conservative: treat anything not-final as active.
  const s = normalizeStatus(status);
  if (!s) return true;
  return !['FILLED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'REJECTED'].includes(s);
}

/**
 * GET /api/orders/active-buckets
 * Query params:
 * - trader: 0x... (required)
 * - limit: max orders to scan (default 500, max 2000)
 * - perMarket: max orders to return per market (default 50, max 200)
 *
 * Returns:
 * - buckets: [{ symbol, token, orders }]
 *
 * Note: This uses Supabase `user_orders_snapshot` and is designed to replace expensive
 * browser-side onchain sweeps (orderService -> getUserOrders for every market).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const trader = String(searchParams.get('trader') || '').trim();
    const limit = Math.min(2000, Math.max(50, Number(searchParams.get('limit') || 500)));
    const perMarket = Math.min(200, Math.max(10, Number(searchParams.get('perMarket') || 50)));

    if (!trader || !isHexAddress(trader)) {
      return NextResponse.json({ ok: false, error: 'Invalid trader address' }, { status: 400 });
    }

    const { data: rows, error } = await supabaseAdmin
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
      .ilike('trader_wallet_address', trader)
      .order('last_update_at', { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ ok: false, error: 'Failed to fetch orders' }, { status: 500 });
    }

    const active = (rows || []).filter((r: any) => isActiveStatus(r?.order_status));

    // Group by market_metric_id
    const byMarket = new Map<string, any[]>();
    for (const o of active) {
      const mid = String(o?.market_metric_id || '').trim();
      if (!mid) continue;
      const arr = byMarket.get(mid) || [];
      if (arr.length < perMarket) arr.push(o);
      byMarket.set(mid, arr);
    }

    const marketIds = Array.from(byMarket.keys());
    const metaByMetric = new Map<string, { symbol?: string; name?: string }>();
    if (marketIds.length > 0) {
      try {
        // Best-effort: enrich with symbol/name if the resolved view is available
        const { data: mkts } = await supabaseAdmin
          .from('orderbook_markets_resolved')
          .select('metric_id, symbol, name')
          .in('metric_id', marketIds);
        (mkts || []).forEach((m: any) => {
          const k = String(m?.metric_id || '').trim();
          if (!k) return;
          metaByMetric.set(k, { symbol: m?.symbol, name: m?.name });
        });
      } catch {
        // ignore
      }
    }

    const buckets = marketIds
      .map((metricId) => {
        const orders = byMarket.get(metricId) || [];
        const meta = metaByMetric.get(metricId) || {};
        const symbol = String(meta.symbol || metricId).toUpperCase();
        const token = String(meta.name || meta.symbol || metricId);
        const transformedOrders = orders.map((order: any) => ({
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
          expiry_time: null,
        }));
        return { symbol, token, orders: transformedOrders };
      })
      .filter((b) => Array.isArray(b.orders) && b.orders.length > 0)
      .sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));

    const res = NextResponse.json({
      ok: true,
      trader,
      buckets,
      totalBuckets: buckets.length,
      totalOrders: buckets.reduce((sum: number, b: any) => sum + (b?.orders?.length || 0), 0),
      ts: new Date().toISOString(),
    });
    res.headers.set('Cache-Control', 'public, max-age=2, s-maxage=2, stale-while-revalidate=10');
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 });
  }
}



