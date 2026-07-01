/** Shared formatters for research segments. Pure, deterministic, no I/O. */

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

/** A probability in [0, 1] → percentage string, e.g. 0.62 → "62%". */
export function formatProbability(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

/** A probability in [0, 1] → cents string, e.g. 0.62 → "62¢". */
export function formatCents(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}\u00A2`;
}

/** Signed gap in [-1, 1] → "+6 pts" / "-4 pts". */
export function formatGapPoints(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const pts = Math.round(value * 100);
  const sign = pts > 0 ? '+' : '';
  return `${sign}${pts} pts`;
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
