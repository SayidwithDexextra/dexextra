'use client';

import React from 'react';
import MarketTickerCard from './MarketTickerCard';
import { MarketTickerCardData } from './types';
import styles from './MarketTickerCard.module.css';
 

interface MarketTickerCardContainerProps {
  title?: string;
  cards: MarketTickerCardData[];
  onCardLongPosition?: (cardId: string) => void;
  onCardShortPosition?: (cardId: string) => void;
  isLoading?: boolean;
  className?: string;
}

const MarketTickerCardContainer: React.FC<MarketTickerCardContainerProps> = ({
  title = 'Latest Drops',
  cards,
  onCardLongPosition,
  onCardShortPosition,
  isLoading = false,
  className,
}) => {
  // Render all dynamic cards fed from live data
  const cardsWithStatic: MarketTickerCardData[] = cards;
  const sectionClasses = [styles.section, className].filter(Boolean).join(' ');

  return (
    <section className={sectionClasses}>
      {title && (
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{title}</h2>
          <div className={styles.sectionBadge} aria-label="Market count">
            <span
              className={isLoading ? styles.statusDotLoading : styles.statusDot}
              aria-hidden="true"
            />
            <span className={styles.badgeText}>{cardsWithStatic.length}</span>
          </div>
        </div>
      )}
      
      <div className={styles.container}>
        {cardsWithStatic.map((card) => {
          const handleLong = () => onCardLongPosition?.(card.id);
          const handleShort = () => onCardShortPosition?.(card.id);

          return (
            <MarketTickerCard
              key={card.id}
              id={card.id}
              title={card.title}
              categories={card.categories}
              price={card.price}
              currency={card.currency}
              imageUrl={card.imageUrl}
              imageAlt={card.imageAlt}
              onLongPosition={handleLong}
              onShortPosition={handleShort}
            />
          );
        })}
      </div>
    </section>
  );
};

export default MarketTickerCardContainer; 