'use client';

import React from 'react';
import MarketOverview from './MarketOverview';
import TopGainersSection from './TopGainersSection';
import TrendingSection from './TrendingSection';


const Widget: React.FC = () => {
  return (
    <div className="w-full">
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-3 w-full">
        {/* Left Side - Market Overview Stacked (narrower) */}
        <div className="lg:col-span-2 flex flex-col gap-3">
          <MarketOverview />
        </div>
        
        {/* Right Side - Trading Sections Side by Side Horizontally (wider) */}
        <div className="lg:col-span-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <TrendingSection />
          <TopGainersSection />
        </div>
      </div>
    </div>
  );
};

export default Widget; 