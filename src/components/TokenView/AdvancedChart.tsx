'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';

// TradingView Advanced Charts types
declare global {
  interface Window {
    TradingView: {
      widget: new (config: TradingViewWidgetOptions) => ITradingViewWidget;
      Datafeed: any;
    };
  }
}

interface TradingViewWidgetOptions {
  symbol: string;
  datafeed: any;
  interval: string;
  container: string | HTMLElement;
  library_path: string;
  locale: string;
  disabled_features?: string[];
  enabled_features?: string[];
  charts_storage_url?: string;
  charts_storage_api_version?: string;
  client_id?: string;
  user_id?: string;
  fullscreen?: boolean;
  autosize?: boolean;
  studies_overrides?: Record<string, any>;
  overrides?: Record<string, any>;
  theme?: 'light' | 'dark';
  custom_css_url?: string;
  loading_screen?: { backgroundColor: string; foregroundColor: string; };
  trading_platform?: boolean;
  width?: number;
  height?: number;
  toolbar_bg?: string;
  study_count_limit?: number;
  drawings_access?: { type: string; tools: any[] };
  saved_data?: any;
  custom_formatters?: any;
  numeric_formatting?: any;
  customFormatters?: any;
}

interface ITradingViewWidget {
  onChartReady(callback: () => void): void;
  remove(): void;
  chart(): any;
  setSymbol(symbol: string, interval: string, callback?: () => void): void;
  setLanguage(language: string): void;
  setTheme(theme: 'light' | 'dark'): void;
  activeChart(): any;
}

interface AdvancedChartProps {
  symbol: string;
  interval?: string;
  theme?: 'light' | 'dark';
  height?: number;
  width?: number;
  autosize?: boolean;
  locale?: string;
  timezone?: string;
  onSymbolChange?: (symbol: string) => void;
  onIntervalChange?: (interval: string) => void;
  allowSymbolChange?: boolean;
  hideTopToolbar?: boolean;
  hideSideToolbar?: boolean;
  hideVolumePanel?: boolean;
  customCSS?: string;
  studies?: string[];
  drawingsAccess?: boolean;
  savingEnabled?: boolean;
  className?: string;
}

// TradingView Datafeed implementation
class TradingViewDatafeed {
  private baseUrl: string;
  private supportedResolutions: string[];
  private config: any;

  constructor(baseUrl: string = '/api/tradingview') {
    this.baseUrl = baseUrl;
    this.supportedResolutions = ['1S', '1', '5', '15', '30', '60', '240', '1D', '1W', '1M'];
    this.config = null;
  }

  // Required datafeed methods
  onReady(callback: (config: any) => void) {
    console.log('[Datafeed] onReady called');
    
    setTimeout(() => {
      const config = {
        supported_resolutions: this.supportedResolutions,
        supports_group_request: false,
        supports_marks: true,
        supports_search: true,
        supports_time: true,
        exchanges: [
          {
            value: 'VAMM',
            name: 'vAMM Markets',
            desc: 'Virtual Automated Market Maker'
          }
        ],
        symbols_types: [
          {
            name: 'crypto',
            value: 'crypto'
          }
        ],
        supports_timescale_marks: false
      };
      
      this.config = config;
      callback(config);
    }, 0);
  }

  searchSymbols(userInput: string, exchange: string, symbolType: string, onResult: (symbols: any[]) => void) {
    console.log('[Datafeed] searchSymbols called', { userInput, exchange, symbolType });
    
    fetch(`${this.baseUrl}/search?query=${encodeURIComponent(userInput)}&limit=10`)
      .then(response => response.json())
      .then((data: any) => {
        const symbols = (data.symbols || []).map((item: any) => ({
          symbol: item.symbol,
          full_name: item.full_name || `VAMM:${item.symbol}`,
          description: item.description || item.name || item.symbol,
          exchange: item.exchange || 'VAMM',
          ticker: item.ticker || item.symbol,
          type: item.type || 'crypto'
        }));
        
        onResult(symbols);
      })
      .catch(error => {
        console.error('[Datafeed] Search error:', error);
        onResult([]);
      });
  }

  resolveSymbol(symbolName: string, onResolve: (symbolInfo: any) => void, onError: (error: string) => void) {
    // console.log('[Datafeed] resolveSymbol called', symbolName);
    
    const [exchange, symbol] = symbolName.includes(':') ? symbolName.split(':') : ['VAMM', symbolName];
    
    fetch(`${this.baseUrl}/symbols?symbol=${encodeURIComponent(symbol)}`)
      .then(response => response.json())
      .then((data: any) => {
        if (data.error) {
          onError(data.error);
          return;
        }

        const symbolInfo = {
          ticker: data.ticker || symbol,
          name: data.name || symbol,
          description: data.description || `${symbol} Market`,
          type: data.type || 'crypto',
          session: data.session || '24x7',
          timezone: data.timezone || 'Etc/UTC',
          exchange: data.exchange || exchange,
          minmov: data.minmov || 1,
          pricescale: data.pricescale || 1000000,
          has_intraday: data.has_intraday !== false,
          has_no_volume: data.has_no_volume === true,
          has_weekly_and_monthly: data.has_weekly_and_monthly !== false,
          supported_resolutions: data.supported_resolutions || this.supportedResolutions,
          volume_precision: data.volume_precision || 8,
          data_status: 'streaming'
        };

        // console.log('[Datafeed] Symbol resolved:', symbolInfo);
        onResolve(symbolInfo);
      })
      .catch(error => {
        console.error('[Datafeed] Resolve error:', error);
        onError(`Failed to resolve symbol: ${error.message}`);
      });
  }

  getBars(symbolInfo: any, resolution: string, periodParams: any, onResult: (bars: any[], meta?: any) => void, onError: (error: string) => void) {
    console.log('[Datafeed] getBars called', { 
      symbol: symbolInfo.ticker, 
      resolution, 
      from: periodParams.from, 
      to: periodParams.to,
      firstDataRequest: periodParams.firstDataRequest 
    });

    const { from, to, firstDataRequest } = periodParams;
    const symbol = symbolInfo.ticker || symbolInfo.name;

    fetch(`${this.baseUrl}/history?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}`)
      .then(response => response.json())
      .then((data: any) => {
        if (data.s === 'no_data') {
          onResult([], { noData: true });
          return;
        }

        if (data.s !== 'ok') {
          onError(data.s || 'Unknown error');
          return;
        }

        const bars = [];
        for (let i = 0; i < (data.t || []).length; i++) {
          bars.push({
            time: data.t[i] * 1000, // Convert to milliseconds
            low: parseFloat(data.l[i]),
            high: parseFloat(data.h[i]),
            open: parseFloat(data.o[i]),
            close: parseFloat(data.c[i]),
            volume: parseFloat(data.v?.[i] || 0)
          });
        }

        console.log('[Datafeed] Bars received:', bars.length);
        onResult(bars, { noData: bars.length === 0 });
      })
      .catch(error => {
        console.error('[Datafeed] getBars error:', error);
        onError(`Failed to get bars: ${error.message}`);
      });
  }

  subscribeBars(symbolInfo: any, resolution: string, onTick: (bar: any) => void, listenerGuid: string, onResetCacheNeededCallback: () => void) {
    console.log('[Datafeed] subscribeBars called', { 
      symbol: symbolInfo.ticker, 
      resolution, 
      listenerGuid 
    });

    // Implement real-time subscription using Pusher or WebSocket
    this.subscribeToRealtimeData(symbolInfo.ticker, resolution, onTick);
  }

  unsubscribeBars(listenerGuid: string) {
    console.log('[Datafeed] unsubscribeBars called', listenerGuid);
    // Implement unsubscription logic
  }

  private subscribeToRealtimeData(symbol: string, resolution: string, onTick: (bar: any) => void) {
    // Use Pusher for real-time updates as specified in the design document
    if (typeof window !== 'undefined' && (window as any).Pusher) {
      const pusher = new (window as any).Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY, {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
        enabledTransports: ['ws', 'wss']
      });

      const channel = pusher.subscribe(`market-${symbol}`);
      
      channel.bind('price-update', (data: any) => {
        const bar = {
          time: data.timestamp * 1000,
          open: parseFloat(data.open),
          high: parseFloat(data.high),
          low: parseFloat(data.low),
          close: parseFloat(data.close),
          volume: parseFloat(data.volume || 0)
        };
        
        onTick(bar);
      });

      // Store channel reference for cleanup
      (this as any)[`channel_${symbol}`] = channel;
    }
  }
}

const AdvancedChart: React.FC<AdvancedChartProps> = ({
  symbol,
  interval = '15',
  theme = 'dark',
  height = 600,
  width,
  autosize = true,
  locale = 'en',
  timezone = 'Etc/UTC',
  onSymbolChange,
  onIntervalChange,
  allowSymbolChange = true,
  hideTopToolbar = false,
  hideSideToolbar = false,
  hideVolumePanel = false,
  studies = [],
  drawingsAccess = true,
  savingEnabled = false,
  className = ''
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<ITradingViewWidget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [loadingStartTime] = useState(Date.now());

  // Global timeout to prevent infinite loading
  useEffect(() => {
    const globalTimeout = setTimeout(() => {
      if (isLoading) {
        console.error('Global timeout reached - forcing error state');
        setError('Chart loading timed out. TradingView library may not be available.');
        setIsLoading(false);
      }
    }, 8000); // 8 second global timeout

    return () => clearTimeout(globalTimeout);
  }, [isLoading]);

  // Load TradingView library script
  useEffect(() => {
    const loadTradingViewScript = () => {
      // Check if window is available (client-side)
      if (typeof window === 'undefined') {
        console.log('Server-side rendering - skipping TradingView load');
        return;
      }

      // Check if TradingView is already loaded
      if ((window as any).TradingView) {
        console.log('TradingView already loaded');
        setScriptLoaded(true);
        return;
      }

      console.log('Loading TradingView script...');
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      
      let timeoutId: NodeJS.Timeout;
      
      script.onload = () => {
        clearTimeout(timeoutId);
        console.log('TradingView script loaded successfully');
        
        // Double-check that TradingView object is available
        if ((window as any).TradingView) {
          setScriptLoaded(true);
          setError(null);
        } else {
          console.error('TradingView script loaded but object not available');
          setError('TradingView library not properly initialized');
        }
      };
      
      script.onerror = (err) => {
        clearTimeout(timeoutId);
        console.error('Failed to load TradingView script:', err);
        setError('Failed to load charting library. Using fallback chart...');
        setIsLoading(false);
      };

      // Add timeout for script loading
      timeoutId = setTimeout(() => {
        console.error('TradingView script loading timed out');
        setError('TradingView library unavailable. The charting library may not be properly installed.');
        setIsLoading(false);
      }, 5000); // 5 second timeout

      document.head.appendChild(script);

      return () => {
        clearTimeout(timeoutId);
        if (document.head.contains(script)) {
          document.head.removeChild(script);
        }
      };
    };

    // Add a small delay to ensure DOM is ready
    const timer = setTimeout(loadTradingViewScript, 100);
    
    return () => clearTimeout(timer);
  }, []);

  // Initialize TradingView widget
  useEffect(() => {
    if (!scriptLoaded || !containerRef.current) {
      return;
    }

    // Check if TradingView is available
    if (typeof window === 'undefined' || !(window as any).TradingView) {
      console.error('TradingView not available');
      setError('TradingView library not loaded');
      setIsLoading(false);
      return;
    }

    const initializeWidget = () => {
      try {
        console.log('Initializing TradingView widget...');
        
        // Clean up existing widget
        if (widgetRef.current) {
          try {
            widgetRef.current.remove();
          } catch (err) {
            console.warn('Error removing previous widget:', err);
          }
        }

        const datafeed = new TradingViewDatafeed();

        const widgetOptions: TradingViewWidgetOptions = {
          symbol: symbol,
          datafeed: datafeed,
          interval: interval,
          container: containerRef.current!,
          library_path: '/charting_library/',
          locale: locale,
          disabled_features: [
            ...(hideTopToolbar ? ['header_widget'] : []),
            ...(hideSideToolbar ? ['left_toolbar'] : []),
            ...(hideVolumePanel ? ['volume_force_overlay'] : []),
            ...(!savingEnabled ? ['study_templates', 'save_chart_properties_to_local_storage'] : []),
            ...(!allowSymbolChange ? ['header_symbol_search'] : []),
            'use_localstorage_for_settings',
            'right_bar_stays_on_scroll',
            'symbol_info',
            'timeframes_toolbar'
          ],
          enabled_features: [
            'study_templates',
            'side_toolbar_in_fullscreen_mode',
            'header_in_fullscreen_mode',
            'remove_library_container_border'
          ],
          fullscreen: false,
          autosize: autosize,
          width: width,
          height: height,
          theme: theme,
          custom_css_url: '/tradingview-custom.css',
          overrides: {
            // Dark theme customization
            'paneProperties.background': theme === 'dark' ? '#1a1a1a' : '#ffffff',
            'paneProperties.vertGridProperties.color': theme === 'dark' ? '#2a2a2a' : '#e1e1e1',
            'paneProperties.horzGridProperties.color': theme === 'dark' ? '#2a2a2a' : '#e1e1e1',
            'symbolWatermarkProperties.transparency': 90,
            'scalesProperties.textColor': theme === 'dark' ? '#d1d5db' : '#374151',
            'scalesProperties.backgroundColor': theme === 'dark' ? '#1a1a1a' : '#ffffff',
            
            // Candlestick colors
            'mainSeriesProperties.candleStyle.upColor': '#10b981',
            'mainSeriesProperties.candleStyle.downColor': '#ef4444',
            'mainSeriesProperties.candleStyle.borderUpColor': '#10b981',
            'mainSeriesProperties.candleStyle.borderDownColor': '#ef4444',
            'mainSeriesProperties.candleStyle.wickUpColor': '#10b981',
            'mainSeriesProperties.candleStyle.wickDownColor': '#ef4444',
            
            // Volume
            'volumePaneSize': 'medium',
            'scalesProperties.showSymbolLabels': true
          },
          studies_overrides: {
            'volume.volume.color.0': '#ef444450',
            'volume.volume.color.1': '#10b98150'
          },
          loading_screen: {
            backgroundColor: theme === 'dark' ? '#1a1a1a' : '#ffffff',
            foregroundColor: theme === 'dark' ? '#d1d5db' : '#374151'
          }
        };

        // Add error timeout
        const errorTimeout = setTimeout(() => {
          console.error('Widget initialization timed out');
          setError('Chart widget failed to initialize. Check console for details.');
          setIsLoading(false);
        }, 8000);

        widgetRef.current = new (window as any).TradingView.widget(widgetOptions);

        widgetRef.current.onChartReady(() => {
          clearTimeout(errorTimeout);
          // console.log('TradingView chart is ready');
          setIsLoading(false);
          setError(null);

          // Add default studies
          if (studies.length > 0) {
            try {
              const chart = widgetRef.current?.activeChart();
              studies.forEach(study => {
                chart?.createStudy(study);
              });
            } catch (err) {
              console.warn('Error adding studies:', err);
            }
          }

          // Set up symbol change callback
          if (onSymbolChange) {
            try {
              const chart = widgetRef.current?.activeChart();
              chart?.onSymbolChanged().subscribe(null, (symbolData: any) => {
                onSymbolChange(symbolData.ticker);
              });
            } catch (err) {
              console.warn('Error setting up symbol change callback:', err);
            }
          }

          // Set up interval change callback
          if (onIntervalChange) {
            try {
              const chart = widgetRef.current?.activeChart();
              chart?.onIntervalChanged().subscribe(null, (interval: string) => {
                onIntervalChange(interval);
              });
            } catch (err) {
              console.warn('Error setting up interval change callback:', err);
            }
          }
        });

        return () => clearTimeout(errorTimeout);

      } catch (err) {
        console.error('Error initializing TradingView widget:', err);
        setError('Failed to initialize chart. Please check if TradingView library is available.');
        setIsLoading(false);
      }
    };

    const cleanup = initializeWidget();

    return () => {
      if (cleanup) cleanup();
      if (widgetRef.current) {
        try {
          widgetRef.current.remove();
        } catch (err) {
          console.error('Error removing widget:', err);
        }
        widgetRef.current = null;
      }
    };
  }, [scriptLoaded, symbol, interval, theme, height, width, autosize, locale]);

  // Loading state
  if (isLoading) {
    return (
      <div className={`flex items-center justify-center bg-gray-900 rounded-lg ${className}`} style={{ height: height }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          <p className="text-gray-400 mt-2">Loading Advanced Chart...</p>
        </div>
      </div>
    );
  }

  // Error state - Show fallback chart instead of just error
  if (error) {
    return (
      <div className={`bg-gray-900 rounded-lg border border-gray-700 overflow-hidden ${className}`} style={{ height: height }}>
        {/* Fallback Chart Header */}
        <div className="flex items-center justify-between p-3 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider">
              {symbol}/USD 
            </h3>
            <div className="text-yellow-400 text-xs">⚠️ Using Fallback Chart</div>
          </div>
          <div className="text-xs text-gray-500">
            TradingView Unavailable
          </div>
        </div>
        
        {/* Fallback Chart Body */}
        <div className="flex items-center justify-center bg-gray-800" style={{ height: height - 60 }}>
          <div className="text-center p-6">
            <div className="text-gray-400 text-lg mb-2">📊 Chart Loading Failed</div>
            <div className="text-gray-500 text-sm mb-4">{error}</div>
            <div className="text-blue-400 text-xs mb-4">
              This market is available for trading even without advanced charts
            </div>
            <button 
              onClick={() => {
                setError(null);
                setIsLoading(true);
                if (typeof window !== 'undefined') {
                  window.location.reload();
                }
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
            >
              Retry Advanced Chart
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`advanced-chart-container ${className}`} style={{ height: autosize ? '100%' : height }}>
      <div 
        ref={containerRef} 
        className="w-full h-full bg-gray-900 rounded-lg overflow-hidden"
        style={{ height: autosize ? '100%' : height }}
      />
    </div>
  );
};

export default AdvancedChart; 