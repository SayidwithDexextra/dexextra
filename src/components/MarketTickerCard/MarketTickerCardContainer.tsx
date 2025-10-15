'use client';

import React from 'react';
import MarketTickerCard from './MarketTickerCard';
import { MarketTickerCardData } from './types';
import styles from './MarketTickerCard.module.css';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();
  // Always include one static market card derived from contractConfig
  const aluminumMarket = CONTRACT_ADDRESSES.MARKET_INFO?.ALUMINUM;
  const staticCard: MarketTickerCardData | null = aluminumMarket
    ? {
        id: `static-${aluminumMarket.symbol}`,
        title: aluminumMarket.name || aluminumMarket.symbol,
        categories: ['Test Market'],
        price: 1,
        currency: '$',
        imageUrl: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExMGYyNm95dmtwM3ZtejRnOWEzdzB0ZnRldGoyb2hzNjZncTl6YjNrayZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3og0IS6SldW60DdCRa/giphy.gif',
        imageAlt: `${aluminumMarket.name || aluminumMarket.symbol} market`,
        // Optional extras for parity with dynamic markets
        marketStatus: 'ACTIVE',
        totalVolume: 0,
        totalTrades: 0,
        settlementDate: undefined,
        metricId: aluminumMarket.symbol,
        description: `${aluminumMarket.name} (${aluminumMarket.symbol})`,
      }
    : null;

  const cardsWithStatic: MarketTickerCardData[] = staticCard
    ? [staticCard, ...cards]
    : cards;

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
        {cardsWithStatic.map((card) => {
          const isStatic = staticCard && card.id === staticCard.id;
          const symbol = aluminumMarket?.symbol;
          const handleLong = isStatic && symbol
            ? () => router.push(`/token/${symbol}?action=long`)
            : () => onCardLongPosition?.(card.id);
          const handleShort = isStatic && symbol
            ? () => router.push(`/token/${symbol}?action=short`)
            : () => onCardShortPosition?.(card.id);

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