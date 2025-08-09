'use client';

import React from 'react';
import { MarketTickerCardContainer } from './index';
import { MarketTickerCardData } from './types';

// Sample data matching the original design
const sampleMarketData: MarketTickerCardData[] = [
  {
    id: '1',
    title: 'Gold Rush',
    categories: ['Mockups', 'Photoshop'],
    price: 3346,
    currency: '$',
    imageUrl: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExcXVvYjE0cWp2cnpubGdiZjdtOGhham5seGdodmVtdmg5MzF5c3phdiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/xT77XUw1XMVGIxgove/giphy.gif',
    imageAlt: 'Gold Rush',
  },
  {
    id: '2',
    title: 'DashFolio',
    categories: ['Templates', 'Framer'],
    price: 75,
    currency: '$',
    imageUrl: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExcXVvYjE0cWp2cnpubGdiZjdtOGhham5seGdodmVtdmg5MzF5c3phdiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/xT77XUw1XMVGIxgove/giphy.gif',
    imageAlt: 'DashFolio template preview',
  },
  {
    id: '3',
    title: 'Distortion Collection 02',
    categories: ['Graphics', 'Photoshop'],
    price: 19,
    currency: '$',
    imageUrl: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExcXVvYjE0cWp2cnpubGdiZjdtOGhham5seGdodmVtdmg5MzF5c3phdiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/xT77XUw1XMVGIxgove/giphy.gif',
    imageAlt: 'Distortion graphics collection',
  }
];

const MarketTickerCardDemo: React.FC = () => {
  const handleViewProduct = (cardId: string) => {
     console.log('View Product clicked for card:', cardId);
    // Implement your product view logic here
  };

  const handleViewDemo = (cardId: string) => {
     console.log('View Demo clicked for card:', cardId);
    // Implement your demo view logic here
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#0a0a0a',
      paddingTop: '2rem' 
    }}>
      <MarketTickerCardContainer
        title="Latest Drops"
        cards={sampleMarketData}
        onCardViewProduct={handleViewProduct}
        onCardViewDemo={handleViewDemo}
      />
    </div>
  );
};

export default MarketTickerCardDemo; 