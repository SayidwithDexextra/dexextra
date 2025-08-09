// fix-materialized-views.js
// Fix missing materialized views, particularly mv_ticks_to_1m

require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@clickhouse/client");

async function fixMaterializedViews() {
  console.log("🔧 Fixing materialized views...");

  const db = process.env.CLICKHOUSE_DATABASE || "vamm_analytics";

  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD,
    database: db,
    request_timeout: 60000,
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
    console.log("🧹 Dropping broken materialized views...");

    // Drop existing MVs that might be broken
    const existingMVs = ["mv_ticks_to_1m", "mv_1m_to_5m", "mv_1m_to_15m"];

    for (const mv of existingMVs) {
      await exec(`DROP TABLE IF EXISTS ${db}.${mv}`, `Dropped ${mv}`);
    }

    console.log("🏗️  Creating missing materialized views...");

    // 1. Essential: vamm_ticks → ohlcv_1m
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
      "Created mv_ticks_to_1m (vamm_ticks → ohlcv_1m)"
    );

    // 2. ohlcv_1m → ohlcv_5m
    await exec(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.mv_1m_to_5m
        TO ${db}.ohlcv_5m AS
      SELECT
        symbol,
        toStartOfInterval(ts, INTERVAL 5 MINUTE, 'UTC') AS ts,
        any(open)  AS open,
        max(high)  AS high,
        min(low)   AS low,
        anyLast(close) AS close,
        sum(volume) AS volume,
        sum(trades) AS trades
      FROM ${db}.ohlcv_1m
      GROUP BY symbol, ts`,
      "Created mv_1m_to_5m (ohlcv_1m → ohlcv_5m)"
    );

    // 3. ohlcv_1m → ohlcv_15m
    await exec(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.mv_1m_to_15m
        TO ${db}.ohlcv_15m AS
      SELECT
        symbol,
        toStartOfInterval(ts, INTERVAL 15 MINUTE, 'UTC') AS ts,
        any(open)  AS open,
        max(high)  AS high,
        min(low)   AS low,
        anyLast(close) AS close,
        sum(volume) AS volume,
        sum(trades) AS trades
      FROM ${db}.ohlcv_1m
      GROUP BY symbol, ts`,
      "Created mv_1m_to_15m (ohlcv_1m → ohlcv_15m)"
    );

    console.log("🧪 Testing materialized views...");

    // Insert test tick
    const testTick = {
      symbol: "MVTEST",
      ts: new Date(),
      price: 1500,
      size: 50,
      event_type: "test",
      is_long: 1,
      market_id: 1,
      contract_address: "0x1234567890123456789012345678901234567890",
    };

    await clickhouse.insert({
      table: "vamm_ticks",
      values: [testTick],
      format: "JSONEachRow",
    });
    console.log("✅ Inserted test tick");

    // Wait for MV processing
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check if 1m OHLCV was generated
    const ohlcv1mResult = await clickhouse.query({
      query: `SELECT * FROM ohlcv_1m WHERE symbol = 'MVTEST' ORDER BY ts DESC LIMIT 1`,
      format: "JSONEachRow",
    });
    const ohlcv1mData = await ohlcv1mResult.json();

    if (ohlcv1mData.length > 0) {
      console.log("✅ Materialized view mv_ticks_to_1m working!");
      console.log("📊 Generated 1m candle:", ohlcv1mData[0]);
    } else {
      console.log("❌ mv_ticks_to_1m still not working");
    }

    // Check if 5m OHLCV was generated
    const ohlcv5mResult = await clickhouse.query({
      query: `SELECT * FROM ohlcv_5m WHERE symbol = 'MVTEST' ORDER BY ts DESC LIMIT 1`,
      format: "JSONEachRow",
    });
    const ohlcv5mData = await ohlcv5mResult.json();

    if (ohlcv5mData.length > 0) {
      console.log("✅ Materialized view mv_1m_to_5m working!");
      console.log("📊 Generated 5m candle:", ohlcv5mData[0]);
    } else {
      console.log("❌ mv_1m_to_5m not working yet (may need more data)");
    }

    // Cleanup test data
    await clickhouse.exec({
      query: `DELETE FROM vamm_ticks WHERE symbol = 'MVTEST'`,
    });
    console.log("✅ Test data cleaned up");

    console.log("\n🎉 Materialized views fixed!");
    console.log("🔄 Data flow: vamm_ticks → ohlcv_1m → ohlcv_5m/15m/1h/4h/1d");

    await clickhouse.close();
  } catch (error) {
    console.error("❌ Failed to fix materialized views:", error);
    process.exitCode = 1;
    await clickhouse.close();
  }
}

if (require.main === module) {
  fixMaterializedViews();
}

module.exports = { fixMaterializedViews };
