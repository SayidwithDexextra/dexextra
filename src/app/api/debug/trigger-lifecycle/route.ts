import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const VALID_ACTIONS = ['rollover', 'settlement_start', 'settlement_finalize'] as const;

export async function POST(req: NextRequest) {
  const nodeEnv = process.env.NODE_ENV;
  const devTools = process.env.NEXT_PUBLIC_DEV_TOOLS;
  const debugPages = process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES;

  const isDev =
    nodeEnv !== 'production' ||
    devTools === 'true' ||
    String(debugPages || '').toLowerCase() === 'true';

  if (!isDev) {
    console.warn('[trigger-lifecycle] Blocked: NODE_ENV=%s, DEV_TOOLS=%s, DEBUG_PAGES=%s', nodeEnv, devTools, debugPages);
    return NextResponse.json({ error: 'Debug endpoints are disabled in production' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, market_id, price } = body;

  if (!market_id || typeof market_id !== 'string') {
    return NextResponse.json({ error: 'market_id is required' }, { status: 400 });
  }

  if (action === 'challenge') {
    if (!price || typeof price !== 'number' || price <= 0) {
      return NextResponse.json({ error: 'A positive price is required for challenge' }, { status: 400 });
    }

    const baseUrl =
      process.env.APP_URL?.replace(/\/+$/, '') ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${process.env.PORT || 3000}`);

    const res = await fetch(`${baseUrl}/api/settlements/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id, price }),
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  }

  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}, challenge` },
      { status: 400 },
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured on the server' }, { status: 500 });
  }

  const baseUrl =
    process.env.APP_URL?.replace(/\/+$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${process.env.PORT || 3000}`);

  const res = await fetch(`${baseUrl}/api/cron/market-lifecycle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({ action, market_id }),
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
