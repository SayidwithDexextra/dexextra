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

type CachedHistory = { expiresAt: number; body: any; headers: Record<string, string> };
const HISTORY_CACHE = new Map<string, CachedHistory>();
const HISTORY_CACHE_TTL_MS = 15_000;
const HISTORY_CACHE_MAX_KEYS = 500;

type CachedMarketUuid = { expiresAt: number; id: string };
const MARKET_UUID_CACHE = new Map<string, CachedMarketUuid>();
const MARKET_UUID_CACHE_TTL_MS = 5 * 60_000;
const MARKET_UUID_CACHE_MAX_KEYS = 1000;

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
  try {
    // Prefer orderbook markets view (this is what TradingView uses).
    const { data: ob } = await supabase
      .from('orderbook_markets_view')
      .select('metric_id, symbol')
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    const m = (ob as any)?.metric_id || (ob as any)?.symbol;
    if (m) return String(m).toUpperCase();
  } catch {
    // ignore
  }
  try {
    // Fallback: legacy markets table
    const { data: m } = await supabase.from('markets').select('market_identifier, symbol').eq('id', id).limit(1).maybeSingle();
    const sym = (m as any)?.market_identifier || (m as any)?.symbol;
    if (sym) return String(sym).toUpperCase();
  } catch {
    // ignore
  }
  return String(fallbackSymbol || '').toUpperCase();
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

  const url = ensureClickHouseUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  if (!url) return null;

  const client = createClickHouseClient({
    url,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || 'default',
    request_timeout: 30000,
  });

  const safeMarketId = escapeSqlString(marketUuid);
  const safeMetricName = escapeSqlString(metricName);

  const startEpochSec = Math.floor(startTime.getTime() / 1000);
  const endEpochSec = Math.floor(endTime.getTime() / 1000);

  // Finalize 1m values (last) then optionally roll up to the requested bucket.
  const baseSeries = `
    SELECT
      ts,
      argMaxMerge(latest_value) AS v
    FROM metric_series_1m
    WHERE market_id = '${safeMarketId}'
      AND metric_name = '${safeMetricName}'
      AND ts >= toDateTime(${startEpochSec})
      AND ts <= toDateTime(${endEpochSec})
    GROUP BY ts
    ORDER BY ts ASC
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
    LIMIT ${Math.max(1, Math.min(limit, 2000))}
  `;

  try {
    const result = await client.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;
    await client.close();

    if (!Array.isArray(rows) || rows.length === 0) return null;
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
    try { await client.close(); } catch {}
    return null;
  }
}

function generateSeedCandles1m(params: {
  marketUuid: string;
  minutes: number;
  endTime: Date;
  basePrice: number;
  amplitude: number;
}) {
  const { marketUuid, minutes, endTime, basePrice, amplitude } = params;
  const out: Array<{
    symbol: string;
    ts: Date;
    price: number;
    size: number;
    event_type: string;
    is_long: boolean;
    event_id: string;
    trade_count: number;
    market_id: number;
    contract_address: string;
    market_uuid: string;
  }> = [];

  const endMs = endTime.getTime();
  const endAligned = Math.floor(endMs / 60_000) * 60_000;
  const startMs = endAligned - (minutes - 1) * 60_000;

  // Use a stable symbol label for storage; history queries filter by market_uuid anyway.
  const symbolForStorage = 'BTC';

  for (let i = 0; i < minutes; i++) {
    const minuteStartMs = startMs + i * 60_000;
    const base = new Date(minuteStartMs);

    // Synthetic but smooth-ish pattern
    const phase = i / 20;
    const open = basePrice + Math.sin(phase) * amplitude;
    const close = basePrice + Math.sin(phase + 0.3) * amplitude;
    const high = Math.max(open, close) + Math.abs(Math.cos(phase)) * (amplitude / 5);
    const low = Math.min(open, close) - Math.abs(Math.sin(phase)) * (amplitude / 5);
    const vol = 1 + Math.abs(Math.sin(phase)) * 3;

    const candleKey = `${marketUuid}:${minuteStartMs}`;
    out.push(
      {
        symbol: symbolForStorage,
        ts: new Date(minuteStartMs),
        price: open,
        size: vol,
        event_type: 'open',
        is_long: true,
        event_id: `seed:${candleKey}:0_open`,
        trade_count: 0,
        market_id: 0,
        contract_address: '',
        market_uuid: marketUuid,
      },
      {
        symbol: symbolForStorage,
        ts: new Date(minuteStartMs + 15_000),
        price: high,
        size: 0,
        event_type: 'high',
        is_long: true,
        event_id: `seed:${candleKey}:1_high`,
        trade_count: 0,
        market_id: 0,
        contract_address: '',
        market_uuid: marketUuid,
      },
      {
        symbol: symbolForStorage,
        ts: new Date(minuteStartMs + 30_000),
        price: low,
        size: 0,
        event_type: 'low',
        is_long: false,
        event_id: `seed:${candleKey}:2_low`,
        trade_count: 0,
        market_id: 0,
        contract_address: '',
        market_uuid: marketUuid,
      },
      {
        symbol: symbolForStorage,
        ts: new Date(minuteStartMs + 45_000),
        price: close,
        size: 0,
        event_type: 'close',
        is_long: true,
        event_id: `seed:${candleKey}:3_close`,
        trade_count: 0,
        market_id: 0,
        contract_address: '',
        market_uuid: marketUuid,
      }
    );
  }

  return out;
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
    const requestedCountback = countbackParam ? parseInt(countbackParam, 10) : NaN;
    const limit = clampInt(Number.isFinite(requestedCountback) ? requestedCountback : 2000, 1, 2000);

    const tfSec = TIMEFRAME_SECONDS[timeframe] || 60;
    // Allow gaps (markets may not have a candle for every bucket); still clamp aggressively to avoid table scans.
    const lookbackSec = limit * tfSec * 2;
    const clampedStartMs = Math.max(startTime.getTime(), endTime.getTime() - lookbackSec * 1000);
    const effectiveStartTime = new Date(clampedStartMs);

    // Get the ClickHouse pipeline
    const clickhouse = getClickHouseDataPipeline();

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(symbol);

    // Resolve metric_id -> market_uuid so ClickHouse queries stay market-id centric.
    // (TradingView shows ticker, so we keep ticker human-readable and map here.)
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
          const { data: m } = await supabase
            .from('orderbook_markets_view')
            .select('id')
            .eq('metric_id', symbol)
            .limit(1)
            .maybeSingle();
          if (m?.id) {
            marketUuid = String(m.id);
            MARKET_UUID_CACHE.set(symbol, { id: marketUuid, expiresAt: Date.now() + MARKET_UUID_CACHE_TTL_MS });
          }
        }
      } catch {
        // ignore
      }
    }
    const tResolve1 = Date.now();

    const cacheKey = [
      marketUuid ? `uuid:${marketUuid}` : `sym:${symbol}`,
      `tf:${timeframe}`,
      `res:${resolution}`,
      `from:${Math.floor(effectiveStartTime.getTime() / 1000)}`,
      `to:${Math.floor(endTime.getTime() / 1000)}`,
      `limit:${limit}`,
      `seed:${debugSeed ? 1 : 0}`,
    ].join('|');

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
      // Best-effort safety valve (serverless instances are short-lived, but can be chatty while warm).
      HISTORY_CACHE.clear();
    }

    // Fetch candles using dynamic aggregation.
    // Prefer market_uuid filtering (canonical). If we can't resolve, fall back to symbol filtering.
    const tCh0 = Date.now();
    const candles = await clickhouse.getOHLCVCandles(
      marketUuid ? undefined : symbol,
      timeframe,
      limit,
      effectiveStartTime,
      endTime,
      marketUuid
    );
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
            HISTORY_CACHE.set(cacheKey, { expiresAt: Date.now() + HISTORY_CACHE_TTL_MS, body, headers });
            return NextResponse.json(body, { headers });
          }
        } catch {
          // ignore and fall through to debug seed / no_data
        }
      }

      // Dev-only: seed synthetic 1m ticks into ClickHouse so BTC chart can render and we can
      // visually verify the metric overlay line even when a market has no real trading history.
      if (debugSeed && marketUuid && clickhouse.isConfigured()) {
        try {
          const tfSecSeed = TIMEFRAME_SECONDS[timeframe] || 60;
          const seedMinutes = clampInt(limit * Math.max(1, Math.round(tfSecSeed / 60)), 30, 1200);

          // IMPORTANT: Number('') is 0, so only parse if the param is present AND non-empty.
          const basePriceParam = searchParams.get('debugBasePrice');
          const basePriceRaw =
            basePriceParam !== null && String(basePriceParam).trim() !== '' ? Number(basePriceParam) : NaN;
          const basePrice = Number.isFinite(basePriceRaw) ? basePriceRaw : 50_000;

          const ampParam = searchParams.get('debugAmp');
          const ampRaw = ampParam !== null && String(ampParam).trim() !== '' ? Number(ampParam) : NaN;
          const amplitude = Number.isFinite(ampRaw) ? ampRaw : Math.max(10, basePrice * 0.002);

          // If we already have 0-priced dev seed candles in-range, clean them up before re-seeding.
          // This prevents min(low)=0 from "poisoning" the aggregated candles.
          try {
            const chUrl = ensureClickHouseUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
            if (chUrl) {
              const ch = createClickHouseClient({
                url: chUrl,
                username: process.env.CLICKHOUSE_USER || 'default',
                password: process.env.CLICKHOUSE_PASSWORD,
                database: process.env.CLICKHOUSE_DATABASE || 'default',
                request_timeout: 30000,
              });
              const startEpochSec = Math.floor(effectiveStartTime.getTime() / 1000);
              const endEpochSec = Math.floor(endTime.getTime() / 1000);
              const safeUuid = String(marketUuid).replace(/'/g, "\\'");
              // Best-effort: delete only in-range for this market UUID.
              await ch.exec({
                query: `
                  ALTER TABLE market_ticks
                  DELETE WHERE market_uuid = '${safeUuid}'
                    AND ts >= toDateTime(${startEpochSec})
                    AND ts <= toDateTime(${endEpochSec})
                  SETTINGS mutations_sync = 1
                `,
              });
              await ch.exec({
                query: `
                  ALTER TABLE ohlcv_1m
                  DELETE WHERE market_uuid = '${safeUuid}'
                    AND ts >= toDateTime(${startEpochSec})
                    AND ts <= toDateTime(${endEpochSec})
                  SETTINGS mutations_sync = 1
                `,
              });
              await ch.close();
            }
          } catch (e) {
            console.warn('⚠️ TradingView history debug seed cleanup failed:', e instanceof Error ? e.message : e);
          }

          const ticks = generateSeedCandles1m({
            marketUuid,
            minutes: seedMinutes,
            endTime,
            basePrice,
            amplitude,
          });

          await (clickhouse as any).insertTickImmediate(ticks);
          // Give MV a brief chance to materialize into ohlcv_1m.
          await sleep(250);

          const seededCandles = await clickhouse.getOHLCVCandles(
            undefined,
            timeframe,
            limit,
            effectiveStartTime,
            endTime,
            marketUuid
          );

          if (seededCandles.length > 0) {
            const t: number[] = [];
            const o: number[] = [];
            const h: number[] = [];
            const l: number[] = [];
            const c: number[] = [];
            const v: number[] = [];

            seededCandles.forEach((candle) => {
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
                count: seededCandles.length,
                symbol,
                resolution,
                timeframe,
                architecture: 'dynamic_aggregation',
                debugSeed: 1,
              },
            };

            const headers: Record<string, string> = {
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
              'Server-Timing': [
                `supabase;dur=${tResolve1 - tResolve0}`,
                `clickhouse;dur=${tCh1 - tCh0}`,
                `total;dur=${Date.now() - t0}`,
              ].join(', '),
              'X-Debug-Seed': '1',
              'X-Cache': 'MISS',
            };

            HISTORY_CACHE.set(cacheKey, { expiresAt: Date.now() + HISTORY_CACHE_TTL_MS, body, headers });
            return NextResponse.json(body, { headers });
          }
        } catch (e) {
          console.warn('⚠️ TradingView history debug seed failed:', e instanceof Error ? e.message : e);
        }
      }

      // IMPORTANT:
      // Do NOT cache `no_data` responses.
      //
      // When a market has no history at initial load, TradingView can repeatedly request the same
      // time range. If we cache `no_data` (in-memory or CDN), then when ticks start arriving a moment
      // later the UI appears "stuck" until the user changes resolution (different cache key) or reloads.
      //
      // Instead, return `no_data` with `Cache-Control: no-store` and a future `nextTime` hint so
      // TradingView will re-query soon and pick up newly-ingested candles without user interaction.
      const body = {
        s: 'no_data',
        nextTime: Math.floor(endTime.getTime() / 1000) + tfSec,
      };
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Server-Timing': [
          `supabase;dur=${tResolve1 - tResolve0}`,
          `clickhouse;dur=${tCh1 - tCh0}`,
          `total;dur=${Date.now() - t0}`,
        ].join(', '),
      };
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

    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      // Short CDN cache: dramatically improves timeframe switching, while remaining near-realtime.
      'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=30',
      'Server-Timing': [
        `supabase;dur=${tResolve1 - tResolve0}`,
        `clickhouse;dur=${tCh1 - tCh0}`,
        `total;dur=${Date.now() - t0}`,
      ].join(', '),
      'X-Cache': 'MISS',
    };
    HISTORY_CACHE.set(cacheKey, { expiresAt: Date.now() + HISTORY_CACHE_TTL_MS, body, headers });
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