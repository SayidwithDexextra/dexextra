'use client';

import React, { useEffect, useState } from 'react';
import SectionHeader from './SectionHeader';
import TokenListItem from './TokenListItem';
import styles from './styles/Widget.module.css';
import type { TokenData } from './types';

const TrendingSection: React.FC = () => {
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [ready, setReady] = useState<boolean>(false);

  useEffect(() => {
    const ctrl = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      try {
        setReady(false);
        const qs = new URLSearchParams();
        qs.set('kind', 'trending');
        // Widen the window so we can reliably show a Top 3 even
        // when only a couple markets traded in the last 24h.
        qs.set('windowHours', '168');
        // Request more than needed so we can still render at least 3 even if some rows are missing fields/icons.
        qs.set('limit', '12');
        const res = await fetch(`/api/market-rankings?${qs.toString()}`, { signal: ctrl.signal });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error('ranking_fetch_failed');

        const rows = Array.isArray(json.rows) ? json.rows : [];
        if (rows.length === 0) throw new Error('ranking_empty');

        const fmtUsd = (v: number) =>
          new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 6,
          }).format(Number(v) || 0);

        const mapped: TokenData[] = rows.slice(0, 3).map((r: any) => {
          const name = (r.symbol || r.marketUuid || 'UNKNOWN').toString();
          const lastPrice = Number(r.close24h ?? r.close1h ?? r.close_24h ?? r.close_1h) || 0;
          const change = Number(r.priceChange24hPct ?? r.price_change_24h_pct) || 0;
          const icon = (typeof r.iconUrl === 'string' && r.iconUrl.trim()) ? r.iconUrl.trim() : '•';
          return {
            icon,
            name,
            price: fmtUsd(lastPrice),
            change: Number(change.toFixed(1)),
            isPositive: change >= 0,
            symbol: r.symbol || undefined,
          };
        });

        // Render what we have immediately; if it's < 3, we keep skeleton rows for the remainder.
        setTokens(mapped);
        setReady(mapped.length > 0);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        retryTimer = setTimeout(() => {
          if (!ctrl.signal.aborted) run();
        }, 5000);
      }
    };

    run();
    return () => {
      ctrl.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  return (
    <div className={styles.card}>
      <SectionHeader 
        icon="🔥" 
        title="Trending" 
        viewMoreLink="/trending"
      />
      <div className="flex flex-col gap-3">
        {ready ? (
          <>
            {tokens.map((token, index) => <TokenListItem key={index} {...token} />)}
            {Array.from({ length: Math.max(0, 3 - tokens.length) }).map((_, i) => (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={`sk-${i}`}
                className="flex justify-between items-center py-1.5 rounded"
              >
                <div className="flex items-center gap-1.5">
                  <div className={`${styles.skeleton}`} style={{ width: 16, height: 16, borderRadius: 999 }} />
                  <div className={`${styles.skeleton}`} style={{ width: 84, height: 10, borderRadius: 6 }} />
                </div>
                <div className="flex items-center gap-1.5">
                  <div className={`${styles.skeleton}`} style={{ width: 64, height: 10, borderRadius: 6 }} />
                  <div className={`${styles.skeleton}`} style={{ width: 42, height: 14, borderRadius: 6 }} />
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            {[0, 1, 2].map((i) => (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                className="flex justify-between items-center py-1.5 rounded"
              >
                <div className="flex items-center gap-1.5">
                  <div className={`${styles.skeleton}`} style={{ width: 16, height: 16, borderRadius: 999 }} />
                  <div className={`${styles.skeleton}`} style={{ width: 84, height: 10, borderRadius: 6 }} />
                </div>
                <div className="flex items-center gap-1.5">
                  <div className={`${styles.skeleton}`} style={{ width: 64, height: 10, borderRadius: 6 }} />
                  <div className={`${styles.skeleton}`} style={{ width: 42, height: 14, borderRadius: 6 }} />
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default TrendingSection; 