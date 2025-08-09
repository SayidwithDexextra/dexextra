// debug-materialized-views.js
// Debug script to check materialized view setup and manually test aggregation

require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@clickhouse/client");

async function debugMaterializedViews() {
  console.log("🔍 Debugging materialized views...");

  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || "vamm_analytics",
    request_timeout: 60000,
  });

  try {
    // 1. Check if tables exist
    console.log("📋 Checking tables...");

    const tablesResult = await clickhouse.query({
      query: "SHOW TABLES",
      format: "JSONEachRow",
    });
    const tables = await tablesResult.json();
    console.log(
      "Tables:",
      tables.map((t) => t.name)
    );

    // 2. Check if materialized views exist
    console.log("🔍 Checking materialized views...");

    const viewsResult = await clickhouse.query({
      query: "SHOW TABLES WHERE name LIKE 'mv_%'",
      format: "JSONEachRow",
    });
    const views = await viewsResult.json();
    console.log(
      "Materialized views:",
      views.map((v) => v.name)
    );

    // 3. Check vamm_ticks table structure
    console.log("📊 Checking vamm_ticks structure...");

    const ticksStructureResult = await clickhouse.query({
      query: "DESCRIBE vamm_ticks",
      format: "JSONEachRow",
    });
    const ticksStructure = await ticksStructureResult.json();
    console.log("vamm_ticks columns:", ticksStructure);

    // 4. Check ohlcv_1m table structure
    console.log("📈 Checking ohlcv_1m structure...");

    const ohlcvStructureResult = await clickhouse.query({
      query: "DESCRIBE ohlcv_1m",
      format: "JSONEachRow",
    });
    const ohlcvStructure = await ohlcvStructureResult.json();
    console.log("ohlcv_1m columns:", ohlcvStructure);

    // 5. Insert a test tick directly
    console.log("📊 Inserting test tick...");

    const testTick = {
      symbol: "DEBUG",
      ts: new Date(),
      price: 1000,
      size: 100,
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
    console.log("✅ Test tick inserted");

    // 6. Check if tick was inserted
    console.log("🔍 Checking tick insertion...");

    const tickCheckResult = await clickhouse.query({
      query:
        "SELECT * FROM vamm_ticks WHERE symbol = 'DEBUG' ORDER BY ts DESC LIMIT 1",
      format: "JSONEachRow",
    });
    const tickCheck = await tickCheckResult.json();
    console.log("Inserted tick:", tickCheck);

    // 7. Wait and check if OHLCV was generated
    console.log("⏱️  Waiting for materialized view...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const ohlcvCheckResult = await clickhouse.query({
      query:
        "SELECT * FROM ohlcv_1m WHERE symbol = 'DEBUG' ORDER BY ts DESC LIMIT 1",
      format: "JSONEachRow",
    });
    const ohlcvCheck = await ohlcvCheckResult.json();
    console.log("Generated OHLCV:", ohlcvCheck);

    // 8. Manual aggregation test
    console.log("🔧 Testing manual aggregation...");

    const manualAggResult = await clickhouse.query({
      query: `
        SELECT
          symbol,
          toStartOfInterval(ts, INTERVAL 1 MINUTE, 'UTC') AS ts,
          any(price)  AS open,
          max(price)  AS high,
          min(price)  AS low,
          anyLast(price) AS close,
          sum(size)   AS volume,
          count()     AS trades
        FROM vamm_ticks
        WHERE symbol = 'DEBUG'
        GROUP BY symbol, ts
        ORDER BY ts DESC
      `,
      format: "JSONEachRow",
    });
    const manualAgg = await manualAggResult.json();
    console.log("Manual aggregation result:", manualAgg);

    // 9. Check materialized view definition
    console.log("📋 Checking materialized view definition...");

    try {
      const mvDefResult = await clickhouse.query({
        query: "SHOW CREATE TABLE mv_ticks_to_1m",
        format: "JSONEachRow",
      });
      const mvDef = await mvDefResult.json();
      console.log("MV definition:", mvDef);
    } catch (error) {
      console.log("❌ Could not get MV definition:", error.message);
    }

    // 10. Check if materialized view is active
    console.log("🔍 Checking system.tables for MV info...");

    const systemTablesResult = await clickhouse.query({
      query: `
        SELECT name, engine, create_table_query 
        FROM system.tables 
        WHERE name LIKE 'mv_%' OR name LIKE '%ohlcv%'
      `,
      format: "JSONEachRow",
    });
    const systemTables = await systemTablesResult.json();
    console.log("System tables info:", systemTables);

    // Cleanup
    await clickhouse.exec({
      query: "DELETE FROM vamm_ticks WHERE symbol = 'DEBUG'",
    });

    await clickhouse.close();
  } catch (error) {
    console.error("❌ Debug failed:", error);
    await clickhouse.close();
  }
}

if (require.main === module) {
  debugMaterializedViews();
}

module.exports = { debugMaterializedViews };
