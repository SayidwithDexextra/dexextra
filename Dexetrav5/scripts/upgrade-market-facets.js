#!/usr/bin/env node
/**
 * upgrade-market-facets.js
 * 
 * Performs a diamond facet cut on a specific market to upgrade to the new optimized facets.
 * 
 * Usage:
 *   MARKET_ADDRESS=0x... npx hardhat run scripts/upgrade-market-facets.js --network hyperliquid
 * 
 * Or with explicit facet overrides:
 *   MARKET_ADDRESS=0x... \
 *   OB_ORDER_PLACEMENT_FACET=0x... \
 *   OB_TRADE_EXECUTION_FACET=0x... \
 *   OB_LIQUIDATION_FACET=0x... \
 *   OB_ADMIN_VIEW_FACET=0x... \
 *   npx hardhat run scripts/upgrade-market-facets.js --network hyperliquid
 * 
 * Options:
 *   --dry-run    Show what would be done without executing
 *   --facets     Comma-separated list of facets to upgrade (default: all)
 *                e.g., --facets placement,execution,liquidation,adminview
 */
const { ethers, artifacts } = require("hardhat");
const path = require("path");

// Load env from common locations
try {
  require("dotenv").config({ path: path.join(process.cwd(), "..", ".env.local") });
  require("dotenv").config({ path: path.join(process.cwd(), "..", ".env") });
  require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });
} catch (_) {}

// Parse CLI args
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const facetsArg = args.find(a => a.startsWith("--facets="));
const selectedFacets = facetsArg 
  ? facetsArg.replace("--facets=", "").split(",").map(f => f.trim().toLowerCase())
  : null;

// Facet configuration
const FACETS = {
  placement: {
    name: "OBOrderPlacementFacet",
    envKey: "OB_ORDER_PLACEMENT_FACET",
    artifact: "OBOrderPlacementFacet",
  },
  execution: {
    name: "OBTradeExecutionFacet", 
    envKey: "OB_TRADE_EXECUTION_FACET",
    artifact: "OBTradeExecutionFacet",
  },
  liquidation: {
    name: "OBLiquidationFacet",
    envKey: "OB_LIQUIDATION_FACET", 
    artifact: "OBLiquidationFacet",
  },
  adminview: {
    name: "OBAdminViewFacet",
    envKey: "OB_ADMIN_VIEW_FACET",
    artifact: "OBAdminViewFacet",
  },
};

function renderType(t) {
  const type = t.type || "";
  const arr = type.match(/(\[.*\])$/);
  const base = type.replace(/(\[.*\])$/, "");
  if (base === "tuple") {
    return "(" + (t.components || []).map(renderType).join(",") + ")" + (arr ? arr[1] : "");
  }
  return type;
}

function getSelectorsFromAbi(abi) {
  const fns = abi.filter(e => e.type === "function");
  return fns.map(f => {
    const sig = f.name + "(" + (f.inputs || []).map(renderType).join(",") + ")";
    return ethers.id(sig).slice(0, 10);
  });
}

async function getFacetSelectors(facetKey) {
  const config = FACETS[facetKey];
  if (!config) throw new Error(`Unknown facet: ${facetKey}`);
  
  const artifact = await artifacts.readArtifact(config.artifact);
  return getSelectorsFromAbi(artifact.abi);
}

async function main() {
  console.log("\n💎 Market Facet Upgrade Script");
  console.log("═".repeat(60));
  
  if (isDryRun) {
    console.log("🔍 DRY RUN MODE - No transactions will be sent\n");
  }

  // Get market address
  const marketAddress = (process.env.MARKET_ADDRESS || "").trim();
  if (!marketAddress || !ethers.isAddress(marketAddress)) {
    throw new Error("MARKET_ADDRESS env var required (valid address)");
  }

  // Get signer
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  console.log(`Signer: ${signerAddress}`);
  console.log(`Market: ${marketAddress}`);
  
  // Check signer balance
  const balance = await ethers.provider.getBalance(signerAddress);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

  // Determine which facets to upgrade
  const facetsToUpgrade = selectedFacets 
    ? Object.keys(FACETS).filter(k => selectedFacets.includes(k))
    : Object.keys(FACETS);

  if (facetsToUpgrade.length === 0) {
    throw new Error("No valid facets selected. Available: " + Object.keys(FACETS).join(", "));
  }

  console.log(`Facets to upgrade: ${facetsToUpgrade.join(", ")}\n`);

  // Get loupe interface to check current facets
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4 selector) view returns (address)"],
    marketAddress,
    ethers.provider
  );

  // Build the cut operations
  const allCuts = [];
  const summary = [];

  for (const facetKey of facetsToUpgrade) {
    const config = FACETS[facetKey];
    const newFacetAddress = (
      process.env[config.envKey] || 
      process.env[`NEXT_PUBLIC_${config.envKey}`] || 
      ""
    ).trim();

    if (!newFacetAddress || !ethers.isAddress(newFacetAddress)) {
      console.log(`⚠️  Skipping ${config.name}: ${config.envKey} not set or invalid`);
      continue;
    }

    console.log(`\n📦 ${config.name}`);
    console.log(`   New address: ${newFacetAddress}`);

    // Get selectors for this facet
    const selectors = await getFacetSelectors(facetKey);
    console.log(`   Selectors: ${selectors.length}`);

    // Check each selector's current facet
    const toAdd = [];
    const toReplace = [];
    const unchanged = [];

    for (const sel of selectors) {
      let currentFacet = ethers.ZeroAddress;
      try {
        currentFacet = await loupe.facetAddress(sel);
      } catch {}

      if (!currentFacet || currentFacet === ethers.ZeroAddress) {
        toAdd.push(sel);
      } else if (currentFacet.toLowerCase() !== newFacetAddress.toLowerCase()) {
        toReplace.push(sel);
      } else {
        unchanged.push(sel);
      }
    }

    console.log(`   → Add: ${toAdd.length}, Replace: ${toReplace.length}, Unchanged: ${unchanged.length}`);

    if (toReplace.length > 0) {
      allCuts.push({
        facetAddress: newFacetAddress,
        action: 1, // Replace
        functionSelectors: toReplace,
      });
    }

    if (toAdd.length > 0) {
      allCuts.push({
        facetAddress: newFacetAddress,
        action: 0, // Add
        functionSelectors: toAdd,
      });
    }

    summary.push({
      facet: config.name,
      address: newFacetAddress,
      add: toAdd.length,
      replace: toReplace.length,
      unchanged: unchanged.length,
    });
  }

  console.log("\n" + "─".repeat(60));
  console.log("📋 Summary:\n");
  
  let totalChanges = 0;
  for (const s of summary) {
    const changes = s.add + s.replace;
    totalChanges += changes;
    const status = changes > 0 ? "🔄" : "✓";
    console.log(`   ${status} ${s.facet}: +${s.add} add, ~${s.replace} replace, =${s.unchanged} same`);
  }

  if (totalChanges === 0) {
    console.log("\n✅ All facets are already up to date!");
    return;
  }

  console.log(`\n   Total cut operations: ${allCuts.length}`);
  console.log("─".repeat(60));

  if (isDryRun) {
    console.log("\n🔍 DRY RUN - Would execute the following cuts:");
    for (const cut of allCuts) {
      const actionName = cut.action === 0 ? "Add" : cut.action === 1 ? "Replace" : "Remove";
      console.log(`   ${actionName}: ${cut.facetAddress} (${cut.functionSelectors.length} selectors)`);
    }
    console.log("\nRun without --dry-run to execute.");
    return;
  }

  // Execute the diamond cut
  console.log("\n🔧 Executing diamond cut...");
  
  const diamond = await ethers.getContractAt("IDiamondCut", marketAddress, signer);
  
  try {
    const tx = await diamond.diamondCut(allCuts, ethers.ZeroAddress, "0x");
    console.log(`   TX: ${tx.hash}`);
    console.log("   Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log(`\n✅ Success!`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
  } catch (error) {
    console.error("\n❌ Diamond cut failed:");
    console.error(error?.reason || error?.message || error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Error:", e?.message || String(e));
    process.exit(1);
  });
