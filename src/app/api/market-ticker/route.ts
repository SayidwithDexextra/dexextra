import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('market_id');
    const identifier = searchParams.get('identifier');

    if (!marketId && !identifier) {
      return NextResponse.json({ error: 'market_id or identifier required' }, { status: 400 });
    }

    let id = marketId;
    if (!id && identifier) {
      // Resolve market id by market_identifier (or symbol as fallback)
      const { data: market, error } = await supabase
        .from('markets')
        .select('id, market_identifier, symbol')
        .or(`market_identifier.eq.${identifier},symbol.eq.${identifier}`)
        .limit(1)
        .single();
      if (error || !market) {
        return NextResponse.json({ error: 'Market not found' }, { status: 404 });
      }
      id = market.id;
    }

    const { data: ticker, error: tErr } = await supabase
      .from('market_tickers')
      .select('*')
      .eq('market_id', id)
      .single();

    if (tErr) {
      return NextResponse.json({ error: tErr.message }, { status: 404 });
    }

    return NextResponse.json({ success: true, ticker });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Unknown error' }, { status: 500 });
  }
}


