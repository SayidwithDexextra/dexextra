import React from 'react';

export type WatchlistMetricsBarProps = {
  watchlistAssets: number;
  totalVolume24hUsd: number;
  avgChangePct: number;
  gainers: number;
  losers: number;
  dominancePct: number;
};

const formatCompactNumber = (value: number) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '0';
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
};

const formatUsdCompact = (value: number) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '$0.00';
  return `$${formatCompactNumber(n)}`;
};

const formatPct = (value: number, digits = 1) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return `0.${'0'.repeat(digits)}%`;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
};

type Metric = { label: string; value: string; valueClassName?: string };

export function WatchlistMetricsBar(props: WatchlistMetricsBarProps) {
  const metrics: Metric[] = [
    { label: 'Watchlist Assets', value: String(props.watchlistAssets) },
    { label: '24h Volume', value: formatUsdCompact(props.totalVolume24hUsd), valueClassName: 'font-mono' },
    { label: 'Avg Change', value: formatPct(props.avgChangePct, 1), valueClassName: 'font-mono' },
    { label: 'Gainers', value: String(props.gainers), valueClassName: 'font-mono' },
    { label: 'Losers', value: String(props.losers), valueClassName: 'font-mono' },
    { label: 'Dominance', value: formatPct(props.dominancePct, 1), valueClassName: 'font-mono' },
  ];

  return (
    <div className="w-full rounded-md border border-[#1A1A1A] bg-gradient-to-b from-[#141414] to-[#0F0F0F] overflow-hidden flex-shrink-0">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m, idx) => (
          <div
            key={m.label}
            className={[
              'px-5 py-4',
              'min-w-0',
              idx === 0 ? '' : 'border-l border-[#1A1A1A]',
            ].join(' ')}
          >
            <div className="text-[11px] leading-none text-[#7A7A7A] tracking-tight">
              {m.label}
            </div>
            <div className={['mt-2 text-[20px] leading-none text-white font-medium tracking-tight', m.valueClassName || ''].join(' ')}>
              {m.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

