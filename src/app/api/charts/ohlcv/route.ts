// src/app/api/charts/ohlcv/route.ts
// Optimized OHLCV API with dynamic aggregation

import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client';
import { createClient } from '@clickhouse/client';
import { createClient as createSbClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId'); // required
    let symbol: string | undefined;
    const timeframe = searchParams.get('timeframe') || '1h';
    const limit = parseInt(searchParams.get('limit') || '200');
    const startTimeParam = searchParams.get('startTime');
    const endTimeParam = searchParams.get('endTime');

    // Require marketId
    if (!marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }

    // Best-effort: resolve symbol for meta (not used for filtering)
    try {
      const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
      const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
      if (sbUrl && sbKey) {
        const sb = createSbClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
        const { data: m } = await sb.from('markets').select('symbol').eq('id', marketId).limit(1).maybeSingle();
        if (m?.symbol) symbol = String(m.symbol).toUpperCase();
      }
    } catch {}

    // Parse optional time range
    let startTime: Date | undefined;
    let endTime: Date | undefined;

    if (startTimeParam) {
      startTime = new Date(startTimeParam);
      if (isNaN(startTime.getTime())) {
        return NextResponse.json(
          { error: 'Invalid startTime format' },
          { status: 400 }
        );
      }
    }

    if (endTimeParam) {
      endTime = new Date(endTimeParam);
      if (isNaN(endTime.getTime())) {
        return NextResponse.json(
          { error: 'Invalid endTime format' },
          { status: 400 }
        );
      }
    }

    // Get the ClickHouse pipeline
    const clickhouse = getClickHouseDataPipeline();

    // If ClickHouse is not configured, return an empty dataset gracefully
    if (!clickhouse.isConfigured()) {
      return NextResponse.json({
        success: true,
        data: [],
        meta: {
          symbol: symbol || null,
          marketId,
          timeframe,
          count: 0,
          architecture: 'dynamic_aggregation',
          source: timeframe === '1m' ? 'direct' : 'aggregated',
          degraded: true,
          reason: 'clickhouse_not_configured'
        }
      });
    }

    // Fetch OHLCV data using dynamic aggregation
    let candles: Array<any> = [];
    try {
      candles = await clickhouse.getOHLCVCandles(
        symbol,
        timeframe,
        limit,
        startTime,
        endTime,
        marketId || undefined
      );
    } catch (queryError) {
      // Degrade gracefully if ClickHouse is unreachable/misconfigured
      console.error('⚠️ ClickHouse query failed; returning empty dataset for charts:', queryError);
      return NextResponse.json({
        success: true,
        data: [],
        meta: {
          symbol: symbol || null,
          marketId,
          timeframe,
          count: 0,
          architecture: 'dynamic_aggregation',
          source: timeframe === '1m' ? 'direct' : 'aggregated',
          degraded: true,
          reason: 'clickhouse_query_failed'
        }
      });
    }

    return NextResponse.json({
      success: true,
      data: candles,
      meta: {
        symbol: symbol || null,
        marketId,
        timeframe,
        count: candles.length,
        architecture: 'dynamic_aggregation',
        source: timeframe === '1m' ? 'direct' : 'aggregated'
      }
    });

  } catch (error) {
    console.error('❌ OHLCV API error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch OHLCV data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 

// --- Helpers for POST ---
function ensureUrl(value?: string): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}

function authOk(req: NextRequest): boolean {
  const key = process.env.CHARTS_WRITE_API_KEY || process.env.OHLCV_SAVE_API_KEY;
  if (!key) return true; // open if no key configured
  const hdr = req.headers.get('authorization') || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  return token && token === key;
}

function toUtcChTs(input: number | string | Date): string {
  let ts = input;
  if (typeof ts === 'number') {
    // Accept seconds or ms
    if (ts > 1e12) {
      // ms
      return new Date(ts).toISOString().slice(0, 19).replace('T', ' ');
    }
    // seconds
    return new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' ');
  }
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

type IncomingCandle = {
  time: number | string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades?: number;
};

export async function POST(request: NextRequest) {
  try {
    if (!authOk(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      marketId, // required
      timeframe,
      candles,
      // Optional single-candle shape
      open,
      high,
      low,
      close,
      volume,
      trades,
      timestamp,
    } = body || {};

    // Require marketId and resolve symbol from Supabase for inserts
    if (!marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!sbUrl || !sbKey) {
      return NextResponse.json(
        { error: 'Supabase not configured to resolve marketId → symbol' },
        { status: 503 }
      );
    }
    const sb = createSbClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: m, error } = await sb
      .from('markets')
      .select('symbol')
      .eq('id', marketId)
      .limit(1)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: 'Failed to resolve marketId' }, { status: 500 });
    }
    if (!m?.symbol) {
      return NextResponse.json({ error: 'Unknown marketId' }, { status: 404 });
    }
    const symbol = String(m.symbol).toUpperCase();

    // Only 1m is accepted for direct inserts; higher TFs are aggregated from 1m
    if (timeframe && timeframe !== '1m') {
      return NextResponse.json({ error: 'Only 1m timeframe is accepted for writes' }, { status: 400 });
    }

    // Normalize to array of candles
    let rows: IncomingCandle[] = [];
    if (Array.isArray(candles)) {
      rows = candles;
    } else if (
      [open, high, low, close, volume, timestamp].every((v) => typeof v !== 'undefined')
    ) {
      rows = [{
        time: timestamp,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
        trades: Number.isFinite(Number(trades)) ? Number(trades) : undefined
      }];
    } else {
      return NextResponse.json(
        { error: 'Provide candles[] or a single candle (open, high, low, close, volume, timestamp)' },
        { status: 400 }
      );
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

    const insertRows = rows
      .map((c) => ({
        symbol,
        ts: toUtcChTs(c.time),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
        trades: Number.isFinite(Number(c.trades)) ? Number(c.trades) : 0,
        market_uuid: marketId
      }))
      .filter((r) =>
        Number.isFinite(r.open) &&
        Number.isFinite(r.high) &&
        Number.isFinite(r.low) &&
        Number.isFinite(r.close) &&
        Number.isFinite(r.volume)
      );

    if (insertRows.length === 0) {
      return NextResponse.json({ error: 'No valid candles to insert' }, { status: 400 });
    }

    await client.insert({
      table: 'ohlcv_1m',
      values: insertRows,
      format: 'JSONEachRow'
    });

    return NextResponse.json({
      success: true,
      inserted: insertRows.length,
      meta: { symbol, marketId: marketId || null, timeframe: '1m', table: 'ohlcv_1m', source: 'clickhouse' }
    });
  } catch (error) {
    console.error('❌ OHLCV save API error:', error);
    return NextResponse.json(
      { error: 'Failed to save OHLCV data' },
      { status: 500 }
    );
  }
}