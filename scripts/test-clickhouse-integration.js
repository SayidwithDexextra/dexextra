// test-clickhouse-integration.js
// End-to-end integration test for the new ClickHouse tick-based architecture
// Tests: tick insertion → materialized view aggregation → chart data retrieval

require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@clickhouse/client");

async function testClickHouseIntegration() {
  console.log("🧪 Testing ClickHouse integration...");

  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || "vamm_analytics",
    request_timeout: 60000,
  });

  try {
    // 1. Test tables exist
    console.log("📋 Checking tables exist...");

    const tablesResult = await clickhouse.query({
      query: "SHOW TABLES",
      format: "JSONEachRow",
    });
    const tables = await tablesResult.json();
    const tableNames = tables.map((t) => t.name);

    const requiredTables = ["vamm_ticks", "ohlcv_1m", "ohlcv_5m", "ohlcv_1h"];
    const missingTables = requiredTables.filter(
      (table) => !tableNames.includes(table)
    );

    if (missingTables.length > 0) {
      throw new Error(`Missing tables: ${missingTables.join(", ")}`);
    }
    console.log("✅ All required tables exist");

    // 2. Insert test ticks
    console.log("📊 Inserting test ticks...");

    const testTicks = [];
    const now = new Date();
    const symbol = "TEST";

    // Generate 50 ticks over 30 minutes (to create multiple 1m candles)
    for (let i = 0; i < 50; i++) {
      const tickTime = new Date(now.getTime() - 30 * 60 * 1000 + i * 40 * 1000); // Every 40 seconds
      const basePrice = 2000;
      const priceVariation = Math.sin(i / 10) * 100; // Price wave
      const price = basePrice + priceVariation + (Math.random() - 0.5) * 20; // Add some noise

      testTicks.push({
        symbol,
        ts: tickTime,
        price: parseFloat(price.toFixed(2)),
        size: Math.random() * 100 + 10, // Random size 10-110
        event_type:
          i % 3 === 0
            ? "PositionOpened"
            : i % 3 === 1
            ? "PositionClosed"
            : "PriceUpdated",
        is_long: Math.random() > 0.5 ? 1 : 0,
        market_id: 1,
        contract_address: "0x1234567890123456789012345678901234567890",
      });
    }

    await clickhouse.insert({
      table: "vamm_ticks",
      values: testTicks,
      format: "JSONEachRow",
    });
    console.log(`✅ Inserted ${testTicks.length} test ticks`);

    // 3. Wait for materialized views to process (they should be instant but let's be safe)
    console.log("⏱️  Waiting for materialized views to process...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 4. Check 1m OHLCV data was generated
    console.log("📈 Checking 1m OHLCV aggregation...");

    const ohlcv1mResult = await clickhouse.query({
      query: `
        SELECT 
          symbol,
          ts,
          open,
          high,
          low,
          close,
          volume,
          trades
        FROM ohlcv_1m 
        WHERE symbol = '${symbol}'
        ORDER BY ts ASC
      `,
      format: "JSONEachRow",
    });

    const ohlcv1mData = await ohlcv1mResult.json();
    console.log(`✅ Generated ${ohlcv1mData.length} 1-minute candles`);

    if (ohlcv1mData.length === 0) {
      throw new Error("No 1m OHLCV data generated from ticks");
    }

    // Display sample candle
    const sampleCandle = ohlcv1mData[0];
    console.log("📊 Sample 1m candle:", {
      time: sampleCandle.ts,
      symbol: sampleCandle.symbol,
      open: sampleCandle.open,
      high: sampleCandle.high,
      low: sampleCandle.low,
      close: sampleCandle.close,
      volume: sampleCandle.volume,
      trades: sampleCandle.trades,
    });

    // 5. Check 5m OHLCV data was generated
    console.log("📈 Checking 5m OHLCV aggregation...");

    const ohlcv5mResult = await clickhouse.query({
      query: `
        SELECT 
          symbol,
          ts,
          open,
          high,
          low,
          close,
          volume,
          trades
        FROM ohlcv_5m 
        WHERE symbol = '${symbol}'
        ORDER BY ts ASC
      `,
      format: "JSONEachRow",
    });

    const ohlcv5mData = await ohlcv5mResult.json();
    console.log(`✅ Generated ${ohlcv5mData.length} 5-minute candles`);

    // 6. Test chart API integration
    console.log("🔌 Testing chart API integration...");

    // Test chart data query directly
    const fromTs = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
    const toTs = new Date();

    const chartDataResult = await clickhouse.query({
      query: `
        SELECT 
          symbol,
          ts,
          open,
          high,
          low,
          close,
          volume,
          trades
        FROM ohlcv_1m 
        WHERE symbol = '${symbol}'
          AND ts >= '${fromTs.toISOString().slice(0, 19).replace("T", " ")}'
          AND ts <= '${toTs.toISOString().slice(0, 19).replace("T", " ")}'
        ORDER BY ts ASC
        LIMIT 100
      `,
      format: "JSONEachRow",
    });

    const chartData = await chartDataResult.json();
    console.log(`✅ Chart data query returned ${chartData.length} candles`);

    if (chartData.length === 0) {
      throw new Error("Chart data query returned no data");
    }

    // 7. Test available symbols
    console.log("📋 Testing symbol listing...");

    const symbolsResult = await clickhouse.query({
      query: "SELECT DISTINCT symbol FROM vamm_ticks ORDER BY symbol",
      format: "JSONEachRow",
    });
    const symbolsData = await symbolsResult.json();
    const symbols = symbolsData.map((row) => row.symbol);

    console.log(`✅ Found ${symbols.length} symbols:`, symbols);

    if (!symbols.includes(symbol)) {
      throw new Error(`Test symbol ${symbol} not found in available symbols`);
    }

    // 8. Test latest price
    console.log("💰 Testing latest price retrieval...");

    const latestPriceResult = await clickhouse.query({
      query: `
        SELECT close as price
        FROM ohlcv_1m
        WHERE symbol = '${symbol}'
        ORDER BY ts DESC
        LIMIT 1
      `,
      format: "JSONEachRow",
    });
    const latestPriceData = await latestPriceResult.json();
    const latestPrice =
      latestPriceData.length > 0 ? latestPriceData[0].price : null;

    console.log(`✅ Latest price for ${symbol}: $${latestPrice}`);

    if (!latestPrice || latestPrice <= 0) {
      throw new Error("Invalid latest price returned");
    }

    // 9. Cleanup test data
    console.log("🧹 Cleaning up test data...");

    await clickhouse.exec({
      query: `DELETE FROM vamm_ticks WHERE symbol = '${symbol}'`,
    });

    // Wait for deletion to propagate through materialized views
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("✅ Test data cleaned up");

    console.log("\n🎉 All integration tests passed!");
    console.log(
      "✅ Tick insertion → MV aggregation → Chart queries → Symbol listing all working"
    );

    await clickhouse.close();
  } catch (error) {
    console.error("❌ Integration test failed:", error);
    process.exitCode = 1;
    await clickhouse.close();
  }
}

if (require.main === module) {
  testClickHouseIntegration();
}

module.exports = { testClickHouseIntegration };
