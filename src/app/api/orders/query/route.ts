import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
      const { data: markets, error: mErr } = await supabase
        .from('orderbook_markets')
        .select('id')
        .eq('metric_id', metricId)
        .limit(1);
      if (mErr) return NextResponse.json({ error: 'Market lookup failed', details: mErr.message }, { status: 500 });
      if (!markets || markets.length === 0) return NextResponse.json({ error: 'Market not found' }, { status: 404 });
      resolvedMarketId = markets[0].id as string;
    }

    let query = supabase
      .from('market_orders')
      .select('*')
      .eq('market_id', resolvedMarketId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: orders, error } = await query;
    if (error) return NextResponse.json({ error: 'Query failed', details: error.message }, { status: 500 });

    return NextResponse.json({ success: true, orders: orders ?? [], pagination: { limit, offset, total: orders?.length ?? 0 } });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error', message: (error as Error).message }, { status: 500 });
  }
}


