#!/usr/bin/env tsx
/**
 * Creates the user_pnl_snapshots table in ClickHouse for storing
 * daily P&L snapshots per user wallet.
 *
 * Run:
 *   npx tsx scripts/setup-pnl-snapshots-clickhouse.ts
 *
 * Env required:
 *   CLICKHOUSE_URL or CLICKHOUSE_HOST
 *   CLICKHOUSE_USER (optional, default "default")
 *   CLICKHOUSE_PASSWORD
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

async function main() {
  const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  if (!url) {
    console.error('❌ CLICKHOUSE_URL or CLICKHOUSE_HOST not set');
    process.exit(1);
  }

  const database = process.env.CLICKHOUSE_DATABASE || 'default';
  
  console.log(`🔌 Connecting to ClickHouse: ${url} (database: ${database})`);

  const client: ClickHouseClient = createClient({
    url,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database,
  });

  try {
    // Create user_pnl_snapshots table
    // Partitioned by month, ordered by wallet_address + snapshot_date for efficient user queries
    console.log('📦 Creating user_pnl_snapshots table...');
    
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS user_pnl_snapshots (
          wallet_address LowCardinality(String),
          snapshot_date Date,
          realized_pnl Float64,
          unrealized_pnl Float64,
          net_pnl Float64,
          total_fees Float64,
          trade_count UInt32,
          total_volume Float64,
          buy_count UInt32,
          sell_count UInt32,
          snapshot_ts DateTime DEFAULT now(),
          
          -- Index for fast time-range queries
          INDEX idx_date snapshot_date TYPE minmax GRANULARITY 1
        )
        ENGINE = ReplacingMergeTree(snapshot_ts)
        PARTITION BY toYYYYMM(snapshot_date)
        ORDER BY (wallet_address, snapshot_date)
        SETTINGS index_granularity = 8192
      `,
    });
    console.log('✅ user_pnl_snapshots table created');

    // Create a materialized view for daily aggregations (optional optimization)
    console.log('📦 Creating user_pnl_daily_agg table...');
    
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS user_pnl_daily_agg (
          wallet_address LowCardinality(String),
          snapshot_date Date,
          realized_pnl SimpleAggregateFunction(max, Float64),
          unrealized_pnl SimpleAggregateFunction(max, Float64),
          net_pnl SimpleAggregateFunction(max, Float64),
          total_fees SimpleAggregateFunction(sum, Float64),
          trade_count SimpleAggregateFunction(sum, UInt64),
          total_volume SimpleAggregateFunction(sum, Float64),
          buy_count SimpleAggregateFunction(sum, UInt64),
          sell_count SimpleAggregateFunction(sum, UInt64)
        )
        ENGINE = AggregatingMergeTree()
        PARTITION BY toYYYYMM(snapshot_date)
        ORDER BY (wallet_address, snapshot_date)
      `,
    });
    console.log('✅ user_pnl_daily_agg table created');

    // Test the table
    console.log('🧪 Testing table with sample insert...');
    
    await client.insert({
      table: 'user_pnl_snapshots',
      values: [{
        wallet_address: '0x0000000000000000000000000000000000000000',
        snapshot_date: new Date().toISOString().split('T')[0],
        realized_pnl: 0,
        unrealized_pnl: 0,
        net_pnl: 0,
        total_fees: 0,
        trade_count: 0,
        total_volume: 0,
        buy_count: 0,
        sell_count: 0,
      }],
      format: 'JSONEachRow',
    });

    // Verify
    const result = await client.query({
      query: `SELECT count() as cnt FROM user_pnl_snapshots`,
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    console.log(`✅ Table verified, rows: ${rows[0]?.cnt || 0}`);

    // Clean up test data
    await client.command({
      query: `ALTER TABLE user_pnl_snapshots DELETE WHERE wallet_address = '0x0000000000000000000000000000000000000000'`,
    });

    console.log('\n🎉 ClickHouse P&L snapshots setup complete!');
    console.log('\nTable schema:');
    console.log('  - wallet_address: User wallet (lowercase)');
    console.log('  - snapshot_date: Date of snapshot');
    console.log('  - realized_pnl: Realized P&L from vault contract');
    console.log('  - unrealized_pnl: Unrealized P&L from open positions');
    console.log('  - net_pnl: realized + unrealized');
    console.log('  - total_fees: Cumulative fees paid');
    console.log('  - trade_count: Number of trades');
    console.log('  - total_volume: Trading volume');
    console.log('  - buy_count / sell_count: Trade breakdown');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
