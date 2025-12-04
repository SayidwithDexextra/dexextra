require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@clickhouse/client');

function ensureUrl(value) {
	const trimmed = String(value || '').trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
	return `https://${trimmed}:8443`;
}

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			const [k, v] = a.replace(/^--/, '').split('=');
			if (typeof v === 'undefined') {
				args[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
			} else {
				args[k] = v;
			}
		}
	}
	return args;
}

const TF_SECONDS = {
	'1m': 60,
	'5m': 300,
	'15m': 900,
	'30m': 1800,
	'1h': 3600,
	'4h': 14400,
	'1d': 86400
};

function formatTs(date) {
	// ClickHouse DateTime64 friendly: 'YYYY-MM-DD HH:MM:SS.mmm'
	return new Date(date).toISOString().replace('T', ' ').replace('Z', '');
}

function generateRandomWalk(points, startPrice, stepStd) {
	const out = [];
	let y = startPrice;
	for (let i = 0; i < points; i++) {
		// small gaussian-ish step via Box-Muller lite
		const u1 = Math.random();
		const u2 = Math.random();
		const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
		y = Math.max(0, y + z * stepStd);
		out.push(y);
	}
	return out;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const market = String(args.market || args.m || 'NICKEL').toUpperCase();
	const metric = String(args.metric || args.name || 'Nickel');
	const timeframe = String(args.timeframe || args.tf || '5m');
	const points = Number(args.points || args.n || 288);
	const startPrice = Number(args.start || 100);
	const stepStd = Number(args.step || 0.5);
	const source = String(args.source || 'backfill');
	const version = Number(args.version || 1);

	if (!TF_SECONDS[timeframe]) {
		console.error(`Unsupported timeframe: ${timeframe}. Use one of ${Object.keys(TF_SECONDS).join(', ')}`);
		process.exit(1);
	}

	const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
	const clickhouse = createClient({
		url,
		username: process.env.CLICKHOUSE_USER || 'default',
		password: process.env.CLICKHOUSE_PASSWORD,
		database: process.env.CLICKHOUSE_DATABASE || 'default',
		request_timeout: 120000
	});

	console.log(`🚀 Backfilling scatter_points_raw for ${market} (${metric}) tf=${timeframe} points=${points}`);

	const interval = TF_SECONDS[timeframe] * 1000;
	const endTsMs = Date.now();
	const startTsMs = endTsMs - (points - 1) * interval;
	const ys = generateRandomWalk(points, startPrice, stepStd);

	const rows = [];
	for (let i = 0; i < points; i++) {
		const ts = startTsMs + i * interval;
		rows.push({
			market_identifier: market,
			metric_name: metric,
			timeframe,
			ts: formatTs(ts),
			x: i, // stable strictly increasing index
			y: Number(ys[i].toFixed(6)),
			source,
			version
		});
	}

	try {
		await clickhouse.insert({
			table: 'scatter_points_raw',
			values: rows,
			format: 'JSONEachRow'
		});
		console.log(`✅ Inserted ${rows.length} rows into scatter_points_raw`);
		console.log('ℹ️  Dedup view updates automatically via MV (mv_scatter_points_to_dedup).');
	} catch (e) {
		console.error('❌ Insert failed:', e?.message || e);
		process.exit(1);
	}
}

if (require.main === module) {
	main().catch((e) => {
		console.error('❌ Backfill error:', e?.message || e);
		process.exit(1);
	});
}




