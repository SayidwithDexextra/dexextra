import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { market_id, market_identifier, price, proposer_wallet } = body || {};

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

    // 2) Validate active window
    const now = new Date();
    const hasProposal = market.proposed_settlement_value != null && market.proposed_settlement_at;
    const windowActive =
      hasProposal &&
      market.settlement_window_expires_at &&
      new Date(market.settlement_window_expires_at) > now;
    if (!windowActive) {
      return NextResponse.json({ error: 'No active settlement window' }, { status: 409 });
    }

    // 3) Apply challenge
    const updateData: Record<string, any> = {
      alternative_settlement_value: Number(price),
      alternative_settlement_at: now.toISOString(),
      alternative_settlement_by: proposer_wallet || null,
      settlement_disputed: true,
      updated_at: now.toISOString()
    };

    let update = supabase.from('markets').update(updateData);
    if (market_id) update = update.eq('id', market_id);
    else update = update.eq('market_identifier', String(market_identifier));
    const { data: updated, error: updateErr } = await update.select().single();
    if (updateErr) {
      return NextResponse.json({ error: `Failed to submit alternative price: ${updateErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, market: updated });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Internal server error', message: e?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}














