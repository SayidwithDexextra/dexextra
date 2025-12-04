// scripts/setup-orderbook-clickhouse.js
// Create ClickHouse tables/views for order-book markets (trades-first architecture)
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@clickhouse/client");

async function setupOrderbookClickHouse() {
  console.log("📦 Setting up ClickHouse schema for order-book markets...");

  const db = process.env.CLICKHOUSE_DATABASE || "default";
  const rawUrl = process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST;
  const url = normalizeUrl(rawUrl);
  if (!url) {
    throw new Error("Missing CLICKHOUSE_URL (or CLICKHOUSE_HOST).");
  }
  const clickhouse = createClient({
    url,
    username: process.env.CLICKHOUSE_USER || "default",
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
    // 1) Trades table (primary source of truth for OHLCV)
    await exec(
      `CREATE TABLE IF NOT EXISTS ${db}.trades (
        symbol LowCardinality(String),
        ts DateTime('UTC'),
        price Float64,
        size Float64,
        side LowCardinality(String),          -- 'buy' | 'sell'
        maker UInt8 DEFAULT 0,                -- 1 = maker, 0 = taker
        trade_id String DEFAULT '',
        order_id String DEFAULT '',
        market_id UInt32 DEFAULT 0,
        contract_address LowCardinality(String) DEFAULT '',
        market_uuid LowCardinality(String) DEFAULT ''    -- Supabase markets.id linkage
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(ts)
      ORDER BY (symbol, ts)
      SETTINGS index_granularity = 8192`,
      `Ensured ${db}.trades table`
    );

    // Apply TTL retention to trades (180 days)
    await exec(
      `ALTER TABLE ${db}.trades MODIFY TTL ts + INTERVAL 180 DAY DELETE`,
      `Applied TTL to ${db}.trades (180d)`
    );

    // 1b) Legacy/compat: raw vAMM ticks table used by some ingestion paths
    await exec(
      `CREATE TABLE IF NOT EXISTS ${db}.market_ticks (
        symbol LowCardinality(String),
        ts DateTime('UTC'),
        price Float64,
        size Float64,
        event_type LowCardinality(String),
        is_long UInt8 DEFAULT 1,
        market_id UInt32 DEFAULT 0,
        contract_address LowCardinality(String) DEFAULT '',
        market_uuid LowCardinality(String) DEFAULT ''     -- Supabase markets.id linkage
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(ts)
      ORDER BY (symbol, ts)
      SETTINGS index_granularity = 8192`,
      `Ensured ${db}.market_ticks table`
    );

    // Apply TTL retention to market_ticks (180 days)
    await exec(
      `ALTER TABLE ${db}.market_ticks MODIFY TTL ts + INTERVAL 180 DAY DELETE`,
      `Applied TTL to ${db}.market_ticks (180d)`
    );

    // 2) Optional: order book delta stream (for depth/bbo)
    await exec(
      `CREATE TABLE IF NOT EXISTS ${db}.orderbook_deltas (
        symbol LowCardinality(String),
        ts DateTime('UTC'),
        side LowCardinality(String),          -- 'bid' | 'ask'
        price Float64,
        size_delta Float64,                   -- + for place/increase, - for cancel/filled
        action LowCardinality(String),        -- 'place' | 'cancel' | 'fill' | 'reduce'
        order_id String DEFAULT ''
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(ts)
      ORDER BY (symbol, ts, side, price)
      SETTINGS index_granularity = 8192`,
      `Ensured ${db}.orderbook_deltas table`
    );

    // 3) Base 1m candles table (if not already created)
    await exec(
      `CREATE TABLE IF NOT EXISTS ${db}.ohlcv_1m (
        symbol LowCardinality(String),
        ts DateTime('UTC'),
        open Float64,
        high Float64,
        low Float64,
        close Float64,
        volume Float64,
        trades UInt32,
        market_uuid LowCardinality(String) DEFAULT ''   -- Supabase markets.id linkage
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(ts)
      ORDER BY (symbol, ts)
      TTL ts + INTERVAL 90 DAY DELETE
      SETTINGS index_granularity = 8192`,
      `Ensured ${db}.ohlcv_1m table`
    );

    // 4) Materialized view from trades -> 1m candles
    await exec(
      `DROP VIEW IF EXISTS ${db}.mv_trades_to_1m`,
      `Dropped existing ${db}.mv_trades_to_1m (if any)`
    );

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
      `Created ${db}.mv_trades_to_1m (trades → ohlcv_1m)`
    );

    console.log("🎉 Order-book ClickHouse schema setup complete!");
    await clickhouse.close();
  } catch (err) {
    await clickhouse.close();
    process.exitCode = 1;
  }
}

function normalizeUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
    return trimmed;
  // Assume ClickHouse Cloud HTTPS port
  return `https://${trimmed}:8443`;
}

if (require.main === module) {
  setupOrderbookClickHouse();
}

module.exports = { setupOrderbookClickHouse };
