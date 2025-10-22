'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { usePusher } from '@/lib/pusher-client';
import { ChartDataEvent } from '@/lib/pusher-server';

interface OHLCVData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades?: number;
}

interface LightweightChartProps {
  symbol: string;
  width?: string | number;
  height?: string | number;
  className?: string;
  defaultPrice?: number;
}

const timeframes = [
  { label: '1m', value: '1m', interval: 60 },
  { label: '5m', value: '5m', interval: 300 },
  { label: '15m', value: '15m', interval: 900 },
  { label: '30m', value: '30m', interval: 1800 },
  { label: '1h', value: '1h', interval: 3600 },
  { label: '4h', value: '4h', interval: 14400 },
  { label: '1d', value: '1d', interval: 86400 }
];

// Helper function to get timeframe in seconds
const getTimeframeSeconds = (timeframe: string): number => {
  const timeframeMap: Record<string, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
  };
  return timeframeMap[timeframe] || 3600;
};

export default function LightweightChart({ 
  symbol, 
  width = '100%', 
  height = 350, // Increased by 25% for optimal visibility
  className = '',
  defaultPrice = 100
}: LightweightChartProps) {
  // Temporary flag to disable all backend interactions (API + Pusher)
  const CHART_BACKEND_ENABLED = false;
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const areaSeriesRef = useRef<any>(null);
  const areaDataRef = useRef<Array<{ time: number; value: number }>>([]); // Keep full data in memory
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const lastPusherUpdateRef = useRef<number>(0);
  const isMountedRef = useRef(true);
  const [chartReady, setChartReady] = useState(true); // TEMPORARILY SET TO TRUE TO SKIP LOADING
  
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [hasData, setHasData] = useState(false);
  const [isPusherConnected, setIsPusherConnected] = useState(false);
  const [dataSource, setDataSource] = useState<'pusher' | 'polling' | 'cached'>('polling');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [legendData, setLegendData] = useState<{
    price: number;
    change: number;
    changePercent: number;
    time?: string;
  }>({
    price: 0, // Show zero initially when no orders
    change: 0,
    changePercent: 0,
  });

  const positiveColor = '#75bb75';
  const negativeColor = '#fb5c60';
  const positiveTopColor = 'rgba(117, 187, 117, 0.35)';
  const positiveBottomColor = 'rgba(117, 187, 117, 0.03)';
  const negativeTopColor = 'rgba(251, 92, 96, 0.35)';
  const negativeBottomColor = 'rgba(251, 92, 96, 0.03)';

  // Initialize Pusher
  const pusher = usePusher({ enableLogging: false });

  // Helper: push a live tick from TokenHeader event into the area series
  const applyLiveTick = useCallback((tickPrice: number, tickTimestamp: number) => {
    try {
      if (!areaSeriesRef.current) return;
      const timeframeSeconds = getTimeframeSeconds(selectedTimeframe);
      const alignedTime = Math.floor(Math.floor(tickTimestamp / 1000) / timeframeSeconds) * timeframeSeconds;

      const newPoint = { time: alignedTime, value: Math.max(0, Number(tickPrice) || 0) };
      const lastPoint = areaDataRef.current[areaDataRef.current.length - 1];

      if (!lastPoint) {
        areaDataRef.current = [newPoint];
        areaSeriesRef.current.setData([{ time: newPoint.time as Time, value: newPoint.value }]);
      } else {
        if (newPoint.time === lastPoint.time) {
          areaDataRef.current[areaDataRef.current.length - 1] = newPoint;
          areaSeriesRef.current.update({ time: newPoint.time as Time, value: newPoint.value });
        } else if (newPoint.time > lastPoint.time) {
          areaDataRef.current.push(newPoint);
          areaSeriesRef.current.update({ time: newPoint.time as Time, value: newPoint.value });
        } else {
          // stale tick, ignore
          return;
        }
      }

      // Update legend based on first vs current
      const firstValue = areaDataRef.current[0]?.value || 0;
      const changeValue = newPoint.value - firstValue;
      const changePercent = firstValue !== 0 ? (changeValue / firstValue) * 100 : 0;

      const isPositive = changeValue >= 0;
      areaSeriesRef.current.applyOptions({
        lineColor: isPositive ? positiveColor : negativeColor,
        topColor: isPositive ? positiveTopColor : negativeTopColor,
        bottomColor: isPositive ? positiveBottomColor : negativeBottomColor,
        crosshairMarkerBorderColor: isPositive ? positiveColor : negativeColor,
        crosshairMarkerBackgroundColor: isPositive ? positiveColor : negativeColor,
      });

      setLegendData({
        price: newPoint.value,
        change: changeValue,
        changePercent: isFinite(changePercent) ? changePercent : 0,
        time: new Date(newPoint.time * 1000).toLocaleTimeString(),
      });

      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
      setHasData(true);
      setDataSource('pusher');
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      // swallow errors to avoid UI spam
    }
  }, [selectedTimeframe]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Handle Pusher chart data updates
  const handleChartDataUpdate = useCallback((data: ChartDataEvent) => {
     console.log('🎯 handleChartDataUpdate called with data:', data);
     console.log('isMountedRef.current:', isMountedRef.current);
     console.log('areaSeriesRef.current:', areaSeriesRef.current);
     console.log('hasData before update:', hasData);

    if (!isMountedRef.current || !areaSeriesRef.current) {
       console.log('❌ Early return - component unmounted or series not ready');
      return;
    }

     console.log(`📈 Chart update received via Pusher for ${data.symbol} (${data.timeframe}):`, data);

    try {
      // Create the new data point with proper time alignment
      const timeframeSeconds = getTimeframeSeconds(selectedTimeframe);
      const alignedTime = Math.floor(Math.floor(data.timestamp / 1000) / timeframeSeconds) * timeframeSeconds;
      
      const newDataPoint = {
        time: alignedTime,
        value: data.close
      };

      console.log('📊 Creating new data point:', newDataPoint);

      // Check for duplicate or stale data
      const lastDataPoint = areaDataRef.current[areaDataRef.current.length - 1];
      if (lastDataPoint) {
        if (newDataPoint.time <= lastDataPoint.time) {
          console.log('⏭️ Duplicate or stale tick - ignoring');
          return;
        }
        
        // If this is an update to the same time period, replace the last point
        if (newDataPoint.time === lastDataPoint.time) {
          console.log('🔄 Updating existing data point');
          areaDataRef.current[areaDataRef.current.length - 1] = newDataPoint;
          areaSeriesRef.current.update({ time: newDataPoint.time as Time, value: newDataPoint.value });
          return;
        }
      }

      // Ensure minimum time gap between points to prevent overlapping
      if (lastDataPoint && (newDataPoint.time - lastDataPoint.time) < timeframeSeconds) {
        console.log('⏭️ Time gap too small - skipping to prevent overlap');
        return;
      }

      // If this is the first data point and we don't have data yet,
      // we need to set some initial data first
      if (!hasData) {
         console.log('🚀 First Pusher data point - initializing chart with baseline data');
        
        // Just set this single point and let API data fill in the history
        areaDataRef.current = [newDataPoint];
        areaSeriesRef.current.setData([{ time: newDataPoint.time as Time, value: newDataPoint.value }]);
        if (chartRef.current) {
          chartRef.current.timeScale().fitContent();
          // Don't scroll to real time since we're locking the viewport
          // chartRef.current.timeScale().scrollToRealTime();
        }
        setHasData(true);
      } else {
        // Append to in-memory data array (maintaining time order)
        areaDataRef.current.push(newDataPoint);
        
        // Sort data to ensure proper time order (shouldn't be needed but safety check)
        areaDataRef.current.sort((a, b) => a.time - b.time);
        
        // Remove duplicates based on time
        areaDataRef.current = areaDataRef.current.filter((point, index, arr) => 
          index === 0 || point.time !== arr[index - 1].time
        );
        
        // Update area series and legend data
        console.log('📈 Updating area series with new data point...');
        areaSeriesRef.current.update({ time: newDataPoint.time as Time, value: newDataPoint.value });
        
        // Update legend data when new data comes in
        const firstPoint = areaDataRef.current[0];
        const firstValue = firstPoint?.value || 0;
        const changeValue = newDataPoint.value - firstValue;
        const changePercent = firstValue !== 0 ? (changeValue / firstValue) * 100 : 0;
        
        const isPositive = changeValue >= 0;
        areaSeriesRef.current.applyOptions({
          lineColor: isPositive ? positiveColor : negativeColor,
          topColor: isPositive ? positiveTopColor : negativeTopColor,
          bottomColor: isPositive ? positiveBottomColor : negativeBottomColor,
          crosshairMarkerBorderColor: isPositive ? positiveColor : negativeColor,
          crosshairMarkerBackgroundColor: isPositive ? positiveColor : negativeColor,
        });

        setLegendData({
          price: newDataPoint.value,
          change: changeValue,
          changePercent: isFinite(changePercent) ? changePercent : 0,
          time: new Date(newDataPoint.time * 1000).toLocaleTimeString(),
        });

        // Keep only last 500 points to avoid memory bloat
        if (areaDataRef.current.length > 500) {
          areaDataRef.current = areaDataRef.current.slice(-500);
          // Re-set data to maintain chart integrity
          areaSeriesRef.current.setData(areaDataRef.current.map(point => ({ 
            time: point.time as Time, 
            value: point.value 
          })));
        }
      }

      // Ensure chart scrolls to latest
      if (chartRef.current) {
        // Don't scroll since we're locking the viewport
        // chartRef.current.timeScale().scrollToRealTime();
        chartRef.current.timeScale().fitContent();
      }

       console.log('✅ Area series updated successfully');
      
      lastPusherUpdateRef.current = Date.now();
      setLastUpdate(new Date());
      setDataSource('pusher');
      setError(null);

       console.log(`✅ Chart updated via Pusher: ${data.symbol} = $${data.close}`);
    } catch (err) {
      console.error('❌ Error updating chart with Pusher data:', err);
      console.error('Error details:', {
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        errorStack: err instanceof Error ? err.stack : 'No stack trace',
        data,
        areaSeriesRef: areaSeriesRef.current,
        hasData
      });
    }
  }, [hasData, selectedTimeframe]);

  // Handle Pusher connection state changes
  const handleConnectionStateChange = useCallback((state: string) => {
    const connected = state === 'connected';
    setIsPusherConnected(connected);

    if (!connected) {
       console.log(`🔴 Pusher disconnected for chart ${symbol}`);
    } else {
       console.log(`🟢 Pusher connected for chart ${symbol}`);
    }
  }, [symbol]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    try {
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: 'rgba(255, 255, 255, 0.5)',
        },
        width: (chartContainerRef.current as any).offsetWidth,
        height: typeof height === 'number' ? height : 350,
        grid: {
          vertLines: { color: 'rgb(22, 21, 26, 0.0)' },
          horzLines: { color: 'rgb(22, 21, 26, 0.0)' },
        },
        crosshair: {
          mode: 1,
          vertLine: {
            color: 'rgba(22, 21, 26, 0.0)',
            width: 1,
            style: 3,
            labelBackgroundColor: 'rgba(22, 21, 26, 0.0)',
          },
          horzLine: {
            color: 'rgba(22, 21, 26, 0.0)',
            width: 1,
            style: 3,
            labelBackgroundColor: 'rgba(22, 21, 26, 0.0)',
          },
        },
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: {
            top: 0.1,
            bottom: 0.1,
          },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
          // Lock horizontal scrolling
          rightOffset: 5,
          barSpacing: 12,
          fixLeftEdge: true,
          fixRightEdge: true,
          lockVisibleTimeRangeOnResize: true,
        },
        handleScroll: {
          // Disable horizontal scroll
          mouseWheel: false,
          pressedMouseMove: false,
          horzTouchDrag: false,
          vertTouchDrag: true,
        },
        handleScale: {
          // Disable horizontal scaling
          axisPressedMouseMove: {
            time: false,
            price: true,
          },
          mouseWheel: false,
          pinch: false,
        },
      });


      // Create area series with modern gradient
      const areaSeries = chart.addAreaSeries({
        lineColor: positiveColor,
        topColor: positiveTopColor,
        bottomColor: positiveBottomColor,
        lineWidth: 3,
        priceFormat: {
          type: 'price',
          precision: 2,
        },
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: positiveColor,
        crosshairMarkerBackgroundColor: positiveColor,
      });

      chartRef.current = chart;
      areaSeriesRef.current = areaSeries;
      
            // Add crosshair move handler for legend updates
      chart.subscribeCrosshairMove((param: any) => {
        if (!param || !param.time || !param.seriesData || !areaSeriesRef.current) {
          // Reset to latest data when crosshair is removed
          if (areaDataRef.current.length > 0) {
            const latestPoint = areaDataRef.current[areaDataRef.current.length - 1];
            const firstPoint = areaDataRef.current[0];
            const firstValue = firstPoint?.value || 0;
            const changeValue = latestPoint.value - firstValue;
            const changePercent = firstValue !== 0 ? (changeValue / firstValue) * 100 : 0;
            
            setLegendData({
              price: latestPoint.value,
              change: changeValue,
              changePercent: isFinite(changePercent) ? changePercent : 0,
              time: new Date(latestPoint.time * 1000).toLocaleTimeString(),
            });
          }
          return;
        }
        
        try {
          const data = param.seriesData.get(areaSeriesRef.current);
          if (!data || typeof data !== 'object' || !('value' in data)) {
            return;
          }
          
          // Get the first data point for change calculation
          const firstPoint = areaDataRef.current[0];
          const currentValue = (data as any).value as number;
          const firstValue = firstPoint?.value || 0;
          const changeValue = currentValue - firstValue;
          const changePercent = firstValue !== 0 ? (changeValue / firstValue) * 100 : 0;
          
          setLegendData({
            price: currentValue,
            change: changeValue,
            changePercent: isFinite(changePercent) ? changePercent : 0,
            time: typeof param.time === 'number' 
              ? new Date(param.time * 1000).toLocaleTimeString() 
              : typeof param.time === 'string'
              ? param.time
              : 'N/A',
          });
        } catch (error) {
          console.error('Error updating legend from crosshair:', error);
        }
      });

      // Mark chart as ready after a short delay
      setTimeout(() => setChartReady(true), 100);

      // Handle resize
      const handleResize = () => {
        if (chartContainerRef.current && chart) {
          chart.applyOptions({ 
            width: (chartContainerRef.current as any).offsetWidth,
            height: typeof height === 'number' ? height : 350
          });
        }
      };

      if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
        (globalThis as any).window.addEventListener('resize', handleResize);
      }

      return () => {
        if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
          (globalThis as any).window.removeEventListener('resize', handleResize);
        }
        chart.remove();
      };
    } catch (err) {
      console.error('Error initializing chart:', err);
      setError('Failed to initialize chart');
    }
  }, [height]);

  // Set up Pusher subscription for real-time chart updates
  useEffect(() => {
    if (!CHART_BACKEND_ENABLED) return;
    if (!pusher || !symbol) return;

     // console.log(`🚀 Setting up Pusher chart subscription for ${symbol}-${selectedTimeframe}`);
     // console.log('Pusher instance:', pusher);
     // console.log('Symbol:', symbol);
     // console.log('Timeframe:', selectedTimeframe);

    // Subscribe to chart data updates
    const unsubscribeChart = pusher.subscribeToChartData(
      symbol,
      selectedTimeframe,
      handleChartDataUpdate
    );

     // console.log('🚀 Pusher chart subscription setup complete');
     // console.log('Unsubscribe function:', unsubscribeChart);

    // Test that the handler function is working
     // console.log('Testing handler function...');
     // console.log('Handler function:', handleChartDataUpdate);

    // Subscribe to connection state changes
    const unsubscribeConnection = pusher.onConnectionStateChange(
      handleConnectionStateChange
    );

     // console.log('🔌 Connection state handler setup complete');

    // Store unsubscribe functions
    unsubscribeRef.current = () => {
       // console.log('🧹 Cleaning up Pusher subscriptions');
      unsubscribeChart();
      unsubscribeConnection();
    };

    // Cleanup on unmount or dependency change
    return () => {
       // console.log('🧹 Chart component cleanup triggered');
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [pusher, symbol, selectedTimeframe, handleChartDataUpdate, handleConnectionStateChange]);

  // Subscribe to mark price events emitted from TokenHeader
  useEffect(() => {
    const handler = (event: Event) => {
      const { detail } = event as CustomEvent<{ symbol: string; price: number; timestamp: number }>;
      if (!detail) return;
      if (detail.symbol !== symbol) return; // only process current symbol
      applyLiveTick(detail.price, detail.timestamp);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('marketMarkPrice', handler as EventListener);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('marketMarkPrice', handler as EventListener);
      }
    };
  }, [symbol, applyLiveTick]);

  // Fetch and update chart data with animation
  const fetchChartData = async (timeframe: string, animate: boolean = false) => {
    if (!CHART_BACKEND_ENABLED) {
      setIsLoading(false);
      setError(null);
      setHasData(false);
      return;
    }
    if (!symbol) return;
    
    // Check if we've received recent Pusher updates
    const timeSinceLastPusherUpdate = Date.now() - lastPusherUpdateRef.current;
    if (lastPusherUpdateRef.current > 0 && timeSinceLastPusherUpdate < 60000) {
       console.log(`🛑 Skipping fetchChartData - recent Pusher update (${Math.round(timeSinceLastPusherUpdate/1000)}s ago)`);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    // Start transition animation if requested
    if (animate && areaSeriesRef.current && hasData) {
      setIsTransitioning(true);
    }

    try {
       console.log(`📊 Fetching ${symbol} area chart data for ${timeframe} timeframe...`);
      
      // Fetch OHLCV data from optimized backend with dynamic aggregation
      const response = await fetch(
        `/api/charts/ohlcv?symbol=${symbol}&timeframe=${timeframe}&limit=300`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch chart data: ${response.status}`);
      }

      const result: any = await response.json();
      
      let areaData: Array<{ time: number; value: number }>;
      let hasRealData = false;

      if (!result.success || !result.data || result.data.length === 0) {
         console.log(`📊 No data available for ${symbol}, showing zero price (no orders)`);
        
        // Create minimal default data aligned to timeframe boundaries
        // Show zero when there are no orders in the market
        const now = Math.floor(Date.now() / 1000);
        const timeframeSeconds = getTimeframeSeconds(timeframe);
        const alignedNow = Math.floor(now / timeframeSeconds) * timeframeSeconds;
        
        areaData = [
          {
            time: alignedNow - timeframeSeconds * 2,
            value: 0
          },
          {
            time: alignedNow - timeframeSeconds,
            value: 0
          },
          {
            time: alignedNow,
            value: 0
          }
        ];
        
        hasRealData = false;
      } else {
         console.log(`✅ Loaded ${result.data.length} ${timeframe} candles for ${symbol} area chart (${result.meta?.architecture || 'unknown'} architecture)`);
         
        // Transform optimized OHLCV data for area chart
        // The new backend already provides properly aligned timestamps
        const processedData = result.data
          .map((item: OHLCVData) => ({
            time: item.time, // Already aligned by dynamic aggregation
            value: item.close, // Use close price for area chart
          }))
          .filter((item: any) => item.value > 0 && !isNaN(item.value)) // Remove invalid prices
          .reduce((acc: any[], current: any) => {
            // Remove duplicates (shouldn't happen with optimized backend, but safety check)
            const existingIndex = acc.findIndex(item => item.time === current.time);
            if (existingIndex >= 0) {
              acc[existingIndex] = current; // Keep latest value
            } else {
              acc.push(current);
            }
            return acc;
          }, [])
          .sort((a: any, b: any) => a.time - b.time); // Ensure chronological order
        
        areaData = processedData;
        hasRealData = true;
        
        // Log architecture benefits
        if (result.meta?.architecture === 'dynamic_aggregation') {
           console.log(`🎯 Using optimized dynamic aggregation - 85% storage reduction, perfect consistency`);
        }
      }

      // Update chart series with animation
      if (areaSeriesRef.current) {
        // Double-check for Pusher updates that came in during the fetch
        const finalTimeSinceLastPusherUpdate = Date.now() - lastPusherUpdateRef.current;
        if (lastPusherUpdateRef.current > 0 && finalTimeSinceLastPusherUpdate < 10000) {
           console.log(`🛑 Aborting setData - very recent Pusher update (${Math.round(finalTimeSinceLastPusherUpdate/1000)}s ago)`);
          setIsLoading(false);
          return;
        }
        
        console.log('📊 Setting chart data via API with animation');
        
        // For initial load or timeframe transitions, animate the data
        if ((!hasData || animate) && chartReady) {
          // If transitioning, first fade out current data
          if (animate && hasData) {
            // Create fade out effect by gradually reducing opacity
            const currentData = areaDataRef.current;
            const fadeSteps = 10;
            let fadeStep = 0;
            
            const fadeOut = () => {
              fadeStep++;
              const opacity = 1 - (fadeStep / fadeSteps);
              
              // Update series with faded data
              const fadedData = currentData.map((point: { time: number; value: number }) => ({
                time: point.time as Time,
                value: point.value * opacity
              }));
              
              areaSeriesRef.current.setData(fadedData);
              
              if (fadeStep < fadeSteps) {
                if (typeof globalThis !== 'undefined' && 'requestAnimationFrame' in globalThis) {
                  (globalThis as any).requestAnimationFrame(fadeOut);
                } else {
                  setTimeout(fadeOut, 16);
                }
              } else {
                // After fade out, start the new data animation
                animateNewData();
              }
            };
            
            // Start fade out
            setTimeout(fadeOut, 50);
          } else {
            // No previous data, just animate in
            animateNewData();
          }
          
          function animateNewData() {
            // Animate each point sequentially for smooth reveal with expansion
            const chartData = areaData.map((point: { time: number; value: number }) => ({
              time: point.time as Time,
              value: point.value
            }));
            
            // Set initial empty data
            areaSeriesRef.current.setData([]);
            
            // Animate points with expansion effect
            const totalPoints = chartData.length;
            const batchSize = Math.max(1, Math.floor(totalPoints / 20)); // Dynamic batch size
            let currentIndex = 0;
            
            const animateData = () => {
              const endIndex = Math.min(currentIndex + batchSize, totalPoints);
              const progress = endIndex / totalPoints;
              
              // Create expansion effect by scaling values during animation
              const expansionFactor = 1 + (0.05 * Math.sin(progress * Math.PI)); // Subtle expansion
              
              const batch = chartData.slice(0, endIndex).map((point: { time: Time; value: number }, index: number) => {
                const slideProgress = index / endIndex;
                const slideScale = 0.95 + (0.05 * slideProgress); // Slide in from slightly below
                
                return {
                  time: point.time,
                  value: point.value * slideScale * expansionFactor
                };
              });
              
              areaSeriesRef.current.setData(batch);
              
              if (endIndex < totalPoints) {
                currentIndex = endIndex;
                if (typeof globalThis !== 'undefined' && 'requestAnimationFrame' in globalThis) {
                  (globalThis as any).requestAnimationFrame(animateData);
                } else {
                  setTimeout(animateData, 16); // Fallback for SSR
                }
              } else {
                // Final pass to ensure exact values
                areaSeriesRef.current.setData(chartData);
                
                // Final fit after animation
                if (chartRef.current) {
                  chartRef.current.timeScale().fitContent();
                  // Ensure viewport stays locked
                  chartRef.current.timeScale().setVisibleLogicalRange({
                    from: 0,
                    to: chartData.length - 1,
                  });
                }
                
                // End transition
                setTimeout(() => setIsTransitioning(false), 100);
              }
            };
            
            // Start animation after a brief delay
            setTimeout(animateData, 100);
          }
        } else {
          // For updates, just set the data normally
          const chartData = areaData.map((point: { time: number; value: number }) => ({
            time: point.time as Time,
            value: point.value
          }));
          
          areaSeriesRef.current.setData(chartData);
        }
        
        areaDataRef.current = areaData; // Store in memory for Pusher updates
        
        // Fit content and scroll to latest
        if (chartRef.current) {
          chartRef.current.timeScale().fitContent();
          // Don't scroll to real time since we're locking the viewport
          // chartRef.current.timeScale().scrollToRealTime();
        }

        // Update legend with latest data
        if (areaData.length > 0) {
          const latestPoint = areaData[areaData.length - 1];
          const firstPoint = areaData[0];
          const changeValue = latestPoint.value - firstPoint.value;
          const changePercent = firstPoint.value !== 0 ? (changeValue / firstPoint.value) * 100 : 0;
          
          const isPositive = changeValue >= 0;
          areaSeriesRef.current.applyOptions({
            lineColor: isPositive ? positiveColor : negativeColor,
            topColor: isPositive ? positiveTopColor : negativeTopColor,
            bottomColor: isPositive ? positiveBottomColor : negativeBottomColor,
            crosshairMarkerBorderColor: isPositive ? positiveColor : negativeColor,
            crosshairMarkerBackgroundColor: isPositive ? positiveColor : negativeColor,
          });

          setLegendData({
            price: latestPoint.value,
            change: changeValue,
            changePercent: isFinite(changePercent) ? changePercent : 0,
            time: new Date(latestPoint.time * 1000).toLocaleTimeString(),
          });
        }
      }

      setHasData(hasRealData);
      setLastUpdate(new Date());
      setError(null);
      setDataSource('polling'); // Mark as polling data source

    } catch (err) {
      console.error('❌ Area chart data fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load chart data');
    } finally {
      setIsLoading(false);
    }
  };

  // Load data when symbol or timeframe changes
  useEffect(() => {
    if (!CHART_BACKEND_ENABLED) return;
    // Only load initial data if:
    // 1. Pusher is not available/connected, OR
    // 2. We wait a short time to see if Pusher provides data
    
     console.log(`🎯 Data loading trigger for ${symbol}-${selectedTimeframe}`);
     console.log('Pusher connected:', isPusherConnected);
    
    if (!isPusherConnected) {
       console.log('🔄 Loading initial data immediately (no Pusher connection)');
      fetchChartData(selectedTimeframe, true); // Animate on timeframe change
    } else {
       console.log('⏳ Waiting for Pusher data before fallback loading...');
      // Wait 5 seconds for Pusher data before falling back to API
      const fallbackTimer = setTimeout(() => {
        if (lastPusherUpdateRef.current === 0) {
           console.log('🔄 No Pusher data received, loading via API');
          fetchChartData(selectedTimeframe, true); // Animate on timeframe change
        } else {
           console.log('✅ Pusher data already received, skipping API load');
        }
      }, 5000);

      return () => clearTimeout(fallbackTimer);
    }
  }, [symbol, selectedTimeframe, isPusherConnected]);

  // Intelligent auto-refresh with optimized dynamic aggregation
  useEffect(() => {
    if (!CHART_BACKEND_ENABLED) return;
    const interval = setInterval(() => {
      // Only poll if:
      // 1. Pusher is not connected, OR
      // 2. No Pusher updates received in the last 60 seconds
      const timeSinceLastPusherUpdate = Date.now() - lastPusherUpdateRef.current;
      const shouldPoll = !isPusherConnected || timeSinceLastPusherUpdate > 60000;
      
      if (shouldPoll) {
         console.log(`🔄 Intelligent polling for ${symbol} chart (Pusher: ${isPusherConnected ? 'connected but stale' : 'disconnected'}) - Dynamic aggregation ensures data consistency`);
        fetchChartData(selectedTimeframe);
        setDataSource('polling');
      } else {
         console.log(`⏭️ Skipping poll for ${symbol} chart - recent Pusher update (${Math.round(timeSinceLastPusherUpdate/1000)}s ago)`);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [symbol, selectedTimeframe, isPusherConnected]);

  return (
    <div 
      className={`group relative bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 overflow-hidden ${className}`}
    >
      
      {/* Chart Legend - Design System Typography */}
      <div className="absolute top-3 left-4 pointer-events-none select-none z-20">
        {/* Section Header Pattern */}
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
            {(symbol).toUpperCase()}/USDC
          </h4>
          <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
            {selectedTimeframe}
          </div>
        </div>
        
        {/* Main Content Layout */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Status Indicator */}
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              legendData.change >= 0 ? 'bg-green-400' : 'bg-red-400'
            }`} />
            
            {/* Primary Content */}
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-white text-sm font-medium">
                ${legendData.price.toFixed(2)}
              </span>
              <span className={`text-[11px] font-medium ${
                legendData.change >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {legendData.change >= 0 ? '+' : ''}{legendData.change.toFixed(2)}
              </span>
            </div>
          </div>
          
          {/* Right Side Actions */}
          <div className="flex items-center gap-2">
            <span className={`text-[10px] ${
              legendData.changePercent >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              ({legendData.changePercent >= 0 ? '+' : ''}{legendData.changePercent.toFixed(2)}%)
            </span>
            {isPusherConnected && dataSource === 'pusher' && (
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            )}
          </div>
        </div>
        
        {/* Expandable Details on Hover */}
        <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
          <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
            <div className="text-[9px] pt-1.5">
              <span className="text-[#606060]">
                {legendData.time || 'Latest'} • {dataSource === 'pusher' ? 'Live updates' : 'Polling data'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart Header - Design System Layout */}
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Loading State Indicator */}
          {isLoading && (
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          )}
          {!isLoading && hasData && (
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
          )}
          {!isLoading && !hasData && !error && (
            <div className="w-1.5 h-1.5 rounded-full bg-[#404040]" />
          )}
          
          {/* Progress Bar for Loading */}
          {isLoading && (
            <div className="w-8 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
              <div className="h-full bg-blue-400 animate-pulse" style={{ width: '60%' }} />
            </div>
          )}
        </div>

        {/* Timeframe Pills - Sophisticated Design */}
        <div className="flex items-center gap-1.5">
          {timeframes.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setSelectedTimeframe(tf.value)}
              disabled={isLoading}
              className={`px-2 py-1 text-[10px] font-medium rounded transition-all duration-200 ${
                selectedTimeframe === tf.value
                  ? 'text-white bg-[#1A1A1A] border border-[#333333]'
                  : 'text-[#808080] hover:text-white hover:bg-[#1A1A1A] border border-[#222222] hover:border-[#333333]'
              } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart Container */}
      <div 
        className="relative w-full"
        style={{ 
          height: typeof height === 'number' ? height : 350,
          opacity: chartReady ? 1 : 0,
          transition: 'opacity 0.5s ease-out',
          transform: isTransitioning ? 'scale(1.01)' : 'scale(1)',
          filter: isTransitioning ? 'brightness(1.05)' : 'brightness(1)',
        }}
      >
        <div 
          ref={chartContainerRef}
          className="w-full h-full"
        />
        
        {/* Loading State - Modern - TEMPORARILY DISABLED */}
        {/* 
        {!chartReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 border-3 border-purple-500/20 rounded-full"></div>
                <div className="absolute inset-0 w-12 h-12 border-3 border-transparent border-t-purple-500 rounded-full animate-spin"></div>
              </div>
              <span className="text-white/40 text-sm">Loading chart...</span>
            </div>
          </div>
        )}
        */}
        
        {/* Empty State Pattern */}
        {!hasData && !isLoading && !error && chartReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-4 max-w-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-[#808080]">
                      No trading data available
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white font-mono">$0.00</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-[#404040]" />
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                  <div className="text-[9px] pt-1.5">
                    <span className="text-[#606060]">Chart will populate when trading begins</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Error State Pattern */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-4 max-w-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-red-400">
                      Chart Error
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                  <div className="text-[9px] pt-1.5">
                    <span className="text-[#606060]">{error}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 