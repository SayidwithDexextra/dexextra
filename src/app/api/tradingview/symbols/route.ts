import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { metricSourceFromMarket } from '@/lib/metricSource';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// In-memory cache for symbol info (reduces Supabase queries on rapid navigation)
type CachedSymbolInfo = { expiresAt: number; data: any };
const SYMBOL_CACHE = new Map<string, CachedSymbolInfo>();
const SYMBOL_CACHE_TTL_MS = 60_000; // 1 minute cache
const SYMBOL_CACHE_MAX_KEYS = 500;

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/**
 * TradingView `pricescale` is the factor used to convert a float price into an integer.
 * The chart *displays* `price / pricescale`.
 *
 * Important: `orderbook_markets_view.decimals` is not reliably "price decimals" (often token decimals),
 * so using it directly can shrink prices by 1e18 and make charts + overlays look broken.
 */
function inferPriceScale(market: any): number {
  // Prefer an explicit "price decimals" field if the view provides one.
  // (We keep this permissive to tolerate schema drift across envs.)
  const explicitDecimals = Number(
    market?.price_decimals ??
      market?.priceDecimals ??
      market?.quote_decimals ??
      market?.quoteDecimals ??
      market?.display_decimals ??
      market?.displayDecimals
  );
  if (Number.isFinite(explicitDecimals)) {
    const d = clampInt(explicitDecimals, 0, 10);
    return Math.pow(10, d);
  }

  // Fall back to heuristics based on the last observed trade price.
  const last = Number(
    market?.last_trade_price ??
      market?.lastTradePrice ??
      market?.mark_price ??
      market?.markPrice ??
      market?.index_price ??
      market?.indexPrice
  );
  if (!Number.isFinite(last) || last <= 0) {
    // Safe default: 2 decimals (cents) style.
    return 100;
  }

  const abs = Math.abs(last);
  // Heuristic buckets:
  // - large prices (>= 1000): cents
  // - normal prices (>= 1): 4dp
  // - small prices (>= 0.01): 6dp
  // - very small prices: 8dp
  let decimals = 2;
  if (abs >= 1000) decimals = 2;
  else if (abs >= 1) decimals = 4;
  else if (abs >= 0.01) decimals = 6;
  else decimals = 8;

  return Math.pow(10, decimals);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawSymbol = searchParams.get('symbol');

    if (!rawSymbol) {
      return NextResponse.json(
        { error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    // TradingView sometimes passes `EXCHANGE:SYMBOL`. Our canonical id is the UUID (SYMBOL part).
    const symbol = rawSymbol.includes(':') ? rawSymbol.split(':').pop()! : rawSymbol;

    // Check in-memory cache first (dramatically speeds up TradingView's frequent symbol lookups)
    const cacheKey = `sym:${symbol.toLowerCase()}`;
    const cached = SYMBOL_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
          // CDN cache for faster subsequent requests
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        }
      });
    }

    // Avoid spamming dev logs: this endpoint is called frequently by the charting library

    // Canonical TradingView symbol id = Supabase market UUID (markets.id).
    // Backward compatible: if a non-UUID is provided, treat it as metric_id.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(symbol);

    const marketQuery = supabase
      .from('orderbook_markets_view')
      .select('*')
      .eq(isUuid ? 'id' : 'metric_id', symbol)
      .eq('is_active', true)
      .eq('deployment_status', 'DEPLOYED')
      .not('market_address', 'is', null);

    const { data: market, error } = await marketQuery.single();

    if (error || !market) {
      // Avoid spamming dev logs
      return NextResponse.json(
        { error: `Symbol "${symbol}" not found` },
        { status: 404 }
      );
    }

    // Determine market type from category (now an array)
    const cats = Array.isArray(market.category) ? market.category : [market.category || ''];
    const catStr = cats.join(' ').toLowerCase();
    let marketType = 'futures';
    if (catStr.includes('crypto')) marketType = 'crypto';
    else if (catStr.includes('stock')) marketType = 'stock';
    else if (catStr.includes('index') || catStr.includes('indices')) marketType = 'index';
    else if (catStr.includes('commodity') || catStr.includes('commodities')) marketType = 'commodity';

    // Calculate price scale for TradingView.
    // DO NOT use `market.decimals` here (often token decimals, not price decimals).
    const pricescale = inferPriceScale(market);

    // Build symbol info response
    // IMPORTANT:
    // - TradingView uses `ticker` as the canonical id for subsequent /history + realtime calls.
    // - Some datafeed wrappers lose non-standard fields like `custom`, so `ticker` must be stable & sufficient.
    // Therefore: always return `ticker = market UUID` and use `name` for the human label.
    const marketUuid = market?.id ? String(market.id) : null;
    const metricId = market?.metric_id ? String(market.metric_id) : null;
    const canonicalTicker = marketUuid || symbol; // uuid preferred
    const displayName = metricId || symbol;

    const symbolInfo = {
      // `ticker` is the canonical id used in subsequent /history calls.
      // `name` is what the widget typically displays to the user.
      ticker: canonicalTicker,
      name: displayName,
      description: market.description || `${displayName} Orderbook Market`,
      type: marketType,
      session: '24x7', // vAMM markets are always open
      timezone: 'Etc/UTC',
      exchange: 'ORDERBOOK',
      minmov: 1,
      pricescale: pricescale,
      has_intraday: true,
      has_no_volume: false, // vAMM markets have volume data
      has_weekly_and_monthly: true,
      supported_resolutions: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M'],
      volume_precision: 8,
      data_status: 'streaming',
      
      // Custom orderbook market data
      custom: {
        market_address: market.market_address,
        vault_address: market.central_vault_address,
        oracle_address: market.uma_oracle_manager_address,
        initial_price: market.last_trade_price,
        deployment_status: market.deployment_status,
        created_at: market.created_at,
        category: market.category,
        // Keep both ids for clients that want human label + canonical id
        market_id: marketUuid || null,
        metric_id: metricId || null
      }
    };

    // Override description to: SYMBOL (SourceLabel)
    // - SYMBOL comes from `markets.symbol` (unified markets table)
    // - SourceLabel comes from the trimmed metric URL host (e.g. TradingView / Worldometers)
    try {
      if (marketUuid) {
        const { data: row, error: mErr } = await supabase
          .from('markets')
          .select('symbol, market_config, initial_order')
          .eq('id', marketUuid)
          .maybeSingle();
        if (!mErr && row) {
          const sym =
            typeof (row as any)?.symbol === 'string' && String((row as any).symbol).trim()
              ? String((row as any).symbol).trim()
              : displayName;
          const src = metricSourceFromMarket(row as any);
          const label = src.label || src.host || null;
          symbolInfo.description = label ? `${sym} (${label})` : sym;
        }
      }
    } catch {
      // non-fatal; keep existing description
    }

    // Avoid spamming dev logs

    // Cache the result for subsequent requests
    if (SYMBOL_CACHE.size > SYMBOL_CACHE_MAX_KEYS) {
      // Best-effort safety valve
      SYMBOL_CACHE.clear();
    }
    SYMBOL_CACHE.set(cacheKey, { data: symbolInfo, expiresAt: Date.now() + SYMBOL_CACHE_TTL_MS });

    return NextResponse.json(symbolInfo, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        // CDN cache for faster subsequent requests
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      }
    });

  } catch (error) {
    console.error('❌ TradingView symbols error:', error);
    return NextResponse.json(
      { 
        error: 'Symbol lookup failed',
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