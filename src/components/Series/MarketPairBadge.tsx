'use client';

import React from 'react';

export default function MarketPairBadge({ text = 'Rollover Window Active', className }: { text?: string; className?: string }) {
  return (
    <div className={`flex items-center gap-1 text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded ${className || ''}`}>
      <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
      <span>{text}</span>
    </div>
  );
}


