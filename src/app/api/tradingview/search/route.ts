import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { metricSourceFromMarket } from '@/lib/metricSource';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const query = searchParams.get('query') || '';
    const limit = parseInt(searchParams.get('limit') || '50');
    const type = searchParams.get('type') || '';
    const exchange = searchParams.get('exchange') || '';

    // Avoid spamming dev logs: this endpoint is called frequently by the charting library

    // Build Supabase query for active orderbook markets (unified view)
    let supabaseQuery = supabase
      .from('orderbook_markets_view')
      // IMPORTANT: include `id` so TradingView can use market UUID as the canonical symbol id
      .select('id, metric_id, description, category, market_address, central_vault_address, last_trade_price, created_at')
      .eq('is_active', true)
      .eq('deployment_status', 'DEPLOYED')
      .not('market_address', 'is', null);

    // Add search filter if query provided
    if (query.trim()) {
      const searchLower = query.toLowerCase();
      supabaseQuery = supabaseQuery.or(
        `metric_id.ilike.%${searchLower}%,description.ilike.%${searchLower}%`
      );
    }

    // Apply limit
    supabaseQuery = supabaseQuery.limit(limit);

    const { data: markets, error } = await supabaseQuery;

    if (error) {
      console.error('❌ Supabase query error:', error);
      return NextResponse.json(
        { error: 'Database query failed', details: error.message },
        { status: 500 }
      );
    }

    // Metric source enrichment (used for the right-side "exchange" column in TradingView symbol search).
    const marketIds = (markets || [])
      .map((m: any) => (m?.id ? String(m.id) : null))
      .filter(Boolean) as string[];
    const idToSourceLabel = new Map<string, string>();
    const idToMarketSymbol = new Map<string, string>();
    if (marketIds.length > 0) {
      const { data: sourceRows, error: sErr } = await supabase
        .from('markets')
        .select('id, symbol, market_config, initial_order')
        .in('id', marketIds);
      if (sErr) {
        console.warn('⚠️ metric source enrichment failed:', sErr.message);
      } else {
        (sourceRows || []).forEach((row: any) => {
          const id = row?.id ? String(row.id) : null;
          if (!id) return;
          const sym = typeof row?.symbol === 'string' && row.symbol.trim() ? row.symbol.trim() : null;
          if (sym) idToMarketSymbol.set(id, sym);
          const src = metricSourceFromMarket(row);
          const label = src.label || src.host || null;
          if (label) idToSourceLabel.set(id, label);
        });
      }
    }

    // Transform markets to TradingView format
    const symbols = (markets || []).map((market: any) => {
      // Determine market type from category string
      const cat = (market.category || '').toString().toLowerCase();
      let marketType = 'futures';
      if (cat.includes('crypto')) marketType = 'crypto';
      else if (cat.includes('stock')) marketType = 'stock';
      else if (cat.includes('index')) marketType = 'index';
      else if (cat.includes('commodity')) marketType = 'commodity';

      // Canonical TradingView symbol id should be the market UUID for stability.
      // Keep the human label in full_name/description.
      const marketUuid = market.id ? String(market.id) : null;
      const metricId = market.metric_id ? String(market.metric_id) : '';
      const symbol = marketUuid || metricId || '';
      const sourceLabel = marketUuid ? idToSourceLabel.get(marketUuid) : undefined;
      const marketSymbol = marketUuid ? idToMarketSymbol.get(marketUuid) : undefined;
      const baseName = marketSymbol || metricId || symbol;
      const description = sourceLabel ? `${baseName} (${sourceLabel})` : (market.description || `${baseName} Orderbook Market`);
      return {
        symbol,
        // Make the displayed name human-friendly while keeping `symbol` as the canonical id.
        full_name: `ORDERBOOK:${metricId || symbol}`,
        // Keep description human-friendly even if symbol is a UUID
        description,
        // TradingView shows this on the far-right column in the search UI.
        // We surface the metric source (e.g. "TradingView") when available.
        exchange: sourceLabel || 'ORDERBOOK',
        ticker: symbol,
        type: marketType,
        category: cat,
        market_address: market.market_address,
        vault_address: market.central_vault_address,
        initial_price: market.last_trade_price,
        created_at: market.created_at,
        // Not part of standard UDF, but useful for clients
        market_id: marketUuid
      };
    });

    // Avoid spamming dev logs

    return NextResponse.json({
      symbols,
      total: symbols.length,
      query,
      limit
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('❌ TradingView search error:', error);
    return NextResponse.json(
      { 
        error: 'Search failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
} 