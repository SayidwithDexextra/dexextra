#!/usr/bin/env node

// migrate-vault-state.js
//
// Reads a CoreVault snapshot JSON and replays all state into a freshly
// deployed CoreVault proxy via its migration functions.
//
// USAGE:
//   npx hardhat run scripts/migrate-vault-state.js --network hyperliquid
//   npx hardhat run scripts/migrate-vault-state.js --network localhost
//
// ENV / CLI ARGS:
//   --snapshot <path>       Path to snapshot JSON (or SNAPSHOT_PATH env)
//   NEW_VAULT_ADDRESS       Proxy address (or auto-read from deployments/)

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

// ── CLI helpers ──

function parseCliArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    })
  );
}

// ── Snapshot resolution ──

function resolveSnapshotPath() {
  const fromCli = parseCliArg("snapshot");
  if (fromCli) return path.resolve(fromCli);

  const fromEnv = process.env.SNAPSHOT_PATH;
  if (fromEnv) return path.resolve(fromEnv);

  const snapshotsDir = path.resolve(__dirname, "../snapshots");
  if (!fs.existsSync(snapshotsDir)) {
    throw new Error(`No snapshots directory found at ${snapshotsDir}`);
  }
  const files = fs
    .readdirSync(snapshotsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) {
    throw new Error("No snapshot files found in snapshots/");
  }
  return path.join(snapshotsDir, files[0]);
}

// ── Vault address resolution ──

function resolveVaultAddress(chainId) {
  const fromEnv = process.env.NEW_VAULT_ADDRESS;
  if (fromEnv) return fromEnv;

  const deployFile = path.resolve(
    __dirname,
    `../deployments/upgraded-vault-${chainId}.json`
  );
  if (fs.existsSync(deployFile)) {
    const deploy = JSON.parse(fs.readFileSync(deployFile, "utf8"));
    if (deploy.contracts?.CoreVaultProxy) return deploy.contracts.CoreVaultProxy;
  }

  throw new Error(
    "Cannot determine vault address. Set NEW_VAULT_ADDRESS or deploy first."
  );
}

// ── Tx helper with single retry ──

async function sendTx(label, txPromise) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const tx = await txPromise();
      const receipt = await tx.wait();
      return receipt;
    } catch (err) {
      if (attempt === 1) {
        console.log(`  ⚠ ${label} failed (attempt 1), retrying...`);
        console.log(`    Error: ${err.message?.slice(0, 120)}`);
      } else {
        console.error(`  ✗ ${label} FAILED after 2 attempts:`);
        console.error(`    ${err.message?.slice(0, 200)}`);
        return null;
      }
    }
  }
}

// ── Main ──

async function main() {
  console.log("\n════════════════════════════════════════════════");
  console.log("  CoreVault State Migration");
  console.log("════════════════════════════════════════════════\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`Network: chainId ${chainId}`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  // ── 1. Load snapshot ──
  const snapshotPath = resolveSnapshotPath();
  console.log(`\nSnapshot: ${snapshotPath}`);
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

  const { globalConfig, users, markets } = snapshot;
  console.log(
    `  ${users.length} users, ${markets.length} markets, ` +
      `${users.reduce((s, u) => s + u.positions.length, 0)} positions, ` +
      `${users.reduce((s, u) => s + u.pendingOrders.length, 0)} pending orders`
  );

  // ── 2. Attach to vault ──
  const vaultAddress = resolveVaultAddress(chainId);
  console.log(`\nVault proxy: ${vaultAddress}`);

  const vault = await ethers.getContractAt("CoreVault", vaultAddress);

  const isMigrated = await vault.migrationComplete();
  if (isMigrated) {
    throw new Error("Migration already completed on this vault!");
  }
  console.log("  Migration lock: OPEN ✓\n");

  // ── Counters for summary ──
  const stats = {
    globalConfig: false,
    usersOk: 0,
    usersFailed: 0,
    positionsOk: 0,
    positionsFailed: 0,
    pendingOrdersOk: 0,
    pendingOrdersFailed: 0,
    marketIdsOk: 0,
    marketIdsFailed: 0,
    marketsOk: 0,
    marketsFailed: 0,
    topUpNoncesOk: false,
    migrationCompleted: false,
  };

  // ── 3a. migrateGlobalConfig ──
  console.log("── Step 1/5: Global config ──");

  const ADL_MAX_CANDIDATES = 50;
  const ADL_MAX_POSITIONS_PER_TX = 10;
  const ADL_DEBUG = false;
  const MIN_SETTLEMENT_SCALE_RAY = ethers.parseUnits("5", 17); // 5e17

  const gcResult = await sendTx("migrateGlobalConfig", () =>
    vault.migrateGlobalConfig(
      globalConfig.baseMmrBps,
      globalConfig.penaltyMmrBps,
      globalConfig.maxMmrBps,
      globalConfig.scalingSlopeBps,
      globalConfig.priceGapSlopeBps,
      globalConfig.mmrLiquidityDepthLevels,
      ADL_MAX_CANDIDATES,
      ADL_MAX_POSITIONS_PER_TX,
      ADL_DEBUG,
      MIN_SETTLEMENT_SCALE_RAY,
      globalConfig.totalCollateralDeposited,
      globalConfig.totalMarginLocked
    )
  );
  stats.globalConfig = gcResult !== null;
  console.log(
    stats.globalConfig
      ? "  ✓ Global config migrated"
      : "  ✗ Global config migration FAILED"
  );

  // ── 3b. Migrate users in batches ──
  console.log(`\n── Step 2/5: Users (${users.length} total, batches of 10) ──`);

  const BATCH_SIZE = 10;
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, Math.min(i + BATCH_SIZE, users.length));
    const batchEnd = Math.min(i + BATCH_SIZE, users.length);
    console.log(
      `\n  Batch ${Math.floor(i / BATCH_SIZE) + 1}: users ${i + 1}–${batchEnd} / ${users.length}`
    );

    for (let j = 0; j < batch.length; j++) {
      const user = batch[j];
      const idx = i + j + 1;
      const shortAddr = `${user.address.slice(0, 6)}…${user.address.slice(-4)}`;
      process.stdout.write(`    [${idx}/${users.length}] ${shortAddr}: state`);

      // migrateUserState
      const stateResult = await sendTx(
        `migrateUserState(${shortAddr})`,
        () =>
          vault.migrateUserState(
            user.address,
            user.userCollateral,
            user.userCrossChainCredit,
            user.userRealizedPnL,
            user.userSocializedLoss
          )
      );
      if (stateResult) {
        stats.usersOk++;
      } else {
        stats.usersFailed++;
        process.stdout.write(" ✗\n");
        continue;
      }

      // migratePositions
      if (user.positions.length > 0) {
        process.stdout.write(`, ${user.positions.length} pos`);
        const posStructs = user.positions.map((p) => ({
          marketId: p.marketId,
          size: p.size,
          entryPrice: p.entryPrice,
          marginLocked: p.marginLocked,
          socializedLossAccrued6: p.socializedLossAccrued6,
          haircutUnits18: p.haircutUnits18,
          liquidationPrice: p.liquidationPrice,
        }));
        const posResult = await sendTx(
          `migratePositions(${shortAddr})`,
          () => vault.migratePositions(user.address, posStructs)
        );
        if (posResult) {
          stats.positionsOk += user.positions.length;
        } else {
          stats.positionsFailed += user.positions.length;
        }
      }

      // migratePendingOrders
      if (user.pendingOrders.length > 0) {
        process.stdout.write(`, ${user.pendingOrders.length} orders`);
        const orderStructs = user.pendingOrders.map((o) => ({
          orderId: o.orderId,
          marginReserved: o.marginReserved,
          timestamp: o.timestamp,
        }));
        const ordResult = await sendTx(
          `migratePendingOrders(${shortAddr})`,
          () => vault.migratePendingOrders(user.address, orderStructs)
        );
        if (ordResult) {
          stats.pendingOrdersOk += user.pendingOrders.length;
        } else {
          stats.pendingOrdersFailed += user.pendingOrders.length;
        }
      }

      // migrateUserMarketIds
      if (user.marketIds && user.marketIds.length > 0) {
        process.stdout.write(`, ${user.marketIds.length} mkts`);
        const mktResult = await sendTx(
          `migrateUserMarketIds(${shortAddr})`,
          () => vault.migrateUserMarketIds(user.address, user.marketIds)
        );
        if (mktResult) {
          stats.marketIdsOk += user.marketIds.length;
        } else {
          stats.marketIdsFailed += user.marketIds.length;
        }
      }

      process.stdout.write(" ✓\n");
    }
  }

  // ── 3c. Migrate markets ──
  console.log(`\n── Step 3/5: Markets (${markets.length}) ──`);
  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const label = m.symbol || `${m.marketId.slice(0, 10)}…`;
    process.stdout.write(
      `  [${i + 1}/${markets.length}] ${label}: `
    );

    const mResult = await sendTx(`migrateMarketConfig(${label})`, () =>
      vault.migrateMarketConfig(
        m.marketId,
        m.orderBook,
        m.markPrice,
        m.settled,
        m.disputed,
        m.badDebt
      )
    );
    if (mResult) {
      stats.marketsOk++;
      process.stdout.write("✓\n");
    } else {
      stats.marketsFailed++;
      process.stdout.write("✗\n");
    }
  }

  // ── 3d. migrateTopUpNonces (batch) ──
  console.log("\n── Step 4/5: Top-up nonces ──");
  const nonceUsers = users.filter(
    (u) => u.topUpNonce && u.topUpNonce !== "0"
  );
  if (nonceUsers.length > 0) {
    const addresses = nonceUsers.map((u) => u.address);
    const nonces = nonceUsers.map((u) => u.topUpNonce);
    const nResult = await sendTx("migrateTopUpNonces", () =>
      vault.migrateTopUpNonces(addresses, nonces)
    );
    stats.topUpNoncesOk = nResult !== null;
    console.log(
      stats.topUpNoncesOk
        ? `  ✓ ${nonceUsers.length} nonces migrated`
        : `  ✗ Top-up nonces migration FAILED`
    );
  } else {
    stats.topUpNoncesOk = true;
    console.log("  – No non-zero nonces to migrate");
  }

  // ── 3e. completeMigration ──
  console.log("\n── Step 5/5: Complete migration ──");

  const failures =
    stats.usersFailed +
    stats.positionsFailed +
    stats.pendingOrdersFailed +
    stats.marketIdsFailed +
    stats.marketsFailed;

  if (failures > 0) {
    console.log(
      `  ⚠ There were ${failures} failed operation(s). Review before completing.`
    );
  }

  const answer = await askConfirmation(
    "  Complete migration and lock the vault? (yes/no): "
  );
  if (answer === "yes" || answer === "y") {
    const cmResult = await sendTx("completeMigration", () =>
      vault.completeMigration()
    );
    stats.migrationCompleted = cmResult !== null;
    console.log(
      stats.migrationCompleted
        ? "  ✓ Migration completed — vault is now LOCKED"
        : "  ✗ completeMigration FAILED"
    );
  } else {
    console.log("  – Skipped. Run completeMigration() manually when ready.");
  }

  // ── Summary ──
  console.log("\n════════════════════════════════════════════════");
  console.log("  Migration Summary");
  console.log("════════════════════════════════════════════════");
  console.log(`  Global config:    ${stats.globalConfig ? "✓" : "✗"}`);
  console.log(
    `  Users:            ${stats.usersOk} ok / ${stats.usersFailed} failed`
  );
  console.log(
    `  Positions:        ${stats.positionsOk} ok / ${stats.positionsFailed} failed`
  );
  console.log(
    `  Pending orders:   ${stats.pendingOrdersOk} ok / ${stats.pendingOrdersFailed} failed`
  );
  console.log(
    `  User market IDs:  ${stats.marketIdsOk} ok / ${stats.marketIdsFailed} failed`
  );
  console.log(
    `  Markets:          ${stats.marketsOk} ok / ${stats.marketsFailed} failed`
  );
  console.log(`  Top-up nonces:    ${stats.topUpNoncesOk ? "✓" : "✗"}`);
  console.log(
    `  Migration locked: ${stats.migrationCompleted ? "YES" : "NO"}`
  );
  console.log("════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nMigration failed:", error);
    process.exit(1);
  });
