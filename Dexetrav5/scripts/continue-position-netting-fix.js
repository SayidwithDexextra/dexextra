#!/usr/bin/env node
/**
 * Continue position netting fix - deploy LiquidationManager and wire managers
 */

const { ethers } = require("hardhat");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}

const DEPLOYED = {
  PositionManager: "0xd16e71fB31e1ce5958139C9E295b6B5cf30673E8",
  SettlementManager: "0x1D934A9CC5d7e5b2Ee991593B6fbf5034a92cBDA",
};

async function main() {
  console.log("\n=== Continue Position Netting Fix ===\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH\n");

  const vaultProxy = process.env.CORE_VAULT_ADDRESS?.split("#")[0].trim();
  const collateralToken = process.env.MOCK_USDC_ADDRESS?.split("#")[0].trim();
  const vaultAnalyticsAddr = process.env.VAULT_ANALYTICS_ADDRESS?.split("#")[0].trim();

  console.log("Using already deployed:");
  console.log("  PositionManager:", DEPLOYED.PositionManager);
  console.log("  SettlementManager:", DEPLOYED.SettlementManager);

  // Deploy LiquidationManager
  console.log("\nDeploying LiquidationManager...");
  const LiquidationManager = await ethers.getContractFactory("LiquidationManager", {
    libraries: {
      VaultAnalytics: vaultAnalyticsAddr,
      PositionManager: DEPLOYED.PositionManager,
    },
  });
  const liquidationManager = await LiquidationManager.deploy(collateralToken, deployer.address);
  await liquidationManager.waitForDeployment();
  const liquidationManagerAddr = await liquidationManager.getAddress();
  console.log("✓ LiquidationManager:", liquidationManagerAddr);

  // Wire managers to vault
  console.log("\nWiring managers to vault...");
  const vault = await ethers.getContractAt("CoreVault", vaultProxy);

  let tx = await vault.setSettlementManager(DEPLOYED.SettlementManager);
  await tx.wait();
  console.log("✓ setSettlementManager");

  tx = await vault.setLiquidationManager(liquidationManagerAddr);
  await tx.wait();
  console.log("✓ setLiquidationManager");

  console.log("\n=== Done ===");
  console.log("LiquidationManager:", liquidationManagerAddr);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed:", error);
    process.exit(1);
  });
