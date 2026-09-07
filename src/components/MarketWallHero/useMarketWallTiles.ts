'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMarketOverview } from '@/hooks/useMarketOverview';
import type { MarketWallTile } from './types';

const fmtUsd = (v: number) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const max = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Math.min(2, max),
    maximumFractionDigits: max,
  }).format(n);
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Jagged 7-point walk, biased up or down — matches the handoff sparkline shape. */
export function fallbackSparkline(id: string, up: boolean): number[] {
  let seed = hashSeed(id || 'market');
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const n = 7;
  let v = up ? 4 + rand() * 4 : 16 + rand() * 4;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const drift = up ? 1.6 : -1.6;
    v += drift * (0.45 + rand() * 0.9) + (rand() - 0.45) * 3.2 * (1 - t * 0.25);
    v = Math.max(1, Math.min(24, v));
    out.push(v);
  }
  out[n - 1] = up ? Math.max(out[n - 1], out[0] + 2) : Math.min(out[n - 1], out[0] - 2);
  return out;
}

function downsample(values: number[], n = 8): number[] {
  if (values.length <= n) return values;
  return Array.from({ length: n }, (_, i) => {
    const idx = Math.round((i / (n - 1)) * (values.length - 1));
    return values[idx];
  });
}

function changeFromSeries(series?: number[]): number | null {
  if (!series || series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  if (!Number.isFinite(first) || first === 0 || !Number.isFinite(last)) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

/**
 * Feeds the hero's market wall.
 *
 * Prices come from useMarketOverview (mark_price is 1e6-scaled, same as
 * app/page.tsx does for Top Picks). 24h change comes from
 * /api/market-rankings?kind=trending. Sparklines prefer /api/charts/ohlcv
 * and fall back to a directional polyline so every tile always has a line.
 */
export function useMarketWallTiles(limit = 6) {
  const { data: overview, isLoading } = useMarketOverview({
    status: ['ACTIVE', 'SETTLEMENT_REQUESTED'],
    autoRefresh: false,
    realtime: false,
  });

  const [rankings, setRankings] = useState<any[]>([]);
  const [seriesById, setSeriesById] = useState<Record<string, number[]>>({});

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const qs = new URLSearchParams({
          kind: 'trending',
          limit: '50',
          windowHours: '168',
        });
        const res = await fetch(`/api/market-rankings?${qs}`, {
          signal: ctrl.signal,
          cache: 'no-store',
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) return;
        setRankings(Array.isArray(json.rows) ? json.rows : []);
      } catch (e: any) {
        if (e?.name !== 'AbortError') console.error('market wall rankings', e);
      }
    })();
    return () => ctrl.abort();
  }, []);

  const changeLookup = useMemo(() => {
    const byId = new Map<string, number>();
    const bySymbol = new Map<string, number>();
    rankings.forEach((r: any) => {
      const pct = Number(r?.priceChange24hPct ?? r?.price_change_24h_pct);
      if (!Number.isFinite(pct)) return;
      const id = String(r?.marketUuid || r?.market_uuid || '').trim();
      if (id) byId.set(id, pct);
      const sym = String(r?.symbol || '').toUpperCase().trim();
      if (sym) bySymbol.set(sym, pct);
      const ident = String(r?.market_identifier || '').toUpperCase().trim();
      if (ident) bySymbol.set(ident, pct);
    });
    return { byId, bySymbol };
  }, [rankings]);

  const selected = useMemo(() => {
    const mapped = ((overview as any[]) || []).map((m) => {
      const raw = Number(m.mark_price ?? 0);
      const price = raw > 0 ? raw / 1_000_000 : 0;
      const symbol = String(m.symbol || '').toUpperCase().trim();
      const identifier = String(m.market_identifier || '').toUpperCase().trim();
      const changePct =
        changeLookup.byId.get(String(m.market_id || '').trim()) ??
        changeLookup.bySymbol.get(symbol) ??
        changeLookup.bySymbol.get(identifier) ??
        null;

      return {
        id: String(m.market_id || ''),
        slug: m.market_identifier || m.symbol,
        name: m.name || m.symbol,
        price: fmtUsd(price),
        changePct,
      };
    });

    return mapped
      .sort((a, b) => {
        const aHas = a.changePct != null ? 1 : 0;
        const bHas = b.changePct != null ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0);
      })
      .slice(0, limit);
  }, [overview, changeLookup, limit]);

  const idsKey = selected.map((t) => t.id).join(',');

  useEffect(() => {
    const ids = idsKey.split(',').filter(Boolean);
    if (!ids.length) return;
    const ctrl = new AbortController();

    (async () => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(
              `/api/charts/ohlcv?marketId=${encodeURIComponent(id)}&timeframe=1h&limit=24`,
              { signal: ctrl.signal, cache: 'no-store' }
            );
            const json = await res.json().catch(() => null);
            const closes = Array.isArray(json?.data)
              ? json.data
                  .map((d: any) => Number(d?.close ?? d?.c ?? d?.y))
                  .filter((n: number) => Number.isFinite(n))
              : [];
            if (closes.length < 2) return null;
            return [id, downsample(closes.slice().reverse(), 8)] as const;
          } catch (e: any) {
            if (e?.name === 'AbortError') throw e;
            return null;
          }
        })
      );

      const next: Record<string, number[]> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setSeriesById(next);
    })().catch((e: any) => {
      if (e?.name !== 'AbortError') console.error('market wall ohlcv', e);
    });

    return () => ctrl.abort();
  }, [idsKey]);

  const tiles: MarketWallTile[] = useMemo(() => {
    return selected.map((t) => {
      const live = seriesById[t.id];
      const changePct = t.changePct ?? changeFromSeries(live);
      const direction: 'up' | 'down' = (changePct ?? 0) >= 0 ? 'up' : 'down';
      // ClickHouse often has no 1h candles yet; keep a directional polyline so
      // the 22px spark row is never an empty gap.
      const series =
        live && live.length > 1 ? live : fallbackSparkline(t.id, direction === 'up');
      return { ...t, changePct, direction, series };
    });
  }, [selected, seriesById]);

  return { tiles, isLoading, totalMarkets: ((overview as any[]) || []).length };
}
