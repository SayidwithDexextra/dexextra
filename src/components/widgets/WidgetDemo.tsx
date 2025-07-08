'use client';

import React, { useState, useEffect } from 'react';
import Widget from './Widget';
import { mockMarketData, mockTrendingTokens, mockTopGainerTokens } from './utils/mockData';
import styles from './styles/Widget.module.css';

const WidgetDemo: React.FC = () => {
  const [isLive, setIsLive] = useState(false);
  const [marketData, setMarketData] = useState(mockMarketData);

  // Simulate live data updates
  useEffect(() => {
    if (!isLive) return;

    const interval = setInterval(() => {
      setMarketData(prev => ({
        ...prev,
        marketCapChange: (Math.random() - 0.5) * 10, // Random change between -5% and +5%
        tradingVolume: `$${(Math.random() * 100 + 50).toFixed(0)},000,000,000`
      }));
    }, 2000);

    return () => clearInterval(interval);
  }, [isLive]);

  const resetData = () => {
    setMarketData(mockMarketData);
    setIsLive(false);
  };

  return (

          <Widget />

  );
};

export default WidgetDemo; 