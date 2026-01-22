'use server';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@clickhouse/client';
import { createClient as createSbClient } from '@supabase/supabase-js';

function ensureUrl(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
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

function isDevSeedEnabled(): boolean {
  // Keep these endpoints safe by default. If you need to allow seeding in a prod-like env,
  // set CHARTS_DEV_SEED=1 explicitly.
  if (process.env.CHARTS_DEV_SEED === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

function formatDateTime64Ms(input: string | number | Date | undefined): string {
  const d = input instanceof Date ? input : new Date(input ?? Date.now());
  // 'YYYY-MM-DD HH:MM:SS.mmm'
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');
    const timeframe = searchParams.get('timeframe') || '5m';
    const limit = parseInt(searchParams.get('limit') || '1000', 10);
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');
    const metricDebug =
      searchParams.get('metricDebug') === '1' ||
      searchParams.get('seed') === '1';

    if (!marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }

    const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
    if (!url) {
      return NextResponse.json(
        { success: true, data: [], meta: { marketId, timeframe, count: 0, source: 'unconfigured' } },
        { status: 200 }
      );
    }

    const client = createClient({
      url,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD,
      database: process.env.CLICKHOUSE_DATABASE || 'default',
      request_timeout: 30000
    });

    // Dev-only: seed scatter points so the metric overlay line has data to draw.
    // This is intentionally opt-in via `?metricDebug=1` and disabled in production by default.
    if (metricDebug && isDevSeedEnabled()) {
      const tfMs = TF_MS[timeframe] ?? TF_MS['5m'];
      const debugPointsRaw = parseInt(searchParams.get('debugPoints') || '', 10);
      const debugPoints =
        Number.isFinite(debugPointsRaw) && debugPointsRaw > 0
          ? Math.min(debugPointsRaw, 2000)
          : Math.min(Math.max(limit, 1), 500);
      const baseYRaw = Number(searchParams.get('debugBaseY') || '');
      const baseY = Number.isFinite(baseYRaw) ? baseYRaw : 50_000;
      const ampRaw = Number(searchParams.get('debugAmp') || '');
      const amp = Number.isFinite(ampRaw) ? ampRaw : Math.max(1, baseY * 0.005);

      const endMs = endTime ? new Date(endTime).getTime() : Date.now();
      const startMs = startTime ? new Date(startTime).getTime() : endMs - (debugPoints - 1) * tfMs;
      const startAligned = Math.floor(startMs / tfMs) * tfMs;

      const rows: Array<Record<string, any>> = [];
      for (let i = 0; i < debugPoints; i++) {
        const ts = startAligned + i * tfMs;
        const phase = i / 8;
        const y = baseY + Math.sin(phase) * amp + (Math.cos(phase / 2) * amp) / 4;
        rows.push({
          market_identifier: 'DEBUG',
          market_id: marketId,
          metric_name: 'MetricOverlay Debug',
          timeframe,
          ts: formatDateTime64Ms(ts),
          x: i, // stable, strictly increasing for easier debugging
          y: Number(y.toFixed(6)),
          source: 'debug_seed',
          version: Date.now() % 2_147_483_647,
        });
      }

      try {
        await client.insert({
          table: 'scatter_points_raw',
          values: rows,
          format: 'JSONEachRow',
        });
      } catch (e) {
        console.warn('⚠️ Scatter debug seed insert failed:', e instanceof Error ? e.message : e);
      }
    }

  const where: string[] = [`timeframe = '${timeframe}'`, `market_id = '${marketId}'`];
  const startEpochSec = startTime ? Math.floor(new Date(startTime).getTime() / 1000) : undefined;
  const endEpochSec = endTime ? Math.floor(new Date(endTime).getTime() / 1000) : undefined;
  if (typeof startEpochSec === 'number' && Number.isFinite(startEpochSec)) {
    where.push(`toUnixTimestamp(ts) >= ${startEpochSec}`);
  }
  if (typeof endEpochSec === 'number' && Number.isFinite(endEpochSec)) {
    where.push(`toUnixTimestamp(ts) <= ${endEpochSec}`);
  }

    const query = `
      SELECT
        ts,
        x,
        argMaxMerge(latest_y) AS y
      FROM scatter_points_dedup
      WHERE ${where.join(' AND ')}
      GROUP BY ts, x
      ORDER BY ts ASC, x ASC
      LIMIT ${limit}
    `;

    const result = await client.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as Array<{ ts: string; x: number; y: number }>;

    return NextResponse.json({
      success: true,
      data: rows ?? [],
      meta: { marketId, timeframe, count: rows?.length || 0, source: 'clickhouse', metricDebug: metricDebug ? 1 : 0 }
    });
  } catch (error) {
    console.error('❌ Scatter API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scatter data' },
      { status: 500 }
    );
  }
}

// --- Helpers for POST ---
const ALLOWED_TFS = new Set(['1m','5m','15m','30m','1h','4h','1d']);

function authOk(req: NextRequest): boolean {
  const key = process.env.CHARTS_WRITE_API_KEY || process.env.SCATTER_SAVE_API_KEY;
  if (!key) return true; // no key configured -> open (use env to lock down in prod)
  const hdr = req.headers.get('authorization') || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  return !!token && token === key;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createSbClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

type IncomingScatterPoint = {
  ts?: string | number;
  x: number;
  y: number;
};

export async function POST(request: NextRequest) {
  try {
    if (!authOk(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      marketId,
      timeframe,
      points,
      metricName,
      source,
      version
    } = body || {};

    if (!marketId || typeof marketId !== 'string') {
      return NextResponse.json({ error: 'marketId is required (Supabase UUID string)' }, { status: 400 });
    }
    if (!timeframe || typeof timeframe !== 'string' || !ALLOWED_TFS.has(timeframe)) {
      return NextResponse.json({ error: `timeframe must be one of ${Array.from(ALLOWED_TFS).join(', ')}` }, { status: 400 });
    }
    if (!points || (!Array.isArray(points) && typeof points !== 'object')) {
      return NextResponse.json({ error: 'points must be an object or array of { x, y, ts? }' }, { status: 400 });
    }

    // Optional: verify market exists in Supabase
    try {
      const sb = getSupabase();
      if (sb) {
        const { data: m, error } = await sb
          .from('markets')
          .select('id')
          .eq('id', marketId)
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!m) {
          return NextResponse.json({ error: 'Unknown marketId' }, { status: 400 });
        }
      }
    } catch (e) {
      // Soft-fail: log but do not block if Supabase not configured
      console.warn('⚠️ Supabase check skipped/failed:', e instanceof Error ? e.message : e);
    }

    const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
    if (!url) {
      return NextResponse.json({ error: 'ClickHouse not configured' }, { status: 503 });
    }

    const client = createClient({
      url,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD,
      database: process.env.CLICKHOUSE_DATABASE || 'default',
      request_timeout: 30000
    });

    const rows: Array<Record<string, any>> = (Array.isArray(points) ? points : [points])
      .map((p: IncomingScatterPoint) => ({
        market_identifier: null, // optional legacy
        market_id: marketId,
        metric_name: metricName || '',
        timeframe,
        ts: formatDateTime64Ms(p?.ts),
        x: Number(p?.x),
        y: Number(p?.y),
        source: source || 'frontend',
        version: Number.isFinite(Number(version)) ? Number(version) : 1
      }))
      .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y));

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid points to insert' }, { status: 400 });
    }

    await client.insert({
      table: 'scatter_points_raw',
      values: rows,
      format: 'JSONEachRow'
    });

    return NextResponse.json({
      success: true,
      inserted: rows.length,
      meta: { marketId, timeframe, source: 'clickhouse' }
    });
  } catch (error) {
    console.error('❌ Scatter save API error:', error);
    return NextResponse.json(
      { error: 'Failed to save scatter data' },
      { status: 500 }
    );
  }
}


