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
  className?: string;
}

const MarketTickerCardContainer: React.FC<MarketTickerCardContainerProps> = ({
  title = 'Latest Drops',
  cards,
  onCardLongPosition,
  onCardShortPosition,
  className,
}) => {
  return (
    <section className={className}>
      {title && (
        <h2 style={{
          fontSize: '32px',
          fontWeight: '700',
          color: '#ffffff',
          marginBottom: '16px',
          marginLeft: '32px',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          {title}
        </h2>
      )}
      
      <div className={styles.container}>
        {cards.map((card) => (
          <MarketTickerCard
            key={card.id}
            id={card.id}
            title={card.title}
            categories={card.categories}
            price={card.price}
            currency={card.currency}
            imageUrl={card.imageUrl}
            imageAlt={card.imageAlt}
            onLongPosition={() => onCardLongPosition?.(card.id)}
            onShortPosition={() => onCardShortPosition?.(card.id)}
          />
        ))}
      </div>
    </section>
  );
};

export default MarketTickerCardContainer; 