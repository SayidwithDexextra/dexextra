import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const marketId = typeof body?.marketId === 'string' ? body.marketId.trim() : '';

    if (!marketId) {
      return NextResponse.json({ success: false, error: 'marketId is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.functions.invoke('startMetricWorker', {
      body: { marketId },
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to start metric worker' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, data: data ?? null });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}



