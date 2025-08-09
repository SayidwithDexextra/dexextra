require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@clickhouse/client");

async function setupClickHouseTables() {
  console.log("🗄️  Setting up ClickHouse tables for chart data...");

  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || "vamm_analytics",
    request_timeout: 60000, // 60 seconds timeout
    compression: {
      response: false,
      request: false,
    },
  });

  try {
    // Create OHLCV tables for different timeframes
    const timeframes = [
      { name: "1m", interval: "1 MINUTE" },
      { name: "5m", interval: "5 MINUTE" },
      { name: "15m", interval: "15 MINUTE" },
      { name: "30m", interval: "30 MINUTE" },
      { name: "1h", interval: "1 HOUR" },
      { name: "4h", interval: "4 HOUR" },
      { name: "1d", interval: "1 DAY" },
    ];

    for (const tf of timeframes) {
      console.log(`📊 Creating table for ${tf.name} timeframe...`);

      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS vamm_ohlcv_${tf.name} (
          market_symbol String,
          timestamp DateTime,
          open Float64,
          high Float64,
          low Float64,
          close Float64,
          volume Float64,
          trades_count UInt32
        )
        ENGINE = MergeTree()
        ORDER BY (market_symbol, timestamp)
      `;

      await clickhouse.query({ query: createTableQuery });
      console.log(`✅ Table vamm_ohlcv_${tf.name} created`);
    }

    // Create raw transactions table
    console.log("📝 Creating raw transactions table...");
    const transactionsTableQuery = `
      CREATE TABLE IF NOT EXISTS vamm_market_transactions (
        market_id UInt64,
        market_symbol String,
        contract_address String,
        timestamp DateTime,
        block_number UInt64,
        transaction_hash String,
        price Float64,
        size Float64,
        fee Float64,
        user_address String,
        is_long UInt8,
        event_type String
      )
      ENGINE = MergeTree()
      ORDER BY (market_id, timestamp)
    `;

    await clickhouse.query({ query: transactionsTableQuery });
    console.log("✅ Raw transactions table created");

    // Create market metadata table
    console.log("📋 Creating market metadata table...");
    const marketMetaQuery = `
      CREATE TABLE IF NOT EXISTS vamm_market_metadata (
        market_symbol String,
        market_name String,
        contract_address String,
        base_currency String,
        quote_currency String,
        created_at DateTime,
        is_active UInt8
      )
      ENGINE = MergeTree()
      ORDER BY market_symbol
    `;

    await clickhouse.query({ query: marketMetaQuery });
    console.log("✅ Market metadata table created");

    console.log("\n🎉 All ClickHouse tables created successfully!");
    console.log("📝 Ready to insert sample data...");
  } catch (error) {
    console.error("❌ Failed to create ClickHouse tables:", error);
    throw error;
  }
}

if (require.main === module) {
  setupClickHouseTables().catch(console.error);
}

module.exports = { setupClickHouseTables };
