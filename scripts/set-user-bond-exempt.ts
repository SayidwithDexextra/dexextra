#!/usr/bin/env npx tsx
/**
 * Set User Bond Exempt
 * 
 * Makes specific users exempt from proposal bond requirements across all active markets.
 * This allows users to submit settlement challenges without posting bond collateral.
 * 
 * USAGE:
 *   npx tsx scripts/set-user-bond-exempt.ts <address>
 *   npx tsx scripts/set-user-bond-exempt.ts 0x95e032363961aC41de16b675ef915c7983404A51
 *   npx tsx scripts/set-user-bond-exempt.ts <address> --revoke    # Remove exemption
 *   npx tsx scripts/set-user-bond-exempt.ts <address> --dry-run   # Check without executing
 */

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const BOND_EXEMPT_ABI = [
  'function isProposalBondExempt(address account) view returns (bool)',
  'function setProposalBondExempt(address account, bool exempt) external',
  'function setProposalBondExemptBatch(address[] accounts, bool exempt) external',
];

async function getAllMarketsFromDb(): Promise<Array<{ address: string; symbol: string }>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase not configured');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  
  const { data, error } = await supabase
    .from('markets')
    .select('market_address, symbol')
    .eq('is_active', true)
    .not('market_address', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`DB error: ${error.message}`);
  
  return (data || []).map(m => ({
    address: m.market_address,
    symbol: m.symbol || 'Unknown',
  }));
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

async function main() {
  console.log('═'.repeat(70));
  console.log('  SET USER BOND EXEMPTION');
  console.log('═'.repeat(70));

  const args = process.argv.slice(2);
  const userAddress = args.find(a => ethers.isAddress(a));
  const revoke = args.includes('--revoke');
  const dryRun = args.includes('--dry-run');

  if (!userAddress) {
    console.error('\nUsage: npx tsx scripts/set-user-bond-exempt.ts <address> [--revoke] [--dry-run]');
    console.error('\nExamples:');
    console.error('  npx tsx scripts/set-user-bond-exempt.ts 0x95e032363961aC41de16b675ef915c7983404A51');
    console.error('  npx tsx scripts/set-user-bond-exempt.ts 0x95e032363961aC41de16b675ef915c7983404A51 --revoke');
    console.error('  npx tsx scripts/set-user-bond-exempt.ts 0x95e032363961aC41de16b675ef915c7983404A51 --dry-run');
    process.exit(1);
  }

  const checksumAddress = ethers.getAddress(userAddress);
  console.log(`\nUser: ${checksumAddress}`);
  console.log(`Action: ${revoke ? 'REVOKE exemption' : 'GRANT exemption'}`);
  if (dryRun) console.log('Mode: DRY RUN (no transactions)');
  console.log();

  const rpcUrl = process.env.RPC_URL || process.env.HYPERLIQUID_RPC_URL;
  const adminPk = process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY;

  if (!rpcUrl) throw new Error('RPC_URL not configured');
  if (!adminPk) throw new Error('PRIVATE_KEY not configured');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const adminWallet = new ethers.Wallet(adminPk, provider);

  console.log(`Admin wallet: ${await adminWallet.getAddress()}`);
  
  const balance = await provider.getBalance(adminWallet.address);
  console.log(`Admin balance: ${ethers.formatEther(balance)} ETH\n`);

  console.log('Fetching active markets...');
  const markets = await getAllMarketsFromDb();
  
  if (markets.length === 0) {
    console.log('No active markets found.');
    process.exit(0);
  }

  console.log(`Found ${markets.length} active market(s)\n`);

  const results: { market: string; symbol: string; status: string; tx?: string }[] = [];

  for (const market of markets) {
    const contract = new ethers.Contract(market.address, BOND_EXEMPT_ABI, adminWallet);
    
    try {
      const isExempt = await contract.isProposalBondExempt(checksumAddress);
      const needsUpdate = revoke ? isExempt : !isExempt;

      if (!needsUpdate) {
        console.log(`✓ ${market.symbol} (${shortAddr(market.address)}): Already ${isExempt ? 'exempt' : 'not exempt'}`);
        results.push({ market: market.address, symbol: market.symbol, status: 'skipped' });
        continue;
      }

      if (dryRun) {
        console.log(`○ ${market.symbol} (${shortAddr(market.address)}): Would ${revoke ? 'revoke' : 'grant'} exemption`);
        results.push({ market: market.address, symbol: market.symbol, status: 'dry-run' });
        continue;
      }

      console.log(`→ ${market.symbol} (${shortAddr(market.address)}): ${revoke ? 'Revoking' : 'Granting'} exemption...`);
      const tx = await contract.setProposalBondExempt(checksumAddress, !revoke);
      console.log(`  tx: ${tx.hash}`);
      await tx.wait();
      console.log(`  ✓ Confirmed`);
      results.push({ market: market.address, symbol: market.symbol, status: 'success', tx: tx.hash });

    } catch (e: any) {
      console.log(`✗ ${market.symbol} (${shortAddr(market.address)}): ${e?.shortMessage || e?.message || 'Failed'}`);
      results.push({ market: market.address, symbol: market.symbol, status: 'error' });
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('  SUMMARY');
  console.log('═'.repeat(70));

  const successful = results.filter(r => r.status === 'success').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'error').length;

  console.log(`\nUser: ${checksumAddress}`);
  console.log(`✓ Updated: ${successful}`);
  console.log(`○ Skipped (already set): ${skipped}`);
  console.log(`✗ Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n\x1b[33mSome markets failed - check errors above\x1b[0m');
    process.exit(1);
  } else {
    console.log('\n\x1b[32mDone!\x1b[0m');
  }
}

main().catch((e) => {
  console.error('\nScript failed:', e.message);
  process.exit(1);
});
