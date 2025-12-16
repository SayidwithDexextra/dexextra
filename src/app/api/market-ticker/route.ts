import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function toScaledMarkPrice(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || Number.isNaN(n) || n <= 0) return 0;
  return Math.round(n * 1_000_000);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('market_id');
    const identifier = searchParams.get('identifier');

    if (!marketId && !identifier) {
      return NextResponse.json({ success: false, error: 'market_id or identifier required' }, { status: 400 });
    }

    // Resolve market by identifier or id (and keep market row for fallbacks)
    let market: any | null = null;
    let id = marketId;
    if (id) {
      const { data, error } = await supabase
        .from('markets')
        .select('id, market_identifier, symbol, tick_size, initial_order')
        .eq('id', id)
        .limit(1)
        .maybeSingle();
      if (!error && data) market = data;
    } else if (identifier) {
      const { data, error } = await supabase
        .from('markets')
        .select('id, market_identifier, symbol, tick_size, initial_order')
        .or(`market_identifier.eq.${identifier},symbol.eq.${identifier}`)
        .limit(1)
        .maybeSingle();
      if (!error && data) {
        market = data;
        id = data.id;
      }
    }

    // Market not found yet: treat as "not ready", not a hard 404 (prevents spam during deployment).
    if (!id) {
      return NextResponse.json({ success: true, ticker: null, notFound: true });
    }

    const { data: ticker, error: tErr } = await supabase
      .from('market_tickers')
      .select('*')
      .eq('market_id', id)
      .limit(1)
      .maybeSingle();

    if (tErr) {
      // Prefer returning a safe "no ticker yet" response rather than a hard error.
      return NextResponse.json({ success: true, ticker: null, tickerMissing: true });
    }

    if (ticker) {
      return NextResponse.json({ success: true, ticker });
    }

    // No ticker row yet. Return a fallback derived from initial_order.startPrice or tick_size.
    const now = new Date().toISOString();
    const startPrice = (market as any)?.initial_order?.startPrice ?? (market as any)?.initial_order?.start_price;
    const tickSize = (market as any)?.tick_size;
    const mark_price = toScaledMarkPrice(startPrice) || toScaledMarkPrice(tickSize) || 0;
    const fallback = {
      market_id: id,
      mark_price,
      last_update: now,
      is_stale: true,
    };
    return NextResponse.json({ success: true, ticker: fallback, isFallback: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message || 'Unknown error' }, { status: 500 });
  }
}


