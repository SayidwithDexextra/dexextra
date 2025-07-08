'use client';

import React from 'react';
import MiniChart from './MiniChart';
import { marketCapChartData, tradingVolumeChartData } from './utils/mockData';
import useMarketData from '@/hooks/useMarketData';
import styles from './styles/Widget.module.css';

const MarketOverview: React.FC = () => {
  const { marketCap, marketCapChange, tradingVolume, isLoading, error } = useMarketData();

  // Determine if market cap change is positive or negative
  const isPositive = marketCapChange >= 0;
  const changeColor = isPositive ? styles.positive : styles.negative;
  const changeIcon = isPositive ? '▲' : '▼';

  return (
    <>
      {/* Market Cap Card */}
      <div className={styles.marketCard}>
        <div className="flex items-center justify-between h-full">
          <div className="flex flex-col gap-1">
            <div className={styles.marketCapSmall}>
              {isLoading ? 'Loading...' : error ? 'Error' : marketCap}
            </div>
            <div className="flex items-center gap-1">
              <span className={styles.labelSmall}>Market Cap</span>
              {!isLoading && !error && (
                <span className={`${changeColor} flex items-center gap-0.5 text-xs`}>
                  {changeIcon} {Math.abs(marketCapChange).toFixed(1)}%
                </span>
              )}
            </div>
          </div>
          <div className="flex-shrink-0">
            <MiniChart 
              data={marketCapChartData} 
              color={isPositive ? "#26C281" : "#E74C3C"}
              width={80}
              height={35}
            />
          </div>
        </div>
      </div>
      
      {/* 24h Trading Volume Card */}
      <div className={styles.marketCard}>
        <div className="flex items-center justify-between h-full">
          <div className="flex flex-col gap-1">
            <div className={styles.marketCapSmall}>
              {isLoading ? 'Loading...' : error ? 'Error' : tradingVolume}
            </div>
            <div className={styles.labelSmall}>
              24h Trading Volume
            </div>
          </div>
          <div className="flex-shrink-0">
            <MiniChart 
              data={tradingVolumeChartData} 
              color="#26C281"
              width={80}
              height={35}
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default MarketOverview; 