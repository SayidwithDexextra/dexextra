import { NextRequest, NextResponse } from 'next/server';
import { isOverlayEnabledServer } from '@/lib/overlay/config';
import { getAdvancedOverlay } from '@/lib/overlay/server';
import { toOverlayPayload, emptyOverlayPayload } from '@/lib/overlay/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/overlay/[symbol]
 *
 * Returns the full liquidity-overlay payload (mark price + synthetic book +
 * synthetic trade tape) for a single market. Used by the market page.
 *
 * When the overlay flag is off, returns `{ enabled: false }` and the client
 * silently falls back to 100% real data.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } }
) {
  const symbol = decodeURIComponent(params.symbol || '').toUpperCase();

  if (!isOverlayEnabledServer()) {
    return NextResponse.json(
      { ok: true, data: emptyOverlayPayload(symbol) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const state = await getAdvancedOverlay(symbol);
    return NextResponse.json(
      { ok: true, data: toOverlayPayload(state, true) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    // Never break the page on overlay failure — degrade to "disabled".
    return NextResponse.json(
      { ok: true, data: emptyOverlayPayload(symbol) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
