'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './CryptoMarketTicker.module.css';

interface MarketTickerItem {
  marketId: string;
  symbol: string;
  name: string;
  price: number;
  price_change_percentage_24h: number;
}

interface CryptoMarketTickerProps {
  className?: string;
  speed?: number;
  pauseOnHover?: boolean;
}

// Old CoinGecko ticker used ~20 symbols; now we render ALL in-house markets (even if 0% change).
// (We keep ClickHouse-ranked ones at the front when available.)

// Cache configuration
const CACHE_KEY = 'dexextra_market_ticker_v1';
const CACHE_TIMESTAMP_KEY = 'dexextra_market_ticker_ts_v1';
const CACHE_DURATION = 60 * 1000; // 60 seconds

export default function CryptoMarketTicker({ 
  className = '', 
  speed = 60,
  pauseOnHover = true 
}: CryptoMarketTickerProps) {
  // State management
  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [items, setItems] = useState<MarketTickerItem[]>([]);

  // Refs
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fmtUsd = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 8,
      }),
    []
  );

  // Format price with appropriate decimals
  const formatPrice = (price: number): string => {
    try {
      return fmtUsd.format(Number(price) || 0);
    } catch {
      return `$${Number(price) || 0}`;
    }
  };

  // Format percentage change
  const formatPercentage = (change: number): string => {
    const formatted = Math.abs(change).toFixed(2);
    return change >= 0 ? `+${formatted}%` : `-${formatted}%`;
  };

  // Get color class for percentage change
  const getChangeColorClass = (change: number): string => {
    return change >= 0 ? styles.positive : styles.negative;
  };

  // Save data to localStorage cache
  const saveToCache = useCallback((data: MarketTickerItem[]) => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (error) {
      console.warn('Failed to save to cache:', error);
    }
  }, []);

  // Load data from localStorage cache
  const loadFromCache = useCallback((): MarketTickerItem[] | null => {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
      
      if (cached && timestamp) {
        const age = Date.now() - parseInt(timestamp);
        if (age < CACHE_DURATION) {
          return JSON.parse(cached);
        }
      }
    } catch (error) {
      console.warn('Failed to load from cache:', error);
    }
    return null;
  }, []);

  /**
   * Load our in-house market ticker:
   * - Market performance (price + 24h change) comes from ClickHouse via `/api/market-rankings`.
   * - Market metadata (name/symbol + fallback price) comes from Supabase `markets` via `/api/markets`.
   */
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!isMountedRef.current) return;

      try {
        // 1) Pull ALL markets (paged) for full coverage.
        const fetchAllMarkets = async (): Promise<any[]> => {
          const pageSize = 200;
          const all: any[] = [];
          let offset = 0;
          let total: number | null = null;

          while (true) {
            const url = `/api/markets?limit=${pageSize}&offset=${offset}`;
            const res = await fetch(url, { signal });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.success) throw new Error('markets_fetch_failed');

            const page: any[] = Array.isArray(json.markets) ? json.markets : [];
            const t = Number(json?.pagination?.total);
            if (Number.isFinite(t) && t >= 0) total = t;

            all.push(...page);
            offset += pageSize;

            if (page.length < pageSize) break;
            if (total != null && all.length >= total) break;
            if (signal?.aborted) break;
          }

          return all;
        };

        const markets = await fetchAllMarkets();

        const byId = new Map<string, any>();
        markets.forEach((m: any) => {
          if (m?.id) byId.set(String(m.id), m);
        });

        // 2) Overlay clickhouse ranking data when available (but do not require it).
        const qs = new URLSearchParams();
        qs.set('kind', 'trending');
        qs.set('windowHours', '168');
        // Pull more than we display so we can still show 21 after filtering/joins.
        qs.set('limit', '100');

        const rankRes = await fetch(`/api/market-rankings?${qs.toString()}`, { signal });
        const rankJson = await rankRes.json().catch(() => null);
        const rows: any[] =
          rankRes.ok && rankJson?.success && Array.isArray(rankJson.rows) ? rankJson.rows : [];

        const seen = new Set<string>();
        const out: MarketTickerItem[] = [];

        const pushMarket = (marketId: string, opts?: { price?: number; changePct24h?: number }) => {
          const m = byId.get(marketId);
          if (!m) return;
          if (seen.has(marketId)) return;

          const symbol = String(m?.symbol || m?.market_identifier || marketId).toUpperCase();
          const name =
            typeof m?.name === 'string' && m.name.trim()
              ? m.name.trim()
              : typeof m?.market_identifier === 'string' && m.market_identifier.trim()
                ? m.market_identifier.trim()
                : symbol;

          const fallbackPrice = Number(m?.initial_price ?? m?.last_trade_price ?? 0) || 0;
          const price = Number.isFinite(Number(opts?.price)) ? (Number(opts?.price) as number) : fallbackPrice;
          const change = Number.isFinite(Number(opts?.changePct24h))
            ? (Number(opts?.changePct24h) as number)
            : 0;

          seen.add(marketId);
          out.push({
            marketId,
            symbol,
            name,
            price,
            price_change_percentage_24h: change,
          });
        };

        // Prefer ClickHouse-ranked markets first (when present).
        for (const r of rows) {
          const id = String(r?.marketUuid || r?.market_uuid || '').trim();
          if (!id) continue;
          const lastPriceRaw = r?.close1h ?? r?.close_1h ?? r?.close24h ?? r?.close_24h ?? null;
          const price = Number(lastPriceRaw);
          const change = Number(r?.priceChange24hPct ?? r?.price_change_24h_pct ?? 0);
          pushMarket(id, {
            price: Number.isFinite(price) ? price : undefined,
            changePct24h: Number.isFinite(change) ? change : 0,
          });
        }

        // Fill the rest from Supabase markets so we render ALL markets, even with 0% change.
        for (const m of markets) {
          const id = String(m?.id || '').trim();
          if (!id) continue;
          pushMarket(id);
        }

        const finalItems = out;

        if (!isMountedRef.current) return;
        setItems(finalItems);
        setIsLoading(false);
        saveToCache(finalItems);
      } catch (e) {
        // Keep whatever we already have on screen.
        if (!isMountedRef.current) return;
        setIsLoading(false);
        // eslint-disable-next-line no-console
        console.warn('Market ticker refresh failed:', e);
      }
    },
    [saveToCache]
  );

  // Load from cache immediately, then refresh from ClickHouse + Supabase.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const cached = loadFromCache();
    if (cached && cached.length > 0) {
      setItems(cached);
      setIsLoading(false);
    }

    const ctrl = new AbortController();
    refresh(ctrl.signal);

    const interval = setInterval(() => {
      refresh();
    }, 30_000);

    return () => {
      ctrl.abort();
      clearInterval(interval);
    };
  }, [loadFromCache, refresh]);

  // Handle hover events for pause on hover
  const handleMouseEnter = () => {
    if (pauseOnHover) {
      setIsPaused(true);
    }
  };

  const handleMouseLeave = () => {
    if (pauseOnHover) {
      setIsPaused(false);
    }
  };

  const validItems = useMemo(
    () =>
      (items || []).filter(
        (m) => m && m.marketId && m.symbol && Number.isFinite(m.price) && m.price >= 0
      ),
    [items]
  );

  // Show loading state only briefly
  if (isLoading && validItems.length === 0) {
    return (
      <div className={`${styles.container} ${className}`}>
        <div className={styles.loading}>
          Loading market data...
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.container} ${className}`}>
      <div 
        className={`${styles.ticker} ${isPaused ? styles.paused : ''}`}
        style={{ '--ticker-duration': `${speed}s` } as React.CSSProperties}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role="marquee"
        aria-label="Dexextra market ticker"
      >
        {validItems.concat(validItems).map((m, index) => {
          const href = m.symbol ? `/token/${encodeURIComponent(m.symbol)}` : '#';
          return (
            <a
              key={`${m.marketId}-${index}`}
              href={href}
              className={styles.tickerItem}
              aria-disabled={!m.symbol}
              tabIndex={m.symbol ? 0 : -1}
              onClick={(e) => {
                if (!m.symbol) e.preventDefault();
              }}
              title={m.name}
              aria-label={`${m.symbol} ${formatPrice(m.price)} ${formatPercentage(m.price_change_percentage_24h)}`}
            >
              <span className={styles.symbol}>{m.symbol}</span>
              <span className={styles.separator}>•</span>
              <span className={styles.price}>{formatPrice(m.price)}</span>
              <span className={`${styles.change} ${getChangeColorClass(m.price_change_percentage_24h)}`}>
                {formatPercentage(m.price_change_percentage_24h)}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
} 