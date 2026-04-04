#!/usr/bin/env node

// upgrade-settlement-and-vault.js
//
// Upgrades the SettlementManager (hot-swap via setSettlementManager) and
// optionally the CoreVault implementation (UUPS upgradeToAndCall).
//
// Both operations are fully state-preserving:
//   - SettlementManager is stateless, called via delegatecall from CoreVault
//   - CoreVault is behind a UUPS proxy; storage layout is unchanged
//
// Reads all contract addresses from .env.local:
//   CORE_VAULT_ADDRESS         — CoreVault proxy
//   MOCK_USDC_ADDRESS          — collateral token (CoreVault constructor arg)
//   POSITION_MANAGER_ADDRESS   — PositionManager library
//   VAULT_ANALYTICS_ADDRESS    — VaultAnalytics library
//
// Optional ENV overrides:
//   SKIP_VAULT_UPGRADE=1       — skip the CoreVault UUPS upgrade (only swap SettlementManager)
//   SKIP_SETTLEMENT_UPGRADE=1  — skip the SettlementManager swap
//   DRY_RUN=1                  — deploy contracts but don't wire them (for verification)
//
// USAGE:
//   npx hardhat run scripts/upgrade-settlement-and-vault.js --network hyperliquid

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val.split("#")[0].split(" ")[0].trim(); // strip inline comments
}

async function main() {
  console.log("\n=============================================");
  console.log("  Settlement & Vault Upgrade (State-Safe)");
  console.log("=============================================\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`Network: ${networkName} (chainId ${chainId})`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  // ── Read addresses from .env.local ────────────────────────────
  const vaultProxy         = requireEnv("CORE_VAULT_ADDRESS");
  const collateralToken    = requireEnv("MOCK_USDC_ADDRESS");
  const positionManagerAddr = requireEnv("POSITION_MANAGER_ADDRESS");
  const vaultAnalyticsAddr = requireEnv("VAULT_ANALYTICS_ADDRESS");

  console.log("Contract addresses (from .env.local):");
  console.log(`  CoreVault proxy:    ${vaultProxy}`);
  console.log(`  Collateral token:   ${collateralToken}`);
  console.log(`  PositionManager:    ${positionManagerAddr}`);
  console.log(`  VaultAnalytics:     ${vaultAnalyticsAddr}`);

  const skipSettlement = !!process.env.SKIP_SETTLEMENT_UPGRADE;
  const skipVault = !!process.env.SKIP_VAULT_UPGRADE;
  const dryRun = !!process.env.DRY_RUN;

  if (dryRun) console.log("\n  ⚠ DRY_RUN mode — will deploy but NOT wire\n");

  const upgradeLog = {
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: networkName,
    chainId,
    vaultProxy,
    changes: [],
  };

  // ── Step 1: Upgrade SettlementManager ─────────────────────────
  if (!skipSettlement) {
    console.log("\n--- Step 1: Deploy new SettlementManager ---");
    console.log("(Stateless delegatecall target — swap preserves all state)");

    const SettlementManager = await ethers.getContractFactory("SettlementManager", {
      libraries: { PositionManager: positionManagerAddr },
    });
    const sm = await SettlementManager.deploy();
    await sm.waitForDeployment();
    const newSmAddr = await sm.getAddress();
    console.log(`New SettlementManager deployed: ${newSmAddr}`);
    upgradeLog.newSettlementManager = newSmAddr;

    if (!dryRun) {
      console.log("Calling setSettlementManager on CoreVault proxy...");
      const vault = await ethers.getContractAt("CoreVault", vaultProxy);
      const tx = await vault.setSettlementManager(newSmAddr);
      const receipt = await tx.wait();
      console.log(`setSettlementManager ✓  (tx: ${receipt.hash})`);
      upgradeLog.setSettlementManagerTx = receipt.hash;
      upgradeLog.changes.push("SettlementManager swapped");
    } else {
      console.log("[DRY_RUN] Skipping setSettlementManager call");
    }
  } else {
    console.log("\n--- Step 1: SettlementManager upgrade SKIPPED ---");
  }

  // ── Step 2: UUPS upgrade CoreVault implementation ─────────────
  if (!skipVault) {
    console.log("\n--- Step 2: Deploy new CoreVault implementation ---");
    console.log("(UUPS proxy upgrade — storage layout unchanged, all state preserved)");

    const CoreVaultImpl = await ethers.getContractFactory("CoreVault", {
      libraries: { PositionManager: positionManagerAddr },
    });
    const newImpl = await CoreVaultImpl.deploy(collateralToken);
    await newImpl.waitForDeployment();
    const newImplAddr = await newImpl.getAddress();
    console.log(`New CoreVault implementation deployed: ${newImplAddr}`);
    upgradeLog.newCoreVaultImpl = newImplAddr;

    if (!dryRun) {
      console.log("Calling upgradeToAndCall on CoreVault proxy...");
      const vault = await ethers.getContractAt("CoreVault", vaultProxy);
      const tx = await vault.upgradeToAndCall(newImplAddr, "0x");
      const receipt = await tx.wait();
      console.log(`upgradeToAndCall ✓  (tx: ${receipt.hash})`);
      upgradeLog.upgradeToAndCallTx = receipt.hash;
      upgradeLog.changes.push("CoreVault implementation upgraded (UUPS)");
    } else {
      console.log("[DRY_RUN] Skipping upgradeToAndCall");
    }
  } else {
    console.log("\n--- Step 2: CoreVault UUPS upgrade SKIPPED ---");
  }

  // ── Save upgrade record ───────────────────────────────────────
  console.log("\n--- Saving upgrade record ---");

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const outFile = path.join(
    deploymentsDir,
    `upgrade-settlement-${chainId}-${Date.now()}.json`
  );
  fs.writeFileSync(outFile, JSON.stringify(upgradeLog, null, 2));
  console.log(`Saved: ${outFile}`);

  // ── Summary ───────────────────────────────────────────────────
  console.log("\n=============================================");
  console.log("  Upgrade Complete");
  console.log("=============================================");
  console.log(`  CoreVault Proxy:         ${vaultProxy}`);
  if (upgradeLog.newSettlementManager) {
    console.log(`  New SettlementManager:   ${upgradeLog.newSettlementManager}`);
  }
  if (upgradeLog.newCoreVaultImpl) {
    console.log(`  New CoreVault Impl:      ${upgradeLog.newCoreVaultImpl}`);
  }
  console.log(`  Changes: ${upgradeLog.changes.join(", ") || "none (dry run)"}`);
  if (dryRun) {
    console.log("  ⚠ DRY_RUN — contracts deployed but NOT wired");
  }
  console.log("=============================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nUpgrade failed:", error);
    process.exit(1);
  });
