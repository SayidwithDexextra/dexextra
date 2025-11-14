import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { market_id, market_identifier, price, proposer_wallet, window_seconds } = body || {};

    if ((!market_id && !market_identifier) || !price || Number(price) <= 0 || !Number.isFinite(Number(price))) {
      return NextResponse.json(
        { error: 'Invalid request. Provide market_id or market_identifier and a positive price.' },
        { status: 400 }
      );
    }

    // 1) Load market
    let query = supabase.from('markets').select('*').limit(1);
    if (market_id) query = query.eq('id', market_id);
    else query = query.eq('market_identifier', String(market_identifier));
    const { data: market, error: fetchErr } = await query.maybeSingle();
    if (fetchErr) {
      return NextResponse.json({ error: `Failed to fetch market: ${fetchErr.message}` }, { status: 500 });
    }
    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 });
    }

    // 2) Guard checks
    if (market.market_status === 'SETTLED' || market.settlement_timestamp) {
      return NextResponse.json({ error: 'Market already settled' }, { status: 400 });
    }

    const now = new Date();
    // Configurable window
    const defaultSeconds = Number(process.env.SETTLEMENT_WINDOW_SECONDS || 24 * 60 * 60);
    const allowOverride = String(process.env.ENABLE_TEST_WINDOW_OVERRIDE || '').toLowerCase() === 'true';
    const minSeconds = Number(process.env.SETTLEMENT_WINDOW_MIN_SECONDS || 60);
    const maxSeconds = Number(process.env.SETTLEMENT_WINDOW_MAX_SECONDS || 7 * 24 * 60 * 60);
    let seconds = defaultSeconds;
    if (allowOverride && Number.isFinite(Number(window_seconds)) && Number(window_seconds) > 0) {
      seconds = Math.max(minSeconds, Math.min(maxSeconds, Number(window_seconds)));
    }
    const expires = new Date(now.getTime() + seconds * 1000);

    // If an active window already exists, instruct to use challenge endpoint
    if (market.proposed_settlement_value != null && market.settlement_window_expires_at) {
      const active = new Date(market.settlement_window_expires_at) > now;
      if (active) {
        return NextResponse.json(
          { error: 'Settlement window already active. Use challenge endpoint to propose an alternative.' },
          { status: 409 }
        );
      }
    }

    // 3) Apply proposal (start window)
    const updateData: Record<string, any> = {
      proposed_settlement_value: Number(price),
      proposed_settlement_at: now.toISOString(),
      settlement_window_expires_at: expires.toISOString(),
      proposed_settlement_by: proposer_wallet || null,
      // clear any stale alternative
      alternative_settlement_value: null,
      alternative_settlement_at: null,
      alternative_settlement_by: null,
      settlement_disputed: false,
      market_status: 'SETTLEMENT_REQUESTED',
      updated_at: now.toISOString()
    };

    let update = supabase.from('markets').update(updateData);
    if (market_id) update = update.eq('id', market_id);
    else update = update.eq('market_identifier', String(market_identifier));
    const { data: updated, error: updateErr } = await update.select().single();
    if (updateErr) {
      return NextResponse.json({ error: `Failed to start settlement window: ${updateErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, market: updated });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Internal server error', message: e?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}


