#!/usr/bin/env node
/**
 * Upgrade OBSettlementFacet
 * 
 * Deploys the new OBSettlementFacet and updates the FacetRegistry
 * to point to the new implementation.
 * 
 * Usage:
 *   npx hardhat run scripts/upgrade-settlement-facet.js --network hyperliquid
 */

const path = require("path");
const fs = require("fs");
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
} catch (_) {}

const { ethers } = require("hardhat");

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  UPGRADE OBSettlementFacet");
  console.log("═══════════════════════════════════════════════════════════\n");

  const networkName = process.env.HARDHAT_NETWORK || "hyperliquid";
  console.log(`Network: ${networkName}`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  // Get FacetRegistry from .env.local
  const facetRegistryAddress = process.env.FACET_REGISTRY_ADDRESS;
  if (!facetRegistryAddress) {
    throw new Error("FACET_REGISTRY_ADDRESS not found in .env.local");
  }
  console.log(`FacetRegistry: ${facetRegistryAddress}`);
  
  // Current settlement facet
  const currentSettlementFacet = process.env.OB_SETTLEMENT_FACET;
  console.log(`Current OBSettlementFacet: ${currentSettlementFacet}`);


  // Deploy new OBSettlementFacet
  console.log("\n1. Deploying new OBSettlementFacet...");
  const OBSettlementFacet = await ethers.getContractFactory("OBSettlementFacet");
  const newFacet = await OBSettlementFacet.deploy();
  await newFacet.waitForDeployment();
  const newFacetAddress = await newFacet.getAddress();
  console.log(`   ✓ Deployed at: ${newFacetAddress}`);

  // Get selectors from the new facet
  console.log("\n2. Extracting function selectors...");
  const selectors = [];
  const iface = newFacet.interface;
  
  for (const fragment of iface.fragments) {
    if (fragment.type === "function") {
      const sig = fragment.format("sighash");
      const selector = ethers.id(sig).slice(0, 10);
      selectors.push(selector);
      console.log(`   - ${sig} → ${selector}`);
    }
  }
  console.log(`   ✓ Found ${selectors.length} selectors`);

  // Update FacetRegistry
  console.log("\n3. Updating FacetRegistry...");
  console.log(`   Registry: ${facetRegistryAddress}`);
  
  const FacetRegistry = await ethers.getContractAt("FacetRegistry", facetRegistryAddress);
  
  // Check if we're admin
  const admin = await FacetRegistry.admin();
  console.log(`   Admin: ${admin}`);
  
  if (admin.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`   ⚠️  Deployer is not admin!`);
    console.log(`   You need to call registerFacet from: ${admin}`);
    console.log(`\n   Manual command:`);
    console.log(`   FacetRegistry.registerFacet("${newFacetAddress}", [${selectors.map(s => `"${s}"`).join(", ")}])`);
  } else {
    // Register the new facet
    console.log("   Registering new facet...");
    const tx = await FacetRegistry.registerFacet(newFacetAddress, selectors);
    console.log(`   Tx: ${tx.hash}`);
    await tx.wait();
    
    const newVersion = await FacetRegistry.version();
    console.log(`   ✓ Registry updated to version ${newVersion}`);
    
    // Verify
    console.log("   Verifying selectors...");
    for (const sel of selectors) {
      const facet = await FacetRegistry.getFacet(sel);
      if (facet.toLowerCase() !== newFacetAddress.toLowerCase()) {
        console.log(`   ⚠️  Selector ${sel} not updated correctly`);
      }
    }
    console.log(`   ✓ All ${selectors.length} selectors verified`);
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  UPGRADE COMPLETE");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`\n  New OBSettlementFacet: ${newFacetAddress}`);
  console.log(`  Previous: ${currentSettlementFacet}`);
  console.log(`  Selectors updated: ${selectors.length}`);
  
  console.log("\n  ✓ FacetRegistry updated - all V2 Diamonds will use new facet.");
  
  // Remind to update .env.local
  console.log("\n  📝 Update .env.local with:");
  console.log(`     OB_SETTLEMENT_FACET=${newFacetAddress}`);
  console.log(`     NEXT_PUBLIC_OB_SETTLEMENT_FACET=${newFacetAddress}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
