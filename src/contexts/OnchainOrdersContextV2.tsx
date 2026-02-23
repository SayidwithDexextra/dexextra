'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { getPusherClient } from '@/lib/pusher-client';

// ── Types ──────────────────────────────────────────────────────────────
export interface OnchainOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  price: number;
  size: number;
  filled: number;
  status: 'PENDING' | 'PARTIAL' | 'FILLED' | 'CANCELLED';
  timestamp: number;
  metricId: string;
  trader?: string;
  marginRequired?: number;
  isMarginOrder?: boolean;
  /** Order book contract address where this order lives (used for gasless cancel) */
  orderBookAddress?: string | null;
}

interface OnchainOrdersContextValue {
  /** All on-chain orders for the connected wallet (across all markets) */
  orders: OnchainOrder[];
  /** True while the V2 API call is in-flight */
  isLoading: boolean;
  /** True after the first successful load (cache or API) */
  hasHydrated: boolean;
  /** Timestamp of last successful fetch (ms), or null */
  lastFetchedAt: number | null;
  /** Force a fresh fetch from the V2 API (ignores cache TTL) */
  refresh: () => Promise<void>;
  /** Get orders filtered to a specific market symbol */
  ordersForMarket: (symbol: string) => OnchainOrder[];
}

const OnchainOrdersContext = createContext<OnchainOrdersContextValue>({
  orders: [],
  isLoading: false,
  hasHydrated: false,
  lastFetchedAt: null,
  refresh: async () => {},
  ordersForMarket: () => [],
});

// ── Constants ──────────────────────────────────────────────────────────
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const CACHE_KEY_PREFIX = 'v2:onchainOrders:';

// ── Cache helpers ──────────────────────────────────────────────────────
interface CachePayload {
  version: 2;
  walletAddress: string;
  fetchedAt: number;
  orders: OnchainOrder[];
}

function getCacheKey(wallet: string): string {
  return `${CACHE_KEY_PREFIX}${wallet.toLowerCase()}`;
}

function readCache(wallet: string): CachePayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getCacheKey(wallet));
    if (!raw) return null;
    const payload: CachePayload = JSON.parse(raw);
    if (!payload || payload.version !== 2) return null;
    if (String(payload.walletAddress || '').toLowerCase() !== wallet.toLowerCase()) return null;
    if (!Array.isArray(payload.orders)) return null;
    return payload;
  } catch {
    return null;
  }
}

function writeCache(wallet: string, orders: OnchainOrder[]): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: CachePayload = {
      version: 2,
      walletAddress: wallet.toLowerCase(),
      fetchedAt: Date.now(),
      orders,
    };
    window.localStorage.setItem(getCacheKey(wallet), JSON.stringify(payload));
  } catch {
    // storage full or unavailable -- ignore
  }
}

function clearCache(wallet: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getCacheKey(wallet));
  } catch {}
}

function isCacheFresh(payload: CachePayload | null): boolean {
  if (!payload) return false;
  return Date.now() - payload.fetchedAt < CACHE_TTL_MS;
}

// ── Map V2 API response to OnchainOrder ────────────────────────────────
function mapV2Order(raw: any): OnchainOrder | null {
  const id = raw?.orderId != null ? String(raw.orderId) : '';
  if (!id) return null;
  const sym = String(raw?.market || '').toUpperCase();
  return {
    id,
    symbol: sym,
    side: raw?.side === 'SELL' ? 'SELL' : 'BUY',
    type: 'LIMIT',
    price: Number(raw?.priceFormatted || 0),
    size: Number(raw?.amountFormatted || 0),
    filled: 0,
    status: 'PENDING',
    timestamp: Number(raw?.timestamp || Date.now()),
    metricId: sym,
    trader: raw?.trader || undefined,
    marginRequired: raw?.marginRequiredFormatted || undefined,
    isMarginOrder: raw?.isMarginOrder || undefined,
    orderBookAddress: raw?.orderBook ? String(raw.orderBook) : null,
  };
}

// ── Provider ───────────────────────────────────────────────────────────
export function OnchainOrdersProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet() as any;
  const walletAddress: string | null = wallet?.walletData?.address ?? wallet?.address ?? null;

  const [orders, setOrders] = useState<OnchainOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const inflightRef = useRef<Promise<void> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // ── Fetch from V2 API ──────────────────────────────────────────────
  const fetchFromApi = useCallback(async (wallet: string) => {
    const params = new URLSearchParams({ trader: wallet });
    const res = await fetch(`/api/debug/orders-v2?${params.toString()}`);
    if (!res.ok) throw new Error(`orders-v2 non-200: ${res.status}`);
    const data = await res.json();
    const rawOrders = Array.isArray(data?.orders) ? data.orders : [];
    const mapped: OnchainOrder[] = [];
    for (const o of rawOrders) {
      const m = mapV2Order(o);
      if (m) mapped.push(m);
    }
    mapped.sort((a, b) => b.timestamp - a.timestamp);
    return mapped;
  }, []);

  // ── Core refresh logic ─────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    // Dedupe concurrent calls
    if (inflightRef.current) return inflightRef.current;

    const run = (async () => {
      if (isMountedRef.current) setIsLoading(true);
      try {
        console.log('[OnchainOrdersV2] Fetching from /api/debug/orders-v2', { trader: walletAddress });
        const fetched = await fetchFromApi(walletAddress);
        writeCache(walletAddress, fetched);
        if (isMountedRef.current) {
          setOrders(fetched);
          setLastFetchedAt(Date.now());
          setHasHydrated(true);
        }
        console.log('[OnchainOrdersV2] Fetched', { count: fetched.length });
      } catch (e) {
        console.error('[OnchainOrdersV2] Fetch failed', e);
        // keep existing orders on error
      } finally {
        if (isMountedRef.current) setIsLoading(false);
        inflightRef.current = null;
      }
    })();

    inflightRef.current = run;
    return run;
  }, [walletAddress, fetchFromApi]);

  // ── Hydrate from cache on mount / wallet change ────────────────────
  useEffect(() => {
    if (!walletAddress) {
      setOrders([]);
      setHasHydrated(false);
      setLastFetchedAt(null);
      return;
    }

    const cache = readCache(walletAddress);
    if (cache && isCacheFresh(cache)) {
      // Cache is fresh -- render instantly, then background-refresh
      setOrders(cache.orders);
      setLastFetchedAt(cache.fetchedAt);
      setHasHydrated(true);
      console.log('[OnchainOrdersV2] Hydrated from cache', {
        count: cache.orders.length,
        ageMinutes: Math.round((Date.now() - cache.fetchedAt) / 60_000),
      });
      // Always verify against the chain in the background
      void refresh();
    } else {
      // Cache stale or missing -- fetch from API
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  // ── Re-fetch when the tab becomes visible again ──────────────────
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!walletAddress) return;

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      // Invalidate cache so refresh actually fetches
      clearCache(walletAddress);
      void refresh();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [walletAddress, refresh]);

  // ── Listen for ordersUpdated events to re-fetch ────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!walletAddress) return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent)?.detail as any;
      const trader = String(detail?.trader || '').toLowerCase();
      const me = walletAddress.toLowerCase();
      // Only refresh for our wallet (or if trader is unspecified)
      if (trader && trader !== me) return;
      // Invalidate cache and re-fetch
      clearCache(walletAddress);
      void refresh();
    };

    window.addEventListener('ordersUpdated', handler);
    return () => window.removeEventListener('ordersUpdated', handler);
  }, [walletAddress, refresh]);

  // ── Pusher: subscribe to trading events on markets with open orders ──
  // When another user fills/cancels against our order, the webhook
  // processor broadcasts a `trading-event` on `market-${symbol}`.
  // We subscribe to exactly the markets we have orders on, and re-fetch
  // when any event arrives. No polling needed.
  const activeMarkets = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      const sym = (o.symbol || o.metricId || '').toUpperCase();
      if (sym) set.add(sym);
    }
    return Array.from(set).sort();
  }, [orders]);

  // Stable stringified key so the effect only re-runs when the set of
  // markets actually changes, not on every orders array reference change.
  const activeMarketsKey = activeMarkets.join(',');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!walletAddress) return;
    if (activeMarkets.length === 0) return;

    let pusher: ReturnType<typeof getPusherClient> | null = null;
    try {
      pusher = getPusherClient();
    } catch {
      // Pusher not available (missing env var, SSR, etc.)
      return;
    }

    const unsubscribers: (() => void)[] = [];

    for (const sym of activeMarkets) {
      const unsub = pusher.subscribeToTradingEvents(sym, (data) => {
        // A trade happened on a market where we have orders.
        // The trade could involve us (fill) or not (someone else trading).
        // Re-fetch to get the current on-chain state.
        const trader = String(data?.userAddress || '').toLowerCase();
        const me = walletAddress.toLowerCase();

        console.log('[OnchainOrdersV2] Pusher trading-event', {
          symbol: sym,
          action: data?.action,
          trader: trader.slice(0, 8),
          isMe: trader === me,
        });

        // Invalidate cache and re-fetch from contract
        clearCache(walletAddress);
        void refresh();
      });
      unsubscribers.push(unsub);
    }

    console.log('[OnchainOrdersV2] Subscribed to trading events', {
      markets: activeMarkets,
      count: activeMarkets.length,
    });

    return () => {
      for (const unsub of unsubscribers) {
        try { unsub(); } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, activeMarketsKey, refresh]);

  // ── Convenience: filter by market ──────────────────────────────────
  const ordersForMarket = useCallback(
    (symbol: string) => {
      const upper = symbol.toUpperCase();
      return orders.filter(
        (o) => o.symbol === upper || o.metricId === upper
      );
    },
    [orders]
  );

  const value: OnchainOrdersContextValue = {
    orders,
    isLoading,
    hasHydrated,
    lastFetchedAt,
    refresh,
    ordersForMarket,
  };

  return (
    <OnchainOrdersContext.Provider value={value}>
      {children}
    </OnchainOrdersContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────
export function useOnchainOrders() {
  return useContext(OnchainOrdersContext);
}
