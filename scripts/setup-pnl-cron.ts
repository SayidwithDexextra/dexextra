#!/usr/bin/env tsx
/**
 * Set up the daily P&L snapshot cron job via Upstash QStash.
 * 
 * Run:
 *   npx tsx scripts/setup-pnl-cron.ts
 * 
 * This creates a recurring schedule that fires at 00:05 UTC daily,
 * calling /api/cron/pnl-snapshots to snapshot all user P&L to ClickHouse.
 * 
 * Required env vars:
 *   QSTASH_TOKEN - Your Upstash QStash token
 *   APP_URL or VERCEL_URL - Base URL for your app
 *   CRON_SECRET (optional) - Secret for authenticating cron requests
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { scheduleDailyPnlSnapshots, listSchedules, deleteSchedule } from '../src/lib/qstash-scheduler';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'create';

  console.log('🔧 QStash P&L Snapshot Cron Setup\n');

  if (!process.env.QSTASH_TOKEN) {
    console.error('❌ QSTASH_TOKEN not set in environment');
    process.exit(1);
  }

  const baseUrl = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  console.log(`📍 Target URL: ${baseUrl}/api/cron/pnl-snapshots\n`);

  switch (command) {
    case 'list': {
      console.log('📋 Listing existing schedules...\n');
      const schedules = await listSchedules();
      
      if (schedules.length === 0) {
        console.log('No schedules found.');
      } else {
        console.log('Existing schedules:');
        for (const s of schedules) {
          console.log(`  - ${s.scheduleId}`);
          console.log(`    Cron: ${s.cron}`);
          console.log(`    Destination: ${s.destination}\n`);
        }
      }
      break;
    }

    case 'delete': {
      const scheduleId = args[1];
      if (!scheduleId) {
        console.error('❌ Usage: npx tsx scripts/setup-pnl-cron.ts delete <scheduleId>');
        process.exit(1);
      }
      
      console.log(`🗑️  Deleting schedule ${scheduleId}...`);
      const deleted = await deleteSchedule(scheduleId);
      if (deleted) {
        console.log('✅ Schedule deleted');
      } else {
        console.log('❌ Failed to delete schedule');
      }
      break;
    }

    case 'create':
    default: {
      // First check if a P&L snapshot schedule already exists
      console.log('🔍 Checking for existing P&L snapshot schedules...');
      const existing = await listSchedules();
      const pnlSchedules = existing.filter(s => s.destination.includes('pnl-snapshots'));
      
      if (pnlSchedules.length > 0) {
        console.log('\n⚠️  Found existing P&L snapshot schedule(s):');
        for (const s of pnlSchedules) {
          console.log(`  - ${s.scheduleId} (${s.cron})`);
        }
        console.log('\nTo recreate, first delete the existing schedule:');
        console.log(`  npx tsx scripts/setup-pnl-cron.ts delete ${pnlSchedules[0].scheduleId}`);
        console.log('\nThen run this script again.');
        break;
      }

      console.log('\n📅 Creating daily P&L snapshot schedule...');
      console.log('   Cron: 5 0 * * * (00:05 UTC daily)\n');
      
      const scheduleId = await scheduleDailyPnlSnapshots();
      
      if (scheduleId) {
        console.log('✅ Schedule created successfully!');
        console.log(`   Schedule ID: ${scheduleId}`);
        console.log('\n📊 The cron job will:');
        console.log('   1. Fetch all unique wallet addresses from trading_fees');
        console.log('   2. Query each wallet\'s on-chain margin summary');
        console.log('   3. Store daily P&L snapshots in ClickHouse');
        console.log('\n💡 To verify, check the QStash dashboard or run:');
        console.log('   npx tsx scripts/setup-pnl-cron.ts list');
      } else {
        console.log('❌ Failed to create schedule');
        process.exit(1);
      }
      break;
    }
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
