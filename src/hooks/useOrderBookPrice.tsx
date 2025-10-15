'use client';

import { useEffect, useMemo, useState } from 'react';
import { useOrderbookMarket } from './useOrderbookMarket';
import { useOrderBookContractData } from '@/hooks/useOrderBookContractData';

export interface PriceData {
  price: string;
  priceNumber: number;
  formattedPrice: string;
  change24h: string;
  changePercentage24h: string;
  isPositiveChange: boolean;
  lastUpdated: string;
}

function formatUsd(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  // For mark price display, show plain number with 4 decimals (no currency, no commas)
  return v.toFixed(4);
}

export function useOrderBookPrice(metricId?: string) {
  const { market, isLoading: isMarketLoading } = useOrderbookMarket(metricId);
  // Use market.metricId/name/symbol as lookup key; fallback to metricId
  const symbolKey = useMemo(() => {
    return market?.metricId || market?.symbol || market?.name || metricId || '';
  }, [market, metricId]);

  const { data: obLive, isLoading: obLoading, error: obError } = useOrderBookContractData(symbolKey, { refreshInterval: 15000 });

  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (isMarketLoading || obLoading) return;

    if (!obLive) {
      setError(obError ? new Error(String(obError)) : new Error('No orderbook data'));
      setIsLoading(false);
      return;
    }

    const mark = Number(obLive.markPrice || 0);
    const changeAbs = Number(obLive.priceChange24h || 0);
    const changePct = mark > 0 ? (changeAbs / mark) * 100 : 0;

    const pd: PriceData = {
      price: String(mark),
      priceNumber: mark,
      formattedPrice: formatUsd(mark),
      change24h: (changeAbs >= 0 ? '+' : '') + changeAbs.toFixed(2),
      changePercentage24h: (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%',
      isPositiveChange: changeAbs >= 0,
      lastUpdated: obLive.lastUpdated,
    };

    setPriceData(pd);
    setError(null);
    setIsLoading(false);
  }, [isMarketLoading, obLoading, obLive, obError]);

  return { priceData, isLoading, error };
}

export default useOrderBookPrice;
