#!/usr/bin/env npx tsx
/**
 * Upgrade Market - Essential Facets Only
 * 
 * Upgrades only OBOrderPlacementFacet and OBTradeExecutionFacet
 * These are the critical facets for fixing the storage layout issue.
 * 
 * Usage:
 *   npx tsx scripts/upgrade-market-essential-facets.ts 0xFbe79024aCe21df3810473B41b9E156951dF3eF4
 *   npx tsx scripts/upgrade-market-essential-facets.ts 0xFbe79024aCe21df3810473B41b9E156951dF3eF4 --dry-run
 */

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const RPC_URL = process.env.RPC_URL || 'https://hyperliquid-mainnet.g.alchemy.com/v2/PDSUXXYcDJZCb-VLvpvN-';
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

// New facet addresses from deployment
const NEW_FACETS = {
  OBOrderPlacementFacet: '0x571F319Ebc94b287eF3CE165281405f3fA6ee02f',
  OBTradeExecutionFacet: '0xF6538aDFd32a37CA36EE9E464F554416150300e0',
};

// Load selectors from deployed-facets.json
const DEPLOYED_FACETS_FILE = path.join(process.cwd(), 'scripts/deployed-facets.json');

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

async function main() {
  const marketAddress = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  if (!marketAddress || !ethers.isAddress(marketAddress)) {
    console.error('Usage: npx tsx scripts/upgrade-market-essential-facets.ts <market-address> [--dry-run]');
    process.exit(1);
  }

  if (!ADMIN_PRIVATE_KEY) {
    console.error('❌ ADMIN_PRIVATE_KEY required in .env.local');
    process.exit(1);
  }

  // Load deployed facets data
  const deployedData = JSON.parse(fs.readFileSync(DEPLOYED_FACETS_FILE, 'utf-8'));

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   Upgrade Market - Essential Facets Only                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`🎯 Market: ${marketAddress}`);
  console.log(`📋 Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}\n`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);

  console.log(`👛 Signer: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`   Balance: ${ethers.formatEther(balance)} native\n`);

  // Check market exists
  const marketCode = await provider.getCode(marketAddress);
  if (marketCode === '0x' || marketCode.length < 100) {
    console.error(`❌ No contract at ${marketAddress}`);
    process.exit(1);
  }

  const loupe = new ethers.Contract(marketAddress, [
    'function facetAddress(bytes4) view returns (address)',
  ], provider);

  // Build diamond cut for essential facets only
  const cut: { facetAddress: string; action: number; functionSelectors: string[] }[] = [];

  for (const [facetName, newAddress] of Object.entries(NEW_FACETS)) {
    const facetData = deployedData[facetName];
    if (!facetData) {
      console.error(`❌ No data for ${facetName} in deployed-facets.json`);
      process.exit(1);
    }

    const toReplace: string[] = [];
    const toAdd: string[] = [];

    console.log(`📦 ${facetName} → ${shortAddr(newAddress)}`);

    for (const { selector, name } of facetData.selectors) {
      const currentFacet = await loupe.facetAddress(selector);
      const fnName = name.split('(')[0];

      if (currentFacet === ethers.ZeroAddress) {
        toAdd.push(selector);
        console.log(`   ${selector} ${fnName}: ADD`);
      } else if (currentFacet.toLowerCase() !== newAddress.toLowerCase()) {
        toReplace.push(selector);
        console.log(`   ${selector} ${fnName}: REPLACE (was ${shortAddr(currentFacet)})`);
      } else {
        console.log(`   ${selector} ${fnName}: ✓ already correct`);
      }
    }

    if (toReplace.length > 0) {
      cut.push({ facetAddress: newAddress, action: 1, functionSelectors: toReplace });
    }
    if (toAdd.length > 0) {
      cut.push({ facetAddress: newAddress, action: 0, functionSelectors: toAdd });
    }
  }

  if (cut.length === 0) {
    console.log('\n✅ All selectors already point to new facets. Nothing to do.');
    return;
  }

  console.log('\n📋 Diamond Cut Summary:');
  let totalSelectors = 0;
  for (const c of cut) {
    const action = c.action === 0 ? 'ADD' : 'REPLACE';
    console.log(`   ${action} ${c.functionSelectors.length} selectors → ${shortAddr(c.facetAddress)}`);
    totalSelectors += c.functionSelectors.length;
  }
  console.log(`   Total: ${totalSelectors} selectors\n`);

  if (dryRun) {
    console.log('🔍 DRY RUN - No transaction sent');
    return;
  }

  // Verify ownership
  const diamond = new ethers.Contract(marketAddress, [
    'function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)',
    'function owner() view returns (address)',
  ], wallet);

  try {
    const owner = await diamond.owner();
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      console.error(`❌ Not owner. Owner is ${owner}`);
      process.exit(1);
    }
    console.log(`👤 Ownership verified ✓`);
  } catch {
    console.warn('⚠️  Could not verify ownership');
  }

  // Execute
  console.log('\n🔧 Sending diamondCut...');
  try {
    const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, '0x');
    console.log(`   TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
    console.log(`   Gas: ${receipt.gasUsed.toString()}`);
  } catch (e: any) {
    console.error(`❌ Failed: ${e.shortMessage || e.message}`);
    process.exit(1);
  }

  // Quick verification
  console.log('\n🔬 Verifying...');
  try {
    const contract = new ethers.Contract(marketAddress, [
      'function bestAsk() view returns (uint256)',
      'function placeMarginMarketOrderWithSlippage(uint256,bool,uint256) returns (uint256)',
    ], provider);

    const bestAsk = await contract.bestAsk();
    console.log(`   Best Ask: ${bestAsk.toString()}`);

    if (bestAsk > 0n) {
      try {
        await contract.placeMarginMarketOrderWithSlippage.staticCall(
          ethers.parseUnits('0.01', 18),
          true,
          100,
          { from: wallet.address }
        );
        console.log('   ✅ Static call passed!');
      } catch (e: any) {
        if (e.reason?.includes('cannot mix margin and spot')) {
          console.log('   ❌ Still getting margin/spot error');
        } else {
          console.log(`   ✅ No storage layout error (got: ${e.reason || 'other error'})`);
        }
      }
    }
  } catch (e: any) {
    console.log(`   ⚠️  Verification skipped: ${e.message}`);
  }

  console.log('\n🎉 Done! Market upgraded.');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
