// scripts/migrate-add-market-uuid.js
// Adds a Supabase markets.id linkage column (market_uuid) to key ClickHouse tables.
// This mirrors how scatter points store the Supabase market reference and enables
// cross-system lineage by market ID while keeping existing numeric market_id columns.
//
// Usage:
//   node scripts/migrate-add-market-uuid.js
//
// Requirements:
//   - CLICKHOUSE_URL or CLICKHOUSE_HOST
//   - CLICKHOUSE_USER, CLICKHOUSE_PASSWORD (if needed)
//   - CLICKHOUSE_DATABASE (defaults to 'default')
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
    console.error('❌ Missing CLICKHOUSE_URL (or CLICKHOUSE_HOST). Aborting.');
    process.exit(1);
  }

  const clickhouse = createClient({
    url,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: db,
    request_timeout: 60000,
  });

  async function exec(query, info) {
    try {
      await clickhouse.exec({ query });
      console.log(`✅ ${info}`);
    } catch (err) {
      console.error(`❌ ${info} failed:`, err.message || err);
      throw err;
    }
  }

  try {
    console.log('🛠️  Adding market_uuid to ClickHouse tables (id linkage to Supabase markets)...');

    // Helpers
    async function tableExists(name) {
      try {
        const res = await clickhouse.query({
          query: `SELECT 1 FROM system.tables WHERE database='${db}' AND name='${name}' LIMIT 1`,
          format: 'JSONEachRow'
        });
        const rows = await res.json();
        return Array.isArray(rows) && rows.length > 0;
      } catch {
        return false;
      }
    }

    // Target tables: trades (order-book), market_ticks (legacy ticks), vamm_ticks (legacy; optional)
    const targets = ['trades', 'market_ticks', 'vamm_ticks'];
    for (const table of targets) {
      if (await tableExists(table)) {
        await exec(
          `ALTER TABLE ${db}.${table} ADD COLUMN IF NOT EXISTS market_uuid LowCardinality(String) DEFAULT ''`,
          `Added market_uuid to ${db}.${table}`
        );
      } else {
        console.log(`ℹ️  Skipping ${db}.${table} (table does not exist)`);
      }
    }

    // Add to ohlcv_1m base table
    if (await tableExists('ohlcv_1m')) {
      await exec(
        `ALTER TABLE ${db}.ohlcv_1m ADD COLUMN IF NOT EXISTS market_uuid LowCardinality(String) DEFAULT ''`,
        `Added market_uuid to ${db}.ohlcv_1m`
      );
    } else {
      console.log(`ℹ️  Skipping ${db}.ohlcv_1m (table does not exist)`);
    }

    // Helper: check if a materialized view exists
    async function viewExists(name) {
      try {
        const res = await clickhouse.query({
          query: `SELECT 1 FROM system.tables WHERE database='${db}' AND name='${name}' AND engine='MaterializedView' LIMIT 1`,
          format: 'JSONEachRow'
        });
        const rows = await res.json();
        return Array.isArray(rows) && rows.length > 0;
      } catch {
        return false;
      }
    }

    // Recreate mv_trades_to_1m if present (include market_uuid)
    if (await viewExists('mv_trades_to_1m')) {
      await exec(`DROP VIEW IF EXISTS ${db}.mv_trades_to_1m`, `Dropped ${db}.mv_trades_to_1m`);
      await exec(
        `CREATE MATERIALIZED VIEW ${db}.mv_trades_to_1m
          TO ${db}.ohlcv_1m AS
        SELECT
          symbol,
          toStartOfInterval(ts, INTERVAL 1 MINUTE, 'UTC') AS ts,
          any(price) AS open,
          max(price) AS high,
          min(price) AS low,
          anyLast(price) AS close,
          sum(size) AS volume,
          count() AS trades,
          anyLast(market_uuid) AS market_uuid
        FROM ${db}.trades
        GROUP BY symbol, ts`,
        `Recreated ${db}.mv_trades_to_1m with market_uuid`
      );
    }

    // Recreate mv_ticks_to_1m if present (include market_uuid)
    if (await viewExists('mv_ticks_to_1m')) {
      await exec(`DROP VIEW IF EXISTS ${db}.mv_ticks_to_1m`, `Dropped ${db}.mv_ticks_to_1m`);
      await exec(
        `CREATE MATERIALIZED VIEW ${db}.mv_ticks_to_1m
          TO ${db}.ohlcv_1m AS
        SELECT
          symbol,
          toStartOfInterval(ts, INTERVAL 1 MINUTE, 'UTC') AS ts,
          any(price) AS open,
          max(price) AS high,
          min(price) AS low,
          anyLast(price) AS close,
          sum(size) AS volume,
          count() AS trades,
          anyLast(market_uuid) AS market_uuid
        FROM ${db}.vamm_ticks
        GROUP BY symbol, ts`,
        `Recreated ${db}.mv_ticks_to_1m with market_uuid`
      );
    }

    console.log('🎉 Migration complete.');
    await clickhouse.close();
  } catch (e) {
    console.error('❌ Migration failed:', e);
    process.exitCode = 1;
    try {
      await clickhouse.close();
    } catch {}
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
