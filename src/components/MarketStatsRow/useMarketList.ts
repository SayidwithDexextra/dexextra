'use client';

import { useEffect, useState } from 'react';
import type { MarketListItem } from './types';

function formatPrice(n: number): string {
  const v = Number(n) || 0;
  if (v <= 0) return '—';
  const abs = Math.abs(v);
  const max = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Math.min(2, max),
    maximumFractionDigits: max,
  }).format(v);
}

function formatCompactUsd(n: number): string {
  const v = Number(n) || 0;
  if (v <= 0) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(v);
}

function toRankingItem(
  r: any,
  extras?: { price?: number; volume?: number; change?: number | null; name?: string; slug?: string }
): MarketListItem | null {
  const id = String(r?.marketUuid || r?.market_uuid || r?.id || '').trim();
  if (!id) return null;
  const symbol = String(r?.symbol || '').trim();
  const ident = String(r?.market_identifier || extras?.slug || '').trim();
  const slug = ident || symbol || id;
  const name = String(extras?.name || symbol || ident || id).trim();
  const rawChange = extras?.change ?? r?.priceChange24hPct ?? r?.price_change_24h_pct;
  const parsed = rawChange == null || rawChange === '' ? NaN : Number(rawChange);
  const changePct = Number.isFinite(parsed) ? parsed : null;
  const priceRaw = Number(extras?.price ?? r?.close24h ?? r?.close1h ?? r?.close_24h ?? 0);
  const volumeRaw = Number(extras?.volume ?? r?.notionalVolume ?? r?.notional_volume ?? 0);
  return {
    id,
    slug,
    name,
    price: formatPrice(priceRaw),
    volume24h: formatCompactUsd(volumeRaw),
    changePct,
    direction: (changePct ?? 0) >= 0 ? 'up' : 'down',
  };
}

function toOverviewItem(m: any): MarketListItem | null {
  const id = String(m?.market_id || m?.id || '').trim();
  if (!id) return null;
  const raw = Number(m.mark_price ?? 0);
  const price = raw > 0 ? raw / 1_000_000 : 0;
  const vol = Number(m.total_volume ?? 0);
  return {
    id,
    slug: m.market_identifier || m.symbol || id,
    name: m.name || m.symbol || id,
    price: formatPrice(price),
    volume24h: formatCompactUsd(vol),
    changePct: null,
    direction: 'up',
  };
}

async function fetchRankings(
  kind: 'trending' | 'top_volume',
  windowHours: number,
  limit: number,
  signal: AbortSignal
): Promise<any[]> {
  const qs = new URLSearchParams({
    kind,
    limit: String(limit),
    windowHours: String(windowHours),
  });
  const res = await fetch(`/api/market-rankings?${qs}`, { signal, cache: 'no-store' });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error('ranking_fetch_failed');
  return Array.isArray(json.rows) ? json.rows : [];
}

async function fetchOverview(signal: AbortSignal): Promise<any[]> {
  const qs = new URLSearchParams({
    limit: '50',
    status: 'ACTIVE,SETTLEMENT_REQUESTED',
  });
  const res = await fetch(`/api/market-overview?${qs}`, { signal, cache: 'no-store' });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error('overview_fetch_failed');
  return Array.isArray(json.markets) ? json.markets : [];
}

export function useMarketList(kind: 'trending' | 'top_volume', limit = 4) {
  const [markets, setMarkets] = useState<MarketListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        setIsLoading(true);
        setError(null);

        let ranked: MarketListItem[] = [];

        if (kind === 'trending') {
          let rows = await fetchRankings('trending', 168, 25, ctrl.signal);
          if (rows.length < limit) {
            const wider = await fetchRankings('trending', 720, 25, ctrl.signal);
            if (wider.length > rows.length) rows = wider;
          }
          ranked = rows.map((r) => toRankingItem(r)).filter((x): x is MarketListItem => x != null);
        } else {
          let volRows = await fetchRankings('top_volume', 24, 25, ctrl.signal);
          const trendRows = await fetchRankings('trending', 168, 50, ctrl.signal).catch(() => [] as any[]);
          if (volRows.length < limit) {
            volRows = [...trendRows].sort(
              (a, b) =>
                (Number(b?.notionalVolume ?? b?.notional_volume) || 0) -
                (Number(a?.notionalVolume ?? a?.notional_volume) || 0)
            );
          }
          const byId = new Map<string, any>();
          trendRows.forEach((r) => {
            const id = String(r?.marketUuid || r?.market_uuid || '').trim();
            if (id) byId.set(id, r);
          });
          ranked = volRows
            .map((r) => {
              const id = String(r?.marketUuid || r?.market_uuid || '').trim();
              const hit = byId.get(id);
              return toRankingItem(r, {
                price: Number(hit?.close24h ?? hit?.close1h ?? r?.close24h ?? 0),
                volume: Number(r?.notionalVolume ?? r?.notional_volume ?? hit?.notionalVolume ?? 0),
                change: Number(hit?.priceChange24hPct ?? r?.priceChange24hPct),
              });
            })
            .filter((x): x is MarketListItem => x != null);
        }

        if (ranked.length >= limit) {
          setMarkets(ranked.slice(0, limit));
          setIsLoading(false);
          return;
        }

        // ClickHouse rankings are often empty (no ticks). Fall back to the same
        // overview feed the hero uses so the panels still list live markets.
        const overview = await fetchOverview(ctrl.signal);
        const fromOverview = overview
          .map(toOverviewItem)
          .filter((x): x is MarketListItem => x != null);

        const sorted = [...fromOverview].sort((a, b) => {
          if (kind === 'top_volume') {
            const av = overview.find((m) => String(m.market_id) === a.id);
            const bv = overview.find((m) => String(m.market_id) === b.id);
            return (Number(bv?.total_volume) || 0) - (Number(av?.total_volume) || 0);
          }
          const at = overview.find((m) => String(m.market_id) === a.id);
          const bt = overview.find((m) => String(m.market_id) === b.id);
          const trades = (Number(bt?.total_trades) || 0) - (Number(at?.total_trades) || 0);
          if (trades !== 0) return trades;
          return String(a.name).localeCompare(String(b.name));
        });

        const byId = new Map(ranked.map((m) => [m.id, m]));
        const merged = sorted.map((m) => byId.get(m.id) ?? m);
        setMarkets((merged.length ? merged : fromOverview).slice(0, limit));
        setIsLoading(false);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        setError('Couldn’t load markets');
        setIsLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [kind, limit]);

  return { markets, isLoading, error };
}
