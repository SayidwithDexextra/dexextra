#!/usr/bin/env node

// migrate-parallel.js
//
// Parallelizes vault state migration across multiple relayer wallets.
// Each relayer handles a slice of users and markets concurrently.
//
// USAGE:
//   npx hardhat run scripts/migrate-parallel.js --network hyperliquid

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

async function main() {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log("\n════════════════════════════════════════════════");
  console.log("  Parallel Vault State Migration");
  console.log("════════════════════════════════════════════════\n");

  // Load deployment
  const deployFile = path.join(__dirname, `../deployments/upgraded-vault-${chainId}.json`);
  if (!fs.existsSync(deployFile)) throw new Error(`No deployment: ${deployFile}`);
  const deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  const vaultAddr = deployment.contracts.CoreVaultProxy;
  console.log(`Vault: ${vaultAddr}`);

  // Load snapshot
  const snapshotsDir = path.resolve(__dirname, "../snapshots");
  const snapFiles = fs.readdirSync(snapshotsDir).filter(f => f.endsWith(".json")).sort().reverse();
  if (!snapFiles.length) throw new Error("No snapshot files found");
  const snapPath = path.join(snapshotsDir, snapFiles[0]);
  const snapshot = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  console.log(`Snapshot: ${snapFiles[0]}`);
  console.log(`  ${snapshot.users.length} users, ${snapshot.markets.length} markets\n`);

  // Load relayers
  const relayersFile = path.resolve(__dirname, "../../relayers.generated.json");
  const relayers = JSON.parse(fs.readFileSync(relayersFile, "utf8"));
  console.log(`Relayers: ${relayers.length}\n`);

  // Create wallet signers connected to the provider
  const provider = ethers.provider;
  const wallets = relayers.map(r => new ethers.Wallet(r.privateKey, provider));

  // Check all have DEFAULT_ADMIN_ROLE
  const vaultCheck = await ethers.getContractAt("CoreVault", vaultAddr);
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  for (const w of wallets) {
    const has = await vaultCheck.hasRole(DEFAULT_ADMIN_ROLE, w.address);
    if (!has) throw new Error(`${w.address} missing DEFAULT_ADMIN_ROLE — run grant-relayer-roles.js first`);
  }
  console.log("✓ All relayers have admin role\n");

  // Check migration not already locked
  try {
    const done = await vaultCheck.migrationComplete();
    if (done) { console.log("⚠ Migration already completed!"); return; }
  } catch (_) {}

  const { globalConfig, users, markets } = snapshot;

  // Step 1: Global config (only if not already set — use first wallet)
  console.log("── Step 1: Global config ──");
  try {
    const currentBase = await vaultCheck.baseMmrBps();
    if (currentBase.toString() === globalConfig.baseMmrBps) {
      console.log("  Already migrated — skipping\n");
    } else {
      const v0 = vaultCheck.connect(wallets[0]);
      const tx = await v0.migrateGlobalConfig(
        globalConfig.baseMmrBps, globalConfig.penaltyMmrBps, globalConfig.maxMmrBps,
        globalConfig.scalingSlopeBps, globalConfig.priceGapSlopeBps, globalConfig.mmrLiquidityDepthLevels,
        50, 10, false, ethers.parseUnits("5", 17),
        globalConfig.totalCollateralDeposited, globalConfig.totalMarginLocked
      );
      await tx.wait();
      console.log("  ✓ Global config migrated\n");
    }
  } catch (err) {
    console.log(`  ✗ Global config failed: ${err.message?.slice(0, 80)}\n`);
  }

  // Step 2: Migrate users in parallel across relayers
  console.log(`── Step 2: Users (${users.length}) across ${wallets.length} relayers ──`);

  const migrateUser = async (wallet, u, idx) => {
    const vault = vaultCheck.connect(wallet);
    const label = `${u.address.slice(0, 6)}…${u.address.slice(-4)}`;
    try {
      // Check if already migrated
      const existing = await vaultCheck.userCollateral(u.address);
      if (existing.toString() !== "0" && existing.toString() === u.userCollateral) {
        return { idx, ok: true, skipped: true };
      }

      // User state
      let tx = await vault.migrateUserState(
        u.address, u.userCollateral, u.userCrossChainCredit,
        u.userRealizedPnL, u.userSocializedLoss
      );
      await tx.wait();

      // Positions
      if (u.positions.length > 0) {
        const posStructs = u.positions.map(p => ({
          marketId: p.marketId, size: p.size, entryPrice: p.entryPrice,
          marginLocked: p.marginLocked, socializedLossAccrued6: p.socializedLossAccrued6,
          haircutUnits18: p.haircutUnits18, liquidationPrice: p.liquidationPrice,
        }));
        tx = await vault.migratePositions(u.address, posStructs);
        await tx.wait();
      }

      // Pending orders
      if (u.pendingOrders.length > 0) {
        const orderStructs = u.pendingOrders.map(o => ({
          orderId: o.orderId, marginReserved: o.marginReserved, timestamp: o.timestamp,
        }));
        tx = await vault.migratePendingOrders(u.address, orderStructs);
        await tx.wait();
      }

      // Market IDs
      if (u.marketIds && u.marketIds.length > 0) {
        tx = await vault.migrateUserMarketIds(u.address, u.marketIds);
        await tx.wait();
      }

      return { idx, ok: true, skipped: false };
    } catch (err) {
      console.log(`  ✗ [${idx + 1}] ${label}: ${err.message?.slice(0, 80)}`);
      return { idx, ok: false, skipped: false };
    }
  };

  // Dispatch users round-robin across relayers, running all relayers concurrently
  let userOk = 0, userFail = 0, userSkipped = 0;
  const CONCURRENCY = wallets.length;

  for (let batch = 0; batch < users.length; batch += CONCURRENCY) {
    const chunk = users.slice(batch, batch + CONCURRENCY);
    const promises = chunk.map((u, i) => {
      const walletIdx = i % wallets.length;
      return migrateUser(wallets[walletIdx], u, batch + i);
    });
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.skipped) { userSkipped++; userOk++; }
      else if (r.ok) userOk++;
      else userFail++;
    }
    const done = Math.min(batch + CONCURRENCY, users.length);
    console.log(`  [${done}/${users.length}] ${userOk} ok (${userSkipped} skipped), ${userFail} failed`);
  }

  // Step 3: Migrate markets in parallel
  console.log(`\n── Step 3: Markets (${markets.length}) across ${wallets.length} relayers ──`);

  const migrateMarket = async (wallet, m) => {
    const vault = vaultCheck.connect(wallet);
    try {
      // Check if already migrated
      const existingOB = await vaultCheck.marketToOrderBook(m.marketId);
      if (existingOB.toLowerCase() === m.orderBook.toLowerCase()) {
        return { ok: true, skipped: true };
      }

      const tx = await vault.migrateMarketConfig(
        m.marketId, m.orderBook, m.markPrice, m.settled, m.disputed, m.badDebt
      );
      await tx.wait();
      return { ok: true, skipped: false };
    } catch (err) {
      console.log(`  ✗ ${m.symbol || m.marketId.slice(0, 10)}: ${err.message?.slice(0, 80)}`);
      return { ok: false, skipped: false };
    }
  };

  let mktOk = 0, mktFail = 0, mktSkipped = 0;
  for (let batch = 0; batch < markets.length; batch += CONCURRENCY) {
    const chunk = markets.slice(batch, batch + CONCURRENCY);
    const promises = chunk.map((m, i) => {
      const walletIdx = i % wallets.length;
      return migrateMarket(wallets[walletIdx], m);
    });
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.skipped) { mktSkipped++; mktOk++; }
      else if (r.ok) mktOk++;
      else mktFail++;
    }
    const done = Math.min(batch + CONCURRENCY, markets.length);
    console.log(`  [${done}/${markets.length}] ${mktOk} ok (${mktSkipped} skipped), ${mktFail} failed`);
  }

  // Step 4: Top-up nonces
  const nonceUsers = users.filter(u => u.topUpNonce && u.topUpNonce !== "0");
  if (nonceUsers.length > 0) {
    console.log(`\n── Step 4: Top-up nonces (${nonceUsers.length}) ──`);
    try {
      const v0 = vaultCheck.connect(wallets[0]);
      const tx = await v0.migrateTopUpNonces(
        nonceUsers.map(u => u.address), nonceUsers.map(u => u.topUpNonce)
      );
      await tx.wait();
      console.log("  ✓ Nonces migrated");
    } catch (err) {
      console.log(`  ✗ Nonces failed: ${err.message?.slice(0, 80)}`);
    }
  }

  // Summary
  const totalFail = userFail + mktFail;
  console.log("\n════════════════════════════════════════════════");
  console.log("  Migration Summary");
  console.log("════════════════════════════════════════════════");
  console.log(`  Users:   ${userOk} ok (${userSkipped} skipped), ${userFail} failed`);
  console.log(`  Markets: ${mktOk} ok (${mktSkipped} skipped), ${mktFail} failed`);
  console.log(`  Status:  ${totalFail === 0 ? "✅ ALL PASSED" : "⚠ SOME FAILURES"}`);
  console.log(`\n  Vault NOT locked — run completeMigration() when ready.`);
  console.log("════════════════════════════════════════════════\n");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
