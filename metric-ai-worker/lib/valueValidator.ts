/**
 * Post-extraction value validation and outlier detection.
 *
 * Compares the AI-extracted value against historical context to catch
 * bad scrapes before they poison the data pipeline.
 */

import type { HistoricalStats } from './historicalContext';

export interface ValidationResult {
  valid: boolean;
  /** Confidence cap — if invalid, confidence should be capped at this value */
  maxConfidence: number;
  warnings: string[];
}

/**
 * Validate an extracted numeric value against historical context.
 *
 * Historical data is treated as a *hint*, not ground truth. Prices can
 * legitimately change by orders of magnitude, and stale/sparse historical
 * data should never hard-block a confident extraction. The validator
 * produces warnings and a *soft* confidence adjustment — callers decide
 * how much weight to give it.
 */
export function validateExtractedValue(
  rawValue: string | number | undefined,
  stats: HistoricalStats
): ValidationResult {
  const warnings: string[] = [];
  let maxConfidence = 1.0;

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { valid: false, maxConfidence: 0.1, warnings: ['No value extracted'] };
  }

  const cleaned = typeof rawValue === 'string'
    ? rawValue.replace(/[^0-9.\-+eE]/g, '')
    : String(rawValue);
  const num = Number(cleaned);

  if (!Number.isFinite(num) || Number.isNaN(num)) {
    return { valid: false, maxConfidence: 0.1, warnings: [`Value "${rawValue}" is not a valid number`] };
  }

  if (num <= 0) {
    warnings.push(`Value ${num} is <= 0, which is invalid for a price metric`);
    return { valid: false, maxConfidence: 0.15, warnings };
  }

  if (stats.source === 'none' || stats.count === 0) {
    return { valid: true, maxConfidence: 1.0, warnings: [] };
  }

  // Determine how much trust to place in historical data.
  // A single stale data point deserves much less weight than 10 recent ones.
  const dataAge = stats.lastUpdatedAt
    ? (Date.now() - new Date(stats.lastUpdatedAt).getTime()) / (1000 * 60)
    : Infinity;
  const isStale = dataAge > 60;                // older than 1 hour
  const isVerySparse = stats.count <= 1;        // only 1 observation
  const historyWeight = isStale && isVerySparse ? 0.3
    : isStale ? 0.5
    : isVerySparse ? 0.6
    : 1.0;

  // Z-score check (requires >1 observation with non-zero stdDev)
  if (stats.count > 1 && stats.stdDev > 0) {
    const zScore = Math.abs(num - stats.mean) / stats.stdDev;
    if (zScore > 5) {
      warnings.push(`Z-score ${zScore.toFixed(1)} (>5) — extreme outlier vs recent mean ${stats.mean.toFixed(2)}`);
      maxConfidence = Math.min(maxConfidence, 0.3 + (1 - historyWeight) * 0.5);
    } else if (zScore > 3) {
      warnings.push(`Z-score ${zScore.toFixed(1)} (>3) — significant outlier vs recent mean ${stats.mean.toFixed(2)}`);
      maxConfidence = Math.min(maxConfidence, 0.5 + (1 - historyWeight) * 0.3);
    }
  }

  // Percentage deviation from last known value
  if (stats.lastValue !== null && stats.lastValue > 0) {
    const pctChange = Math.abs(num - stats.lastValue) / stats.lastValue;
    if (pctChange > 0.5) {
      const cap = isStale ? 0.7 : isVerySparse ? 0.5 : 0.3;
      warnings.push(`Value ${num} differs from last known ${stats.lastValue} by ${(pctChange * 100).toFixed(1)}% (>50%)${isStale ? ' [historical data is stale]' : ''}`);
      maxConfidence = Math.min(maxConfidence, cap);
    } else if (pctChange > 0.2) {
      const cap = isStale ? 0.8 : 0.5;
      warnings.push(`Value ${num} differs from last known ${stats.lastValue} by ${(pctChange * 100).toFixed(1)}% (>20%)${isStale ? ' [stale]' : ''}`);
      maxConfidence = Math.min(maxConfidence, cap);
    }
  }

  // Suspicious bounds check — only apply when we have fresh, dense data
  if (!isStale && !isVerySparse && (num < stats.suspiciousBelow || num > stats.suspiciousAbove)) {
    warnings.push(`Value ${num} outside suspicious bounds [${stats.suspiciousBelow.toFixed(2)}, ${stats.suspiciousAbove.toFixed(2)}]`);
    maxConfidence = Math.min(maxConfidence, 0.4);
  }

  return {
    valid: warnings.length === 0,
    maxConfidence,
    warnings,
  };
}

/**
 * Build a "second opinion" prompt addendum when the first extraction was flagged.
 */
export function buildSecondOpinionPrompt(
  originalValue: string,
  warnings: string[],
  stats: HistoricalStats
): string {
  const lines = [
    'IMPORTANT — SECOND OPINION REQUESTED:',
    `Your first extraction returned: ${originalValue}`,
    `However, this value was flagged:`,
    ...warnings.map(w => `  - ${w}`),
  ];
  if (stats.lastValue !== null) {
    lines.push(`The last known value was ${stats.lastValue}.`);
  }
  if (stats.count > 1) {
    lines.push(`Recent range: ${stats.min.toFixed(2)} - ${stats.max.toFixed(2)} (mean: ${stats.mean.toFixed(2)}).`);
  }
  lines.push('Please re-examine all evidence carefully. If the value truly changed this much, explain why. Otherwise, correct your extraction.');
  return lines.join('\n');
}
