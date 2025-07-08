"use client";

import React from 'react';
import TopPerformerDualCarousel from './TopPerformerDualCarousel';
import { useMockTopPerformerData } from './useMockTopPerformerData';

const TopPerformerDualDemo: React.FC = () => {
  const performers = useMockTopPerformerData();

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
          Top Performers
        </h2>
        <p style={{ 
          color: '#9ca3af', 
          fontSize: '16px', 
          marginBottom: '40px',
          textAlign: 'center'
        }}>
          Two independent carousels moving in opposite directions with elegant fade effects. Hover to pause both!
        </p>
        
        <TopPerformerDualCarousel 
          performers={performers}
          autoPlay={true}
          autoPlayInterval={4000}
          speed={1000}
        />
      </div>
    </div>
  );
};

export default TopPerformerDualDemo; 