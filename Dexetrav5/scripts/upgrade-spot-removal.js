#!/usr/bin/env node

/**
 * upgrade-spot-removal.js
 *
 * Deploys updated OBOrderPlacementFacet and MetaTradeFacet with spot order functions removed.
 * Updates FacetRegistry to apply the upgrade to all V2 markets in one transaction.
 *
 * ENV VARS (required):
 *   FACET_REGISTRY_ADDRESS     - FacetRegistry for facet upgrades
 *
 * ENV VARS (optional):
 *   DRY_RUN=1                  - Deploy but don't update registry
 *   SKIP_PLACEMENT_FACET=1     - Skip OBOrderPlacementFacet upgrade
 *   SKIP_META_FACET=1          - Skip MetaTradeFacet upgrade
 *
 * USAGE:
 *   npx hardhat run Dexetrav5/scripts/upgrade-spot-removal.js --network hyperliquid
 */

const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

function optionalEnv(name) {
  const val = process.env[name];
  if (!val) return null;
  return val.split("#")[0].split(" ")[0].trim();
}

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

function getNetworkName(rawNetworkName, chainId) {
  const n = String(rawNetworkName || "").toLowerCase();
  if (["hyperliquid_mainnet", "hyperliquid-mainnet", "hl", "hl_mainnet", "hl-mainnet", "hyperliquid"].includes(n)) {
    return "hyperliquid";
  }
  if (["hyperliquid-testnet", "hl_testnet", "hl-testnet"].includes(n)) {
    return "hyperliquid_testnet";
  }
  if ((n === "hardhat" || n === "unknown") && chainId === 31337) {
    return "localhost";
  }
  if (chainId === 999) return "hyperliquid";
  if (chainId === 998) return "hyperliquid_testnet";
  return n;
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  Spot Order Removal Upgrade");
  console.log("  Remove spot order functions from OBOrderPlacementFacet & MetaTradeFacet");
  console.log("═".repeat(70) + "\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const rawNetworkName = process.env.HARDHAT_NETWORK || "unknown";
  const networkName = getNetworkName(rawNetworkName, chainId);
  console.log(`Network: ${networkName} (chainId ${chainId})`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  // Try to get FacetRegistry from env or from factory
  let facetRegistryAddr = optionalEnv("FACET_REGISTRY_ADDRESS");
  
  if (!facetRegistryAddr) {
    // Try to read from deployment file and get from factory
    const deploymentPath = path.join(__dirname, `../deployments/${networkName}-deployment.json`);
    try {
      const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
      const factoryAddr = deployment.contracts?.FUTURES_MARKET_FACTORY;
      if (factoryAddr) {
        console.log(`Reading FacetRegistry from factory: ${factoryAddr}`);
        const factory = await ethers.getContractAt(
          ["function facetRegistry() view returns (address)"],
          factoryAddr
        );
        facetRegistryAddr = await factory.facetRegistry();
        console.log(`  Found: ${facetRegistryAddr}`);
      }
    } catch (e) {
      console.log(`  Could not read factory: ${e.message}`);
    }
  }
  
  console.log(`FacetRegistry: ${facetRegistryAddr || "(not found - will skip registry update)"}`);

  const dryRun = !!process.env.DRY_RUN;
  const skipPlacement = !!process.env.SKIP_PLACEMENT_FACET;
  const skipMeta = !!process.env.SKIP_META_FACET;

  if (dryRun) console.log("\n  ⚠ DRY_RUN mode — will deploy but NOT update registry\n");

  const upgradeLog = {
    timestamp: new Date().toISOString(),
    reason: "Remove spot order functions - margin-only trading",
    deployer: deployer.address,
    network: networkName,
    chainId,
    contracts: {},
    changes: [],
  };

  // ══════════════════════════════════════════════════════════════════════
  // Step 1: Deploy new OBOrderPlacementFacet
  // ══════════════════════════════════════════════════════════════════════
  let newPlacementFacetAddr = null;
  if (!skipPlacement) {
    console.log("\n" + "─".repeat(70));
    console.log("Step 1: Deploy new OBOrderPlacementFacet");
    console.log("─".repeat(70));
    console.log("(Spot order functions removed - margin-only)");

    const OBOrderPlacementFacet = await ethers.getContractFactory("OBOrderPlacementFacet");
    const facet = await OBOrderPlacementFacet.deploy();
    await facet.waitForDeployment();
    newPlacementFacetAddr = await facet.getAddress();
    console.log(`✓ New OBOrderPlacementFacet deployed: ${newPlacementFacetAddr}`);
    upgradeLog.contracts.OBOrderPlacementFacet = newPlacementFacetAddr;
    upgradeLog.changes.push("Deployed new OBOrderPlacementFacet (spot functions removed)");
  } else {
    console.log("\n--- Step 1: OBOrderPlacementFacet deploy SKIPPED ---");
  }

  // ══════════════════════════════════════════════════════════════════════
  // Step 2: Deploy new MetaTradeFacet
  // ══════════════════════════════════════════════════════════════════════
  let newMetaFacetAddr = null;
  if (!skipMeta) {
    console.log("\n" + "─".repeat(70));
    console.log("Step 2: Deploy new MetaTradeFacet");
    console.log("─".repeat(70));
    console.log("(Spot meta functions removed - margin-only)");

    const MetaTradeFacet = await ethers.getContractFactory("MetaTradeFacet");
    const facet = await MetaTradeFacet.deploy();
    await facet.waitForDeployment();
    newMetaFacetAddr = await facet.getAddress();
    console.log(`✓ New MetaTradeFacet deployed: ${newMetaFacetAddr}`);
    upgradeLog.contracts.MetaTradeFacet = newMetaFacetAddr;
    upgradeLog.changes.push("Deployed new MetaTradeFacet (spot functions removed)");
  } else {
    console.log("\n--- Step 2: MetaTradeFacet deploy SKIPPED ---");
  }

  // ══════════════════════════════════════════════════════════════════════
  // Step 3: Update FacetRegistry for OBOrderPlacementFacet
  // ══════════════════════════════════════════════════════════════════════
  if (!skipPlacement && !dryRun && newPlacementFacetAddr && facetRegistryAddr) {
    console.log("\n" + "─".repeat(70));
    console.log("Step 3: Update FacetRegistry for OBOrderPlacementFacet");
    console.log("─".repeat(70));
    console.log("(Single transaction upgrades ALL V2 markets!)");

    const selectors = await selectorsFromArtifact("OBOrderPlacementFacet");
    console.log(`  ${selectors.length} selectors to update`);

    const registry = await ethers.getContractAt(
      ["function updateFacets(bytes4[] calldata _selectors, address[] calldata _facets) external"],
      facetRegistryAddr
    );

    const facets = selectors.map(() => newPlacementFacetAddr);
    const tx = await registry.updateFacets(selectors, facets);
    const receipt = await tx.wait();
    console.log(`✓ FacetRegistry updated for OBOrderPlacementFacet (tx: ${receipt.hash})`);
    upgradeLog.placementFacetRegistryTx = receipt.hash;
    upgradeLog.changes.push("FacetRegistry updated with new OBOrderPlacementFacet");
  } else if (!facetRegistryAddr) {
    console.log("\n--- Step 3: FacetRegistry update SKIPPED (no FACET_REGISTRY_ADDRESS) ---");
  } else if (dryRun) {
    console.log("\n--- Step 3: FacetRegistry update SKIPPED (DRY_RUN) ---");
  }

  // ══════════════════════════════════════════════════════════════════════
  // Step 4: Update FacetRegistry for MetaTradeFacet
  // ══════════════════════════════════════════════════════════════════════
  if (!skipMeta && !dryRun && newMetaFacetAddr && facetRegistryAddr) {
    console.log("\n" + "─".repeat(70));
    console.log("Step 4: Update FacetRegistry for MetaTradeFacet");
    console.log("─".repeat(70));

    const selectors = await selectorsFromArtifact("MetaTradeFacet");
    console.log(`  ${selectors.length} selectors to update`);

    const registry = await ethers.getContractAt(
      ["function updateFacets(bytes4[] calldata _selectors, address[] calldata _facets) external"],
      facetRegistryAddr
    );

    const facets = selectors.map(() => newMetaFacetAddr);
    const tx = await registry.updateFacets(selectors, facets);
    const receipt = await tx.wait();
    console.log(`✓ FacetRegistry updated for MetaTradeFacet (tx: ${receipt.hash})`);
    upgradeLog.metaFacetRegistryTx = receipt.hash;
    upgradeLog.changes.push("FacetRegistry updated with new MetaTradeFacet");
  } else if (!facetRegistryAddr) {
    console.log("\n--- Step 4: FacetRegistry update SKIPPED (no FACET_REGISTRY_ADDRESS) ---");
  } else if (dryRun) {
    console.log("\n--- Step 4: FacetRegistry update SKIPPED (DRY_RUN) ---");
  }

  // ══════════════════════════════════════════════════════════════════════
  // Update deployment file
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Updating deployment file");
  console.log("─".repeat(70));

  const deploymentPath = path.join(__dirname, `../deployments/${networkName}-deployment.json`);
  let deployment = {};
  try {
    if (fs.existsSync(deploymentPath)) {
      deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    }
  } catch (_) {}

  deployment.contracts = deployment.contracts || {};
  
  if (newPlacementFacetAddr) {
    if (deployment.contracts.OB_ORDER_PLACEMENT_FACET) {
      deployment.contracts.OB_ORDER_PLACEMENT_FACET_PREVIOUS = deployment.contracts.OB_ORDER_PLACEMENT_FACET;
    }
    deployment.contracts.OB_ORDER_PLACEMENT_FACET = newPlacementFacetAddr;
    deployment.contracts.OB_ORDER_PLACEMENT_FACET_UPGRADED_AT = new Date().toISOString();
  }
  
  if (newMetaFacetAddr) {
    if (deployment.contracts.META_TRADE_FACET) {
      deployment.contracts.META_TRADE_FACET_PREVIOUS = deployment.contracts.META_TRADE_FACET;
    }
    deployment.contracts.META_TRADE_FACET = newMetaFacetAddr;
    deployment.contracts.META_TRADE_FACET_UPGRADED_AT = new Date().toISOString();
  }

  deployment.notes = deployment.notes || {};
  deployment.notes.spotRemovalUpgrade = {
    timestamp: new Date().toISOString(),
    reason: "Remove spot order functions - margin-only trading",
    contracts: upgradeLog.contracts,
    by: deployer.address,
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`✓ Updated: ${deploymentPath}`);

  // Save detailed upgrade log
  const deploymentsDir = path.join(__dirname, "../deployments");
  const logFile = path.join(deploymentsDir, `spot-removal-upgrade-${chainId}-${Date.now()}.json`);
  fs.writeFileSync(logFile, JSON.stringify(upgradeLog, null, 2));
  console.log(`✓ Saved upgrade log: ${logFile}`);

  // ══════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(70));
  console.log("  Upgrade Complete - Spot Orders Removed");
  console.log("═".repeat(70));
  if (newPlacementFacetAddr) {
    console.log(`  New OBOrderPlacementFacet: ${newPlacementFacetAddr}`);
  }
  if (newMetaFacetAddr) {
    console.log(`  New MetaTradeFacet:        ${newMetaFacetAddr}`);
  }
  console.log("");
  console.log("  Removed functions:");
  console.log("    - placeLimitOrder()");
  console.log("    - placeMarketOrder()");
  console.log("    - placeMarketOrderWithSlippage()");
  console.log("    - placeLimitOrderBy()");
  console.log("    - placeMarketOrderBy()");
  console.log("    - metaPlaceLimit()");
  console.log("    - metaPlaceMarket()");
  console.log("    - metaPlaceMarketWithSlippage()");
  console.log("    - sessionPlaceLimit()");
  console.log("    - sessionPlaceMarket()");
  console.log("");
  console.log(`  Changes: ${upgradeLog.changes.length}`);
  upgradeLog.changes.forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
  if (dryRun) {
    console.log("\n  ⚠ DRY_RUN — contracts deployed but registry NOT updated");
  }
  console.log("═".repeat(70) + "\n");

  return {
    OBOrderPlacementFacet: newPlacementFacetAddr,
    MetaTradeFacet: newMetaFacetAddr,
  };
}

main()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nUpgrade failed:", error);
    process.exit(1);
  });
