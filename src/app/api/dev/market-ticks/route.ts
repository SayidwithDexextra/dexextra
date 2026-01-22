import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client';
import { getPusherServer } from '@/lib/pusher-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@clickhouse/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function looksLikeUuid(value: string): boolean {
  const v = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

async function resolveMarketUuidFromSymbol(symbol: string): Promise<string | null> {
  const sym = String(symbol || '').trim();
  if (!sym) return null;
  try {
    const { data: m } = await supabaseAdmin
      .from('orderbook_markets_view')
      .select('id')
      .or(`eq.metric_id.${sym},eq.symbol.${sym},ilike.metric_id.${sym},ilike.symbol.${sym}`)
      .limit(1)
      .maybeSingle();
    const id = (m as any)?.id ? String((m as any).id) : null;
    return id && looksLikeUuid(id) ? id : null;
  } catch {
    return null;
  }
}

async function resolveHumanSymbolFromMarketUuid(marketUuid: string): Promise<string | null> {
  const id = String(marketUuid || '').trim();
  if (!looksLikeUuid(id)) return null;
  try {
    const { data: m } = await supabaseAdmin
      .from('orderbook_markets_view')
      .select('metric_id, symbol')
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    const sym = (m as any)?.metric_id || (m as any)?.symbol || null;
    return sym ? String(sym).toUpperCase() : null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureUrl(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}

function fmtDateTimeSec(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * DEV ONLY: Insert a raw trade tick into ClickHouse `market_ticks` and broadcast the updated 1m candle.
 *
 * POST body:
 * {
 *   "marketUuid": "e120c445-37fc-47e1-a65d-5cedf945bf5d",   // optional if symbol provided
 *   "symbol": "BITCOIN",                                   // optional if marketUuid provided
 *   "price": 67668.48,                                     // required
 *   "size": 0.05,                                          // optional (default: small random)
 *   "side": "buy" | "sell",                                // optional (default: buy)
 *   "timestamp": 1730000000000                              // optional (ms epoch)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
    }

    const body = (await req.json().catch(() => null)) as any;
    const inputMarketUuid = body?.marketUuid ? String(body.marketUuid).trim() : '';
    const inputSymbol = body?.symbol ? String(body.symbol).trim() : '';

    const marketUuid =
      looksLikeUuid(inputMarketUuid)
        ? inputMarketUuid
        : inputSymbol && !looksLikeUuid(inputSymbol)
          ? await resolveMarketUuidFromSymbol(inputSymbol)
          : looksLikeUuid(inputSymbol)
            ? inputSymbol
            : null;

    if (!marketUuid) {
      return NextResponse.json(
        { error: 'Missing marketUuid (or unable to resolve from symbol)' },
        { status: 400 }
      );
    }

    const price = Number(body?.price);
    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: `Invalid price: ${String(body?.price)}` }, { status: 400 });
    }

    const tsMsRaw = body?.timestamp;
    const tsMs =
      typeof tsMsRaw === 'number' && Number.isFinite(tsMsRaw) ? tsMsRaw : Date.now();

    const sideRaw = String(body?.side || 'buy').toLowerCase();
    const side = sideRaw === 'sell' ? 'sell' : 'buy';
    const isLong = side === 'buy';

    const sizeRaw = Number(body?.size);
    const size =
      Number.isFinite(sizeRaw) && sizeRaw > 0 ? sizeRaw : Number((Math.random() * 0.05 + 0.01).toFixed(6));

    const symbol =
      (inputSymbol && !looksLikeUuid(inputSymbol) ? inputSymbol : (await resolveHumanSymbolFromMarketUuid(marketUuid))) ||
      'BITCOIN';

    const pipeline = getClickHouseDataPipeline();
    if (!pipeline.isConfigured()) {
      return NextResponse.json({ error: 'ClickHouse is not configured on the server' }, { status: 500 });
    }

    const eventId = `devtick:${marketUuid}:${tsMs}:${Math.random().toString(16).slice(2)}`;

    // 1) Write the raw tick to ClickHouse (this is what you asked for)
    await (pipeline as any).insertTickImmediate({
      symbol: String(symbol).toUpperCase(),
      ts: new Date(tsMs),
      price,
      size,
      event_type: 'trade',
      is_long: isLong ? 1 : 0,
      event_id: eventId,
      trade_count: 1,
      market_id: 0,
      contract_address: '',
      market_uuid: marketUuid,
    });

    // 2) Compute the current 1m candle directly from `market_ticks`.
    // IMPORTANT: ohlcv_1m is a MergeTree fed by an MV, so it can contain multiple partial rows per minute
    // when ticks arrive in separate inserts. For realtime correctness, we aggregate from the raw ticks.
    const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
    const db = process.env.CLICKHOUSE_DATABASE || 'default';
    const ch = createClient({
      url,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD,
      database: db,
      request_timeout: 30_000,
    });

    const bucketStartSec = Math.floor(tsMs / 60_000) * 60;
    const bucketEndSec = bucketStartSec + 60;
    const safeUuid = String(marketUuid).replace(/'/g, "\\'");

    const q = `
      SELECT
        toUnixTimestamp(toStartOfInterval(ts, INTERVAL 1 MINUTE, 'UTC')) AS time,
        argMin(price, (ts, event_id)) AS open,
        max(price) AS high,
        min(price) AS low,
        argMax(price, (ts, event_id)) AS close,
        sum(size) AS volume
      FROM market_ticks
      WHERE market_uuid = '${safeUuid}'
        AND ts >= toDateTime('${fmtDateTimeSec(bucketStartSec)}')
        AND ts < toDateTime('${fmtDateTimeSec(bucketEndSec)}')
      GROUP BY time
      ORDER BY time DESC
      LIMIT 1
    `;

    let latest: any | null = null;
    try {
      const r = await ch.query({ query: q, format: 'JSONEachRow' });
      const rows = (await r.json()) as any[];
      latest = Array.isArray(rows) && rows.length ? rows[0] : null;
    } finally {
      await ch.close();
    }

    // 3) Broadcast to realtime channels so TradingView updates
    if (latest) {
      await getPusherServer().broadcastChartData(
        {
          symbol: String(symbol).toUpperCase(),
          marketUuid,
          timeframe: '1m',
          open: Number(latest.open),
          high: Number(latest.high),
          low: Number(latest.low),
          close: Number(latest.close),
          volume: Number(latest.volume),
          timestamp: Number(latest.time || Math.floor(tsMs / 1000)) * 1000,
        },
        // Important: we already wrote to ClickHouse above, so skip persistence to avoid duplicating rows.
        { persist: false, cache: true, analytics: false }
      );
    }

    return NextResponse.json({
      ok: true,
      inserted: {
        marketUuid,
        symbol: String(symbol).toUpperCase(),
        tsMs,
        price,
        size,
        side,
        eventId,
      },
      latestCandle: latest,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e || 'Unknown error') },
      { status: 500 }
    );
  }
}


