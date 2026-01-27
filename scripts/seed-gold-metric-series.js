require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@clickhouse/client');

function ensureUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}

function formatDateTime64Ms(ms) {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = '1';
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  // From Supabase (public.markets / orderbook_markets_view):
  // id = 43d832a7-f439-4e94-933d-b05ef4c963fd, metric_id = GOLD
  const marketId = String(args.marketId || '43d832a7-f439-4e94-933d-b05ef4c963fd').trim();
  const metricName = String(args.metricName || 'GOLD').trim().toUpperCase();
  const timeframe = String(args.timeframe || '5m').trim().toLowerCase();

  const pointsRaw = Number(args.points || 0);
  const points =
    Number.isFinite(pointsRaw) && pointsRaw > 0 ? Math.min(Math.floor(pointsRaw), 5000) : 576; // ~2 days of 5m

  // Seed near a plausible GC-ish value. (Your `markets.initial_order.startPrice` is 4470.5.)
  const baseRaw = Number(args.base || 4470.5);
  const base = Number.isFinite(baseRaw) ? baseRaw : 4470.5;
  const ampRaw = Number(args.amp || Math.max(5, base * 0.002));
  const amp = Number.isFinite(ampRaw) ? ampRaw : Math.max(5, base * 0.002);

  const stepMs =
    timeframe === '1m'
      ? 60_000
      : timeframe === '5m'
        ? 5 * 60_000
        : timeframe === '15m'
          ? 15 * 60_000
          : timeframe === '30m'
            ? 30 * 60_000
            : timeframe === '1h'
              ? 60 * 60_000
              : timeframe === '4h'
                ? 4 * 60 * 60_000
                : 24 * 60 * 60_000; // 1d

  const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  if (!url) {
    throw new Error('Missing CLICKHOUSE_URL / CLICKHOUSE_HOST in environment');
  }

  const client = createClient({
    url,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || 'default',
    request_timeout: 30000,
  });

  const endAligned = Math.floor(Date.now() / stepMs) * stepMs;
  const startMs = endAligned - (points - 1) * stepMs;

  const versionBase = (Date.now() % 2_147_483_647) >>> 0;
  const rows = [];
  for (let i = 0; i < points; i++) {
    const ts = startMs + i * stepMs;
    const phase = i / 12;
    const drift = (i / points - 0.5) * amp * 0.25;
    const value = base + Math.sin(phase) * amp + 0.35 * Math.sin(phase / 3) * amp + drift;
    rows.push({
      market_id: marketId,
      metric_name: metricName,
      ts: formatDateTime64Ms(ts),
      value: Number(value.toFixed(6)),
      source: 'seed_gold_metric_series',
      version: (versionBase + i) % 2_147_483_647,
    });
  }

  console.log('[seed-gold-metric-series] inserting', { marketId, metricName, timeframe, points });
  await client.insert({
    table: 'metric_series_raw',
    values: rows,
    format: 'JSONEachRow',
  });

  // Best-effort verification: query finalized 1m table for presence.
  try {
    const q = `
      SELECT count() AS n
      FROM metric_series_1m
      WHERE market_id = '${marketId.replace(/'/g, "\\'")}'
        AND metric_name = '${metricName.replace(/'/g, "\\'")}'
    `;
    const res = await client.query({ query: q, format: 'JSONEachRow' });
    const out = await res.json();
    const n = Array.isArray(out) && out[0] ? Number(out[0].n) : 0;
    console.log('[seed-gold-metric-series] metric_series_1m count', { n });
  } catch (e) {
    console.warn('[seed-gold-metric-series] verify failed (ok to ignore):', e?.message || e);
  }

  await client.close();
  console.log('[seed-gold-metric-series] done');
}

main().catch((e) => {
  console.error('[seed-gold-metric-series] error:', e?.message || e);
  process.exit(1);
});

