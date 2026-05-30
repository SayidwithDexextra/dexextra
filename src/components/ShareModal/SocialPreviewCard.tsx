'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import styles from './SocialPreviewCard.module.css';

export interface SocialPreviewCardData {
  title: string;
  symbol?: string;
  category?: string;
  description?: string;
  iconUrl?: string;
  markPrice?: number;
  startPrice?: number;
  /** Explicit PnL %. When provided, overrides the price-derived calculation. */
  pnlPercent?: number;
}

interface SocialPreviewCardProps {
  data: SocialPreviewCardData;
  /** Bump to replay the assembly animation (e.g. each time the modal opens). */
  animationKey?: number;
}

const DEXETERA_LOGO_URL = '/Dexicon/LOGO-Dexetera-04.svg';

function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) {
    return `$${price.toFixed(2)}`;
  }
  if (price > 0) {
    return `$${price.toPrecision(4)}`;
  }
  return '$0.00';
}

function formatPnlPercent(percent: number): string {
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

function truncateText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export default function SocialPreviewCard({ data, animationKey = 0 }: SocialPreviewCardProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / 1200);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const title = truncateText(data.title || data.symbol || 'Market', 28);
  const category = data.category ? truncateText(data.category.toUpperCase(), 18) : '';
  const description = truncateText(
    data.description ||
      `Trade ${title} on Dexetera — decentralized metric futures with no permission needed.`,
    120
  );
  const currentPrice = Number.isFinite(data.markPrice) ? Number(data.markPrice) : 0;
  const startPrice = Number.isFinite(data.startPrice) ? Number(data.startPrice) : 0;
  const hasPnlOverride = data.pnlPercent != null && Number.isFinite(data.pnlPercent);
  const pnlPercent = hasPnlOverride
    ? Number(data.pnlPercent)
    : startPrice > 0
      ? ((currentPrice - startPrice) / startPrice) * 100
      : 0;
  const showPnl = startPrice > 0 || hasPnlOverride;
  const pnlColor = pnlPercent >= 0 ? '#4ADE80' : '#F87171';

  return (
    <div className={styles.frame} ref={frameRef}>
      <div
        key={animationKey}
        className={styles.stage}
        style={{ transform: `scale(${scale || 0.0001})` }}
      >
        <div
          className={`${styles.card} ${styles.assemble} ${styles.assembleScale}`}
          style={{ animationDelay: '0ms' }}
        >
          <div
            className={`${styles.imagePanel} ${styles.assemble} ${styles.assembleDown}`}
            style={{ animationDelay: '140ms' }}
          >
            {data.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.iconUrl} alt={title} />
            ) : (
              <span className={styles.imageFallback}>{(data.symbol || title)[0]}</span>
            )}
          </div>

          <div className={styles.body}>
            <div className={styles.topBlock}>
              <div className={styles.titleRow}>
                <span
                  className={`${styles.title} ${styles.assemble} ${styles.assembleLeft}`}
                  style={{ animationDelay: '340ms' }}
                >
                  {title}
                </span>
                {category && (
                  <div
                    className={`${styles.category} ${styles.assemble} ${styles.assembleScale}`}
                    style={{ animationDelay: '460ms' }}
                  >
                    <span className={styles.categoryText}>{category}</span>
                  </div>
                )}
              </div>

              <span
                className={`${styles.description} ${styles.assemble} ${styles.assembleUp}`}
                style={{ animationDelay: '560ms' }}
              >
                {description}
              </span>

              <div className={styles.stats}>
                <div
                  className={`${styles.stat} ${styles.assemble} ${styles.assembleUp}`}
                  style={{ animationDelay: '700ms' }}
                >
                  <span className={styles.statLabel}>Mark Price</span>
                  <span className={styles.statValue}>{formatPrice(currentPrice)}</span>
                </div>

                {startPrice > 0 && (
                  <div
                    className={`${styles.stat} ${styles.assemble} ${styles.assembleUp}`}
                    style={{ animationDelay: '800ms' }}
                  >
                    <span className={styles.statLabel}>Original Cost</span>
                    <span className={`${styles.statValue} ${styles.statValueMuted}`}>
                      {formatPrice(startPrice)}
                    </span>
                  </div>
                )}

                {showPnl && (
                  <div
                    className={`${styles.stat} ${styles.assemble} ${styles.assembleUp}`}
                    style={{ animationDelay: '900ms' }}
                  >
                    <span className={styles.statLabel}>PnL</span>
                    <span className={styles.statValue} style={{ color: pnlColor }}>
                      {formatPnlPercent(pnlPercent)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div
              className={`${styles.brand} ${styles.assemble} ${styles.assembleUp}`}
              style={{ animationDelay: '1040ms' }}
            >
              <div className={styles.brandInner}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={DEXETERA_LOGO_URL} alt="Dexetera" />
                <span className={styles.brandText}>DEXETERA</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
