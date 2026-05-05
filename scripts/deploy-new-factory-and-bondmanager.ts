import "dotenv/config";
import { ethers, ContractFactory } from "ethers";
import * as fs from "fs";
import * as path from "path";

const HYPEREVM_RPC = process.env.RPC_URL || "https://rpc.hyperliquid.xyz/evm";

// New admin (NOT compromised)
const NEW_ADMIN_KEY = "0xf06bafeaca1dad441517cdf6373c86c6766401a6c278593b9e471f50538b99a4";
const NEW_ADMIN_ADDRESS = "0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599";

// Existing contracts we need to reference
const CORE_VAULT = process.env.CORE_VAULT_ADDRESS || "0x13C0EE284eF74E10A6442077718D57e2C50Ee88F";
const FACET_REGISTRY = "0x8B4188ba820F0cffE2ef77900F818DEFC8Ec743D";
const FEE_RECIPIENT = NEW_ADMIN_ADDRESS; // Fees go to new admin

// Bond configuration
const DEFAULT_BOND_AMOUNT = 100_000_000n; // 100 USDC (6 decimals)
const MIN_BOND_AMOUNT = 10_000_000n; // 10 USDC min
const MAX_BOND_AMOUNT = 1000_000_000n; // 1000 USDC max
const PENALTY_BPS = 500; // 5% penalty on early deactivation

// Paths to compiled artifacts
const ARTIFACTS_PATH = "/Users/gplay_sayid/Desktop/CODE/dexextra/Dexetrav5/artifacts/src";

interface DeployResult {
  bondManager: string;
  factory: string;
  txHashes: string[];
}

async function loadArtifact(contractName: string): Promise<{ abi: any[]; bytecode: string }> {
  const artifactPath = path.join(ARTIFACTS_PATH, `${contractName}.sol`, `${contractName}.json`);
  const content = fs.readFileSync(artifactPath, "utf8");
  const artifact = JSON.parse(content);
  return { abi: artifact.abi, bytecode: artifact.bytecode };
}

async function main(): Promise<DeployResult> {
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("        DEPLOY NEW FACTORY + BOND MANAGER");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  const provider = new ethers.JsonRpcProvider(HYPEREVM_RPC);
  const deployer = new ethers.Wallet(NEW_ADMIN_KEY, provider);

  console.log(`Deployer: ${deployer.address}`);
  const balance = await provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} HYPE\n`);

  if (balance < ethers.parseEther("0.01")) {
    throw new Error("Insufficient HYPE for deployment. Need at least 0.01 HYPE");
  }

  const txHashes: string[] = [];

  // ===== Step 1: Deploy MarketBondManagerV2 =====
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("[1/4] Deploying MarketBondManagerV2...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const bondManagerArtifact = await loadArtifact("MarketBondManagerV2");
  const BondManagerFactory = new ContractFactory(
    bondManagerArtifact.abi,
    bondManagerArtifact.bytecode,
    deployer
  );

  // Constructor: vault, factory (temp - will update), owner, defaultBond, minBond, maxBond
  // Use deployer as temporary factory - will update after factory is deployed
  const bondManagerDeploy = await BondManagerFactory.deploy(
    CORE_VAULT,
    deployer.address, // temporary factory - will update
    NEW_ADMIN_ADDRESS,
    DEFAULT_BOND_AMOUNT,
    MIN_BOND_AMOUNT,
    MAX_BOND_AMOUNT
  );

  console.log(`  TX: ${bondManagerDeploy.deploymentTransaction()?.hash}`);
  txHashes.push(bondManagerDeploy.deploymentTransaction()?.hash || "");
  
  await bondManagerDeploy.waitForDeployment();
  const bondManagerAddress = await bondManagerDeploy.getAddress();
  console.log(`  ✅ MarketBondManagerV2 deployed: ${bondManagerAddress}\n`);

  // ===== Step 2: Deploy FuturesMarketFactoryV2 =====
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("[2/4] Deploying FuturesMarketFactoryV2...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const factoryArtifact = await loadArtifact("FuturesMarketFactoryV2");
  const FactoryFactory = new ContractFactory(
    factoryArtifact.abi,
    factoryArtifact.bytecode,
    deployer
  );

  // Constructor: vault, admin, feeRecipient
  // Try with explicit high gas limit for big blocks
  const factoryDeploy = await FactoryFactory.deploy(
    CORE_VAULT,
    NEW_ADMIN_ADDRESS,
    FEE_RECIPIENT,
    { gasLimit: 20_000_000 } // 20M gas for big block deployment
  );

  console.log(`  TX: ${factoryDeploy.deploymentTransaction()?.hash}`);
  txHashes.push(factoryDeploy.deploymentTransaction()?.hash || "");

  await factoryDeploy.waitForDeployment();
  const factoryAddress = await factoryDeploy.getAddress();
  console.log(`  ✅ FuturesMarketFactoryV2 deployed: ${factoryAddress}\n`);

  // ===== Step 3: Configure Factory =====
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("[3/4] Configuring Factory...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const factoryContract = new ethers.Contract(factoryAddress, [
    "function setBondManager(address) external",
    "function setFacetRegistry(address) external",
    "function setInitFacet(address) external",
    "function bondManager() view returns (address)",
    "function facetRegistry() view returns (address)",
  ], deployer);

  // Set bond manager
  console.log("  Setting bondManager...");
  const tx1 = await factoryContract.setBondManager(bondManagerAddress);
  console.log(`    TX: ${tx1.hash}`);
  txHashes.push(tx1.hash);
  await tx1.wait();
  console.log("    ✅ Done");

  // Set facet registry
  console.log("  Setting facetRegistry...");
  const tx2 = await factoryContract.setFacetRegistry(FACET_REGISTRY);
  console.log(`    TX: ${tx2.hash}`);
  txHashes.push(tx2.hash);
  await tx2.wait();
  console.log("    ✅ Done");

  // Get init facet from env
  const initFacet = process.env.ORDER_BOOK_INIT_FACET || "0x6117F19a4e7Fe0a25D0697BC5a47c2FaDb028755";
  console.log("  Setting initFacet...");
  const tx3 = await factoryContract.setInitFacet(initFacet);
  console.log(`    TX: ${tx3.hash}`);
  txHashes.push(tx3.hash);
  await tx3.wait();
  console.log("    ✅ Done\n");

  // ===== Step 4: Configure BondManager =====
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("[4/4] Configuring BondManager...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const bondManagerContract = new ethers.Contract(bondManagerAddress, [
    "function setFactory(address) external",
    "function setPenaltyConfig(uint256 penaltyBps, address recipient) external",
    "function setBondExempt(address user, bool exempt) external",
    "function factory() view returns (address)",
    "function creationPenaltyBps() view returns (uint16)",
    "function penaltyRecipient() view returns (address)",
  ], deployer);

  // Update factory reference
  console.log("  Setting factory on BondManager...");
  const tx4 = await bondManagerContract.setFactory(factoryAddress);
  console.log(`    TX: ${tx4.hash}`);
  txHashes.push(tx4.hash);
  await tx4.wait();
  console.log("    ✅ Done");

  // Set 5% penalty
  console.log("  Setting 5% penalty on early deactivation...");
  const tx5 = await bondManagerContract.setPenaltyConfig(PENALTY_BPS, FEE_RECIPIENT);
  console.log(`    TX: ${tx5.hash}`);
  txHashes.push(tx5.hash);
  await tx5.wait();
  console.log("    ✅ Done");

  // Exempt the new admin from bonds (optional but useful for testing)
  console.log("  Setting new admin as bond exempt...");
  const tx6 = await bondManagerContract.setBondExempt(NEW_ADMIN_ADDRESS, true);
  console.log(`    TX: ${tx6.hash}`);
  txHashes.push(tx6.hash);
  await tx6.wait();
  console.log("    ✅ Done\n");

  // ===== Verify Configuration =====
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Verifying configuration...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const verifyBondManager = await factoryContract.bondManager();
  const verifyFacetRegistry = await factoryContract.facetRegistry();
  const verifyFactory = await bondManagerContract.factory();
  const verifyPenalty = await bondManagerContract.creationPenaltyBps();
  const verifyRecipient = await bondManagerContract.penaltyRecipient();

  console.log(`  Factory.bondManager: ${verifyBondManager}`);
  console.log(`  Factory.facetRegistry: ${verifyFacetRegistry}`);
  console.log(`  BondManager.factory: ${verifyFactory}`);
  console.log(`  BondManager.penaltyBps: ${verifyPenalty} (${Number(verifyPenalty) / 100}%)`);
  console.log(`  BondManager.penaltyRecipient: ${verifyRecipient}`);

  // ===== Summary =====
  console.log("\n═══════════════════════════════════════════════════════════════════════════════");
  console.log("        DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  console.log("New Contract Addresses:");
  console.log(`  MarketBondManagerV2: ${bondManagerAddress}`);
  console.log(`  FuturesMarketFactoryV2: ${factoryAddress}`);

  console.log("\n⚠️  UPDATE THESE ENVIRONMENT VARIABLES:");
  console.log(`  FUTURES_MARKET_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`  MARKET_BOND_MANAGER_ADDRESS=${bondManagerAddress}`);
  console.log(`  NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`  NEXT_PUBLIC_MARKET_BOND_MANAGER_ADDRESS=${bondManagerAddress}`);

  console.log("\n⚠️  IMPORTANT: Grant FACTORY_ROLE to BondManager on CoreVault:");
  console.log(`  CoreVault.grantRole(FACTORY_ROLE, ${bondManagerAddress})`);

  return { bondManager: bondManagerAddress, factory: factoryAddress, txHashes };
}

main()
  .then((result) => {
    console.log("\n✅ All done!");
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error("\n❌ Deployment failed:", e.message || e);
    process.exit(1);
  });
