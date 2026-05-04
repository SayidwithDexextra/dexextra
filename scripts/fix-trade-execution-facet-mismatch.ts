#!/usr/bin/env npx tsx
/**
 * Fix OBTradeExecutionFacet Signature Mismatch via FacetRegistry
 * 
 * ROOT CAUSE: The deployed OBTradeExecutionFacet has a 7-param obExecuteTrade signature,
 * but the current OBOrderPlacementFacet calls a 6-param version.
 * 
 * Selectors:
 *   - 0x7320b48e = obExecuteTrade(address,address,uint256,uint256,bool,bool) [6 params - what OBOrderPlacementFacet calls]
 *   - 0xcd3c96f4 = obExecuteTrade(address,address,uint256,uint256,bool,bool,bool) [7 params - what's deployed]
 * 
 * FIX: Register the 6-param selector on the shared FacetRegistry - this fixes ALL markets at once.
 * 
 * Usage:
 *   npx tsx scripts/fix-trade-execution-facet-mismatch.ts --check
 *   npx tsx scripts/fix-trade-execution-facet-mismatch.ts --dry-run
 *   npx tsx scripts/fix-trade-execution-facet-mismatch.ts
 *   npx tsx scripts/fix-trade-execution-facet-mismatch.ts --facet <new-facet-address>
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

// FacetRegistry address from env
const FACET_REGISTRY_ADDRESS = process.env.FACET_REGISTRY_ADDRESS || process.env.NEXT_PUBLIC_FACET_REGISTRY_ADDRESS;

// Selectors for obExecuteTrade
const SELECTORS = {
  sixParam: '0x7320b48e',   // obExecuteTrade(address,address,uint256,uint256,bool,bool)
  sevenParam: '0xcd3c96f4', // obExecuteTrade(address,address,uint256,uint256,bool,bool,bool)
};

// Current deployed facet from env
const TRADE_EXECUTION_FACET = process.env.OB_TRADE_EXECUTION_FACET || process.env.NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET;

// FacetRegistry ABI
const FACET_REGISTRY_ABI = [
  'function getFacet(bytes4 _selector) external view returns (address)',
  'function registerFacet(address _facet, bytes4[] calldata _selectors) external',
  'function updateFacets(bytes4[] calldata _selectors, address[] calldata _facets) external',
  'function admin() external view returns (address)',
  'function selectorToFacet(bytes4) external view returns (address)',
];

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

async function checkRegistrySelectors(provider: ethers.Provider, registryAddress: string) {
  const registry = new ethers.Contract(registryAddress, FACET_REGISTRY_ABI, provider);

  console.log('\n📋 FacetRegistry Selector Status:');
  
  const results: Record<string, { registered: boolean; facet: string }> = {};
  
  for (const [name, selector] of Object.entries(SELECTORS)) {
    try {
      const facet = await registry.getFacet(selector);
      const registered = facet !== ethers.ZeroAddress;
      results[name] = { registered, facet };
      console.log(`   ${registered ? '✅' : '❌'} ${selector} (${name})`);
      if (registered) {
        console.log(`      → Facet: ${facet}`);
      }
    } catch (e: any) {
      // Try selectorToFacet if getFacet fails
      try {
        const facet = await registry.selectorToFacet(selector);
        const registered = facet !== ethers.ZeroAddress;
        results[name] = { registered, facet };
        console.log(`   ${registered ? '✅' : '❌'} ${selector} (${name})`);
        if (registered) {
          console.log(`      → Facet: ${facet}`);
        }
      } catch {
        console.log(`   ❌ ${selector} (${name}) - Error: ${e.message}`);
        results[name] = { registered: false, facet: ethers.ZeroAddress };
      }
    }
  }

  return results;
}

async function applyFix(
  wallet: ethers.Wallet,
  registryAddress: string,
  facetAddress: string,
  dryRun: boolean
): Promise<void> {
  const registry = new ethers.Contract(registryAddress, FACET_REGISTRY_ABI, wallet);

  console.log('\n📋 FacetRegistry Update:');
  console.log(`   Registry: ${shortAddr(registryAddress)}`);
  console.log(`   Facet: ${shortAddr(facetAddress)}`);
  console.log(`   + ${SELECTORS.sixParam} (obExecuteTrade 6-param)`);

  if (dryRun) {
    console.log('\n🔍 DRY RUN - No transaction will be sent');
    
    // Show encoded calldata for both methods
    const iface = new ethers.Interface(FACET_REGISTRY_ABI);
    
    // Method 1: registerFacet
    const calldataRegister = iface.encodeFunctionData('registerFacet', [
      facetAddress,
      [SELECTORS.sixParam]
    ]);
    console.log('\n📝 Option 1 - registerFacet calldata:');
    console.log(calldataRegister);
    
    // Method 2: updateFacets
    const calldataUpdate = iface.encodeFunctionData('updateFacets', [
      [SELECTORS.sixParam],
      [facetAddress]
    ]);
    console.log('\n📝 Option 2 - updateFacets calldata:');
    console.log(calldataUpdate);
    
    return;
  }

  // Check admin
  try {
    const admin = await registry.admin();
    const signerAddr = await wallet.getAddress();
    if (admin.toLowerCase() !== signerAddr.toLowerCase()) {
      console.error(`\n❌ Signer ${shortAddr(signerAddr)} is not the FacetRegistry admin (${shortAddr(admin)})`);
      process.exit(1);
    }
  } catch (e) {
    console.warn('⚠️  Could not verify admin, proceeding anyway...');
  }

  console.log('\n🔧 Sending updateFacets transaction...');
  
  try {
    const tx = await registry.updateFacets(
      [SELECTORS.sixParam],
      [facetAddress]
    );
    console.log(`   TX Hash: ${tx.hash}`);
    console.log('   Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
  } catch (e: any) {
    // Try registerFacet as fallback
    console.log('   updateFacets failed, trying registerFacet...');
    try {
      const tx = await registry.registerFacet(facetAddress, [SELECTORS.sixParam]);
      console.log(`   TX Hash: ${tx.hash}`);
      console.log('   Waiting for confirmation...');
      
      const receipt = await tx.wait();
      console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
      console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
    } catch (e2: any) {
      console.error(`\n❌ Transaction failed: ${e2.shortMessage || e2.message}`);
      if (e2.data) console.error(`   Error data: ${e2.data}`);
      process.exit(1);
    }
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   Fix OBTradeExecutionFacet Signature Mismatch                   ║');
  console.log('║                                                                  ║');
  console.log('║   Problem: OBOrderPlacementFacet calls 6-param obExecuteTrade    ║');
  console.log('║            but only 7-param version is registered                ║');
  console.log('║                                                                  ║');
  console.log('║   Fix: Register 6-param selector on shared FacetRegistry         ║');
  console.log('║        This fixes ALL markets at once!                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const dryRun = hasFlag('--dry-run');
  const checkOnly = hasFlag('--check');
  const facetOverride = getArg('--facet');

  if (!FACET_REGISTRY_ADDRESS || !ethers.isAddress(FACET_REGISTRY_ADDRESS)) {
    console.error('❌ No valid FacetRegistry address found in .env.local');
    console.error('   Set FACET_REGISTRY_ADDRESS or NEXT_PUBLIC_FACET_REGISTRY_ADDRESS');
    process.exit(1);
  }

  const facetAddress = facetOverride || TRADE_EXECUTION_FACET;
  if (!facetAddress || !ethers.isAddress(facetAddress)) {
    console.error('❌ No valid facet address. Set OB_TRADE_EXECUTION_FACET in .env.local or use --facet');
    process.exit(1);
  }

  console.log(`🎯 FacetRegistry: ${FACET_REGISTRY_ADDRESS}`);
  console.log(`📦 Facet Address: ${facetAddress}`);
  console.log(`🌐 RPC: ${RPC_URL.slice(0, 50)}...`);
  console.log(`📋 Mode: ${checkOnly ? 'Check Only' : dryRun ? 'Dry Run' : 'Execute'}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  // Check current state
  const results = await checkRegistrySelectors(provider, FACET_REGISTRY_ADDRESS);

  // Determine if fix is needed
  const needsFix = !results.sixParam.registered;
  
  if (!needsFix) {
    console.log('\n✅ 6-param obExecuteTrade is already registered in FacetRegistry!');
    console.log('   All markets should work correctly.');
    process.exit(0);
  }

  console.log('\n⚠️  6-param obExecuteTrade is NOT registered - fix required');

  if (checkOnly) {
    console.log('\n📋 Check complete. Use without --check to apply fix.');
    process.exit(0);
  }

  // Verify the facet has the 6-param function
  console.log('\n🔍 Verifying facet has 6-param obExecuteTrade...');
  const facetCode = await provider.getCode(facetAddress);
  if (facetCode === '0x' || facetCode.length <= 2) {
    console.error('❌ No contract found at facet address');
    process.exit(1);
  }
  
  // Check if 6-param selector is in the facet bytecode
  const selectorInBytecode = facetCode.toLowerCase().includes(SELECTORS.sixParam.slice(2).toLowerCase());
  if (!selectorInBytecode) {
    console.error('❌ Facet bytecode does not contain 6-param selector');
    console.error('   The facet at this address may be an older version.');
    console.error('   You need to deploy a new OBTradeExecutionFacet from current source.');
    console.error('\n   Steps:');
    console.error('   1. cd to Dexetrav5 directory');
    console.error('   2. forge build');
    console.error('   3. forge create src/diamond/facets/OBTradeExecutionFacet.sol:OBTradeExecutionFacet \\');
    console.error('        --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY');
    console.error('   4. Update OB_TRADE_EXECUTION_FACET in .env.local with new address');
    console.error('   5. Re-run this script with --facet <new-address>');
    process.exit(1);
  }
  console.log('   ✅ Facet has 6-param obExecuteTrade');

  if (!ADMIN_PRIVATE_KEY && !dryRun) {
    console.error('\n❌ ADMIN_PRIVATE_KEY is required in .env.local to execute the fix');
    console.error('   Use --dry-run to see what would be done');
    process.exit(1);
  }

  const wallet = new ethers.Wallet(
    ADMIN_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001',
    provider
  );

  if (!dryRun) {
    const balance = await provider.getBalance(wallet.address);
    console.log(`\n👛 Signer: ${wallet.address}`);
    console.log(`   Balance: ${ethers.formatEther(balance)} native`);
    
    if (balance === 0n) {
      console.error('❌ Signer has no balance for gas');
      process.exit(1);
    }
  }

  await applyFix(wallet, FACET_REGISTRY_ADDRESS, facetAddress, dryRun);

  if (!dryRun) {
    console.log('\n🎉 Fix applied successfully!');
    console.log('   The 6-param obExecuteTrade is now registered in FacetRegistry.');
    console.log('   ALL markets should now work correctly.');
    
    // Verify
    console.log('\n🔍 Verifying fix...');
    const verifyResults = await checkRegistrySelectors(provider, FACET_REGISTRY_ADDRESS);
    if (verifyResults.sixParam.registered) {
      console.log('\n✅ Verification passed!');
    } else {
      console.log('\n⚠️  Verification failed - selector still not registered');
    }
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
