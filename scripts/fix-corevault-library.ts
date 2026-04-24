#!/usr/bin/env npx tsx
/**
 * CoreVault Library Fix Deployment
 * 
 * This script fixes the CoreVault upgrade by:
 * 1. Deploying NEW PositionManager library (with WithIndex functions)
 * 2. Deploying NEW CoreVault implementation linked to NEW library
 * 3. Upgrading the CoreVault proxy to the new implementation
 * 
 * Root Cause: The previous upgrade linked CoreVault to the OLD PositionManager
 * library which doesn't have the WithIndex functions the new CoreVault calls.
 * 
 * Usage:
 *   npx tsx scripts/fix-corevault-library.ts
 *   npx tsx scripts/fix-corevault-library.ts --dry-run
 */

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// ============ Configuration ============

const RPC_URL = process.env.RPC_URL!;
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY!;

// Existing contract addresses
const CORE_VAULT_PROXY = process.env.CORE_VAULT_ADDRESS || '0x8DF1752FbBC364fD4aF7cBA8a1F8B1B345F767f1';
const USDC_ADDRESS = process.env.MOCK_USDC_ADDRESS || '0xec7dEb757C6F77e3F5a4E1906548131752B632b4';
const FEE_REGISTRY_ADDRESS = process.env.FEE_REGISTRY_ADDRESS || '0x1FAcd14eF67b0B20b92c3D9911CF0b3f9Ebcce97';

// Old implementation (for reference)
const OLD_CORE_VAULT_IMPL = '0x20CEaF26b1E7127D64387E2141F2e4C01d4CD804';
const BROKEN_CORE_VAULT_IMPL = '0xB9bAe44975dF6a6825bff3E7195D23a22Ad69f8F';
const OLD_POSITION_MANAGER_LIB = '0xaf3D6C0c7dd20d25Db71f1dD8a82EB7f7b604c72';

// Artifact paths
const ARTIFACTS_BASE = path.join(process.cwd(), 'Dexetrav5/artifacts/src');
const ARTIFACTS = {
  PositionManager: path.join(ARTIFACTS_BASE, 'PositionManager.sol/PositionManager.json'),
  CoreVault: path.join(ARTIFACTS_BASE, 'CoreVault.sol/CoreVault.json'),
};

// ABIs
const CoreVaultABI = [
  'function setFeeRegistry(address _registry) external',
  'function feeRegistry() view returns (address)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function upgradeToAndCall(address newImplementation, bytes memory data) external',
];

const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

// ============ Helpers ============

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/**
 * Link a library address into bytecode containing library placeholders.
 * Solidity library placeholders have format: __$<keccak256(libPath)[:34]>$__
 */
function linkLibrary(bytecode: string, libraryPath: string, libraryAddress: string): string {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(libraryPath)).slice(2, 36);
  const placeholder = `__$${hash}$__`;
  
  if (!ethers.isAddress(libraryAddress)) {
    throw new Error(`Invalid library address: ${libraryAddress}`);
  }
  
  const addressWithoutPrefix = libraryAddress.slice(2).toLowerCase();
  
  if (!bytecode.includes(placeholder)) {
    throw new Error(`Library placeholder ${placeholder} not found in bytecode for ${libraryPath}`);
  }
  
  const linked = bytecode.split(placeholder).join(addressWithoutPrefix);
  
  if (linked.includes('__$')) {
    console.warn('  Warning: Bytecode still contains unlinked library placeholders');
  }
  
  return linked;
}

function loadArtifact(artifactPath: string): { abi: any[]; bytecode: string } {
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}\nRun: cd Dexetrav5 && npx hardhat compile`);
  }
  return JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
}

// ============ Main ============

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║           CoreVault Library Fix Deployment                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  
  const dryRun = hasFlag('--dry-run');
  
  if (!ADMIN_PRIVATE_KEY) {
    console.error('\nERROR: ADMIN_PRIVATE_KEY required in .env.local');
    process.exit(1);
  }
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`\n  Deployer: ${wallet.address}`);
  console.log(`  Balance: ${ethers.formatEther(balance)} HYPE`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE DEPLOYMENT'}`);
  
  if (balance === 0n && !dryRun) {
    console.error('\n  ERROR: Deployer has no balance');
    process.exit(1);
  }
  
  console.log('\n========== DIAGNOSIS ==========');
  console.log(`  CoreVault Proxy: ${CORE_VAULT_PROXY}`);
  console.log(`  Broken Implementation: ${BROKEN_CORE_VAULT_IMPL}`);
  console.log(`  Old PositionManager (missing WithIndex): ${OLD_POSITION_MANAGER_LIB}`);
  console.log(`  Old Working Implementation: ${OLD_CORE_VAULT_IMPL}`);
  
  // Resume mode: PositionManager library already deployed
  const NEW_POSITION_MANAGER_LIB = '0x452e30A4f42cfDeAff9c57e4FF432B95D74bbd3a';
  
  const deployed: Record<string, string> = {
    PositionManager: NEW_POSITION_MANAGER_LIB,
  };
  
  // ============ STEP 1: Using Already Deployed PositionManager Library ============
  
  console.log('\n========== STEP 1: Using Already Deployed PositionManager Library ==========');
  console.log(`  ✓ NEW PositionManager library: ${NEW_POSITION_MANAGER_LIB}`);
  console.log(`  (Deployed in previous run)`);
  
  if (!dryRun) {
    // Verify new library is larger than old (has more functions)
    console.log(`  Verifying new library has additional functions...`);
    const newLibBytecode = await provider.getCode(NEW_POSITION_MANAGER_LIB);
    const oldLibBytecode = await provider.getCode(OLD_POSITION_MANAGER_LIB);
    
    if (newLibBytecode.length > oldLibBytecode.length) {
      console.log(`    ✓ NEW library (${newLibBytecode.length} chars) is larger than OLD (${oldLibBytecode.length} chars)`);
      const hasNewSelector1 = newLibBytecode.toLowerCase().includes('441d4889');
      const hasNewSelector2 = newLibBytecode.toLowerCase().includes('594a7c10');
      const hasNewSelector3 = newLibBytecode.toLowerCase().includes('01e62708');
      console.log(`    ✓ New selectors present: ${hasNewSelector1}, ${hasNewSelector2}, ${hasNewSelector3}`);
    } else {
      console.error(`    ERROR: New library is not larger than old - may be same code!`);
      process.exit(1);
    }
  }
  
  // ============ STEP 2: Deploy NEW CoreVault Implementation ============
  
  console.log('\n========== STEP 2: Deploy NEW CoreVault Implementation ==========');
  
  const coreVaultArtifact = loadArtifact(ARTIFACTS.CoreVault);
  console.log(`  Artifact loaded: ${ARTIFACTS.CoreVault}`);
  
  if (!dryRun) {
    // Link NEW PositionManager library to CoreVault bytecode
    console.log(`  Linking NEW PositionManager library to CoreVault bytecode...`);
    const linkedBytecode = linkLibrary(
      coreVaultArtifact.bytecode,
      'src/PositionManager.sol:PositionManager',
      deployed.PositionManager
    );
    console.log(`    ✓ Library linked`);
    
    // Deploy new implementation with linked bytecode
    console.log(`  Deploying new CoreVault implementation...`);
    const CoreVaultFactory = new ethers.ContractFactory(
      coreVaultArtifact.abi,
      linkedBytecode,
      wallet
    );
    
    const newImpl = await CoreVaultFactory.deploy(USDC_ADDRESS);
    console.log(`    TX: ${newImpl.deploymentTransaction()?.hash}`);
    await newImpl.waitForDeployment();
    const newImplAddress = await newImpl.getAddress();
    console.log(`    ✓ NEW CoreVault implementation: ${newImplAddress}`);
    deployed.CoreVaultImpl = newImplAddress;
    
    // Verify new implementation links to NEW library
    console.log(`  Verifying implementation links to NEW library...`);
    const implBytecode = await provider.getCode(newImplAddress);
    const linkedToNew = implBytecode.toLowerCase().includes(deployed.PositionManager.slice(2).toLowerCase());
    const linkedToOld = implBytecode.toLowerCase().includes(OLD_POSITION_MANAGER_LIB.slice(2).toLowerCase());
    
    if (linkedToNew && !linkedToOld) {
      console.log(`    ✓ Implementation correctly linked to NEW library`);
    } else {
      console.error(`    ERROR: Implementation linking issue!`);
      console.error(`      Contains NEW library address: ${linkedToNew}`);
      console.error(`      Contains OLD library address: ${linkedToOld}`);
      process.exit(1);
    }
  } else {
    console.log(`  [DRY RUN] Would deploy CoreVault implementation`);
    deployed.CoreVaultImpl = '0x_NEW_COREVAULT_IMPL_ADDRESS_';
  }
  
  // ============ STEP 3: Upgrade CoreVault Proxy ============
  
  console.log('\n========== STEP 3: Upgrade CoreVault Proxy ==========');
  
  if (!dryRun) {
    const coreVaultProxy = new ethers.Contract(CORE_VAULT_PROXY, CoreVaultABI, wallet);
    
    // Check admin role
    const hasAdmin = await coreVaultProxy.hasRole(DEFAULT_ADMIN_ROLE, wallet.address);
    if (!hasAdmin) {
      console.error(`    ERROR: Not CoreVault admin`);
      process.exit(1);
    }
    console.log(`  ✓ Wallet has admin role`);
    
    // Perform upgrade
    console.log(`  Upgrading proxy to new implementation...`);
    const upgradeTx = await coreVaultProxy.upgradeToAndCall(deployed.CoreVaultImpl, '0x');
    console.log(`    TX: ${upgradeTx.hash}`);
    await upgradeTx.wait();
    console.log(`    ✓ Proxy upgraded`);
    
    // Verify upgrade
    console.log(`  Verifying upgrade...`);
    const implSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
    const storedImpl = await provider.getStorage(CORE_VAULT_PROXY, implSlot);
    const actualImpl = '0x' + storedImpl.slice(26);
    
    if (actualImpl.toLowerCase() === deployed.CoreVaultImpl.toLowerCase()) {
      console.log(`    ✓ Implementation verified: ${actualImpl}`);
    } else {
      console.error(`    ERROR: Implementation mismatch!`);
      console.error(`      Expected: ${deployed.CoreVaultImpl}`);
      console.error(`      Actual: ${actualImpl}`);
      process.exit(1);
    }
  } else {
    console.log(`  [DRY RUN] Would upgrade proxy to new implementation`);
  }
  
  // ============ STEP 4: Re-link FeeRegistry (if needed) ============
  
  console.log('\n========== STEP 4: Verify FeeRegistry Link ==========');
  
  if (!dryRun) {
    const coreVaultProxy = new ethers.Contract(CORE_VAULT_PROXY, CoreVaultABI, wallet);
    const currentFeeRegistry = await coreVaultProxy.feeRegistry();
    
    if (currentFeeRegistry.toLowerCase() === FEE_REGISTRY_ADDRESS.toLowerCase()) {
      console.log(`  ✓ FeeRegistry already linked: ${currentFeeRegistry}`);
    } else if (currentFeeRegistry === ethers.ZeroAddress) {
      console.log(`  FeeRegistry not set, linking to ${FEE_REGISTRY_ADDRESS}...`);
      const setTx = await coreVaultProxy.setFeeRegistry(FEE_REGISTRY_ADDRESS);
      console.log(`    TX: ${setTx.hash}`);
      await setTx.wait();
      console.log(`    ✓ FeeRegistry linked`);
    } else {
      console.log(`  FeeRegistry set to different address: ${currentFeeRegistry}`);
      console.log(`  (Not changing - may be intentional)`);
    }
  } else {
    console.log(`  [DRY RUN] Would verify/set FeeRegistry link`);
  }
  
  // ============ Summary ============
  
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                     DEPLOYMENT COMPLETE                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  
  console.log('\n  Deployed Contracts:');
  for (const [name, addr] of Object.entries(deployed)) {
    console.log(`    ${name}: ${addr}`);
  }
  
  console.log('\n  Update deployed-contracts.json with:');
  console.log(`    "PositionManager": "${deployed.PositionManager}",`);
  console.log(`    "CoreVaultImpl": "${deployed.CoreVaultImpl}"`);
  
  console.log('\n  Trading should now work correctly!');
  console.log('  The new CoreVault is linked to a PositionManager library that has');
  console.log('  the WithIndex functions (executePositionNettingWithIndex, etc.)');
}

main().catch((error) => {
  console.error('\n  DEPLOYMENT FAILED:', error);
  process.exit(1);
});
