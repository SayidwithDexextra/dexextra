#!/usr/bin/env node
/**
 * continue-gas-optimization-upgrade.js
 * 
 * Continues the gas optimization upgrade from step 5 (CoreVault implementation).
 * Uses the already-deployed contracts from the interrupted run.
 */

const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}

// Already deployed contracts from interrupted run
const DEPLOYED = {
  PositionManager: "0x8e3dAF0040C4ea49007ead181602c25b1b82C1CC",
  VaultViewsManager: "0x93c83605016D760C7897B9121fA71D6AEfAB5e36",
  SettlementManager: "0xD1dbC905FB426B6Fbe2d30C3567D3821eCc3141A",
  LiquidationManager: "0x5eF9e96317F918e6a04c6D03C31A20dDC5839A4d",
};

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val.split("#")[0].split(" ")[0].trim();
}

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

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  CoreVault Gas Optimization Upgrade - CONTINUATION");
  console.log("  Resuming from Step 5 (CoreVault Implementation)");
  console.log("═".repeat(70) + "\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`Network: ${networkName} (chainId ${chainId})`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  const vaultProxy = requireEnv("CORE_VAULT_ADDRESS");
  const collateralToken = requireEnv("MOCK_USDC_ADDRESS");
  const vaultAnalyticsAddr = requireEnv("VAULT_ANALYTICS_ADDRESS");
  const facetRegistryAddr = optionalEnv("FACET_REGISTRY_ADDRESS");

  console.log("Current addresses:");
  console.log(`  CoreVault proxy:     ${vaultProxy}`);
  console.log(`  Collateral token:    ${collateralToken}`);
  console.log(`  VaultAnalytics:      ${vaultAnalyticsAddr}`);
  console.log(`  FacetRegistry:       ${facetRegistryAddr || "(not set)"}`);

  console.log("\nAlready deployed (from interrupted run):");
  console.log(`  PositionManager:     ${DEPLOYED.PositionManager}`);
  console.log(`  VaultViewsManager:   ${DEPLOYED.VaultViewsManager}`);
  console.log(`  SettlementManager:   ${DEPLOYED.SettlementManager}`);
  console.log(`  LiquidationManager:  ${DEPLOYED.LiquidationManager}`);

  const upgradeLog = {
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: networkName,
    chainId,
    vaultProxy,
    changes: [],
    contracts: { ...DEPLOYED },
  };

  // ══════════════════════════════════════════════════════════════════════
  // Step 5: Deploy new CoreVault implementation
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 5: Deploy new CoreVault implementation");
  console.log("─".repeat(70));
  console.log("(Contains O(1) margin operations)");

  const CoreVaultImpl = await ethers.getContractFactory("CoreVault", {
    libraries: { PositionManager: DEPLOYED.PositionManager },
  });
  const newImpl = await CoreVaultImpl.deploy(collateralToken);
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log(`✓ New CoreVault implementation deployed: ${newImplAddr}`);
  upgradeLog.contracts.CoreVaultImpl = newImplAddr;
  upgradeLog.changes.push("Deployed new CoreVault implementation");

  // ══════════════════════════════════════════════════════════════════════
  // Step 6: Upgrade CoreVault proxy (UUPS)
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 6: Upgrade CoreVault proxy (UUPS)");
  console.log("─".repeat(70));

  const vault = await ethers.getContractAt("CoreVault", vaultProxy);
  const tx1 = await vault.upgradeToAndCall(newImplAddr, "0x");
  const receipt1 = await tx1.wait();
  console.log(`✓ upgradeToAndCall complete (tx: ${receipt1.hash})`);
  upgradeLog.upgradeToAndCallTx = receipt1.hash;
  upgradeLog.changes.push("CoreVault implementation upgraded (UUPS)");

  // ══════════════════════════════════════════════════════════════════════
  // Step 7: Swap delegatecall targets
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 7: Swap delegatecall targets");
  console.log("─".repeat(70));

  let tx;
  tx = await vault.setViewsManager(DEPLOYED.VaultViewsManager);
  await tx.wait();
  console.log(`✓ setViewsManager → ${DEPLOYED.VaultViewsManager}`);

  tx = await vault.setSettlementManager(DEPLOYED.SettlementManager);
  await tx.wait();
  console.log(`✓ setSettlementManager → ${DEPLOYED.SettlementManager}`);

  tx = await vault.setLiquidationManager(DEPLOYED.LiquidationManager);
  await tx.wait();
  console.log(`✓ setLiquidationManager → ${DEPLOYED.LiquidationManager}`);

  upgradeLog.changes.push("Swapped all delegatecall targets");

  // ══════════════════════════════════════════════════════════════════════
  // Step 8: Deploy new OBOrderPlacementFacet
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 8: Deploy new OBOrderPlacementFacet");
  console.log("─".repeat(70));
  console.log("(O(1) price level operations via linked list)");

  const OBOrderPlacementFacet = await ethers.getContractFactory("OBOrderPlacementFacet");
  const facet = await OBOrderPlacementFacet.deploy();
  await facet.waitForDeployment();
  const newFacetAddr = await facet.getAddress();
  console.log(`✓ New OBOrderPlacementFacet deployed: ${newFacetAddr}`);
  upgradeLog.contracts.OBOrderPlacementFacet = newFacetAddr;
  upgradeLog.changes.push("Deployed new OBOrderPlacementFacet");

  // ══════════════════════════════════════════════════════════════════════
  // Step 9: Update FacetRegistry
  // ══════════════════════════════════════════════════════════════════════
  if (facetRegistryAddr) {
    console.log("\n" + "─".repeat(70));
    console.log("Step 9: Update FacetRegistry");
    console.log("─".repeat(70));
    console.log("(Single transaction upgrades ALL V2 markets!)");

    const selectors = await selectorsFromArtifact("OBOrderPlacementFacet");
    console.log(`  ${selectors.length} selectors to update`);

    const registry = await ethers.getContractAt(
      ["function updateFacets(bytes4[] calldata _selectors, address[] calldata _facets) external"],
      facetRegistryAddr
    );

    const facets = selectors.map(() => newFacetAddr);
    const tx2 = await registry.updateFacets(selectors, facets);
    const receipt2 = await tx2.wait();
    console.log(`✓ FacetRegistry updated (tx: ${receipt2.hash})`);
    upgradeLog.facetRegistryUpdateTx = receipt2.hash;
    upgradeLog.changes.push("FacetRegistry updated with new OBOrderPlacementFacet");
  } else {
    console.log("\n--- Step 9: FacetRegistry update SKIPPED (no FACET_REGISTRY_ADDRESS) ---");
  }

  // ══════════════════════════════════════════════════════════════════════
  // Step 10: Initialize margin caches (SKIPPED - do separately if needed)
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 10: Initialize margin caches");
  console.log("─".repeat(70));
  console.log("(Skipping - run initialize-margin-caches.js separately if needed)");

  // ══════════════════════════════════════════════════════════════════════
  // Save deployment record
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Saving deployment record");
  console.log("─".repeat(70));

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const outFile = path.join(
    deploymentsDir,
    `gas-optimization-upgrade-${chainId}-${Date.now()}.json`
  );
  fs.writeFileSync(outFile, JSON.stringify(upgradeLog, null, 2));
  console.log(`✓ Saved: ${outFile}`);

  // ══════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(70));
  console.log("  Upgrade Complete!");
  console.log("═".repeat(70));
  console.log(`  CoreVault Proxy:           ${vaultProxy}`);
  console.log(`  New CoreVault Impl:        ${newImplAddr}`);
  console.log(`  New PositionManager:       ${DEPLOYED.PositionManager}`);
  console.log(`  New VaultViewsManager:     ${DEPLOYED.VaultViewsManager}`);
  console.log(`  New SettlementManager:     ${DEPLOYED.SettlementManager}`);
  console.log(`  New LiquidationManager:    ${DEPLOYED.LiquidationManager}`);
  console.log(`  New OBOrderPlacementFacet: ${newFacetAddr}`);
  console.log("");
  console.log(`  Changes: ${upgradeLog.changes.length}`);
  upgradeLog.changes.forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
  console.log("═".repeat(70) + "\n");

  // Update .env.local instructions
  console.log("Update .env.local with:");
  console.log(`  POSITION_MANAGER_ADDRESS=${DEPLOYED.PositionManager}`);
  console.log(`  OB_ORDER_PLACEMENT_FACET=${newFacetAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nUpgrade failed:", error);
    process.exit(1);
  });
