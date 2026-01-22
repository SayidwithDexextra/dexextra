'use client';

import React, { useMemo } from 'react';
import { TokenData } from '@/types/token';
import { TradingViewChart } from '../TradingView';
import { useMarketData } from '@/contexts/MarketDataContext';

interface TokenChartProps {
  tokenData: TokenData;
  /** Timeframe for metric overlay (1m, 5m, 15m, 30m, 1h, 4h, 1d). Default: 5m */
  metricTimeframe?: string;
  /** Whether to show the metric overlay line. Default: true */
  showMetricOverlay?: boolean;
  /** Custom line color for the metric overlay. Default: #A78BFA */
  metricLineColor?: string;
}

export default function TokenChart({
  tokenData,
  metricTimeframe = '5m',
  showMetricOverlay = true,
  metricLineColor = '#A78BFA',
}: TokenChartProps) {
  const md = useMarketData();

  // Get market UUID for the metric overlay
  const marketId = (md?.market as any)?.id as string | undefined;
  const metricId = (md?.market as any)?.market_identifier || tokenData.symbol;
  const metricName = String(tokenData.symbol || metricId || '').toUpperCase();

  // Build metric overlay config
  const metricOverlay = useMemo(() => {
    if (!showMetricOverlay || !marketId) return undefined;
    return {
      marketId,
      metricName,
      timeframe: metricTimeframe,
      lineColor: metricLineColor,
      lineWidth: 1,
      displayName: String(metricId).toUpperCase(),
      enabled: true,
    };
  }, [showMetricOverlay, marketId, metricName, metricTimeframe, metricLineColor, metricId]);

  return (
    <div className="bg-[#1A1A1A] rounded-xl p-4">
      <TradingViewChart
        symbol={tokenData.symbol}
        height={720}
        metricOverlay={metricOverlay}
      />
    </div>
  );
}