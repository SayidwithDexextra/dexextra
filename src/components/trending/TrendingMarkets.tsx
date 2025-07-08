'use client';

import React from 'react';
import { MarketCard } from './AuctionCard';
import { MarketData } from './types';

interface TrendingMarketsProps {
  markets: MarketData[];
  className?: string;
  title?: string;
}

export const TrendingMarkets: React.FC<TrendingMarketsProps> = ({
  markets,
  className = '',
  title = "Trending markets"
}) => {
  return (
    <section className={`trending-markets ${className}`}>
      <div className="trending-container">
        <h2 className="trending-title">{title}</h2>
        <div className="trending-grid">
          {markets.map((market) => (
            <MarketCard 
              key={market.id}
              marketName={market.marketName}
              marketSymbol={market.marketSymbol}
              icon={market.icon}
              longPrice={market.longPrice}
              shortPrice={market.shortPrice}
              percentChange={market.percentChange}
              gradientType={market.gradientType}
              nftGraphic={market.nftGraphic}
              onClick={market.onClick}
            />
          ))}
        </div>
      </div>

      <style jsx>{`
        .trending-markets {
          background: #0F0F0F;
          padding: 32px 0;
        }

        .trending-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px;
        }

        .trending-title {
          font-size: 24px;
          font-weight: 600;
          line-height: 1.2;
          color: #FFFFFF;
          margin-bottom: 24px;
          margin: 0 0 24px 0;
        }

        .trending-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
        }

        @media (max-width: 1024px) {
          .trending-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 18px;
          }
        }

        @media (max-width: 640px) {
          .trending-grid {
            grid-template-columns: 1fr;
            gap: 16px;
          }
          
          .trending-container {
            padding: 0 16px;
          }
        }
      `}</style>
    </section>
  );
}; 