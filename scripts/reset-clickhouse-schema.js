// reset-clickhouse-schema.js
// Script to reset ClickHouse schema to the new market-data architecture.
// ---------------------------------------------------------------
// 1. Drops legacy tables (if they exist)
// 2. Creates raw tick table (vamm_ticks)
// 3. Creates 1-minute OHLCV table with TTL
// 4. Creates aggregated OHLCV tables (5m, 15m, 1h, 4h, 1d)
// 5. Creates Materialized Views to roll up data
// ---------------------------------------------------------------

require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@clickhouse/client");

async function resetSchema() {
  const db = process.env.CLICKHOUSE_DATABASE || "vamm_analytics";

  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD,
    database: db,
    request_timeout: 60000,
    compression: {
      response: false,
      request: false,
    },
  });

  // Helper to run query with logging
  async function exec(query, info) {
    try {
      await clickhouse.exec({ query });
      console.log(`✅ ${info}`);
    } catch (err) {
      console.error(`❌ Failed ${info}:`, err.message || err);
      throw err;
    }
  }

  try {
    console.log("🧹 Dropping legacy tables if they exist...");
    const legacy = [
      "vamm_price_events",
      "vamm_ohlcv_1m",
      "vamm_ohlcv_5m",
      "vamm_ohlcv_15m",
      "vamm_ohlcv_1h",
      "vamm_ohlcv_4h",
      "vamm_ohlcv_1d",
    ];

    for (const tbl of legacy) {
      await exec(`DROP TABLE IF EXISTS ${db}.${tbl}`, `Dropped ${tbl}`);
    }

    // Also drop any existing MVs
    const legacyViews = [
      "mv_ticks_to_1m",
      "mv_1m_to_5m",
      "mv_1m_to_15m",
      "mv_1m_to_1h",
      "mv_1m_to_4h",
      "mv_1m_to_1d",
    ];
    for (const mv of legacyViews) {
      await exec(`DROP TABLE IF EXISTS ${db}.${mv}`, `Dropped MV ${mv}`);
    }

    console.log("🏗️  Creating new tables...");

    // 1. Raw tick table
    await exec(
      `CREATE TABLE IF NOT EXISTS ${db}.vamm_ticks (
        symbol LowCardinality(String),
        ts DateTime('UTC'),
        price Float64,
        size Float64,
        event_type LowCardinality(String),
        is_long UInt8,
        market_id UInt64,
        contract_address String
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(ts)
      ORDER BY (symbol, ts)`,
      "Created vamm_ticks"
    );

    // 2. 1-minute OHLCV table with TTL to slow volume after 90 days
    await exec(
      `CREATE TABLE IF NOT EXISTS ${db}.ohlcv_1m (
        symbol LowCardinality(String),
        ts DateTime('UTC'),
        open Float64,
        high Float64,
        low  Float64,
        close Float64,
        volume Float64,
        trades UInt32
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(ts)
      ORDER BY (symbol, ts)
      TTL ts + INTERVAL 90 DAY DELETE`,
      "Created ohlcv_1m"
    );

    // 3. Materialized view to roll up ticks → 1m candles
    await exec(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.mv_ticks_to_1m
        TO ${db}.ohlcv_1m AS
      SELECT
        symbol,
        toStartOfInterval(ts, INTERVAL 1 MINUTE, 'UTC') AS ts,
        any(price)  AS open,
        max(price)  AS high,
        min(price)  AS low,
        anyLast(price) AS close,
        sum(size)   AS volume,
        count()     AS trades
      FROM ${db}.vamm_ticks
      GROUP BY symbol, ts`,
      "Created MV ticks_to_1m"
    );

    // 4. Higher timeframes
    const higher = [
      { name: "5m", interval: "5 MINUTE" },
      { name: "15m", interval: "15 MINUTE" },
      { name: "1h", interval: "1 HOUR" },
      { name: "4h", interval: "4 HOUR" },
      { name: "1d", interval: "1 DAY" },
    ];

    for (const tf of higher) {
      // Table
      await exec(
        `CREATE TABLE IF NOT EXISTS ${db}.ohlcv_${tf.name} AS ${db}.ohlcv_1m`,
        `Created ohlcv_${tf.name}`
      );

      // MV
      await exec(
        `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.mv_1m_to_${tf.name}
          TO ${db}.ohlcv_${tf.name} AS
        SELECT
          symbol,
          toStartOfInterval(ts, INTERVAL ${tf.interval}, 'UTC') AS ts,
          any(open)  AS open,
          max(high)  AS high,
          min(low)   AS low,
          anyLast(close) AS close,
          sum(volume) AS volume,
          sum(trades) AS trades
        FROM ${db}.ohlcv_1m
        GROUP BY symbol, ts`,
        `Created MV 1m_to_${tf.name}`
      );
    }

    console.log("🎉 Schema reset complete.");
    await clickhouse.close();
  } catch (err) {
    console.error("Fatal error resetting ClickHouse schema:", err);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  resetSchema();
}

module.exports = { resetSchema };
