#!/usr/bin/env tsx
/**
 * Cleanup script: delete rows where `symbol` was mistakenly stored as a UUID
 * (typically during realtime testing where UUID is used as subscription key).
 *
 * Deletes:
 * - ohlcv_1m rows where symbol is UUID-like AND market_uuid is empty/null
 * - market_ticks rows where symbol is UUID-like AND market_uuid is empty/null
 *
 * Usage:
 *   npx tsx scripts/cleanup-uuid-symbol-clickhouse.ts
 *
 * Env (same as app):
 *   CLICKHOUSE_URL or CLICKHOUSE_HOST (+ CLICKHOUSE_USER/PASSWORD)
 *   CLICKHOUSE_DATABASE (optional, default "default")
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createClient, ClickHouseClient } from '@clickhouse/client';

function ensureUrl(value?: string | null): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}

function uuidRegex(): string {
  // UUID v1-v5 canonical string form
  return '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
}

async function countBadRows(ch: ClickHouseClient, db: string, table: string, where: string): Promise<number> {
  const res = await ch.query({
    query: `SELECT count() AS c FROM ${db}.${table} WHERE ${where}`,
    format: 'JSONEachRow',
  });
  const rows = (await res.json()) as Array<{ c: number | string }>;
  const n = rows?.[0]?.c ?? 0;
  return Number(n) || 0;
}

async function tableExists(ch: ClickHouseClient, db: string, table: string): Promise<boolean> {
  const res = await ch.query({
    query: `EXISTS TABLE ${db}.${table}`,
    format: 'JSONEachRow',
  });
  const rows = (await res.json()) as Array<{ result: number | string }>;
  return Number(rows?.[0]?.result ?? 0) === 1;
}

async function runDelete(ch: ClickHouseClient, db: string, table: string, where: string) {
  const q = `ALTER TABLE ${db}.${table} DELETE WHERE ${where}`;
  await ch.exec({ query: q });
}

async function main() {
  const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  if (!url) {
    throw new Error('ClickHouse URL missing (CLICKHOUSE_URL or CLICKHOUSE_HOST).');
  }
  const db = process.env.CLICKHOUSE_DATABASE || 'default';
  const ch = createClient({
    url,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: db,
    request_timeout: 60_000,
  });

  const re = uuidRegex();
  const mode = (process.argv[2] || '').trim().toLowerCase();
  const where =
    mode === '--all'
      // Delete ANY rows where symbol looks like UUID (regardless of market_uuid).
      // Use with care: intended for clearing test artifacts after UUID-as-symbol bugs.
      ? `match(symbol, '${re}')`
      // Default: only delete the clearly-invalid rows where market_uuid is missing.
      : `match(symbol, '${re}') AND (market_uuid = '' OR isNull(market_uuid))`;

  try {
    const targets: Array<{ table: string; exists: boolean }> = [
      { table: 'ohlcv_1m', exists: await tableExists(ch, db, 'ohlcv_1m') },
      { table: 'market_ticks', exists: await tableExists(ch, db, 'market_ticks') },
    ];

    console.log(`🔎 ClickHouse DB: ${db}`);
    console.log(`🔎 UUID regex: ${re}`);
    console.log(`🔎 Mode: ${mode === '--all' ? '--all (delete any UUID-like symbol rows)' : 'default (only empty market_uuid)'}`);

    for (const t of targets) {
      if (!t.exists) {
        console.log(`ℹ️ Skipping ${db}.${t.table} (does not exist)`);
        continue;
      }
      const before = await countBadRows(ch, db, t.table, where);
      console.log(`📊 ${db}.${t.table} bad rows (before): ${before}`);
    }

    console.log('\n🧹 Issuing DELETE mutations (eventually consistent)...');

    for (const t of targets) {
      if (!t.exists) continue;
      await runDelete(ch, db, t.table, where);
      console.log(`✅ DELETE issued for ${db}.${t.table}`);
    }

    // Recount immediately (may still show rows until mutation completes)
    console.log('\n📊 Re-checking counts (may not drop immediately)...');
    for (const t of targets) {
      if (!t.exists) continue;
      const after = await countBadRows(ch, db, t.table, where);
      console.log(`📊 ${db}.${t.table} bad rows (after): ${after}`);
    }

    console.log('\n✅ Cleanup mutations submitted.');
    console.log('Note: ClickHouse deletes apply asynchronously; rows may disappear shortly after.');
  } finally {
    await ch.close();
  }
}

main().catch((err) => {
  console.error('❌ Cleanup failed:', err);
  process.exitCode = 1;
});


