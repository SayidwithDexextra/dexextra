#!/usr/bin/env node
/**
 * Verify the gas optimization upgrade was successful
 */

const { ethers } = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  Gas Optimization Upgrade Verification");
  console.log("═".repeat(70) + "\n");

  const vaultProxy = process.env.CORE_VAULT_ADDRESS;
  console.log("CoreVault Proxy:", vaultProxy);

  const vault = await ethers.getContractAt("CoreVault", vaultProxy);

  // Check new storage slots exist (userTotalMarginReserved mapping)
  console.log("\n--- New O(1) Storage Slots ---");
  try {
    const testAddr = "0x0000000000000000000000000000000000000001";
    const reserved = await vault.userTotalMarginReserved(testAddr);
    console.log("userTotalMarginReserved exists: ✓ (returned:", reserved.toString(), ")");
  } catch (e) {
    console.log("userTotalMarginReserved exists: ✗ (error:", e.message, ")");
  }

  try {
    const testAddr = "0x0000000000000000000000000000000000000001";
    const locked = await vault.userTotalMarginLocked(testAddr);
    console.log("userTotalMarginLocked exists:   ✓ (returned:", locked.toString(), ")");
  } catch (e) {
    console.log("userTotalMarginLocked exists:   ✗ (error:", e.message, ")");
  }

  // Check basic vault functionality
  console.log("\n--- Basic Functionality Check ---");
  try {
    const admin = await vault.admin();
    console.log("Admin:", admin, "✓");
  } catch (e) {
    console.log("Admin check failed:", e.message);
  }

  try {
    const collateral = await vault.collateralToken();
    console.log("Collateral Token:", collateral, "✓");
  } catch (e) {
    console.log("Collateral token check failed:", e.message);
  }

  // Check FacetRegistry
  const registryAddr = process.env.FACET_REGISTRY_ADDRESS;
  if (registryAddr) {
    console.log("\n--- FacetRegistry Check ---");
    console.log("FacetRegistry:", registryAddr);
    
    const registry = await ethers.getContractAt(
      ["function getFacet(bytes4 selector) view returns (address)"],
      registryAddr
    );

    // Check placeMarginLimitOrder selector
    const selector = ethers.id("placeMarginLimitOrder(uint256,uint256,bool)").slice(0, 10);
    const facetAddr = await registry.getFacet(selector);
    console.log("placeMarginLimitOrder facet:", facetAddr);
    console.log("  Expected:                 ", "0xA9C656EB2F14D1782830159b54AaeC2cf105cbE6");
    console.log("  Match:", facetAddr.toLowerCase() === "0xA9C656EB2F14D1782830159b54AaeC2cf105cbE6".toLowerCase() ? "✓" : "✗");
  }

  console.log("\n" + "═".repeat(70));
  console.log("  Verification Complete");
  console.log("═".repeat(70) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
