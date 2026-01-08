'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import MarketTickerCard from './MarketTickerCard';
import MarketTickerInlineCard from './MarketTickerInlineCard';
import { MarketTickerCardData, MarketTickerCardProps } from './types';
import styles from './MarketTickerCard.module.css';

interface MarketTickerCardContainerProps {
  title?: string;
  cards: MarketTickerCardData[];
  onCardLongPosition?: (cardId: string) => void;
  onCardShortPosition?: (cardId: string) => void;
  isLoading?: boolean;
  className?: string;
  variant?: 'stacked' | 'inline';
  toolbar?: React.ReactNode;
}

const MarketTickerCardContainer: React.FC<MarketTickerCardContainerProps> = ({
  title = 'Latest Drops',
  cards,
  onCardLongPosition,
  onCardShortPosition,
  isLoading = false,
  className,
  variant = 'stacked',
  toolbar,
}) => {
  // Render all dynamic cards fed from live data
  const cardsWithStatic: MarketTickerCardData[] = cards;
  const sectionClasses = [styles.section, className].filter(Boolean).join(' ');
  const cardsWrapperClass =
    variant === 'inline' ? styles.inlineGrid : styles.container;
  const CardComponent: React.FC<MarketTickerCardProps> =
    variant === 'inline' ? MarketTickerInlineCard : MarketTickerCard;
  const cardAnimation = {
    initial: { opacity: 0, y: 12, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -12, scale: 0.98 },
  };

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
      
      {/* Toolbar positioned to align with card grid */}
      {toolbar && variant === 'inline' && (
        <div className={styles.toolbarWrapper}>
          {toolbar}
        </div>
      )}
      
      {cardsWithStatic.length > 0 ? (
        <div className={cardsWrapperClass}>
          <AnimatePresence mode="popLayout">
            {cardsWithStatic.map((card) => {
              const handleLong = () => onCardLongPosition?.(card.id);
              const handleShort = () => onCardShortPosition?.(card.id);

              return (
                <motion.div
                  key={card.id}
                  layout
                  variants={cardAnimation}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <CardComponent
                    id={card.id}
                    title={card.title}
                    categories={card.categories}
                    price={card.price}
                    currency={card.currency}
                    imageUrl={card.imageUrl}
                    imageAlt={card.imageAlt}
                    onLongPosition={handleLong}
                    onShortPosition={handleShort}
                    marketStatus={card.marketStatus}
                    settlementDate={card.settlementDate}
                    totalTrades={card.totalTrades}
                    totalVolume={card.totalVolume}
                    priceChangePercent={card.priceChangePercent}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      ) : (
        toolbar && variant === 'inline' && (
          <div className={styles.emptyState}>
            <p className={styles.emptyStateText}>No markets found</p>
          </div>
        )
      )}
    </section>
  );
};

export default MarketTickerCardContainer; 