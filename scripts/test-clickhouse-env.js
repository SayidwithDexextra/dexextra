const fs = require("fs");
const path = require("path");

// Load .env.local first if present (user preference), else fallback to .env
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  require("dotenv").config({ path: envLocalPath });
} else {
  require("dotenv").config();
}

const { createClient } = require("@clickhouse/client");

function mask(value) {
  if (value == null) return "";
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-2)}`;
}

function ensureUrl(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  // If a bare host is given, assume ClickHouse Cloud HTTPS port
  return `https://${trimmed}:8443`;
}

async function main() {
  const rawUrl = process.env.CLICKHOUSE_URL;
  const rawHost = process.env.CLICKHOUSE_HOST;
  const username = process.env.CLICKHOUSE_USER;
  const password = process.env.CLICKHOUSE_PASSWORD;
  const database = process.env.CLICKHOUSE_DATABASE || "default";

  // Prefer CLICKHOUSE_URL; fallback to CLICKHOUSE_HOST
  const url = ensureUrl(rawUrl || rawHost);

  console.log("🔧 Using environment values:");
  console.log(`  CLICKHOUSE_URL:  ${rawUrl || "(not set)"}`);
  console.log(`  CLICKHOUSE_HOST: ${rawHost || "(not set)"} (fallback)`);
  console.log(`  CLICKHOUSE_USER: ${username || "(not set)"}`);
  console.log(`  CLICKHOUSE_PASSWORD: ${password ? mask(password) : "(not set)"}`);
  console.log(`  CLICKHOUSE_DATABASE: ${database}`);
  console.log(`  → Resolved URL: ${url || "(invalid)"}`);
  console.log("");

  if (!url || !username) {
    console.error("❌ Missing required envs. Ensure CLICKHOUSE_URL (or CLICKHOUSE_HOST) and CLICKHOUSE_USER are set.");
    process.exit(1);
  }

  const client = createClient({
    url,
    username,
    password,
    database,
  });

  try {
    const result = await client.query({
      query: "SELECT currentDatabase() AS db, version() AS version, now() AS now",
      format: "JSON",
    });
    const data = await result.json();
    const row = data?.data?.[0];
    console.log("✅ ClickHouse connection successful");
    console.log(`  Database: ${row?.db}`);
    console.log(`  Version:  ${row?.version}`);
    console.log(`  Server time: ${row?.now}`);
    process.exit(0);
  } catch (error) {
    console.error("❌ ClickHouse connection failed");
    console.error(`  Error: ${error?.message || error}`);
    // Common hints
    if (url && !url.startsWith("https://")) {
      console.error("  Hint: Use HTTPS and port 8443 for ClickHouse Cloud.");
    }
    if (!password) {
      console.error("  Hint: CLICKHOUSE_PASSWORD is empty. Set your cloud user password.");
    }
    console.error("  Hint: Verify IP access list and that the host is correct.");
    process.exit(1);
  }
}

main();


