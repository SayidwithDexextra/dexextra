// COMMENTED OUT - Using LightweightChart instead
// This component has been replaced with LightweightChart for better performance
// and direct integration with our backend data

import React from 'react';

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

// Placeholder component to maintain compatibility
export default function TradingViewWidget(props: TradingViewWidgetProps) {
  return (
    <div className="p-4 bg-gray-900 rounded border border-gray-700 text-center text-gray-400">
      <div className="text-lg mb-2">📈 TradingView Widget</div>
      <div className="text-sm">This component has been replaced with LightweightChart</div>
      <div className="text-xs mt-2 text-gray-500">
        Using real-time data integration instead
      </div>
    </div>
  );
}

/*
// ORIGINAL TRADINGVIEW WIDGET CODE - COMMENTED OUT
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
  height = 500,
  theme = 'dark',
  style = '1',
  locale = 'en',
  toolbar_bg = '#000000',
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
      interval: '15',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: locale,
      toolbar_bg: '#000000',
      enable_publishing: false,
      allow_symbol_change: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
      width: width,
      height: height,
      container_id: container_id,
      backgroundColor: '#000000',
      gridColor: '#1a1a1a',
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      hide_volume: false,
      studies: [
        'Volume@tv-basicstudies'
      ],
      overrides: {
        "paneProperties.background": "#000000",
        "paneProperties.vertGridProperties.color": "#1a1a1a",
        "paneProperties.horzGridProperties.color": "#1a1a1a",
        "symbolWatermarkProperties.transparency": 90,
        "scalesProperties.textColor": "#AAA",
        "scalesProperties.backgroundColor": "#000000",
        "mainSeriesProperties.candleStyle.upColor": "#00D084",
        "mainSeriesProperties.candleStyle.downColor": "#FF4747",
        "mainSeriesProperties.candleStyle.borderUpColor": "#00D084",
        "mainSeriesProperties.candleStyle.borderDownColor": "#FF4747",
        "mainSeriesProperties.candleStyle.wickUpColor": "#00D084",
        "mainSeriesProperties.candleStyle.wickDownColor": "#FF4747",
        "volumePaneSize": "medium"
      }
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
      <div className="flex items-center justify-between mb-1">
 
      </div>
      
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
*/

