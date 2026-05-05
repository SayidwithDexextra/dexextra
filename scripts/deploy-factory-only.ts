import "dotenv/config";
import { ethers, ContractFactory } from "ethers";
import * as fs from "fs";
import * as path from "path";

const HYPEREVM_RPC = process.env.RPC_URL || "https://rpc.hyperliquid.xyz/evm";

// New admin (NOT compromised)
const NEW_ADMIN_KEY = "0xf06bafeaca1dad441517cdf6373c86c6766401a6c278593b9e471f50538b99a4";
const NEW_ADMIN_ADDRESS = "0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599";

// Already deployed MarketBondManagerV2
const BOND_MANAGER_V2 = "0x8FDFAF6146318DD893E89E5ac2e3FD73554c02b6";

// Existing contracts we need to reference
const CORE_VAULT = process.env.CORE_VAULT_ADDRESS || "0x13C0EE284eF74E10A6442077718D57e2C50Ee88F";
const FACET_REGISTRY = "0x8B4188ba820F0cffE2ef77900F818DEFC8Ec743D";
const FEE_RECIPIENT = NEW_ADMIN_ADDRESS;

// Paths to compiled artifacts
const ARTIFACTS_PATH = "/Users/gplay_sayid/Desktop/CODE/dexextra/Dexetrav5/artifacts/src";

async function loadArtifact(contractName: string): Promise<{ abi: any[]; bytecode: string }> {
  const artifactPath = path.join(ARTIFACTS_PATH, `${contractName}.sol`, `${contractName}.json`);
  const content = fs.readFileSync(artifactPath, "utf8");
  const artifact = JSON.parse(content);
  return { abi: artifact.abi, bytecode: artifact.bytecode };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("        DEPLOY FUTURES MARKET FACTORY V2 ONLY");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  const provider = new ethers.JsonRpcProvider(HYPEREVM_RPC);
  const deployer = new ethers.Wallet(NEW_ADMIN_KEY, provider);

  console.log(`Deployer: ${deployer.address}`);
  const balance = await provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} HYPE`);
  console.log(`Using existing BondManagerV2: ${BOND_MANAGER_V2}\n`);

  if (balance < ethers.parseEther("0.01")) {
    throw new Error("Insufficient HYPE for deployment. Need at least 0.01 HYPE");
  }

  // ===== Deploy FuturesMarketFactoryV2 =====
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Deploying FuturesMarketFactoryV2...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const factoryArtifact = await loadArtifact("FuturesMarketFactoryV2");
  
  // Check bytecode size
  const bytecodeSize = (factoryArtifact.bytecode.length - 2) / 2; // Remove 0x, divide by 2 for bytes
  console.log(`  Bytecode size: ${bytecodeSize} bytes (limit: 24576 for standard EVM)`);

  const FactoryFactory = new ContractFactory(
    factoryArtifact.abi,
    factoryArtifact.bytecode,
    deployer
  );

  // Deploy with high gas limit for big blocks
  const factoryDeploy = await FactoryFactory.deploy(
    CORE_VAULT,
    NEW_ADMIN_ADDRESS,
    FEE_RECIPIENT,
    { gasLimit: 30_000_000 } // 30M gas for big block deployment
  );

  console.log(`  TX: ${factoryDeploy.deploymentTransaction()?.hash}`);
  await factoryDeploy.waitForDeployment();
  const factoryAddress = await factoryDeploy.getAddress();
  console.log(`  ✅ FuturesMarketFactoryV2 deployed: ${factoryAddress}\n`);

  // ===== Configure Factory =====
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Configuring Factory...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const factoryContract = new ethers.Contract(factoryAddress, [
    "function setBondManager(address) external",
    "function setFacetRegistry(address) external",
    "function setInitFacet(address) external",
    "function bondManager() view returns (address)",
    "function facetRegistry() view returns (address)",
  ], deployer);

  console.log("  Setting bondManager...");
  const tx1 = await factoryContract.setBondManager(BOND_MANAGER_V2);
  await tx1.wait();
  console.log("    ✅ Done");

  console.log("  Setting facetRegistry...");
  const tx2 = await factoryContract.setFacetRegistry(FACET_REGISTRY);
  await tx2.wait();
  console.log("    ✅ Done");

  const initFacet = process.env.ORDER_BOOK_INIT_FACET || "0x6117F19a4e7Fe0a25D0697BC5a47c2FaDb028755";
  console.log("  Setting initFacet...");
  const tx3 = await factoryContract.setInitFacet(initFacet);
  await tx3.wait();
  console.log("    ✅ Done\n");

  // ===== Update BondManager to point to new factory =====
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Updating BondManager to point to new factory...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const bondManagerContract = new ethers.Contract(BOND_MANAGER_V2, [
    "function setFactory(address) external",
    "function factory() view returns (address)",
  ], deployer);

  const tx4 = await bondManagerContract.setFactory(factoryAddress);
  await tx4.wait();
  console.log("  ✅ BondManager.factory updated\n");

  // ===== Summary =====
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("        DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  console.log(`MarketBondManagerV2: ${BOND_MANAGER_V2}`);
  console.log(`FuturesMarketFactoryV2: ${factoryAddress}`);

  console.log("\n⚠️  UPDATE ENVIRONMENT VARIABLES:");
  console.log(`  FUTURES_MARKET_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`  MARKET_BOND_MANAGER_ADDRESS=${BOND_MANAGER_V2}`);

  console.log("\n⚠️  GRANT FACTORY_ROLE to BondManager on CoreVault:");
  console.log(`  CoreVault.grantRole(FACTORY_ROLE, ${BOND_MANAGER_V2})`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Deployment failed:", e.message || e);
    process.exit(1);
  });
