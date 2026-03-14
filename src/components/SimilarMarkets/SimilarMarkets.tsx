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
      const allMatches: SimilarMarket[] = [];
      const seenIds = new Set<string>();

      // First, fetch by name/description (no category filter)
      const baseResponse = await fetch('/api/markets/similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: marketName,
          description: marketDescription,
          limit: limit + 5,
        }),
      });

      if (baseResponse.ok) {
        const baseData = await baseResponse.json();
        const baseMatches: SimilarMarket[] = Array.isArray(baseData.matches) ? baseData.matches : [];
        for (const market of baseMatches) {
          if (!seenIds.has(market.id) && market.id !== currentMarketId) {
            seenIds.add(market.id);
            allMatches.push(market);
          }
        }
      }

      // Then, fetch for each category to find markets sharing any category
      if (categories && categories.length > 0) {
        const categoryPromises = categories.map(async (category) => {
          try {
            const response = await fetch('/api/markets/similar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                intent: category,
                category,
                limit: limit + 3,
              }),
            });

            if (response.ok) {
              const data = await response.json();
              return Array.isArray(data.matches) ? data.matches : [];
            }
            return [];
          } catch {
            return [];
          }
        });

        const categoryResults = await Promise.all(categoryPromises);
        
        for (const matches of categoryResults) {
          for (const market of matches as SimilarMarket[]) {
            if (!seenIds.has(market.id) && market.id !== currentMarketId) {
              seenIds.add(market.id);
              allMatches.push(market);
            }
          }
        }
      }

      // Sort by score if available, otherwise keep original order
      const sorted = allMatches.sort((a, b) => {
        const scoreA = (a as any).score ?? 0;
        const scoreB = (b as any).score ?? 0;
        return scoreB - scoreA;
      });

      setMarkets(sorted.slice(0, limit));
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
            <img
              src={market.icon_image_url || PLACEHOLDER_LOGO}
              alt=""
              className={styles.marketLogoImg}
              onError={(e) => {
                const el = e.currentTarget;
                if (el.src === PLACEHOLDER_LOGO) return;
                el.src = PLACEHOLDER_LOGO;
              }}
            />
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
