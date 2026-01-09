'use client';

import React from 'react';
import Image from 'next/image';
import { MarketTickerCardProps } from './types';
import styles from './MarketTickerInlineCard.module.css';

const MarketTickerInlineCard: React.FC<MarketTickerCardProps> = ({
  title,
  categories,
  price,
  currency = '$',
  imageUrl,
  imageAlt,
  onCardClick,
  onLongPosition,
  onShortPosition,
  className,
  isDisabled = false,
  marketStatus,
  settlementDate,
  priceChangePercent,
}) => {
  // Format price like "< 0.01 ETH" or "7.50 RON"
  const formattedPrice = (() => {
    const safePrice = Number.isFinite(price) ? price : 0;
    
    // If price is very small (< 0.01), show "< 0.01"
    if (safePrice > 0 && safePrice < 0.01) {
      return '< 0.01';
    }
    
    // Format based on currency type
    if (/^[A-Z]{3}$/.test(currency)) {
      try {
        return new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(safePrice);
      } catch {
        // Fallback
      }
    }

    const numberPart = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safePrice);
    return numberPart;
  })();

  // Format percentage change
  const formattedChange = priceChangePercent !== undefined
    ? `${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(1)}%`
    : null;
  const isPositiveChange = priceChangePercent !== undefined && priceChangePercent >= 0;

  // Format title: capitalize first letter of each word
  const formattedTitle = title
    ? title
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
    : '';

  const handleCardClick = () => {
    if (!isDisabled) {
      onCardClick?.();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (isDisabled) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onCardClick?.();
    }
  };

  const handleLong = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!isDisabled) {
      onLongPosition?.();
    }
  };

  const handleShort = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!isDisabled) {
      onShortPosition?.();
    }
  };

  const cardClasses = [
    styles.card,
    isDisabled && styles.disabled,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      className={cardClasses}
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-disabled={isDisabled}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
    >
      {/* Full height square image on the left */}
      <div className={styles.media}>
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={imageAlt || title}
            fill
            sizes="(max-width: 768px) 100vw, 120px"
            className={styles.mediaImage}
            priority={false}
          />
        ) : (
          <div className={styles.mediaPlaceholder}>
            <span className={styles.mediaInitials}>
              {title
                ?.split(' ')
                .slice(0, 2)
                .map((token) => token.charAt(0))
                .join('')
                .toUpperCase() || 'DX'}
            </span>
          </div>
        )}
      </div>

      {/* Content area on the right */}
      <div className={styles.body}>
        {/* Title with verified badge */}
        <div className={styles.titleRow}>
          <h3 className={styles.title}>{formattedTitle}</h3>
          <svg
            className={styles.verifiedBadge}
            viewBox="0 0 24 24"
            fill="none"
            aria-label="Verified"
          >
            <circle cx="12" cy="12" r="10" fill="#3B82F6" />
            <path
              d="M9 12l2 2 4-4"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Price and percentage change */}
        <div className={styles.priceRow}>
          <span className={styles.priceValue}>
            {formattedPrice}
            {currency && currency !== '$' && (
              <span className={styles.currency}>{currency}</span>
            )}
          </span>
          {formattedChange && (
            <span
              className={`${styles.priceChange} ${
                isPositiveChange ? styles.priceChangePositive : styles.priceChangeNegative
              }`}
            >
              {formattedChange}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className={styles.actions}>
          <button
            type="button"
            onClick={handleLong}
            className={`${styles.actionButton} ${styles.actionButtonLong}`}
            disabled={isDisabled}
          >
            <span>Long</span>
            <svg
              className={styles.actionIcon}
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7 17L17 7M17 7H10M17 7V14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleShort}
            className={`${styles.actionButton} ${styles.actionButtonShort}`}
            disabled={isDisabled}
          >
            <span>Short</span>
            <svg
              className={styles.actionIcon}
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7 7L17 17M17 17H10M17 17V10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </article>
  );
};

export default MarketTickerInlineCard;

