#!/usr/bin/env npx tsx
/**
 * Deploy Gas Fee System - Centralized via CoreVault
 * 
 * Architecture:
 *   - FeeRegistry stores gas fee config (hypeUsdcRate6, maxGasFee6)
 *   - CoreVault stores reference to FeeRegistry (one call enables all markets)
 *   - OBTradeExecutionFacet reads from CoreVault.feeRegistry() → FeeRegistry
 * 
 * Deployment Steps:
 *   1. Deploy FeeRegistry (if not already deployed with gas fee functions)
 *   2. Deploy updated facets (OBTradeExecutionFacet, OBViewFacet)
 *   3. Register facets in FacetRegistry
 *   4. Configure gas fees in FeeRegistry
 *   5. Set FeeRegistry in CoreVault (ONE call enables gas fees for ALL markets)
 * 
 * Usage:
 *   # Full deployment
 *   npx tsx scripts/deploy-gas-fee-facets.ts --deploy-fee-registry --configure-gas --link-corevault
 * 
 *   # Just deploy facets (if FeeRegistry already deployed)
 *   npx tsx scripts/deploy-gas-fee-facets.ts
 * 
 *   # Preview without transactions
 *   npx tsx scripts/deploy-gas-fee-facets.ts --dry-run
 * 
 *   # Configure gas fee rate ($25/HYPE, $1 max)
 *   npx tsx scripts/deploy-gas-fee-facets.ts --configure-gas --hype-rate 25000000 --max-fee 1000000
 * 
 *   # Link CoreVault to FeeRegistry (enables gas fees for ALL markets)
 *   npx tsx scripts/deploy-gas-fee-facets.ts --link-corevault
 * 
 * After deployment, update .env.local with the new addresses.
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
const PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY_DEPLOYER;
const FACET_REGISTRY_ADDRESS = process.env.FACET_REGISTRY_ADDRESS || '0xdcbbD419f642c9b0481384f46E52f660AE8acEc9';
const FEE_REGISTRY_ADDRESS = process.env.FEE_REGISTRY_ADDRESS || '0xC4c59c4f5892Bf88F0D3A0374562770d191F78bF';

// Current facet addresses (for reference)
const CURRENT_FACETS = {
  OB_ADMIN_FACET: process.env.OB_ADMIN_FACET || '0xE10d5EA09f6d9A3E222eD0290cED9Aa7Fa8f2217',
  OB_TRADE_EXECUTION_FACET: process.env.OB_TRADE_EXECUTION_FACET || '0xF6538aDFd32a37CA36EE9E464F554416150300e0',
  OB_VIEW_FACET: process.env.OB_VIEW_FACET || '0x6d4c893859084b84BAf4094A59470d0DF562B475',
};

// Artifact paths
const ARTIFACTS = {
  FeeRegistry: path.join(process.cwd(), 'Dexetrav5/artifacts/src/FeeRegistry.sol/FeeRegistry.json'),
  OBAdminFacet: path.join(process.cwd(), 'Dexetrav5/artifacts/src/diamond/facets/OBAdminFacet.sol/OBAdminFacet.json'),
  OBTradeExecutionFacet: path.join(process.cwd(), 'Dexetrav5/artifacts/src/diamond/facets/OBTradeExecutionFacet.sol/OBTradeExecutionFacet.json'),
  OBViewFacet: path.join(process.cwd(), 'Dexetrav5/artifacts/src/diamond/facets/OBViewFacet.sol/OBViewFacet.json'),
};

// FacetRegistry ABI
const FacetRegistryABI = [
  'function getFacet(bytes4 _selector) external view returns (address)',
  'function getAllSelectors() external view returns (bytes4[] memory)',
  'function selectorToFacet(bytes4) external view returns (address)',
  'function selectorCount() external view returns (uint256)',
  'function getSelectorsForFacet(address _facet) external view returns (bytes4[] memory)',
  'function admin() external view returns (address)',
  'function version() external view returns (uint256)',
  'function updateFacets(bytes4[] calldata _selectors, address[] calldata _facets) external',
  'function registerFacet(address _facet, bytes4[] calldata _selectors) external',
  'event FacetsUpdated(uint256 indexed version, uint256 selectorCount)',
];

// FeeRegistry ABI (for gas fee configuration)
const FeeRegistryABI = [
  'function admin() external view returns (address)',
  'function hypeUsdcRate6() external view returns (uint256)',
  'function maxGasFee6() external view returns (uint256)',
  'function getGasFeeConfig() external view returns (uint256, uint256)',
  'function updateGasFeeConfig(uint256 _hypeUsdcRate6, uint256 _maxGasFee6) external',
  'event GasFeeConfigUpdated(uint256 hypeUsdcRate6, uint256 maxGasFee6)',
];

// CoreVault ABI (for setting centralized FeeRegistry)
const CoreVaultABI = [
  'function setFeeRegistry(address _registry) external',
  'function feeRegistry() view returns (address)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
];

const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

// ============ Helpers ============

function shortAddr(a: string): string {
  return a.startsWith('0x') && a.length === 42 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
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

function loadArtifact(artifactPath: string): any {
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}\nRun: cd Dexetrav5 && forge build`);
  }
  return JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
}

// ============ Deploy Functions ============

async function deployFacet(
  wallet: ethers.Wallet,
  name: string,
  artifact: any
): Promise<{ address: string; selectors: { selector: string; name: string }[] }> {
  console.log(`\n  Deploying ${name}...`);
  
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTx = await factory.getDeployTransaction();
  const gasEstimate = await wallet.estimateGas(deployTx);
  console.log(`    Gas estimate: ${gasEstimate.toString()}`);
  
  const contract = await factory.deploy();
  console.log(`    TX: ${contract.deploymentTransaction()?.hash}`);
  
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`    Deployed: ${address}`);
  
  const selectors = selectorsFromAbi(artifact.abi);
  console.log(`    Functions: ${selectors.length}`);
  
  return { address, selectors };
}

// ============ Registry Functions ============

async function registerInFacetRegistry(
  wallet: ethers.Wallet,
  registryAddress: string,
  facets: { name: string; address: string; selectors: { selector: string; name: string }[] }[],
  dryRun: boolean
): Promise<void> {
  console.log('\n  Registering facets in FacetRegistry...');
  console.log(`    Registry: ${registryAddress}`);
  
  const registry = new ethers.Contract(registryAddress, FacetRegistryABI, wallet);
  
  // Check admin
  const admin = await registry.admin();
  const signerAddr = await wallet.getAddress();
  if (admin.toLowerCase() !== signerAddr.toLowerCase()) {
    console.error(`    ERROR: Signer ${shortAddr(signerAddr)} is not registry admin (${shortAddr(admin)})`);
    process.exit(1);
  }
  console.log(`    Admin verified: ${shortAddr(admin)}`);
  
  // Get current version
  const currentVersion = await registry.version();
  console.log(`    Current version: ${currentVersion}`);
  
  // Build selector -> facet mapping
  const allSelectors: string[] = [];
  const allFacets: string[] = [];
  
  for (const facet of facets) {
    console.log(`\n    ${facet.name} (${shortAddr(facet.address)}):`);
    for (const { selector, name } of facet.selectors) {
      const currentFacet = await registry.getFacet(selector);
      if (currentFacet === ethers.ZeroAddress) {
        console.log(`      ${selector} ${name.split('(')[0]} - NEW`);
      } else if (currentFacet.toLowerCase() === facet.address.toLowerCase()) {
        console.log(`      ${selector} ${name.split('(')[0]} - already set`);
        continue; // Skip if already pointing to new facet
      } else {
        console.log(`      ${selector} ${name.split('(')[0]} - UPDATE from ${shortAddr(currentFacet)}`);
      }
      allSelectors.push(selector);
      allFacets.push(facet.address);
    }
  }
  
  if (allSelectors.length === 0) {
    console.log('\n    All selectors already registered to correct facets. Nothing to do.');
    return;
  }
  
  console.log(`\n    Total selectors to update: ${allSelectors.length}`);
  
  if (dryRun) {
    console.log('\n    DRY RUN - No transaction sent');
    console.log('    Encoded calldata:');
    const iface = new ethers.Interface(FacetRegistryABI);
    const calldata = iface.encodeFunctionData('updateFacets', [allSelectors, allFacets]);
    console.log(`    ${calldata.slice(0, 200)}...`);
    return;
  }
  
  console.log('\n    Sending updateFacets transaction...');
  const tx = await registry.updateFacets(allSelectors, allFacets);
  console.log(`    TX: ${tx.hash}`);
  
  const receipt = await tx.wait();
  console.log(`    Confirmed in block ${receipt.blockNumber}`);
  console.log(`    Gas used: ${receipt.gasUsed}`);
  
  const newVersion = await registry.version();
  console.log(`    New version: ${newVersion}`);
}

// ============ Gas Fee Configuration (Global via FeeRegistry) ============

async function configureGasFee(
  wallet: ethers.Wallet,
  feeRegistryAddress: string,
  hypeUsdcRate6: bigint,
  maxGasFee6: bigint
): Promise<void> {
  console.log(`\n  Configuring gas fees in FeeRegistry ${shortAddr(feeRegistryAddress)}...`);
  
  const feeRegistry = new ethers.Contract(feeRegistryAddress, FeeRegistryABI, wallet);
  
  // Check admin
  const admin = await feeRegistry.admin();
  const signerAddr = await wallet.getAddress();
  if (admin.toLowerCase() !== signerAddr.toLowerCase()) {
    console.error(`    ERROR: Signer ${shortAddr(signerAddr)} is not FeeRegistry admin (${shortAddr(admin)})`);
    return;
  }
  
  // Get current config
  const [currentRate, currentMax] = await feeRegistry.getGasFeeConfig();
  console.log(`    Current config: rate=$${Number(currentRate) / 1e6}/HYPE, max=$${Number(currentMax) / 1e6}`);
  
  console.log(`    New HYPE/USDC rate: $${Number(hypeUsdcRate6) / 1e6}`);
  console.log(`    New max gas fee: $${Number(maxGasFee6) / 1e6}`);
  
  const tx = await feeRegistry.updateGasFeeConfig(hypeUsdcRate6, maxGasFee6);
  console.log(`    TX: ${tx.hash}`);
  
  const receipt = await tx.wait();
  console.log(`    Confirmed in block ${receipt.blockNumber}`);
  console.log(`    Gas fees are now active globally for all linked markets!`);
}

// ============ Link CoreVault to FeeRegistry (enables ALL markets) ============

async function linkCoreVaultToFeeRegistry(
  wallet: ethers.Wallet,
  coreVaultAddress: string,
  feeRegistryAddress: string
): Promise<void> {
  console.log(`\n  Linking CoreVault to FeeRegistry...`);
  console.log(`    CoreVault: ${coreVaultAddress}`);
  console.log(`    FeeRegistry: ${feeRegistryAddress}`);
  
  const coreVault = new ethers.Contract(coreVaultAddress, CoreVaultABI, wallet);
  
  // Check admin role
  const signerAddr = await wallet.getAddress();
  const hasAdmin = await coreVault.hasRole(DEFAULT_ADMIN_ROLE, signerAddr);
  if (!hasAdmin) {
    console.error(`    ERROR: Signer ${shortAddr(signerAddr)} is not CoreVault admin`);
    return;
  }
  
  // Check current setting
  const currentFeeReg = await coreVault.feeRegistry();
  if (currentFeeReg.toLowerCase() === feeRegistryAddress.toLowerCase()) {
    console.log(`    Already set! Skipping.`);
    return;
  }
  
  const tx = await coreVault.setFeeRegistry(feeRegistryAddress);
  console.log(`    TX: ${tx.hash}`);
  
  const receipt = await tx.wait();
  console.log(`    Confirmed in block ${receipt.blockNumber}`);
  console.log(`    ✓ Gas fees now enabled for ALL markets!`);
}

// ============ Deploy FeeRegistry ============

async function deployFeeRegistry(
  wallet: ethers.Wallet,
  protocolFeeRecipient: string
): Promise<string> {
  console.log('\n  Deploying FeeRegistry...');
  
  const artifact = loadArtifact(ARTIFACTS.FeeRegistry);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  
  // FeeRegistry constructor: (address _admin, address _protocolFeeRecipient)
  const adminAddr = await wallet.getAddress();
  const deployTx = await factory.getDeployTransaction(adminAddr, protocolFeeRecipient);
  const gasEstimate = await wallet.estimateGas(deployTx);
  console.log(`    Gas estimate: ${gasEstimate.toString()}`);
  
  const contract = await factory.deploy(adminAddr, protocolFeeRecipient);
  console.log(`    TX: ${contract.deploymentTransaction()?.hash}`);
  
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`    Deployed: ${address}`);
  
  return address;
}

// ============ Main ============

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║     Deploy Gas Fee Facets & Register in FacetRegistry            ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  const dryRun = hasFlag('--dry-run');
  const deployOnly = hasFlag('--deploy-only');
  const registerOnly = hasFlag('--register-only');
  const configureGas = hasFlag('--configure-gas');
  const linkCoreVault = hasFlag('--link-corevault');
  const deployFeeReg = hasFlag('--deploy-fee-registry');
  
  // Override addresses for --register-only mode
  const adminFacetOverride = getArg('--admin-facet');
  const tradeExecFacetOverride = getArg('--trade-exec-facet');
  const viewFacetOverride = getArg('--view-facet');
  
  // CoreVault address (for centralized FeeRegistry linking)
  const CORE_VAULT_ADDRESS = process.env.CORE_VAULT_ADDRESS || '0x8DF1752FbBC364fD4aF7cBA8a1F8B1B345F767f1';

  if (!PRIVATE_KEY) {
    console.error('\nERROR: ADMIN_PRIVATE_KEY or PRIVATE_KEY_DEPLOYER required in .env.local');
    process.exit(1);
  }

  console.log(`\n  RPC: ${RPC_URL.slice(0, 50)}...`);
  console.log(`  FacetRegistry: ${FACET_REGISTRY_ADDRESS}`);
  console.log(`  FeeRegistry: ${FEE_REGISTRY_ADDRESS}`);
  console.log(`  Mode: ${deployOnly ? 'Deploy Only' : registerOnly ? 'Register Only' : dryRun ? 'Dry Run' : 'Full Deploy + Register'}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`\n  Deployer: ${wallet.address}`);
  console.log(`  Balance: ${ethers.formatEther(balance)} HYPE`);
  
  if (balance === 0n) {
    console.error('\n  ERROR: Deployer has no balance for gas');
    process.exit(1);
  }

  // Track new FeeRegistry address if deployed
  let newFeeRegistryAddress: string | null = null;

  // ============ Step 0: Deploy FeeRegistry (if requested) ============
  
  if (deployFeeReg) {
    console.log('\n========== STEP 0: Deploy FeeRegistry ==========');
    const protocolFeeRecipient = process.env.PROTOCOL_FEE_RECIPIENT || wallet.address;
    console.log(`    Protocol fee recipient: ${protocolFeeRecipient}`);
    
    if (!dryRun) {
      newFeeRegistryAddress = await deployFeeRegistry(wallet, protocolFeeRecipient);
      console.log('\n  Update your .env.local with:');
      console.log('  ────────────────────────────────────────');
      console.log(`  FEE_REGISTRY_ADDRESS=${newFeeRegistryAddress}`);
      console.log(`  NEXT_PUBLIC_FEE_REGISTRY_ADDRESS=${newFeeRegistryAddress}`);
      console.log('  ────────────────────────────────────────');
    } else {
      console.log('    DRY RUN - Skipping FeeRegistry deployment');
    }
  }

  // ============ Step 1: Deploy Facets ============
  
  interface DeployedFacet {
    name: string;
    address: string;
    selectors: { selector: string; name: string }[];
  }
  
  const deployedFacets: DeployedFacet[] = [];
  
  if (!registerOnly) {
    console.log('\n========== STEP 1: Deploy Facets ==========');
    
    // Load artifacts
    const adminArtifact = loadArtifact(ARTIFACTS.OBAdminFacet);
    const tradeExecArtifact = loadArtifact(ARTIFACTS.OBTradeExecutionFacet);
    const viewArtifact = loadArtifact(ARTIFACTS.OBViewFacet);
    
    // Deploy each facet
    const adminResult = await deployFacet(wallet, 'OBAdminFacet', adminArtifact);
    deployedFacets.push({ name: 'OBAdminFacet', ...adminResult });
    
    const tradeExecResult = await deployFacet(wallet, 'OBTradeExecutionFacet', tradeExecArtifact);
    deployedFacets.push({ name: 'OBTradeExecutionFacet', ...tradeExecResult });
    
    const viewResult = await deployFacet(wallet, 'OBViewFacet', viewArtifact);
    deployedFacets.push({ name: 'OBViewFacet', ...viewResult });
    
    // Print env updates
    console.log('\n  Update your .env.local with:');
    console.log('  ────────────────────────────────────────');
    console.log(`  OB_ADMIN_FACET=${adminResult.address}`);
    console.log(`  NEXT_PUBLIC_OB_ADMIN_FACET=${adminResult.address}`);
    console.log(`  OB_TRADE_EXECUTION_FACET=${tradeExecResult.address}`);
    console.log(`  NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET=${tradeExecResult.address}`);
    console.log(`  OB_VIEW_FACET=${viewResult.address}`);
    console.log(`  NEXT_PUBLIC_OB_VIEW_FACET=${viewResult.address}`);
    console.log('  ────────────────────────────────────────');
  } else {
    // Use provided or current addresses
    console.log('\n========== STEP 1: Using Existing Facet Addresses ==========');
    
    const adminAddr = adminFacetOverride || CURRENT_FACETS.OB_ADMIN_FACET;
    const tradeExecAddr = tradeExecFacetOverride || CURRENT_FACETS.OB_TRADE_EXECUTION_FACET;
    const viewAddr = viewFacetOverride || CURRENT_FACETS.OB_VIEW_FACET;
    
    // Load ABIs to get selectors
    const adminArtifact = loadArtifact(ARTIFACTS.OBAdminFacet);
    const tradeExecArtifact = loadArtifact(ARTIFACTS.OBTradeExecutionFacet);
    const viewArtifact = loadArtifact(ARTIFACTS.OBViewFacet);
    
    deployedFacets.push({
      name: 'OBAdminFacet',
      address: adminAddr,
      selectors: selectorsFromAbi(adminArtifact.abi),
    });
    deployedFacets.push({
      name: 'OBTradeExecutionFacet',
      address: tradeExecAddr,
      selectors: selectorsFromAbi(tradeExecArtifact.abi),
    });
    deployedFacets.push({
      name: 'OBViewFacet',
      address: viewAddr,
      selectors: selectorsFromAbi(viewArtifact.abi),
    });
    
    console.log(`    OBAdminFacet: ${adminAddr}`);
    console.log(`    OBTradeExecutionFacet: ${tradeExecAddr}`);
    console.log(`    OBViewFacet: ${viewAddr}`);
  }

  // ============ Step 2: Register in FacetRegistry ============
  
  if (!deployOnly) {
    console.log('\n========== STEP 2: Register in FacetRegistry ==========');
    await registerInFacetRegistry(wallet, FACET_REGISTRY_ADDRESS, deployedFacets, dryRun);
  }

  // Use new FeeRegistry if deployed, otherwise use existing
  const activeFeeRegistry = newFeeRegistryAddress || FEE_REGISTRY_ADDRESS;

  // ============ Step 3: Configure Gas Fee in FeeRegistry (Optional) ============
  
  if (configureGas) {
    console.log('\n========== STEP 3: Configure Gas Fees in FeeRegistry ==========');
    console.log(`    FeeRegistry: ${activeFeeRegistry}`);
    // Default: $25/HYPE rate, $1 max fee
    const hypeUsdcRate6 = BigInt(getArg('--hype-rate') || '25000000'); // $25
    const maxGasFee6 = BigInt(getArg('--max-fee') || '1000000');      // $1
    
    if (!dryRun) {
      await configureGasFee(wallet, activeFeeRegistry, hypeUsdcRate6, maxGasFee6);
    } else {
      console.log('    DRY RUN - Skipping gas fee configuration');
    }
  }

  // ============ Step 4: Link CoreVault to FeeRegistry (Optional) ============
  
  if (linkCoreVault) {
    console.log('\n========== STEP 4: Link CoreVault to FeeRegistry ==========');
    console.log(`    CoreVault: ${CORE_VAULT_ADDRESS}`);
    console.log(`    FeeRegistry: ${activeFeeRegistry}`);
    
    if (!dryRun) {
      await linkCoreVaultToFeeRegistry(wallet, CORE_VAULT_ADDRESS, activeFeeRegistry);
    } else {
      console.log('    DRY RUN - Skipping CoreVault linking');
    }
  }

  // ============ Summary ============
  
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                          DEPLOYMENT COMPLETE                       ');
  console.log('═══════════════════════════════════════════════════════════════════');
  
  if (newFeeRegistryAddress) {
    console.log(`\n  New FeeRegistry: ${newFeeRegistryAddress}`);
  }
  
  if (!registerOnly && deployedFacets.length > 0) {
    console.log('\n  New facet addresses:');
    for (const f of deployedFacets) {
      console.log(`    ${f.name}: ${f.address}`);
    }
  }
  
  console.log('\n  Next steps:');
  if (newFeeRegistryAddress || deployedFacets.length > 0) {
    console.log('    1. Update .env.local with new addresses (see above)');
  }
  if (!configureGas) {
    console.log('    2. Configure gas fees:');
    console.log('       npx tsx scripts/deploy-gas-fee-facets.ts --configure-gas --hype-rate 25000000 --max-fee 1000000');
  }
  if (!linkCoreVault) {
    console.log('    3. Link CoreVault to FeeRegistry (enables ALL markets):');
    console.log('       npx tsx scripts/deploy-gas-fee-facets.ts --link-corevault');
  }
}

main().catch((e) => {
  console.error('\nFatal error:', e);
  process.exit(1);
});
