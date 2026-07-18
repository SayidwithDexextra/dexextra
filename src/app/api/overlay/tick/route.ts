import { NextRequest, NextResponse } from 'next/server';
import { isOverlayEnabledServer } from '@/lib/overlay/config';
import { advanceAllOverlays } from '@/lib/overlay/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/overlay/tick  (also GET, for easy cron wiring)
 *
 * Advances + persists every overlay row so mark prices keep moving even for
 * markets nobody is actively viewing. Wire this to a scheduler (e.g. Vercel
 * Cron) every few seconds/minutes. Idempotent and cheap when nothing is stale.
 */
async function handle() {
  if (!isOverlayEnabledServer()) {
    return NextResponse.json({ ok: true, enabled: false, advanced: 0 });
  }
  try {
    const advanced = await advanceAllOverlays();
    return NextResponse.json({ ok: true, enabled: true, advanced });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message || 'tick failed' },
      { status: 500 }
    );
  }
}

export async function POST(_req: NextRequest) {
  return handle();
}

export async function GET(_req: NextRequest) {
  return handle();
}
