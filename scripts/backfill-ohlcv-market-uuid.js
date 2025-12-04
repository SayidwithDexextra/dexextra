// scripts/backfill-ohlcv-market-uuid.js
// Backfill ohlcv_1m.market_uuid for rows belonging to a specific market UUID.
// Resolves the market's symbol from Supabase, then updates ClickHouse.
//
// Usage:
//   node scripts/backfill-ohlcv-market-uuid.js <market_uuid> [symbol_override]
//
// Env required:
//   CLICKHOUSE_URL or CLICKHOUSE_HOST (+ CLICKHOUSE_USER/PASSWORD if needed)
//   CLICKHOUSE_DATABASE (optional, default 'default')
//   SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (recommended to resolve symbol)
//
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@clickhouse/client');
const { createClient: createSbClient } = require('@supabase/supabase-js');

function normalizeUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}:8443`;
}

async function main() {
  const marketUuid = process.argv[2] || process.env.BACKFILL_MARKET_UUID;
  const symbolOverride = process.argv[3] || process.env.BACKFILL_SYMBOL;
  if (!marketUuid) {
    console.error('❌ Usage: node scripts/backfill-ohlcv-market-uuid.js <market_uuid> [symbol_override]');
    process.exit(1);
  }

  const db = process.env.CLICKHOUSE_DATABASE || 'default';
  const url = normalizeUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  if (!url) {
    console.error('❌ Missing CLICKHOUSE_URL (or CLICKHOUSE_HOST). Aborting.');
    process.exit(1);
  }

  const ch = createClient({
    url,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: db,
    request_timeout: 60000,
  });

  async function exec(query, info) {
    try {
      await ch.exec({ query });
      console.log(`✅ ${info}`);
    } catch (err) {
      console.error(`❌ ${info} failed:`, err?.message || err);
      throw err;
    }
  }
  async function query(query, info) {
    try {
      const res = await ch.query({ query, format: 'JSONEachRow' });
      const rows = await res.json();
      console.log(`✅ ${info}`);
      console.log(JSON.stringify(rows, null, 2));
      return rows;
    } catch (err) {
      console.error(`❌ ${info} failed:`, err?.message || err);
      throw err;
    }
  }

  // Resolve symbol from Supabase unless overridden
  let symbol = symbolOverride;
  if (!symbol) {
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!sbUrl || !sbKey) {
      console.error('❌ Supabase not configured; provide [symbol_override] arg or set BACKFILL_SYMBOL.');
      process.exit(1);
    }
    const sb = createSbClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: m, error } = await sb
      .from('markets')
      .select('symbol')
      .eq('id', marketUuid)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('❌ Failed to resolve symbol from Supabase:', error?.message || error);
      process.exit(1);
    }
    if (!m?.symbol) {
      console.error('❌ Unknown market UUID in Supabase.');
      process.exit(1);
    }
    symbol = String(m.symbol).toUpperCase();
  }

  console.log(`🔎 Backfilling ohlcv_1m.market_uuid for market ${marketUuid} (symbol=${symbol})`);

  try {
    // Preview before update
    await query(
      `
      SELECT
        count() AS total_rows,
        sum(market_uuid = '' OR market_uuid IS NULL) AS rows_without_uuid,
        min(ts) AS min_ts,
        max(ts) AS max_ts
      FROM ${db}.ohlcv_1m
      WHERE symbol = '${symbol}'
      `,
      'Preview before update'
    );

    // Perform backfill (idempotent)
    await exec(
      `
      ALTER TABLE ${db}.ohlcv_1m
      UPDATE market_uuid = '${marketUuid}'
      WHERE symbol = '${symbol}' AND (market_uuid = '' OR market_uuid IS NULL)
      `,
      'Backfilled market_uuid in ohlcv_1m'
    );

    // Verify after update
    await query(
      `
      SELECT
        market_uuid,
        count() AS rows
      FROM ${db}.ohlcv_1m
      WHERE symbol = '${symbol}'
      GROUP BY market_uuid
      ORDER BY rows DESC
      LIMIT 10
      `,
      'Verification after update (group by market_uuid)'
    );

    // Show sample rows
    await query(
      `
      SELECT symbol, ts, open, high, low, close, volume, trades, market_uuid
      FROM ${db}.ohlcv_1m
      WHERE symbol = '${symbol}' AND market_uuid = '${marketUuid}'
      ORDER BY ts DESC
      LIMIT 5
      `,
      'Sample rows with backfilled market_uuid'
    );
  } finally {
    await ch.close();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ Backfill failed:', e?.message || e);
    process.exit(1);
  });
}


