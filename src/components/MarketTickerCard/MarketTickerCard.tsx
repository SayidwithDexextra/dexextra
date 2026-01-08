'use client';

import React from 'react';
import Image from 'next/image';
import { MarketTickerCardProps } from './types';
import styles from './MarketTickerCard.module.css';

const MarketTickerCard: React.FC<MarketTickerCardProps> = ({
  id: _id,
  title,
  categories,
  price,
  currency = '$',
  imageUrl,
  imageAlt,
  onLongPosition,
  onShortPosition,
  className,
  isDisabled = false,
}) => {
  const formattedPrice = (() => {
    const safePrice = Number.isFinite(price) ? price : 0;
    const resolvedCurrency = currency && currency.trim() ? currency : '$';
    // If currency looks like an ISO code (e.g. "USD"), let Intl handle symbol + separators.
    if (/^[A-Z]{3}$/.test(resolvedCurrency)) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: resolvedCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(safePrice);
    }

    // Otherwise treat `currency` as a prefix symbol (e.g. "$", "€", "Ξ").
    const numberPart = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safePrice);
    return `${resolvedCurrency}${numberPart}`;
  })();

  const handleLongPosition = () => {
    if (!isDisabled && onLongPosition) {
      onLongPosition();
    }
  };

  const handleShortPosition = () => {
    if (!isDisabled && onShortPosition) {
      onShortPosition();
    }
  };

  const cardClasses = [
    styles.card,
    isDisabled && styles.disabled,
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClasses}>
      {/* Image Container */}
      <div className={styles.imageContainer}>
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={imageAlt || title}
            fill
            className={styles.image}
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className={styles.imagePlaceholder}>
            No Image Available
          </div>
        )}
      </div>

      {/* Content */}
      <div className={styles.content}>
        {/* Header with Title and Price */}
        <div className={styles.header}>
          <h3 className={styles.title}>{title}</h3>
          <div className={styles.priceRow}>
            <span className={styles.priceIcon} aria-hidden="true">$</span>
            <span className={styles.price}>{formattedPrice}</span>
          </div>
        </div>

        {/* Categories */}
        {categories.length > 0 && (
          <div className={styles.categories}>
            {categories.map((category, index) => (
              <span key={index} className={styles.category}>
                {category}
              </span>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className={styles.actions}>
          <button
            className={`${styles.button} ${styles.buttonLong}`}
            onClick={handleLongPosition}
            disabled={isDisabled}
            type="button"
          >
            <span>Long</span>
            <svg
              className={styles.buttonIcon}
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
            className={`${styles.button} ${styles.buttonShort}`}
            onClick={handleShortPosition}
            disabled={isDisabled}
            type="button"
          >
            <span>Short</span>
            <svg
              className={styles.buttonIcon}
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
    </div>
  );
};

export default MarketTickerCard; 