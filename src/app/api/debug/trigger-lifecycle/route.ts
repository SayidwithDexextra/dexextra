import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const VALID_ACTIONS = ['rollover', 'settlement_start', 'settlement_finalize'] as const;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured on the server' }, { status: 500 });
  }

  const clientSecret =
    req.headers.get('x-admin-secret') ||
    (typeof body.admin_secret === 'string' ? body.admin_secret : '');

  if (!clientSecret || clientSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized – invalid admin secret' }, { status: 403 });
  }

  const { action, market_id, market_address, price } = body;

  if (!market_id || typeof market_id !== 'string') {
    return NextResponse.json({ error: 'market_id is required' }, { status: 400 });
  }

  const baseUrl =
    process.env.APP_URL?.replace(/\/+$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${process.env.PORT || 3000}`);

  if (action === 'challenge') {
    if (!price || typeof price !== 'number' || price <= 0) {
      return NextResponse.json({ error: 'A positive price is required for challenge' }, { status: 400 });
    }

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

  const lifecycleBody: Record<string, unknown> = { action, market_id };
  if (typeof market_address === 'string' && market_address) {
    lifecycleBody.marketAddress = market_address;
  }

  const res = await fetch(`${baseUrl}/api/cron/market-lifecycle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify(lifecycleBody),
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
