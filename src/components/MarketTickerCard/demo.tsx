"use client";

import React from 'react';
import MarketTickerCardContainer from './MarketTickerCardContainer';
import { useMockMarketTickerData } from './useMockMarketTickerData';

const MarketTickerCardDemo: React.FC = () => {
  const sampleMarkets = useMockMarketTickerData();

  const handleLongPosition = (cardId: string) => {
    console.log('Long position clicked for card:', cardId);
    // Handle long position logic here
  };

  const handleShortPosition = (cardId: string) => {
    console.log('Short position clicked for card:', cardId);
    // Handle short position logic here
  };

  return (
    <div style={{ 
      padding: '40px 20px', 
      backgroundColor: '#000000', 
      minHeight: '100vh' 
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <h2 style={{ 
          color: '#ffffff', 
          fontSize: '32px', 
          fontWeight: '700', 
          marginBottom: '8px',
          textAlign: 'center'
        }}>
          Market Ticker Cards
        </h2>
        <p style={{ 
          color: '#9ca3af', 
          fontSize: '16px', 
          marginBottom: '40px',
          textAlign: 'center'
        }}>
          Explore the latest market opportunities and take positions
        </p>
        
        <MarketTickerCardContainer
          title="Featured Markets"
          cards={sampleMarkets}
          onCardLongPosition={handleLongPosition}
          onCardShortPosition={handleShortPosition}
        />
      </div>
    </div>
  );
};

export default MarketTickerCardDemo;


