import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(200, Number(searchParams.get('limit') || 50)));
    const search = searchParams.get('search')?.trim() || '';
    const sort = searchParams.get('sort') || 'trending';
    const category = searchParams.get('category')?.trim() || '';

    const clickhouse = getClickHouseDataPipeline();
    const hasClickhouse = clickhouse.isConfigured();

    let trendingBySymbol = new Map<string, any>();

    if (hasClickhouse) {
      try {
        const trending = await clickhouse.getTrendingMarkets({ limit: 200 });
        for (const row of trending) {
          const sym = row.symbol?.toUpperCase();
          if (sym) trendingBySymbol.set(sym, row);
        }
      } catch {
        // ClickHouse unavailable — fall back to Supabase-only data
      }
    }

    let query = supabaseAdmin
      .from('markets')
      .select(
        `id, market_identifier, symbol, name, description, category, icon_image_url, banner_image_url,
         market_address, chain_id, network, tick_size, decimals,
         is_active, market_status, total_volume, total_trades,
         open_interest_long, open_interest_short,
         settlement_date, trading_end_date, created_at, deployed_at`,
        { count: 'exact' }
      )
      .eq('is_active', true);

    if (category) {
      query = query.contains('category', [category]);
    }

    if (search) {
      query = query.or(
        `market_identifier.ilike.%${search}%,symbol.ilike.%${search}%,name.ilike.%${search}%`
      );
    }

    query = query.order('symbol', { ascending: true }).limit(limit);

    const { data: markets, error, count } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const marketIds = (markets || []).map((m: any) => m.id).filter(Boolean);
    const tickersByMarketId = new Map<string, any>();

    if (marketIds.length > 0) {
      const { data: tickers } = await supabaseAdmin
        .from('market_tickers')
        .select('market_id, mark_price, last_update, is_stale')
        .in('market_id', marketIds);

      for (const t of tickers || []) {
        tickersByMarketId.set(t.market_id, t);
      }
    }

    const rows = (markets || []).map((m: any) => {
      const ticker = tickersByMarketId.get(m.id);
      const sym = (m.symbol || m.market_identifier || '').toUpperCase();
      const trending = trendingBySymbol.get(sym);

      return {
        market_id: m.id,
        market_identifier: m.market_identifier,
        symbol: m.symbol,
        name: m.name,
        description: m.description || null,
        category: m.category,
        icon_image_url: m.icon_image_url,
        banner_image_url: m.banner_image_url || null,
        market_address: m.market_address,
        chain_id: m.chain_id,
        network: m.network,
        market_status: m.market_status,
        created_at: m.created_at,
        deployed_at: m.deployed_at,
        settlement_date: m.settlement_date || null,
        trading_end_date: m.trading_end_date || null,
        tick_size: m.tick_size,
        decimals: m.decimals,
        open_interest_long: m.open_interest_long ?? 0,
        open_interest_short: m.open_interest_short ?? 0,

        mark_price: ticker?.mark_price != null
          ? Number(ticker.mark_price) / 1_000_000
          : trending?.close24h ?? null,
        is_stale: ticker?.is_stale ?? null,

        total_volume: trending?.notionalVolume ?? m.total_volume ?? 0,
        total_trades: trending?.trades ?? m.total_trades ?? 0,
        volume_1h: trending?.notional1h ?? 0,
        trades_1h: trending?.trades1h ?? 0,
        price_change_1h: trending?.priceChange1hPct ?? 0,
        price_change_24h: trending?.priceChange24hPct ?? 0,
        trending_score: trending?.score ?? 0,
      };
    });

    if (sort === 'trending') {
      rows.sort((a: any, b: any) => b.trending_score - a.trending_score);
    } else if (sort === 'volume') {
      rows.sort((a: any, b: any) => b.total_volume - a.total_volume);
    } else if (sort === 'gainers') {
      rows.sort((a: any, b: any) => b.price_change_24h - a.price_change_24h);
    } else if (sort === 'losers') {
      rows.sort((a: any, b: any) => a.price_change_24h - b.price_change_24h);
    } else if (sort === 'newest') {
      rows.sort((a: any, b: any) => {
        const dateA = new Date(a.deployed_at || a.created_at || 0).getTime();
        const dateB = new Date(b.deployed_at || b.created_at || 0).getTime();
        return dateB - dateA;
      });
    }

    return NextResponse.json({
      success: true,
      markets: rows,
      total: count || rows.length,
    });
  } catch (e) {
    console.error('[explore-markets] Error:', e);
    return NextResponse.json(
      { success: false, error: (e as Error).message || 'Unknown error' },
      { status: 500 }
    );
  }
}
