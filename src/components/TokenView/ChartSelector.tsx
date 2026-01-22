'use client';

import React, { useState } from 'react';
import { TradingViewChart } from '../TradingView';

interface ChartSelectorProps {
  symbol: string;
  width?: string | number;
  height?: string | number;
  className?: string;
  defaultChart?: 'lightweight' | 'advanced';
}

type ChartType = 'lightweight' | 'advanced';

export default function ChartSelector({
  symbol,
  width = '100%',
  height = 500,
  className = '',
  defaultChart = 'lightweight'
}: ChartSelectorProps) {
  const [selectedChart, setSelectedChart] = useState<ChartType>(defaultChart);

  const chartOptions: Array<{
    id: ChartType;
    label: string;
    description: string;
    icon: string;
  }> = [
    {
      id: 'lightweight',
      label: 'Advanced Chart',
      description: 'TradingView charting library with full tooling',
      icon: '📈'
    }
  ];

  const renderSelectedChart = () => (
    <TradingViewChart
      symbol={symbol}
      height={typeof height === 'number' ? height : 500}
      autosize={typeof height !== 'number'}
    />
  );

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Chart Type Selector */}
      <div className="bg-[#000000] rounded-lg border border-[#1a1a1a] p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-[#AAA] uppercase tracking-wider">{symbol}/USD</h3>
          <div className="text-xs text-[#666]">TradingView Advanced Chart</div>
        </div>

        {/* Chart Info */}
        <div className="flex items-center gap-3 p-3 rounded border border-[#8B5CF6] bg-[#8B5CF6]/5">
          <span className="text-xl">📈</span>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-white">Advanced Chart</span>
              <div className="w-1.5 h-1.5 bg-[#8B5CF6] rounded-full"></div>
              <span className="text-xs text-[#8B5CF6] uppercase tracking-wider">Active</span>
            </div>
            <p className="text-sm text-[#CCCCCC]">
              TradingView charting library with full tools + indicators
            </p>
          </div>
        </div>

        {/* Chart Features */}
        <div className="mt-3 p-3 bg-[#0a0a0a] rounded border border-[#1a1a1a]">
          <div className="text-xs text-[#666] mb-2 uppercase tracking-wider">Chart Features</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <div className="text-[#AAA] font-medium">📈 Advanced Charting</div>
              <div className="text-[#666]">• Full TradingView tooling</div>
              <div className="text-[#666]">• Indicator & drawing suite</div>
              <div className="text-[#666]">• Professional candles</div>
              <div className="text-[#666]">• Multi-timeframe support</div>
            </div>
            <div className="space-y-1">
              <div className="text-[#AAA] font-medium">⚡ Live Data</div>
              <div className="text-[#666]">• TradingView UDF feed</div>
              <div className="text-[#666]">• Real-time streaming</div>
              <div className="text-[#666]">• Pro dark theme</div>
              <div className="text-[#666]">• Responsive layout</div>
            </div>
          </div>
        </div>
      </div>

      {/* Selected Chart Component */}
      <div className="chart-container">
        {renderSelectedChart()}
      </div>

      {/* Chart Info Bar */}
      <div className="bg-[#000000] rounded border border-[#1a1a1a] p-2">
        <div className="flex items-center justify-between text-xs text-[#666]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]"></div>
              <span className="uppercase tracking-wider">Live Advanced Chart</span>
            </div>
            <span className="text-[#8B5CF6]">● Streaming</span>
          </div>
          
          <div className="flex items-center gap-3 text-[#AAA]">
            <span>{symbol}/USD</span>
            <span>·</span>
            <span>TradingView Datafeed</span>
          </div>
        </div>
      </div>
    </div>
  );
} 