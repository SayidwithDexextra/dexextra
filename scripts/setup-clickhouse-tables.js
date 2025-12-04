require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@clickhouse/client");

async function setupClickHouseTables() {
  console.log("🗄️  Setting up ClickHouse tables for chart data...");

  const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  const clickhouse = createClient({
    url,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || "default",
    request_timeout: 60000, // 60 seconds timeout
    compression: {
      response: false,
      request: false,
    },
  });

  try {
		// Remove deprecated VAMM tables
		console.log("🧹 Dropping deprecated VAMM tables (if any)...");
		const deprecatedTables = [
			"vamm_ohlcv_1m",
			"vamm_ohlcv_5m",
			"vamm_ohlcv_15m",
			"vamm_ohlcv_30m",
			"vamm_ohlcv_1h",
			"vamm_ohlcv_4h",
			"vamm_ohlcv_1d",
			"vamm_market_transactions",
			"vamm_market_metadata",
		];
		for (const t of deprecatedTables) {
			try {
				await clickhouse.query({ query: `DROP TABLE IF EXISTS ${t}` });
				console.log(`🗑️  Dropped ${t} (if existed)`);
			} catch (e) {
				console.warn(`⚠️  Failed to drop ${t}:`, e?.message || e);
			}
		}

		// ===============================
		// Scatter Plot Storage (New)
		// ===============================
		console.log("📈 Creating scatter plot tables...");
		const createScatterRaw = `
			CREATE TABLE IF NOT EXISTS scatter_points_raw (
				market_identifier LowCardinality(String),
				market_id LowCardinality(String),
				metric_name LowCardinality(String),
				timeframe LowCardinality(String),         -- '1m' | '5m' | ... matches UI pills
				ts DateTime64(3, 'UTC') DEFAULT now64(3), -- capture event time with ms
				x Float64,                                 -- horizontal axis value or sequence
				y Float64,                                 -- measured value
				source LowCardinality(String) DEFAULT 'frontend',
				point_uid UUID DEFAULT generateUUIDv4(),
				point_key UInt64 MATERIALIZED cityHash64(
					concat(coalesce(market_id, ''), '|', timeframe, '|', toString(ts), '|', toString(x))
				),
				version UInt32 DEFAULT 1
			)
			ENGINE = ReplacingMergeTree(version)
			PARTITION BY toYYYYMM(ts)
			ORDER BY (market_id, timeframe, ts, x, point_key)
			SETTINGS index_granularity = 8192
		`;
		await clickhouse.query({ query: createScatterRaw });
		console.log("✅ scatter_points_raw created");

		// A compact, deduplicated view for fast reads without FINAL
		// Keeps the most recent y per unique (market_identifier, timeframe, ts, x)
		// Ensure we can safely change schema on re-runs
		await clickhouse.query({ query: `DROP VIEW IF EXISTS mv_scatter_points_to_dedup` });
		await clickhouse.query({ query: `DROP TABLE IF EXISTS scatter_points_dedup` });

		const createScatterAgg = `
			CREATE TABLE scatter_points_dedup (
				market_id LowCardinality(String),
				timeframe LowCardinality(String),
				ts DateTime64(3, 'UTC'),
				x Float64,
				latest_y AggregateFunction(argMax, Float64, UInt32)
			)
			ENGINE = AggregatingMergeTree()
			PARTITION BY toYYYYMM(ts)
			ORDER BY (market_id, timeframe, ts, x)
			SETTINGS index_granularity = 8192
		`;
		await clickhouse.query({ query: createScatterAgg });
		console.log("✅ scatter_points_dedup created");

		// Materialized view to feed the dedup table
		const createScatterMV = `
			CREATE MATERIALIZED VIEW IF NOT EXISTS mv_scatter_points_to_dedup
			TO scatter_points_dedup
			AS
			SELECT
				assumeNotNull(market_id) AS market_id,
				timeframe,
				ts,
				x,
				argMaxState(y, version) AS latest_y
			FROM scatter_points_raw
			WHERE market_id IS NOT NULL AND market_id != ''
			GROUP BY
				market_id, timeframe, ts, x
		`;
		await clickhouse.query({ query: createScatterMV });
		console.log("✅ mv_scatter_points_to_dedup created");

    console.log("\n🎉 All ClickHouse tables created successfully!");
    console.log("📝 Ready to insert sample data...");
		console.log("ℹ️  Scatter insert hint:");
		console.log(
			"INSERT INTO scatter_points_raw (market_identifier, metric_name, timeframe, ts, x, y, source, version) VALUES ('E', 'Energy Index', '5m', now64(3), 123.0, 101.23, 'frontend', 1)"
		);
		console.log(
			"Reads: SELECT market_identifier, timeframe, ts, x, argMaxMerge(latest_y) AS y FROM scatter_points_dedup GROUP BY ALL ORDER BY ts, x"
		);
  } catch (error) {
    console.error("❌ Failed to create ClickHouse tables:", error);
    throw error;
  }
}

function ensureUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}:8443`;
}

if (require.main === module) {
  setupClickHouseTables().catch(console.error);
}

module.exports = { setupClickHouseTables };
