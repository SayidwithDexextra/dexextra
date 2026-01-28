'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketIconBadge } from './MarketIconBadge';
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
        const res = await fetch(`/api/market-rankings?${qs.toString()}`, { signal: ctrl.signal, cache: 'no-store' });
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
          // iconUrl is enriched from Supabase `markets.icon_image_url` in /api/market-rankings
          const icon = typeof (r as any).iconUrl === 'string' ? String((r as any).iconUrl) : '';
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
    <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-2.5 h-[180px] flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h4 className="flex items-center gap-1.5 text-sm font-medium text-[#9CA3AF] uppercase tracking-wide">
          <span className="text-sm" aria-hidden="true">
            🚀
          </span>
          Top Volume
        </h4>
        <a
          href="/top-gainers"
          className="text-[11px] text-[#606060] bg-[#1A1A1A] px-2 py-0.5 rounded hover:text-white transition-colors"
        >
          View more <span aria-hidden="true">›</span>
        </a>
      </div>

      <div className="flex flex-col gap-1">
        {ready ? (
          <>
            {tokens.map((token, index) => {
              const changeText = `${token.isPositive ? '▲' : '▼'} ${Math.abs(token.change).toFixed(1)}%`;
              const href = token.symbol ? `/token/${encodeURIComponent(token.symbol)}` : null;
              return (
                <Link
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  href={href || '#'}
                  aria-disabled={!href}
                  tabIndex={href ? 0 : -1}
                  className={`flex items-center justify-between py-1.5 px-1.5 rounded-md transition-colors duration-200 ${
                    href
                      ? 'hover:bg-[#1A1A1A] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#333333]'
                      : 'opacity-60 cursor-not-allowed'
                  }`}
                  onClick={(e) => {
                    if (!href) e.preventDefault();
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        token.isPositive ? 'bg-green-400' : 'bg-red-400'
                      }`}
                      aria-hidden="true"
                    />

                    <MarketIconBadge iconUrl={token.icon} alt={`${token.name} icon`} sizePx={20} />

                    <span className="text-[12px] font-medium text-white truncate">{token.name}</span>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[11px] text-white font-mono tabular-nums">{token.price}</span>
                    <span
                      className={`text-[11px] font-medium px-1.5 py-0.5 rounded tabular-nums ${
                        token.isPositive ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'
                      }`}
                      aria-label={`Change ${changeText}`}
                    >
                      {changeText}
                    </span>
                  </div>
                </Link>
              );
            })}
            {Array.from({ length: Math.max(0, 3 - tokens.length) }).map((_, i) => (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={`sk-${i}`}
                className="flex items-center justify-between py-1.5 px-1.5 rounded-md"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse"
                    aria-hidden="true"
                  />
                  <div className={`${styles.skeleton}`} style={{ width: 20, height: 20, borderRadius: 999 }} />
                  <div className={`${styles.skeleton}`} style={{ width: 84, height: 10, borderRadius: 6 }} />
                </div>
                <div className="flex items-center gap-2">
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
                className="flex items-center justify-between py-1.5 px-1.5 rounded-md"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse"
                    aria-hidden="true"
                  />
                  <div className={`${styles.skeleton}`} style={{ width: 20, height: 20, borderRadius: 999 }} />
                  <div className={`${styles.skeleton}`} style={{ width: 84, height: 10, borderRadius: 6 }} />
                </div>
                <div className="flex items-center gap-2">
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