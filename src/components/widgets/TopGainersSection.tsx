'use client';

import React, { useEffect, useState } from 'react';
import SectionHeader from './SectionHeader';
import TokenListItem from './TokenListItem';
import styles from './styles/Widget.module.css';
import type { TokenData } from './types';

const TopGainersSection: React.FC = () => {
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [ready, setReady] = useState<boolean>(false);

  useEffect(() => {
    const ctrl = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      try {
        setReady(false);
        const qs = new URLSearchParams();
        // We use the trending endpoint because it includes both:
        // - notionalVolume (24h) so we can rank by volume
        // - priceChange24hPct so we can show the green/red badge in this UI
        qs.set('kind', 'trending');
        qs.set('limit', '25');
        // Widen the window so we can reliably show a Top 3 even
        // when only a couple markets traded in the last 24h.
        qs.set('windowHours', '168');
        const res = await fetch(`/api/market-rankings?${qs.toString()}`, { signal: ctrl.signal });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error('ranking_fetch_failed');

        const rows = Array.isArray(json.rows) ? json.rows : [];
        if (rows.length === 0) throw new Error('ranking_empty');
        const fmtUsdCompact = (v: number) =>
          new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            notation: 'compact',
            maximumFractionDigits: 2,
          }).format(Number(v) || 0);

        // Rank by 24h notional volume and take top 3 (matches widget mock size)
        const top = rows
          .map((r: any) => ({
            symbol: r.symbol ? String(r.symbol) : null,
            marketUuid: r.marketUuid ? String(r.marketUuid) : null,
            notionalVolume: Number(r.notionalVolume) || 0,
            priceChange24hPct: Number(r.priceChange24hPct) || 0,
          }))
          .sort((a, b) => b.notionalVolume - a.notionalVolume)
          .slice(0, 3);

        if (top.length === 0) throw new Error('ranking_empty_top');

        const mapped: TokenData[] = top.map((r: any, idx: number) => {
          const name = (r.symbol || r.marketUuid || 'UNKNOWN').toString();
          const change = Number.isFinite(r.priceChange24hPct) ? r.priceChange24hPct : 0;
          const icon = (typeof (r as any).iconUrl === 'string' && String((r as any).iconUrl).trim())
            ? String((r as any).iconUrl).trim()
            : '•';
          return {
            icon,
            name,
            price: fmtUsdCompact(r.notionalVolume),
            change: Number(change.toFixed(1)),
            isPositive: change >= 0,
            symbol: r.symbol || undefined,
          };
        });

        setTokens(mapped);
        setReady(mapped.length > 0);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        // No mock fallbacks: keep showing skeleton and retry.
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
        icon="🚀" 
        title="Top Volume" 
        viewMoreLink="/top-gainers"
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

export default TopGainersSection; 