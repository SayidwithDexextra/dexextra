import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest) {
  try {
    const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const startedAt = Date.now();
    const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!projectUrl || !anonKey) {
      console.error(`[update-tickers][${traceId}] Missing Supabase env`, {
        hasProjectUrl: Boolean(projectUrl),
        hasAnonKey: Boolean(anonKey),
      });
      return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
    }
    const fnUrl = projectUrl.replace('supabase.co', 'functions.supabase.co') + '/update-tickers';

    console.log(`[update-tickers][${traceId}] Invoking function`, { fnUrl });

    const res = await fetch(fnUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${anonKey}`,
        'x-trace-id': traceId,
      },
    });

    const rawText = await res.text().catch(() => '');
    let data: unknown = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { raw: rawText };
    }

    console.log(`[update-tickers][${traceId}] Function response`, {
      status: res.status,
      ok: res.ok,
      durationMs: Date.now() - startedAt,
      bodyPreview: rawText?.slice(0, 1000) ?? null,
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: (data as any)?.error || 'Function error', traceId, status: res.status },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true, data, traceId });
  } catch (e) {
    const message = (e as Error)?.message || 'Unknown error';
    console.error('[update-tickers] Route error', { message, stack: (e as Error)?.stack });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


