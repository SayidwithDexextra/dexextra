#!/usr/bin/env tsx
/**
 * Interactive generator that streams OHLCV + trades into ClickHouse for a
 * selected Supabase market. Designed to exercise real-time LightweightChart.
 *
 * Run:
 *   npx tsx scripts/interactive-ohlcv-clickhouse.ts
 *
 * Env required (same as app):
 *   CLICKHOUSE_URL or CLICKHOUSE_HOST (+ CLICKHOUSE_USER/PASSWORD)
 *   CLICKHOUSE_DATABASE (optional, default "default")
 *   SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY
 *
 * Controls (while running):
 *   up     -> apply +10% drift on next candle
 *   down   -> apply -10% drift on next candle
 *   enter  -> print current drift state
 *   q/quit -> stop
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createClient as createChClient, ClickHouseClient } from '@clickhouse/client';
import { createClient as createSbClient, SupabaseClient } from '@supabase/supabase-js';
import readline from 'readline';

type MarketRow = { id: string; symbol: string; market_address?: string | null };

interface Config {
  timeframeSec: number;
  batchSize: number;
  baseVolume: number;
}

function ensureUrl(value?: string | null): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}

async function promptQuestion(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (answer) => resolve(answer.trim())));
}

function buildSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars missing (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
  }
  return createSbClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function buildClickHouse(): ClickHouseClient {
  const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  if (!url) {
    throw new Error('ClickHouse URL missing (CLICKHOUSE_URL or CLICKHOUSE_HOST).');
  }
  return createChClient({
    url,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || 'default',
    request_timeout: 30000,
  });
}

async function fetchMarkets(sb: SupabaseClient): Promise<MarketRow[]> {
  const { data, error } = await sb
    .from('markets')
    .select('id, symbol, market_address')
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []).map((m) => ({
    id: String(m.id),
    symbol: String(m.symbol).toUpperCase(),
    market_address: m.market_address,
  }));
}

async function pickMarket(rl: readline.Interface, markets: MarketRow[]): Promise<MarketRow> {
  console.log('\nAvailable markets (latest 50):');
  markets.forEach((m, idx) => {
    console.log(`  [${idx + 1}] ${m.symbol} (${m.id}) ${m.market_address ? `addr:${m.market_address}` : ''}`);
  });
  const choice = await promptQuestion(rl, 'Select market number: ');
  const idx = Number(choice) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx >= markets.length) {
    throw new Error('Invalid selection.');
  }
  return markets[idx];
}

async function fetchLatestClose(ch: ClickHouseClient, market: MarketRow): Promise<number | null> {
  try {
    const res = await ch.query({
      query: `
        SELECT close
        FROM ohlcv_1m
        WHERE market_uuid = '${market.id}' OR symbol = '${market.symbol}'
        ORDER BY ts DESC
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const rows = (await res.json()) as Array<{ close: number }>;
    if (rows.length === 0) return null;
    return Number(rows[0].close);
  } catch (err) {
    console.warn('⚠️ Could not fetch latest close, falling back to manual.', err);
    return null;
  }
}

async function deleteMarketData(ch: ClickHouseClient, market: MarketRow, symbol: string) {
  console.log(`\n⚠️ Deleting existing rows for market ${market.id} (${symbol}) in ohlcv_1m and trades...`);
  const db = process.env.CLICKHOUSE_DATABASE || 'default';
  // We delete by both market_uuid and symbol for robustness.
  const queries = [
    `ALTER TABLE ${db}.ohlcv_1m DELETE WHERE market_uuid = '${market.id}' OR symbol = '${symbol}'`,
    `ALTER TABLE ${db}.trades DELETE WHERE market_uuid = '${market.id}' OR symbol = '${symbol}'`,
  ];
  for (const q of queries) {
    await ch.exec({ query: q });
  }
  console.log('✅ Existing data deleted (ClickHouse deletes are eventually consistent).');
}

function makeCandle(
  basePrice: number,
  driftDirection: 1 | -1,
  volatilityPct: number,
  baseVolume: number,
  ts: Date
) {
  const drifted = basePrice * (1 + driftDirection * 0.1);
  const noise = drifted * volatilityPct * (Math.random() - 0.5);
  const open = basePrice;
  const close = Math.max(0.01, drifted + noise);
  const high = Math.max(open, close) * (1 + Math.random() * volatilityPct);
  const low = Math.min(open, close) * (1 - Math.random() * volatilityPct);
  const volume = baseVolume * (1 + (Math.random() - 0.5) * 0.2);
  const trades = Math.max(1, Math.floor(Math.random() * 6) + 3);

  return { open, high, low, close, volume, trades, ts };
}

async function insertBatch(
  ch: ClickHouseClient,
  market: MarketRow,
  candles: Array<ReturnType<typeof makeCandle>>,
  symbol: string
) {
  // Insert OHLCV
  await ch.insert({
    table: 'ohlcv_1m',
    format: 'JSONEachRow',
    values: candles.map((c) => ({
      symbol,
      ts: c.ts,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      trades: c.trades,
      market_uuid: market.id,
    })),
  });

  // Derive a few trades per candle
  const tradesRows = candles.flatMap((c, idx) => {
    const baseTs = c.ts.getTime();
    return Array.from({ length: Math.min(4, c.trades) }).map((__, tradeIdx) => ({
      symbol,
      ts: new Date(baseTs + tradeIdx * 10_000 + idx),
      price: c.close * (1 + (Math.random() - 0.5) * 0.002),
      size: c.volume / Math.max(1, c.trades),
      side: Math.random() > 0.5 ? 'buy' : 'sell',
      trade_id: `${baseTs}-${tradeIdx}`,
      order_id: `${baseTs}-o-${tradeIdx}`,
      market_uuid: market.id,
    }));
  });

  await ch.insert({
    table: 'trades',
    format: 'JSONEachRow',
    values: tradesRows,
  });
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const sb = buildSupabase();
    const ch = buildClickHouse();

    const markets = await fetchMarkets(sb);
    const market = await pickMarket(rl, markets);
    console.log(`\n✅ Selected ${market.symbol} (${market.id})`);

    const wipeAns = await promptQuestion(
      rl,
      'Delete existing candles/trades for this market before streaming? [y/N]: '
    );
    const shouldWipe = wipeAns.toLowerCase() === 'y';
    if (shouldWipe) {
      await deleteMarketData(ch, market, market.symbol);
    }

    const defaultTimeframe = 60;
    const timeframeAns = await promptQuestion(
      rl,
      `Timeframe in seconds per candle [${defaultTimeframe}]: `
    );
    const timeframeSec = Number(timeframeAns) > 0 ? Number(timeframeAns) : defaultTimeframe;

    const latestClose = await fetchLatestClose(ch, market);
    const basePriceAns = await promptQuestion(
      rl,
      `Starting price [${latestClose ?? '100'}]: `
    );
    let currentPrice = Number(basePriceAns) || latestClose || 100;

    const baseVolumeAns = await promptQuestion(rl, 'Base volume per candle [1000]: ');
    const baseVolume = Number(baseVolumeAns) > 0 ? Number(baseVolumeAns) : 1000;

    const batchSizeAns = await promptQuestion(rl, 'Batch size (candles per flush) [5]: ');
    const batchSize = Number(batchSizeAns) > 0 ? Number(batchSizeAns) : 5;

    const config: Config = {
      timeframeSec,
      batchSize,
      baseVolume,
    };

    console.log(
      `\n🚀 Streaming to ClickHouse every ${config.timeframeSec}s (batch=${config.batchSize})`
    );
    console.log('Controls: type "up", "down", "q" then Enter. Press Enter to view state.\n');

    let driftDirection: 1 | -1 = 1;
    let running = true;
    let buffer: Array<ReturnType<typeof makeCandle>> = [];

    rl.on('line', async (line) => {
      const input = line.trim().toLowerCase();
      if (input === 'q' || input === 'quit' || input === 'exit') {
        running = false;
        rl.close();
        return;
      }
      if (input === 'up') {
        driftDirection = 1;
        console.log('🔼 Drift set to +10%');
      } else if (input === 'down') {
        driftDirection = -1;
        console.log('🔽 Drift set to -10%');
      } else {
        console.log(`ℹ️ Drift=${driftDirection === 1 ? '+10%' : '-10%'}, buffer=${buffer.length}`);
      }
    });

    const tick = async () => {
      if (!running) return;
      const now = new Date();
      // Align ts to timeframe buckets (seconds)
      const bucketMs = Math.floor(now.getTime() / (config.timeframeSec * 1000)) * (config.timeframeSec * 1000);
      const ts = new Date(bucketMs);

      const candle = makeCandle(currentPrice, driftDirection, 0.01, config.baseVolume, ts);
      currentPrice = candle.close;
      buffer.push(candle);

      if (buffer.length >= config.batchSize) {
        try {
          await insertBatch(ch, market, buffer, market.symbol);
          console.log(
            `✅ Inserted ${buffer.length} candle(s) @ ${ts.toISOString()} | close=${candle.close.toFixed(
              2
            )} drift=${driftDirection === 1 ? '+10%' : '-10%'}`
          );
          buffer = [];
        } catch (err) {
          console.error('❌ Failed to insert batch:', err);
        }
      }
    };

    // Kick off interval
    const interval = setInterval(tick, config.timeframeSec * 1000);
    // Run an immediate first tick
    await tick();

    rl.on('close', async () => {
      clearInterval(interval);
      if (buffer.length > 0) {
        try {
          await insertBatch(ch, market, buffer, market.symbol);
          console.log(`✅ Flushed remaining ${buffer.length} candle(s) on exit`);
        } catch (err) {
          console.error('❌ Failed to flush remaining buffer:', err);
        }
      }
      await ch.close();
      process.exit(0);
    });
  } catch (err) {
    console.error('❌ Script failed:', err);
    rl.close();
    process.exit(1);
  }
}

main();






