'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import styles from './CryptoMarketTicker.module.css';

export interface MarketTickerItem {
  marketId: string;
  symbol: string;
  market_identifier: string;
  name: string;
  description?: string;
  price: number;
  price_change_percentage_24h: number;
  href?: string;
  external?: boolean;
  iconUrl?: string;
}

export interface TickerItem {
  symbol: string;
  price: string;
  change: string;
  direction: 'up' | 'down';
}

interface DisplayItem extends TickerItem {
  id: string;
  href: string;
  external?: boolean;
}

interface CryptoMarketTickerProps {
  className?: string;
  speed?: number;
  pauseOnHover?: boolean;
  /**
   * Controlled mode: when provided, the ticker renders exactly these items and
   * performs NO internal fetching.
   */
  externalItems?: MarketTickerItem[];
}

const CACHE_KEY = 'dexextra_market_ticker_v1';
const CACHE_TIMESTAMP_KEY = 'dexextra_market_ticker_ts_v1';
const CACHE_DURATION = 60 * 1000;

const formatPrice = (price: number): string => {
  const n = Number(price) || 0;
  const raw = String(n);
  const decimals = (raw.split('.')[1] || '').replace(/0+$/, '').length;
  const digits = Math.min(8, Math.max(2, decimals));
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `$${n}`;
  }
};

const formatChange = (change: number): string => {
  const n = Number(change) || 0;
  const abs = Math.abs(n).toFixed(2);
  return n >= 0 ? `+${abs}%` : `-${abs}%`;
};

function toDisplayItem(m: MarketTickerItem): DisplayItem | null {
  if (!m?.marketId || !m.symbol || !Number.isFinite(m.price) || m.price < 0) return null;
  const changeNum = Number(m.price_change_percentage_24h);
  const change = Number.isFinite(changeNum) ? changeNum : 0;
  const symbol = String(m.symbol).toUpperCase();
  const slug = m.market_identifier || m.symbol;
  return {
    id: m.marketId,
    symbol,
    price: formatPrice(m.price),
    change: formatChange(change),
    direction: change >= 0 ? 'up' : 'down',
    href: m.href || (slug ? `/token/${encodeURIComponent(slug)}` : '#'),
    external: m.external,
  };
}

export default function CryptoMarketTicker({
  className = '',
  speed = 48,
  pauseOnHover = true,
  externalItems,
}: CryptoMarketTickerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<MarketTickerItem[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const saveToCache = useCallback((data: MarketTickerItem[]) => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (error) {
      console.warn('Failed to save to cache:', error);
    }
  }, []);

  const loadFromCache = useCallback((): MarketTickerItem[] | null => {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
      if (cached && timestamp) {
        const age = Date.now() - parseInt(timestamp);
        if (age < CACHE_DURATION) return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('Failed to load from cache:', error);
    }
    return null;
  }, []);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!isMountedRef.current) return;

      try {
        const overviewRes = await fetch(
          '/api/market-overview?limit=50&status=ACTIVE,SETTLEMENT_REQUESTED',
          { signal, cache: 'no-store' }
        );
        const overviewJson = await overviewRes.json().catch(() => null);
        if (!overviewRes.ok || !overviewJson?.success) throw new Error('markets_fetch_failed');
        const markets: any[] = Array.isArray(overviewJson.markets) ? overviewJson.markets : [];

        const qs = new URLSearchParams({
          kind: 'trending',
          windowHours: '168',
          limit: '100',
        });
        const rankRes = await fetch(`/api/market-rankings?${qs}`, { signal, cache: 'no-store' });
        const rankJson = await rankRes.json().catch(() => null);
        const rows: any[] =
          rankRes.ok && rankJson?.success && Array.isArray(rankJson.rows) ? rankJson.rows : [];

        const changeById = new Map<string, number>();
        const changeBySymbol = new Map<string, number>();
        const rankOrder: string[] = [];
        for (const r of rows) {
          const id = String(r?.marketUuid || r?.market_uuid || '').trim();
          const pct = Number(r?.priceChange24hPct ?? r?.price_change_24h_pct);
          if (id) {
            rankOrder.push(id);
            if (Number.isFinite(pct)) changeById.set(id, pct);
          }
          const sym = String(r?.symbol || '').toUpperCase().trim();
          if (sym && Number.isFinite(pct)) changeBySymbol.set(sym, pct);
        }

        const seen = new Set<string>();
        const out: MarketTickerItem[] = [];

        const pushMarket = (m: any) => {
          const marketId = String(m?.market_id || m?.id || '').trim();
          if (!marketId || seen.has(marketId)) return;
          const symbol = String(m?.symbol || m?.market_identifier || marketId).toUpperCase();
          const name =
            typeof m?.name === 'string' && m.name.trim()
              ? m.name.trim()
              : typeof m?.market_identifier === 'string' && m.market_identifier.trim()
                ? m.market_identifier.trim()
                : symbol;
          const raw = Number(m?.mark_price ?? m?.initial_price ?? m?.last_trade_price ?? 0);
          const price = raw > 1_000 ? raw / 1_000_000 : raw || 0;
          const change =
            changeById.get(marketId) ??
            changeBySymbol.get(symbol) ??
            0;
          const mi = String(m?.market_identifier || '').trim() || symbol;
          seen.add(marketId);
          out.push({
            marketId,
            symbol,
            market_identifier: mi,
            name,
            price,
            price_change_percentage_24h: change,
          });
        };

        const byId = new Map<string, any>();
        markets.forEach((m: any) => {
          const id = String(m?.market_id || m?.id || '');
          if (id) byId.set(id, m);
        });
        for (const id of rankOrder) {
          const m = byId.get(id);
          if (m) pushMarket(m);
        }
        for (const m of markets) pushMarket(m);

        const finalItems = out.slice(0, 25);
        if (!isMountedRef.current || signal?.aborted) return;
        setItems(finalItems);
        setIsLoading(false);
        saveToCache(finalItems);
      } catch (e: any) {
        if (e?.name === 'AbortError' || signal?.aborted) return;
        if (!isMountedRef.current) return;
        setIsLoading(false);
        console.warn('Market ticker refresh failed:', e);
      }
    },
    [saveToCache]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (externalItems) {
      setItems(externalItems);
      setIsLoading(false);
      return;
    }

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
  }, [loadFromCache, refresh, externalItems]);

  const displayItems = useMemo(
    () => (items || []).map(toDisplayItem).filter((item): item is DisplayItem => item != null),
    [items]
  );

  const showTrack = displayItems.length > 0;

  return (
    <div
      className={`${styles.container} ${pauseOnHover ? styles.pauseOnHover : ''} ${className}`}
      role="marquee"
      aria-label="Market ticker"
    >
      {showTrack ? (
        <div
          className={styles.track}
          style={{ '--ticker-duration': `${speed}s` } as React.CSSProperties}
        >
          {displayItems.map((item) => (
            <TickerRow key={item.id} item={item} />
          ))}
          {displayItems.map((item) => (
            <TickerRow key={`${item.id}__dup`} item={item} duplicate />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const TickerRow: React.FC<{ item: DisplayItem; duplicate?: boolean }> = ({
  item,
  duplicate = false,
}) => {
  const className = `${styles.item} ${item.direction === 'up' ? styles.up : styles.down}`;
  const body = (
    <>
      <span className={styles.symbol}>{item.symbol}</span>
      <span className={styles.separator}>•</span>
      <span className={styles.price}>{item.price}</span>
      <span className={styles.change}>{item.change}</span>
    </>
  );

  if (item.external) {
    return (
      <a
        href={item.href}
        className={className}
        target="_blank"
        rel="noopener noreferrer"
        aria-hidden={duplicate || undefined}
        tabIndex={duplicate ? -1 : undefined}
      >
        {body}
      </a>
    );
  }

  return (
    <Link
      href={item.href}
      className={className}
      aria-hidden={duplicate || undefined}
      tabIndex={duplicate ? -1 : undefined}
    >
      {body}
    </Link>
  );
};
