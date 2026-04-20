#!/usr/bin/env node
/**
 * Wire the deployed managers to CoreVault
 */

const { ethers } = require("hardhat");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}

async function main() {
  console.log("\n=== Wire Managers to CoreVault ===\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const vaultProxy = process.env.CORE_VAULT_ADDRESS?.split("#")[0].trim();
  console.log("CoreVault proxy:", vaultProxy);

  const vault = await ethers.getContractAt("CoreVault", vaultProxy);

  // Wire SettlementManager (already deployed)
  const settlementManagerAddr = "0x1D934A9CC5d7e5b2Ee991593B6fbf5034a92cBDA";
  console.log("\nWiring SettlementManager:", settlementManagerAddr);
  const tx = await vault.setSettlementManager(settlementManagerAddr);
  await tx.wait();
  console.log("✓ setSettlementManager done");

  // Check current LiquidationManager
  // We'll keep the existing one for now since we couldn't deploy a new one
  
  console.log("\n=== Done ===");
  console.log("SettlementManager is now wired.");
  console.log("LiquidationManager: keeping existing (no funds to deploy new one)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed:", error);
    process.exit(1);
  });
