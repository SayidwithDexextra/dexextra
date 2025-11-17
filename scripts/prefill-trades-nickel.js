require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@clickhouse/client");

function ensureUrl(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}:8443`;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

async function main() {
  const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  const database = process.env.CLICKHOUSE_DATABASE || "default";
  const username = process.env.CLICKHOUSE_USER || "default";
  const password = process.env.CLICKHOUSE_PASSWORD || "";

  if (!url) {
    console.error("Missing CLICKHOUSE_URL/CLICKHOUSE_HOST");
    process.exit(1);
  }

  const client = createClient({
    url,
    database,
    username,
    password,
    request_timeout: 60000,
  });

  const symbol = "NICKEL";

  // 1) Clean previous synthetic data for this symbol
  try {
    await client.exec({
      query: `ALTER TABLE ${database}.trades DELETE WHERE symbol = '${symbol}'`,
    });
    console.log(`🧹 Requested deletion of existing ${symbol} trades (async in CH).`);
  } catch (e) {
    console.warn("⚠️ Delete step failed (continuing):", e?.message || e);
  }

  // 2) Generate incremental path from $1 to max $5 with mixed up/down segments
  // Settings
  const points = 360; // 3 hours at 30s intervals
  const intervalSec = 30;
  const now = Date.now();
  const startTs = now - points * intervalSec * 1000;

  const trades = [];
  let price = 1.0;
  let segmentRemaining = 0;
  let dir = 1; // 1=up, -1=down
  let stepMag = 0.01; // price step within segment

  const upwardDriftPerStep = (4.0 / points); // ensure we approach 5.0 overall

  for (let i = 0; i < points; i++) {
    const tsMs = startTs + i * intervalSec * 1000;

    // Reset segment periodically with random direction to create up/down trends
    if (segmentRemaining <= 0) {
      segmentRemaining = Math.floor(randomBetween(5, 25));
      dir = Math.random() < 0.5 ? -1 : 1;
      stepMag = randomBetween(0.005, 0.03);
    }

    // Apply drift up + segment step + tiny noise
    const prev = price;
    price += upwardDriftPerStep;
    price += dir * stepMag;
    price += randomBetween(-0.003, 0.003);

    // Clamp to [1, 5]
    if (price > 5) price = 5;
    if (price < 1) price = 1;

    segmentRemaining -= 1;

    const side = price >= prev ? "buy" : "sell";
    const size = Number(randomBetween(0.1, 2.0).toFixed(3));
    const maker = Math.random() < 0.5 ? 1 : 0;

    trades.push({
      symbol,
      ts: new Date(tsMs),
      price: Number(price.toFixed(4)),
      size,
      side,
      maker,
      trade_id: `nickel_inc_${tsMs}_${i}`,
      order_id: "",
      market_id: 0,
      contract_address: "",
    });
  }

  try {
    await client.insert({
      table: "trades",
      values: trades,
      format: "JSONEachRow",
    });
    console.log(`✅ Inserted ${trades.length} NICKEL incremental trades into ${database}.trades`);
  } catch (e) {
    console.error("❌ Insert failed:", e?.message || e);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}


