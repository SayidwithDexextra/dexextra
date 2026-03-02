import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Read-only endpoint for homepage market overview with latest mark prices
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  // Use service role for reliable server-side access; RLS still enforced on views
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
      const status = searchParams.get('status');
    const category = searchParams.get('category');
    const search = searchParams.get('search');

    let query = supabase
      .from('markets')
      .select(
        `
        id,
        market_identifier,
        symbol,
        name,
        category,
        icon_image_url,
        banner_image_url,
        market_address,
        chain_id,
        network,
        tick_size,
        decimals,
        is_active,
        market_status,
        total_volume,
        total_trades
      `,
        { count: 'exact' }
      )
      .eq('is_active', true)
      .order('symbol', { ascending: true });

      // Support multiple statuses via comma-separated list, e.g. status=ACTIVE,SETTLEMENT_REQUESTED
      if (status) {
        const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
        if (statuses.length > 1) {
          query = query.in('market_status', statuses);
        } else if (statuses.length === 1) {
          query = query.eq('market_status', statuses[0]);
        }
      }
    if (category) query = query.contains('category', [category]);
    if (search) {
      query = query.or(
        `market_identifier.ilike.%${search}%,symbol.ilike.%${search}%,name.ilike.%${search}%`
      );
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const markets = data || [];
    const marketIds = markets.map((m: any) => m.id).filter(Boolean);

    // Preserve the old market_overview shape by joining latest ticker fields.
    const tickersByMarketId = new Map<string, any>();
    if (marketIds.length > 0) {
      const { data: tickers, error: tickersError } = await supabase
        .from('market_tickers')
        .select('market_id, mark_price, last_update, is_stale')
        .in('market_id', marketIds);

      if (tickersError) {
        return NextResponse.json({ error: tickersError.message }, { status: 500 });
      }

      for (const ticker of tickers || []) {
        tickersByMarketId.set(ticker.market_id, ticker);
      }
    }

    const overviewRows = markets.map((m: any) => {
      const ticker = tickersByMarketId.get(m.id);
      return {
        market_id: m.id,
        market_identifier: m.market_identifier,
        symbol: m.symbol,
        name: m.name,
        category: m.category,
        icon_image_url: m.icon_image_url,
        banner_image_url: m.banner_image_url,
        market_address: m.market_address,
        chain_id: m.chain_id,
        network: m.network,
        tick_size: m.tick_size,
        decimals: m.decimals,
        is_active: m.is_active,
        market_status: m.market_status,
        total_volume: m.total_volume,
        total_trades: m.total_trades,
        mark_price: ticker?.mark_price ?? null,
        last_update: ticker?.last_update ?? null,
        is_stale: ticker?.is_stale ?? null
      };
    });

    return NextResponse.json({
      success: true,
      markets: overviewRows,
      pagination: {
        limit,
        offset,
        total: count || markets.length || 0
      }
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Unknown error' }, { status: 500 });
  }
}


