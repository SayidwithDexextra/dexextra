import { NextRequest, NextResponse } from 'next/server';
import { isOverlayEnabledServer } from '@/lib/overlay/config';
import { getOverlayMarkPrices } from '@/lib/overlay/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/overlay?symbols=BITCOIN,ETH,...
 *
 * Batch platform-wide overlay mark prices. Powers surfaces that show many
 * markets at once (explore lists, portfolio, tickers) so they can display the
 * overlaid price without each row spinning up a full per-market poller.
 *
 * Response: { ok, enabled, prices: { SYMBOL: number } }
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('symbols') || '';
  const symbols = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!isOverlayEnabledServer()) {
    return NextResponse.json(
      { ok: true, enabled: false, prices: {} },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const prices = symbols.length ? await getOverlayMarkPrices(symbols) : {};
    return NextResponse.json(
      { ok: true, enabled: true, prices },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: true, enabled: true, prices: {} },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
