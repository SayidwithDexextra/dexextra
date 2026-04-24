#!/usr/bin/env npx tsx
/**
 * Gas Estimate Update Deployment
 * 
 * This script deploys updated contracts with configurable gasEstimate:
 * 1. New FeeRegistry with gasEstimate field (default 2,000,000)
 * 2. New OBTradeExecutionFacet that reads gasEstimate from registry
 * 3. New OBViewFacet with updated getGasFeeConfig return type
 * 4. Updates CoreVault to point to new FeeRegistry
 * 
 * Usage:
 *   npx tsx scripts/deploy-gas-estimate-update.ts
 */

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Configuration
const RPC_URL = process.env.RPC_URL!;
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY!;
const CORE_VAULT_PROXY = process.env.CORE_VAULT_ADDRESS || '0x8DF1752FbBC364fD4aF7cBA8a1F8B1B345F767f1';
const FACET_REGISTRY_ADDRESS = process.env.FACET_REGISTRY_ADDRESS || '0xdcbbD419f642c9b0481384f46E52f660AE8acEc9';
const PROTOCOL_FEE_RECIPIENT = process.env.PROTOCOL_FEE_RECIPIENT || '0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306';

// Artifact paths
const ARTIFACTS_BASE = path.join(process.cwd(), 'Dexetrav5/artifacts/src');
const ARTIFACTS = {
  FeeRegistry: path.join(ARTIFACTS_BASE, 'FeeRegistry.sol/FeeRegistry.json'),
  OBTradeExecutionFacet: path.join(ARTIFACTS_BASE, 'diamond/facets/OBTradeExecutionFacet.sol/OBTradeExecutionFacet.json'),
  OBViewFacet: path.join(ARTIFACTS_BASE, 'diamond/facets/OBViewFacet.sol/OBViewFacet.json'),
};

// ABIs
const CoreVaultABI = [
  'function setFeeRegistry(address _registry) external',
  'function feeRegistry() view returns (address)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
];

const FacetRegistryABI = [
  'function registerFacet(address _facet, bytes4[] calldata _selectors) external',
  'function updateFacets(bytes4[] calldata _selectors, address[] calldata _facets) external',
  'function getFacet(bytes4 _selector) view returns (address)',
];

const FeeRegistryABI = [
  'function updateGasFeeConfig(uint256 _hypeUsdcRate6, uint256 _maxGasFee6, uint256 _gasEstimate) external',
  'function getGasFeeConfig() view returns (uint256, uint256, uint256)',
  'function gasEstimate() view returns (uint256)',
];

const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

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

async function fetchHypePrice(): Promise<number> {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=hyperliquid&vs_currencies=usd');
    const data = await response.json();
    return data.hyperliquid?.usd || 41;
  } catch {
    console.log('  Failed to fetch HYPE price, using $41 default');
    return 41;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║           Gas Estimate Update Deployment                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  
  if (!ADMIN_PRIVATE_KEY) {
    console.error('\nERROR: ADMIN_PRIVATE_KEY required');
    process.exit(1);
  }
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`\n  Deployer: ${wallet.address}`);
  console.log(`  Balance: ${ethers.formatEther(balance)} HYPE`);
  
  const deployed: Record<string, string> = {};
  
  // ============ STEP 1: Deploy New FeeRegistry ============
  
  console.log('\n========== STEP 1: Deploy New FeeRegistry ==========');
  
  const feeRegistryArtifact = loadArtifact(ARTIFACTS.FeeRegistry);
  const FeeRegistryFactory = new ethers.ContractFactory(
    feeRegistryArtifact.abi,
    feeRegistryArtifact.bytecode,
    wallet
  );
  
  // Constructor: admin, takerFeeBps, makerFeeBps, protocolFeeRecipient, protocolFeeShareBps
  console.log(`  Deploying FeeRegistry with gasEstimate = 2,000,000...`);
  const feeRegistry = await FeeRegistryFactory.deploy(
    wallet.address,      // admin
    7,                   // takerFeeBps (0.07%)
    3,                   // makerFeeBps (0.03%)
    PROTOCOL_FEE_RECIPIENT,
    8000                 // protocolFeeShareBps (80%)
  );
  console.log(`    TX: ${feeRegistry.deploymentTransaction()?.hash}`);
  await feeRegistry.waitForDeployment();
  const feeRegistryAddress = await feeRegistry.getAddress();
  console.log(`    ✓ FeeRegistry: ${feeRegistryAddress}`);
  deployed.FeeRegistry = feeRegistryAddress;
  
  // Configure gas fee
  console.log(`  Configuring gas fee...`);
  const hypePrice = await fetchHypePrice();
  const hypeUsdcRate6 = Math.round(hypePrice * 1_000_000);
  const maxGasFee6 = 1_000_000; // $1 cap
  const gasEstimate = 2_000_000; // ~2x actual gas for buffer
  
  const feeRegistryContract = new ethers.Contract(feeRegistryAddress, FeeRegistryABI, wallet);
  const configTx = await feeRegistryContract.updateGasFeeConfig(hypeUsdcRate6, maxGasFee6, gasEstimate);
  await configTx.wait();
  console.log(`    ✓ Gas fee config: rate=$${hypePrice}, max=$1, estimate=${gasEstimate.toLocaleString()} units`);
  
  // ============ STEP 2: Deploy New Facets ============
  
  console.log('\n========== STEP 2: Deploy New Facets ==========');
  
  // OBTradeExecutionFacet
  const tradeArtifact = loadArtifact(ARTIFACTS.OBTradeExecutionFacet);
  const TradeFacetFactory = new ethers.ContractFactory(
    tradeArtifact.abi,
    tradeArtifact.bytecode,
    wallet
  );
  console.log(`  Deploying OBTradeExecutionFacet...`);
  const tradeFacet = await TradeFacetFactory.deploy();
  await tradeFacet.waitForDeployment();
  const tradeFacetAddress = await tradeFacet.getAddress();
  console.log(`    ✓ OBTradeExecutionFacet: ${tradeFacetAddress}`);
  deployed.OBTradeExecutionFacet = tradeFacetAddress;
  
  // OBViewFacet
  const viewArtifact = loadArtifact(ARTIFACTS.OBViewFacet);
  const ViewFacetFactory = new ethers.ContractFactory(
    viewArtifact.abi,
    viewArtifact.bytecode,
    wallet
  );
  console.log(`  Deploying OBViewFacet...`);
  const viewFacet = await ViewFacetFactory.deploy();
  await viewFacet.waitForDeployment();
  const viewFacetAddress = await viewFacet.getAddress();
  console.log(`    ✓ OBViewFacet: ${viewFacetAddress}`);
  deployed.OBViewFacet = viewFacetAddress;
  
  // ============ STEP 3: Register Facets in FacetRegistry ============
  
  console.log('\n========== STEP 3: Register Facets in FacetRegistry ==========');
  
  const facetRegistry = new ethers.Contract(FACET_REGISTRY_ADDRESS, FacetRegistryABI, wallet);
  
  // Get selectors
  const tradeSelectors = getSelectors(tradeArtifact.abi);
  const viewSelectors = getSelectors(viewArtifact.abi);
  
  console.log(`  Updating OBTradeExecutionFacet (${tradeSelectors.length} selectors)...`);
  const tradeFacetAddresses = tradeSelectors.map(() => tradeFacetAddress);
  const tradeTx = await facetRegistry.updateFacets(tradeSelectors, tradeFacetAddresses);
  await tradeTx.wait();
  console.log(`    ✓ Trade facet registered`);
  
  console.log(`  Updating OBViewFacet (${viewSelectors.length} selectors)...`);
  const viewFacetAddresses = viewSelectors.map(() => viewFacetAddress);
  const viewTx = await facetRegistry.updateFacets(viewSelectors, viewFacetAddresses);
  await viewTx.wait();
  console.log(`    ✓ View facet registered`);
  
  // ============ STEP 4: Update CoreVault FeeRegistry Reference ============
  
  console.log('\n========== STEP 4: Update CoreVault FeeRegistry ==========');
  
  const coreVault = new ethers.Contract(CORE_VAULT_PROXY, CoreVaultABI, wallet);
  
  const currentFeeRegistry = await coreVault.feeRegistry();
  console.log(`  Current FeeRegistry: ${currentFeeRegistry}`);
  console.log(`  New FeeRegistry: ${feeRegistryAddress}`);
  
  const setTx = await coreVault.setFeeRegistry(feeRegistryAddress);
  console.log(`    TX: ${setTx.hash}`);
  await setTx.wait();
  console.log(`    ✓ CoreVault updated to use new FeeRegistry`);
  
  // Verify
  const verifyRegistry = await coreVault.feeRegistry();
  if (verifyRegistry.toLowerCase() === feeRegistryAddress.toLowerCase()) {
    console.log(`    ✓ Verified: CoreVault.feeRegistry() = ${verifyRegistry}`);
  }
  
  // ============ Summary ============
  
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                     DEPLOYMENT COMPLETE                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  
  console.log('\n  Deployed Contracts:');
  for (const [name, addr] of Object.entries(deployed)) {
    console.log(`    ${name}: ${addr}`);
  }
  
  console.log('\n  Gas Fee Configuration:');
  console.log(`    HYPE/USDC Rate: $${hypePrice}`);
  console.log(`    Max Gas Fee: $1.00`);
  console.log(`    Gas Estimate: ${gasEstimate.toLocaleString()} units (~2x actual)`);
  
  console.log('\n  Expected gas fee at 0.1 gwei:');
  const expectedFee = (gasEstimate * 0.1e9 * hypePrice) / 1e18;
  console.log(`    ~$${expectedFee.toFixed(4)} (${(expectedFee * 100).toFixed(2)} cents)`);
  
  console.log('\n  Update .env.local with:');
  console.log(`    FEE_REGISTRY_ADDRESS=${deployed.FeeRegistry}`);
  console.log(`    OB_TRADE_EXECUTION_FACET=${deployed.OBTradeExecutionFacet}`);
  console.log(`    OB_VIEW_FACET=${deployed.OBViewFacet}`);
}

main().catch((error) => {
  console.error('\n  DEPLOYMENT FAILED:', error);
  process.exit(1);
});
