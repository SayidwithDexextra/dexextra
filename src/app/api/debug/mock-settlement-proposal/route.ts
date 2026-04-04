import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

const DEFAULT_WINDOW_SEC = 24 * 60 * 60;

/**
 * Debug-only: write proposed_settlement_* to Supabase so the token page Settlement UI shows
 * a proposed price and an active challenge window (same fields as AI completion).
 *
 * Auth: x-admin-secret must match CRON_SECRET.
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

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const marketId = typeof body.market_id === 'string' ? body.market_id.trim() : '';
  if (!UUID_RE.test(marketId)) {
    return NextResponse.json({ error: 'market_id must be a valid UUID' }, { status: 400 });
  }

  const clear = body.clear === true;

  const { data: row, error: fetchErr } = await supabase
    .from('markets')
    .select('id, market_identifier, market_status, settlement_date, market_config')
    .eq('id', marketId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  const nowIso = new Date().toISOString();

  if (clear) {
    const { error } = await supabase
      .from('markets')
      .update({
        proposed_settlement_value: null,
        proposed_settlement_at: null,
        proposed_settlement_by: null,
        updated_at: nowIso,
      })
      .eq('id', marketId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      cleared: true,
      market_id: marketId,
      hint: 'Reload the token page or wait for realtime to refresh proposed fields.',
    });
  }

  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json(
      { error: 'price is required and must be a positive number (or pass clear: true)' },
      { status: 400 },
    );
  }

  const cfg = asRecord(row.market_config);
  const scheduler = asRecord(cfg.settlement_scheduler);
  const challengeSec = Number(
    cfg.challenge_window_seconds ||
      cfg.challenge_duration_seconds ||
      scheduler.challenge_window_seconds ||
      scheduler.challenge_duration_seconds ||
      0,
  );
  const windowSec = challengeSec > 0 ? challengeSec : DEFAULT_WINDOW_SEC;

  const settlementMs = row.settlement_date ? Date.parse(String(row.settlement_date)) : NaN;
  const expiresAt =
    Number.isFinite(settlementMs) && settlementMs > 0
      ? new Date(Math.max(settlementMs + windowSec * 1000, Date.now() + 60_000))
      : new Date(Date.now() + windowSec * 1000);

  const expiresIso = expiresAt.toISOString();
  const updatedConfig = {
    ...cfg,
    expires_at: expiresIso,
    settlement_scheduler: {
      ...scheduler,
      stage: 'window_started',
      started_at: nowIso,
      expires_at: expiresIso,
    },
  };

  const status = String(row.market_status || '');
  const nextStatus = status === 'SETTLED' ? 'SETTLED' : 'SETTLEMENT_REQUESTED';

  const { error: updErr } = await supabase
    .from('markets')
    .update({
      proposed_settlement_value: price,
      proposed_settlement_at: nowIso,
      proposed_settlement_by: 'DEBUG_PREVIEW',
      market_status: nextStatus,
      market_config: updatedConfig,
      updated_at: nowIso,
    })
    .eq('id', marketId);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    market_id: marketId,
    proposed_settlement_value: price,
    proposed_settlement_at: nowIso,
    proposed_settlement_by: 'DEBUG_PREVIEW',
    market_status: nextStatus,
    challenge_window_expires_at: expiresIso,
    hint:
      'Open the token page settlement overlay and refresh (or rely on Supabase realtime). SETTLED markets keep status; proposal fields still update for inspection.',
  });
}
