'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface TooltipProps {
  /** The element that triggers the tooltip */
  children: React.ReactElement;
  /** Main content of the tooltip */
  content: React.ReactNode;
  /** Optional title displayed at the top */
  title?: string;
  /** Delay before showing tooltip (ms) */
  delay?: number;
  /** Max width of the tooltip */
  maxWidth?: number;
  /** Whether tooltip is disabled */
  disabled?: boolean;
  /** Additional className for the tooltip container */
  className?: string;
}

export function Tooltip({
  children,
  content,
  title,
  delay = 150,
  maxWidth = 240,
  disabled = false,
  className = '',
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isMounted, setIsMounted] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  }, []);

  const showTooltip = useCallback(() => {
    if (disabled) return;
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  }, [delay, disabled]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Calculate position to keep tooltip in viewport
  const getTooltipStyle = () => {
    const offsetX = 10; // Horizontal distance from cursor
    const offsetY = 90; // Vertical offset above cursor
    let x = mousePos.x + offsetX;
    let y = mousePos.y - offsetY; // Above the cursor

    // Keep within viewport
    const padding = 8;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

    // If tooltip would overflow right, show on left of cursor
    if (x + maxWidth > viewportWidth - padding) {
      x = mousePos.x - maxWidth - offsetX;
    }

    // Keep within vertical bounds
    if (y < padding) y = padding;
    if (y + 60 > viewportHeight - padding) {
      y = viewportHeight - 60 - padding;
    }

    return { left: x, top: y };
  };

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onMouseMove={handleMouseMove}
        className="inline-block"
      >
        {children}
      </div>

      {isMounted &&
        isVisible &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            className={`pointer-events-none ${className}`}
            style={{
              position: 'fixed',
              zIndex: 10_000,
              ...getTooltipStyle(),
              maxWidth,
            }}
          >
            <div className="bg-[#0F0F0F] border border-[#222222] rounded-md px-2.5 py-1.5 shadow-xl">
              {/* Content */}
              {title && (
                <div className="text-[10px] font-medium text-white mb-0.5">{title}</div>
              )}
              <div className="text-[9px] text-[#808080] leading-snug">{content}</div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/** Pre-styled tooltip for data source info */
export interface DataSourceTooltipContent {
  name: string;
  description: string;
  reliability: string;
  updateFrequency: string;
  dataType: string;
}

export function DataSourceTooltip({
  children,
  data,
  ...props
}: Omit<TooltipProps, 'content' | 'title'> & { data: DataSourceTooltipContent }) {
  return (
    <Tooltip
      {...props}
      title={data.name}
      maxWidth={420}
      delay={150}
      content={
        <div className="space-y-1">
          <p className="text-[#808080] text-[9px] leading-snug">{data.description}</p>
          <div className="flex items-center gap-4 pt-1 border-t border-[#1A1A1A] text-[9px]">
            <div className="flex items-center gap-1">
              <span className="text-[#606060]">Reliability:</span>
              <span className="text-white">{data.reliability}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[#606060]">Updates:</span>
              <span className="text-white">{data.updateFrequency}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[#606060]">Type:</span>
              <span className="text-white">{data.dataType}</span>
            </div>
          </div>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

export default Tooltip;
