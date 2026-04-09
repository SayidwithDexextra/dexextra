#!/usr/bin/env node
/**
 * deploy-optimized-facets.js
 *
 * Deploys the four optimized order book facets:
 * - OBOrderPlacementFacet (sorted linked lists, doubly-linked orders, batched matching)
 * - OBTradeExecutionFacet (batch execution support)
 * - OBLiquidationFacet (deferred liquidation checks)
 * - OBAdminViewFacet (admin functions and view helpers for migration)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-optimized-facets.js --network hyperliquid
 */
const { ethers } = require("hardhat");

async function deployFacet(name) {
  console.log(`\n📦 Deploying ${name}...`);
  const Factory = await ethers.getContractFactory(name);
  const facet = await Factory.deploy();
  await facet.waitForDeployment();
  const addr = await facet.getAddress();
  const tx = facet.deploymentTransaction();
  console.log(`   ✅ Address: ${addr}`);
  console.log(`   📝 TX: ${tx ? tx.hash : "unknown"}`);
  return addr;
}

async function main() {
  console.log("\n💎 Deploying Optimized Order Book Facets");
  console.log("═".repeat(60));

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${await deployer.getAddress()}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  const placementAddr = await deployFacet("OBOrderPlacementFacet");
  const executionAddr = await deployFacet("OBTradeExecutionFacet");
  const liquidationAddr = await deployFacet("OBLiquidationFacet");
  const adminViewAddr = await deployFacet("OBAdminViewFacet");

  console.log("\n" + "═".repeat(60));
  console.log("📋 DEPLOYED FACET ADDRESSES (add to .env):\n");
  console.log(`OB_ORDER_PLACEMENT_FACET=${placementAddr}`);
  console.log(`OB_TRADE_EXECUTION_FACET=${executionAddr}`);
  console.log(`OB_LIQUIDATION_FACET=${liquidationAddr}`);
  console.log(`OB_ADMIN_VIEW_FACET=${adminViewAddr}`);
  console.log("\n" + "═".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Deployment failed:", e?.message || String(e));
    process.exit(1);
  });
