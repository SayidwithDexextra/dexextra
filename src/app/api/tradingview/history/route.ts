// src/app/api/tradingview/history/route.ts
// Optimized TradingView UDF API with dynamic aggregation

import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client';
import { createClient } from '@supabase/supabase-js';
import { createClient as createClickHouseClient } from '@clickhouse/client';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// === CONNECTION PRE-WARMING ===
// Eagerly establish the ClickHouse TLS connection at module load so the first
// real chart request doesn't pay the 1-3s cold-start penalty.
const _chWarmup = (() => {
  try {
    const ch = getClickHouseDataPipeline();
    if (ch.isConfigured()) ch.warmConnection().catch(() => {});
  } catch {}
})();

// === TIMEOUT CONFIGURATION ===
const CLICKHOUSE_QUERY_TIMEOUT_MS = 4_000;
const SUPABASE_QUERY_TIMEOUT_MS = 2_000;
const METRIC_SERIES_TIMEOUT_MS = 3_000;

type CachedHistory = { expiresAt: number; body: any; headers: Record<string, string> };
const HISTORY_CACHE = new Map<string, CachedHistory>();
const HISTORY_CACHE_MAX_KEYS = 500;

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

// Cache for metric name resolution (avoids repeated Supabase queries for the same market)
type CachedMetricName = { expiresAt: number; name: string };
const METRIC_NAME_CACHE = new Map<string, CachedMetricName>();
const METRIC_NAME_CACHE_TTL_MS = 5 * 60_000;

// Cache for "no metric data" results to avoid repeated ClickHouse queries for sparse markets
type CachedNoMetricData = { expiresAt: number };
const NO_METRIC_DATA_CACHE = new Map<string, CachedNoMetricData>();
const NO_METRIC_DATA_CACHE_TTL_MS = 60_000; // 60 seconds - increased to reduce repeated expensive queries

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

// Metric-series only supports these canonical buckets.
const METRIC_TF_ALLOWED = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureClickHouseUrl(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}

function escapeSqlString(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

type MetricOhlcv = {
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  count: number;
};

async function resolveMetricNameForMarketUuid(marketUuid: string, fallbackSymbol: string): Promise<string> {
  const id = String(marketUuid || '').trim();
  if (!id) return String(fallbackSymbol || '').toUpperCase();
  
  // Check cache first to avoid repeated Supabase queries
  const cached = METRIC_NAME_CACHE.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.name;
  }
  
  try {
    // Prefer orderbook markets view (this is what TradingView uses).
    // Wrap in timeout to fail fast
    const result = await withTimeout(
      supabase
        .from('orderbook_markets_view')
        .select('metric_id, symbol')
        .eq('id', id)
        .limit(1)
        .maybeSingle(),
      SUPABASE_QUERY_TIMEOUT_MS,
      `metric name lookup for ${id}`
    );
    const m = (result?.data as any)?.metric_id || (result?.data as any)?.symbol;
    if (m) {
      const name = String(m).toUpperCase();
      METRIC_NAME_CACHE.set(id, { name, expiresAt: Date.now() + METRIC_NAME_CACHE_TTL_MS });
      return name;
    }
  } catch {
    // ignore
  }
  try {
    // Fallback: legacy markets table with timeout
    const result = await withTimeout(
      supabase.from('markets').select('market_identifier, symbol').eq('id', id).limit(1).maybeSingle(),
      SUPABASE_QUERY_TIMEOUT_MS,
      `legacy market lookup for ${id}`
    );
    const sym = (result?.data as any)?.market_identifier || (result?.data as any)?.symbol;
    if (sym) {
      const name = String(sym).toUpperCase();
      METRIC_NAME_CACHE.set(id, { name, expiresAt: Date.now() + METRIC_NAME_CACHE_TTL_MS });
      return name;
    }
  } catch {
    // ignore
  }
  const fallback = String(fallbackSymbol || '').toUpperCase();
  METRIC_NAME_CACHE.set(id, { name: fallback, expiresAt: Date.now() + METRIC_NAME_CACHE_TTL_MS });
  return fallback;
}

/**
 * Reusable ClickHouse client for metric series queries (singleton pattern).
 * Avoids creating new connections for each request.
 */
let metricSeriesClient: ReturnType<typeof createClickHouseClient> | null = null;

function getMetricSeriesClient() {
  if (metricSeriesClient) return metricSeriesClient;
  
  const url = ensureClickHouseUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  if (!url) return null;

  metricSeriesClient = createClickHouseClient({
    url,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || 'default',
    request_timeout: METRIC_SERIES_TIMEOUT_MS,
    // Keep connections alive for reuse
    keep_alive: { enabled: true },
    // Enable compression for faster data transfer
    compression: { request: true, response: true },
    // ClickHouse settings for faster queries
    clickhouse_settings: {
      max_threads: 4,
      optimize_move_to_prewhere: 1,
    },
  });
  
  return metricSeriesClient;
}

async function fetchMetricSeriesAsOhlcv(params: {
  marketUuid: string;
  metricName: string;
  timeframe: string;
  limit: number;
  startTime: Date;
  endTime: Date;
}): Promise<MetricOhlcv | null> {
  const { marketUuid, metricName, timeframe, limit, startTime, endTime } = params;
  if (!METRIC_TF_ALLOWED.has(timeframe)) return null;

  const client = getMetricSeriesClient();
  if (!client) return null;

  const safeMarketId = escapeSqlString(marketUuid);
  const safeMetricName = escapeSqlString(metricName);

  const startEpochSec = Math.floor(startTime.getTime() / 1000);
  const endEpochSec = Math.floor(endTime.getTime() / 1000);

  // Finalize 1m values (last) then optionally roll up to the requested bucket.
  // Use PREWHERE for indexed columns (market_id, ts) for faster filtering
  const baseSeries = `
    SELECT
      ts,
      argMaxMerge(latest_value) AS v
    FROM metric_series_1m
    PREWHERE market_id = '${safeMarketId}'
      AND ts >= toDateTime(${startEpochSec})
      AND ts <= toDateTime(${endEpochSec})
    WHERE metric_name = '${safeMetricName}'
    GROUP BY ts
    ORDER BY ts ASC
    SETTINGS max_threads = 4, optimize_read_in_order = 1
  `;

  const tfMinutes =
    timeframe === '1m'
      ? 1
      : timeframe === '5m'
        ? 5
        : timeframe === '15m'
          ? 15
          : timeframe === '30m'
            ? 30
            : timeframe === '1h'
              ? 60
              : timeframe === '4h'
                ? 240
                : 1440; // 1d

  const rolled =
    timeframe === '1m'
      ? `(${baseSeries})`
      : `
        (
          SELECT
            toDateTime64(toStartOfInterval(ts, INTERVAL ${tfMinutes} MINUTE, 'UTC'), 3, 'UTC') AS ts,
            avg(v) AS v
          FROM (${baseSeries})
          GROUP BY ts
          ORDER BY ts ASC
        )
      `;

  // Query with optimized settings for fast retrieval
  const query = `
    SELECT
      toUnixTimestamp(ts) AS time,
      v AS open,
      v AS high,
      v AS low,
      v AS close,
      0 AS volume
    FROM (${rolled})
    ORDER BY ts DESC
    LIMIT ${Math.max(1, Math.min(limit, 500))}
    SETTINGS max_execution_time = 5, max_threads = 4
  `;

  try {
    // Wrap in timeout for additional safety
    const queryPromise = async () => {
      const result = await client.query({ query, format: 'JSONEachRow' });
      return (await result.json()) as Array<{
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>;
    };
    
    const rows = await withTimeout(queryPromise(), METRIC_SERIES_TIMEOUT_MS, `metric_series query for ${marketUuid}`);
    
    if (!rows || !Array.isArray(rows) || rows.length === 0) return null;
    const ordered = rows.slice().reverse(); // oldest -> newest

    const t: number[] = [];
    const o: number[] = [];
    const h: number[] = [];
    const l: number[] = [];
    const c: number[] = [];
    const v: number[] = [];

    for (const r of ordered) {
      t.push(Number(r.time));
      o.push(Number(r.open));
      h.push(Number(r.high));
      l.push(Number(r.low));
      c.push(Number(r.close));
      v.push(Number(r.volume));
    }

    return { t, o, h, l, c, v, count: ordered.length };
  } catch (e) {
    // Don't close the shared client on error
    console.warn(`⚠️ Metric series query failed for ${marketUuid}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// REMOVED: generateSeedCandles1m function - synthetic OHLCV seeding to market_ticks/ohlcv_1m is disabled.
// Metric-only markets should rely on metric_series_1m fallback instead.

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
    const limit = clampInt(Number.isFinite(requestedCountback) ? requestedCountback : 300, 1, 500);

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
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.body, {
        headers: {
          ...cached.headers,
          'X-Cache': 'HIT',
        },
      });
    }
    if (HISTORY_CACHE.size > HISTORY_CACHE_MAX_KEYS) {
      HISTORY_CACHE.clear();
    }

    // ── UUID RESOLUTION ──
    // Only reached on cache miss. Resolve metric_id → market_uuid for ClickHouse.
    const tResolve0 = Date.now();
    let marketUuid: string | undefined;
    if (isUuid) {
      marketUuid = symbol;
    } else {
      const cachedMarket = MARKET_UUID_CACHE.get(symbol);
      if (cachedMarket && cachedMarket.expiresAt > Date.now()) {
        marketUuid = cachedMarket.id;
      } else {
        if (MARKET_UUID_CACHE.size > MARKET_UUID_CACHE_MAX_KEYS) {
          MARKET_UUID_CACHE.clear();
        }
      }
      try {
        if (!marketUuid) {
          const supabaseResult = await withTimeout(
            supabase
              .from('orderbook_markets_view')
              .select('id')
              .eq('metric_id', symbol)
              .limit(1)
              .maybeSingle(),
            SUPABASE_QUERY_TIMEOUT_MS,
            `Supabase market lookup for ${symbol}`
          );
          if (supabaseResult?.data?.id) {
            marketUuid = String(supabaseResult.data.id);
            MARKET_UUID_CACHE.set(symbol, { id: marketUuid, expiresAt: Date.now() + MARKET_UUID_CACHE_TTL_MS });
          }
        }
      } catch {
        // proceed without market UUID
      }
    }
    const tResolve1 = Date.now();

    // Fetch candles using dynamic aggregation with timeout protection.
    // Prefer market_uuid filtering (canonical). If we can't resolve, fall back to symbol filtering.
    const tCh0 = Date.now();
    let candles: Awaited<ReturnType<typeof clickhouse.getOHLCVCandles>>;
    try {
      const candlesResult = await withTimeout(
        clickhouse.getOHLCVCandles(
          marketUuid ? undefined : symbol,
          timeframe,
          limit,
          effectiveStartTime,
          endTime,
          marketUuid
        ),
        CLICKHOUSE_QUERY_TIMEOUT_MS,
        `OHLCV candles for ${marketUuid || symbol}`
      );
      
      if (candlesResult === null) {
        // Timeout occurred - cache this failure and return no_data quickly
        FAILED_QUERY_CACHE.set(failedCacheKey, { 
          expiresAt: Date.now() + FAILED_QUERY_CACHE_TTL_MS, 
          reason: 'timeout' 
        });
        return NextResponse.json(
          { s: 'no_data', nextTime: Math.floor(endTime.getTime() / 1000) + tfSec },
          { 
            headers: { 
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
              'X-Timeout': '1',
            } 
          }
        );
      }
      candles = candlesResult;
    } catch (e) {
      // Query failed - cache the failure and return no_data
      const errorMsg = e instanceof Error ? e.message : 'unknown';
      console.error(`❌ ClickHouse query failed for ${marketUuid || symbol}:`, errorMsg);
      FAILED_QUERY_CACHE.set(failedCacheKey, { 
        expiresAt: Date.now() + FAILED_QUERY_CACHE_TTL_MS, 
        reason: errorMsg.slice(0, 50) 
      });
      return NextResponse.json(
        { s: 'no_data', nextTime: Math.floor(endTime.getTime() / 1000) + tfSec },
        { 
          headers: { 
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
            'X-Error': '1',
          } 
        }
      );
    }
    const tCh1 = Date.now();

    // Some older dev seed runs accidentally inserted OHLCV with price=0 due to empty-query-param parsing.
    // If we're in a debugSeed session and all OHLC are 0, treat it as empty and reseed/repair.
    const looksLikeAllZero =
      candles.length > 0 && candles.every((x) => (x.open || 0) === 0 && (x.high || 0) === 0 && (x.low || 0) === 0 && (x.close || 0) === 0);

    // Handle no data case
    if (candles.length === 0 || (debugSeed && looksLikeAllZero)) {
      // If OHLCV is empty, attempt to synthesize bars from ClickHouse metric-series.
      // This enables "metric-only" charts (indicator without candles) while still giving TradingView
      // a time axis for studies (`context.symbol.time`).
      if (marketUuid && clickhouse.isConfigured() && METRIC_TF_ALLOWED.has(timeframe)) {
        // OPTIMIZATION: Check if we recently determined this market has no metric data
        // This avoids repeated expensive ClickHouse queries for sparse markets
        const noDataCacheKey = `noMetric:${marketUuid}:${timeframe}`;
        const cachedNoData = NO_METRIC_DATA_CACHE.get(noDataCacheKey);
        const skipMetricFallback = cachedNoData && cachedNoData.expiresAt > Date.now();
        
        if (!skipMetricFallback) {
          try {
            const metricName = await resolveMetricNameForMarketUuid(marketUuid, symbol);
            const metricBars = await fetchMetricSeriesAsOhlcv({
              marketUuid,
              metricName,
              timeframe,
              limit,
              startTime: effectiveStartTime,
              endTime,
            });
            if (metricBars && metricBars.count > 0) {
              const body = {
                s: 'ok',
                t: metricBars.t,
                o: metricBars.o,
                h: metricBars.h,
                l: metricBars.l,
                c: metricBars.c,
                v: metricBars.v,
                meta: {
                  count: metricBars.count,
                  symbol,
                  resolution,
                  timeframe,
                  architecture: 'metric_series_fallback',
                  marketUuid,
                  metricName,
                },
              };

              const headers: Record<string, string> = {
                'Access-Control-Allow-Origin': '*',
                // Short cache like normal history responses; safe because metric-series changes are frequent but not per-request.
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=30',
                'Server-Timing': [
                  `supabase;dur=${tResolve1 - tResolve0}`,
                  `clickhouse;dur=${tCh1 - tCh0}`,
                  `total;dur=${Date.now() - t0}`,
                ].join(', '),
                'X-Cache': 'MISS',
                'X-Metric-Bars': '1',
              };
              HISTORY_CACHE.set(cacheKey, { expiresAt: Date.now() + historyCacheTtl, body, headers });
              return NextResponse.json(body, { headers });
            } else {
              // Cache that this market has no metric data to avoid repeated queries
              NO_METRIC_DATA_CACHE.set(noDataCacheKey, { expiresAt: Date.now() + NO_METRIC_DATA_CACHE_TTL_MS });
            }
          } catch {
            // Cache the failure to avoid repeated attempts
            NO_METRIC_DATA_CACHE.set(noDataCacheKey, { expiresAt: Date.now() + NO_METRIC_DATA_CACHE_TTL_MS });
            // ignore and fall through to debug seed / no_data
          }
        }
      }

      // DISABLED: Debug seed to market_ticks/ohlcv_1m has been removed.
      // Metric-only markets should use metric_series_1m fallback above instead of synthetic OHLCV data.
      // The metric overlay line (Live Metric Tracker) reads from metric_series_1m which is populated
      // by the metric-ai-worker via POST /api/charts/metric → metric_series_raw.
      if (debugSeed && marketUuid) {
        console.log('[TradingView History] debugSeed requested but synthetic OHLCV seeding is disabled. Using metric_series fallback only.');
      }

      // OPTIMIZATION: Use a short in-memory cache for `no_data` responses (5 seconds).
      // This prevents rapid-fire requests from hammering the database while still allowing
      // new data to be picked up reasonably quickly. CDN cache is still disabled to ensure
      // freshness across server instances.
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
      // Short in-memory cache to prevent hammering DB on repeated no_data requests
      HISTORY_CACHE.set(cacheKey, { expiresAt: Date.now() + 5_000, body, headers });
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
    HISTORY_CACHE.set(cacheKey, { expiresAt: Date.now() + historyCacheTtl, body, headers });
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