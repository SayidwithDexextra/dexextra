'use client';

import React from 'react';
import { Hero } from './index';
import { HeroData } from './types';

const HeroDemo: React.FC = () => {
  // Sample data matching the original design
  const heroData: HeroData = {
    title: "DDUST by jiwa",
    author: "e66264",
    isVerified: true,
    stats: {
      mintPrice: "$50.77",
      totalItems: 500,
      mintStartsIn: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
    },
    backgroundImage: "/api/placeholder/1200/800" // Placeholder image
  };

  const handleMintClick = () => {
    console.log('Mint button clicked');
    // Add mint functionality here
  };

  return (
    <div >
      <Hero 
        data={heroData}
        onMintClick={handleMintClick}
      />
    </div>
  );
};

export default HeroDemo; 