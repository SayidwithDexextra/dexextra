#!/usr/bin/env node
/**
 * Deploy fix for position netting issue
 * 
 * The fix: PositionManager.executePositionNettingWithIndex now falls back
 * to O(N) search when index isn't set, finds existing positions, and sets
 * the index for future O(1) lookups.
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val.split("#")[0].split(" ")[0].trim();
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  Position Netting Fix Deployment");
  console.log("  (Fallback to O(N) when index not set)");
  console.log("═".repeat(70) + "\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`Network: ${networkName} (chainId ${chainId})`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  const vaultProxy = requireEnv("CORE_VAULT_ADDRESS");
  const collateralToken = requireEnv("MOCK_USDC_ADDRESS");
  const vaultAnalyticsAddr = requireEnv("VAULT_ANALYTICS_ADDRESS");

  console.log("Current addresses:");
  console.log(`  CoreVault proxy:  ${vaultProxy}`);
  console.log(`  Collateral token: ${collateralToken}`);

  // ══════════════════════════════════════════════════════════════════════
  // Step 1: Deploy new PositionManager library (with fallback fix)
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 1: Deploy new PositionManager library");
  console.log("─".repeat(70));

  const PositionManager = await ethers.getContractFactory("PositionManager");
  const positionManager = await PositionManager.deploy();
  await positionManager.waitForDeployment();
  const positionManagerAddr = await positionManager.getAddress();
  console.log(`✓ New PositionManager: ${positionManagerAddr}`);

  // ══════════════════════════════════════════════════════════════════════
  // Step 2: Deploy new CoreVault implementation
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 2: Deploy new CoreVault implementation");
  console.log("─".repeat(70));

  const CoreVaultImpl = await ethers.getContractFactory("CoreVault", {
    libraries: { PositionManager: positionManagerAddr },
  });
  const newImpl = await CoreVaultImpl.deploy(collateralToken);
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log(`✓ New CoreVault impl: ${newImplAddr}`);

  // ══════════════════════════════════════════════════════════════════════
  // Step 3: Upgrade CoreVault proxy (UUPS)
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 3: Upgrade CoreVault proxy");
  console.log("─".repeat(70));

  const vault = await ethers.getContractAt("CoreVault", vaultProxy);
  const tx = await vault.upgradeToAndCall(newImplAddr, "0x");
  const receipt = await tx.wait();
  console.log(`✓ Upgraded (tx: ${receipt.hash})`);

  // ══════════════════════════════════════════════════════════════════════
  // Step 4: Deploy new managers linked to new PositionManager
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 4: Deploy updated managers");
  console.log("─".repeat(70));

  // SettlementManager
  const SettlementManager = await ethers.getContractFactory("SettlementManager", {
    libraries: { PositionManager: positionManagerAddr },
  });
  const settlementManager = await SettlementManager.deploy();
  await settlementManager.waitForDeployment();
  const settlementManagerAddr = await settlementManager.getAddress();
  console.log(`✓ New SettlementManager: ${settlementManagerAddr}`);

  // LiquidationManager
  const LiquidationManager = await ethers.getContractFactory("LiquidationManager", {
    libraries: {
      VaultAnalytics: vaultAnalyticsAddr,
      PositionManager: positionManagerAddr,
    },
  });
  const liquidationManager = await LiquidationManager.deploy(collateralToken, deployer.address);
  await liquidationManager.waitForDeployment();
  const liquidationManagerAddr = await liquidationManager.getAddress();
  console.log(`✓ New LiquidationManager: ${liquidationManagerAddr}`);

  // ══════════════════════════════════════════════════════════════════════
  // Step 5: Wire new managers to vault
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 5: Wire managers to vault");
  console.log("─".repeat(70));

  let wireTx;
  wireTx = await vault.setSettlementManager(settlementManagerAddr);
  await wireTx.wait();
  console.log(`✓ setSettlementManager`);

  wireTx = await vault.setLiquidationManager(liquidationManagerAddr);
  await wireTx.wait();
  console.log(`✓ setLiquidationManager`);

  // ══════════════════════════════════════════════════════════════════════
  // Save deployment record
  // ══════════════════════════════════════════════════════════════════════
  const deploymentsDir = path.join(__dirname, "../deployments");
  const outFile = path.join(deploymentsDir, `position-netting-fix-${chainId}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: networkName,
    chainId,
    fix: "Fallback to O(N) search when position index not set",
    contracts: {
      PositionManager: positionManagerAddr,
      CoreVaultImpl: newImplAddr,
      SettlementManager: settlementManagerAddr,
      LiquidationManager: liquidationManagerAddr,
    },
    upgradeTx: receipt.hash
  }, null, 2));
  console.log(`\n✓ Saved: ${outFile}`);

  // ══════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(70));
  console.log("  Fix Deployed Successfully!");
  console.log("═".repeat(70));
  console.log(`  PositionManager:     ${positionManagerAddr}`);
  console.log(`  CoreVault Impl:      ${newImplAddr}`);
  console.log(`  SettlementManager:   ${settlementManagerAddr}`);
  console.log(`  LiquidationManager:  ${liquidationManagerAddr}`);
  console.log("");
  console.log("  Position netting will now work for existing users.");
  console.log("  The index will be set automatically on first trade.");
  console.log("═".repeat(70) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDeployment failed:", error);
    process.exit(1);
  });
