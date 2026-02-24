// scripts/backfill-ohlcv-1h.js
// Backfill the pre-aggregated ohlcv_1h table from existing ohlcv_1m data.
// The MV (mv_1m_to_1h) only processes new inserts; this script handles historical data.
//
// Usage:
//   node scripts/backfill-ohlcv-1h.js
//
// Env required:
//   CLICKHOUSE_URL or CLICKHOUSE_HOST
//   CLICKHOUSE_USER / CLICKHOUSE_PASSWORD
//   CLICKHOUSE_DATABASE (optional, default 'default')
//
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@clickhouse/client');

function normalizeUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}:8443`;
}

async function main() {
  const db = process.env.CLICKHOUSE_DATABASE || 'default';
  const rawUrl = process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST;
  const url = normalizeUrl(rawUrl);
  if (!url) {
    console.error('❌ Missing CLICKHOUSE_URL (or CLICKHOUSE_HOST).');
    process.exit(1);
  }

  const clickhouse = createClient({
    url,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: db,
    request_timeout: 120000,
  });

  try {
    // Verify both tables exist
    const srcCheck = await clickhouse.query({ query: `SELECT count() AS c FROM ${db}.ohlcv_1m LIMIT 1`, format: 'JSONEachRow' });
    const srcRows = await srcCheck.json();
    const srcCount = Number(srcRows[0]?.c ?? 0);

    const dstCheck = await clickhouse.query({ query: `SELECT count() AS c FROM ${db}.ohlcv_1h LIMIT 1`, format: 'JSONEachRow' });
    const dstRows = await dstCheck.json();
    const dstCount = Number(dstRows[0]?.c ?? 0);

    console.log(`📊 ohlcv_1m has ${srcCount.toLocaleString()} rows`);
    console.log(`📊 ohlcv_1h has ${dstCount.toLocaleString()} rows`);

    if (srcCount === 0) {
      console.log('ℹ️ ohlcv_1m is empty, nothing to backfill.');
      await clickhouse.close();
      return;
    }

    if (dstCount > 0) {
      console.log('⚠️  ohlcv_1h already has data. Backfilling only missing hours...');
    }

    console.log('🔄 Backfilling ohlcv_1h from ohlcv_1m...');

    const backfillQuery = `
      INSERT INTO ${db}.ohlcv_1h
      SELECT
        market_uuid,
        any(symbol) AS symbol,
        hour_ts AS ts,
        argMin(open, ts) AS open,
        max(high) AS high,
        min(low) AS low,
        argMax(close, ts) AS close,
        sum(volume) AS volume,
        sum(trades) AS trades,
        min(ts) AS first_ts,
        max(ts) AS last_ts
      FROM ${db}.ohlcv_1m
      GROUP BY market_uuid, toStartOfHour(ts) AS hour_ts
    `;

    await clickhouse.exec({ query: backfillQuery });

    const finalCheck = await clickhouse.query({ query: `SELECT count() AS c FROM ${db}.ohlcv_1h`, format: 'JSONEachRow' });
    const finalRows = await finalCheck.json();
    const finalCount = Number(finalRows[0]?.c ?? 0);

    console.log(`✅ Backfill complete. ohlcv_1h now has ${finalCount.toLocaleString()} rows`);
    await clickhouse.close();
  } catch (err) {
    console.error('❌ Backfill failed:', err.message || err);
    await clickhouse.close();
    process.exitCode = 1;
  }
}

main();
