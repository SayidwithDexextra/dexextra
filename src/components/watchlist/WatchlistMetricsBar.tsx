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
    <div
      className="w-full rounded-md border border-t-stroke-sub overflow-hidden flex-shrink-0"
      style={{
        background: `linear-gradient(to bottom, var(--t-gradient-from), var(--t-gradient-to))`,
        boxShadow: 'var(--t-shadow)',
      }}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m, idx) => (
          <div
            key={m.label}
            className={[
              'px-3 py-3 sm:px-4 sm:py-4 lg:px-5',
              'min-w-0',
              idx === 0 ? '' : 'border-l border-t-stroke-sub',
            ].join(' ')}
          >
            <div className="text-[10px] sm:text-[11px] leading-none text-t-fg-muted tracking-tight">
              {m.label}
            </div>
            <div className={['mt-1.5 sm:mt-2 text-[16px] sm:text-[18px] lg:text-[20px] leading-none text-t-fg font-medium tracking-tight', m.valueClassName || ''].join(' ')}>
              {m.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
