import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseDataPipeline, type MarketTick } from '@/lib/clickhouse-client';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getPusherServer } from '@/lib/pusher-server';
import crypto from 'node:crypto';
 
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
 
type IngestTradeLike = {
  // Prefer marketUuid/marketId (Supabase markets.id)
  marketUuid?: string;
  marketId?: string;
 
  // Optional human symbol (will be resolved/validated server-side when possible)
  symbol?: string;
 
  // Price/size
  price: number | string;
  size?: number | string;
  amount?: number | string;
  quantity?: number | string;
 
  // Timestamp (ms/seconds/ISO)
  ts?: number | string | Date;
  timestamp?: number | string | Date;
  trade_timestamp?: string;
  tradeTimestamp?: string;
 
  // Side
  side?: 'buy' | 'sell' | string;
 
  // Provenance + idempotency
  eventId?: string;
  tx_hash?: string;
  log_index?: number | string;
  id?: string | number;
 
  // Contract (orderbook address)
  contractAddress?: string;
  orderBookAddress?: string;
  order_book_address?: string;
};
 
type IngestRequestBody = {
  source?: string;
  trade?: IngestTradeLike;
  trades?: IngestTradeLike[];
  // If true, broadcast the newest 1m candle after inserting ticks
  broadcast?: boolean;
};
 
function looksLikeUuid(value: string): boolean {
  const v = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
 
function normalizeSymbol(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (looksLikeUuid(s)) return null;
  return s.toUpperCase();
}
 
function coerceNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? ''));
  return Number.isFinite(n) ? n : null;
}
 
function coerceDate(input: unknown): Date | null {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input;
 
  if (typeof input === 'number' && Number.isFinite(input)) {
    // Heuristic: treat >= 1e12 as ms, else seconds
    const ms = input >= 1_000_000_000_000 ? input : input * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
 
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return null;
    const asNum = Number(s);
    if (Number.isFinite(asNum)) return coerceDate(asNum);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
 
  return null;
}
 
function getIngestKey(): string | null {
  const k =
    process.env.OHLCV_INGEST_API_KEY ||
    process.env.INGEST_API_KEY ||
    process.env.OHLCV_SAVE_API_KEY ||
    null;
  return k ? String(k).trim() : null;
}
 
function isAuthorized(req: NextRequest): boolean {
  const required = getIngestKey();
  if (!required) {
    // In development we allow local testing without a key.
    return process.env.NODE_ENV !== 'production';
  }
 
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!token) return false;
 
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(required));
  } catch {
    return false;
  }
}
 
async function resolveSymbolFromMarketUuid(marketUuid: string): Promise<string | null> {
  const id = String(marketUuid || '').trim();
  if (!looksLikeUuid(id)) return null;
 
  // Prefer the compatibility view used across the app (orderbook + vAMM)
  try {
    const { data: ob } = await supabaseAdmin
      .from('orderbook_markets_view')
      .select('metric_id, symbol')
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    const sym = (ob as any)?.metric_id || (ob as any)?.symbol || null;
    const out = normalizeSymbol(sym);
    if (out) return out;
  } catch {
    // fall through
  }
 
  // Fallback to unified markets table
  try {
    const { data: m } = await supabaseAdmin
      .from('markets')
      .select('symbol')
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    return normalizeSymbol((m as any)?.symbol) || null;
  } catch {
    return null;
  }
}
 
function buildEventId(input: IngestTradeLike, marketUuid: string, ts: Date): string {
  const explicit = String(input.eventId || '').trim();
  if (explicit) return explicit;
 
  const tx = String((input as any).tx_hash || '').trim();
  const li = (input as any).log_index;
  const liNum = typeof li === 'number' ? li : Number(String(li ?? ''));
  if (tx && Number.isFinite(liNum)) {
    return `${tx}:${liNum}`;
  }
 
  const id = (input as any).id;
  if (typeof id === 'string' || typeof id === 'number') {
    return `sb:${marketUuid}:${id}`;
  }
 
  return `tick:${marketUuid}:${ts.getTime()}:${Math.random().toString(16).slice(2)}`;
}
 
function extractContractAddress(input: IngestTradeLike): string {
  const raw =
    input.contractAddress ||
    input.orderBookAddress ||
    input.order_book_address ||
    '';
  return String(raw || '').trim().toLowerCase();
}
 
function extractTimestamp(input: IngestTradeLike): Date | null {
  // Prefer explicit ts/timestamp fields, then trade_timestamp naming
  return (
    coerceDate(input.ts) ||
    coerceDate(input.timestamp) ||
    coerceDate(input.tradeTimestamp) ||
    coerceDate(input.trade_timestamp) ||
    null
  );
}
 
export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
 
    const body = (await req.json().catch(() => null)) as IngestRequestBody | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }
 
    const list = Array.isArray(body.trades)
      ? body.trades
      : body.trade
        ? [body.trade]
        : [];
 
    if (!list.length) {
      return NextResponse.json(
        { ok: false, error: 'Provide `trade` or `trades[]`' },
        { status: 400 }
      );
    }
 
    const pipeline = getClickHouseDataPipeline();
    if (!pipeline.isConfigured()) {
      return NextResponse.json({ ok: false, error: 'ClickHouse not configured' }, { status: 503 });
    }
 
    const ticks: MarketTick[] = [];
    const marketUuidsForBroadcast = new Set<string>();
 
    for (const t of list) {
      const marketUuidRaw = String(t.marketUuid || t.marketId || '').trim();
      if (!looksLikeUuid(marketUuidRaw)) {
        return NextResponse.json(
          { ok: false, error: `Invalid or missing marketUuid/marketId: ${marketUuidRaw || '(empty)'}` },
          { status: 400 }
        );
      }
 
      const price = coerceNumber(t.price);
      if (price === null || price <= 0) {
        return NextResponse.json({ ok: false, error: `Invalid price: ${String(t.price)}` }, { status: 400 });
      }
 
      const size =
        coerceNumber(t.size) ??
        coerceNumber(t.amount) ??
        coerceNumber(t.quantity) ??
        0;
      const ts = extractTimestamp(t) || new Date();
 
      const sideRaw = String(t.side || 'buy').toLowerCase();
      const side = sideRaw === 'sell' ? 'sell' : 'buy';
      const isLong = side === 'buy';
 
      // Avoid UUID-as-symbol bugs by always preferring Supabase-resolved symbol.
      const resolvedSymbol = await resolveSymbolFromMarketUuid(marketUuidRaw);
      const symbol = resolvedSymbol || normalizeSymbol(t.symbol) || 'UNKNOWN';
 
      const eventId = buildEventId(t, marketUuidRaw, ts);
 
      ticks.push({
        symbol,
        ts,
        price,
        size,
        event_type: 'trade',
        is_long: isLong,
        event_id: eventId,
        trade_count: 1,
        market_id: 0,
        contract_address: extractContractAddress(t),
        market_uuid: marketUuidRaw,
      });
 
      if (body.broadcast) {
        marketUuidsForBroadcast.add(marketUuidRaw);
      }
    }
 
    await (pipeline as any).insertTickImmediate(ticks);
 
    // Optional realtime broadcast (no persistence; we already wrote to ClickHouse above)
    if (body.broadcast && marketUuidsForBroadcast.size) {
      // Give the MV a brief chance to materialize into ohlcv_1m
      await new Promise((r) => setTimeout(r, 150));
 
      const pusher = getPusherServer();
      for (const marketUuid of marketUuidsForBroadcast) {
        const latest =
          (pipeline as any).fetchLatestOhlcv1mByMarketUuid
            ? await (pipeline as any).fetchLatestOhlcv1mByMarketUuid(marketUuid)
            : null;
        if (!latest) continue;
 
        await pusher.broadcastChartData(
          {
            symbol: String(latest.symbol || 'UNKNOWN').toUpperCase(),
            marketUuid,
            timeframe: '1m',
            open: Number(latest.open),
            high: Number(latest.high),
            low: Number(latest.low),
            close: Number(latest.close),
            volume: Number(latest.volume),
            timestamp: Number(latest.time || Math.floor(Date.now() / 1000)) * 1000,
          },
          { persist: false, cache: true, analytics: false }
        );
      }
    }
 
    return NextResponse.json({
      ok: true,
      inserted: ticks.length,
      table: 'market_ticks',
      meta: { source: body.source || null, broadcast: Boolean(body.broadcast) },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e || 'Unknown error') },
      { status: 500 }
    );
  }
}
 
