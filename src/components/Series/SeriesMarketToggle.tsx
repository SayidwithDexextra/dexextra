'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

export interface SeriesMarketToggleProps {
  seriesSlug: string;
  markets: Array<{
    marketId: string;
    symbol: string;
    isActive: boolean; // whether this is the current page's market
    isPrimary: boolean;
    role?: 'front' | 'next';
    contractCode?: string;
  }>;
  className?: string;
}

export default function SeriesMarketToggle({ seriesSlug, markets, className }: SeriesMarketToggleProps) {
  const router = useRouter();

  const onSelect = (symbol: string) => {
    // Navigate to the selected market's token page
    router.push(`/token/${encodeURIComponent(symbol)}`);
  };

  return (
    <div className={`group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 ${className || ''}`}>
      <div className="flex items-center justify-between px-2.5 py-[3.0375px]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-[2.025px] h-[2.025px] rounded-full flex-shrink-0 bg-green-400" />
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-[0.50625px] rounded">
              Contract Rollover Active
            </div>
            <div className="text-[10px] text-[#606060]">{seriesSlug}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {markets.map((m) => (
            <button
              key={m.marketId}
              onClick={() => onSelect(m.symbol)}
              className={[
                'text-[10px] rounded px-2 py-[1.265625px] transition-all duration-200',
                m.isActive
                  ? 'text-white bg-[#1A1A1A] border border-[#333333]'
                  : 'text-[#808080] bg-[#0F0F0F] border border-[#222222] hover:text-white hover:bg-[#1A1A1A] hover:border-[#333333]',
                m.isPrimary ? 'font-medium' : ''
              ].join(' ')}
              title={m.isPrimary ? 'Primary' : 'Secondary'}
            >
              <span>{m.symbol}</span>
              {m.contractCode && (
                <span className="ml-1 text-[9px] text-[#606060] bg-[#1A1A1A] px-1 py-[0.50625px] rounded">
                  {m.contractCode}
                </span>
              )}
              {m.role && (
                <span className="ml-1 text-[9px] text-[#606060] bg-[#1A1A1A] px-1 py-[0.50625px] rounded">
                  {m.role === 'front' ? 'Front Month' : 'Next Month'}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}


