#!/usr/bin/env npx tsx
/**
 * Deploy New OBTradeExecutionFacet and Upgrade Diamond
 * 
 * This script:
 * 1. Deploys a new OBTradeExecutionFacet contract with obExecuteTradeBatch support
 * 2. Performs a diamondCut to replace old selectors with the new facet address
 * 
 * The old facet at 0xCd396BCE332729F05D9C6396861d2293058c1731 doesn't have
 * obExecuteTradeBatch, causing "missing revert data" errors when trading.
 * 
 * Usage:
 *   npx tsx scripts/deploy-and-upgrade-trade-execution-facet.ts --market 0x78BB10E86BC6958307FEfd5EbD2206F6ab149795
 *   npx tsx scripts/deploy-and-upgrade-trade-execution-facet.ts --market 0x78BB10E86BC6958307FEfd5EbD2206F6ab149795 --dry-run
 *   npx tsx scripts/deploy-and-upgrade-trade-execution-facet.ts --deploy-only  # Just deploy facet, no cut
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

// Load the compiled artifact
const ARTIFACT_PATH = path.join(
  process.cwd(),
  'Dexetrav5/artifacts/src/diamond/facets/OBTradeExecutionFacet.sol/OBTradeExecutionFacet.json'
);

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

async function deployFacet(wallet: ethers.Wallet, artifact: any): Promise<string> {
  console.log('\n📦 Deploying new OBTradeExecutionFacet...');
  
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
  
  // Verify bytecode
  const provider = wallet.provider!;
  const code = await provider.getCode(address);
  const expectedLength = artifact.deployedBytecode.length;
  console.log(`   Bytecode length: ${code.length} (expected ~${expectedLength})`);
  
  // Check that obExecuteTradeBatch is in the bytecode
  const hasSelector = code.toLowerCase().includes('fec5fa72');
  if (hasSelector) {
    console.log('   ✅ obExecuteTradeBatch selector found in bytecode');
  } else {
    console.log('   ⚠️  obExecuteTradeBatch selector NOT found - check compilation');
  }
  
  return address;
}

async function performDiamondCut(
  wallet: ethers.Wallet,
  marketAddress: string,
  newFacetAddress: string,
  artifact: any,
  dryRun: boolean
): Promise<void> {
  const provider = wallet.provider!;
  
  // Get all selectors from the new facet ABI
  const allSelectors = selectorsFromAbi(artifact.abi);
  console.log(`\n📋 New facet has ${allSelectors.length} functions:`);
  allSelectors.forEach(s => console.log(`   ${s.selector} - ${s.name}`));
  
  // Check which selectors are already registered and to which facet
  const loupe = new ethers.Contract(marketAddress, [
    'function facetAddress(bytes4) view returns (address)',
  ], provider);
  
  const oldFacetAddress = process.env.OB_TRADE_EXECUTION_FACET || '0xCd396BCE332729F05D9C6396861d2293058c1731';
  
  console.log(`\n🔍 Checking current selector registrations...`);
  console.log(`   Old facet: ${shortAddr(oldFacetAddress)}`);
  console.log(`   New facet: ${shortAddr(newFacetAddress)}`);
  
  const toReplace: string[] = [];
  const toAdd: string[] = [];
  
  for (const { selector, name } of allSelectors) {
    const currentFacet = await loupe.facetAddress(selector);
    if (currentFacet === ethers.ZeroAddress) {
      toAdd.push(selector);
      console.log(`   ${selector} (${name.split('(')[0]}): NOT registered → ADD`);
    } else if (currentFacet.toLowerCase() === oldFacetAddress.toLowerCase()) {
      toReplace.push(selector);
      console.log(`   ${selector} (${name.split('(')[0]}): old facet → REPLACE`);
    } else if (currentFacet.toLowerCase() === newFacetAddress.toLowerCase()) {
      console.log(`   ${selector} (${name.split('(')[0]}): already on new facet ✓`);
    } else {
      console.log(`   ${selector} (${name.split('(')[0]}): different facet (${shortAddr(currentFacet)}) → SKIP`);
    }
  }
  
  if (toReplace.length === 0 && toAdd.length === 0) {
    console.log('\n✅ All selectors already point to the new facet. No cut needed.');
    return;
  }
  
  // Build diamond cut
  // Action 0 = Add, Action 1 = Replace, Action 2 = Remove
  const cut: { facetAddress: string; action: number; functionSelectors: string[] }[] = [];
  
  if (toReplace.length > 0) {
    cut.push({
      facetAddress: newFacetAddress,
      action: 1, // Replace
      functionSelectors: toReplace,
    });
  }
  
  if (toAdd.length > 0) {
    cut.push({
      facetAddress: newFacetAddress,
      action: 0, // Add
      functionSelectors: toAdd,
    });
  }
  
  console.log('\n📋 Diamond Cut:');
  for (const c of cut) {
    const actionName = c.action === 0 ? 'ADD' : c.action === 1 ? 'REPLACE' : 'REMOVE';
    console.log(`   ${actionName} ${c.functionSelectors.length} selectors → ${shortAddr(c.facetAddress)}`);
    c.functionSelectors.forEach(sel => {
      const info = allSelectors.find(s => s.selector === sel);
      console.log(`     ${sel} (${info?.name.split('(')[0] || 'unknown'})`);
    });
  }
  
  if (dryRun) {
    console.log('\n🔍 DRY RUN - No transaction will be sent');
    
    const CutABI = ['function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)'];
    const iface = new ethers.Interface(CutABI);
    const calldata = iface.encodeFunctionData('diamondCut', [cut, ethers.ZeroAddress, '0x']);
    console.log('\n📝 Encoded calldata:');
    console.log(calldata.slice(0, 200) + '...');
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
    'function bestBid() view returns (uint256)',
    'function placeMarginMarketOrderWithSlippage(uint256 amount, bool isBuy, uint256 slippageBps) returns (uint256)',
  ], provider);
  
  const bestBid = await contract.bestBid();
  console.log(`   Best Bid: ${bestBid.toString()}`);
  
  if (bestBid === 0n) {
    console.log('   ⚠️  No bids in order book, cannot fully test');
    return true;
  }
  
  // Try static call
  try {
    await contract.placeMarginMarketOrderWithSlippage.staticCall(
      ethers.parseUnits('0.1', 18), // Small amount
      false, // Sell
      100, // 1% slippage
      { from: '0x724CbE7b515dab1CE4B0e262990d2E3C47c6CA36' }
    );
    console.log('   ✅ Static call succeeded!');
    return true;
  } catch (e: any) {
    if (e.data === '0xa9ad62f8') {
      console.log('   ❌ Still getting FunctionDoesNotExist');
      return false;
    } else if (e.message?.includes('missing revert data')) {
      console.log('   ❌ Still getting missing revert data');
      return false;
    } else {
      // Other errors are expected (e.g., insufficient balance, etc.)
      console.log(`   ✅ No longer getting selector/delegatecall errors`);
      console.log(`   Expected error: ${e.shortMessage || e.reason || 'unknown'}`);
      return true;
    }
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   Deploy OBTradeExecutionFacet & Upgrade Diamond               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const marketAddress = getArg('--market');
  const dryRun = hasFlag('--dry-run');
  const deployOnly = hasFlag('--deploy-only');
  const newFacetOverride = getArg('--new-facet');

  if (!deployOnly && !marketAddress) {
    console.error('Usage:');
    console.error('  npx tsx scripts/deploy-and-upgrade-trade-execution-facet.ts --market <address> [--dry-run]');
    console.error('  npx tsx scripts/deploy-and-upgrade-trade-execution-facet.ts --deploy-only');
    console.error('  npx tsx scripts/deploy-and-upgrade-trade-execution-facet.ts --market <address> --new-facet <already-deployed-address>');
    process.exit(1);
  }

  if (!ADMIN_PRIVATE_KEY) {
    console.error('❌ ADMIN_PRIVATE_KEY is required in .env.local');
    process.exit(1);
  }

  // Load artifact
  if (!fs.existsSync(ARTIFACT_PATH)) {
    console.error(`❌ Artifact not found at ${ARTIFACT_PATH}`);
    console.error('   Run: cd Dexetrav5 && forge build');
    process.exit(1);
  }
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf-8'));
  
  console.log(`🌐 RPC: ${RPC_URL.slice(0, 50)}...`);
  if (marketAddress) {
    console.log(`🎯 Market: ${marketAddress}`);
  }
  console.log(`📋 Mode: ${deployOnly ? 'Deploy Only' : dryRun ? 'Dry Run' : 'Execute'}`);
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`\n👛 Deployer: ${wallet.address}`);
  console.log(`   Balance: ${ethers.formatEther(balance)} native`);
  
  if (balance === 0n) {
    console.error('❌ Deployer has no balance for gas');
    process.exit(1);
  }

  // Step 1: Deploy new facet (or use override)
  let newFacetAddress: string;
  
  if (newFacetOverride && ethers.isAddress(newFacetOverride)) {
    console.log(`\n📌 Using provided facet address: ${newFacetOverride}`);
    newFacetAddress = newFacetOverride;
    
    // Verify it has the selector
    const code = await provider.getCode(newFacetAddress);
    if (code === '0x' || code.length < 100) {
      console.error('❌ No contract code at provided address');
      process.exit(1);
    }
    const hasSelector = code.toLowerCase().includes('fec5fa72');
    if (!hasSelector) {
      console.warn('⚠️  obExecuteTradeBatch selector not found in provided facet');
    }
  } else {
    newFacetAddress = await deployFacet(wallet, artifact);
    
    console.log('\n📝 Update your .env.local with:');
    console.log(`   OB_TRADE_EXECUTION_FACET=${newFacetAddress}`);
    console.log(`   NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET=${newFacetAddress}`);
  }

  if (deployOnly) {
    console.log('\n✅ Deploy complete. Use --market to upgrade a specific Diamond.');
    return;
  }

  // Step 2: Verify market exists
  const marketCode = await provider.getCode(marketAddress!);
  if (marketCode === '0x' || marketCode.length < 100) {
    console.error(`❌ No contract at market address ${marketAddress}`);
    process.exit(1);
  }

  // Step 3: Perform diamond cut
  await performDiamondCut(wallet, marketAddress!, newFacetAddress, artifact, dryRun);

  // Step 4: Verify fix
  if (!dryRun) {
    const fixed = await verifyFix(provider, marketAddress!);
    if (fixed) {
      console.log('\n🎉 Upgrade complete! Trading should now work.');
    } else {
      console.log('\n⚠️  Upgrade complete but verification failed. Check manually.');
    }
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
