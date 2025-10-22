import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isBytes32(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

async function resolveMarketId(input: string): Promise<string> {
  const tryResolve = async (table: 'orderbook_markets_resolved' | 'orderbook_markets'): Promise<string | null> => {
    // By address
    if (isHexAddress(input)) {
      const byAddr = await supabaseAdmin
        .from(table)
        .select('metric_id')
        .eq('market_address', input.toLowerCase())
        .single();
      if (!byAddr.error && byAddr.data?.metric_id) return byAddr.data.metric_id as string;
    }

    // By bytes32
    if (isBytes32(input)) {
      const byHash = await supabaseAdmin
        .from(table)
        .select('metric_id')
        .eq('market_id_bytes32', input.toLowerCase())
        .single();
      if (!byHash.error && byHash.data?.metric_id) return byHash.data.metric_id as string;
    }

    // Exact match (metric_id or symbol)
    const exact = await supabaseAdmin
      .from(table)
      .select('metric_id')
      .or(`eq.metric_id.${input},eq.symbol.${input}`)
      .single();
    if (!exact.error && exact.data?.metric_id) return exact.data.metric_id as string;

    // Case-insensitive
    const ci = await supabaseAdmin
      .from(table)
      .select('metric_id')
      .or(`ilike.metric_id.${input},ilike.symbol.${input}`)
      .single();
    if (!ci.error && ci.data?.metric_id) return ci.data.metric_id as string;

    return null;
  };

  const fromResolved = await tryResolve('orderbook_markets_resolved');
  if (fromResolved) return fromResolved;
  const fromBase = await tryResolve('orderbook_markets');
  if (fromBase) return fromBase;
  return input;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = searchParams.get('metricId') || '';
    const trader = searchParams.get('trader') || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100);

    if (!raw) {
      return NextResponse.json({ error: 'metricId is required' }, { status: 400 });
    }

    const metricId = await resolveMarketId(raw);

    // Market info
    const { data: market } = await supabaseAdmin
      .from('orderbook_markets_resolved')
      .select('metric_id, market_address, market_status, is_active, created_at')
      .eq('metric_id', metricId)
      .single();

    // Events (latest)
    const eventsQuery = supabaseAdmin
      .from('user_order_events')
      .select('*', { count: 'exact' })
      .eq('market_metric_id', metricId)
      .order('created_at', { ascending: false })
      .limit(limit);
    const eventsRes = trader ? await eventsQuery.ilike('trader_wallet_address', trader) : await eventsQuery;
    const { data: events, count: eventsCount, error: eventsError } = eventsRes as any;
    if (eventsError) throw eventsError;

    // Snapshot (latest)
    const snapQuery = supabaseAdmin
      .from('user_orders_snapshot')
      .select('*', { count: 'exact' })
      .eq('market_metric_id', metricId)
      .order('last_update_at', { ascending: false })
      .limit(limit);
    const snapRes = trader ? await snapQuery.ilike('trader_wallet_address', trader) : await snapQuery;
    const { data: snapshot, count: snapshotCount, error: snapshotError } = snapRes as any;
    if (snapshotError) throw snapshotError;

    return NextResponse.json({
      ok: true,
      input: raw,
      resolvedMarketId: metricId,
      market,
      events: {
        count: eventsCount || (events?.length ?? 0),
        rows: events || []
      },
      snapshot: {
        count: snapshotCount || (snapshot?.length ?? 0),
        rows: snapshot || []
      }
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unexpected error' }, { status: 500 });
  }
}


