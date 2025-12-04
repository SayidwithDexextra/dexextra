require('dotenv').config({ path: '.env.local' });
const { createClient: createChClient } = require('@clickhouse/client');
const { createClient: createSbClient } = require('@supabase/supabase-js');

function ensureUrl(value) {
	const raw = String(value || '').trim();
	if (!raw) return null;
	if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
	return `https://${raw}:8443`;
}

async function main() {
	const chUrl = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
	if (!chUrl) {
		throw new Error('Missing CLICKHOUSE_URL/CLICKHOUSE_HOST');
	}

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
	const supabaseKey =
		process.env.SUPABASE_SERVICE_ROLE_KEY ||
		process.env.SUPABASE_ANON_KEY ||
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
	if (!supabaseUrl || !supabaseKey) {
		throw new Error('Missing Supabase URL/key (SUPABASE_SERVICE_ROLE_KEY recommended).');
	}

	const ch = createChClient({
		url: chUrl,
		username: process.env.CLICKHOUSE_USER || 'default',
		password: process.env.CLICKHOUSE_PASSWORD,
		database: process.env.CLICKHOUSE_DATABASE || 'default',
		request_timeout: 120000
	});

	const sb = createSbClient(supabaseUrl, supabaseKey);

	console.log('🔎 Fetching markets mapping from Supabase...');
	const { data: markets, error } = await sb
		.from('markets')
		.select('id, market_identifier, symbol');
	if (error) {
		throw error;
	}

	const idByIdentifier = new Map();
	const idBySymbol = new Map();
	for (const m of markets || []) {
		if (m.market_identifier) idByIdentifier.set(String(m.market_identifier).toUpperCase(), String(m.id));
		if (m.symbol) idBySymbol.set(String(m.symbol).toUpperCase(), String(m.id));
	}
	console.log(`✅ Loaded ${idByIdentifier.size} identifier mappings / ${idBySymbol.size} symbol mappings`);

	console.log('🧱 Ensuring market_id column exists on scatter_points_raw...');
	await ch.query({
		query: `
			ALTER TABLE scatter_points_raw
			ADD COLUMN IF NOT EXISTS market_id LowCardinality(String)
		`
	});

	console.log('🛠️  Backfilling market_id from market_identifier...');
	for (const [identifier, id] of idByIdentifier.entries()) {
		const q = `
			ALTER TABLE scatter_points_raw
			UPDATE market_id = '${id}'
			WHERE upper(market_identifier) = '${identifier}' AND (market_id IS NULL OR market_id = '')
		`;
		await ch.query({ query: q });
	}

	console.log('🛠️  Backfilling market_id from symbol (fallback)...');
	for (const [symbol, id] of idBySymbol.entries()) {
		const q = `
			ALTER TABLE scatter_points_raw
			UPDATE market_id = '${id}'
			WHERE upper(market_identifier) = '${symbol}' AND (market_id IS NULL OR market_id = '')
		`;
		await ch.query({ query: q });
	}

	console.log('♻️ Rebuilding dedup table/materialized view to use market_id...');
	await ch.query({ query: `DROP VIEW IF EXISTS mv_scatter_points_to_dedup` });
	await ch.query({ query: `DROP TABLE IF EXISTS scatter_points_dedup` });

	await ch.query({
		query: `
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
		`
	});

	await ch.query({
		query: `
			CREATE MATERIALIZED VIEW mv_scatter_points_to_dedup
			TO scatter_points_dedup AS
			SELECT
				assumeNotNull(market_id) AS market_id,
				timeframe,
				ts,
				x,
				argMaxState(y, version) AS latest_y
			FROM scatter_points_raw
			WHERE market_id IS NOT NULL AND market_id != ''
			GROUP BY market_id, timeframe, ts, x
		`
	});

	console.log('📥 Seeding dedup from existing raw rows...');
	await ch.query({
		query: `
			INSERT INTO scatter_points_dedup
			SELECT
				assumeNotNull(market_id) AS market_id,
				timeframe,
				ts,
				x,
				argMaxState(y, version) AS latest_y
			FROM scatter_points_raw
			WHERE market_id IS NOT NULL AND market_id != ''
			GROUP BY market_id, timeframe, ts, x
		`
	});

	console.log('✅ Migration complete: market_id now used for scatter datasets.');
}

if (require.main === module) {
	main().catch((e) => {
		console.error('❌ Migration failed:', e?.message || e);
		process.exit(1);
	});
}




