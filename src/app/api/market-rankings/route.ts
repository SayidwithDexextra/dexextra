import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Kind = 'top_volume' | 'trending';

function toInt(value: string | null, fallback: number): number {
  const n = value == null ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(value: string | null, fallback: number): number {
  const n = value == null ? NaN : Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function asKind(value: string | null): Kind {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'top_volume' || v === 'top-volume' || v === 'topvolume') return 'top_volume';
  if (v === 'trending') return 'trending';
  return 'trending';
}

async function enrichWithMarketIcons(rows: any[]): Promise<any[]> {
  const ids = Array.from(
    new Set(
      (rows || [])
        .map((r: any) => String(r?.marketUuid || r?.market_uuid || '').trim())
        .filter(Boolean)
    )
  );
  if (ids.length === 0) return rows;

  try {
    const { data, error } = await supabaseAdmin
      .from('markets')
      .select('id, icon_image_url')
      .in('id', ids);
    if (error || !data) return rows;
    const byId = new Map<string, string | null>();
    (data as any[]).forEach((m: any) => {
      const id = m?.id ? String(m.id) : null;
      if (!id) return;
      const url = typeof m?.icon_image_url === 'string' && m.icon_image_url.trim() ? m.icon_image_url.trim() : null;
      byId.set(id, url);
    });
    return (rows || []).map((r: any) => {
      const id = String(r?.marketUuid || r?.market_uuid || '').trim();
      const iconUrl = id ? (byId.get(id) ?? null) : null;
      return { ...r, iconUrl };
    });
  } catch {
    return rows;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const kind = asKind(searchParams.get('kind'));
    const limit = toInt(searchParams.get('limit'), 50);

    const clickhouse = getClickHouseDataPipeline();
    if (!clickhouse.isConfigured()) {
      return NextResponse.json({
        success: true,
        kind,
        rows: [],
        meta: { degraded: true, reason: 'clickhouse_not_configured' },
      });
    }

    if (kind === 'top_volume') {
      const windowHours = toInt(searchParams.get('windowHours'), 24);
      const minTrades = toInt(searchParams.get('minTrades'), 0);
      const minNotional = toFloat(searchParams.get('minNotional'), 0);

      const rows = await clickhouse.getTopVolumeMarkets({
        windowHours,
        limit,
        minTrades,
        minNotional,
      });

      const enriched = await enrichWithMarketIcons(rows as any[]);
      return NextResponse.json({
        success: true,
        kind,
        rows: enriched,
        meta: { windowHours, limit, minTrades, minNotional },
      });
    }

    // trending
    const minTrades24h = toInt(searchParams.get('minTrades24h'), 0);
    const minNotional24h = toFloat(searchParams.get('minNotional24h'), 0);
    const windowHours = toInt(searchParams.get('windowHours'), 24);

    // Optional weight overrides via query params (keep these lightweight for experimentation).
    // Example: /api/market-rankings?kind=trending&w_notional1h=0.4&w_trades1h=0.1
    const weights = {
      notional1h: toFloat(searchParams.get('w_notional1h'), NaN),
      notional24h: toFloat(searchParams.get('w_notional24h'), NaN),
      trades1h: toFloat(searchParams.get('w_trades1h'), NaN),
      absPriceChange1hPct: toFloat(searchParams.get('w_absPriceChange1hPct'), NaN),
      absPriceChange24hPct: toFloat(searchParams.get('w_absPriceChange24hPct'), NaN),
      accel1h: toFloat(searchParams.get('w_accel1h'), NaN),
    } as const;

    const cleanedWeights: Record<string, number> = {};
    for (const [k, v] of Object.entries(weights)) {
      if (Number.isFinite(v)) cleanedWeights[k] = v as number;
    }

    const rows = await clickhouse.getTrendingMarkets({
      limit,
      minTrades24h,
      minNotional24h,
      windowHours,
      weights: Object.keys(cleanedWeights).length ? (cleanedWeights as any) : undefined,
    });

    const enriched = await enrichWithMarketIcons(rows as any[]);
    return NextResponse.json({
      success: true,
      kind,
      rows: enriched,
      meta: { limit, minTrades24h, minNotional24h, windowHours, weights: Object.keys(cleanedWeights).length ? cleanedWeights : null },
    });
  } catch (error) {
    console.error('❌ market-rankings API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to compute market rankings',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

