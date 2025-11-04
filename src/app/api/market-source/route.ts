import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const marketId = searchParams.get('marketId');
    const marketIdentifier = searchParams.get('marketIdentifier');

    if (!marketId && !marketIdentifier) {
      return NextResponse.json({ ok: false, error: 'marketId or marketIdentifier is required' }, { status: 400 });
    }

    let resolvedId = marketId;
    let resolvedIdentifier = marketIdentifier;

    if (!resolvedId && resolvedIdentifier) {
      const { data: mkt, error: e } = await supabase
        .from('markets')
        .select('id')
        .eq('market_identifier', resolvedIdentifier)
        .maybeSingle();
      if (e) throw e;
      resolvedId = mkt?.id || null;
    }

    if (!resolvedIdentifier && resolvedId) {
      const { data: mkt, error: e } = await supabase
        .from('markets')
        .select('market_identifier')
        .eq('id', resolvedId)
        .maybeSingle();
      if (e) throw e;
      resolvedIdentifier = mkt?.market_identifier || null;
    }

    // Prefer markets.market_config.ai_source_locator first
    const { data: mktCfg, error: cfgErr } = await supabase
      .from('markets')
      .select('market_config')
      .or(`id.eq.${resolvedId},market_identifier.eq.${resolvedIdentifier}`)
      .maybeSingle();
    if (cfgErr) throw cfgErr;
    const preferred = mktCfg?.market_config?.ai_source_locator || null;

    // Fallback to legacy market_source_locators table
    let fallback: any = null;
    if (!preferred) {
      const { data: loc, error: locErr } = await supabase
        .from('market_source_locators')
        .select('primary_source_url, css_selector, xpath, html_snippet, js_extractor')
        .or(`market_id.eq.${resolvedId},market_identifier.eq.${resolvedIdentifier}`)
        .maybeSingle();
      if (locErr) throw locErr;
      fallback = loc || null;
    }

    const payload = preferred || fallback || null;
    if (!payload) {
      return NextResponse.json({ ok: false, error: 'No source locator found' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      locator: {
        url: payload.primary_source_url || payload.url || null,
        css_selector: payload.css_selector || null,
        xpath: payload.xpath || null,
        html_snippet: payload.html_snippet || null,
        js_extractor: payload.js_extractor || null,
      }
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load locator' }, { status: 500 });
  }
}



