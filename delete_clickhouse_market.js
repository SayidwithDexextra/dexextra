// delete_clickhouse_market.js
// Deletes all rows for a market_uuid from ClickHouse tables: trades, ohlcv_1m
// Requires Node.js 18+ (built-in fetch)

const DEFAULT_TABLES = ["trades", "ohlcv_1m"];

function getArg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getEnvOrArg(name, flag, fallback = "") {
  return process.env[name] || getArg(flag, fallback);
}

function assert(condition, msg) {
  if (!condition) {
    console.error(msg);
    process.exit(1);
  }
}

async function runQuery(clickhouseBaseUrl, database, user, password, sql) {
  const url = `${clickhouseBaseUrl}/?database=${encodeURIComponent(database)}&query=${encodeURIComponent(sql)}`;
  const headers = {
    "Content-Type": "text/plain",
    Accept: "application/json",
    "X-ClickHouse-Database": database,
  };
  if (user) headers["X-ClickHouse-User"] = user;
  if (password) headers["X-ClickHouse-Key"] = password;

  const resp = await fetch(url, { method: "POST", headers });
  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    const err = text || `HTTP ${resp.status}`;
    throw new Error(`ClickHouse query failed: ${err}`);
  }
  return text;
}

async function countRows(clickhouseBaseUrl, database, user, password, table, marketUuid) {
  const sql = `SELECT count() AS c FROM ${table} WHERE market_uuid = '${marketUuid}'`;
  const url = `${clickhouseBaseUrl}/?database=${encodeURIComponent(database)}&query=${encodeURIComponent(sql)}`;
  const headers = {
    Accept: "application/json",
    "X-ClickHouse-Database": database,
  };
  if (user) headers["X-ClickHouse-User"] = user;
  if (password) headers["X-ClickHouse-Key"] = password;

  const resp = await fetch(url, { method: "GET", headers });
  const text = await resp.text().catch(() => "");
  if (!resp.ok) throw new Error(`Count failed for ${table}: ${text || `HTTP ${resp.status}`}`);
  try {
    const json = JSON.parse(text);
    const val = json?.[0]?.c;
    return typeof val === "string" ? Number(val) : Number(val || 0);
  } catch {
    const m = text.match(/\"c\"\\s*:\\s*(\"?)(\\d+)\\1/);
    return m ? Number(m[2]) : 0;
  }
}

(async () => {
  const marketUuid = getArg("--market-uuid", getArg("-m", ""));
  assert(marketUuid, "Missing --market-uuid <uuid>");

  const tablesArg = getArg("--tables", "");
  const tables = tablesArg ? tablesArg.split(",").map(s => s.trim()).filter(Boolean) : DEFAULT_TABLES;

  const clickhouseUrl = getEnvOrArg("CLICKHOUSE_URL", "--host", getEnvOrArg("CLICKHOUSE_HOST", "--host", ""));
  const database = getEnvOrArg("CLICKHOUSE_DATABASE", "--database", "default");
  const user = getEnvOrArg("CLICKHOUSE_USER", "--user", "");
  const password = getEnvOrArg("CLICKHOUSE_PASSWORD", "--password", "");
  const dryRun = hasFlag("--dry-run");
  const showCounts = hasFlag("--show-counts");

  assert(clickhouseUrl, "Missing ClickHouse host. Set CLICKHOUSE_URL or pass --host https://your-clickhouse:8443");

  console.log(`[INFO] Target: ${clickhouseUrl} db=${database}`);
  console.log(`[INFO] market_uuid=${marketUuid}`);
  console.log(`[INFO] tables=${tables.join(", ")}`);
  if (dryRun) console.log("[INFO] DRY RUN - no changes will be made");

  for (const table of tables) {
    try {
      const before = showCounts ? await countRows(clickhouseUrl, database, user, password, table, marketUuid) : undefined;

      const sql = `ALTER TABLE ${table} DELETE WHERE market_uuid = '${marketUuid}' SETTINGS mutations_sync = 2`;
      if (dryRun) {
        console.log(`[DRY] ${table}: ${sql}`);
      } else {
        console.log(`[EXEC] ${table}: deleting...`);
        await runQuery(clickhouseUrl, database, user, password, sql);
        console.log(`[OK] ${table}: delete completed (mutations_sync=2)`);
      }

      if (showCounts && !dryRun) {
        const after = await countRows(clickhouseUrl, database, user, password, table, marketUuid);
        console.log(`[COUNT] ${table}: before=${before} after=${after}`);
      } else if (showCounts && dryRun) {
        console.log(`[COUNT] ${table}: before=<queried> after=<unknown in dry-run> (before count shown above if requested)`);
      }
    } catch (e) {
      console.error(`[ERROR] ${table}:`, e.message);
      process.exitCode = 1;
    }
  }
})();




