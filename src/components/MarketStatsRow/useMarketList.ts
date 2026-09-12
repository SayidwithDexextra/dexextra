'use client';

import { useEffect, useState } from 'react';
import type { MarketListItem } from './types';

function scalePrice(raw: number): number {
  const n = Number(raw) || 0;
  if (n <= 0) return 0;
  return raw > 1_000 ? raw / 1_000_000 : raw;
}

function formatPrice(n: number): string {
  const v = Number(n) || 0;
  if (v <= 0) return '';
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
  if (v <= 0) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(v);
}

function parseChange(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function rankingId(r: any): string {
  return String(r?.marketUuid || r?.market_uuid || r?.id || '').trim();
}

function toOverviewItem(m: any, changePct: number | null): MarketListItem | null {
  const id = String(m?.market_id || m?.id || '').trim();
  if (!id) return null;
  const price = scalePrice(Number(m.mark_price ?? m.initial_price ?? m.last_trade_price ?? 0));
  const volume = Number(m.total_volume ?? 0) || 0;
  const name = String(m.name || m.symbol || m.market_identifier || id).trim();
  return {
    id,
    slug: m.market_identifier || m.symbol || id,
    name,
    price: formatPrice(price),
    volume24h: formatCompactUsd(volume),
    priceNum: price,
    volumeNum: volume,
    changePct,
    direction: (changePct ?? 0) >= 0 ? 'up' : 'down',
  };
}

function overlayRanking(
  item: MarketListItem,
  r: any | undefined
): MarketListItem {
  if (!r) return item;
  const changePct = parseChange(r.priceChange24hPct ?? r.price_change_24h_pct) ?? item.changePct;
  const rankPrice = scalePrice(Number(r.close24h ?? r.close1h ?? r.close_24h ?? 0));
  const rankVolume = Number(r.notionalVolume ?? r.notional_volume ?? 0) || 0;
  const priceNum = item.priceNum > 0 ? item.priceNum : rankPrice;
  const volumeNum = item.volumeNum > 0 ? item.volumeNum : rankVolume;
  return {
    ...item,
    price: formatPrice(priceNum) || item.price,
    volume24h: formatCompactUsd(volumeNum) || item.volume24h,
    priceNum,
    volumeNum,
    changePct,
    direction: (changePct ?? 0) >= 0 ? 'up' : 'down',
  };
}

async function fetchRankings(
  kind: 'trending' | 'top_volume',
  windowHours: number,
  limit: number,
  signal: AbortSignal
): Promise<any[]> {
  try {
    const qs = new URLSearchParams({
      kind,
      limit: String(limit),
      windowHours: String(windowHours),
    });
    const res = await fetch(`/api/market-rankings?${qs}`, { signal, cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) return [];
    return Array.isArray(json.rows) ? json.rows : [];
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    return [];
  }
}

async function fetchOverview(signal: AbortSignal): Promise<any[]> {
  try {
    const qs = new URLSearchParams({
      limit: '50',
      status: 'ACTIVE,SETTLEMENT_REQUESTED',
    });
    const res = await fetch(`/api/market-overview?${qs}`, { signal, cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) return [];
    return Array.isArray(json.markets) ? json.markets : [];
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    return [];
  }
}

function sortOverview(overview: any[], kind: 'trending' | 'top_volume'): any[] {
  return [...overview].sort((a, b) => {
    if (kind === 'top_volume') {
      return (Number(b?.total_volume) || 0) - (Number(a?.total_volume) || 0);
    }
    const trades = (Number(b?.total_trades) || 0) - (Number(a?.total_trades) || 0);
    if (trades !== 0) return trades;
    return String(a?.name || a?.symbol || '').localeCompare(String(b?.name || b?.symbol || ''));
  });
}

export function useMarketList(kind: 'trending' | 'top_volume', limit = 4) {
  const [markets, setMarkets] = useState<MarketListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        setIsLoading(true);

        const rankingKind = kind === 'top_volume' ? 'top_volume' : 'trending';
        const windowHours = kind === 'top_volume' ? 24 : 168;

        const [overview, rankedRows] = await Promise.all([
          fetchOverview(ctrl.signal),
          fetchRankings(rankingKind, windowHours, 25, ctrl.signal),
        ]);

        let rows = rankedRows;
        if (kind === 'trending' && rows.length < limit) {
          const wider = await fetchRankings('trending', 720, 25, ctrl.signal);
          if (wider.length > rows.length) rows = wider;
        }

        const changeById = new Map<string, number>();
        const changeBySymbol = new Map<string, number>();
        const rankById = new Map<string, any>();
        const rankOrder: string[] = [];
        for (const r of rows) {
          const id = rankingId(r);
          const pct = parseChange(r?.priceChange24hPct ?? r?.price_change_24h_pct);
          if (id) {
            rankOrder.push(id);
            rankById.set(id, r);
            if (pct != null) changeById.set(id, pct);
          }
          const sym = String(r?.symbol || '').toUpperCase().trim();
          if (sym && pct != null) changeBySymbol.set(sym, pct);
        }

        const overviewById = new Map<string, any>();
        for (const m of overview) {
          const id = String(m?.market_id || m?.id || '').trim();
          if (id) overviewById.set(id, m);
        }

        const toItem = (m: any): MarketListItem | null => {
          const id = String(m?.market_id || m?.id || '').trim();
          const symbol = String(m?.symbol || '').toUpperCase().trim();
          const changePct =
            changeById.get(id) ?? changeBySymbol.get(symbol) ?? null;
          const item = toOverviewItem(m, changePct);
          return item ? overlayRanking(item, rankById.get(id)) : null;
        };

        const seen = new Set<string>();
        const merged: MarketListItem[] = [];

        for (const id of rankOrder) {
          const m = overviewById.get(id);
          if (!m) continue;
          const item = toItem(m);
          if (!item || seen.has(item.id)) continue;
          seen.add(item.id);
          merged.push(item);
        }

        for (const m of sortOverview(overview, kind)) {
          const item = toItem(m);
          if (!item || seen.has(item.id)) continue;
          seen.add(item.id);
          merged.push(item);
        }

        setMarkets(merged.slice(0, limit));
        setIsLoading(false);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        setMarkets([]);
        setIsLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [kind, limit]);

  return { markets, isLoading };
}
