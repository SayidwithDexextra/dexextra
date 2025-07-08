'use client';

import React from 'react';

interface MiniChartProps {
  data: number[];
  color: string;
  width: number;
  height: number;
}

const MiniChart: React.FC<MiniChartProps> = ({ data, color, width, height }) => {
  if (!data || data.length === 0) return null;

  // Calculate SVG path
  const maxValue = Math.max(...data);
  const minValue = Math.min(...data);
  const range = maxValue - minValue || 1;
  
  const stepX = width / (data.length - 1);
  
  const pathData = data
    .map((value, index) => {
      const x = index * stepX;
      const y = height - ((value - minValue) / range) * height;
      return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    })
    .join(' ');

  return (
    <div className="flex items-center">
      <svg width={width} height={height} className="overflow-visible">
        <path
          d={pathData}
          stroke={color}
          strokeWidth="2"
          fill="none"
          className="drop-shadow-sm"
        />
      </svg>
    </div>
  );
};

export default MiniChart; 