#!/usr/bin/env node
/**
 * Interactive script to wipe Live Metric Tracker data from ClickHouse for a specific market.
 *
 * This script will:
 *   1. Connect to Supabase to list all available markets
 *   2. Let you select a market (or enter a UUID directly)
 *   3. Show counts of records to be deleted from metric series tables
 *   4. Require confirmation before deleting
 *   5. Delete all metric series records for the selected market
 *
 * Tables affected (Live Metric Tracker only):
 *   - metric_series_raw (raw metric inserts)
 *   - metric_series_1m (1-minute bucketed aggregates via MV)
 *
 * Usage:
 *   node scripts/wipe-market-clickhouse-data.js
 *   MARKET_UUID=<uuid> node scripts/wipe-market-clickhouse-data.js  # Skip selection
 *   MARKET_UUID=<uuid> SKIP_CONFIRM=1 node scripts/wipe-market-clickhouse-data.js  # Skip confirmation
 */

require('dotenv').config({ path: '.env.local' });
const readline = require('readline');
const { createClient: createClickHouseClient } = require('@clickhouse/client');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ensureClickHouseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}

function looksLikeUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || '').trim()
  );
}

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function formatNumber(n) {
  return Number(n).toLocaleString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Table definitions for Live Metric Tracker (metric_series tables only)
// ─────────────────────────────────────────────────────────────────────────────

const CLICKHOUSE_TABLES = [
  // Live Metric Tracker tables use 'market_id' column
  { table: 'metric_series_raw', column: 'market_id', description: 'Raw metric inserts (Live Metric Tracker)' },
  { table: 'metric_series_1m', column: 'market_id', description: '1-minute bucketed aggregates (via MV)' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📊 Live Metric Tracker - ClickHouse Data Wipe Tool\n');
  console.log('━'.repeat(55));

  // Initialize ClickHouse client
  const chUrl = ensureClickHouseUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  if (!chUrl) {
    console.error('❌ Missing CLICKHOUSE_URL or CLICKHOUSE_HOST environment variable.');
    process.exit(1);
  }

  const clickhouse = createClickHouseClient({
    url: chUrl,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || 'default',
    request_timeout: 120_000,
    compression: { request: false, response: false },
  });

  // Initialize Supabase client
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const sbKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!sbUrl || !sbKey) {
    console.error('❌ Missing Supabase environment variables (SUPABASE_URL/KEY).');
    process.exit(1);
  }

  const supabase = createSupabaseClient(sbUrl, sbKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    let marketUuid = (process.env.MARKET_UUID || '').trim();

    // If no market UUID provided, show interactive selection
    if (!marketUuid) {
      console.log('\n📋 Fetching markets from Supabase...\n');

      const { data: markets, error: marketsErr } = await supabase
        .from('markets')
        .select('id, symbol, market_identifier, name, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      if (marketsErr) {
        console.error('❌ Failed to fetch markets:', marketsErr.message);
        process.exit(1);
      }

      if (!markets || markets.length === 0) {
        console.log('⚠️  No markets found in Supabase.');
        process.exit(0);
      }

      // Display markets
      console.log('Available markets:\n');
      console.log('  #   Symbol          Identifier                    UUID');
      console.log('  ' + '─'.repeat(80));

      markets.forEach((m, i) => {
        const num = String(i + 1).padStart(3, ' ');
        const symbol = String(m.symbol || '-').padEnd(15, ' ');
        const identifier = String(m.market_identifier || m.name || '-').padEnd(30, ' ').slice(0, 30);
        const uuid = m.id || '-';
        console.log(`  ${num}. ${symbol} ${identifier} ${uuid}`);
      });

      console.log('\n  ' + '─'.repeat(80));
      console.log('  Enter a number (1-' + markets.length + ') or paste a market UUID directly.\n');

      const input = await prompt(rl, '  Your selection: ');
      const trimmedInput = input.trim();

      // Check if input is a number (market selection)
      const num = parseInt(trimmedInput, 10);
      if (!isNaN(num) && num >= 1 && num <= markets.length) {
        marketUuid = markets[num - 1].id;
      } else if (looksLikeUuid(trimmedInput)) {
        marketUuid = trimmedInput;
      } else {
        console.error('\n❌ Invalid selection. Please enter a valid number or UUID.');
        process.exit(1);
      }
    }

    // Validate UUID format
    if (!looksLikeUuid(marketUuid)) {
      console.error(`\n❌ Invalid market UUID format: ${marketUuid}`);
      process.exit(1);
    }

    const safeUuid = marketUuid.replace(/'/g, "\\'");

    // Fetch market details from Supabase
    console.log(`\n🔍 Looking up market: ${marketUuid}\n`);

    const { data: market } = await supabase
      .from('markets')
      .select('id, symbol, market_identifier, name')
      .eq('id', marketUuid)
      .maybeSingle();

    if (market) {
      console.log('  Market found in Supabase:');
      console.log(`    Symbol:     ${market.symbol || '-'}`);
      console.log(`    Identifier: ${market.market_identifier || '-'}`);
      console.log(`    Name:       ${market.name || '-'}`);
      console.log(`    UUID:       ${market.id}`);
    } else {
      console.log('  ⚠️  Market not found in Supabase (may have been deleted).');
      console.log(`    UUID:       ${marketUuid}`);
    }

    // Count records in each ClickHouse table
    console.log('\n📊 Counting Live Metric Tracker records to be deleted...\n');

    const counts = {};
    let totalRecords = 0;
    let tablesWithData = 0;

    for (const { table, column, description } of CLICKHOUSE_TABLES) {
      try {
        const query = `SELECT count() AS n FROM ${table} WHERE ${column} = '${safeUuid}'`;
        const result = await clickhouse.query({ query, format: 'JSONEachRow' });
        const rows = await result.json();
        const count = rows?.[0]?.n ? Number(rows[0].n) : 0;
        counts[table] = { count, column, description };
        totalRecords += count;
        if (count > 0) tablesWithData++;
      } catch (err) {
        // Table might not exist
        counts[table] = { count: 0, column, description, error: err.message };
      }
    }

    // Display counts
    console.log('  Table                    Records        Description');
    console.log('  ' + '─'.repeat(70));

    for (const { table, column, description } of CLICKHOUSE_TABLES) {
      const { count, error } = counts[table];
      const tableName = table.padEnd(24, ' ');
      const countStr = error ? '(error)'.padStart(10, ' ') : formatNumber(count).padStart(10, ' ');
      console.log(`  ${tableName} ${countStr}        ${description}`);
    }

    console.log('  ' + '─'.repeat(70));
    console.log(`  ${'TOTAL'.padEnd(24, ' ')} ${formatNumber(totalRecords).padStart(10, ' ')}\n`);

    // Check if there's anything to delete
    if (totalRecords === 0) {
      console.log('✅ No Live Metric Tracker records found for this market. Nothing to delete.\n');
      await clickhouse.close();
      rl.close();
      process.exit(0);
    }

    // Confirm deletion
    const skipConfirm = process.env.SKIP_CONFIRM === '1' || process.env.SKIP_CONFIRM === 'true';

    if (!skipConfirm) {
      console.log('⚠️  WARNING: This action is IRREVERSIBLE!\n');

      const confirm = await prompt(
        rl,
        `  Type "DELETE" to confirm deletion of ${formatNumber(totalRecords)} records: `
      );

      if (confirm.trim() !== 'DELETE') {
        console.log('\n❌ Deletion cancelled.\n');
        await clickhouse.close();
        rl.close();
        process.exit(0);
      }
    } else {
      console.log('⚠️  Skipping confirmation (SKIP_CONFIRM=1).\n');
    }

    // Perform deletion
    console.log('\n🗑️  Deleting Live Metric Tracker records...\n');

    let deletedTables = 0;
    let failedTables = 0;

    for (const { table, column, description } of CLICKHOUSE_TABLES) {
      const { count, error: prevError } = counts[table];

      // Skip tables with errors or no data
      if (prevError || count === 0) {
        if (count === 0) {
          console.log(`  ⏭️  ${table}: No records to delete`);
        }
        continue;
      }

      try {
        const deleteQuery = `ALTER TABLE ${table} DELETE WHERE ${column} = '${safeUuid}' SETTINGS mutations_sync = 1`;
        await clickhouse.exec({ query: deleteQuery });
        console.log(`  ✅ ${table}: Deleted ${formatNumber(count)} records`);
        deletedTables++;
      } catch (err) {
        console.error(`  ❌ ${table}: Failed to delete - ${err.message}`);
        failedTables++;
      }
    }

    // Summary
    console.log('\n' + '━'.repeat(55));
    console.log('\n📋 Summary:\n');
    console.log(`  Market UUID:     ${marketUuid}`);
    console.log(`  Tables cleared:  ${deletedTables}`);
    console.log(`  Tables failed:   ${failedTables}`);
    console.log(`  Total records:   ${formatNumber(totalRecords)}`);

    if (failedTables === 0) {
      console.log('\n🎉 All Live Metric Tracker records successfully deleted!\n');
    } else {
      console.log(`\n⚠️  ${failedTables} table(s) had errors during deletion.\n`);
      process.exitCode = 1;
    }

    await clickhouse.close();
    rl.close();
  } catch (err) {
    console.error('\n❌ Unexpected error:', err.message || err);
    await clickhouse.close();
    rl.close();
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ Script failed:', e?.stack || e);
    process.exit(1);
  });
}

module.exports = { main };
