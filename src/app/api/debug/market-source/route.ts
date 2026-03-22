import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 400 });

    const {
      marketId,
      marketIdentifier,
      primary_source_url,
      css_selector,
      xpath,
      html_snippet,
      js_extractor,
      kit_payload,
      extraction_strategy,
      js_extractor_b64,
    } = body || {};

    if (!marketId && !marketIdentifier) {
      return NextResponse.json({ error: 'marketId or marketIdentifier is required' }, { status: 400 });
    }

    let resolvedMarketId: string | null = marketId || null;
    let resolvedMarketIdentifier: string | null = marketIdentifier || null;
    if (!resolvedMarketId && resolvedMarketIdentifier) {
      const { data: mkt, error: findErr } = await supabase
        .from('markets')
        .select('id')
        .eq('market_identifier', resolvedMarketIdentifier)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!mkt?.id) return NextResponse.json({ error: 'Market not found for marketIdentifier' }, { status: 404 });
      resolvedMarketId = mkt.id;
    }
    if (resolvedMarketId && !resolvedMarketIdentifier) {
      const { data: mktById, error: findByIdErr } = await supabase
        .from('markets')
        .select('market_identifier')
        .eq('id', resolvedMarketId)
        .maybeSingle();
      if (findByIdErr) throw findByIdErr;
      resolvedMarketIdentifier = mktById?.market_identifier || null;
    }

    const newLocator = {
      url: primary_source_url || null,
      selectors: [
        ...(css_selector ? [{ type: 'css' as const, selector: css_selector, confidence: 0.8, sample_value: '' }] : []),
        ...(xpath ? [{ type: 'xpath' as const, xpath, confidence: 0.75, sample_value: '' }] : []),
        ...(js_extractor ? [{ type: 'js_extractor' as const, script: js_extractor, confidence: 0.7, sample_value: '' }] : []),
      ],
      discovered_at: new Date().toISOString(),
      last_successful_at: null,
      success_count: 0,
      failure_count: 0,
      version: 1,
      legacy: { html_snippet, js_extractor_b64, extraction_strategy, kit_payload },
    };

    const { error: updErr } = await supabase
      .from('markets')
      .update({ ai_source_locator: newLocator, updated_at: new Date().toISOString() })
      .eq('id', resolvedMarketId);
    if (updErr) throw updErr;

    return NextResponse.json({ ok: true, market_id: resolvedMarketId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to save market source locator' }, { status: 500 });
  }
}


