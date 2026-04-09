#!/usr/bin/env node
/**
 * deploy-remaining-facets.js
 *
 * Deploys remaining facets that weren't deployed due to insufficient funds:
 * - OBLiquidationFacet (deferred liquidation checks)
 * - OBAdminViewFacet (admin functions and view helpers for migration)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-remaining-facets.js --network hyperliquid
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
  console.log("\n💎 Deploying Remaining Order Book Facets");
  console.log("═".repeat(60));

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${await deployer.getAddress()}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  const liquidationAddr = await deployFacet("OBLiquidationFacet");
  const adminViewAddr = await deployFacet("OBAdminViewFacet");

  console.log("\n" + "═".repeat(60));
  console.log("📋 NEWLY DEPLOYED FACET ADDRESSES:\n");
  console.log(`OB_LIQUIDATION_FACET=${liquidationAddr}`);
  console.log(`OB_ADMIN_VIEW_FACET=${adminViewAddr}`);
  
  console.log("\n📋 ALL FACET ADDRESSES (previously deployed + new):\n");
  console.log(`OB_ORDER_PLACEMENT_FACET=0xcfB3641163D585D07F06962797b5447843C58Ca9`);
  console.log(`OB_TRADE_EXECUTION_FACET=0x290f70DA54f8E465Fc59df589A5507C716491241`);
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
