require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@clickhouse/client");

function ensureUrl(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}:8443`;
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

  try {
    // Get last price and timestamp for NICKEL
    const q = await client.query({
      query: `
        SELECT price, ts
        FROM ${database}.trades
        WHERE symbol = 'NICKEL'
        ORDER BY ts DESC
        LIMIT 1
      `,
      format: "JSONEachRow",
    });
    const rows = await q.json();
    const startPrice = rows[0]?.price ?? 1.0;
    const startTs = rows[0]?.ts ? new Date(rows[0].ts).getTime() : Date.now();

    const points = 120; // add another hour to reach $5 with small dips
    const intervalSec = 30;
    const trades = [];

    for (let i = 0; i < points; i++) {
      const progress = i / (points - 1);
      // Linear path to 5 with small oscillation
      const base = startPrice + (5 - startPrice) * progress;
      const wiggle = (Math.sin(i / 7) * 0.03) + (Math.sin(i / 13) * 0.02);
      let price = base + wiggle;
      if (price > 5) price = 5;
      if (price < 1) price = 1;

      const tsMs = startTs + (i + 1) * intervalSec * 1000;
      const size = Math.max(0.05, 0.1 + Math.random() * 1.5);
      const side = i === 0 ? "buy" : (price >= (trades[i - 1]?.price ?? startPrice) ? "buy" : "sell");
      const maker = Math.random() < 0.5 ? 1 : 0;

      trades.push({
        symbol: "NICKEL",
        ts: new Date(tsMs),
        price: Number(price.toFixed(4)),
        size: Number(size.toFixed(3)),
        side,
        maker,
        trade_id: `nickel_cap_${tsMs}_${i}`,
        order_id: "",
        market_id: 0,
        contract_address: "",
      });
    }

    // Ensure the final trade price is exactly 5.0
    trades[trades.length - 1].price = 5.0;
    trades[trades.length - 2].price = Math.min(4.99, trades[trades.length - 2].price); // slight dip before cap

    await client.insert({
      table: "trades",
      values: trades,
      format: "JSONEachRow",
    });
    console.log(`✅ Appended ${trades.length} NICKEL trades to cap at $5`);
  } catch (e) {
    console.error("❌ Append failed:", e?.message || e);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}


