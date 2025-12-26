'use client';

import { useMemo } from 'react';
import { useMarket } from './useMarket';
import { useOrderBookContractData } from '@/hooks/useOrderBookContractData';
import { useMaybeMarketData } from '@/contexts/MarketDataContext';

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

export function useOrderBookPrice(marketIdentifier?: string) {
  const { market, isLoading: isMarketLoading } = useMarket(marketIdentifier);
  const ctx = useMaybeMarketData();
  // Use market.market_identifier/symbol/name as lookup key; fallback to marketIdentifier
  const symbolKey = useMemo(() => {
    return market?.market_identifier || market?.symbol || market?.name || marketIdentifier || '';
  }, [market, marketIdentifier]);

  const ctxMatches = useMemo(() => {
    if (!ctx) return false;
    const a = String(ctx.symbol || '').toLowerCase();
    const b = String(symbolKey || '').toLowerCase();
    if (!a || !b) return false;
    return a === b;
  }, [ctx, symbolKey]);

  // If MarketDataProvider is present (ctxMatches), avoid spinning up a second poller.
  const { data: obLive, isLoading: obLoading, error: obError } = useOrderBookContractData(symbolKey, {
    refreshInterval: 15000,
    enabled: !ctxMatches,
  });

  const isLoading = ctxMatches ? Boolean(ctx?.isLoading) : (isMarketLoading || obLoading);
  const error = useMemo(() => {
    if (ctxMatches) return ctx?.error ? new Error(String(ctx.error)) : null;
    return obError ? new Error(String(obError)) : null;
  }, [ctxMatches, ctx?.error, obError]);

  const priceData: PriceData | null = useMemo(() => {
    if (isLoading) return null;

    if (ctxMatches && ctx) {
      const mark = Number((ctx.markPrice ?? ctx.resolvedPrice) || 0);
      const changePct = Number(ctx.tokenData?.priceChange24h || 0);
      const changeAbs = mark > 0 ? (mark * changePct) / 100 : 0;
      return {
        price: String(mark),
        priceNumber: mark,
        formattedPrice: formatUsd(mark),
        change24h: (changeAbs >= 0 ? '+' : '') + changeAbs.toFixed(2),
        changePercentage24h: (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%',
        isPositiveChange: changeAbs >= 0,
        lastUpdated: ctx.lastUpdated || new Date().toISOString(),
      };
    }

    if (!obLive) return null;
    const mark = Number(obLive.markPrice || 0);
    const changeAbs = Number(obLive.priceChange24h || 0);
    const changePct = mark > 0 ? (changeAbs / mark) * 100 : 0;
    return {
      price: String(mark),
      priceNumber: mark,
      formattedPrice: formatUsd(mark),
      change24h: (changeAbs >= 0 ? '+' : '') + changeAbs.toFixed(2),
      changePercentage24h: (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%',
      isPositiveChange: changeAbs >= 0,
      lastUpdated: obLive.lastUpdated,
    };
  }, [isLoading, ctxMatches, ctx, obLive]);

  return { priceData, isLoading, error };
}

export default useOrderBookPrice;
