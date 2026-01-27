'use client';

import React, { useEffect, useState, useRef } from 'react';

type MarketExample = {
  icon: string;
  title: string;
  description: string;
};

const marketExamples: MarketExample[] = [
  { icon: '₿', title: 'Bitcoin Futures', description: 'Trade BTC volatility' },
  { icon: '⚡', title: 'Energy Markets', description: 'Renewable energy credits' },
  { icon: '🌾', title: 'Grain Commodities', description: 'Agricultural futures' },
  { icon: '💎', title: 'Precious Metals', description: 'Gold & silver derivatives' },
  { icon: '🛢️', title: 'Oil & Gas', description: 'Energy commodity trading' },
  { icon: '📈', title: 'S&P 500 Index', description: 'Equity index futures' },
  { icon: '🏠', title: 'Real Estate', description: 'Property index derivatives' },
  { icon: '💹', title: 'FX Markets', description: 'Currency pair futures' },
];

export function MarketExamplesCarousel() {
  const [offset, setOffset] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const animationRef = useRef<number | undefined>(undefined);

  // Wait for client-side mount to prevent hydration mismatch
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    let lastTime = Date.now();
    const speed = 0.0003; // Items per millisecond

    const animate = () => {
      const now = Date.now();
      const delta = now - lastTime;
      lastTime = now;

      setOffset((prev) => {
        const newOffset = prev + speed * delta;
        // Keep offset in reasonable bounds to prevent float precision issues
        return newOffset % marketExamples.length;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isMounted]);

  // Generate items continuously for smooth scrolling - narrow view (3 visible)
  const getVisibleItems = () => {
    const items = [];
    const startIndex = Math.floor(offset) - 2;
    
    for (let i = 0; i < 5; i++) {
      const absolutePosition = startIndex + i;
      const index = ((absolutePosition % marketExamples.length) + marketExamples.length) % marketExamples.length;
      items.push({ 
        ...marketExamples[index], 
        absolutePosition,
        key: `${index}-${Math.floor(absolutePosition / marketExamples.length)}`
      });
    }
    return items;
  };

  const visibleItems = getVisibleItems();

  // Don't render animated content until mounted to prevent hydration mismatch
  if (!isMounted) {
    return <div className="relative mx-auto mt-12 h-32 w-full max-w-2xl sm:mt-16 sm:h-40 lg:mt-20" />;
  }

  return (
    <div className="relative mx-auto mt-12 h-32 w-full max-w-2xl overflow-hidden sm:mt-16 sm:h-40 lg:mt-20">
      <div className="absolute inset-0 flex items-center justify-center">
        {visibleItems.map((item) => {
          // Calculate smooth fractional position relative to current offset
          const fractionalPosition = item.absolutePosition - offset;
          const absPos = Math.abs(fractionalPosition);
          
          // Skip items that are too far from center - narrower view
          if (absPos > 1.5) return null;
          
          // Calculate parabolic curve with tighter spacing
          const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
          const horizontalOffset = fractionalPosition * (isMobile ? 100 : 140); // Tighter horizontal spacing
          const verticalOffset = absPos * (isMobile ? 20 : 30); // Reduced arc height
          const scale = Math.max(0.7, 1 - absPos * 0.25); // More aggressive scaling
          const opacity = Math.max(0, 1 - absPos * 0.5); // Faster fade
          const blur = Math.min(4, absPos * 3); // More blur on sides
          
          // Determine if this is the center item (within 0.3 of center)
          const isCenter = absPos < 0.3;

          return (
            <div
              key={item.key}
              className="absolute"
              style={{
                transform: `translateX(${horizontalOffset}px) translateY(${verticalOffset}px) scale(${scale})`,
                opacity: opacity,
                filter: `blur(${blur}px)`,
                zIndex: isCenter ? 10 : Math.max(0, 5 - Math.floor(absPos)),
                transition: 'none',
              }}
            >
              <div className="flex flex-col items-center">
                {/* Icon container */}
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-xl border transition-all duration-300 sm:h-16 sm:w-16 sm:rounded-2xl ${
                    isCenter
                      ? 'border-blue-500/40 bg-blue-500/10 shadow-lg shadow-blue-500/20'
                      : 'border-white/10 bg-white/5'
                  }`}
                >
                  <span className="text-2xl sm:text-3xl">{item.icon}</span>
                </div>

                {/* Text */}
                <div className="mt-2 text-center sm:mt-3">
                  <div
                    className={`text-xs font-medium transition-colors duration-300 sm:text-sm ${
                      isCenter ? 'text-white' : 'text-white/60'
                    }`}
                  >
                    {item.title}
                  </div>
                  <div className="mt-0.5 text-[10px] text-white/40 sm:text-xs">{item.description}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Gradient fade edges - narrower for compact view */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#1a1a1a] to-transparent sm:w-48" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#1a1a1a] to-transparent sm:w-48" />
    </div>
  );
}
