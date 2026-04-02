#!/usr/bin/env node

// repoint-orderbooks.js
//
// Re-points OrderBook diamond contracts from the old CoreVault to the new
// CoreVault proxy, and grants ORDERBOOK_ROLE + SETTLEMENT_ROLE on the new vault.
//
// USAGE:
//   npx hardhat run scripts/repoint-orderbooks.js --network hyperliquid
//   npx hardhat run scripts/repoint-orderbooks.js --network hyperliquid --start-from "DASH-USD-R9"
//
// The --start-from flag matches a substring of the market symbol. All markets
// from that match onward will be processed (useful for resuming after a failure).

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

function parseCliArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

function resolveSnapshotPath() {
  const fromCli = parseCliArg("snapshot");
  if (fromCli) return path.resolve(fromCli);
  const fromEnv = process.env.SNAPSHOT_PATH;
  if (fromEnv) return path.resolve(fromEnv);
  const snapshotsDir = path.resolve(__dirname, "../snapshots");
  const files = fs.readdirSync(snapshotsDir).filter(f => f.endsWith(".json")).sort().reverse();
  if (!files.length) throw new Error("No snapshot files found");
  return path.join(snapshotsDir, files[0]);
}

function resolveVaultAddress(chainId) {
  const fromEnv = process.env.NEW_VAULT_ADDRESS;
  if (fromEnv) return fromEnv;
  const deployFile = path.resolve(__dirname, `../deployments/upgraded-vault-${chainId}.json`);
  if (fs.existsSync(deployFile)) {
    const deploy = JSON.parse(fs.readFileSync(deployFile, "utf8"));
    if (deploy.contracts?.CoreVaultProxy) return deploy.contracts.CoreVaultProxy;
  }
  throw new Error("Cannot determine vault address.");
}

process.on("uncaughtException", (err) => {
  if (err.code === "UND_ERR_HEADERS_TIMEOUT" || err.message?.includes("Headers Timeout")) {
    console.log("\n⚠ RPC timeout — rerun the script to continue (already-done markets are skipped)\n");
    process.exit(2);
  }
  throw err;
});

async function main() {
  console.log("\n════════════════════════════════════════════════");
  console.log("  OrderBook Repoint — setVault + Role Grants");
  console.log("════════════════════════════════════════════════\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const [deployer] = await ethers.getSigners();
  console.log(`Network: chainId ${chainId}`);
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  const snapshotPath = resolveSnapshotPath();
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  console.log(`Snapshot: ${path.basename(snapshotPath)}`);

  const newVaultAddress = resolveVaultAddress(chainId);
  console.log(`New vault: ${newVaultAddress}\n`);

  // Build market list with unique OrderBook addresses (skip duplicates)
  const seen = new Set();
  const markets = snapshot.markets
    .filter(m => {
      if (!m.orderBook || m.orderBook === ethers.ZeroAddress) return false;
      if (seen.has(m.orderBook.toLowerCase())) return false;
      seen.add(m.orderBook.toLowerCase());
      return true;
    })
    .map(m => ({ symbol: m.symbol, orderBook: m.orderBook, settled: m.settled }));

  console.log(`${markets.length} unique OrderBooks from ${snapshot.markets.length} markets\n`);

  // FILTER env: only process markets whose symbol matches this substring
  const filter = parseCliArg("filter") || process.env.FILTER;
  if (filter) {
    const needle = filter.toLowerCase();
    const before = markets.length;
    const filtered = markets.filter(m => m.symbol && m.symbol.toLowerCase().includes(needle));
    if (!filtered.length) {
      console.log(`⚠ No markets matching "${filter}". Available:`);
      markets.forEach((m, i) => console.log(`  [${i}] ${m.symbol || m.orderBook.slice(0, 12)}`));
      return;
    }
    markets.length = 0;
    markets.push(...filtered);
    console.log(`Filter "${filter}": ${markets.length} matches (of ${before} total)\n`);
  }

  const startFrom = parseCliArg("start-from") || process.env.START_FROM;
  let startIdx = 0;
  if (startFrom) {
    const needle = startFrom.toLowerCase();
    startIdx = markets.findIndex(m => m.symbol && m.symbol.toLowerCase().includes(needle));
    if (startIdx === -1) {
      console.log(`⚠ No market matching "${startFrom}" found.`);
      markets.forEach((m, i) => console.log(`  [${i}] ${m.symbol || m.orderBook.slice(0, 12)}`));
      return;
    }
    console.log(`Starting from [${startIdx}] ${markets[startIdx].symbol} (matched "${startFrom}")`);
    console.log(`  Skipping ${startIdx} markets before it\n`);
  }

  const vault = await ethers.getContractAt("CoreVault", newVaultAddress);
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));

  console.log("── Processing OrderBooks ──\n");

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function sendTx(fn, label, retries = 4) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const tx = await fn();
        await tx.wait();
        return true;
      } catch (err) {
        const msg = err.message || "";
        if ((msg.includes("underpriced") || msg.includes("nonce")) && attempt < retries) {
          console.log(`    ⟳ ${label} retry ${attempt}/${retries} (waiting 5s…)`);
          await sleep(5000);
        } else {
          console.log(`  ✗ ${label} FAILED: ${msg.slice(0, 120)}`);
          return false;
        }
      }
    }
    return false;
  }

  const results = { ok: 0, skipped: 0, failed: 0 };
  const toProcess = markets.slice(startIdx);

  for (let i = 0; i < toProcess.length; i++) {
    const { symbol, orderBook: obAddress, settled } = toProcess[i];
    const globalIdx = startIdx + i;
    const tag = settled ? " [settled]" : "";
    const label = symbol || obAddress.slice(0, 12);
    console.log(`[${globalIdx + 1}/${markets.length}] ${label}${tag}`);
    console.log(`  OB: ${obAddress}`);

    const ob = new ethers.Contract(
      obAddress,
      ["function setVault(address newVault) external", "function vault() view returns (address)"],
      deployer
    );

    // Check if already fully repointed
    let needsSetVault = true;
    try {
      const currentVault = await ob.vault();
      if (currentVault.toLowerCase() === newVaultAddress.toLowerCase()) {
        const hasOB = await vault.hasRole(ORDERBOOK_ROLE, obAddress);
        const hasSR = await vault.hasRole(SETTLEMENT_ROLE, obAddress);
        if (hasOB && hasSR) {
          console.log(`  ⏭ Already done — skipping`);
          results.skipped++;
          console.log("");
          continue;
        }
        console.log(`  ⏭ setVault already done, granting roles…`);
        needsSetVault = false;
      }
    } catch (_) {}

    if (needsSetVault) {
      const ok = await sendTx(() => ob.setVault(newVaultAddress), "setVault");
      if (!ok) { results.failed++; console.log(""); continue; }
      console.log(`  ✓ setVault`);
      await sleep(1000);
    }

    // Grant ORDERBOOK_ROLE
    const hasOB = await vault.hasRole(ORDERBOOK_ROLE, obAddress);
    if (!hasOB) {
      if (await sendTx(() => vault.grantRole(ORDERBOOK_ROLE, obAddress), "ORDERBOOK_ROLE"))
        console.log(`  ✓ ORDERBOOK_ROLE`);
      await sleep(1000);
    } else {
      console.log(`  ⏭ ORDERBOOK_ROLE already granted`);
    }

    // Grant SETTLEMENT_ROLE
    const hasSR = await vault.hasRole(SETTLEMENT_ROLE, obAddress);
    if (!hasSR) {
      if (await sendTx(() => vault.grantRole(SETTLEMENT_ROLE, obAddress), "SETTLEMENT_ROLE"))
        console.log(`  ✓ SETTLEMENT_ROLE`);
      await sleep(1000);
    } else {
      console.log(`  ⏭ SETTLEMENT_ROLE already granted`);
    }

    results.ok++;
    console.log("");
  }

  console.log("════════════════════════════════════════════════");
  console.log("  Repoint Summary");
  console.log("════════════════════════════════════════════════");
  console.log(`  Processed: ${results.ok + results.skipped + results.failed}`);
  console.log(`  OK:        ${results.ok}`);
  console.log(`  Skipped:   ${results.skipped} (already repointed)`);
  console.log(`  Failed:    ${results.failed}`);
  console.log(`  New vault: ${newVaultAddress}`);
  console.log("════════════════════════════════════════════════\n");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
