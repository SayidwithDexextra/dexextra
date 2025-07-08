'use client';

import React, { useState, useEffect } from 'react';
import { TokenData } from '@/types/token';

interface TokenChartProps {
  tokenData: TokenData;
}

const timeframes = ['All', '1y', '30d', '7d', '1d'];

export default function TokenChart({ tokenData }: TokenChartProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState('1d');
  const [chartData, setChartData] = useState<number[]>([]);

  // Generate mock chart data based on timeframe
  useEffect(() => {
    const generateChartData = () => {
      const basePrice = tokenData.price;
      const volatility = 0.05; // 5% volatility
      const dataPoints = selectedTimeframe === 'All' ? 100 : 
                        selectedTimeframe === '1y' ? 365 : 
                        selectedTimeframe === '30d' ? 30 : 
                        selectedTimeframe === '7d' ? 7 : 24;
      
      const data = [];
      let currentPrice = basePrice * 0.7; // Start 30% lower
      
      for (let i = 0; i < dataPoints; i++) {
        const change = (Math.random() - 0.5) * volatility;
        currentPrice *= (1 + change);
        data.push(currentPrice);
      }
      
      // Ensure the last point is close to current price
      data[data.length - 1] = basePrice;
      
      setChartData(data);
    };

    generateChartData();
  }, [selectedTimeframe, tokenData.price]);

  const createSVGPath = (data: number[]) => {
    if (data.length < 2) return '';
    
    const width = 800;
    const height = 300;
    const minPrice = Math.min(...data);
    const maxPrice = Math.max(...data);
    const priceRange = maxPrice - minPrice;
    
    const points = data.map((price, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((price - minPrice) / priceRange) * height;
      return `${x},${y}`;
    });
    
    return `M ${points.join(' L ')}`;
  };

  const createGradientPath = (data: number[]) => {
    if (data.length < 2) return '';
    
    const width = 800;
    const height = 300;
    const minPrice = Math.min(...data);
    const maxPrice = Math.max(...data);
    const priceRange = maxPrice - minPrice;
    
    const points = data.map((price, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((price - minPrice) / priceRange) * height;
      return `${x},${y}`;
    });
    
    return `M 0,${height} L ${points.join(' L ')} L ${width},${height} Z`;
  };

  return (
    <div className="bg-[#1A1A1A] rounded-xl p-6">
      {/* Timeframe Buttons */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          {timeframes.map((timeframe) => (
            <button
              key={timeframe}
              onClick={() => setSelectedTimeframe(timeframe)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedTimeframe === timeframe
                  ? 'bg-[#2A2A2A] text-white'
                  : 'text-[#808080] hover:text-white'
              }`}
            >
              {timeframe}
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-4">
          <button className="text-[#808080] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"/>
            </svg>
          </button>
          <button className="text-[#808080] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="relative h-80 bg-[#0A0A0A] rounded-lg overflow-hidden">
        {chartData.length > 0 && (
          <svg 
            viewBox="0 0 800 300" 
            className="w-full h-full"
            preserveAspectRatio="none"
          >
            {/* Gradient Definition */}
            <defs>
              <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="rgba(74, 144, 226, 0.1)" />
                <stop offset="100%" stopColor="rgba(74, 144, 226, 0.01)" />
              </linearGradient>
            </defs>
            
            {/* Gradient Fill */}
            <path
              d={createGradientPath(chartData)}
              fill="url(#chartGradient)"
            />
            
            {/* Chart Line */}
            <path
              d={createSVGPath(chartData)}
              stroke="#4A90E2"
              strokeWidth="2"
              fill="none"
              style={{ filter: 'drop-shadow(0 0 4px #4A90E2)' }}
            />
          </svg>
        )}
        
        {/* Time Labels */}
        <div className="absolute bottom-4 left-6 right-6 flex justify-between text-xs text-[#808080]">
          <span>11 PM</span>
          <span>2 AM</span>
          <span>5 AM</span>
          <span>8 AM</span>
          <span>11 AM</span>
          <span>2 PM</span>
          <span>5 PM</span>
          <span>8 PM</span>
        </div>
      </div>
    </div>
  );
} 