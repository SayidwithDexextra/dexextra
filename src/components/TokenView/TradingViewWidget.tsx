'use client';

import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    TradingView: {
      widget: new (config: Record<string, unknown>) => void;
    };
  }
}

interface TradingViewWidgetProps {
  symbol?: string;
  width?: string | number;
  height?: string | number;
  theme?: 'light' | 'dark';
  style?: string;
  locale?: string;
  toolbar_bg?: string;
  enable_publishing?: boolean;
  allow_symbol_change?: boolean;
  container_id?: string;
}

export default function TradingViewWidget({
  symbol = 'BTCUSD',
  width = '100%',
  height = 500, // Default desktop height
  theme = 'dark',
  style = '1',
  locale = 'en',
  toolbar_bg = '#0d0d0d',
  enable_publishing = false,
  allow_symbol_change = true,
  container_id = 'tradingview_widget'
}: TradingViewWidgetProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    
    script.innerHTML = JSON.stringify({
      autosize: false,
      symbol: symbol,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: theme,
      style: style,
      locale: locale,
      toolbar_bg: toolbar_bg,
      enable_publishing: enable_publishing,
      allow_symbol_change: allow_symbol_change,
      calendar: false,
      support_host: 'https://www.tradingview.com',
      width: width,
      height: height,
      container_id: container_id,
      backgroundColor: '#0d0d0d'
    });

    const currentContainer = container.current;
    if (currentContainer) {
      currentContainer.innerHTML = '';
      currentContainer.appendChild(script);
    }

    return () => {
      if (currentContainer) {
        currentContainer.innerHTML = '';
      }
    };
  }, [symbol, width, height, theme, style, locale, toolbar_bg, enable_publishing, allow_symbol_change, container_id]);

  return (
    <div className="mb-1">
      {/* Widget Controls - minimal spacing */}
      <div className="flex items-center justify-between mb-1">
 
      </div>
      
      {/* Chart Container - edge-to-edge, responsive height */}
      <div 
        ref={container}
        className="tradingview-widget-container rounded-md overflow-hidden bg-[#0d0d0d] h-[400px] md:h-[500px]"
      >
        <div 
          className="tradingview-widget-container__widget w-full h-full"
          id={container_id}
        />
      </div>
    </div>
  );
}

