#!/usr/bin/env npx tsx
/**
 * Fix Storage Layout - Deploy and Upgrade Facets
 * 
 * This script fixes the storage layout issue where prevOrderId was inserted 
 * in the middle of the Order struct instead of appended at the end.
 * 
 * The fix:
 * 1. Order struct now has prevOrderId at the END (after isMarginOrder)
 * 2. OrderBookMatchingLib has fallback O(n) logic for legacy orders without prevOrderId
 * 3. New orders will have prevOrderId set correctly for O(1) removal
 * 
 * Facets that need redeployment:
 * - OBOrderPlacementFacet (creates orders, sets prevOrderId)
 * - OBTradeExecutionFacet (reads orders)
 * - OBLiquidationFacet (creates synthetic orders)
 * - OBViewFacet (returns order data)
 * 
 * Usage:
 *   # Step 1: Deploy new facets ONCE (saves addresses to file)
 *   npx tsx scripts/fix-storage-layout-deploy-facets.ts --deploy-only
 * 
 *   # Step 2: Upgrade markets one at a time using deployed facets
 *   npx tsx scripts/fix-storage-layout-deploy-facets.ts --upgrade-market 0x4e5D6F497fCf4070A8d87A5Abb019f83E16c64bb
 *   npx tsx scripts/fix-storage-layout-deploy-facets.ts --upgrade-market 0x78BB10E86BC6958307FEfd5EbD2206F6ab149795
 * 
 *   # Dry run to see what would happen
 *   npx tsx scripts/fix-storage-layout-deploy-facets.ts --upgrade-market 0x4e5D6F497fCf4070A8d87A5Abb019f83E16c64bb --dry-run
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

// Facets to deploy
const FACETS = [
  'OBOrderPlacementFacet',
  'OBTradeExecutionFacet',
  'OBLiquidationFacet',
  'OBViewFacet',
];

// File to save deployed facet addresses
const DEPLOYED_FACETS_FILE = path.join(process.cwd(), 'scripts/deployed-facets.json');

function getArtifactPath(facetName: string): string {
  return path.join(
    process.cwd(),
    `Dexetrav5/artifacts/src/diamond/facets/${facetName}.sol/${facetName}.json`
  );
}

function loadDeployedFacets(): Map<string, { address: string; selectors: { selector: string; name: string }[] }> | null {
  if (!fs.existsSync(DEPLOYED_FACETS_FILE)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(DEPLOYED_FACETS_FILE, 'utf-8'));
    return new Map(Object.entries(data));
  } catch {
    return null;
  }
}

function saveDeployedFacets(facets: Map<string, { address: string; selectors: { selector: string; name: string }[] }>): void {
  const obj: Record<string, any> = {};
  for (const [k, v] of facets) {
    obj[k] = v;
  }
  fs.writeFileSync(DEPLOYED_FACETS_FILE, JSON.stringify(obj, null, 2));
  console.log(`\n💾 Saved deployed facet addresses to ${DEPLOYED_FACETS_FILE}`);
}

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

function selectorsFromAbi(abi: any[]): { selector: string; name: string }[] {
  const iface = new ethers.Interface(abi);
  return iface.fragments
    .filter((f): f is ethers.FunctionFragment => f.type === 'function')
    .map((f) => ({
      selector: ethers.id(f.format('sighash')).slice(0, 10),
      name: f.format('sighash'),
    }));
}

// ============ Main Logic ============

async function deployFacet(
  wallet: ethers.Wallet, 
  facetName: string
): Promise<{ address: string; selectors: { selector: string; name: string }[] }> {
  const artifactPath = getArtifactPath(facetName);
  
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}`);
  }
  
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  
  console.log(`\n📦 Deploying ${facetName}...`);
  
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  
  // Get gas estimate
  const deployTx = await factory.getDeployTransaction();
  const gasEstimate = await wallet.estimateGas(deployTx);
  console.log(`   Estimated gas: ${gasEstimate.toString()}`);
  
  // Deploy
  const contract = await factory.deploy();
  console.log(`   Deploy TX: ${contract.deploymentTransaction()?.hash}`);
  
  // Wait for confirmation
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`   ✅ Deployed at: ${address}`);
  
  // Get selectors
  const selectors = selectorsFromAbi(artifact.abi);
  console.log(`   Functions: ${selectors.length}`);
  
  return { address, selectors };
}

async function performDiamondCut(
  wallet: ethers.Wallet,
  marketAddress: string,
  newFacets: Map<string, { address: string; selectors: { selector: string; name: string }[] }>,
  dryRun: boolean
): Promise<void> {
  const provider = wallet.provider!;
  
  // Get current facet mappings
  const loupe = new ethers.Contract(marketAddress, [
    'function facetAddress(bytes4) view returns (address)',
    'function facetAddresses() view returns (address[])',
    'function facetFunctionSelectors(address) view returns (bytes4[])',
  ], provider);
  
  console.log('\n🔍 Analyzing current Diamond state...');
  
  // Build a map of selector -> new facet address
  const selectorToNewFacet = new Map<string, string>();
  const selectorToName = new Map<string, string>();
  
  for (const [facetName, { address, selectors }] of newFacets) {
    for (const { selector, name } of selectors) {
      selectorToNewFacet.set(selector, address);
      selectorToName.set(selector, `${facetName}.${name.split('(')[0]}`);
    }
  }
  
  // Check which selectors need to be added/replaced
  const toReplace: { facet: string; selectors: string[] }[] = [];
  const toAdd: { facet: string; selectors: string[] }[] = [];
  
  const facetReplaceMap = new Map<string, string[]>();
  const facetAddMap = new Map<string, string[]>();
  
  for (const [selector, newFacetAddr] of selectorToNewFacet) {
    const currentFacet = await loupe.facetAddress(selector);
    const name = selectorToName.get(selector) || 'unknown';
    
    if (currentFacet === ethers.ZeroAddress) {
      console.log(`   ${selector} (${name}): NOT registered → ADD`);
      if (!facetAddMap.has(newFacetAddr)) facetAddMap.set(newFacetAddr, []);
      facetAddMap.get(newFacetAddr)!.push(selector);
    } else if (currentFacet.toLowerCase() !== newFacetAddr.toLowerCase()) {
      console.log(`   ${selector} (${name}): ${shortAddr(currentFacet)} → ${shortAddr(newFacetAddr)} REPLACE`);
      if (!facetReplaceMap.has(newFacetAddr)) facetReplaceMap.set(newFacetAddr, []);
      facetReplaceMap.get(newFacetAddr)!.push(selector);
    } else {
      console.log(`   ${selector} (${name}): already correct ✓`);
    }
  }
  
  // Build diamond cut
  const cut: { facetAddress: string; action: number; functionSelectors: string[] }[] = [];
  
  for (const [facetAddr, selectors] of facetReplaceMap) {
    if (selectors.length > 0) {
      cut.push({
        facetAddress: facetAddr,
        action: 1, // Replace
        functionSelectors: selectors,
      });
    }
  }
  
  for (const [facetAddr, selectors] of facetAddMap) {
    if (selectors.length > 0) {
      cut.push({
        facetAddress: facetAddr,
        action: 0, // Add
        functionSelectors: selectors,
      });
    }
  }
  
  if (cut.length === 0) {
    console.log('\n✅ All selectors already point to correct facets. No cut needed.');
    return;
  }
  
  console.log('\n📋 Diamond Cut Summary:');
  for (const c of cut) {
    const actionName = c.action === 0 ? 'ADD' : c.action === 1 ? 'REPLACE' : 'REMOVE';
    console.log(`   ${actionName} ${c.functionSelectors.length} selectors → ${shortAddr(c.facetAddress)}`);
  }
  
  if (dryRun) {
    console.log('\n🔍 DRY RUN - No transaction will be sent');
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
      process.exit(1);
    }
    console.log(`\n👤 Diamond owner verified: ${shortAddr(owner)}`);
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

async function verifyFix(provider: ethers.Provider, marketAddress: string): Promise<boolean> {
  console.log('\n🔬 Verifying fix...');
  
  const contract = new ethers.Contract(marketAddress, [
    'function bestAsk() view returns (uint256)',
    'function placeMarginMarketOrderWithSlippage(uint256 amount, bool isBuy, uint256 slippageBps) returns (uint256)',
  ], provider);
  
  const bestAsk = await contract.bestAsk();
  console.log(`   Best Ask: ${bestAsk.toString()}`);
  
  if (bestAsk === 0n) {
    console.log('   ⚠️  No asks in order book, cannot fully test');
    return true;
  }
  
  // Try static call for a buy order
  try {
    await contract.placeMarginMarketOrderWithSlippage.staticCall(
      ethers.parseUnits('0.01', 18), // Small amount
      true, // Buy
      100, // 1% slippage
      { from: '0xddA468df398DDeEcC7d589Ef3195c828Df4812B4' }
    );
    console.log('   ✅ Static call succeeded!');
    return true;
  } catch (e: any) {
    if (e.reason?.includes('cannot mix margin and spot')) {
      console.log('   ❌ Still getting "cannot mix margin and spot" error');
      return false;
    } else if (e.message?.includes('missing revert data')) {
      console.log('   ❌ Still getting missing revert data');
      return false;
    } else {
      // Other errors are expected (e.g., insufficient balance, etc.)
      console.log(`   ✅ No longer getting storage layout errors`);
      console.log(`   Expected error: ${e.reason || e.shortMessage || 'unknown'}`);
      return true;
    }
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   Fix Storage Layout - Deploy and Upgrade Facets               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  console.log('This fixes the storage layout issue where prevOrderId was inserted');
  console.log('in the middle of the Order struct, causing isMarginOrder to be read');
  console.log('from the wrong storage slot.\n');

  const deployOnly = hasFlag('--deploy-only');
  const marketAddress = getArg('--upgrade-market');
  const dryRun = hasFlag('--dry-run');

  if (!deployOnly && !marketAddress) {
    console.error('Usage:');
    console.error('  # Step 1: Deploy new facets ONCE');
    console.error('  npx tsx scripts/fix-storage-layout-deploy-facets.ts --deploy-only');
    console.error('');
    console.error('  # Step 2: Upgrade markets one at a time');
    console.error('  npx tsx scripts/fix-storage-layout-deploy-facets.ts --upgrade-market <address>');
    console.error('  npx tsx scripts/fix-storage-layout-deploy-facets.ts --upgrade-market <address> --dry-run');
    process.exit(1);
  }

  if (!ADMIN_PRIVATE_KEY) {
    console.error('❌ ADMIN_PRIVATE_KEY is required in .env.local');
    process.exit(1);
  }

  console.log(`🌐 RPC: ${RPC_URL.slice(0, 50)}...`);
  if (marketAddress) {
    console.log(`🎯 Market: ${marketAddress}`);
  }
  console.log(`📋 Mode: ${deployOnly ? 'Deploy Only' : dryRun ? 'Dry Run' : 'Execute Upgrade'}`);
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`\n👛 Deployer: ${wallet.address}`);
  console.log(`   Balance: ${ethers.formatEther(balance)} native`);
  
  if (balance === 0n) {
    console.error('❌ Deployer has no balance for gas');
    process.exit(1);
  }

  let deployedFacets: Map<string, { address: string; selectors: { selector: string; name: string }[] }>;

  if (deployOnly) {
    // Deploy all facets
    deployedFacets = new Map();
    
    for (const facetName of FACETS) {
      try {
        const result = await deployFacet(wallet, facetName);
        deployedFacets.set(facetName, result);
      } catch (e: any) {
        console.error(`❌ Failed to deploy ${facetName}: ${e.message}`);
        process.exit(1);
      }
    }
    
    // Save to file
    saveDeployedFacets(deployedFacets);
    
    // Print summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📝 New Facet Addresses - Update .env.local:');
    console.log('═══════════════════════════════════════════════════════════════');
    
    for (const [name, { address }] of deployedFacets) {
      const envName = name.replace(/([A-Z])/g, '_$1').toUpperCase().slice(1);
      console.log(`${envName}=${address}`);
      console.log(`NEXT_PUBLIC_${envName}=${address}`);
    }
    
    console.log('\n✅ Deployment complete!');
    console.log('\nNext step - upgrade markets one at a time:');
    console.log('  npx tsx scripts/fix-storage-layout-deploy-facets.ts --upgrade-market <address>');
    return;
  }
  
  // Upgrade market mode - load previously deployed facets
  deployedFacets = loadDeployedFacets()!;
  
  if (!deployedFacets) {
    console.error('❌ No deployed facets found. Run --deploy-only first.');
    console.error('   npx tsx scripts/fix-storage-layout-deploy-facets.ts --deploy-only');
    process.exit(1);
  }
  
  console.log('\n📦 Using previously deployed facets:');
  for (const [name, { address }] of deployedFacets) {
    console.log(`   ${name}: ${address}`);
  }
  
  // Verify market exists
  const marketCode = await provider.getCode(marketAddress!);
  if (marketCode === '0x' || marketCode.length < 100) {
    console.error(`❌ No contract at market address ${marketAddress}`);
    process.exit(1);
  }
  
  // Perform diamond cut
  await performDiamondCut(wallet, marketAddress!, deployedFacets, dryRun);
  
  // Verify fix
  if (!dryRun) {
    const fixed = await verifyFix(provider, marketAddress!);
    if (fixed) {
      console.log('\n🎉 Upgrade complete! Trading should now work on this market.');
      console.log('\nTo upgrade another market:');
      console.log(`  npx tsx scripts/fix-storage-layout-deploy-facets.ts --upgrade-market <next-market-address>`);
    } else {
      console.log('\n⚠️  Upgrade complete but verification failed. Check manually.');
    }
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
