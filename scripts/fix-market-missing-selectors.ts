#!/usr/bin/env npx tsx
/**
 * Fix Missing Diamond Selectors for a Market
 * 
 * This script patches an existing OrderBook Diamond contract by adding
 * missing function selectors that were not registered during deployment.
 * 
 * The issue: OBTradeExecutionFacet.json ABI was outdated and missing
 * obExecuteTradeBatch, causing FunctionDoesNotExist errors when trading.
 * 
 * Usage:
 *   npx tsx scripts/fix-market-missing-selectors.ts --market 0x78BB10E86BC6958307FEfd5EbD2206F6ab149795
 *   npx tsx scripts/fix-market-missing-selectors.ts --market 0x78BB10E86BC6958307FEfd5EbD2206F6ab149795 --dry-run
 *   npx tsx scripts/fix-market-missing-selectors.ts --all  # Fix all markets with missing selectors
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

// ============ Configuration ============

const RPC_URL = process.env.RPC_URL || 'https://hyperliquid-mainnet.g.alchemy.com/v2/PDSUXXYcDJZCb-VLvpvN-';
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

// Canonical facet addresses (from env or defaults)
const FACET_ADDRESSES = {
  OBTradeExecutionFacet: process.env.OB_TRADE_EXECUTION_FACET || process.env.NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET,
  OBOrderPlacementFacet: process.env.OB_ORDER_PLACEMENT_FACET || process.env.NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET,
  OBViewFacet: process.env.OB_VIEW_FACET || process.env.NEXT_PUBLIC_OB_VIEW_FACET,
  OBSettlementFacet: process.env.OB_SETTLEMENT_FACET || process.env.NEXT_PUBLIC_OB_SETTLEMENT_FACET,
  OBLiquidationFacet: process.env.OB_LIQUIDATION_FACET || process.env.NEXT_PUBLIC_OB_LIQUIDATION_FACET,
  OBAdminFacet: process.env.OB_ADMIN_FACET || process.env.NEXT_PUBLIC_OB_ADMIN_FACET,
  OBPricingFacet: process.env.OB_PRICING_FACET || process.env.NEXT_PUBLIC_OB_PRICING_FACET,
  MetaTradeFacet: process.env.META_TRADE_FACET || process.env.NEXT_PUBLIC_META_TRADE_FACET,
  MarketLifecycleFacet: process.env.MARKET_LIFECYCLE_FACET || process.env.NEXT_PUBLIC_MARKET_LIFECYCLE_FACET,
  OrderBookVaultAdminFacet: process.env.ORDERBOOK_VAULT_FACET || process.env.NEXT_PUBLIC_ORDERBOOK_VAULT_FACET,
};

// Expected selectors per facet (computed from current ABIs)
const EXPECTED_SELECTORS: Record<string, { sig: string; sel: string }[]> = {
  OBTradeExecutionFacet: [
    { sig: 'obExecuteTrade(address,address,uint256,uint256,bool,bool,bool)', sel: '0xcd3c96f4' },
    { sig: 'obExecuteTradeBatch(address,bool,bool,(address,uint256,uint256,bool,uint256)[])', sel: '0xfec5fa72' },
    { sig: 'getAllTrades(uint256,uint256)', sel: '0xdffd8a1f' },
    { sig: 'getLastTwentyTrades()', sel: '0xa242068f' },
    { sig: 'getRecentTrades(uint256)', sel: '0xc63877eb' },
    { sig: 'getTradeById(uint256)', sel: '0x72666684' },
    { sig: 'getTradeStatistics()', sel: '0x8a7a9555' },
    { sig: 'getTradesByTimeRange(uint256,uint256,uint256,uint256)', sel: '0xbdae53d6' },
    { sig: 'getUserTradeCount(address)', sel: '0xb0157cfb' },
    { sig: 'getUserTrades(address,uint256,uint256)', sel: '0x5e7f18af' },
  ],
  OBOrderPlacementFacet: [
    { sig: 'placeLimitOrder(uint256,uint256,bool)', sel: '0xe14090b9' },
    { sig: 'placeMarginLimitOrder(uint256,uint256,bool)', sel: '0x1b295ea6' },
    { sig: 'placeMarketOrder(uint256,bool)', sel: '0xf693baa5' },
    { sig: 'placeMarginMarketOrder(uint256,bool)', sel: '0x8f6c6c9a' },
    { sig: 'placeMarketOrderWithSlippage(uint256,bool,uint256)', sel: '0x7e1c0c09' },
    { sig: 'placeMarginMarketOrderWithSlippage(uint256,bool,uint256)', sel: '0x2bf1f034' },
    { sig: 'cancelOrder(uint256)', sel: '0x514fcac7' },
  ],
};

// ============ Helpers ============

function shortAddr(a: string): string {
  return a.startsWith('0x') && a.length === 42 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

// ============ Main Logic ============

interface MissingSelector {
  facetName: string;
  facetAddress: string;
  selector: string;
  signature: string;
}

async function checkMissingSelectors(
  provider: ethers.Provider,
  marketAddress: string
): Promise<MissingSelector[]> {
  const loupe = new ethers.Contract(marketAddress, [
    'function facetAddress(bytes4) view returns (address)',
  ], provider);

  const missing: MissingSelector[] = [];

  for (const [facetName, selectors] of Object.entries(EXPECTED_SELECTORS)) {
    const facetAddr = FACET_ADDRESSES[facetName as keyof typeof FACET_ADDRESSES];
    if (!facetAddr || !ethers.isAddress(facetAddr)) {
      console.warn(`⚠️  No address configured for ${facetName}, skipping`);
      continue;
    }

    for (const { sig, sel } of selectors) {
      try {
        const registeredFacet = await loupe.facetAddress(sel);
        if (registeredFacet === ethers.ZeroAddress) {
          missing.push({
            facetName,
            facetAddress: facetAddr,
            selector: sel,
            signature: sig,
          });
        }
      } catch (e: any) {
        console.warn(`⚠️  Could not check selector ${sel}: ${e.message}`);
      }
    }
  }

  return missing;
}

async function applyDiamondCut(
  wallet: ethers.Wallet,
  marketAddress: string,
  missing: MissingSelector[],
  dryRun: boolean
): Promise<void> {
  // Group by facet address
  const byFacet: Record<string, string[]> = {};
  for (const m of missing) {
    if (!byFacet[m.facetAddress]) byFacet[m.facetAddress] = [];
    byFacet[m.facetAddress].push(m.selector);
  }

  const cut = Object.entries(byFacet).map(([facetAddress, functionSelectors]) => ({
    facetAddress,
    action: 0, // Add
    functionSelectors,
  }));

  console.log('\n📋 Diamond Cut:');
  for (const c of cut) {
    console.log(`   Facet: ${shortAddr(c.facetAddress)}`);
    for (const sel of c.functionSelectors) {
      const info = missing.find(m => m.selector === sel);
      console.log(`     + ${sel} (${info?.signature || 'unknown'})`);
    }
  }

  if (dryRun) {
    console.log('\n🔍 DRY RUN - No transaction will be sent');
    
    // Encode for reference
    const CutABI = ['function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)'];
    const iface = new ethers.Interface(CutABI);
    const calldata = iface.encodeFunctionData('diamondCut', [cut, ethers.ZeroAddress, '0x']);
    console.log('\n📝 Encoded calldata (for manual execution):');
    console.log(calldata);
    return;
  }

  // Execute the cut
  const diamond = new ethers.Contract(marketAddress, [
    'function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)',
    'function owner() view returns (address)',
  ], wallet);

  // Check ownership
  try {
    const owner = await diamond.owner();
    const signerAddr = await wallet.getAddress();
    if (owner.toLowerCase() !== signerAddr.toLowerCase()) {
      console.error(`\n❌ Signer ${shortAddr(signerAddr)} is not the Diamond owner (${shortAddr(owner)})`);
      console.error('   The diamondCut will fail. Use the correct ADMIN_PRIVATE_KEY.');
      process.exit(1);
    }
  } catch (e) {
    console.warn('⚠️  Could not verify ownership, proceeding anyway...');
  }

  console.log('\n🔧 Sending diamondCut transaction...');
  
  try {
    const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, '0x');
    console.log(`   TX Hash: ${tx.hash}`);
    console.log('   Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
  } catch (e: any) {
    console.error(`\n❌ Transaction failed: ${e.shortMessage || e.message}`);
    if (e.data) console.error(`   Error data: ${e.data}`);
    process.exit(1);
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Fix Missing Diamond Selectors for OrderBook Market     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const marketAddress = getArg('--market');
  const dryRun = hasFlag('--dry-run');
  const checkOnly = hasFlag('--check');

  if (!marketAddress || !ethers.isAddress(marketAddress)) {
    console.error('Usage: npx tsx scripts/fix-market-missing-selectors.ts --market <address> [--dry-run] [--check]');
    console.error('\nOptions:');
    console.error('  --market <address>  The OrderBook Diamond address to fix');
    console.error('  --dry-run           Show what would be done without executing');
    console.error('  --check             Only check for missing selectors, no fix');
    process.exit(1);
  }

  if (!ADMIN_PRIVATE_KEY && !dryRun && !checkOnly) {
    console.error('❌ ADMIN_PRIVATE_KEY is required in .env.local to execute the fix');
    console.error('   Use --dry-run or --check to see what selectors are missing');
    process.exit(1);
  }

  console.log(`🎯 Target Market: ${marketAddress}`);
  console.log(`🌐 RPC: ${RPC_URL.slice(0, 50)}...`);
  console.log(`📋 Mode: ${checkOnly ? 'Check Only' : dryRun ? 'Dry Run' : 'Execute'}\n`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  // Verify contract exists
  const code = await provider.getCode(marketAddress);
  if (code === '0x' || code.length <= 2) {
    console.error('❌ No contract found at this address');
    process.exit(1);
  }

  console.log('🔍 Checking for missing selectors...\n');
  const missing = await checkMissingSelectors(provider, marketAddress);

  if (missing.length === 0) {
    console.log('✅ All expected selectors are registered! No fix needed.');
    process.exit(0);
  }

  console.log(`⚠️  Found ${missing.length} missing selector(s):\n`);
  for (const m of missing) {
    console.log(`   ${m.selector} - ${m.signature}`);
    console.log(`     → Should point to ${m.facetName} (${shortAddr(m.facetAddress)})`);
  }

  if (checkOnly) {
    console.log('\n📋 Check complete. Use without --check to fix.');
    process.exit(0);
  }

  // Prepare wallet for execution
  const wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001', provider);
  
  if (!dryRun) {
    const balance = await provider.getBalance(wallet.address);
    console.log(`\n👛 Signer: ${wallet.address}`);
    console.log(`   Balance: ${ethers.formatEther(balance)} native`);
    
    if (balance === 0n) {
      console.error('❌ Signer has no balance for gas');
      process.exit(1);
    }
  }

  await applyDiamondCut(wallet, marketAddress, missing, dryRun);

  if (!dryRun) {
    console.log('\n🎉 Market fixed successfully!');
    console.log('   Trading should now work correctly.');
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
