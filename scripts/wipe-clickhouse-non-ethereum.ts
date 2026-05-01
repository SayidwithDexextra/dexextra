#!/usr/bin/env tsx
/**
 * Wipe all ClickHouse data except for Ethereum market records.
 *
 * This script deletes all records from ClickHouse tables where
 * market_uuid != 'd51a4487-b729-4eba-ab7b-b81725418510' (Ethereum)
 *
 * Run:
 *   npx tsx scripts/wipe-clickhouse-non-ethereum.ts
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
import readline from 'readline';

const ETHEREUM_MARKET_UUID = 'd51a4487-b729-4eba-ab7b-b81725418510';

function ensureUrl(value?: string | null): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}

async function promptConfirm(rl: readline.Interface, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

interface TableStats {
  name: string;
  totalRows: number;
  ethereumRows: number;
  toDelete: number;
}

async function getTableStats(client: ClickHouseClient, tableName: string): Promise<TableStats | null> {
  try {
    const totalResult = await client.query({
      query: `SELECT count() as cnt FROM ${tableName}`,
      format: 'JSONEachRow',
    });
    const totalRows = ((await totalResult.json()) as any[])[0]?.cnt || 0;

    let ethereumRows = 0;
    try {
      const ethResult = await client.query({
        query: `SELECT count() as cnt FROM ${tableName} WHERE market_uuid = '${ETHEREUM_MARKET_UUID}'`,
        format: 'JSONEachRow',
      });
      ethereumRows = ((await ethResult.json()) as any[])[0]?.cnt || 0;
    } catch {
      // Table might not have market_uuid column
      ethereumRows = 0;
    }

    return {
      name: tableName,
      totalRows: Number(totalRows),
      ethereumRows: Number(ethereumRows),
      toDelete: Number(totalRows) - Number(ethereumRows),
    };
  } catch (err) {
    console.warn(`⚠️ Could not get stats for ${tableName}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function deleteNonEthereumRecords(client: ClickHouseClient, tableName: string, database: string): Promise<number> {
  try {
    // Check if table has market_uuid column
    const descResult = await client.query({
      query: `DESCRIBE TABLE ${tableName}`,
      format: 'JSONEachRow',
    });
    const columns = (await descResult.json()) as Array<{ name: string }>;
    const hasMarketUuid = columns.some((c) => c.name === 'market_uuid');

    if (!hasMarketUuid) {
      console.log(`  ⏭️ ${tableName} has no market_uuid column, skipping...`);
      return 0;
    }

    // Get count before delete
    const beforeResult = await client.query({
      query: `SELECT count() as cnt FROM ${tableName} WHERE market_uuid != '${ETHEREUM_MARKET_UUID}'`,
      format: 'JSONEachRow',
    });
    const toDelete = Number(((await beforeResult.json()) as any[])[0]?.cnt || 0);

    if (toDelete === 0) {
      console.log(`  ✅ ${tableName}: No non-Ethereum records to delete`);
      return 0;
    }

    // Execute delete using ALTER TABLE DELETE (lightweight delete)
    console.log(`  🗑️ ${tableName}: Deleting ${toDelete.toLocaleString()} non-Ethereum records...`);
    
    await client.command({
      query: `ALTER TABLE ${database}.${tableName} DELETE WHERE market_uuid != '${ETHEREUM_MARKET_UUID}'`,
    });

    console.log(`  ✅ ${tableName}: Delete mutation submitted (${toDelete.toLocaleString()} rows)`);
    return toDelete;
  } catch (err) {
    console.error(`  ❌ ${tableName}: Failed to delete:`, err instanceof Error ? err.message : err);
    return 0;
  }
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
    if (!url) {
      console.error('❌ CLICKHOUSE_URL or CLICKHOUSE_HOST not set');
      process.exit(1);
    }

    const database = process.env.CLICKHOUSE_DATABASE || 'default';

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     ClickHouse Wipe - Keep Only Ethereum Records          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log();
    console.log(`🔌 Connecting to: ${url}`);
    console.log(`📁 Database: ${database}`);
    console.log(`🔑 Keeping market_uuid: ${ETHEREUM_MARKET_UUID}`);
    console.log();

    const client: ClickHouseClient = createClient({
      url,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD,
      database,
      request_timeout: 60000,
    });

    // Get list of tables
    const tablesResult = await client.query({
      query: `SELECT name FROM system.tables WHERE database = '${database}' AND engine NOT LIKE '%View%' ORDER BY name`,
      format: 'JSONEachRow',
    });
    const tables = ((await tablesResult.json()) as Array<{ name: string }>).map((t) => t.name);

    console.log('📊 Current table statistics:');
    console.log('─'.repeat(70));
    console.log('Table'.padEnd(30) + 'Total Rows'.padStart(15) + 'Ethereum'.padStart(12) + 'To Delete'.padStart(13));
    console.log('─'.repeat(70));

    const stats: TableStats[] = [];
    for (const table of tables) {
      const tableStat = await getTableStats(client, table);
      if (tableStat && tableStat.totalRows > 0) {
        stats.push(tableStat);
        console.log(
          tableStat.name.padEnd(30) +
            tableStat.totalRows.toLocaleString().padStart(15) +
            tableStat.ethereumRows.toLocaleString().padStart(12) +
            tableStat.toDelete.toLocaleString().padStart(13)
        );
      }
    }

    console.log('─'.repeat(70));
    
    const totalToDelete = stats.reduce((sum, s) => sum + s.toDelete, 0);
    const totalEthereum = stats.reduce((sum, s) => sum + s.ethereumRows, 0);
    
    console.log(
      'TOTAL'.padEnd(30) +
        stats.reduce((sum, s) => sum + s.totalRows, 0).toLocaleString().padStart(15) +
        totalEthereum.toLocaleString().padStart(12) +
        totalToDelete.toLocaleString().padStart(13)
    );
    console.log();

    if (totalToDelete === 0) {
      console.log('✅ No non-Ethereum records to delete. Database is clean!');
      await client.close();
      rl.close();
      return;
    }

    console.log(`⚠️  WARNING: This will DELETE ${totalToDelete.toLocaleString()} rows across ${stats.filter(s => s.toDelete > 0).length} tables!`);
    console.log(`   Only ${totalEthereum.toLocaleString()} Ethereum records will be kept.`);
    console.log();

    const confirmed = await promptConfirm(rl, '🔴 Are you sure you want to proceed? (y/N): ');
    
    if (!confirmed) {
      console.log('❌ Aborted by user.');
      await client.close();
      rl.close();
      return;
    }

    console.log();
    console.log('🚀 Starting deletion...');
    console.log();

    let totalDeleted = 0;
    for (const stat of stats) {
      if (stat.toDelete > 0) {
        const deleted = await deleteNonEthereumRecords(client, stat.name, database);
        totalDeleted += deleted;
      }
    }

    console.log();
    console.log('═'.repeat(70));
    console.log(`✅ Deletion complete! Submitted mutations for ${totalDeleted.toLocaleString()} rows.`);
    console.log();
    console.log('ℹ️  Note: ClickHouse DELETE mutations are asynchronous.');
    console.log('   Data will be removed during the next merge cycle.');
    console.log('   You can check mutation status with:');
    console.log(`   SELECT * FROM system.mutations WHERE database = '${database}' AND is_done = 0`);
    console.log();

    await client.close();
    rl.close();
  } catch (err) {
    console.error('❌ Script failed:', err);
    rl.close();
    process.exit(1);
  }
}

main();
