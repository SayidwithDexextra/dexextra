#!/usr/bin/env npx tsx
/**
 * Gas Fee System Upgrade Deployment
 * 
 * This script deploys all contracts affected by the gas fee upgrade:
 * 1. FeeRegistry - New deployment with gas fee functions
 * 2. CoreVault - UUPS upgrade (adds feeRegistry storage slot)
 * 3. OBTradeExecutionFacet - New deployment (reads gas fee from CoreVault)
 * 4. OBViewFacet - New deployment (reads gas fee from CoreVault)
 * 5. Register facets in FacetRegistry
 * 6. Configure gas fees
 * 7. Link CoreVault to FeeRegistry
 * 
 * Usage:
 *   npx tsx scripts/deploy-gas-fee-upgrade.ts
 *   npx tsx scripts/deploy-gas-fee-upgrade.ts --dry-run
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
const CORE_VAULT_ADDRESS = process.env.CORE_VAULT_ADDRESS || '0x8DF1752FbBC364fD4aF7cBA8a1F8B1B345F767f1';
const FACET_REGISTRY_ADDRESS = process.env.FACET_REGISTRY_ADDRESS || '0xdcbbD419f642c9b0481384f46E52f660AE8acEc9';
const USDC_ADDRESS = process.env.MOCK_USDC_ADDRESS || '0xec7dEb757C6F77e3F5a4E1906548131752B632b4';
const PROTOCOL_FEE_RECIPIENT = process.env.PROTOCOL_FEE_RECIPIENT || '0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306';
const POSITION_MANAGER_LIB = '0xaf3D6C0c7dd20d25Db71f1dD8a82EB7f7b604c72'; // Already deployed

// Artifact paths
const ARTIFACTS_BASE = path.join(process.cwd(), 'Dexetrav5/artifacts/src');
const ARTIFACTS = {
  FeeRegistry: path.join(ARTIFACTS_BASE, 'FeeRegistry.sol/FeeRegistry.json'),
  CoreVault: path.join(ARTIFACTS_BASE, 'CoreVault.sol/CoreVault.json'),
  OBTradeExecutionFacet: path.join(ARTIFACTS_BASE, 'diamond/facets/OBTradeExecutionFacet.sol/OBTradeExecutionFacet.json'),
  OBViewFacet: path.join(ARTIFACTS_BASE, 'diamond/facets/OBViewFacet.sol/OBViewFacet.json'),
};

// ABIs
const CoreVaultABI = [
  'function setFeeRegistry(address _registry) external',
  'function feeRegistry() view returns (address)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function upgradeToAndCall(address newImplementation, bytes memory data) external',
];

const FacetRegistryABI = [
  'function admin() view returns (address)',
  'function registerFacet(address _facet, bytes4[] calldata _selectors) external',
  'function updateFacets(bytes4[] calldata _selectors, address[] calldata _facets) external',
  'function getFacet(bytes4 _selector) view returns (address)',
  'function selectorCount() view returns (uint256)',
];

const FeeRegistryABI = [
  'function admin() view returns (address)',
  'function updateGasFeeConfig(uint256 _hypeUsdcRate6, uint256 _maxGasFee6) external',
  'function getGasFeeConfig() view returns (uint256, uint256)',
  'function takerFeeBps() view returns (uint256)',
  'function makerFeeBps() view returns (uint256)',
  'function protocolFeeRecipient() view returns (address)',
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
  // Compute the placeholder hash for the library path
  const hash = ethers.keccak256(ethers.toUtf8Bytes(libraryPath)).slice(2, 36);
  const placeholder = `__$${hash}$__`;
  
  // Validate library address
  if (!ethers.isAddress(libraryAddress)) {
    throw new Error(`Invalid library address: ${libraryAddress}`);
  }
  
  // Remove 0x prefix and lowercase for replacement
  const addressWithoutPrefix = libraryAddress.slice(2).toLowerCase();
  
  // Check if placeholder exists in bytecode
  if (!bytecode.includes(placeholder)) {
    throw new Error(`Library placeholder ${placeholder} not found in bytecode for ${libraryPath}`);
  }
  
  // Replace all occurrences of the placeholder with the actual address
  const linked = bytecode.split(placeholder).join(addressWithoutPrefix);
  
  // Verify no placeholders remain
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

function getSelectors(abi: any[]): string[] {
  const iface = new ethers.Interface(abi);
  return iface.fragments
    .filter((f): f is ethers.FunctionFragment => f.type === 'function')
    .map((f) => ethers.id(f.format('sighash')).slice(0, 10));
}

// ============ Main ============

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║           Gas Fee System Upgrade Deployment                      ║');
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
  
  // ============ RESUME MODE: Using already deployed contracts ============
  // Previous run (Steps 1-4) completed successfully
  
  const deployed: Record<string, string> = {
    FeeRegistry: '0x1FAcd14eF67b0B20b92c3D9911CF0b3f9Ebcce97',
    OBTradeExecutionFacet: '0x3B13eb9dFfc30f030b1bbdE5F569194E05fE60E6',
    OBViewFacet: '0x87D24c24A9e74a7FEb57307D48111BB5E0dD00F4',
  };
  
  console.log('\n========== STEPS 1-4: Using Already Deployed Contracts ==========');
  console.log(`  FeeRegistry: ${deployed.FeeRegistry}`);
  console.log(`  OBTradeExecutionFacet: ${deployed.OBTradeExecutionFacet}`);
  console.log(`  OBViewFacet: ${deployed.OBViewFacet}`);
  console.log(`  (Facets already registered in FacetRegistry)`);
  console.log(`  ✓ Skipping Steps 1-4 (already completed)`)
  
  // ============ STEP 5: Upgrade CoreVault ============
  
  console.log('\n========== STEP 5: Upgrade CoreVault Implementation ==========');
  console.log(`  Using existing PositionManager library: ${POSITION_MANAGER_LIB}`);
  console.log(`  CoreVault Proxy: ${CORE_VAULT_ADDRESS}`);
  
  const coreVaultArtifact = loadArtifact(ARTIFACTS.CoreVault);
  
  if (!dryRun) {
    // Link PositionManager library to CoreVault bytecode
    console.log(`  Linking PositionManager library to CoreVault bytecode...`);
    const linkedBytecode = linkLibrary(
      coreVaultArtifact.bytecode,
      'src/PositionManager.sol:PositionManager',
      POSITION_MANAGER_LIB
    );
    console.log(`    ✓ Library linked`);
    
    // Deploy new implementation with linked bytecode
    console.log(`  Deploying new CoreVault implementation...`);
    const CoreVaultFactory = new ethers.ContractFactory(
      coreVaultArtifact.abi,
      linkedBytecode,
      wallet
    );
    
    // Constructor takes collateral token
    const newImpl = await CoreVaultFactory.deploy(USDC_ADDRESS);
    console.log(`    TX: ${newImpl.deploymentTransaction()?.hash}`);
    await newImpl.waitForDeployment();
    const newImplAddress = await newImpl.getAddress();
    console.log(`    ✓ New implementation: ${newImplAddress}`);
    deployed.CoreVaultImpl = newImplAddress;
    
    // Upgrade proxy
    console.log(`  Upgrading proxy to new implementation...`);
    const coreVaultProxy = new ethers.Contract(CORE_VAULT_ADDRESS, CoreVaultABI, wallet);
    
    // Check admin role
    const hasAdmin = await coreVaultProxy.hasRole(DEFAULT_ADMIN_ROLE, wallet.address);
    if (!hasAdmin) {
      console.error(`    ERROR: Not CoreVault admin`);
      process.exit(1);
    }
    
    const upgradeTx = await coreVaultProxy.upgradeToAndCall(newImplAddress, '0x');
    console.log(`    TX: ${upgradeTx.hash}`);
    await upgradeTx.wait();
    console.log(`    ✓ Upgraded`);
  } else {
    console.log('  DRY RUN - Skipping CoreVault upgrade');
    deployed.CoreVaultImpl = '0x_NEW_COREVAULT_IMPL';
  }
  
  // ============ STEP 6: Configure Gas Fees ============
  
  console.log('\n========== STEP 6: Configure Gas Fees in FeeRegistry ==========');
  
  // Current HYPE price: ~$41 (fetched from CoinGecko)
  const hypeUsdcRate6 = 41_000000n; // $41
  const maxGasFee6 = 1_000000n;     // $1
  
  console.log(`  HYPE/USDC Rate: $${Number(hypeUsdcRate6) / 1_000_000}`);
  console.log(`  Max Gas Fee: $${Number(maxGasFee6) / 1_000_000}`);
  
  if (!dryRun) {
    const feeRegistry = new ethers.Contract(deployed.FeeRegistry, FeeRegistryABI, wallet);
    
    console.log(`  Setting gas fee config...`);
    const tx = await feeRegistry.updateGasFeeConfig(hypeUsdcRate6, maxGasFee6);
    console.log(`    TX: ${tx.hash}`);
    await tx.wait();
    console.log(`    ✓ Gas fees configured`);
  } else {
    console.log('  DRY RUN - Skipping gas fee configuration');
  }
  
  // ============ STEP 7: Link CoreVault to FeeRegistry ============
  
  console.log('\n========== STEP 7: Link CoreVault to FeeRegistry ==========');
  console.log(`  CoreVault: ${CORE_VAULT_ADDRESS}`);
  console.log(`  FeeRegistry: ${deployed.FeeRegistry}`);
  
  if (!dryRun) {
    const coreVault = new ethers.Contract(CORE_VAULT_ADDRESS, CoreVaultABI, wallet);
    
    console.log(`  Setting feeRegistry on CoreVault...`);
    const tx = await coreVault.setFeeRegistry(deployed.FeeRegistry);
    console.log(`    TX: ${tx.hash}`);
    await tx.wait();
    console.log(`    ✓ CoreVault linked to FeeRegistry`);
    console.log(`    ✓ Gas fees now enabled for ALL markets!`);
  } else {
    console.log('  DRY RUN - Skipping CoreVault linking');
  }
  
  // ============ Summary ============
  
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                      DEPLOYMENT COMPLETE                           ');
  console.log('═══════════════════════════════════════════════════════════════════');
  
  console.log('\n  Deployed addresses:');
  for (const [name, addr] of Object.entries(deployed)) {
    console.log(`    ${name}: ${addr}`);
  }
  
  console.log('\n  Update .env.local with:');
  console.log('  ────────────────────────────────────────');
  console.log(`  FEE_REGISTRY_ADDRESS=${deployed.FeeRegistry}`);
  console.log(`  NEXT_PUBLIC_FEE_REGISTRY_ADDRESS=${deployed.FeeRegistry}`);
  console.log(`  OB_TRADE_EXECUTION_FACET=${deployed.OBTradeExecutionFacet}`);
  console.log(`  NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET=${deployed.OBTradeExecutionFacet}`);
  console.log(`  OB_VIEW_FACET=${deployed.OBViewFacet}`);
  console.log(`  NEXT_PUBLIC_OB_VIEW_FACET=${deployed.OBViewFacet}`);
  console.log('  ────────────────────────────────────────');
  
  console.log('\n  Verification commands:');
  console.log(`    # Check FeeRegistry gas config:`);
  console.log(`    cast call ${deployed.FeeRegistry} "getGasFeeConfig()" --rpc-url $RPC_URL`);
  console.log(`    # Check CoreVault.feeRegistry:`);
  console.log(`    cast call ${CORE_VAULT_ADDRESS} "feeRegistry()" --rpc-url $RPC_URL`);
}

main().catch((e) => {
  console.error('\nFatal error:', e);
  process.exit(1);
});
