import React from 'react';
import { TokenData } from '@/types/token';

interface TokenStatsProps {
  tokenData: TokenData;
}

export default function TokenStats({ tokenData }: TokenStatsProps) {
  const formatValue = (value: number) => {
    if (value >= 1e9) {
      return `$${(value / 1e9).toFixed(1)}B`;
    } else if (value >= 1e6) {
      return `$${(value / 1e6).toFixed(1)}M`;
    } else if (value >= 1e3) {
      return `$${(value / 1e3).toFixed(1)}K`;
    } else {
      return `$${value.toFixed(2)}`;
    }
  };

  const stats = [
    {
      label: 'CHAIN',
      value: tokenData.chain,
      isText: true,
    },
    {
      label: 'MARKET CAP',
      value: formatValue(tokenData.marketCap),
      isText: false,
    },
    {
      label: 'FDV',
      value: formatValue(tokenData.fullyDilutedValuation || tokenData.marketCap),
      isText: false,
    },
    {
      label: '1D VOLUME',
      value: formatValue(tokenData.volume24h),
      isText: false,
    },
    {
      label: '1D PRICE',
      value: `${tokenData.priceChange24h >= 0 ? '+' : ''}${tokenData.priceChange24h.toFixed(1)}%`,
      isText: false,
      isPositive: tokenData.priceChange24h >= 0,
    },
    {
      label: '1D MARKET CAP',
      value: `${tokenData.marketCapChange24h >= 0 ? '+' : ''}${tokenData.marketCapChange24h.toFixed(1)}%`,
      isText: false,
      isPositive: tokenData.marketCapChange24h >= 0,
    },
  ];

  return (
    <div className="bg-[#1A1A1A] rounded-xl p-2">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {stats.map((stat, index) => (
          <div key={index} className="flex flex-col">
            <span className="text-[#E5E7EB] text-sm font-medium mb-1 uppercase tracking-wider">
              {stat.label}
            </span>
            <span 
              className={`text-lg font-semibold ${
                stat.isText 
                  ? 'text-white' 
                  : stat.isPositive !== undefined 
                    ? stat.isPositive 
                      ? 'text-[#00D084]' 
                      : 'text-[#FF4747]'
                    : 'text-white'
              }`}
            >
              {stat.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
} 