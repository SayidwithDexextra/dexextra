'use server';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@clickhouse/client';
import { broadcastMetricSeries } from '@/lib/pusher-server';

const REALTIME_METRIC_PREFIX = '[REALTIME_METRIC]';
const rtMetricLog = (...args: any[]) => console.log(REALTIME_METRIC_PREFIX, ...args);
const rtMetricWarn = (...args: any[]) => console.warn(REALTIME_METRIC_PREFIX, ...args);
const rtMetricErr = (...args: any[]) => console.error(REALTIME_METRIC_PREFIX, ...args);

function ensureUrl(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}

function escapeSqlString(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function formatDateTime64Ms(input: string | number | Date | undefined): string {
  const d = input instanceof Date ? input : new Date(input ?? Date.now());
  // 'YYYY-MM-DD HH:MM:SS.mmm'
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

function isDevSeedEnabled(): boolean {
  if (process.env.CHARTS_DEV_SEED === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

const TF_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

const ALLOWED_TFS = new Set(Object.keys(TF_MS));
const ALLOWED_AGG = new Set(['last', 'avg', 'min', 'max']);

/**
 * Metric time-series endpoint
 *
 * Storage:
 * - Raw inserts: metric_series_raw
 * - 1m bucket view: metric_series_1m (AggregatingMergeTree w/ mergeable states)
 *
 * Reads:
 * - Finalize 1m values (last/avg/min/max)
 * - Optionally roll up to requested timeframe bucket
 * - Optionally compute SMA(N) using a window function
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');
    const metricName = searchParams.get('metricName') || searchParams.get('metric') || '';
    const timeframe = (searchParams.get('timeframe') || '1m').toLowerCase();
    const agg = (searchParams.get('agg') || 'last').toLowerCase();
    const limitRaw = Number(searchParams.get('limit') || '');
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 5000) : 2000;
    const smaLengthRaw = Number(searchParams.get('sma') || searchParams.get('smaLength') || '');
    const smaLength =
      Number.isFinite(smaLengthRaw) && smaLengthRaw > 0 ? Math.min(Math.floor(smaLengthRaw), 5000) : 0;

    const metricDebug =
      searchParams.get('metricDebug') === '1' || searchParams.get('seed') === '1' || searchParams.get('debugSeed') === '1';
    const forceSeed = searchParams.get('forceSeed') === '1';

    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');

    if (!marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }
    if (!ALLOWED_TFS.has(timeframe)) {
      return NextResponse.json(
        { error: `timeframe must be one of ${Array.from(ALLOWED_TFS).join(', ')}` },
        { status: 400 }
      );
    }
    if (!ALLOWED_AGG.has(agg)) {
      return NextResponse.json(
        { error: `agg must be one of ${Array.from(ALLOWED_AGG).join(', ')}` },
        { status: 400 }
      );
    }

    const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
    if (!url) {
      return NextResponse.json(
        {
          success: true,
          data: [],
          meta: { marketId, metricName: metricName || null, timeframe, agg, smaLength, count: 0, source: 'unconfigured' },
        },
        { status: 200 }
      );
    }

    const client = createClient({
      url,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD,
      database: process.env.CLICKHOUSE_DATABASE || 'default',
      request_timeout: 30000,
    });

    const safeMarketId = escapeSqlString(marketId);
    const safeMetricName = metricName ? escapeSqlString(metricName) : '';

    const where: string[] = [`market_id = '${safeMarketId}'`];
    if (safeMetricName) where.push(`metric_name = '${safeMetricName}'`);

    const startEpochSec = startTime ? Math.floor(new Date(startTime).getTime() / 1000) : undefined;
    const endEpochSec = endTime ? Math.floor(new Date(endTime).getTime() / 1000) : undefined;
    if (typeof startEpochSec === 'number' && Number.isFinite(startEpochSec)) {
      where.push(`toUnixTimestamp(ts) >= ${startEpochSec}`);
    }
    if (typeof endEpochSec === 'number' && Number.isFinite(endEpochSec)) {
      where.push(`toUnixTimestamp(ts) <= ${endEpochSec}`);
    }

    // Dev-only: seed synthetic metric series points into metric_series_raw so the overlay line can render.
    // This is safe in prod because metricDebug is ignored unless explicitly enabled by env.
    //
    // IMPORTANT:
    // Dev seeding must be non-destructive. If metric data already exists for (marketId, metricName),
    // DO NOT insert debug_seed points unless explicitly forced; otherwise argMax(version) will make
    // debug data “win” and override plotted values.
    let shouldSeed = metricDebug && isDevSeedEnabled();
    if (shouldSeed && !forceSeed) {
      try {
        const seedMetric = safeMetricName || 'metric_debug';
        // Check both the raw and 1m tables so we don't accidentally seed during the short window
        // after raw inserts but before the MV has fully materialized into metric_series_1m.
        const existsQ1 = `
          SELECT 1
          FROM metric_series_raw
          WHERE market_id = '${safeMarketId}'
            AND metric_name = '${seedMetric}'
          LIMIT 1
        `;
        const existsRes1 = await client.query({ query: existsQ1, format: 'JSONEachRow' });
        const existsRows1 = (await existsRes1.json()) as any[];

        const existsQ2 = `
          SELECT 1
          FROM metric_series_1m
          WHERE market_id = '${safeMarketId}'
            AND metric_name = '${seedMetric}'
          LIMIT 1
        `;
        const existsRes2 = await client.query({ query: existsQ2, format: 'JSONEachRow' });
        const existsRows2 = (await existsRes2.json()) as any[];

        if ((Array.isArray(existsRows1) && existsRows1.length > 0) || (Array.isArray(existsRows2) && existsRows2.length > 0)) {
          shouldSeed = false;
        }
      } catch {
        // If the existence check fails (e.g. tables missing during migration), fall back to seeding.
      }
    }

    if (shouldSeed) {
      // Seed at 1m granularity regardless of requested timeframe so rollups/SMA look smooth.
      const seedStepMs = TF_MS['1m'];
      const debugPointsParam = searchParams.get('debugPoints');
      const debugPointsRaw =
        debugPointsParam !== null && String(debugPointsParam).trim() !== '' ? Number(debugPointsParam) : NaN;
      const debugPoints =
        Number.isFinite(debugPointsRaw) && debugPointsRaw > 0 ? Math.min(Math.floor(debugPointsRaw), 5000) : Math.min(limit, 500);

      const baseYParam = searchParams.get('debugBaseY');
      const baseYRaw = baseYParam !== null && String(baseYParam).trim() !== '' ? Number(baseYParam) : NaN;
      const baseY = Number.isFinite(baseYRaw) ? baseYRaw : 45_000;
      const ampParam = searchParams.get('debugAmp');
      const ampRaw = ampParam !== null && String(ampParam).trim() !== '' ? Number(ampParam) : NaN;
      const amp = Number.isFinite(ampRaw) ? ampRaw : Math.max(1, baseY * 0.01);

      const endMs = endTime ? new Date(endTime).getTime() : Date.now();
      const startMs = startTime ? new Date(startTime).getTime() : endMs - (debugPoints - 1) * seedStepMs;
      const startAligned = Math.floor(startMs / seedStepMs) * seedStepMs;

      const seedMetric = safeMetricName || 'metric_debug';
      const seedRows: Array<Record<string, any>> = [];
      for (let i = 0; i < debugPoints; i++) {
        const ts = startAligned + i * seedStepMs;
        const phase = i / 8;
        const value = baseY + Math.sin(phase) * amp + (Math.cos(phase / 2) * amp) / 4;
        seedRows.push({
          market_id: marketId,
          metric_name: seedMetric,
          ts: formatDateTime64Ms(ts),
          value: Number(value.toFixed(6)),
          source: 'debug_seed',
          version: Date.now() % 2_147_483_647,
        });
      }

      try {
        await client.insert({
          table: 'metric_series_raw',
          values: seedRows,
          format: 'JSONEachRow',
        });
      } catch (e) {
        console.warn('⚠️ Metric series debug seed insert failed:', e instanceof Error ? e.message : e);
      }
    }

    const finalizeExpr =
      agg === 'avg'
        ? 'avgMerge(avg_value)'
        : agg === 'min'
          ? 'minMerge(min_value)'
          : agg === 'max'
            ? 'maxMerge(max_value)'
            : 'argMaxMerge(latest_value)'; // last

    // Step 1: finalize 1m values
    const baseSeries = `
      SELECT
        ts,
        ${finalizeExpr} AS v
      FROM metric_series_1m
      WHERE ${where.join(' AND ')}
      GROUP BY ts
      ORDER BY ts ASC
    `;

    // Step 2: optional rollup to timeframe
    // We roll up by averaging the finalized 1m values into the requested bucket.
    const tfMs = TF_MS[timeframe];
    const rollupSeries =
      timeframe === '1m'
        ? `(${baseSeries})`
        : `
          (
            SELECT
              toDateTime64(toStartOfInterval(ts, INTERVAL ${Math.floor(tfMs / 60_000)} MINUTE, 'UTC'), 3, 'UTC') AS ts,
              avg(v) AS v
            FROM (${baseSeries})
            GROUP BY ts
            ORDER BY ts ASC
          )
        `;

    // Step 3: optional SMA + ALWAYS return the most recent points (not the oldest).
    // We fetch a little extra lookback so SMA(N) on the most recent `limit` points is stable.
    const limitWithLookback = smaLength > 0 ? Math.min(limit + (smaLength - 1), 5000) : limit;

    const finalQuery =
      smaLength > 0
        ? `
          WITH recent AS (
            SELECT *
            FROM (
              SELECT
                ts,
                v
              FROM ${rollupSeries}
              ORDER BY ts DESC
              LIMIT ${limitWithLookback}
            )
            ORDER BY ts ASC
          ),
          with_sma AS (
            SELECT
              ts,
              v,
              avg(v) OVER (ORDER BY ts ROWS BETWEEN ${smaLength - 1} PRECEDING AND CURRENT ROW) AS sma
            FROM recent
          )
          SELECT
            ts,
            v,
            sma
          FROM (
            SELECT *
            FROM with_sma
            ORDER BY ts DESC
            LIMIT ${limit}
          )
          ORDER BY ts ASC
        `
        : `
          SELECT
            ts,
            v
          FROM (
            SELECT
              ts,
              v
            FROM ${rollupSeries}
            ORDER BY ts DESC
            LIMIT ${limit}
          )
          ORDER BY ts ASC
        `;

    // IMPORTANT: The TradingView custom indicator expects points shaped like `{ ts, y }`.
    // Internally we may compute a raw value (`v`) and optional SMA, but we must return `y` as the plotted value.
    let rows: Array<{ ts: string; v: number; sma?: number }> = [];
    let source: 'metric_series_1m' | 'scatter_points_dedup_fallback' = 'metric_series_1m';
    try {
      const result = await client.query({ query: finalQuery, format: 'JSONEachRow' });
      rows = (await result.json()) as Array<{ ts: string; v: number; sma?: number }>;
    } catch (e) {
      // Compatibility / migration path:
      // If the new metric_series_* tables don't exist yet, fall back to scatter_points_dedup so
      // the TradingView overlay can still render from existing data.
      //
      // This lets you migrate writers to POST /api/charts/metric gradually.
      // If metric_name isn't provided we can't meaningfully fall back (the caller likely doesn't know what they want).
      // NOTE: scatter_points_dedup does NOT contain metric_name, so the fallback ignores metricName and uses the market+timeframe series.
      if (!safeMetricName) throw e;

      const safeTf = escapeSqlString(timeframe);
      const whereScatter: string[] = [`market_id = '${safeMarketId}'`, `timeframe = '${safeTf}'`];
      if (typeof startEpochSec === 'number' && Number.isFinite(startEpochSec)) {
        whereScatter.push(`toUnixTimestamp(ts) >= ${startEpochSec}`);
      }
      if (typeof endEpochSec === 'number' && Number.isFinite(endEpochSec)) {
        whereScatter.push(`toUnixTimestamp(ts) <= ${endEpochSec}`);
      }

      const baseScatter = `
        SELECT
          ts,
          avg(y) AS v
        FROM
        (
          SELECT
            ts,
            x,
            argMaxMerge(latest_y) AS y
          FROM scatter_points_dedup
          WHERE ${whereScatter.join(' AND ')}
          GROUP BY ts, x
        )
        GROUP BY ts
        ORDER BY ts ASC
      `;

      const fallbackQuery =
        smaLength > 0
          ? `
            SELECT
              ts,
              v,
              avg(v) OVER (ORDER BY ts ROWS BETWEEN ${smaLength - 1} PRECEDING AND CURRENT ROW) AS sma
            FROM (${baseScatter})
            ORDER BY ts ASC
            LIMIT ${limit}
          `
          : `
            SELECT
              ts,
              v
            FROM (${baseScatter})
            ORDER BY ts ASC
            LIMIT ${limit}
          `;

      const r2 = await client.query({ query: fallbackQuery, format: 'JSONEachRow' });
      rows = (await r2.json()) as Array<{ ts: string; v: number; sma?: number }>;
      source = 'scatter_points_dedup_fallback';
    }

    // If metric_series exists but is empty, fall back to scatter so the overlay keeps working during migration.
    if (rows.length === 0 && safeMetricName) {
      const safeTf = escapeSqlString(timeframe);
      const whereScatter: string[] = [`market_id = '${safeMarketId}'`, `timeframe = '${safeTf}'`];
      if (typeof startEpochSec === 'number' && Number.isFinite(startEpochSec)) {
        whereScatter.push(`toUnixTimestamp(ts) >= ${startEpochSec}`);
      }
      if (typeof endEpochSec === 'number' && Number.isFinite(endEpochSec)) {
        whereScatter.push(`toUnixTimestamp(ts) <= ${endEpochSec}`);
      }

      const baseScatter = `
        SELECT
          ts,
          avg(y) AS v
        FROM
        (
          SELECT
            ts,
            x,
            argMaxMerge(latest_y) AS y
          FROM scatter_points_dedup
          WHERE ${whereScatter.join(' AND ')}
          GROUP BY ts, x
        )
        GROUP BY ts
        ORDER BY ts ASC
      `;

      const fallbackQuery =
        smaLength > 0
          ? `
            SELECT
              ts,
              v,
              avg(v) OVER (ORDER BY ts ROWS BETWEEN ${smaLength - 1} PRECEDING AND CURRENT ROW) AS sma
            FROM (${baseScatter})
            ORDER BY ts ASC
            LIMIT ${limit}
          `
          : `
            SELECT
              ts,
              v
            FROM (${baseScatter})
            ORDER BY ts ASC
            LIMIT ${limit}
          `;

      const r3 = await client.query({ query: fallbackQuery, format: 'JSONEachRow' });
      rows = (await r3.json()) as Array<{ ts: string; v: number; sma?: number }>;
      if (rows.length > 0) source = 'scatter_points_dedup_fallback';
    }

    return NextResponse.json({
      success: true,
      data: (rows ?? []).map((r) => ({
        ts: r.ts,
        // Prefer SMA if requested; otherwise plot the finalized value.
        y: smaLength > 0 ? Number(r.sma ?? r.v) : Number(r.v),
        // Keep the raw value for debugging/inspection.
        v: Number(r.v),
        sma: smaLength > 0 ? Number(r.sma ?? r.v) : undefined,
      })),
      meta: {
        marketId,
        metricName: metricName || null,
        timeframe,
        agg,
        smaLength,
        count: rows?.length || 0,
        source,
        metricDebug: metricDebug ? 1 : 0,
      },
    });
  } catch (error) {
    // IMPORTANT:
    // TradingView studies treat data errors harshly (can spam retries / fail silently).
    // If ClickHouse is temporarily unavailable, degrade gracefully with empty data.
    const msg = error instanceof Error ? error.message : String(error);
    console.error('❌ Metric series API error:', error);
    return NextResponse.json(
      {
        success: true,
        data: [],
        meta: {
          marketId: null,
          metricName: null,
          timeframe: null,
          agg: null,
          smaLength: null,
          count: 0,
          source: 'clickhouse_error',
          error: msg,
        },
      },
      { status: 200 }
    );
  }
}

type IncomingMetricPoint = { ts?: string | number | Date; value: number };

export async function POST(request: NextRequest) {
  try {
    const t0 = Date.now();
    const body = await request.json();
    const { marketId, metricName, points, source, version } = body || {};

    if (!marketId || typeof marketId !== 'string') {
      return NextResponse.json({ error: 'marketId is required (Supabase UUID string)' }, { status: 400 });
    }
    if (!metricName || typeof metricName !== 'string') {
      return NextResponse.json({ error: 'metricName is required' }, { status: 400 });
    }
    if (!points || (!Array.isArray(points) && typeof points !== 'object')) {
      return NextResponse.json({ error: 'points must be an object or array of { value, ts? }' }, { status: 400 });
    }

    const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
    if (!url) {
      rtMetricWarn('insert skipped: clickhouse unconfigured', { marketId, metricName });
      return NextResponse.json({ success: true, inserted: 0, meta: { marketId, metricName, source: 'unconfigured' } });
    }

    const client = createClient({
      url,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD,
      database: process.env.CLICKHOUSE_DATABASE || 'default',
      request_timeout: 30000,
    });

    const arr: IncomingMetricPoint[] = Array.isArray(points) ? points : [points];
    const v0 = Number.isFinite(Number(version)) ? Number(version) : Date.now() % 2_147_483_647;
    const rows = arr
      .map((p) => {
        const value = Number((p as any)?.value);
        if (!Number.isFinite(value)) return null;
        const ts = (p as any)?.ts;
        return {
          market_id: marketId,
          metric_name: metricName,
          ts: formatDateTime64Ms(ts),
          value,
          source: typeof source === 'string' ? source : 'api',
          version: v0,
        };
      })
      .filter(Boolean) as Array<Record<string, any>>;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid points to insert' }, { status: 400 });
    }

    rtMetricLog('insert begin', {
      marketId,
      metricName,
      nPoints: rows.length,
      source: typeof source === 'string' ? source : 'api',
    });

    await client.insert({
      table: 'metric_series_raw',
      values: rows,
      format: 'JSONEachRow',
    });
    rtMetricLog('insert complete', { marketId, metricName, inserted: rows.length, ms: Date.now() - t0 });

    // Best-effort realtime: broadcast the latest inserted point so chart overlays can update immediately.
    // Never fail the write if realtime is not configured.
    try {
      if (process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET) {
        const lastRow = rows[rows.length - 1] as any;
        const lastPoint = arr[arr.length - 1] as any;
        const rawTs = lastPoint?.ts ?? lastRow?.ts;
        const tsMs =
          rawTs instanceof Date
            ? rawTs.getTime()
            : typeof rawTs === 'number'
              ? (rawTs > 1e12 ? rawTs : rawTs * 1000)
              : Date.parse(String(rawTs || '').replace(' ', 'T') + 'Z') || Date.now();
        rtMetricLog('broadcast begin', {
          channel: `metric-${marketId}`,
          event: 'metric-update',
          marketId,
          metricName,
          ts: Number.isFinite(tsMs) ? tsMs : Date.now(),
          value: Number(lastRow?.value),
        });
        await broadcastMetricSeries({
          marketId,
          metricName,
          ts: Number.isFinite(tsMs) ? tsMs : Date.now(),
          value: Number(lastRow?.value),
          source: typeof source === 'string' ? source : 'api',
          version: Number.isFinite(Number(version)) ? Number(version) : undefined,
        });
        rtMetricLog('broadcast complete', { marketId, metricName, ms: Date.now() - t0 });
      } else {
        rtMetricWarn('broadcast skipped: pusher env missing', {
          hasAppId: Boolean(process.env.PUSHER_APP_ID),
          hasKey: Boolean(process.env.PUSHER_KEY),
          hasSecret: Boolean(process.env.PUSHER_SECRET),
        });
      }
    } catch (e: any) {
      // Never fail the write if realtime is not configured or broadcast fails.
      rtMetricErr('broadcast failed (non-fatal)', {
        marketId,
        metricName,
        error: String(e?.message || e || 'unknown'),
      });
    }

    return NextResponse.json({
      success: true,
      inserted: rows.length,
      meta: { marketId, metricName, table: 'metric_series_raw', source: 'clickhouse' },
    });
  } catch (error) {
    console.error('❌ Metric series save API error:', error);
    return NextResponse.json({ error: 'Failed to save metric series' }, { status: 500 });
  }
}


