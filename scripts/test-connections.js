require("dotenv").config();
const { ClickHouse } = require("@clickhouse/client");
const { Redis } = require("@upstash/redis");
const Pusher = require("pusher");

async function testConnections() {
  console.log("🔍 Testing cloud service connections...\n");

  console.log("CLICKHOUSE_HOST:", process.env.CLICKHOUSE_HOST);
  console.log("CLICKHOUSE_USER:", process.env.CLICKHOUSE_USER);
  console.log("CLICKHOUSE_PASSWORD:", process.env.CLICKHOUSE_PASSWORD);
  console.log("CLICKHOUSE_DATABASE:", process.env.CLICKHOUSE_DATABASE);

  // Test ClickHouse
  try {
    const clickhouse = new ClickHouse({
      host: process.env.CLICKHOUSE_HOST,
      username: process.env.CLICKHOUSE_USER,
      password: process.env.CLICKHOUSE_PASSWORD,
      database: process.env.CLICKHOUSE_DATABASE,
    });

    const result = await clickhouse.query({
      query: "SELECT version() as version",
    });
    const data = await result.json();
    console.log("✅ ClickHouse Cloud: Connected");
    console.log(`   Version: ${data.data[0].version}`);
  } catch (error) {
    console.log("❌ ClickHouse Cloud: Failed");
    console.log(`   Error: ${error.message}`);
  }

  // Test Upstash Redis
  try {
    const redis = Redis.fromEnv();
    await redis.set("test", "connection-test");
    const result = await redis.get("test");

    if (result === "connection-test") {
      console.log("✅ Upstash Redis: Connected");
      await redis.del("test");
    } else {
      console.log("❌ Upstash Redis: Failed (unexpected response)");
    }
  } catch (error) {
    console.log("❌ Upstash Redis: Failed");
    console.log(`   Error: ${error.message}`);
  }

  // Test Pusher
  try {
    const pusher = new Pusher({
      appId: process.env.PUSHER_APP_ID,
      key: process.env.PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER,
      useTLS: true,
    });

    await pusher.trigger("test-channel", "test-event", { test: "data" });
    console.log("✅ Pusher: Connected");
  } catch (error) {
    console.log("❌ Pusher: Failed");
    console.log(`   Error: ${error.message}`);
  }

  console.log("\n🎉 Connection testing completed!");
}

testConnections();
