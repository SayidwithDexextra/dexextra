#!/usr/bin/env npx tsx
/**
 * One-time setup script to create the QStash schedule for HYPE rate updates.
 * Run: npx tsx scripts/setup-hype-rate-schedule.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║       Setup HYPE Rate Update Schedule (QStash)            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // Import dynamically after env is loaded
  const { scheduleHypeRateUpdate, listSchedules } = await import('../src/lib/qstash-scheduler');

  // Check existing schedules first
  console.log('Checking existing schedules...');
  const existing = await listSchedules();
  
  const hypeSchedule = existing.find(s => s.destination.includes('update-hype-rate'));
  if (hypeSchedule) {
    console.log(`\n✓ HYPE rate schedule already exists:`);
    console.log(`  Schedule ID: ${hypeSchedule.scheduleId}`);
    console.log(`  Cron: ${hypeSchedule.cron}`);
    console.log(`  Destination: ${hypeSchedule.destination}`);
    return;
  }

  // Create new schedule
  console.log('\nCreating HYPE rate update schedule...');
  const scheduleId = await scheduleHypeRateUpdate();

  if (scheduleId) {
    console.log('\n✓ Schedule created successfully!');
    console.log(`  Schedule ID: ${scheduleId}`);
    console.log(`  Frequency: Daily at 00:10 UTC`);
    console.log(`  Endpoint: /api/cron/update-hype-rate`);
  } else {
    console.error('\n✗ Failed to create schedule');
    console.log('  Check that QSTASH_TOKEN is properly configured');
    process.exit(1);
  }

  // List all schedules
  console.log('\n─────────────────────────────────────────');
  console.log('All active QStash schedules:');
  const all = await listSchedules();
  for (const s of all) {
    console.log(`  • ${s.cron.padEnd(15)} → ${s.destination}`);
  }
}

main().catch(console.error);
