require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@clickhouse/client');

function ensureUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}

async function main() {
  const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  if (!url) {
    console.error('❌ Missing CLICKHOUSE_URL or CLICKHOUSE_HOST');
    process.exit(1);
  }

  const client = createClient({
    url,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || 'default',
    request_timeout: 30000
  });

  const tables = ['scatter_points_raw', 'scatter_points_dedup', 'trades', 'market_ticks', 'ohlcv_1m'];
  for (const t of tables) {
    try {
      const res = await client.query({ query: `DESCRIBE TABLE ${t}`, format: 'JSONEachRow' });
      const rows = await res.json();
      console.log(`--- ${t}`);
      console.log(rows.map(r => `${r.name}:${r.type}`).join('\n'));
    } catch (e) {
      console.log(`--- ${t} (missing)`, e?.message || e);
    }
  }

  await client.close();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ Error:', e?.message || e);
    process.exit(1);
  });
}




