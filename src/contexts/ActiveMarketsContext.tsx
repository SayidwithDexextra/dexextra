'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { usePortfolioData } from '@/hooks/usePortfolioData';
import { useMarkets } from '@/hooks/useMarkets';

type ActiveMarketsState = {
  // Ranked symbols based on user involvement (positions first, then orders).
  rankedSymbols: string[];
  // True once we have computed a non-empty list at least once for this wallet.
  hasLoadedOnce: boolean;
};

const ActiveMarketsContext = createContext<ActiveMarketsState | undefined>(undefined);

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function ActiveMarketsProvider({ children }: { children: React.ReactNode }) {
  const { walletData } = useWallet() as any;
  const walletAddress: string | null = walletData?.address || null;

  // Source data (polled/cached inside these hooks)
  const { positions, ordersBuckets } = usePortfolioData({ enabled: true, refreshInterval: 30000 });
  const { markets } = useMarkets({ limit: 500, autoRefresh: true, refreshInterval: 60000 });

  // Persist last-known-good ranked symbols per wallet to avoid flicker across navigation / transient empty reads.
  const lastByWalletRef = useRef<Map<string, string[]>>(new Map());

  const [rankedSymbols, setRankedSymbols] = useState<string[]>(() => []);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const marketIdToSymbol = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of markets || []) {
      const key = String((m as any)?.market_id_bytes32 || '').toLowerCase();
      if (!key) continue;
      const sym = String((m as any)?.symbol || '').toUpperCase();
      if (sym) map.set(key, sym);
    }
    return map;
  }, [markets]);

  const computedRanked = useMemo(() => {
    type Candidate = {
      symbol: string;
      hasPosition: boolean;
      hasOrders: boolean;
      positionNotional: number;
      positionAbsSize: number;
      orderNotional: number;
      ordersCount: number;
    };

    const bySymbol = new Map<string, Candidate>();
    const upsert = (symbolRaw: string) => {
      const symbol = String(symbolRaw || '').toUpperCase();
      if (!symbol) return null;
      const existing = bySymbol.get(symbol);
      if (existing) return existing;
      const next: Candidate = {
        symbol,
        hasPosition: false,
        hasOrders: false,
        positionNotional: 0,
        positionAbsSize: 0,
        orderNotional: 0,
        ordersCount: 0,
      };
      bySymbol.set(symbol, next);
      return next;
    };

    // Positions (highest priority)
    for (const p of positions || []) {
      const keyHex = String((p as any)?.marketId || '').toLowerCase();
      const mapped = keyHex ? marketIdToSymbol.get(keyHex) : null;
      const fallbackSym = String((p as any)?.symbol || '');
      const symbol = (mapped || fallbackSym || '').toUpperCase();
      if (!symbol || symbol === 'UNKNOWN') continue;

      const absSize = Math.abs(Number((p as any)?.size || 0)) || 0;
      const px = Number((p as any)?.markPrice || (p as any)?.entryPrice || 0) || 0;
      const notional = Math.abs(absSize * px);

      const row = upsert(symbol);
      if (!row) continue;
      row.hasPosition = true;
      row.positionAbsSize += Number.isFinite(absSize) ? absSize : 0;
      row.positionNotional += Number.isFinite(notional) ? notional : 0;
    }

    // Orders (secondary)
    for (const b of ordersBuckets || []) {
      const symbol = String((b as any)?.symbol || '').toUpperCase();
      if (!symbol) continue;

      const orders = Array.isArray((b as any)?.orders) ? (b as any).orders : [];
      const orderNotional = orders.reduce((sum: number, o: any) => {
        const q = Number(o?.quantity || o?.size || 0) || 0;
        const pr = Number(o?.price || 0) || 0;
        const n = Math.abs(q * pr);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);

      const row = upsert(symbol);
      if (!row) continue;
      row.hasOrders = true;
      row.ordersCount += orders.length;
      row.orderNotional += Number.isFinite(orderNotional) ? orderNotional : 0;
    }

    const candidates = Array.from(bySymbol.values())
      .filter(c => c.hasPosition || c.hasOrders)
      .sort((a, b) => {
        if (a.hasPosition !== b.hasPosition) return a.hasPosition ? -1 : 1;
        if (a.hasPosition && b.hasPosition) {
          const na = a.positionNotional > 0 ? a.positionNotional : a.positionAbsSize;
          const nb = b.positionNotional > 0 ? b.positionNotional : b.positionAbsSize;
          if (nb !== na) return nb - na;
          return a.symbol.localeCompare(b.symbol);
        }
        const oa = a.orderNotional > 0 ? a.orderNotional : a.ordersCount;
        const ob = b.orderNotional > 0 ? b.orderNotional : b.ordersCount;
        if (ob !== oa) return ob - oa;
        return a.symbol.localeCompare(b.symbol);
      })
      .map(c => c.symbol);

    return uniq(candidates);
  }, [positions, ordersBuckets, marketIdToSymbol]);

  // Keep stable across navigation: only update on a meaningful (non-empty) computation or explicit wallet change.
  useEffect(() => {
    // Wallet disconnected: clear everything.
    if (!walletAddress) {
      setRankedSymbols([]);
      setHasLoadedOnce(false);
      return;
    }

    const key = walletAddress.toLowerCase();

    // If we have a previous stable list for this wallet, seed immediately.
    const cached = lastByWalletRef.current.get(key);
    if (cached && cached.length > 0) {
      setRankedSymbols(prev => (prev.length ? prev : cached));
      setHasLoadedOnce(true);
    }

    // Update cache only if we computed a non-empty list.
    if (computedRanked.length > 0) {
      lastByWalletRef.current.set(key, computedRanked);
      setRankedSymbols(computedRanked);
      setHasLoadedOnce(true);
    }
  }, [walletAddress, computedRanked]);

  const value = useMemo<ActiveMarketsState>(() => {
    return { rankedSymbols, hasLoadedOnce };
  }, [rankedSymbols, hasLoadedOnce]);

  return <ActiveMarketsContext.Provider value={value}>{children}</ActiveMarketsContext.Provider>;
}

export function useActiveMarkets(): ActiveMarketsState {
  const ctx = useContext(ActiveMarketsContext);
  if (!ctx) throw new Error('useActiveMarkets must be used within ActiveMarketsProvider');
  return ctx;
}





