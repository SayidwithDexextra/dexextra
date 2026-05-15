'use client';

import React from 'react';
import { useGasStatus } from '@/hooks/useGasStatus';

interface CongestionBannerProps {
  /** Optional class name to position/style the banner from a parent. */
  className?: string;
  /**
   * When `compact`, render a tiny one-line strip suitable for placement above
   * the trading panel. Default renders a fuller two-line message with the
   * cost-saving context. */
  compact?: boolean;
}

const formatGwei = (n: number) => {
  if (!Number.isFinite(n)) return '—';
  if (n < 1) return `${n.toFixed(2)} gwei`;
  if (n < 10) return `${n.toFixed(2)} gwei`;
  return `${n.toFixed(1)} gwei`;
};

const formatUsd = (n: number | null | undefined) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  if (n < 0.01) return `<$0.01`;
  if (n < 1) return `~$${n.toFixed(3)}`;
  return `~$${n.toFixed(2)}`;
};

/**
 * Shown above the trading panel when HyperEVM is congested.
 *
 *   level === 'severe' (chain congested → routing to big blocks):
 *     "Chain congested — we're routing your order via big blocks
 *      (~60s confirmation) to keep fees at ~$X instead of ~$Y."
 *
 *   level === 'normal':
 *     renders nothing.
 *
 * The banner mirrors the SERVER's `recommend` field, so the user's visible
 * state and the actual relayer routing never disagree.
 */
export function CongestionBanner({ className = '', compact = false }: CongestionBannerProps) {
  const { status } = useGasStatus();

  if (!status || !status.ok) return null;
  if (status.level !== 'severe') return null;

  const smallUsd = formatUsd(status.costEstimate.smallUsd);
  const bigUsd = formatUsd(status.costEstimate.bigUsd);

  const palette = {
    bg: 'bg-amber-500/10 border-amber-500/40',
    dot: 'bg-amber-400',
    title: 'text-amber-200',
    body: 'text-amber-100/80',
    accent: 'text-amber-300',
  };

  if (compact) {
    return (
      <div
        className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${palette.bg} ${className}`}
        role="status"
        aria-live="polite"
      >
        <span className={`inline-block h-1.5 w-1.5 rounded-full animate-pulse ${palette.dot}`} />
        <span className={`font-medium ${palette.title}`}>Chain congested</span>
        <span className={`${palette.body}`}>
          Routing via big blocks — order may take ~60s to confirm.
        </span>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border px-3 py-2 ${palette.bg} ${className}`}
      role="status"
      aria-live="polite"
      data-testid="congestion-banner"
      data-level={status.level}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full animate-pulse ${palette.dot}`} />
        <span className={`text-sm font-semibold ${palette.title}`}>
          Chain is congested — handling your order
        </span>
      </div>
      <div className={`mt-1 text-xs leading-snug ${palette.body}`}>
        HyperEVM small-block fees are at{' '}
        <span className={`font-mono ${palette.accent}`}>
          {formatGwei(status.smallBaseFeeGwei)}
        </span>
        . We&apos;re routing your order through the big-block lane (~60s
        confirmation) so you pay{' '}
        <span className={`font-mono ${palette.accent}`}>{bigUsd ?? '~base fee'}</span> instead
        of {smallUsd ?? 'a much higher fee'}. Your order is being handled — no action needed.
      </div>
    </div>
  );
}
