'use client';

import React from 'react';
import Image from 'next/image';
import { GradientBackground } from './GradientBackground';
import { MarketCardProps } from './types';

export const MarketCard: React.FC<MarketCardProps> = ({
  marketName,
  marketSymbol,
  icon,
  longPrice,
  shortPrice,
  percentChange,
  gradientType,
  nftGraphic,
  onClick
}) => {
  const isPositive = percentChange >= 0;
  
  return (
    <div className="market-card" onClick={onClick}>
      <GradientBackground type={gradientType} />
      <div className="gradient-overlay" />
      
      {nftGraphic && (
        <div className="nft-graphic">
          {nftGraphic}
        </div>
      )}
      
      <div className="card-content">
        <div className="card-header">
          <div className="market-icon">
            {typeof icon === 'string' ? (
              // Check if string is a valid URL or file path
              (icon.startsWith('/') || icon.startsWith('http') || icon.includes('.')) ? (
                <Image src={icon} alt={`${marketName} icon`} width={40} height={40} />
              ) : (
                // Render as text/emoji if not a valid image path
                <span className="icon-text">{icon}</span>
              )
            ) : (
              icon
            )}
          </div>
          <div className="market-info">
            <div className="market-name">{marketName}</div>
            <div className="market-symbol">{marketSymbol}</div>
          </div>
        </div>
        
        <div className="card-footer">
          <div className="prices">
            <div className="price-row">
              <span className="price-label">Long</span>
              <span className="price-value">{longPrice}</span>
            </div>
            <div className="price-row">
              <span className="price-label">Short</span>
              <span className="price-value">{shortPrice}</span>
            </div>
          </div>
          <div className={`percentage ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? '↗' : '↘'} {Math.abs(percentChange).toFixed(1)}%
          </div>
        </div>
      </div>

      <style jsx>{`
        .market-card {
          width: 280px;
          height: 240px;
          border-radius: 16px;
          padding: 20px;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          cursor: pointer;
          transition: transform 0.2s ease-in-out;
        }

        .market-card:hover {
          transform: translateY(-4px);
        }

        .gradient-overlay {
          background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 50%);
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: inherit;
          pointer-events: none;
        }

        .nft-graphic {
          position: absolute;
          top: 20px;
          right: 20px;
          width: 60px;
          height: 60px;
          opacity: 0.8;
          z-index: 1;
        }

        .card-content {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          height: 100%;
          z-index: 2;
          position: relative;
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .market-icon {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
        }

        .market-icon img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .icon-text {
          font-size: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
        }

        .market-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .market-name {
          font-size: 16px;
          font-weight: 600;
          color: #FFFFFF;
          margin: 0;
          line-height: 1.2;
        }

        .market-symbol {
          font-size: 12px;
          font-weight: 500;
          color: #FFFFFF;
          opacity: 0.7;
          margin: 0;
        }

        .card-footer {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
        }

        .prices {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
        }

        .price-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .price-label {
          font-size: 12px;
          font-weight: 500;
          color: #FFFFFF;
          opacity: 0.7;
        }

        .price-value {
          font-size: 14px;
          font-weight: 600;
          color: #FFFFFF;
        }

        .percentage {
          font-size: 14px;
          font-weight: 600;
          padding: 4px 8px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          gap: 2px;
          backdrop-filter: blur(10px);
        }

        .percentage.positive {
          color: #10B981;
          background: rgba(16, 185, 129, 0.15);
        }

        .percentage.negative {
          color: #EF4444;
          background: rgba(239, 68, 68, 0.15);
        }

        @media (max-width: 640px) {
          .market-card {
            width: 100%;
            height: 220px;
          }
          
          .card-header {
            gap: 10px;
          }
          
          .market-icon {
            width: 36px;
            height: 36px;
          }
          
          .market-name {
            font-size: 15px;
          }
        }
      `}</style>
    </div>
  );
};

// Keep AuctionCard for backward compatibility
export const AuctionCard: React.FC<{ username: string; price: string; gradientType: import('./types').GradientType; nftGraphic?: React.ReactNode; onClick?: () => void; }> = ({
  username,
  price,
  gradientType,
  nftGraphic,
  onClick
}) => {
  return (
    <MarketCard
      marketName={username}
      marketSymbol="LEGACY"
      icon="🎯"
      longPrice={price}
      shortPrice={price}
      percentChange={0}
      gradientType={gradientType}
      nftGraphic={nftGraphic}
      onClick={onClick}
    />
  );
}; 