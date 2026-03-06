'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import styles from './SimilarMarkets.module.css';

interface SimilarMarket {
  id: string;
  market_identifier: string;
  symbol: string;
  name: string;
  description?: string;
  category: string | string[];
  market_status: string;
  icon_image_url?: string | null;
}

interface SimilarMarketsProps {
  marketName: string;
  marketDescription?: string;
  categories?: string[];
  currentMarketId?: string;
  limit?: number;
  fillHeight?: boolean;
  className?: string;
}

function MarketIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

const PLACEHOLDER_LOGO = 'https://api.dicebear.com/9.x/shapes/svg?seed=market&backgroundColor=111111&shape1Color=3b82f6';

function getStatusClass(status: string): string {
  const normalized = status?.toUpperCase() || '';
  if (normalized === 'ACTIVE') return styles.statusLive;
  if (normalized === 'PENDING' || normalized === 'DEPLOYING') return styles.statusPending;
  return styles.statusInactive;
}

function formatCategory(category: string | string[]): string {
  if (Array.isArray(category)) {
    return category[0] || '';
  }
  return category || '';
}

export default function SimilarMarkets({
  marketName,
  marketDescription,
  categories,
  currentMarketId,
  limit = 5,
  fillHeight = false,
  className,
}: SimilarMarketsProps) {
  const [markets, setMarkets] = useState<SimilarMarket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSimilarMarkets = useCallback(async () => {
    if (!marketName && !marketDescription && (!categories || categories.length === 0)) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/markets/similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: marketName,
          description: marketDescription,
          category: categories?.[0],
          limit: limit + 1,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch similar markets');
      }

      const data = await response.json();
      const matches: SimilarMarket[] = Array.isArray(data.matches) ? data.matches : [];
      
      const filtered = matches
        .filter((m) => m.id !== currentMarketId)
        .slice(0, limit);

      setMarkets(filtered);
    } catch (err) {
      console.error('Error fetching similar markets:', err);
      setError('Failed to load similar markets');
    } finally {
      setIsLoading(false);
    }
  }, [marketName, marketDescription, categories, currentMarketId, limit]);

  useEffect(() => {
    fetchSimilarMarkets();
  }, [fetchSimilarMarkets]);

  const renderLoading = () => (
    <div className={styles.loadingState}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className={styles.loadingSkeleton}>
          <div className={styles.skeletonLogo} />
          <div className={styles.skeletonContent}>
            <div className={styles.skeletonText} />
            <div className={`${styles.skeletonText} ${styles.skeletonTextShort}`} />
          </div>
        </div>
      ))}
    </div>
  );

  const renderEmpty = () => (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>
        <EmptyIcon />
      </div>
      <span className={styles.emptyText}>No similar markets found</span>
    </div>
  );

  const renderMarkets = () => (
    <div className={styles.content}>
      {markets.map((market) => (
        <Link
          key={market.id}
          href={`/token/${market.market_identifier || market.symbol}`}
          className={styles.marketItem}
        >
          <div className={styles.marketLogo}>
            {market.icon_image_url ? (
              <img
                src={market.icon_image_url}
                alt=""
                className={styles.marketLogoImg}
              />
            ) : (
              <div className={styles.marketLogoPlaceholder}>
                <MarketIcon />
              </div>
            )}
          </div>
          <div className={styles.marketInfo}>
            <span className={styles.marketName}>{market.name}</span>
            <div className={styles.marketMeta}>
              <div className={`${styles.statusDot} ${getStatusClass(market.market_status)}`} />
              {formatCategory(market.category) && (
                <span className={styles.marketCategory}>
                  {formatCategory(market.category)}
                </span>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );

  if (error) {
    return null;
  }

  const containerClass = [
    styles.container,
    fillHeight ? styles.containerFillHeight : '',
    className || '',
  ].filter(Boolean).join(' ');

  return (
    <div className={containerClass}>
      <div className={styles.header}>
        <span className={styles.title}>Similar Markets</span>
      </div>
      <div className={fillHeight ? styles.contentFillHeight : ''}>
        {isLoading ? renderLoading() : markets.length === 0 ? renderEmpty() : renderMarkets()}
      </div>
    </div>
  );
}
