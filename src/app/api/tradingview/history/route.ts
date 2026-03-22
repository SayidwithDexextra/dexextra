// src/app/api/tradingview/history/route.ts
// Optimized TradingView UDF API with dynamic aggregation

import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// === CONNECTION PRE-WARMING + KEEP-ALIVE ===
// Eagerly establish the ClickHouse TLS connection at module load so the first
// real chart request doesn't pay the 1-3s cold-start penalty.
// Also ping periodically to prevent ClickHouse Cloud from dropping idle connections.
const KEEPALIVE_INTERVAL_MS = 30_000;
let _keepAliveTimer: ReturnType<typeof setInterval> | null = null;

const _chWarmup = (() => {
  try {
    const ch = getClickHouseDataPipeline();
    if (ch.isConfigured()) {
      ch.warmConnection().catch(() => {});
      if (!_keepAliveTimer) {
        _keepAliveTimer = setInterval(() => {
          ch.warmConnection().catch(() => {});
        }, KEEPALIVE_INTERVAL_MS);
        if (typeof _keepAliveTimer === 'object' && 'unref' in _keepAliveTimer) {
          (_keepAliveTimer as any).unref();
        }
      }
    }
  } catch {}
})();

// === TIMEOUT CONFIGURATION ===
const CLICKHOUSE_QUERY_TIMEOUT_MS = 4_000;
const SUPABASE_QUERY_TIMEOUT_MS = 2_000;
type CachedHistory = { expiresAt: number; staleAt: number; body: any; headers: Record<string, string> };
const HISTORY_CACHE = new Map<string, CachedHistory>();
const HISTORY_CACHE_MAX_KEYS = 500;
// Track which keys are currently being revalidated to avoid duplicate fetches
const SWR_INFLIGHT = new Set<string>();
// Stale entries can be served for up to 2x the TTL while revalidating in the background
const SWR_GRACE_MULTIPLIER = 2;

// Timeframe-aware cache TTLs — longer TFs change less frequently, cache longer
const HISTORY_CACHE_TTL_BY_TF: Record<string, number> = {
  '1m': 10_000,
  '5m': 25_000,
  '15m': 40_000,
  '30m': 55_000,
  '1h': 55_000,
  '4h': 120_000,
  '1d': 300_000,
  '1w': 600_000,
  '1mo': 600_000,
};
const HISTORY_CACHE_TTL_DEFAULT_MS = 15_000;

type CachedMarketUuid = { expiresAt: number; id: string };
const MARKET_UUID_CACHE = new Map<string, CachedMarketUuid>();
const MARKET_UUID_CACHE_TTL_MS = 30 * 60_000;
const MARKET_UUID_CACHE_MAX_KEYS = 1000;


// Cache for failed/slow market queries to prevent hammering
type CachedFailedQuery = { expiresAt: number; reason: string };
const FAILED_QUERY_CACHE = new Map<string, CachedFailedQuery>();
const FAILED_QUERY_CACHE_TTL_MS = 30_000; // 30 seconds backoff for failed queries

/**
 * Race a promise against a timeout. Returns null on timeout.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label?: string
): Promise<T | null> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      if (label) console.warn(`⚠️ Timeout after ${timeoutMs}ms: ${label}`);
      resolve(null);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (e) {
    clearTimeout(timeoutId!);
    throw e;
  }
}

function isDevSeedEnabled(): boolean {
  // Safety: disable by default in production. You can explicitly allow it with CHARTS_DEV_SEED=1.
  if (process.env.CHARTS_DEV_SEED === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

// TradingView resolution to our timeframe mapping
const RESOLUTION_MAP: Record<string, string> = {
  '1': '1m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1h',
  '240': '4h',
  '1D': '1d',
  'D': '1d',
  '1W': '1w',
  'W': '1w',
  '1M': '1mo',
  'M': '1mo',
};

const TIMEFRAME_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 5 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1d': 24 * 60 * 60,
  '1w': 7 * 24 * 60 * 60,
  // Approximation: month length varies; this is only used to clamp overly-large ranges.
  '1mo': 30 * 24 * 60 * 60,
};

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Background revalidation for stale-while-revalidate cache strategy.
 * Runs without blocking the response — updates the cache for the next request.
 */
async function revalidateHistoryCache(
  cacheKey: string,
  symbol: string,
  isUuid: boolean,
  timeframe: string,
  limit: number,
  startTime: Date,
  endTime: Date,
  ttl: number,
  clickhouse: ReturnType<typeof getClickHouseDataPipeline>
): Promise<void> {
  try {
    const marketUuid = isUuid ? symbol : undefined;
    const candles = await clickhouse.getOHLCVCandles(
      marketUuid ? undefined : symbol,
      timeframe,
      limit,
      startTime,
      endTime,
      marketUuid
    );
    if (candles && candles.length > 0) {
      const t: number[] = [];
      const o: number[] = [];
      const h: number[] = [];
      const l: number[] = [];
      const c: number[] = [];
      const v: number[] = [];
      candles.forEach(candle => {
        t.push(candle.time);
        o.push(candle.open);
        h.push(candle.high);
        l.push(candle.low);
        c.push(candle.close);
        v.push(candle.volume);
      });
      const body = { s: 'ok', t, o, h, l, c, v, meta: { count: candles.length, symbol, timeframe, architecture: 'dynamic_aggregation' } };
      const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*' };
      const now = Date.now();
      HISTORY_CACHE.set(cacheKey, { expiresAt: now + ttl, staleAt: now + ttl * SWR_GRACE_MULTIPLIER, body, headers });
    }
  } catch {
    // Revalidation failure is non-fatal — stale data continues to be served
  }
}

export async function GET(request: NextRequest) {
  try {
    const t0 = Date.now();
    const { searchParams } = new URL(request.url);
    
    const rawSymbol = searchParams.get('symbol');
    const resolution = searchParams.get('resolution');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const countbackParam = searchParams.get('countback');
    const debugSeed =
      (searchParams.get('debugSeed') === '1' || searchParams.get('seed') === '1') && isDevSeedEnabled();

    // Validate required parameters
    if (!rawSymbol || !resolution || !from || !to) {
      return NextResponse.json(
        { s: 'error', errmsg: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // TradingView sometimes passes `EXCHANGE:SYMBOL`. Our canonical id is the UUID (SYMBOL part).
    const symbol = rawSymbol.includes(':') ? rawSymbol.split(':').pop()! : rawSymbol;

    // Map TradingView resolution to our timeframe
    const timeframe = RESOLUTION_MAP[resolution];
    if (!timeframe) {
      return NextResponse.json(
        { s: 'error', errmsg: `Unsupported resolution: ${resolution}` },
        { status: 400 }
      );
    }

    // Parse timestamps
    const startTime = new Date(parseInt(from) * 1000);
    const endTime = new Date(parseInt(to) * 1000);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return NextResponse.json(
        { s: 'error', errmsg: 'Invalid timestamp format' },
        { status: 400 }
      );
    }

    // TradingView passes `countback` (bars requested). If we ignore it and honor a huge `from`,
    // ClickHouse can end up scanning/sorting a massive range for no reason.
    // OPTIMIZATION: Cap at 500 bars for initial load, which is plenty for most charts
    const requestedCountback = countbackParam ? parseInt(countbackParam, 10) : NaN;
    const limit = clampInt(Number.isFinite(requestedCountback) ? requestedCountback : 200, 1, 500);

    const tfSec = TIMEFRAME_SECONDS[timeframe] || 60;
    // OPTIMIZATION: Clamp time range more aggressively - only look back 1.5x the requested bars
    // This dramatically reduces the amount of data ClickHouse needs to scan
    const lookbackSec = limit * tfSec * 1.5;
    const clampedStartMs = Math.max(startTime.getTime(), endTime.getTime() - lookbackSec * 1000);
    const effectiveStartTime = new Date(clampedStartMs);

    // Get the ClickHouse pipeline
    const clickhouse = getClickHouseDataPipeline();

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(symbol);

    // Check if this market recently failed - skip expensive queries
    const failedCacheKey = `failed:${symbol}:${timeframe}`;
    const cachedFailed = FAILED_QUERY_CACHE.get(failedCacheKey);
    if (cachedFailed && cachedFailed.expiresAt > Date.now()) {
      return NextResponse.json(
        { s: 'no_data', nextTime: Math.floor(endTime.getTime() / 1000) + tfSec },
        { 
          headers: { 
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
            'X-Failed-Cache': '1',
            'X-Failed-Reason': cachedFailed.reason,
          } 
        }
      );
    }

    // ── EARLY CACHE CHECK ──
    // Check cache BEFORE Supabase/ClickHouse so cached results skip all I/O.
    // Bucket the end-time by timeframe so TradingView's per-second polling
    // reuses cache entries instead of causing a miss every single second.
    const cacheBucketSec = Math.max(tfSec, 10);
    const rawToSec = Math.floor(endTime.getTime() / 1000);
    const bucketedToSec = Math.floor(rawToSec / cacheBucketSec) * cacheBucketSec;

    const cacheKey = [
      `sym:${symbol}`,
      `tf:${timeframe}`,
      `from:${Math.floor(effectiveStartTime.getTime() / 1000)}`,
      `to:${bucketedToSec}`,
      `limit:${limit}`,
    ].join('|');

    const historyCacheTtl = HISTORY_CACHE_TTL_BY_TF[timeframe] ?? HISTORY_CACHE_TTL_DEFAULT_MS;

    const cached = HISTORY_CACHE.get(cacheKey);
    const now = Date.now();
    if (cached) {
      if (cached.expiresAt > now) {
        // Fresh cache hit — serve immediately
        return NextResponse.json(cached.body, {
          headers: { ...cached.headers, 'X-Cache': 'HIT' },
        });
      }
      if (cached.staleAt > now) {
        // Stale but within grace window — serve stale immediately while revalidating
        // Fire a background revalidation (non-blocking) if not already in-flight
        if (!SWR_INFLIGHT.has(cacheKey)) {
          SWR_INFLIGHT.add(cacheKey);
          // The revalidation will update the cache entry for subsequent requests
          // We don't await this — it runs in the background
          revalidateHistoryCache(cacheKey, symbol, isUuid, timeframe, limit, effectiveStartTime, endTime, historyCacheTtl, clickhouse)
            .finally(() => SWR_INFLIGHT.delete(cacheKey));
        }
        return NextResponse.json(cached.body, {
          headers: { ...cached.headers, 'X-Cache': 'STALE' },
        });
      }
    }
    if (HISTORY_CACHE.size > HISTORY_CACHE_MAX_KEYS) {
      HISTORY_CACHE.clear();
    }

    // ── UUID RESOLUTION + CLICKHOUSE QUERY (parallelized) ──
    // When the symbol is already a UUID, skip Supabase entirely and go straight to ClickHouse.
    // When it's NOT a UUID, fire Supabase lookup AND a speculative symbol-based ClickHouse query
    // in parallel so neither blocks the other.
    const tResolve0 = Date.now();
    let tCh0 = tResolve0;
    let marketUuid: string | undefined;
    let candles: Awaited<ReturnType<typeof clickhouse.getOHLCVCandles>>;

    if (isUuid) {
      // Fast path: symbol IS the UUID — skip Supabase, query ClickHouse directly
      marketUuid = symbol;
      tCh0 = Date.now();
      try {
        const candlesResult = await withTimeout(
          clickhouse.getOHLCVCandles(undefined, timeframe, limit, effectiveStartTime, endTime, marketUuid),
          CLICKHOUSE_QUERY_TIMEOUT_MS,
          `OHLCV candles for ${marketUuid}`
        );
        if (candlesResult === null) {
          FAILED_QUERY_CACHE.set(failedCacheKey, { expiresAt: Date.now() + FAILED_QUERY_CACHE_TTL_MS, reason: 'timeout' });
          return NextResponse.json(
            { s: 'no_data', nextTime: Math.floor(endTime.getTime() / 1000) + tfSec },
            { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'X-Timeout': '1' } }
          );
        }
        candles = candlesResult;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'unknown';
        console.error(`❌ ClickHouse query failed for ${marketUuid}:`, errorMsg);
        FAILED_QUERY_CACHE.set(failedCacheKey, { expiresAt: Date.now() + FAILED_QUERY_CACHE_TTL_MS, reason: errorMsg.slice(0, 50) });
        return NextResponse.json(
          { s: 'no_data', nextTime: Math.floor(endTime.getTime() / 1000) + tfSec },
          { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'X-Error': '1' } }
        );
      }
    } else {
      // Slow path: need UUID resolution. Check cache first, then parallelize Supabase + ClickHouse.
      const cachedMarket = MARKET_UUID_CACHE.get(symbol);
      if (cachedMarket && cachedMarket.expiresAt > Date.now()) {
        marketUuid = cachedMarket.id;
      } else if (MARKET_UUID_CACHE.size > MARKET_UUID_CACHE_MAX_KEYS) {
        MARKET_UUID_CACHE.clear();
      }

      if (marketUuid) {
        // UUID was in cache — query ClickHouse directly
        try {
          const candlesResult = await withTimeout(
            clickhouse.getOHLCVCandles(undefined, timeframe, limit, effectiveStartTime, endTime, marketUuid),
            CLICKHOUSE_QUERY_TIMEOUT_MS,
            `OHLCV candles for ${marketUuid}`
          );
          if (candlesResult === null) {
            FAILED_QUERY_CACHE.set(failedCacheKey, { expiresAt: Date.now() + FAILED_QUERY_CACHE_TTL_MS, reason: 'timeout' });
            return NextResponse.json(
              { s: 'no_data', nextTime: Math.floor(endTime.getTime() / 1000) + tfSec },
              { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'X-Timeout': '1' } }
            );
          }
          candles = candlesResult;
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : 'unknown';
          console.error(`❌ ClickHouse query failed for ${marketUuid}:`, errorMsg);
          FAILED_QUERY_CACHE.set(failedCacheKey, { expiresAt: Date.now() + FAILED_QUERY_CACHE_TTL_MS, reason: errorMsg.slice(0, 50) });
          return NextResponse.json(
            { s: 'no_data', nextTime: Math.floor(endTime.getTime() / 1000) + tfSec },
            { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'X-Error': '1' } }
          );
        }
      } else {
        // UUID not cached — fire Supabase + speculative ClickHouse query in parallel
        const supabasePromise = withTimeout(
          supabase.from('orderbook_markets_view').select('id').eq('metric_id', symbol).limit(1).maybeSingle(),
          SUPABASE_QUERY_TIMEOUT_MS,
          `Supabase market lookup for ${symbol}`
        ).catch(() => null);

        const symbolCandlesPromise = withTimeout(
          clickhouse.getOHLCVCandles(symbol, timeframe, limit, effectiveStartTime, endTime, undefined),
          CLICKHOUSE_QUERY_TIMEOUT_MS,
          `OHLCV candles (symbol) for ${symbol}`
        ).catch(() => null);

        const [supabaseResult, symbolCandles] = await Promise.all([supabasePromise, symbolCandlesPromise]);

        if (supabaseResult?.data?.id) {
          marketUuid = String(supabaseResult.data.id);
          MARKET_UUID_CACHE.set(symbol, { id: marketUuid, expiresAt: Date.now() + MARKET_UUID_CACHE_TTL_MS });

          // Re-query by UUID for canonical results (the speculative symbol query may not match)
          try {
            const uuidCandles = await withTimeout(
              clickhouse.getOHLCVCandles(undefined, timeframe, limit, effectiveStartTime, endTime, marketUuid),
              CLICKHOUSE_QUERY_TIMEOUT_MS,
              `OHLCV candles (uuid) for ${marketUuid}`
            );
            candles = uuidCandles ?? [];
          } catch {
            candles = symbolCandles ?? [];
          }
        } else {
          candles = symbolCandles ?? [];
        }
      }
    }
    const tResolve1 = Date.now();
    const tCh1 = Date.now();

    // Some older dev seed runs accidentally inserted OHLCV with price=0 due to empty-query-param parsing.
    // If we're in a debugSeed session and all OHLC are 0, treat it as empty and reseed/repair.
    const looksLikeAllZero =
      candles.length > 0 && candles.every((x) => (x.open || 0) === 0 && (x.high || 0) === 0 && (x.low || 0) === 0 && (x.close || 0) === 0);

    // Handle no data case — candlesticks only render from ohlcv trade data, never from metric_series.
    // The metric overlay (Live Metric Tracker) is the sole consumer of metric_series_1m.
    if (candles.length === 0 || (debugSeed && looksLikeAllZero)) {
      const body = {
        s: 'no_data',
        nextTime: Math.floor(endTime.getTime() / 1000) + tfSec,
      };
      const headers: Record<string, string> = {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Server-Timing': [
          `supabase;dur=${tResolve1 - tResolve0}`,
          `clickhouse;dur=${tCh1 - tCh0}`,
          `total;dur=${Date.now() - t0}`,
        ].join(', '),
        'X-No-Data': '1',
      };
      const _now2 = Date.now();
      HISTORY_CACHE.set(cacheKey, { expiresAt: _now2 + 5_000, staleAt: _now2 + 10_000, body, headers });
      return NextResponse.json(body, { headers });
    }

    // Convert to TradingView format
    const t: number[] = []; // time
    const o: number[] = []; // open
    const h: number[] = []; // high
    const l: number[] = []; // low
    const c: number[] = []; // close
    const v: number[] = []; // volume

    candles.forEach(candle => {
      t.push(candle.time);
      o.push(candle.open);
      h.push(candle.high);
      l.push(candle.low);
      c.push(candle.close);
      v.push(candle.volume);
    });

    const body = {
      s: 'ok',
      t,
      o,
      h,
      l,
      c,
      v,
      meta: {
        count: candles.length,
        symbol,
        resolution,
        timeframe,
        architecture: 'dynamic_aggregation'
      }
    };

    // Tiered CDN cache: higher timeframes change less frequently, cache longer
    const tfCacheSec = tfSec >= 14400 ? 30 : tfSec >= 3600 ? 15 : tfSec >= 300 ? 5 : 3;

    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, s-maxage=${tfCacheSec}, stale-while-revalidate=30`,
      'Server-Timing': [
        `supabase;dur=${tResolve1 - tResolve0}`,
        `clickhouse;dur=${tCh1 - tCh0}`,
        `total;dur=${Date.now() - t0}`,
      ].join(', '),
      'X-Cache': 'MISS',
    };
    const _now3 = Date.now();
    HISTORY_CACHE.set(cacheKey, { expiresAt: _now3 + historyCacheTtl, staleAt: _now3 + historyCacheTtl * SWR_GRACE_MULTIPLIER, body, headers });
    return NextResponse.json(body, { headers });

  } catch (error) {
    console.error('❌ TradingView history API error:', error);
    return NextResponse.json(
      { 
        s: 'error',
        errmsg: error instanceof Error ? error.message : 'Unknown error'
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
  })
} 