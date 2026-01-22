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
  marketId: string;
  width?: string | number;
  height?: string | number;
  className?: string;
  defaultPrice?: number;
  seriesType?: 'area' | 'candlestick';
  defaultTimeframe?: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
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

// "Large gap" threshold to break sessions (in seconds). Defaults to 48h.
const DEFAULT_LARGE_GAP_SECONDS = 48 * 3600;
const getLargeGapSeconds = (): number => {
  const fromEnv = Number(process.env.NEXT_PUBLIC_CHART_LARGE_GAP_SECONDS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv) : DEFAULT_LARGE_GAP_SECONDS;
};

// Compute the [from, to] of the most recent active session based on large gaps in raw trade times.
// - rawTimes must be sorted ascending, in seconds.
// - A "session" is the suffix of rawTimes after the last gap >= largeGapSec.
// - If no such gap, the session spans the entire array.
function computeActiveSessionRangeFromTimes(rawTimes: ReadonlyArray<number>, largeGapSec: number): { from: number; to: number } | null {
  if (!Array.isArray(rawTimes) || rawTimes.length === 0) return null;
  const to = rawTimes[rawTimes.length - 1]!;
  let startIdx = 0;
  for (let i = rawTimes.length - 1; i >= 1; i--) {
    const gap = rawTimes[i] - rawTimes[i - 1];
    if (gap >= largeGapSec) {
      startIdx = i; // session starts after the last large gap
      break;
    }
  }
  const from = rawTimes[startIdx]!;
  return { from, to };
}

// Focus chart to a time range with small padding on both sides
function focusVisibleRange(chart: IChartApi | null, fromSec: number, toSec: number, padSec: number) {
  if (!chart || !Number.isFinite(fromSec) || !Number.isFinite(toSec)) return;
  if (toSec <= fromSec) {
    // minimal non-zero window if degenerate
    const epsilon = Math.max(60, Math.floor(padSec));
    chart.timeScale().setVisibleRange({ from: Math.max(0, fromSec - epsilon) as Time, to: (toSec + epsilon) as Time });
    return;
  }
  const from = Math.max(0, fromSec - padSec);
  const to = toSec + padSec;
  try {
    chart.timeScale().setVisibleRange({ from: from as Time, to: to as Time });
  } catch {
    // Best effort; ignore if chart not ready
  }
}

// Gap-fill OHLC candles over fixed-second resolution (time units: seconds)
type GapCandle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
/**
 * Aggregates 1m candles into a larger fixed-second resolution and returns a gap-filled series.
 * - Buckets minute candles by resolutionSeconds using floor-alignment
 * - Computes open (first), high (max), low (min), close (last), volume (sum)
 * - Fills missing buckets between first and last using the previous close
 */
function aggregateFromMinutesToResolution(
  minuteCandles: ReadonlyArray<GapCandle>,
  resolutionSeconds: number
): Array<Required<GapCandle>> {
  if (!Array.isArray(minuteCandles) || minuteCandles.length === 0 || resolutionSeconds <= 0) {
    return [];
  }
  const interval = Math.trunc(resolutionSeconds);
  const alignDown = (t: number) => t - (t % interval);

  // Ensure ascending order
  const sorted = [...minuteCandles].sort((a, b) => a.time - b.time);

  // Group minutes into buckets
  const buckets = new Map<number, Required<GapCandle> & { __firstT: number; __lastT: number }>();
  for (const c of sorted) {
    if (!Number.isFinite(c.time)) continue;
    const bucketStart = alignDown(Math.trunc(c.time));
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        time: bucketStart,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: Number.isFinite(Number(c.volume)) ? Number(c.volume) : 0,
        __firstT: c.time,
        __lastT: c.time,
      });
    } else {
      // Track open by earliest minute, close by latest minute
      if (c.time < existing.__firstT) {
        existing.open = c.open;
        existing.__firstT = c.time;
      }
      if (c.time >= existing.__lastT) {
        existing.close = c.close;
        existing.__lastT = c.time;
      }
      if (c.high > existing.high) existing.high = c.high;
      if (c.low < existing.low) existing.low = c.low;
      existing.volume += Number.isFinite(Number(c.volume)) ? Number(c.volume) : 0;
    }
  }

  // Materialize and sort aggregated buckets
  const aggregated = Array.from(buckets.values())
    .map(({ __firstT, __lastT, ...rest }) => rest)
    .sort((a, b) => a.time - b.time);

  if (aggregated.length === 0) {
    return [];
  }

  // Attempt to provide a "previous close" candle just before the first bucket to enable intelligent leading gap-fill
  const firstBucketTime = aggregated[0].time;
  let prevClose: number | undefined;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].time < firstBucketTime) {
      prevClose = sorted[i].close;
      break;
    }
  }
  const seed = prevClose != null
    ? [{ time: firstBucketTime - interval, open: prevClose, high: prevClose, low: prevClose, close: prevClose, volume: 0 as number }]
    : [];

  // Gap-fill across full bucket range
  const start = firstBucketTime;
  const end = aggregated[aggregated.length - 1].time;
  const filled = generateGapFilledCandles([...seed, ...aggregated], interval, start, end);
  return filled;
}
function generateGapFilledCandles(
  rawCandles: ReadonlyArray<GapCandle>,
  resolutionSeconds: number,
  startTime: number,
  endTime: number
): Array<Required<GapCandle>> {
  if (!Array.isArray(rawCandles) || !Number.isFinite(resolutionSeconds) || resolutionSeconds <= 0) {
    return [];
  }
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return [];
  }

  const interval = Math.trunc(resolutionSeconds);
  const alignDown = (t: number) => t - (t % interval);
  const alignedStart = alignDown(Math.trunc(startTime));
  const alignedEnd = alignDown(Math.trunc(endTime));

  let i = 0;
  const n = rawCandles.length;
  while (i < n && rawCandles[i].time < alignedStart) i++;

  const out: Array<Required<GapCandle>> = [];
  let lastClose: number | undefined;

  // adopt previous close if a candle exists exactly before the window
  if (i > 0) {
    const prev = rawCandles[i - 1];
    if ((prev.time % interval) === 0 && prev.time < alignedStart) {
      lastClose = prev.close;
    }
  }

  for (let t = alignedStart; t <= alignedEnd; t += interval) {
    while (i < n && rawCandles[i].time < t) i++;

    if (i < n && rawCandles[i].time === t) {
      const c = rawCandles[i];
      out.push({
        time: t,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: Number.isFinite(Number(c.volume)) ? Number(c.volume) : 0
      });
      lastClose = c.close;
      i++;
    } else {
      if (lastClose == null) {
        // skip leading gaps until we have a previous close
        continue;
      }
      out.push({
        time: t,
        open: lastClose,
        high: lastClose,
        low: lastClose,
        close: lastClose,
        volume: 0
      });
    }
  }
  return out;
}

export default function LightweightChart({ 
  symbol,
  marketId,
  width = '100%', 
  height = 350, // Increased by 25% for optimal visibility
  className = '',
  defaultPrice = 100,
  seriesType = 'area',
  defaultTimeframe = '1h'
}: LightweightChartProps) {
  // Temporary flag to disable all backend interactions (API + Pusher)
  const CHART_BACKEND_ENABLED = process.env.NEXT_PUBLIC_CHART_BACKEND_ENABLED !== 'false';
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const areaSeriesRef = useRef<any>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const areaDataRef = useRef<Array<{ time: number; value: number }>>([]); // Keep full data in memory
  const ohlcvDataRef = useRef<Array<{ time: number; open: number; high: number; low: number; close: number }>>([]);
  const activeSessionFromRef = useRef<number | null>(null);
  const activeSessionToRef = useRef<number | null>(null);
  const lastRealTimeRef = useRef<number | null>(null);
  const nowLineRef = useRef<HTMLDivElement | null>(null);
  const nowLabelRef = useRef<HTMLDivElement | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const lastPusherUpdateRef = useRef<number>(0);
  const isMountedRef = useRef(true);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const didInitialFitRef = useRef<boolean>(false);
  const [chartReady, setChartReady] = useState(true); // TEMPORARILY SET TO TRUE TO SKIP LOADING
  const isNumberHeight = typeof height === 'number';
  
  const [selectedTimeframe, setSelectedTimeframe] = useState(defaultTimeframe);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [hasData, setHasData] = useState(false);
  const [isPusherConnected, setIsPusherConnected] = useState(false);
  const [dataSource, setDataSource] = useState<'pusher' | 'polling' | 'cached'>('polling');
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

  // Scroll viewport to the most recent data (Realtime)
  const handleGoToRealtime = useCallback(() => {
    try {
      if (chartRef.current) {
        chartRef.current.timeScale().scrollToRealTime();
      }
    } catch {}
  }, []);

  // Ensure the chart doesn't look overly zoomed when there are very few bars.
  // Adds logical padding around the data and normalizes bar spacing.
  const applyInitialViewportPadding = useCallback(() => {
    const chart = chartRef.current as IChartApi | null;
    if (!chart) return;
    try {
      const seriesLength =
        seriesType === 'candlestick'
          ? ohlcvDataRef.current.length
          : areaDataRef.current.length;
      if (seriesLength === 0) return;

      // Prefer focusing the most recent active trading session if available
      const tfSeconds = getTimeframeSeconds(selectedTimeframe);
      const padSeconds = Math.max(2 * tfSeconds, 60);
      if (activeSessionFromRef.current != null && activeSessionToRef.current != null) {
        focusVisibleRange(chart, activeSessionFromRef.current, activeSessionToRef.current, padSeconds);
      } else {
        // Fallback: fit content and add some logical padding for small datasets
        chart.timeScale().fitContent();
        if (seriesLength < 120) {
          const targetVisible = 120;
          const pad = Math.max(30, Math.ceil((targetVisible - seriesLength) / 2));
          chart.timeScale().setVisibleLogicalRange({
            from: -pad,
            to: seriesLength + pad,
          });
        }
      }

      // Normalize default bar spacing so a single bar isn't full-width
      chart.applyOptions({ timeScale: { barSpacing: 3 } });
    } catch {
      // no-op
    }
  }, [seriesType, selectedTimeframe]);

  // Helper: push a live tick from TokenHeader event into the area series
  const applyLiveTick = useCallback((tickPrice: number, tickTimestamp: number) => {
    try {
      if (seriesType === 'area' && !areaSeriesRef.current) return;
      if (seriesType === 'candlestick' && !candlestickSeriesRef.current) return;
      const timeframeSeconds = getTimeframeSeconds(selectedTimeframe);
      const alignedTime = Math.floor(Math.floor(tickTimestamp / 1000) / timeframeSeconds) * timeframeSeconds;

      if (seriesType === 'area') {
        const newPoint = { time: alignedTime, value: Math.max(0, Number(tickPrice) || 0) };
        const lastPoint = areaDataRef.current[areaDataRef.current.length - 1];

        if (!lastPoint) {
          areaDataRef.current = [newPoint];
          areaSeriesRef.current.setData([{ time: newPoint.time as Time, value: newPoint.value }]);
          // initialize active session tracking
          const largeGapSec = getLargeGapSeconds();
          activeSessionFromRef.current = newPoint.time;
          activeSessionToRef.current = newPoint.time;
          lastRealTimeRef.current = newPoint.time;
        } else {
          if (newPoint.time === lastPoint.time) {
            areaDataRef.current[areaDataRef.current.length - 1] = newPoint;
            areaSeriesRef.current.update({ time: newPoint.time as Time, value: newPoint.value });
          } else if (newPoint.time > lastPoint.time) {
            areaDataRef.current.push(newPoint);
            areaSeriesRef.current.update({ time: newPoint.time as Time, value: newPoint.value });
            // update active session tracking based on large gap
            const largeGapSec = getLargeGapSeconds();
            if ((newPoint.time - lastPoint.time) >= largeGapSec) {
              activeSessionFromRef.current = newPoint.time;
            }
            activeSessionToRef.current = newPoint.time;
            lastRealTimeRef.current = newPoint.time;
          } else {
            return;
          }
        }

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
      } else {
        // candlestick
        const price = Math.max(0, Number(tickPrice) || 0);
        const lastBar = ohlcvDataRef.current[ohlcvDataRef.current.length - 1];
        if (!lastBar) {
          const bar = { time: alignedTime, open: price, high: price, low: price, close: price };
          ohlcvDataRef.current = [bar];
          candlestickSeriesRef.current.setData([{ ...bar, time: bar.time as Time } as any]);
          // initialize active session tracking
          activeSessionFromRef.current = bar.time;
          activeSessionToRef.current = bar.time;
          lastRealTimeRef.current = bar.time;
        } else if (alignedTime === lastBar.time) {
          lastBar.close = price;
          lastBar.high = Math.max(lastBar.high, price);
          lastBar.low = Math.min(lastBar.low, price);
          candlestickSeriesRef.current.update({ ...lastBar, time: lastBar.time as Time } as any);
        } else if (alignedTime > lastBar.time) {
          const bar = { time: alignedTime, open: lastBar.close, high: Math.max(lastBar.close, price), low: Math.min(lastBar.close, price), close: price };
          ohlcvDataRef.current.push(bar);
          candlestickSeriesRef.current.update({ ...bar, time: bar.time as Time } as any);
          // update active session tracking based on large gap
          const largeGapSec = getLargeGapSeconds();
          if ((bar.time - lastBar.time) >= largeGapSec) {
            activeSessionFromRef.current = bar.time;
          }
          activeSessionToRef.current = bar.time;
          lastRealTimeRef.current = bar.time;
        } else {
          return;
        }

        const firstClose = ohlcvDataRef.current[0]?.close || 0;
        const changeValue = price - firstClose;
        const changePercent = firstClose !== 0 ? (changeValue / firstClose) * 100 : 0;

        setLegendData({
          price,
          change: changeValue,
          changePercent: isFinite(changePercent) ? changePercent : 0,
          time: new Date(alignedTime * 1000).toLocaleTimeString(),
        });
      }

      if (chartRef.current && !didInitialFitRef.current) {
        applyInitialViewportPadding();
        didInitialFitRef.current = true;
      }
      setHasData(true);
      setDataSource('pusher');
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      // swallow errors to avoid UI spam
    }
  }, [selectedTimeframe, applyInitialViewportPadding]);

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

    if (!isMountedRef.current) return;

     console.log(`📈 Chart update received via Pusher for ${data.symbol} (${data.timeframe}):`, data);

    try {
      if (seriesType === 'candlestick') {
        const timeframeSeconds = getTimeframeSeconds(selectedTimeframe);
        const alignedTime = Math.floor(Math.floor(data.timestamp / 1000) / timeframeSeconds) * timeframeSeconds;
        const price = data.close;
        const lastBar = ohlcvDataRef.current[ohlcvDataRef.current.length - 1];

        if (!candlestickSeriesRef.current) return;

        if (!lastBar) {
          const bar = { time: alignedTime, open: price, high: price, low: price, close: price };
          ohlcvDataRef.current = [bar];
          candlestickSeriesRef.current.setData([{ ...bar, time: bar.time as Time } as any]);
          // initialize active session tracking
          activeSessionFromRef.current = bar.time;
          activeSessionToRef.current = bar.time;
          lastRealTimeRef.current = bar.time;
        } else if (alignedTime === lastBar.time) {
          lastBar.close = price;
          lastBar.high = Math.max(lastBar.high, price);
          lastBar.low = Math.min(lastBar.low, price);
          candlestickSeriesRef.current.update({ ...lastBar, time: lastBar.time as Time } as any);
        } else if (alignedTime > lastBar.time) {
          const bar = { time: alignedTime, open: lastBar.close, high: Math.max(lastBar.close, price), low: Math.min(lastBar.close, price), close: price };
          ohlcvDataRef.current.push(bar);
          candlestickSeriesRef.current.update({ ...bar, time: bar.time as Time } as any);
          // update active session tracking based on large gap
          const largeGapSec = getLargeGapSeconds();
          if ((bar.time - lastBar.time) >= largeGapSec) {
            activeSessionFromRef.current = bar.time;
          }
          activeSessionToRef.current = bar.time;
          lastRealTimeRef.current = bar.time;
        } else {
          return;
        }

        const firstClose = ohlcvDataRef.current[0]?.close || 0;
        const changeValue = price - firstClose;
        const changePercent = firstClose !== 0 ? (changeValue / firstClose) * 100 : 0;

        setLegendData({
          price,
          change: changeValue,
          changePercent: isFinite(changePercent) ? changePercent : 0,
          time: new Date(alignedTime * 1000).toLocaleTimeString(),
        });

        if (chartRef.current && !didInitialFitRef.current) {
          applyInitialViewportPadding();
          didInitialFitRef.current = true;
        }
        lastPusherUpdateRef.current = Date.now();
        setLastUpdate(new Date());
        setDataSource('pusher');
        setError(null);
        return;
      }

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
        if (chartRef.current && !didInitialFitRef.current) {
          applyInitialViewportPadding();
          didInitialFitRef.current = true;
        }
        // initialize active session tracking
        activeSessionFromRef.current = newDataPoint.time;
        activeSessionToRef.current = newDataPoint.time;
        lastRealTimeRef.current = newDataPoint.time;
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
        // update active session tracking based on large gap to previous last point
        const prev = areaDataRef.current.length > 1 ? areaDataRef.current[areaDataRef.current.length - 2] : undefined;
        if (prev && prev.time < newDataPoint.time) {
          const largeGapSec = getLargeGapSeconds();
          if ((newDataPoint.time - prev.time) >= largeGapSec) {
            activeSessionFromRef.current = newDataPoint.time;
          }
          activeSessionToRef.current = newDataPoint.time;
          lastRealTimeRef.current = newDataPoint.time;
        }
        
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
      if (chartRef.current && !didInitialFitRef.current) {
        applyInitialViewportPadding();
        didInitialFitRef.current = true;
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
  }, [hasData, selectedTimeframe, applyInitialViewportPadding]);

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
          background: { type: ColorType.Solid, color: '#0F0F10' },
          textColor: 'rgba(255, 255, 255, 0.7)',
        },
        width: (chartContainerRef.current as any).offsetWidth,
        height: isNumberHeight 
          ? (typeof height === 'number' ? height : 350)
          : ((chartContainerRef.current as any).offsetHeight || 350),
        grid: {
          vertLines: { color: 'rgba(255, 255, 255, 0.06)' },
          horzLines: { color: 'rgba(255, 255, 255, 0.06)' },
        },
        crosshair: {
          mode: 1,
          vertLine: {
            color: 'rgba(255, 255, 255, 0.25)',
            width: 1,
            style: 3,
            labelBackgroundColor: '#1A1A1A',
          },
          horzLine: {
            color: 'rgba(255, 255, 255, 0.25)',
            width: 1,
            style: 3,
            labelBackgroundColor: '#1A1A1A',
          },
        },
        rightPriceScale: {
          borderVisible: true,
          borderColor: '#2A2A2A',
          scaleMargins: {
            top: 0.1,
            bottom: 0.1,
          },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 8,
          barSpacing: 3,
          // Allow panning on both edges
          fixLeftEdge: false,
          fixRightEdge: false,
          lockVisibleTimeRangeOnResize: false,
        },
        handleScroll: {
          // Enable horizontal panning
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: true,
        },
        handleScale: {
          axisPressedMouseMove: {
            time: true,
            price: true,
          },
          mouseWheel: true,
          pinch: true,
        },
      });


      // Create series
      if (seriesType === 'candlestick') {
        const cSeries = chart.addCandlestickSeries({
          upColor: '#75bb75',
          downColor: '#fb5c60',
          borderVisible: false,
          wickUpColor: '#75bb75',
          wickDownColor: '#fb5c60',
        });
        candlestickSeriesRef.current = cSeries;
      } else {
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
        areaSeriesRef.current = areaSeries;
      }

      chartRef.current = chart;
      
            // Add crosshair move handler for legend updates
      chart.subscribeCrosshairMove((param: any) => {
        const targetSeries = seriesType === 'candlestick' ? candlestickSeriesRef.current : areaSeriesRef.current;
        if (!param || !param.time || !param.seriesData || !targetSeries) {
          // Reset to latest data when crosshair is removed
          const hasArea = areaDataRef.current.length > 0;
          const hasCandle = ohlcvDataRef.current.length > 0;
          if (hasArea || hasCandle) {
            const latestPoint = hasArea 
              ? { price: areaDataRef.current[areaDataRef.current.length - 1].value, time: areaDataRef.current[areaDataRef.current.length - 1].time }
              : { price: ohlcvDataRef.current[ohlcvDataRef.current.length - 1].close, time: ohlcvDataRef.current[ohlcvDataRef.current.length - 1].time };
            const firstValue = hasArea ? (areaDataRef.current[0]?.value || 0) : (ohlcvDataRef.current[0]?.close || 0);
            const changeValue = latestPoint.price - firstValue;
            const changePercent = firstValue !== 0 ? (changeValue / firstValue) * 100 : 0;
            
            setLegendData({
              price: latestPoint.price,
              change: changeValue,
              changePercent: isFinite(changePercent) ? changePercent : 0,
              time: new Date(latestPoint.time * 1000).toLocaleTimeString(),
            });
          }
          return;
        }
        
        try {
          const targetSeries = seriesType === 'candlestick' ? candlestickSeriesRef.current : areaSeriesRef.current;
          const data = param.seriesData.get(targetSeries);
          if (!data || typeof data !== 'object' || !('value' in data)) {
            return;
          }
          
          // Get the first data point for change calculation
          const firstValue = seriesType === 'candlestick' ? (ohlcvDataRef.current[0]?.close || 0) : (areaDataRef.current[0]?.value || 0);
          const currentValue = (data as any).value as number;
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
            height: isNumberHeight
              ? (typeof height === 'number' ? height : 350)
              : ((chartContainerRef.current as any).offsetHeight || 350)
          });
          // keep "now" marker in sync with canvas size changes
          try {
            if (chartRef.current && nowLineRef.current && nowLabelRef.current) {
              const nowSec = Math.floor(Date.now() / 1000);
              const x = chartRef.current.timeScale().timeToCoordinate(nowSec);
              if (x == null || !isFinite(x)) {
                nowLineRef.current.style.display = 'none';
                nowLabelRef.current.style.display = 'none';
              } else {
                nowLineRef.current.style.display = 'block';
                nowLineRef.current.style.left = `${x}px`;
                nowLabelRef.current.style.display = 'block';
                nowLabelRef.current.style.left = `${x}px`;
              }
            }
          } catch {}
        }
      };

      // Ensure correct size on first paint
      if (typeof globalThis !== 'undefined' && 'requestAnimationFrame' in globalThis) {
        (globalThis as any).requestAnimationFrame(() => handleResize());
      } else {
        setTimeout(() => handleResize(), 0);
      }

      // Observe container resizes
      if (typeof globalThis !== 'undefined' && 'ResizeObserver' in globalThis && chartContainerRef.current) {
        resizeObserverRef.current = new (globalThis as any).ResizeObserver(() => {
          handleResize();
        });
        resizeObserverRef.current?.observe(chartContainerRef.current);
      }

      if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
        (globalThis as any).window.addEventListener('resize', handleResize);
      }

      // Keep a live "Now" marker synced to current time
      const updateNowMarker = () => {
        try {
          if (!chartRef.current || !chartContainerRef.current || !nowLineRef.current || !nowLabelRef.current) return;
          const nowSec = Math.floor(Date.now() / 1000);
          const x = chartRef.current.timeScale().timeToCoordinate(nowSec);
          const label = nowLabelRef.current;
          if (x == null || !isFinite(x)) {
            nowLineRef.current.style.display = 'none';
            label.style.display = 'none';
            return;
          }
          nowLineRef.current.style.display = 'block';
          nowLineRef.current.style.left = `${x}px`;
          label.style.display = 'block';
          label.style.left = `${x}px`;
          // Update text occasionally
          label.textContent = new Date(nowSec * 1000).toLocaleTimeString();
        } catch {}
      };

      const ts = chart.timeScale();
      const onRange = () => updateNowMarker();
      ts.subscribeVisibleTimeRangeChange(onRange);
      // @ts-ignore - not all versions expose this typing, guard at runtime
      if (typeof (ts as any).subscribeVisibleLogicalRangeChange === 'function') {
        // @ts-ignore
        (ts as any).subscribeVisibleLogicalRangeChange(onRange);
      }
      const nowTimer = setInterval(updateNowMarker, 30000); // refresh every 30s
      // initial paint
      setTimeout(updateNowMarker, 0);

      return () => {
        if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
          (globalThis as any).window.removeEventListener('resize', handleResize);
        }
        if (chartContainerRef.current) {
          resizeObserverRef.current?.disconnect();
          resizeObserverRef.current = null;
        }
        try {
          ts.unsubscribeVisibleTimeRangeChange(onRange);
          // @ts-ignore
          if (typeof (ts as any).unsubscribeVisibleLogicalRangeChange === 'function') {
            // @ts-ignore
            (ts as any).unsubscribeVisibleLogicalRangeChange(onRange);
          }
        } catch {}
        clearInterval(nowTimer);
        chart.remove();
      };
    } catch (err) {
      console.error('Error initializing chart:', err);
      setError('Failed to initialize chart');
    }
  }, [height, seriesType]);

  // Set up Pusher subscription for real-time chart updates
  useEffect(() => {
    if (!CHART_BACKEND_ENABLED) return;
    if (!pusher || !marketId) return;

     // console.log(`🚀 Setting up Pusher chart subscription for ${symbol}-${selectedTimeframe}`);
     // console.log('Pusher instance:', pusher);
     // console.log('Symbol:', symbol);
     // console.log('Timeframe:', selectedTimeframe);

    // Subscribe to chart data updates
    const unsubscribeChart = pusher.subscribeToChartData(
      marketId,
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

  // Fetch and update chart data without animations
  const fetchChartData = async (timeframe: string, options?: { force?: boolean }) => {
    const force = options?.force === true;
    if (!CHART_BACKEND_ENABLED) {
      setIsLoading(false);
      setError(null);
      setHasData(false);
      return;
    }
    if (!symbol) return;
    
    // Check if we've received recent Pusher updates (skip this when forced, e.g. timeframe change)
    if (!force) {
      const timeSinceLastPusherUpdate = Date.now() - lastPusherUpdateRef.current;
      if (lastPusherUpdateRef.current > 0 && timeSinceLastPusherUpdate < 60000) {
         console.log(`🛑 Skipping fetchChartData - recent Pusher update (${Math.round(timeSinceLastPusherUpdate/1000)}s ago)`);
        return;
      }
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
       console.log(`📊 Fetching ${symbol} area chart data for ${timeframe} timeframe...`);
      
      // Always fetch 1m candles; aggregate on the client for higher timeframes
      const params = new URLSearchParams();
      params.set('timeframe', '1m');
      // Determine how many minutes we need to build ~300 buckets at the selected timeframe
      const tfSeconds = getTimeframeSeconds(timeframe);
      const minutesPerBucket = Math.max(1, Math.ceil(tfSeconds / 60));
      const targetBuckets = 300;
      const headroomBuckets = 10; // allow some leading minutes for alignment and previous-close seed
      let minuteLimit = (targetBuckets + headroomBuckets) * minutesPerBucket;
      // Safety cap to avoid very large payloads on extreme ranges (e.g. 1d)
      minuteLimit = Math.min(minuteLimit, 60000); // <= ~41 days of 1m data
      params.set('limit', String(minuteLimit));
      params.set('marketId', marketId);
      console.log(marketId)
      const response = await fetch(`/api/charts/ohlcv?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch chart data: ${response.status}`);
      }

      const result: any = await response.json();
      
      let areaData: Array<{ time: number; value: number }>;
      let ohlcvData: Array<{ time: number; open: number; high: number; low: number; close: number }>;
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
        ohlcvData = [
          { time: alignedNow - timeframeSeconds * 2, open: 0, high: 0, low: 0, close: 0 },
          { time: alignedNow - timeframeSeconds, open: 0, high: 0, low: 0, close: 0 },
          { time: alignedNow, open: 0, high: 0, low: 0, close: 0 },
        ];
        // Focus the minimal window we synthesized
        activeSessionFromRef.current = alignedNow - timeframeSeconds * 2;
        activeSessionToRef.current = alignedNow;
        lastRealTimeRef.current = null;
        
        hasRealData = false;
      } else {
         console.log(`✅ Loaded ${result.data.length} ${timeframe} candles for ${symbol} area chart (${result.meta?.architecture || 'unknown'} architecture)`);
         
        // Transform optimized OHLCV data (seconds) and ensure chronological order
        const processedOhlcv = result.data
          .map((item: OHLCVData) => ({
            time: item.time,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close
          }))
          .filter((item: any) => Number.isFinite(item.close))
          .reduce((acc: any[], current: any) => {
            const existingIndex = acc.findIndex(item => item.time === current.time);
            if (existingIndex >= 0) {
              acc[existingIndex] = current;
            } else {
              acc.push(current);
            }
            return acc;
          }, [])
          .sort((a: any, b: any) => a.time - b.time);

        // Compute active session range & last real candle time from raw (unfilled) data
        const largeGapSec = getLargeGapSeconds();
        const rawTimes = processedOhlcv.map((c: any) => c.time);
        let lastRealSec: number | null = null;
        let computedSession: { from: number; to: number } | null = null;
        if (rawTimes.length > 0) {
          lastRealSec = rawTimes[rawTimes.length - 1]!;
          computedSession = computeActiveSessionRangeFromTimes(rawTimes, largeGapSec);
          activeSessionFromRef.current = computedSession?.from ?? null;
          activeSessionToRef.current = computedSession?.to ?? null;
          lastRealTimeRef.current = lastRealSec;
        } else {
          activeSessionFromRef.current = null;
          activeSessionToRef.current = null;
          lastRealTimeRef.current = null;
        }

        // Aggregate from 1m data to the selected timeframe and gap-fill,
        // but DO NOT extend to "now" if the inactivity gap since the last real trade is large.
        if (processedOhlcv.length > 0) {
          if (timeframe === '1m') {
            const start = processedOhlcv[0].time;
            const nowSec = Math.floor(Date.now() / 1000);
            const alignedNow = nowSec - (nowSec % 60);
            const endForFill =
              lastRealSec != null && (alignedNow - lastRealSec) >= largeGapSec
                ? lastRealSec
                : alignedNow;
            const filled = generateGapFilledCandles(processedOhlcv as any, 60, start, endForFill);
            ohlcvData = filled.map(c => ({
              time: c.time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close
            }));
            areaData = filled.map(c => ({ time: c.time, value: c.close }));
          } else {
            const tfSecondsLocal = getTimeframeSeconds(timeframe);
            const aggregated = aggregateFromMinutesToResolution(processedOhlcv as any, tfSecondsLocal);
            // Extend to current time boundary
            const start = aggregated[0]?.time ?? processedOhlcv[0].time;
            const nowSec = Math.floor(Date.now() / 1000);
            const alignedNow = nowSec - (nowSec % tfSecondsLocal);
            const endForFill =
              lastRealSec != null && (alignedNow - lastRealSec) >= largeGapSec
                ? lastRealSec
                : alignedNow;
            const extended = generateGapFilledCandles(aggregated as any, tfSecondsLocal, start, endForFill);
            ohlcvData = extended.map(c => ({
              time: c.time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close
            }));
            areaData = extended.map(c => ({ time: c.time, value: c.close }));
          }
        } else {
          // Fallback (shouldn't occur in this branch)
          ohlcvData = processedOhlcv;
          areaData = processedOhlcv.map((c: any) => ({ time: c.time, value: c.close }));
        }
        hasRealData = true;
        
        // Note: we intentionally aggregate client-side from 1m for consistent gap-filling across timeframes
      }

      // Update chart series without animation
      if (seriesType === 'candlestick' && candlestickSeriesRef.current) {
        const finalTimeSinceLastPusherUpdate = Date.now() - lastPusherUpdateRef.current;
        if (!force) {
          if (lastPusherUpdateRef.current > 0 && finalTimeSinceLastPusherUpdate < 10000) {
             console.log(`🛑 Aborting setData - very recent Pusher update (${Math.round(finalTimeSinceLastPusherUpdate/1000)}s ago)`);
            setIsLoading(false);
            return;
          }
        }
        const chartData = ohlcvData.map((bar) => ({
          time: bar.time as Time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close
        })) as any;
        candlestickSeriesRef.current.setData(chartData);
        ohlcvDataRef.current = ohlcvData;

        if (chartRef.current && !didInitialFitRef.current) {
          applyInitialViewportPadding();
          didInitialFitRef.current = true;
        }

        if (ohlcvData.length > 0) {
          const latest = ohlcvData[ohlcvData.length - 1];
          const first = ohlcvData[0];
          const changeValue = latest.close - first.close;
          const changePercent = first.close !== 0 ? (changeValue / first.close) * 100 : 0;
          setLegendData({
            price: latest.close,
            change: changeValue,
            changePercent: isFinite(changePercent) ? changePercent : 0,
            time: new Date(latest.time * 1000).toLocaleTimeString(),
          });
        }
      } else if (areaSeriesRef.current) {
        // Double-check for Pusher updates that came in during the fetch (skip when forced)
        const finalTimeSinceLastPusherUpdate = Date.now() - lastPusherUpdateRef.current;
        if (!force) {
          if (lastPusherUpdateRef.current > 0 && finalTimeSinceLastPusherUpdate < 10000) {
             console.log(`🛑 Aborting setData - very recent Pusher update (${Math.round(finalTimeSinceLastPusherUpdate/1000)}s ago)`);
            setIsLoading(false);
            return;
          }
        }
        const chartData = areaData.map((point: { time: number; value: number }) => ({
          time: point.time as Time,
          value: point.value
        }));
        areaSeriesRef.current.setData(chartData);
        
        areaDataRef.current = areaData; // Store in memory for Pusher updates
        
        // Fit content and scroll to latest with padding
        if (chartRef.current && !didInitialFitRef.current) {
          applyInitialViewportPadding();
          didInitialFitRef.current = true;
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
    didInitialFitRef.current = false; // re-apply viewport padding on timeframe change
    
     console.log(`🎯 Data loading trigger for ${symbol}-${selectedTimeframe}`);
     console.log('Pusher connected:', isPusherConnected);
    
    // Always fetch immediately on timeframe change and bypass Pusher gating for responsiveness
    console.log('⚡ Immediate fetch on timeframe change');
    fetchChartData(selectedTimeframe, { force: true });
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
      className={`group relative bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 overflow-hidden h-full flex flex-col ${className}`}
    >
      
      {/* Chart Legend - Design System Typography */}
      <div className="absolute top-3 left-4 pointer-events-none select-none z-20">
        {/* Section Header Pattern */}
        <div className="flex items-center justify-between mb-3">
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
              onClick={() => setSelectedTimeframe(tf.value as any)}
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
          <button
            onClick={handleGoToRealtime}
            disabled={!chartReady}
            className={`ml-2 px-2 py-1 text-[10px] font-medium rounded transition-all duration-200 ${
              chartReady
                ? 'text-[#808080] hover:text-white hover:bg-[#1A1A1A] border border-[#222222] hover:border-[#333333]'
                : 'text-[#606060] border border-[#1A1A1A] opacity-50 cursor-not-allowed'
            }`}
            title="Go to realtime (scroll to latest)"
          >
            Go to realtime
          </button>
        </div>
      </div>

      {/* Chart Container */}
      <div 
        className={`relative w-full ${isNumberHeight ? '' : 'flex-1 min-h-0'}`}
        style={{ 
          ...(isNumberHeight ? { height: height as number } : {}),
          opacity: chartReady ? 1 : 0,
          transition: 'opacity 0.5s ease-out',
        }}
      >
        <div 
          ref={chartContainerRef}
          className="w-full h-full"
        />
        {/* Current time marker (positioned via JS) */}
        <div
          ref={nowLineRef}
          className="pointer-events-none absolute top-0 bottom-0 border-l border-blue-500/60"
          style={{ display: 'none' }}
        />
        <div
          ref={nowLabelRef}
          className="pointer-events-none absolute bottom-0 translate-x-[-50%] bg-[#1A1A1A] text-[10px] text-[#9CA3AF] px-1 py-0.5 rounded border border-[#333333]"
          style={{ display: 'none' }}
        >
          Now
        </div>
        
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