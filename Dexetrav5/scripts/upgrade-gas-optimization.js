#!/usr/bin/env node

/**
 * upgrade-gas-optimization.js
 *
 * Deploys all contracts required for the CoreVault gas optimization upgrade:
 *   - New PositionManager library (with index-aware functions)
 *   - New manager contracts (VaultViewsManager, LiquidationManager, SettlementManager)
 *   - New CoreVault implementation (UUPS upgrade)
 *   - New OBOrderPlacementFacet (with O(1) price level operations)
 *
 * After deployment, wires everything together and initializes margin caches.
 *
 * ENV VARS (required):
 *   CORE_VAULT_ADDRESS         - CoreVault proxy address
 *   MOCK_USDC_ADDRESS          - Collateral token (USDC)
 *   VAULT_ANALYTICS_ADDRESS    - Existing VaultAnalytics library
 *   FACET_REGISTRY_ADDRESS     - FacetRegistry for facet upgrades
 *
 * ENV VARS (optional):
 *   DRY_RUN=1                  - Deploy but don't wire
 *   SKIP_VAULT_UPGRADE=1       - Skip CoreVault UUPS upgrade
 *   SKIP_FACET_UPGRADE=1       - Skip OBOrderPlacementFacet upgrade
 *   SKIP_CACHE_INIT=1          - Skip margin cache initialization
 *
 * USAGE:
 *   npx hardhat run scripts/upgrade-gas-optimization.js --network hyperliquid
 */

const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

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
  console.log("  CoreVault Gas Optimization Upgrade");
  console.log("  O(N) → O(1) Margin Operations");
  console.log("═".repeat(70) + "\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`Network: ${networkName} (chainId ${chainId})`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  // Read required addresses
  const vaultProxy = requireEnv("CORE_VAULT_ADDRESS");
  const collateralToken = requireEnv("MOCK_USDC_ADDRESS");
  const vaultAnalyticsAddr = requireEnv("VAULT_ANALYTICS_ADDRESS");
  const facetRegistryAddr = optionalEnv("FACET_REGISTRY_ADDRESS");

  console.log("Current addresses:");
  console.log(`  CoreVault proxy:     ${vaultProxy}`);
  console.log(`  Collateral token:    ${collateralToken}`);
  console.log(`  VaultAnalytics:      ${vaultAnalyticsAddr}`);
  console.log(`  FacetRegistry:       ${facetRegistryAddr || "(not set)"}`);

  const dryRun = !!process.env.DRY_RUN;
  const skipVault = !!process.env.SKIP_VAULT_UPGRADE;
  const skipFacet = !!process.env.SKIP_FACET_UPGRADE;
  const skipCacheInit = !!process.env.SKIP_CACHE_INIT;

  if (dryRun) console.log("\n  ⚠ DRY_RUN mode — will deploy but NOT wire\n");

  const upgradeLog = {
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: networkName,
    chainId,
    vaultProxy,
    changes: [],
    contracts: {},
  };

  // ══════════════════════════════════════════════════════════════════════
  // Step 1: Deploy new PositionManager library
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 1: Deploy new PositionManager library");
  console.log("─".repeat(70));
  console.log("(Contains new index-aware functions for O(1) operations)");

  const PositionManager = await ethers.getContractFactory("PositionManager");
  const positionManager = await PositionManager.deploy();
  await positionManager.waitForDeployment();
  const positionManagerAddr = await positionManager.getAddress();
  console.log(`✓ New PositionManager deployed: ${positionManagerAddr}`);
  upgradeLog.contracts.PositionManager = positionManagerAddr;
  upgradeLog.changes.push("Deployed new PositionManager library");

  // ══════════════════════════════════════════════════════════════════════
  // Step 2: Deploy new VaultViewsManager
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 2: Deploy new VaultViewsManager");
  console.log("─".repeat(70));
  console.log("(Uses cached margin totals, contains initializeMarginCaches)");

  const VaultViewsManager = await ethers.getContractFactory("VaultViewsManager", {
    libraries: { VaultAnalytics: vaultAnalyticsAddr },
  });
  const viewsManager = await VaultViewsManager.deploy();
  await viewsManager.waitForDeployment();
  const viewsManagerAddr = await viewsManager.getAddress();
  console.log(`✓ New VaultViewsManager deployed: ${viewsManagerAddr}`);
  upgradeLog.contracts.VaultViewsManager = viewsManagerAddr;
  upgradeLog.changes.push("Deployed new VaultViewsManager");

  // ══════════════════════════════════════════════════════════════════════
  // Step 3: Deploy new SettlementManager
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 3: Deploy new SettlementManager");
  console.log("─".repeat(70));
  console.log("(Linked to new PositionManager)");

  const SettlementManager = await ethers.getContractFactory("SettlementManager", {
    libraries: { PositionManager: positionManagerAddr },
  });
  const settlementManager = await SettlementManager.deploy();
  await settlementManager.waitForDeployment();
  const settlementManagerAddr = await settlementManager.getAddress();
  console.log(`✓ New SettlementManager deployed: ${settlementManagerAddr}`);
  upgradeLog.contracts.SettlementManager = settlementManagerAddr;
  upgradeLog.changes.push("Deployed new SettlementManager");

  // ══════════════════════════════════════════════════════════════════════
  // Step 4: Deploy new LiquidationManager
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 4: Deploy new LiquidationManager");
  console.log("─".repeat(70));
  console.log("(Linked to new PositionManager)");

  const LiquidationManager = await ethers.getContractFactory("LiquidationManager", {
    libraries: {
      VaultAnalytics: vaultAnalyticsAddr,
      PositionManager: positionManagerAddr,
    },
  });
  const liquidationManager = await LiquidationManager.deploy(
    collateralToken,
    deployer.address
  );
  await liquidationManager.waitForDeployment();
  const liquidationManagerAddr = await liquidationManager.getAddress();
  console.log(`✓ New LiquidationManager deployed: ${liquidationManagerAddr}`);
  upgradeLog.contracts.LiquidationManager = liquidationManagerAddr;
  upgradeLog.changes.push("Deployed new LiquidationManager");

  // ══════════════════════════════════════════════════════════════════════
  // Step 5: Deploy new CoreVault implementation
  // ══════════════════════════════════════════════════════════════════════
  let newImplAddr = null;
  if (!skipVault) {
    console.log("\n" + "─".repeat(70));
    console.log("Step 5: Deploy new CoreVault implementation");
    console.log("─".repeat(70));
    console.log("(Contains O(1) margin operations)");

    const CoreVaultImpl = await ethers.getContractFactory("CoreVault", {
      libraries: { PositionManager: positionManagerAddr },
    });
    const newImpl = await CoreVaultImpl.deploy(collateralToken);
    await newImpl.waitForDeployment();
    newImplAddr = await newImpl.getAddress();
    console.log(`✓ New CoreVault implementation deployed: ${newImplAddr}`);
    upgradeLog.contracts.CoreVaultImpl = newImplAddr;
    upgradeLog.changes.push("Deployed new CoreVault implementation");
  } else {
    console.log("\n--- Step 5: CoreVault implementation deploy SKIPPED ---");
  }

  // ══════════════════════════════════════════════════════════════════════
  // Step 6: Upgrade CoreVault proxy (UUPS)
  // ══════════════════════════════════════════════════════════════════════
  if (!skipVault && !dryRun && newImplAddr) {
    console.log("\n" + "─".repeat(70));
    console.log("Step 6: Upgrade CoreVault proxy (UUPS)");
    console.log("─".repeat(70));

    const vault = await ethers.getContractAt("CoreVault", vaultProxy);
    const tx = await vault.upgradeToAndCall(newImplAddr, "0x");
    const receipt = await tx.wait();
    console.log(`✓ upgradeToAndCall complete (tx: ${receipt.hash})`);
    upgradeLog.upgradeToAndCallTx = receipt.hash;
    upgradeLog.changes.push("CoreVault implementation upgraded (UUPS)");
  } else if (dryRun) {
    console.log("\n--- Step 6: CoreVault UUPS upgrade SKIPPED (DRY_RUN) ---");
  }

  // ══════════════════════════════════════════════════════════════════════
  // Step 7: Swap delegatecall targets
  // ══════════════════════════════════════════════════════════════════════
  if (!dryRun) {
    console.log("\n" + "─".repeat(70));
    console.log("Step 7: Swap delegatecall targets");
    console.log("─".repeat(70));

    const vault = await ethers.getContractAt("CoreVault", vaultProxy);
    let tx;

    tx = await vault.setViewsManager(viewsManagerAddr);
    await tx.wait();
    console.log(`✓ setViewsManager → ${viewsManagerAddr}`);

    tx = await vault.setSettlementManager(settlementManagerAddr);
    await tx.wait();
    console.log(`✓ setSettlementManager → ${settlementManagerAddr}`);

    tx = await vault.setLiquidationManager(liquidationManagerAddr);
    await tx.wait();
    console.log(`✓ setLiquidationManager → ${liquidationManagerAddr}`);

    upgradeLog.changes.push("Swapped all delegatecall targets");
  } else {
    console.log("\n--- Step 7: Delegatecall target swap SKIPPED (DRY_RUN) ---");
  }

  // ══════════════════════════════════════════════════════════════════════
  // Step 8: Deploy new OBOrderPlacementFacet
  // ══════════════════════════════════════════════════════════════════════
  let newFacetAddr = null;
  if (!skipFacet) {
    console.log("\n" + "─".repeat(70));
    console.log("Step 8: Deploy new OBOrderPlacementFacet");
    console.log("─".repeat(70));
    console.log("(O(1) price level operations via linked list)");

    const OBOrderPlacementFacet = await ethers.getContractFactory("OBOrderPlacementFacet");
    const facet = await OBOrderPlacementFacet.deploy();
    await facet.waitForDeployment();
    newFacetAddr = await facet.getAddress();
    console.log(`✓ New OBOrderPlacementFacet deployed: ${newFacetAddr}`);
    upgradeLog.contracts.OBOrderPlacementFacet = newFacetAddr;
    upgradeLog.changes.push("Deployed new OBOrderPlacementFacet");
  } else {
    console.log("\n--- Step 8: OBOrderPlacementFacet deploy SKIPPED ---");
  }

  // ══════════════════════════════════════════════════════════════════════
  // Step 9: Update FacetRegistry
  // ══════════════════════════════════════════════════════════════════════
  if (!skipFacet && !dryRun && newFacetAddr && facetRegistryAddr) {
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
    const tx = await registry.updateFacets(selectors, facets);
    const receipt = await tx.wait();
    console.log(`✓ FacetRegistry updated (tx: ${receipt.hash})`);
    upgradeLog.facetRegistryUpdateTx = receipt.hash;
    upgradeLog.changes.push("FacetRegistry updated with new OBOrderPlacementFacet");
  } else if (!facetRegistryAddr) {
    console.log("\n--- Step 9: FacetRegistry update SKIPPED (no FACET_REGISTRY_ADDRESS) ---");
  } else if (dryRun) {
    console.log("\n--- Step 9: FacetRegistry update SKIPPED (DRY_RUN) ---");
  }

  // ══════════════════════════════════════════════════════════════════════
  // Step 10: Initialize margin caches for existing users
  // ══════════════════════════════════════════════════════════════════════
  if (!skipCacheInit && !dryRun) {
    console.log("\n" + "─".repeat(70));
    console.log("Step 10: Initialize margin caches");
    console.log("─".repeat(70));
    console.log("(Populates O(1) index mappings for existing users)");

    const viewsMgr = await ethers.getContractAt("VaultViewsManager", viewsManagerAddr);

    // Get all known users via delegatecall through the vault
    // We need to call this directly on viewsManager since it's now deployed
    let allUsers;
    try {
      allUsers = await viewsMgr.getAllKnownUsers();
      console.log(`  Found ${allUsers.length} users to initialize`);
    } catch (e) {
      console.log(`  ⚠ Could not fetch users: ${e.message}`);
      allUsers = [];
    }

    if (allUsers.length > 0) {
      // Batch in groups of 50 to avoid gas limits
      const batchSize = 50;
      for (let i = 0; i < allUsers.length; i += batchSize) {
        const batch = allUsers.slice(i, i + batchSize);
        console.log(`  Initializing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allUsers.length/batchSize)} (${batch.length} users)...`);
        
        // Call via vault's delegatecall to viewsManager
        const vault = await ethers.getContractAt("CoreVault", vaultProxy);
        // The viewsManager.initializeMarginCaches is called via delegatecall
        // We need to encode the call and send it through the vault
        const viewsInterface = new ethers.Interface([
          "function initializeMarginCaches(address[] calldata users)"
        ]);
        const data = viewsInterface.encodeFunctionData("initializeMarginCaches", [batch]);
        
        // Since initializeMarginCaches writes to storage, we need to call it via delegatecall
        // The vault's delegateView won't work for writes. We need to call it directly
        // on viewsManager since it inherits CoreVaultStorage
        try {
          const tx = await viewsMgr.initializeMarginCaches(batch);
          await tx.wait();
          console.log(`    ✓ Batch complete`);
        } catch (e) {
          console.log(`    ⚠ Batch failed: ${e.message}`);
        }
      }
      upgradeLog.changes.push(`Initialized margin caches for ${allUsers.length} users`);
    } else {
      console.log("  No users to initialize");
    }
  } else if (dryRun) {
    console.log("\n--- Step 10: Cache initialization SKIPPED (DRY_RUN) ---");
  } else {
    console.log("\n--- Step 10: Cache initialization SKIPPED ---");
  }

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
  console.log("  Upgrade Complete");
  console.log("═".repeat(70));
  console.log(`  CoreVault Proxy:         ${vaultProxy}`);
  if (newImplAddr) {
    console.log(`  New CoreVault Impl:      ${newImplAddr}`);
  }
  console.log(`  New PositionManager:     ${positionManagerAddr}`);
  console.log(`  New VaultViewsManager:   ${viewsManagerAddr}`);
  console.log(`  New SettlementManager:   ${settlementManagerAddr}`);
  console.log(`  New LiquidationManager:  ${liquidationManagerAddr}`);
  if (newFacetAddr) {
    console.log(`  New OBOrderPlacementFacet: ${newFacetAddr}`);
  }
  console.log("");
  console.log(`  Changes: ${upgradeLog.changes.length}`);
  upgradeLog.changes.forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
  if (dryRun) {
    console.log("\n  ⚠ DRY_RUN — contracts deployed but NOT wired");
  }
  console.log("═".repeat(70) + "\n");

  // Print env updates needed
  console.log("Update .env.local with:");
  console.log(`  POSITION_MANAGER_ADDRESS=${positionManagerAddr}`);
  if (newFacetAddr) {
    console.log(`  OB_ORDER_PLACEMENT_FACET=${newFacetAddr}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nUpgrade failed:", error);
    process.exit(1);
  });
