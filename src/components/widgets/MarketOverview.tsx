'use client';

import React from 'react';
import MiniChart from './MiniChart';
import { marketCapChartData, tradingVolumeChartData } from './utils/mockData';
import useMarketOverviewData from '@/hooks/useMarketOverviewData';

const MarketOverview: React.FC = () => {
  const { marketCap, marketCapChange, tradingVolume, isLoading, error } = useMarketOverviewData();

  // Determine if market cap change is positive or negative
  const isPositive = marketCapChange >= 0;
  const changeText = `${isPositive ? '▲' : '▼'} ${Math.abs(marketCapChange).toFixed(1)}%`;

  return (
    <>
      {/* Market Cap Card */}
      <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 h-[84px]">
        <div className="flex items-center justify-between p-2.5 h-full">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-white font-mono tabular-nums truncate">
              {isLoading ? 'Loading…' : error ? 'Error' : marketCap}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-[#808080]">Market Cap</span>
              {!isLoading && !error && (
                <span
                  className={`text-[11px] font-medium px-1.5 py-0.5 rounded tabular-nums ${
                    isPositive ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'
                  }`}
                  aria-label={`Market cap change ${changeText}`}
                >
                  {changeText}
                </span>
              )}
            </div>
          </div>

          <div className="flex-shrink-0">
            <MiniChart data={marketCapChartData} color={isPositive ? '#26C281' : '#E74C3C'} width={80} height={35} />
          </div>
        </div>
      </div>
      
      {/* 24h Trading Volume Card */}
      <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 h-[84px]">
        <div className="flex items-center justify-between p-2.5 h-full">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-white font-mono tabular-nums truncate">
              {isLoading ? 'Loading…' : error ? 'Error' : tradingVolume}
            </div>
            <div className="text-[12px] font-medium text-[#808080]">24h Trading Volume</div>
          </div>

          <div className="flex-shrink-0">
            <MiniChart data={tradingVolumeChartData} color="#26C281" width={80} height={35} />
          </div>
        </div>
      </div>
    </>
  );
};

export default MarketOverview; 