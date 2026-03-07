'use client';

import React, { useState } from 'react';

type MobileTab = 'chart' | 'orderbook' | 'trades';

interface MobileTradingTabsProps {
  chartContent: React.ReactNode;
  orderbookContent: React.ReactNode;
  tradesContent: React.ReactNode;
  className?: string;
}

const TABS: { id: MobileTab; label: string }[] = [
  { id: 'chart', label: 'Chart' },
  { id: 'orderbook', label: 'Order Book' },
  { id: 'trades', label: 'Trades' },
];

export default function MobileTradingTabs({
  chartContent,
  orderbookContent,
  tradesContent,
  className = '',
}: MobileTradingTabsProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>('chart');

  return (
    <div className={`flex flex-col bg-[#0A0A0A] rounded-md border border-[#222222] overflow-hidden ${className}`}>
      {/* Tab bar */}
      <div className="flex items-center border-b border-[#222222] bg-[#0F0F0F]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 text-[12px] font-medium text-center transition-colors duration-200 relative ${
              activeTab === tab.id
                ? 'text-white'
                : 'text-[#808080] hover:text-[#B0B0B0]'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-white rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content — all panels stay mounted to avoid re-initialization */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div className={`h-full w-full ${activeTab !== 'chart' ? 'hidden' : ''}`} data-walkthrough="token-chart">
          {chartContent}
        </div>
        <div className={`h-full w-full ${activeTab !== 'orderbook' ? 'hidden' : ''}`} data-walkthrough="token-orderbook">
          {orderbookContent}
        </div>
        <div className={`h-full w-full ${activeTab !== 'trades' ? 'hidden' : ''}`}>
          {tradesContent}
        </div>
      </div>
    </div>
  );
}
