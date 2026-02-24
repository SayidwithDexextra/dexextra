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

    // 1b) Raw ticks/trades table (canonical raw stream for OHLCV)
    await exec(
      `CREATE TABLE IF NOT EXISTS ${db}.market_ticks (
        symbol LowCardinality(String),
        ts DateTime('UTC'),
        price Float64,
        size Float64,
        event_type LowCardinality(String),
        is_long UInt8 DEFAULT 1,
        event_id String DEFAULT '',              -- txHash:logIndex, or synthetic id (used for deterministic open/close)
        trade_count UInt32 DEFAULT 1,            -- 1 for real trades, 0 for synthetic candle-derived ticks
        market_id UInt32 DEFAULT 0,
        contract_address LowCardinality(String) DEFAULT '',
        market_uuid LowCardinality(String) DEFAULT ''     -- Supabase markets.id linkage
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(ts)
      ORDER BY (symbol, ts, event_id)
      SETTINGS index_granularity = 8192`,
      `Ensured ${db}.market_ticks table`
    );

    // Ensure new optional columns exist even if the table was created previously
    await exec(
      `ALTER TABLE ${db}.market_ticks ADD COLUMN IF NOT EXISTS event_id String DEFAULT ''`,
      `Ensured ${db}.market_ticks.event_id column`
    );
    await exec(
      `ALTER TABLE ${db}.market_ticks ADD COLUMN IF NOT EXISTS trade_count UInt32 DEFAULT 1`,
      `Ensured ${db}.market_ticks.trade_count column`
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
        market_uuid LowCardinality(String) DEFAULT '',   -- Supabase markets.id linkage
        INDEX idx_market_uuid market_uuid TYPE bloom_filter(0.01) GRANULARITY 4
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(ts)
      ORDER BY (market_uuid, ts)
      TTL ts + INTERVAL 90 DAY DELETE
      SETTINGS index_granularity = 8192`,
      `Ensured ${db}.ohlcv_1m table`
    );
    
    // 3b) Add bloom filter index on market_uuid for existing tables
    try {
      await exec(
        `ALTER TABLE ${db}.ohlcv_1m ADD INDEX IF NOT EXISTS idx_market_uuid market_uuid TYPE bloom_filter(0.01) GRANULARITY 4`,
        `Ensured bloom_filter index on ${db}.ohlcv_1m.market_uuid`
      );
    } catch (e) {
      // Index may already exist, ignore
      console.log(`ℹ️ Bloom filter index already exists or cannot be added`);
    }

    // 4) Materialized view from market_ticks -> 1m candles (deterministic open/close)
    await exec(
      `DROP VIEW IF EXISTS ${db}.mv_ticks_to_1m`,
      `Dropped existing ${db}.mv_ticks_to_1m (if any)`
    );

    await exec(
      `CREATE MATERIALIZED VIEW ${db}.mv_ticks_to_1m
        TO ${db}.ohlcv_1m AS
      SELECT
        symbol,
        toStartOfInterval(ts, INTERVAL 1 MINUTE, 'UTC') AS ts,
        argMin(price, (ts, event_id)) AS open,
        max(price) AS high,
        min(price) AS low,
        argMax(price, (ts, event_id)) AS close,
        sum(size) AS volume,
        sum(trade_count) AS trades,
        market_uuid
      FROM ${db}.market_ticks
      GROUP BY market_uuid, symbol, ts`,
      `Created ${db}.mv_ticks_to_1m (market_ticks → ohlcv_1m)`
    );

    // 5) Pre-aggregated hourly candles table
    // Dramatically reduces scan volume for 1h/4h/1D/1W/1M queries (up to 60x fewer rows).
    // Uses plain MergeTree with first_ts/last_ts for correct open/close across partial batches.
    await exec(
      `CREATE TABLE IF NOT EXISTS ${db}.ohlcv_1h (
        market_uuid LowCardinality(String),
        symbol LowCardinality(String),
        ts DateTime('UTC'),
        open Float64,
        high Float64,
        low Float64,
        close Float64,
        volume Float64,
        trades UInt64,
        first_ts DateTime('UTC'),
        last_ts DateTime('UTC'),
        INDEX idx_market_uuid market_uuid TYPE bloom_filter(0.01) GRANULARITY 4
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(ts)
      ORDER BY (market_uuid, ts)
      TTL ts + INTERVAL 365 DAY DELETE
      SETTINGS index_granularity = 8192`,
      `Ensured ${db}.ohlcv_1h table`
    );

    // 5b) Chained materialized view: ohlcv_1m → ohlcv_1h
    await exec(
      `DROP VIEW IF EXISTS ${db}.mv_1m_to_1h`,
      `Dropped existing ${db}.mv_1m_to_1h (if any)`
    );

    await exec(
      `CREATE MATERIALIZED VIEW ${db}.mv_1m_to_1h
        TO ${db}.ohlcv_1h AS
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
      GROUP BY market_uuid, toStartOfHour(ts) AS hour_ts`,
      `Created ${db}.mv_1m_to_1h (ohlcv_1m → ohlcv_1h)`
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
