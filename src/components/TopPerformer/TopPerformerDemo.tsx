"use client";

import React from 'react';
import TopPerformerCarousel from './TopPerformerCarousel';
import { TopPerformerData } from './types';
import { useMockTopPerformerData } from './useMockTopPerformerData';

const TopPerformerDemo: React.FC = () => {
  const samplePerformers = useMockTopPerformerData();

  const _handlePerformerClick = (performer: TopPerformerData) => {
     console.log('Performer clicked:', performer);
    // Handle click logic here
  };

  return (
    <div style={{ padding: '40px 20px', backgroundColor: '#000000', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <h2 style={{ 
          color: '#ffffff', 
          fontSize: '32px', 
          fontWeight: '700', 
          marginBottom: '8px',
          textAlign: 'center'
        }}>
          Top Performers
        </h2>
        <p style={{ 
          color: '#9ca3af', 
          fontSize: '16px', 
          marginBottom: '40px',
          textAlign: 'center'
        }}>
          Meet our outstanding community members making waves in their fields
        </p>
        
        <TopPerformerCarousel 
          performers={samplePerformers}
          autoPlay={true}
          autoPlayInterval={3000}
          showArrows={true}
          showDots={false}
          slidesToShow={4}
          slidesToScroll={1}
          infinite={true}
          speed={500}
        />
      </div>
    </div>
  );
};

export default TopPerformerDemo; 