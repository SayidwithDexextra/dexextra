import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function isValidWallet(w: unknown): w is string {
  return typeof w === 'string' && /^0x[a-fA-F0-9]{40}$/.test(w);
}

/**
 * GET /api/market-drafts?wallet=0x...
 * Returns summary list of active drafts (no full blob).
 */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')?.toLowerCase();
  if (!isValidWallet(wallet)) {
    return NextResponse.json({ error: 'Missing or invalid wallet address' }, { status: 400 });
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  const { data, error } = await sb
    .from('market_drafts')
    .select('id, title, current_step, created_at, updated_at')
    .eq('creator_wallet', wallet)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[market-drafts] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch drafts' }, { status: 500 });
  }

  return NextResponse.json({ drafts: data ?? [] });
}

/**
 * POST /api/market-drafts
 * Upserts a draft. Body: { id, wallet, title, current_step, draft_state, schema_version }
 * Also supports { action: 'load', id, wallet } to fetch full draft state.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  const wallet = (body.wallet as string)?.toLowerCase();
  if (!isValidWallet(wallet)) {
    return NextResponse.json({ error: 'Missing or invalid wallet' }, { status: 400 });
  }

  // Load action: fetch full draft state by ID
  if (body.action === 'load') {
    const { id } = body;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing draft id' }, { status: 400 });
    }

    const { data, error } = await sb
      .from('market_drafts')
      .select('*')
      .eq('id', id)
      .eq('creator_wallet', wallet)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    return NextResponse.json({ draft: data });
  }

  // Complete action: mark draft as completed with a link to the deployed market
  if (body.action === 'complete') {
    const { id, market_id } = body;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing draft id' }, { status: 400 });
    }

    const { error } = await sb
      .from('market_drafts')
      .update({ status: 'completed', market_id: market_id ?? null })
      .eq('id', id)
      .eq('creator_wallet', wallet);

    if (error) {
      console.error('[market-drafts] complete error:', error);
      return NextResponse.json({ error: 'Failed to complete draft' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // Upsert action (default)
  const { id, title, current_step, draft_state, schema_version } = body;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Missing draft id' }, { status: 400 });
  }

  const row = {
    id,
    creator_wallet: wallet,
    title: typeof title === 'string' ? title.slice(0, 200) : null,
    current_step: typeof current_step === 'string' ? current_step : 'clarify_metric',
    draft_state: draft_state ?? {},
    schema_version: typeof schema_version === 'number' ? schema_version : 1,
    status: 'active' as const,
  };

  const { error } = await sb
    .from('market_drafts')
    .upsert(row, { onConflict: 'id' });

  if (error) {
    console.error('[market-drafts] POST upsert error:', error);
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id });
}

/**
 * DELETE /api/market-drafts?id=...&wallet=0x...
 * Soft-deletes by setting status = 'archived'.
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  const wallet = req.nextUrl.searchParams.get('wallet')?.toLowerCase();

  if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 });
  if (!isValidWallet(wallet)) {
    return NextResponse.json({ error: 'Missing or invalid wallet' }, { status: 400 });
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  const { error } = await sb
    .from('market_drafts')
    .update({ status: 'archived' })
    .eq('id', id)
    .eq('creator_wallet', wallet);

  if (error) {
    console.error('[market-drafts] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to archive draft' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
