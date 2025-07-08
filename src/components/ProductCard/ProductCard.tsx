'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ProductCardProps } from './types';
import styles from './ProductCard.module.css';

const ProductCard: React.FC<ProductCardProps> = ({
  id,
  title,
  subtitle,
  author,
  price,
  currency = 'USD',
  imageUrl,
  imageAlt,
  href,
  onCardClick,
  onActionClick,
  onViewMarket,
  className = '',
}) => {
  const handleCardClick = (e: React.MouseEvent) => {
    if (onCardClick) {
      e.preventDefault();
      onCardClick(id);
    }
  };

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onViewMarket) {
      e.preventDefault();
      const productData = {
        id,
        title,
        subtitle,
        author,
        price,
        currency,
        imageUrl,
        imageAlt,
        href,
      };
      onViewMarket(productData);
    } else if (onActionClick) {
      e.preventDefault();
      onActionClick(id);
    }
  };

  const cardClasses = [
    styles.productCard,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const cardContent = (
    <>
      <div className={styles.imageContainer}>
        <Image
          src={imageUrl}
          alt={imageAlt || `Preview of ${title}`}
          fill
          className={styles.productImage}
          sizes="(max-width: 360px) 400px, (max-width: 480px) 420px, (max-width: 768px) 440px, (max-width: 1200px) 460px, 480px"
          priority
        />
      </div>
      
      <div className={styles.content}>
        <div className={styles.titleSection}>
          <div className={styles.category}>Digital Product</div>
          <h2 className={styles.title}>{title}</h2>
          {subtitle && (
            <p className={styles.subtitle}>{subtitle}</p>
          )}
        </div>
        
        <div className={styles.authorPriceSection}>
          <div className={styles.authorPriceRow}>
            <p className={styles.author}>By {author}</p>
            <div className={styles.priceContainer}>
              <span className={styles.priceLabel}>from</span>
              <span className={styles.price}>{price}</span>
              <span className={styles.currency}>{currency}</span>
            </div>
          </div>
        </div>
        
        <div className={styles.actionSection}>
          <button
            className={styles.action}
            onClick={handleActionClick}
            aria-label={`View ${title} product details`}
          >
            <span>View Market</span>
            <svg
              className={styles.actionIcon}
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M6 3L11 8L6 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </>
  );

  if (href && !onCardClick) {
    return (
      <Link href={href} className={cardClasses} aria-label={`View ${title}`}>
        {cardContent}
      </Link>
    );
  }

  return (
    <article className={cardClasses} onClick={handleCardClick}>
      {cardContent}
    </article>
  );
};

export default ProductCard; 