/**
 * Reset BITCOIN chart data in ClickHouse:
 * - Deletes: market_ticks, ohlcv_1m, scatter_points_raw, scatter_points_dedup, metric_series_raw, metric_series_1m
 * - Re-inserts: a full 1m candle set (via deterministic ticks) that ends at a specific close
 * - Inserts: a "leading SMA" metric series into metric_series_raw for metric_name=BITCOIN
 *
 * Usage:
 *   node scripts/reset-bitcoin-clickhouse-data.js
 *   MARKET_UUID=<uuid> END_CLOSE=67668.48 DAYS=7 node scripts/reset-bitcoin-clickhouse-data.js
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@clickhouse/client');

function ensureUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}

function fmtDateTimeSec(ms) {
  const d = new Date(ms);
  // ClickHouse DateTime('UTC') accepts "YYYY-MM-DD HH:MM:SS"
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function looksLikeUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || '').trim());
}

/**
 * Generate a smooth minute-level OHLCV series that ends at endClose.
 * Returns candles: [{ tsMs, open, high, low, close, volume }]
 */
function generateMinuteCandles(params) {
  const {
    minutes,
    endTimeMs,
    endClose,
    startClose,
    noiseAmp = 180,
    wickAmp = 120,
    volBase = 2.5,
  } = params;

  const endAligned = Math.floor(endTimeMs / 60_000) * 60_000;
  const startMs = endAligned - (minutes - 1) * 60_000;
  const candles = [];

  let prevClose = startClose;
  for (let i = 0; i < minutes; i++) {
    const tsMs = startMs + i * 60_000;
    const t = minutes <= 1 ? 1 : i / (minutes - 1);
    const trend = startClose + t * (endClose - startClose);

    const noise =
      Math.sin(i / 37) * noiseAmp +
      Math.sin(i / 9.5) * (noiseAmp * 0.25) +
      Math.cos(i / 71) * (noiseAmp * 0.15);

    let close = trend + noise;
    if (i === minutes - 1) close = endClose; // enforce exact ending close

    // Make open continuous so candles look natural
    const open = i === 0 ? close - clamp(noiseAmp * 0.1, 20, 120) : prevClose;
    const baseHi = Math.max(open, close);
    const baseLo = Math.min(open, close);
    const wick = Math.abs(Math.sin(i / 11)) * wickAmp + 20;
    const high = baseHi + wick;
    const low = baseLo - wick * 0.9;

    // Mild volume variation
    const volume = Math.max(
      0,
      volBase + Math.abs(Math.sin(i / 15)) * volBase + Math.abs(Math.cos(i / 41)) * (volBase * 0.35)
    );

    candles.push({
      tsMs,
      open: Number(open.toFixed(6)),
      high: Number(high.toFixed(6)),
      low: Number(low.toFixed(6)),
      close: Number(close.toFixed(6)),
      volume: Number(volume.toFixed(6)),
    });
    prevClose = close;
  }

  return candles;
}

/**
 * Compute a "leading SMA" series:
 * - First compute a standard trailing SMA(window)
 * - Then add a small lead term proportional to SMA slope
 */
function computeLeadingSma(values, window, leadFactor) {
  const n = values.length;
  const out = new Array(n);
  const w = Math.max(1, Math.floor(window || 20));
  const k = Number.isFinite(leadFactor) ? leadFactor : 2.5;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    sum += v;
    if (i >= w) sum -= values[i - w];
    const denom = Math.min(i + 1, w);
    const sma = sum / denom;
    const prev = i > 0 ? out[i - 1].sma : sma;
    const slope = sma - prev;
    const lead = sma + k * slope;
    out[i] = { sma, lead };
  }
  return out;
}

async function main() {
  const marketUuid = String(process.env.MARKET_UUID || 'e120c445-37fc-47e1-a65d-5cedf945bf5d').trim();
  if (!looksLikeUuid(marketUuid)) {
    throw new Error(`MARKET_UUID must be a UUID (got: ${marketUuid})`);
  }

  const endCloseRaw = Number(process.env.END_CLOSE || '67668.48');
  const endClose = Number.isFinite(endCloseRaw) ? endCloseRaw : 67668.48;

  const daysRaw = Number(process.env.DAYS || '7');
  const days = clamp(Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 7, 1, 60);

  const minutes = days * 24 * 60;

  const endTimeMs = Date.now();
  // Start around ~20k below end to mimic realistic climb from ~47k → ~67k
  const startCloseRaw = Number(process.env.START_CLOSE || String(endClose - 20000));
  const startClose = Number.isFinite(startCloseRaw) ? startCloseRaw : endClose - 20000;

  const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  if (!url) throw new Error('Missing CLICKHOUSE_URL (or CLICKHOUSE_HOST).');

  const client = createClient({
    url,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || 'default',
    request_timeout: 120_000,
    compression: { request: false, response: false },
  });

  const safeUuid = marketUuid.replace(/'/g, "\\'");

  console.log('🧹 Deleting existing BITCOIN data...', {
    marketUuid,
    days,
    minutes,
    endClose,
  });

  // Delete in "child" tables too; MVs do not automatically retract existing aggregated rows.
  const deletes = [
    `ALTER TABLE scatter_points_raw DELETE WHERE market_id = '${safeUuid}' SETTINGS mutations_sync = 1`,
    `ALTER TABLE scatter_points_dedup DELETE WHERE market_id = '${safeUuid}' SETTINGS mutations_sync = 1`,
    `ALTER TABLE metric_series_raw DELETE WHERE market_id = '${safeUuid}' SETTINGS mutations_sync = 1`,
    `ALTER TABLE metric_series_1m DELETE WHERE market_id = '${safeUuid}' SETTINGS mutations_sync = 1`,
    `ALTER TABLE market_ticks DELETE WHERE market_uuid = '${safeUuid}' SETTINGS mutations_sync = 1`,
    `ALTER TABLE ohlcv_1m DELETE WHERE market_uuid = '${safeUuid}' SETTINGS mutations_sync = 1`,
    // Optional: if you use trades for any reads, clear them too (safe no-op if empty).
    `ALTER TABLE trades DELETE WHERE market_uuid = '${safeUuid}' SETTINGS mutations_sync = 1`,
  ];

  for (const q of deletes) {
    try {
      await client.exec({ query: q });
    } catch (e) {
      // Some deployments might not have all tables (esp. trades). Keep going.
      console.warn('⚠️ delete failed (continuing):', q.split('\n')[0], e?.message || e);
    }
  }

  console.log('🕯️  Seeding candles via deterministic ticks...');
  const candles = generateMinuteCandles({
    minutes,
    endTimeMs,
    endClose,
    startClose,
  });

  const ticks = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const minuteStartMs = c.tsMs;
    const key = `${marketUuid}:${minuteStartMs}`;

    // Deterministic open/high/low/close ticks
    ticks.push(
      {
        symbol: 'BTC',
        ts: fmtDateTimeSec(minuteStartMs),
        price: c.open,
        size: c.volume, // attribute volume to open
        event_type: 'open',
        is_long: 1,
        event_id: `seed:${key}:0_open`,
        trade_count: 1,
        market_id: 0,
        contract_address: '',
        market_uuid: marketUuid,
      },
      {
        symbol: 'BTC',
        ts: fmtDateTimeSec(minuteStartMs + 15_000),
        price: c.high,
        size: 0,
        event_type: 'high',
        is_long: 1,
        event_id: `seed:${key}:1_high`,
        trade_count: 0,
        market_id: 0,
        contract_address: '',
        market_uuid: marketUuid,
      },
      {
        symbol: 'BTC',
        ts: fmtDateTimeSec(minuteStartMs + 30_000),
        price: c.low,
        size: 0,
        event_type: 'low',
        is_long: 0,
        event_id: `seed:${key}:2_low`,
        trade_count: 0,
        market_id: 0,
        contract_address: '',
        market_uuid: marketUuid,
      },
      {
        symbol: 'BTC',
        ts: fmtDateTimeSec(minuteStartMs + 45_000),
        price: c.close,
        size: 0,
        event_type: 'close',
        is_long: 1,
        event_id: `seed:${key}:3_close`,
        trade_count: 1,
        market_id: 0,
        contract_address: '',
        market_uuid: marketUuid,
      }
    );
  }

  await client.insert({ table: 'market_ticks', values: ticks, format: 'JSONEachRow' });
  console.log(`✅ Inserted market_ticks rows: ${ticks.length}`);

  // Give MV a moment to materialize ohlcv_1m
  await new Promise((r) => setTimeout(r, 500));

  console.log('📈 Seeding leading SMA metric series (metric_name=BITCOIN)...');
  const closes = candles.map((x) => Number(x.close));
  const lead = computeLeadingSma(closes, 20, 2.5);

  const metricRows = candles.map((c, i) => ({
    market_id: marketUuid,
    metric_name: 'BITCOIN',
    ts: fmtDateTimeSec(c.tsMs),
    value: Number(lead[i].lead.toFixed(6)),
    source: 'seed_leading_sma',
    version: (Date.now() % 2_147_483_647),
  }));
  await client.insert({ table: 'metric_series_raw', values: metricRows, format: 'JSONEachRow' });
  console.log(`✅ Inserted metric_series_raw rows: ${metricRows.length}`);

  // Verify last candle close
  const verify = async () => {
    const q = `
      SELECT
        ts,
        close
      FROM ohlcv_1m
      WHERE market_uuid = '${safeUuid}'
      ORDER BY ts DESC
      LIMIT 1
    `;
    const r = await client.query({ query: q, format: 'JSONEachRow' });
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  };

  const last = await verify();
  console.log('🔎 Latest 1m candle:', last);

  // Quick counts
  const countQuery = async (sql) => {
    try {
      const r = await client.query({ query: sql, format: 'JSONEachRow' });
      const rows = await r.json();
      return rows?.[0] || null;
    } catch {
      return null;
    }
  };

  const counts = {
    market_ticks: await countQuery(`SELECT count() AS n FROM market_ticks WHERE market_uuid='${safeUuid}'`),
    ohlcv_1m: await countQuery(`SELECT count() AS n FROM ohlcv_1m WHERE market_uuid='${safeUuid}'`),
    scatter_points_raw: await countQuery(`SELECT count() AS n FROM scatter_points_raw WHERE market_id='${safeUuid}'`),
    scatter_points_dedup: await countQuery(`SELECT count() AS n FROM scatter_points_dedup WHERE market_id='${safeUuid}'`),
    metric_series_raw: await countQuery(`SELECT count() AS n FROM metric_series_raw WHERE market_id='${safeUuid}' AND metric_name='BITCOIN'`),
    metric_series_1m: await countQuery(`SELECT count() AS n FROM metric_series_1m WHERE market_id='${safeUuid}' AND metric_name='BITCOIN'`),
  };
  console.log('📊 Counts:', counts);

  await client.close();

  // Hard check for requested ending close (within 1 cent)
  const lastClose = last ? Number(last.close) : NaN;
  if (Number.isFinite(lastClose) && Math.abs(lastClose - endClose) <= 0.01) {
    console.log('🎯 Done: last close matches requested END_CLOSE.');
  } else {
    console.warn('⚠️ last close does not match END_CLOSE exactly.', { lastClose, endClose });
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ reset-bitcoin-clickhouse-data failed:', e?.stack || e);
    process.exit(1);
  });
}


