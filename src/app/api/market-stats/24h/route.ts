import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const identifier = searchParams.get('identifier');
    const marketId = searchParams.get('marketId');

    if (!identifier && !marketId) {
      return NextResponse.json({ error: 'identifier or marketId required' }, { status: 400 });
    }

    let symbol: string | null = null;

    if (identifier) {
      symbol = identifier.toUpperCase();
    } else if (marketId) {
      const { data } = await supabase
        .from('markets')
        .select('symbol, market_identifier')
        .eq('id', marketId)
        .limit(1)
        .maybeSingle();
      symbol = data?.symbol || data?.market_identifier || null;
    }

    if (!symbol) {
      return NextResponse.json({ success: true, stats: null });
    }

    const pipeline = getClickHouseDataPipeline();
    const stats = await pipeline.getMarketStats(symbol, 24);

    return NextResponse.json({
      success: true,
      stats: stats ?? null,
    });
  } catch (e) {
    console.error('[market-stats/24h] Error:', e);
    return NextResponse.json(
      { success: false, error: (e as Error).message || 'Unknown error' },
      { status: 500 }
    );
  }
}
