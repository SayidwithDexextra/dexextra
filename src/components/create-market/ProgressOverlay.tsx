'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

type ProgressOverlayProps = {
  messages: string[];
  activeIndex: number; // which message to show (0-based)
  percentComplete?: number; // 0..100
  visible: boolean;
  isFadingOut?: boolean;
  title?: string;
  subtitle?: string;
};

export const ProgressOverlay: React.FC<ProgressOverlayProps> = ({
  messages,
  activeIndex,
  percentComplete = 0,
  visible,
  isFadingOut = false,
  title = 'System Initialization',
  subtitle = 'Smart contract deployment pipeline',
}) => {
  const clampedIndex = Math.max(0, Math.min(activeIndex, Math.max(messages.length - 1, 0)));
  const [containerHeight, setContainerHeight] = useState<number>(24); // fallback row height in px (approx 1.5rem)
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      if (rect.height > 0) setContainerHeight(rect.height);
    }
  }, [messages]);

  const progressWidth = useMemo(() => {
    return `${Math.max(0, Math.min(100, percentComplete))}%`;
  }, [percentComplete]);

  if (!visible) return null;

  return (
    <div className={`fixed inset-0 z-50 transition-opacity duration-300 ${isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[#0F0F0F]" />

      {/* Centered Card */}
      <div className="relative w-full h-full flex items-center justify-center px-4">
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide truncate">{title}</div>
                <div className="text-[9px] text-[#606060] truncate">{subtitle}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                <div className="h-full bg-blue-400 transition-all duration-300" style={{ width: progressWidth }} />
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            </div>
          </div>

          <div className="h-px bg-gradient-to-r from-blue-500/40 via-transparent to-transparent" />

          {/* Carousel */}
          <div className="p-4">
            {/* Visible window */}
            <div className="overflow-hidden" style={{ height: containerHeight }}>
              {/* Stack */}
              <div
                className="flex flex-col transition-transform duration-300 ease-out"
                style={{ transform: `translateY(-${clampedIndex * containerHeight}px)` }}
              >
                {messages.map((msg, idx) => (
                  <div
                    // Measure the first row for height
                    ref={idx === 0 ? rowRef : undefined}
                    key={`${idx}-${msg}`}
                    className="flex items-center justify-between min-h-[1.5rem]"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${idx <= clampedIndex ? 'bg-blue-400' : 'bg-[#404040]'}`} />
                      <span className="text-[11px] text-white truncate">{msg}</span>
                    </div>
                    <span className={`text-[9px] ${idx < clampedIndex ? 'text-green-400' : idx === clampedIndex ? 'text-blue-400' : 'text-[#606060]'}`}>
                      {idx < clampedIndex ? 'Done' : idx === clampedIndex ? 'In Progress' : 'Pending'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Expandable detail (subtle) */}
            <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
              <div className="px-0 pt-2 border-t border-[#1A1A1A]">
                <div className="text-[9px]">
                  <span className="text-[#606060]">Deployment actions executing securely on backend...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};






