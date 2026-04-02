#!/usr/bin/env node

// verify-migration.js
//
// Compares on-chain state of the new CoreVault proxy against the original
// snapshot to confirm the migration was successful.
//
// USAGE:
//   npx hardhat run scripts/verify-migration.js --network hyperliquid
//   npx hardhat run scripts/verify-migration.js --network localhost
//
// ENV / CLI ARGS:
//   --snapshot <path>       Path to snapshot JSON (or SNAPSHOT_PATH env)
//   NEW_VAULT_ADDRESS       Proxy address (or auto-read from deployments/)

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

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

// ── Multicall3 batching ──

const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])",
];

async function multicall(provider, calls) {
  const mc = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  try {
    return await mc.aggregate3.staticCall(calls);
  } catch (_) {
    // Multicall3 not available — fall back to individual calls
    return null;
  }
}

// Batch calls through Multicall3, falling back to sequential if unavailable.
// `items` is an array of { target, callData, decode(bytes) }.
async function batchRead(provider, items, batchSize = 100) {
  const results = new Array(items.length);

  // Try multicall first
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, Math.min(i + batchSize, items.length));
    const mcCalls = slice.map((it) => ({
      target: it.target,
      allowFailure: true,
      callData: it.callData,
    }));

    const mcResult = await multicall(provider, mcCalls);
    if (mcResult) {
      for (let j = 0; j < slice.length; j++) {
        if (mcResult[j].success) {
          results[i + j] = slice[j].decode(mcResult[j].returnData);
        } else {
          results[i + j] = null;
        }
      }
    } else {
      // Fallback: sequential reads
      for (let j = 0; j < slice.length; j++) {
        try {
          const raw = await provider.call({
            to: slice[j].target,
            data: slice[j].callData,
          });
          results[i + j] = slice[j].decode(raw);
        } catch (_) {
          results[i + j] = null;
        }
      }
    }
  }
  return results;
}

// ── Comparison helpers ──

function eq(a, b) {
  return String(a) === String(b);
}

function fmtMismatch(field, expected, actual) {
  return `    ${field}: expected ${expected}, got ${actual}`;
}

// ── Main ──

async function main() {
  console.log("\n════════════════════════════════════════════════");
  console.log("  CoreVault Migration Verification");
  console.log("════════════════════════════════════════════════\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`Network: chainId ${chainId}`);

  // ── 1. Load snapshot & vault ──
  const snapshotPath = resolveSnapshotPath();
  console.log(`Snapshot: ${snapshotPath}`);
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

  const { globalConfig, users, markets, registeredOrderBooks } = snapshot;
  console.log(
    `  ${users.length} users, ${markets.length} markets, ` +
      `${registeredOrderBooks.length} registered orderbooks`
  );

  const vaultAddress = resolveVaultAddress(chainId);
  console.log(`Vault proxy: ${vaultAddress}\n`);

  const vault = await ethers.getContractAt("CoreVault", vaultAddress);
  const iface = vault.interface;
  const provider = ethers.provider;

  // ── Accumulators ──
  const mismatches = [];
  const report = {
    globalPass: true,
    usersPass: 0,
    usersFail: 0,
    marketsPass: 0,
    marketsFail: 0,
    orderbooksPass: 0,
    orderbooksFail: 0,
  };

  // ════════════════════════════════════════════════════════════════════
  // 2. GLOBAL CONFIG
  // ════════════════════════════════════════════════════════════════════
  console.log("── Global Config ──");

  const globalFields = [
    { fn: "baseMmrBps", snap: globalConfig.baseMmrBps },
    { fn: "penaltyMmrBps", snap: globalConfig.penaltyMmrBps },
    { fn: "maxMmrBps", snap: globalConfig.maxMmrBps },
    { fn: "totalCollateralDeposited", snap: globalConfig.totalCollateralDeposited },
    { fn: "totalMarginLocked", snap: globalConfig.totalMarginLocked },
  ];

  const globalItems = globalFields.map((f) => ({
    target: vaultAddress,
    callData: iface.encodeFunctionData(f.fn),
    decode: (data) => iface.decodeFunctionResult(f.fn, data)[0],
  }));

  const globalResults = await batchRead(provider, globalItems);

  for (let i = 0; i < globalFields.length; i++) {
    const { fn, snap } = globalFields[i];
    const actual = globalResults[i];
    if (actual === null || !eq(snap, actual)) {
      report.globalPass = false;
      mismatches.push(
        fmtMismatch(`globalConfig.${fn}`, snap, actual ?? "CALL_FAILED")
      );
    }
  }
  console.log(`  Result: ${report.globalPass ? "PASS" : "FAIL"}`);

  // ════════════════════════════════════════════════════════════════════
  // 3. USERS
  // ════════════════════════════════════════════════════════════════════
  console.log(`\n── Users (${users.length}) ──`);

  // Build batched calls for all user scalar fields
  const userScalarFns = [
    "userCollateral",
    "userCrossChainCredit",
    "userRealizedPnL",
    "userSocializedLoss",
    "topUpNonces",
  ];
  const userSnapFields = [
    "userCollateral",
    "userCrossChainCredit",
    "userRealizedPnL",
    "userSocializedLoss",
    "topUpNonce",
  ];

  const userScalarItems = [];
  for (const user of users) {
    for (const fn of userScalarFns) {
      userScalarItems.push({
        target: vaultAddress,
        callData: iface.encodeFunctionData(fn, [user.address]),
        decode: (data) => iface.decodeFunctionResult(fn, data)[0],
      });
    }
  }

  const userScalarResults = await batchRead(provider, userScalarItems);

  // Build batched calls for getUserPositions
  const positionItems = users.map((user) => ({
    target: vaultAddress,
    callData: iface.encodeFunctionData("getUserPositions", [user.address]),
    decode: (data) => iface.decodeFunctionResult("getUserPositions", data)[0],
  }));

  const positionResults = await batchRead(provider, positionItems);

  // Evaluate per-user
  for (let u = 0; u < users.length; u++) {
    const user = users[u];
    const shortAddr = `${user.address.slice(0, 6)}…${user.address.slice(-4)}`;
    let userOk = true;
    const userMismatches = [];

    // Scalar fields
    for (let f = 0; f < userScalarFns.length; f++) {
      const idx = u * userScalarFns.length + f;
      const fn = userScalarFns[f];
      const snapField = userSnapFields[f];
      const expected = user[snapField];
      const actual = userScalarResults[idx];

      if (actual === null || !eq(expected, actual)) {
        userOk = false;
        userMismatches.push(
          fmtMismatch(`${shortAddr}.${fn}`, expected, actual ?? "CALL_FAILED")
        );
      }
    }

    // Positions count
    const onChainPositions = positionResults[u];
    const expectedCount = user.positions.length;
    if (onChainPositions === null) {
      userOk = false;
      userMismatches.push(
        fmtMismatch(`${shortAddr}.positions.length`, expectedCount, "CALL_FAILED")
      );
    } else {
      const actualCount = onChainPositions.length;
      if (actualCount !== expectedCount) {
        userOk = false;
        userMismatches.push(
          fmtMismatch(`${shortAddr}.positions.length`, expectedCount, actualCount)
        );
      } else if (actualCount > 0) {
        // Spot-check first position
        const snapPos = user.positions[0];
        const chainPos = onChainPositions[0];
        if (!eq(snapPos.marketId, chainPos.marketId)) {
          userOk = false;
          userMismatches.push(
            fmtMismatch(
              `${shortAddr}.positions[0].marketId`,
              snapPos.marketId,
              chainPos.marketId
            )
          );
        }
        if (!eq(snapPos.size, chainPos.size)) {
          userOk = false;
          userMismatches.push(
            fmtMismatch(
              `${shortAddr}.positions[0].size`,
              snapPos.size,
              chainPos.size
            )
          );
        }
      }
    }

    if (userOk) {
      report.usersPass++;
    } else {
      report.usersFail++;
      mismatches.push(...userMismatches);
    }
  }

  const userProgress = `${report.usersPass} PASS, ${report.usersFail} FAIL`;
  console.log(`  Result: ${userProgress}`);

  // ════════════════════════════════════════════════════════════════════
  // 4. MARKETS
  // ════════════════════════════════════════════════════════════════════
  console.log(`\n── Markets (${markets.length}) ──`);

  const marketCheckFns = [
    { fn: "marketToOrderBook", snapField: "orderBook" },
    { fn: "marketMarkPrices", snapField: "markPrice" },
    { fn: "marketSettled", snapField: "settled" },
    { fn: "marketDisputed", snapField: "disputed" },
  ];

  const marketItems = [];
  for (const mkt of markets) {
    for (const { fn } of marketCheckFns) {
      marketItems.push({
        target: vaultAddress,
        callData: iface.encodeFunctionData(fn, [mkt.marketId]),
        decode: (data) => iface.decodeFunctionResult(fn, data)[0],
      });
    }
  }

  const marketResults = await batchRead(provider, marketItems);

  for (let m = 0; m < markets.length; m++) {
    const mkt = markets[m];
    const label = mkt.symbol || mkt.marketId.slice(0, 10);
    let marketOk = true;
    const mktMismatches = [];

    for (let f = 0; f < marketCheckFns.length; f++) {
      const idx = m * marketCheckFns.length + f;
      const { fn, snapField } = marketCheckFns[f];
      const expected = mkt[snapField];
      const actual = marketResults[idx];

      if (actual === null || !eq(expected, actual)) {
        marketOk = false;
        mktMismatches.push(
          fmtMismatch(`market[${label}].${fn}`, expected, actual ?? "CALL_FAILED")
        );
      }
    }

    if (marketOk) {
      report.marketsPass++;
    } else {
      report.marketsFail++;
      mismatches.push(...mktMismatches);
    }
  }

  const marketProgress = `${report.marketsPass} PASS, ${report.marketsFail} FAIL`;
  console.log(`  Result: ${marketProgress}`);

  // ════════════════════════════════════════════════════════════════════
  // 5. REGISTERED ORDERBOOKS
  // ════════════════════════════════════════════════════════════════════
  console.log(`\n── OrderBooks (${registeredOrderBooks.length}) ──`);

  const obItems = registeredOrderBooks.map((ob) => ({
    target: vaultAddress,
    callData: iface.encodeFunctionData("registeredOrderBooks", [ob.address]),
    decode: (data) =>
      iface.decodeFunctionResult("registeredOrderBooks", data)[0],
  }));

  const obResults = await batchRead(provider, obItems);

  for (let i = 0; i < registeredOrderBooks.length; i++) {
    const ob = registeredOrderBooks[i];
    const actual = obResults[i];

    if (actual === null || actual !== true) {
      report.orderbooksFail++;
      mismatches.push(
        fmtMismatch(
          `registeredOrderBooks[${ob.address.slice(0, 8)}…]`,
          true,
          actual ?? "CALL_FAILED"
        )
      );
    } else {
      report.orderbooksPass++;
    }
  }

  const obProgress = `${report.orderbooksPass} PASS, ${report.orderbooksFail} FAIL`;
  console.log(`  Result: ${obProgress}`);

  // ════════════════════════════════════════════════════════════════════
  // 6. FINAL REPORT
  // ════════════════════════════════════════════════════════════════════
  const totalFails =
    (report.globalPass ? 0 : 1) +
    report.usersFail +
    report.marketsFail +
    report.orderbooksFail;

  console.log("\n════════════════════════════════════════════════");
  console.log("  Verification Report");
  console.log("════════════════════════════════════════════════");
  console.log(`  Global config:  ${report.globalPass ? "PASS" : "FAIL"}`);
  console.log(
    `  Users (${users.length}):     ${report.usersPass} PASS, ${report.usersFail} FAIL`
  );
  console.log(
    `  Markets (${markets.length}):   ${report.marketsPass} PASS, ${report.marketsFail} FAIL`
  );
  console.log(
    `  OrderBooks (${registeredOrderBooks.length}): ${report.orderbooksPass} PASS, ${report.orderbooksFail} FAIL`
  );
  console.log("════════════════════════════════════════════════");

  if (mismatches.length > 0) {
    console.log(`\n  ${mismatches.length} MISMATCH(ES):\n`);
    for (const m of mismatches) {
      console.log(m);
    }
    console.log("");
  }

  if (totalFails === 0) {
    console.log("\n  ALL CHECKS PASSED — migration verified.\n");
  } else {
    console.log(`\n  ${totalFails} category/categories FAILED — review above.\n`);
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((error) => {
    console.error("\nVerification failed:", error);
    process.exit(1);
  });
