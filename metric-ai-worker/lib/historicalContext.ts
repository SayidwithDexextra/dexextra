/**
 * Historical context lookup for metric values.
 *
 * Fetches the last N data points from ClickHouse (metric_series_1m) or
 * Supabase (market_tickers) and computes statistics so the AI fusion
 * prompt can calibrate expectations and the validator can detect outliers.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export interface HistoricalStats {
  lastValue: number | null;
  lastUpdatedAt: string | null;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  count: number;
  /** Suggested bounds: values outside this range are suspicious (mean ± 3*stdDev, clamped to ±50% of mean) */
  suspiciousBelow: number;
  suspiciousAbove: number;
  source: 'clickhouse' | 'supabase' | 'none';
}

const EMPTY_STATS: HistoricalStats = {
  lastValue: null,
  lastUpdatedAt: null,
  min: 0,
  max: 0,
  mean: 0,
  stdDev: 0,
  count: 0,
  suspiciousBelow: 0,
  suspiciousAbove: Infinity,
  source: 'none',
};

function computeStats(values: number[]): Pick<HistoricalStats, 'min' | 'max' | 'mean' | 'stdDev' | 'suspiciousBelow' | 'suspiciousAbove'> {
  if (values.length === 0) return { min: 0, max: 0, mean: 0, stdDev: 0, suspiciousBelow: 0, suspiciousAbove: Infinity };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  // Suspicious bounds: 3 sigma or ±50% of mean, whichever is wider
  const sigmaLow = mean - 3 * stdDev;
  const sigmaHigh = mean + 3 * stdDev;
  const pctLow = mean * 0.5;
  const pctHigh = mean * 1.5;
  const suspiciousBelow = Math.min(sigmaLow, pctLow);
  const suspiciousAbove = Math.max(sigmaHigh, pctHigh);

  return { min, max, mean, stdDev, suspiciousBelow, suspiciousAbove };
}

async function fetchFromClickHouse(marketId: string, metricName: string): Promise<HistoricalStats | null> {
  const url = (process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST || '').trim();
  if (!url) return null;

  try {
    const { createClient } = await import('@clickhouse/client');
    const chUrl = url.startsWith('http') ? url : `https://${url}:8443`;
    const client = createClient({
      url: chUrl,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD,
      database: process.env.CLICKHOUSE_DATABASE || 'default',
      request_timeout: 5000,
    });

    const safeMarketId = marketId.replace(/'/g, "\\'");
    const safeMetricName = metricName.replace(/'/g, "\\'");

    const query = `
      SELECT ts, argMaxMerge(latest_value) AS v
      FROM metric_series_1m
      WHERE market_id = '${safeMarketId}'
        AND metric_name = '${safeMetricName}'
      GROUP BY ts
      ORDER BY ts DESC
      LIMIT 10
    `;

    const result = await client.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as Array<{ ts: string; v: number }>;

    if (!rows || rows.length === 0) return null;

    const values = rows.map(r => Number(r.v)).filter(Number.isFinite);
    if (values.length === 0) return null;

    const stats = computeStats(values);
    return {
      ...stats,
      lastValue: values[0],
      lastUpdatedAt: rows[0].ts,
      count: values.length,
      source: 'clickhouse',
    };
  } catch (e) {
    console.warn('[HistoricalContext] ClickHouse lookup failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

async function fetchFromSupabase(marketId: string): Promise<HistoricalStats | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;

  try {
    const supabase = createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await supabase
      .from('market_tickers')
      .select('mark_price, last_update')
      .eq('market_id', marketId)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    const raw = Number(data.mark_price);
    if (!Number.isFinite(raw) || raw <= 0) return null;

    // `market_tickers.mark_price` is stored as 6-decimal fixed point (same as on-chain startPrice), not human decimal.
    const price = raw / 1_000_000;

    // With only one data point we can still provide basic context
    return {
      lastValue: price,
      lastUpdatedAt: data.last_update || null,
      min: price,
      max: price,
      mean: price,
      stdDev: 0,
      count: 1,
      suspiciousBelow: price * 0.5,
      suspiciousAbove: price * 1.5,
      source: 'supabase',
    };
  } catch (e) {
    console.warn('[HistoricalContext] Supabase lookup failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Fetch historical stats for a market+metric, trying ClickHouse first, then Supabase.
 */
export async function getHistoricalContext(
  marketId: string,
  metricName?: string
): Promise<HistoricalStats> {
  if (!marketId) return EMPTY_STATS;

  // Try ClickHouse first (richer time-series data)
  if (metricName) {
    const chStats = await fetchFromClickHouse(marketId, metricName);
    if (chStats) return chStats;
  }

  // Fallback to Supabase market_tickers
  const sbStats = await fetchFromSupabase(marketId);
  if (sbStats) return sbStats;

  return EMPTY_STATS;
}

/**
 * Format historical stats into a prompt section for the AI fusion model.
 */
export function formatHistoricalContextForPrompt(stats: HistoricalStats): string {
  if (stats.source === 'none' || stats.count === 0) {
    return 'HISTORICAL CONTEXT: No prior observations available. Cannot provide expected range.';
  }

  const lines = ['HISTORICAL CONTEXT:'];
  if (stats.lastValue !== null) {
    lines.push(`- Last known value: ${stats.lastValue}${stats.lastUpdatedAt ? ` (at ${stats.lastUpdatedAt})` : ''}`);
  }
  if (stats.count > 1) {
    lines.push(`- Recent range: ${stats.min.toFixed(2)} - ${stats.max.toFixed(2)} (${stats.count} observations)`);
    lines.push(`- Mean: ${stats.mean.toFixed(2)}, StdDev: ${stats.stdDev.toFixed(2)}`);
  }
  lines.push(`- Suspicious bounds: values below ${stats.suspiciousBelow.toFixed(2)} or above ${stats.suspiciousAbove.toFixed(2)} are likely wrong`);
  lines.push(`- If your result differs significantly from the historical range, explain why in your reasoning.`);
  lines.push(`- Source: ${stats.source}`);

  return lines.join('\n');
}
