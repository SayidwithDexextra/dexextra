#!/usr/bin/env node
/**
 * upgrade-view-facets.js
 * 
 * Deploys updated OBViewFacet and OBPricingFacet, then registers them in the FacetRegistry.
 * This upgrades ALL V2 markets in one transaction per facet.
 * 
 * Fixes the issue where getActiveOrdersCount() and getOrderBookDepthFromPointers()
 * were starting from bestBid/bestAsk instead of buyPriceHead/sellPriceHead.
 * 
 * Usage:
 *   npx hardhat run scripts/upgrade-view-facets.js --network hyperliquid
 */
const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}

function renderType(t) {
  const type = t.type || "";
  const arraySuffixMatch = type.match(/(\[.*\])$/);
  const arraySuffix = arraySuffixMatch ? arraySuffixMatch[1] : "";
  const base = type.replace(/(\[.*\])$/, "");
  if (base === "tuple") {
    const comps = (t.components || []).map(renderType).join(",");
    return `(${comps})${arraySuffix}`;
  }
  return `${base}${arraySuffix}`;
}

async function selectorsFromArtifact(contractName) {
  const artifact = await artifacts.readArtifact(contractName);
  const fns = (artifact.abi || []).filter((e) => e && e.type === "function");
  return fns.map((f) => {
    const inputsSig = (f.inputs || []).map(renderType).join(",");
    const sig = `${f.name}(${inputsSig})`;
    return ethers.id(sig).slice(0, 10);
  });
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  View Facet Upgrade (OBViewFacet + OBPricingFacet)");
  console.log("  Fix: Use buyPriceHead/sellPriceHead instead of bestBid/bestAsk");
  console.log("═".repeat(70) + "\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`Network: chainId ${chainId}`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} HYPE\n`);

  // Get FacetRegistry from a known V2 market (DiamondRegistry)
  // or from env if provided
  const deploymentPath = path.join(__dirname, `../deployments/hyperliquid-deployment.json`);
  let facetRegistryAddr = process.env.FACET_REGISTRY_ADDRESS;
  
  if (!facetRegistryAddr) {
    // Query any V2 market for its FacetRegistry
    const knownV2Market = process.env.ORDER_BOOK_ADDRESS || "0xade7a2029881a22479a188Ba24F38686454aA069";
    console.log(`Reading FacetRegistry from V2 market: ${knownV2Market}`);
    try {
      const market = await ethers.getContractAt(
        ["function facetRegistry() view returns (address)"],
        knownV2Market
      );
      facetRegistryAddr = await market.facetRegistry();
      console.log(`  FacetRegistry: ${facetRegistryAddr}`);
    } catch (e) {
      console.log(`  Could not read from market: ${e.message}`);
    }
  }
  
  if (!facetRegistryAddr) {
    throw new Error("Could not find FacetRegistry address. Set FACET_REGISTRY_ADDRESS or ORDER_BOOK_ADDRESS in env.");
  }

  const upgradeLog = {
    timestamp: new Date().toISOString(),
    reason: "Fix order book view functions - use linked list heads",
    deployer: deployer.address,
    chainId,
    contracts: {},
    changes: [],
  };

  // ══════════════════════════════════════════════════════════════════════
  // Step 1: Deploy new OBViewFacet
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 1: Deploy new OBViewFacet");
  console.log("─".repeat(70));
  console.log("(getActiveOrdersCount now uses buyPriceHead/sellPriceHead)");

  const OBViewFacet = await ethers.getContractFactory("OBViewFacet");
  const viewFacet = await OBViewFacet.deploy();
  await viewFacet.waitForDeployment();
  const newViewFacetAddr = await viewFacet.getAddress();
  console.log(`✓ New OBViewFacet deployed: ${newViewFacetAddr}`);
  upgradeLog.contracts.OBViewFacet = newViewFacetAddr;
  upgradeLog.changes.push("Deployed new OBViewFacet (linked list fix)");

  // ══════════════════════════════════════════════════════════════════════
  // Step 2: Deploy new OBPricingFacet
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 2: Deploy new OBPricingFacet");
  console.log("─".repeat(70));
  console.log("(getOrderBookDepthFromPointers now uses buyPriceHead/sellPriceHead)");

  const OBPricingFacet = await ethers.getContractFactory("OBPricingFacet");
  const pricingFacet = await OBPricingFacet.deploy();
  await pricingFacet.waitForDeployment();
  const newPricingFacetAddr = await pricingFacet.getAddress();
  console.log(`✓ New OBPricingFacet deployed: ${newPricingFacetAddr}`);
  upgradeLog.contracts.OBPricingFacet = newPricingFacetAddr;
  upgradeLog.changes.push("Deployed new OBPricingFacet (linked list fix)");

  // ══════════════════════════════════════════════════════════════════════
  // Step 3: Update FacetRegistry for OBViewFacet
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 3: Update FacetRegistry for OBViewFacet");
  console.log("─".repeat(70));
  console.log("(Single transaction upgrades ALL V2 markets!)");

  const viewSelectors = await selectorsFromArtifact("OBViewFacet");
  console.log(`  ${viewSelectors.length} selectors to update`);

  const registry = await ethers.getContractAt(
    ["function updateFacets(bytes4[] calldata _selectors, address[] calldata _facets) external"],
    facetRegistryAddr
  );

  const viewFacets = viewSelectors.map(() => newViewFacetAddr);
  const tx1 = await registry.updateFacets(viewSelectors, viewFacets);
  const receipt1 = await tx1.wait();
  console.log(`✓ FacetRegistry updated for OBViewFacet (tx: ${receipt1.hash})`);
  upgradeLog.viewFacetRegistryTx = receipt1.hash;
  upgradeLog.changes.push("FacetRegistry updated with new OBViewFacet");

  // ══════════════════════════════════════════════════════════════════════
  // Step 4: Update FacetRegistry for OBPricingFacet
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 4: Update FacetRegistry for OBPricingFacet");
  console.log("─".repeat(70));

  const pricingSelectors = await selectorsFromArtifact("OBPricingFacet");
  console.log(`  ${pricingSelectors.length} selectors to update`);

  const pricingFacets = pricingSelectors.map(() => newPricingFacetAddr);
  const tx2 = await registry.updateFacets(pricingSelectors, pricingFacets);
  const receipt2 = await tx2.wait();
  console.log(`✓ FacetRegistry updated for OBPricingFacet (tx: ${receipt2.hash})`);
  upgradeLog.pricingFacetRegistryTx = receipt2.hash;
  upgradeLog.changes.push("FacetRegistry updated with new OBPricingFacet");

  // ══════════════════════════════════════════════════════════════════════
  // Update deployment file
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Updating deployment file");
  console.log("─".repeat(70));

  let deployment = {};
  try {
    if (fs.existsSync(deploymentPath)) {
      deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    }
  } catch (_) {}

  deployment.contracts = deployment.contracts || {};
  
  if (deployment.contracts.OB_VIEW_FACET) {
    deployment.contracts.OB_VIEW_FACET_PREVIOUS = deployment.contracts.OB_VIEW_FACET;
  }
  deployment.contracts.OB_VIEW_FACET = newViewFacetAddr;
  deployment.contracts.OB_VIEW_FACET_UPGRADED_AT = new Date().toISOString();

  if (deployment.contracts.OB_PRICING_FACET) {
    deployment.contracts.OB_PRICING_FACET_PREVIOUS = deployment.contracts.OB_PRICING_FACET;
  }
  deployment.contracts.OB_PRICING_FACET = newPricingFacetAddr;
  deployment.contracts.OB_PRICING_FACET_UPGRADED_AT = new Date().toISOString();

  deployment.notes = deployment.notes || {};
  deployment.notes.viewFacetUpgrade = {
    timestamp: new Date().toISOString(),
    reason: "Fix order book view functions - use linked list heads",
    contracts: upgradeLog.contracts,
    by: deployer.address,
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`✓ Updated: ${deploymentPath}`);

  // Save upgrade log
  const logPath = path.join(
    __dirname,
    `../deployments/view-facet-upgrade-${chainId}-${Date.now()}.json`
  );
  fs.writeFileSync(logPath, JSON.stringify(upgradeLog, null, 2));
  console.log(`✓ Upgrade log: ${logPath}`);

  // ══════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(70));
  console.log("  UPGRADE COMPLETE");
  console.log("═".repeat(70));
  console.log(`  OBViewFacet:    ${newViewFacetAddr}`);
  console.log(`  OBPricingFacet: ${newPricingFacetAddr}`);
  console.log(`  FacetRegistry:  ${facetRegistryAddr}`);
  console.log("\n  All V2 markets now use the fixed view functions.");
  console.log("  The order book should correctly display resting orders.");
  console.log("═".repeat(70) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Upgrade failed:", e?.message || String(e));
    process.exit(1);
  });
