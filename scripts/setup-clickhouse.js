const { ClickHouse } = require("@clickhouse/client");

async function setupClickHouse() {
  console.log("🗄️  Setting up ClickHouse Cloud database...");

  const clickhouse = new ClickHouse({
    host: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE,
  });

  try {
    // Test connection
    await clickhouse.query({ query: "SELECT 1" });
    console.log("✅ ClickHouse connection successful");

    // Create database if not exists
    await clickhouse.query({
      query: `CREATE DATABASE IF NOT EXISTS ${process.env.CLICKHOUSE_DATABASE}`,
    });

    console.log("✅ ClickHouse setup completed");
  } catch (error) {
    console.error("❌ ClickHouse setup failed:", error.message);
    process.exit(1);
  }
}

setupClickHouse();
