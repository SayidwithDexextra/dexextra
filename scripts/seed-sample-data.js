require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@clickhouse/client");
const { setupClickHouseTables } = require("./setup-clickhouse-tables");

async function seedSampleData() {
  console.log("🌱 Seeding sample market data...");

  // First ensure tables exist
  await setupClickHouseTables();

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
    // Sample markets to create
    const markets = [
      { symbol: "BTC", name: "Bitcoin", basePrice: 50000, volatility: 0.05 },
      { symbol: "ETH", name: "Ethereum", basePrice: 3000, volatility: 0.06 },
      {
        symbol: "GOLD",
        name: "Gold Futures",
        basePrice: 2000,
        volatility: 0.02,
      },
    ];

    // Insert market metadata
    console.log("📋 Inserting market metadata...");
    for (const market of markets) {
      const metaQuery = `
        INSERT INTO vamm_market_metadata 
        (market_symbol, market_name, contract_address, base_currency, quote_currency, created_at, is_active)
        VALUES 
        ('${market.symbol}', '${market.name}', '0x${Math.random()
        .toString(16)
        .substr(2, 40)}', '${market.symbol}', 'USDC', toDateTime('${new Date()
        .toISOString()
        .slice(0, 19)}'), 1)
      `;

      await clickhouse.query({ query: metaQuery });
      console.log(`✅ ${market.symbol} metadata inserted`);
    }

    // Generate OHLCV data for the last 7 days
    const now = new Date();
    const startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    for (const market of markets) {
      console.log(`📊 Generating ${market.symbol} OHLCV data...`);

      // Generate 1-hour data points
      const hourlyData = [];
      let currentPrice = market.basePrice;

      for (
        let time = startTime;
        time <= now;
        time = new Date(time.getTime() + 60 * 60 * 1000)
      ) {
        // Simulate price movement with random walk
        const change = (Math.random() - 0.5) * market.volatility * 2;
        currentPrice = currentPrice * (1 + change);

        // Ensure positive price
        currentPrice = Math.max(currentPrice, market.basePrice * 0.1);

        // Generate OHLC around current price
        const variance = currentPrice * market.volatility * 0.5;
        const open = currentPrice + (Math.random() - 0.5) * variance;
        const close = currentPrice + (Math.random() - 0.5) * variance;
        const high = Math.max(open, close) + Math.random() * variance * 0.5;
        const low = Math.min(open, close) - Math.random() * variance * 0.5;
        const volume = Math.random() * 1000000 + 100000; // 100K to 1M volume
        const trades = Math.floor(Math.random() * 500) + 50; // 50-550 trades

        hourlyData.push({
          timestamp: time.toISOString().slice(0, 19),
          open: open.toFixed(2),
          high: high.toFixed(2),
          low: low.toFixed(2),
          close: close.toFixed(2),
          volume: volume.toFixed(2),
          trades_count: trades,
        });

        currentPrice = close; // Update for next iteration
      }

      // Insert hourly data
      if (hourlyData.length > 0) {
        const insertQuery = `
          INSERT INTO vamm_ohlcv_1h 
          (market_symbol, timestamp, open, high, low, close, volume, trades_count)
          VALUES
          ${hourlyData
            .map(
              (row) =>
                `('${market.symbol}', '${row.timestamp}', ${row.open}, ${row.high}, ${row.low}, ${row.close}, ${row.volume}, ${row.trades_count})`
            )
            .join(",\n          ")}
                 `;

        await clickhouse.query({ query: insertQuery });
        console.log(
          `✅ ${market.symbol}: ${hourlyData.length} hourly records inserted`
        );
      }

      // Generate more granular 1-minute data for the last 24 hours
      console.log(`📈 Generating recent 1m data for ${market.symbol}...`);
      const recent24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const minuteData = [];

      // Start from the last hourly close price
      let minutePrice = hourlyData[hourlyData.length - 1]
        ? parseFloat(hourlyData[hourlyData.length - 1].close)
        : currentPrice;

      for (
        let time = recent24h;
        time <= now;
        time = new Date(time.getTime() + 60 * 1000)
      ) {
        // Smaller price movements for 1-minute data
        const change = (Math.random() - 0.5) * market.volatility * 0.1;
        minutePrice = minutePrice * (1 + change);

        const variance = minutePrice * market.volatility * 0.05;
        const open = minutePrice + (Math.random() - 0.5) * variance;
        const close = minutePrice + (Math.random() - 0.5) * variance;
        const high = Math.max(open, close) + Math.random() * variance * 0.2;
        const low = Math.min(open, close) - Math.random() * variance * 0.2;
        const volume = Math.random() * 50000 + 1000; // 1K to 50K volume per minute
        const trades = Math.floor(Math.random() * 20) + 1; // 1-20 trades per minute

        minuteData.push({
          timestamp: time.toISOString().slice(0, 19),
          open: open.toFixed(2),
          high: high.toFixed(2),
          low: low.toFixed(2),
          close: close.toFixed(2),
          volume: volume.toFixed(2),
          trades_count: trades,
        });

        minutePrice = close;
      }

      // Insert minute data in batches
      const batchSize = 1000;
      for (let i = 0; i < minuteData.length; i += batchSize) {
        const batch = minuteData.slice(i, i + batchSize);
        const insertQuery = `
          INSERT INTO vamm_ohlcv_1m 
          (market_symbol, timestamp, open, high, low, close, volume, trades_count)
          VALUES
          ${batch
            .map(
              (row) =>
                `('${market.symbol}', '${row.timestamp}', ${row.open}, ${row.high}, ${row.low}, ${row.close}, ${row.volume}, ${row.trades_count})`
            )
            .join(",\n          ")}
                  `;

        await clickhouse.query({ query: insertQuery });
      }

      console.log(
        `✅ ${market.symbol}: ${minuteData.length} minute records inserted`
      );
    }

    console.log("\n🎉 Sample data seeded successfully!");
    console.log("📊 You now have:");
    console.log("   • 3 markets (BTC, ETH, GOLD)");
    console.log("   • 7 days of hourly data");
    console.log("   • 24 hours of minute-by-minute data");
    console.log("   • Realistic price movements with volatility");
    console.log("\n🚀 Ready to test your charts!");
  } catch (error) {
    console.error("❌ Failed to seed sample data:", error);
    throw error;
  }
}

if (require.main === module) {
  seedSampleData().catch(console.error);
}

module.exports = { seedSampleData };
