import { NextRequest, NextResponse } from 'next/server';
import { broadcastMetricSeries } from '@/lib/pusher-server';

export const runtime = 'nodejs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Debug-only: emit the same Pusher event the token page metric overlay listens to
 * (`metric-${marketId}` / `metric-update`). Does not write Supabase or ClickHouse.
 *
 * Auth: x-admin-secret must match CRON_SECRET (same as other debug lifecycle routes).
 */
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const secret = req.headers.get('x-admin-secret') || '';
  if (!secret || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET) {
    return NextResponse.json({ error: 'Pusher env not configured on server' }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const marketId = typeof body.market_id === 'string' ? body.market_id.trim() : '';
  if (!UUID_RE.test(marketId)) {
    return NextResponse.json({ error: 'market_id must be a valid UUID' }, { status: 400 });
  }

  const metricName = String(
    body.metric_name || body.symbol || body.market_identifier || '',
  )
    .trim()
    .toUpperCase();
  if (!metricName) {
    return NextResponse.json(
      { error: 'metric_name (or symbol / market_identifier) is required' },
      { status: 400 },
    );
  }

  let value = Number(body.value);
  if (!Number.isFinite(value)) {
    value = 1 + Math.sin(Date.now() / 8000) * 0.0007;
  }

  let ts = Number(body.ts);
  if (!Number.isFinite(ts) || ts <= 0) {
    ts = Date.now();
  }

  const version = Number.isFinite(Number(body.version)) ? Number(body.version) : Date.now() % 2_147_483_647;

  try {
    await broadcastMetricSeries({
      marketId,
      metricName,
      ts,
      value,
      source: 'debug_token_realtime_sim',
      version,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    channel: `metric-${marketId}`,
    event: 'metric-update',
    payload: { marketId, metricName, ts, value, source: 'debug_token_realtime_sim', version },
    hint: `Open /token/${metricName} (or your market symbol route) with this market loaded to see the overlay update.`,
  });
}
