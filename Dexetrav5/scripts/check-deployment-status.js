#!/usr/bin/env node
/**
 * Quick check of deployment status before upgrade
 */

const { ethers } = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });

async function main() {
  console.log("\n=== Pre-Upgrade Status Check ===\n");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "HYPE");

  // Check CoreVault proxy
  const vaultProxy = process.env.CORE_VAULT_ADDRESS;
  console.log("\nCoreVault Proxy:", vaultProxy);
  
  try {
    const vault = await ethers.getContractAt("CoreVault", vaultProxy);
    const admin = await vault.admin();
    const collateralToken = await vault.collateralToken();
    console.log("  Admin:", admin);
    console.log("  Deployer is admin:", admin.toLowerCase() === deployer.address.toLowerCase());
    console.log("  Collateral Token:", collateralToken);
    
    // Check managers
    try {
      const viewsManager = await vault.viewsManager();
      const settlementManager = await vault.settlementManager();
      const liquidationManager = await vault.liquidationManager();
      console.log("  ViewsManager:", viewsManager);
      console.log("  SettlementManager:", settlementManager);
      console.log("  LiquidationManager:", liquidationManager);
    } catch (e) {
      console.log("  Could not fetch managers:", e.message);
    }
  } catch (e) {
    console.log("  Error checking vault:", e.message);
  }

  // Check FacetRegistry
  const registryAddr = process.env.FACET_REGISTRY_ADDRESS;
  console.log("\nFacetRegistry:", registryAddr || "NOT SET");
  
  if (registryAddr) {
    try {
      const registry = await ethers.getContractAt(
        ["function owner() view returns (address)"],
        registryAddr
      );
      const owner = await registry.owner();
      console.log("  Owner:", owner);
      console.log("  Deployer is owner:", owner.toLowerCase() === deployer.address.toLowerCase());
    } catch (e) {
      console.log("  Could not check registry owner:", e.message);
    }
  }

  // Check VaultAnalytics
  console.log("\nVaultAnalytics:", process.env.VAULT_ANALYTICS_ADDRESS || "NOT SET");
  
  console.log("\n=== Environment Variables ===\n");
  console.log("CORE_VAULT_ADDRESS:", process.env.CORE_VAULT_ADDRESS);
  console.log("MOCK_USDC_ADDRESS:", process.env.MOCK_USDC_ADDRESS);
  console.log("VAULT_ANALYTICS_ADDRESS:", process.env.VAULT_ANALYTICS_ADDRESS);
  console.log("FACET_REGISTRY_ADDRESS:", process.env.FACET_REGISTRY_ADDRESS);
  
  console.log("\n=== Ready to Upgrade? ===\n");
  const ready = 
    balance > 0n &&
    process.env.CORE_VAULT_ADDRESS &&
    process.env.MOCK_USDC_ADDRESS &&
    process.env.VAULT_ANALYTICS_ADDRESS;
  
  if (ready) {
    console.log("✓ All checks passed. Ready to run upgrade-gas-optimization.js");
  } else {
    console.log("✗ Some checks failed. Please fix before upgrading.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
