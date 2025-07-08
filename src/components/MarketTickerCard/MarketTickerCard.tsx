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
  onViewProduct,
  onViewDemo,
  className,
  isDisabled = false,
}) => {
  const handleViewProduct = () => {
    if (!isDisabled && onViewProduct) {
      onViewProduct();
    }
  };

  const handleViewDemo = () => {
    if (!isDisabled && onViewDemo) {
      onViewDemo();
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
          <span className={styles.price}>
            {currency}{price}
          </span>
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
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={handleViewProduct}
            disabled={isDisabled}
            type="button"
          >
            Long
          </button>
          <button
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={handleViewDemo}
            disabled={isDisabled}
            type="button"
          >
            Short
          </button>
        </div>
      </div>
    </div>
  );
};

export default MarketTickerCard; 