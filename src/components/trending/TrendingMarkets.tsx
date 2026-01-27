'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MarketCard } from './AuctionCard';
import type { GradientType, MarketData } from './types';

interface TrendingMarketsProps {
  /** Optional: if provided, renders these markets (no fetching). */
  markets?: MarketData[];
  className?: string;
  title?: string;
  /** When `markets` is not provided, fetch this many rows. */
  limit?: number;
  /** Optional trending filters (passed to rankings API). */
  minTrades24h?: number;
  minNotional24h?: number;
}

export const TrendingMarkets: React.FC<TrendingMarketsProps> = ({
  markets: marketsProp,
  className = '',
  title = "Trending markets",
  limit = 4,
  minTrades24h = 0,
  minNotional24h = 0,
}) => {
  const router = useRouter();
  const [ready, setReady] = useState<boolean>(false);
  const [marketsFetched, setMarketsFetched] = useState<MarketData[]>([]);

  const gradientTypes: GradientType[] = useMemo(
    () => ['card1', 'card2', 'card3', 'card4'],
    []
  );

  const markets = marketsProp && marketsProp.length > 0 ? marketsProp : marketsFetched;

  useEffect(() => {
    // If markets were provided, this component is purely presentational.
    if (marketsProp && marketsProp.length > 0) return;

    const ctrl = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      try {
        setReady(false);
        const qs = new URLSearchParams();
        qs.set('kind', 'trending');
        qs.set('limit', String(limit));
        qs.set('minTrades24h', String(minTrades24h));
        qs.set('minNotional24h', String(minNotional24h));
        const res = await fetch(`/api/market-rankings?${qs.toString()}`, { signal: ctrl.signal });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.details || json?.error || `Failed to fetch trending markets (${res.status})`);
        }
        const rows = Array.isArray(json.rows) ? json.rows : [];
        if (rows.length === 0) {
          throw new Error('No trending markets returned yet');
        }

        const fmtUsdCompact = (v: number) =>
          new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            notation: 'compact',
            maximumFractionDigits: 2,
          }).format(Number(v) || 0);

        const mapped: MarketData[] = rows.map((r: any, idx: number) => {
          const marketUuid = String(r.marketUuid || r.market_uuid || '');
          const symbol = (r.symbol ? String(r.symbol) : '') || marketUuid;
          const notional1h = Number(r.notional1h) || 0;
          const notional24h = Number(r.notionalVolume ?? r.notional_volume) || 0;
          const pct = Number(r.priceChange24hPct ?? r.price_change_24h_pct) || 0;
          return {
            id: marketUuid || symbol,
            marketName: symbol,
            marketSymbol: symbol,
            icon: '🔥',
            longPrice: `1h ${fmtUsdCompact(notional1h)}`,
            shortPrice: `24h ${fmtUsdCompact(notional24h)}`,
            percentChange: pct,
            gradientType: gradientTypes[idx % gradientTypes.length],
            onClick: () => {
              const routeId = marketUuid || symbol;
              if (routeId) router.push(`/token/${encodeURIComponent(routeId)}`);
            },
          };
        });
        setMarketsFetched(mapped);
        setReady(true);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        // No fallback UI: keep showing skeletons and retry.
        setMarketsFetched([]);
        retryTimer = setTimeout(() => {
          if (!ctrl.signal.aborted) run();
        }, 5000);
      } finally {
        // keep skeleton visible until we have rows
      }
    };
    run();
    return () => {
      ctrl.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [gradientTypes, limit, marketsProp, minNotional24h, minTrades24h, router]);

  if (!marketsProp && !ready) {
    return (
      <section className={`trending-markets ${className}`}>
        <div className="trending-container">
          <h2 className="trending-title">{title}</h2>
          <div className="trending-grid">
            {Array.from({ length: Math.max(1, Math.min(8, limit)) }).map((_, i) => (
              <div key={i} className="skeleton-card" aria-hidden="true">
                <div className="skeleton-top">
                  <div className="skeleton-circle" />
                  <div className="skeleton-lines">
                    <div className="skeleton-line w80" />
                    <div className="skeleton-line w50" />
                  </div>
                </div>
                <div className="skeleton-bottom">
                  <div className="skeleton-lines">
                    <div className="skeleton-line w70" />
                    <div className="skeleton-line w60" />
                  </div>
                  <div className="skeleton-pill" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`trending-markets ${className}`}>
      <div className="trending-container">
        <h2 className="trending-title">{title}</h2>
        <div className="trending-grid">
          {markets.map((market) => (
            <MarketCard 
              key={market.id}
              marketName={market.marketName}
              marketSymbol={market.marketSymbol}
              icon={market.icon}
              longPrice={market.longPrice}
              shortPrice={market.shortPrice}
              percentChange={market.percentChange}
              gradientType={market.gradientType}
              nftGraphic={market.nftGraphic}
              onClick={market.onClick}
            />
          ))}
        </div>
      </div>

      <style jsx>{`
        .trending-markets {
          background: #0F0F0F;
          padding: 32px 0;
        }

        .trending-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px;
        }

        .trending-title {
          font-size: 24px;
          font-weight: 600;
          line-height: 1.2;
          color: #FFFFFF;
          margin-bottom: 24px;
          margin: 0 0 24px 0;
        }

        .trending-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
        }

        .skeleton-card {
          width: 280px;
          height: 240px;
          border-radius: 16px;
          padding: 20px;
          position: relative;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .skeleton-card::after {
          content: '';
          position: absolute;
          top: 0;
          left: -150%;
          width: 150%;
          height: 100%;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.08) 40%,
            rgba(255, 255, 255, 0.16) 50%,
            rgba(255, 255, 255, 0.08) 60%,
            rgba(255, 255, 255, 0) 100%
          );
          animation: shimmer 1.15s ease-in-out infinite;
        }

        @keyframes shimmer {
          0% { transform: translateX(0); }
          100% { transform: translateX(200%); }
        }

        .skeleton-top {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .skeleton-circle {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.08);
        }

        .skeleton-lines {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 1;
        }

        .skeleton-line {
          height: 12px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.08);
        }

        .w80 { width: 80%; }
        .w70 { width: 70%; }
        .w60 { width: 60%; }
        .w50 { width: 50%; }

        .skeleton-bottom {
          position: absolute;
          left: 20px;
          right: 20px;
          bottom: 20px;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
        }

        .skeleton-pill {
          width: 70px;
          height: 22px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.10);
        }

        @media (max-width: 1024px) {
          .trending-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 18px;
          }
        }

        @media (max-width: 640px) {
          .trending-grid {
            grid-template-columns: 1fr;
            gap: 16px;
          }
          
          .trending-container {
            padding: 0 16px;
          }

          .skeleton-card {
            width: 100%;
            height: 220px;
          }
        }
      `}</style>
    </section>
  );
}; 