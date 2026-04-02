#!/usr/bin/env node

// test-vault-reads.js
//
// Tests all delegated view functions on the new CoreVault to verify
// they return data correctly via delegatecall + staticCall.

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

async function main() {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  const deployFile = path.join(__dirname, `../deployments/upgraded-vault-${chainId}.json`);
  const deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  const vaultAddr = deployment.contracts.CoreVaultProxy;

  const vault = await ethers.getContractAt("CoreVault", vaultAddr);

  console.log("\n════════════════════════════════════════════════");
  console.log("  CoreVault Read Function Tests");
  console.log("════════════════════════════════════════════════");
  console.log(`  Vault: ${vaultAddr}  (chainId ${chainId})\n`);

  const snapDir = path.resolve(__dirname, "../snapshots");
  const snapFiles = fs.readdirSync(snapDir).filter(f => f.endsWith(".json")).sort().reverse();
  const snapshot = JSON.parse(fs.readFileSync(path.join(snapDir, snapFiles[0]), "utf8"));

  // Pick users with positions for meaningful tests
  const usersWithPositions = snapshot.users.filter(u => u.positions.length > 0);
  const testUsers = usersWithPositions.slice(0, 5);
  console.log(`Testing ${testUsers.length} users with positions...\n`);

  let pass = 0, fail = 0;

  const test = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
    else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
  };

  // ── 1. Direct storage reads (true view functions) ──
  console.log("── 1. Storage reads (view) ──");
  for (const u of testUsers) {
    const label = `${u.address.slice(0, 8)}…`;
    try {
      const col = await vault.userCollateral(u.address);
      test(`userCollateral(${label})`, col.toString() === u.userCollateral, `${ethers.formatUnits(col, 6)} USDC`);
    } catch (e) { test(`userCollateral(${label})`, false, e.message?.slice(0, 60)); }

    try {
      const credit = await vault.userCrossChainCredit(u.address);
      test(`userCrossChainCredit(${label})`, credit.toString() === u.userCrossChainCredit, ethers.formatUnits(credit, 6));
    } catch (e) { test(`userCrossChainCredit(${label})`, false, e.message?.slice(0, 60)); }
  }

  // ── 2. getUserPositions (view) ──
  console.log("\n── 2. getUserPositions (view) ──");
  for (const u of testUsers) {
    const label = `${u.address.slice(0, 8)}…`;
    try {
      const positions = await vault.getUserPositions(u.address);
      test(`getUserPositions(${label})`, positions.length === u.positions.length,
        `${positions.length} positions`);
      if (positions.length > 0) {
        const p = positions[0];
        console.log(`      pos[0]: marketId=${p.marketId.toString().slice(0,10)}…, size=${ethers.formatUnits(p.size, 6)}, entry=${ethers.formatUnits(p.entryPrice, 6)}`);
      }
    } catch (e) { test(`getUserPositions(${label})`, false, e.message?.slice(0, 60)); }
  }

  // ── 3. getMarkPrice (view) ──
  console.log("\n── 3. getMarkPrice (view) ──");
  const activeMarkets = snapshot.markets.filter(m => !m.settled);
  for (const m of activeMarkets.slice(0, 5)) {
    const label = m.symbol || m.marketId.toString().slice(0, 10);
    try {
      const price = await vault.getMarkPrice(m.marketId);
      test(`getMarkPrice(${label})`, price.toString() === m.markPrice,
        `${ethers.formatUnits(price, 6)}`);
    } catch (e) { test(`getMarkPrice(${label})`, false, e.message?.slice(0, 60)); }
  }

  // ── 4. Delegated view functions (require staticCall) ──
  console.log("\n── 4. Delegated views via staticCall ──");

  for (const u of testUsers) {
    const label = `${u.address.slice(0, 8)}…`;

    // getAvailableCollateral
    try {
      const avail = await vault.getAvailableCollateral.staticCall(u.address);
      test(`getAvailableCollateral(${label})`, avail >= 0n, ethers.formatUnits(avail, 6));
    } catch (e) { test(`getAvailableCollateral(${label})`, false, e.message?.slice(0, 80)); }

    // getCollateralBreakdown
    try {
      const [col, credit, rpnl, socLoss] = await vault.getCollateralBreakdown.staticCall(u.address);
      const colMatch = col.toString() === u.userCollateral;
      const creditMatch = credit.toString() === u.userCrossChainCredit;
      test(`getCollateralBreakdown(${label})`, colMatch && creditMatch,
        `col=${ethers.formatUnits(col, 6)}, credit=${ethers.formatUnits(credit, 6)}`);
    } catch (e) { test(`getCollateralBreakdown(${label})`, false, e.message?.slice(0, 80)); }

    // getUnifiedMarginSummary
    try {
      const result = await vault.getUnifiedMarginSummary.staticCall(u.address);
      const [totalCol, totalMargin, freeMargin, pnl, marginUtil] = result;
      test(`getUnifiedMarginSummary(${label})`, totalCol >= 0n,
        `col=${ethers.formatUnits(totalCol, 6)}, margin=${ethers.formatUnits(totalMargin, 6)}, pnl=${ethers.formatUnits(pnl, 6)}`);
    } catch (e) { test(`getUnifiedMarginSummary(${label})`, false, e.message?.slice(0, 80)); }

    // getMarginUtilization
    try {
      const util = await vault.getMarginUtilization.staticCall(u.address);
      test(`getMarginUtilization(${label})`, true, `${util.toString()} bps`);
    } catch (e) { test(`getMarginUtilization(${label})`, false, e.message?.slice(0, 80)); }

    // getWithdrawableCollateral
    try {
      const withdrawable = await vault.getWithdrawableCollateral.staticCall(u.address);
      test(`getWithdrawableCollateral(${label})`, withdrawable >= 0n, ethers.formatUnits(withdrawable, 6));
    } catch (e) { test(`getWithdrawableCollateral(${label})`, false, e.message?.slice(0, 80)); }
  }

  // ── 5. Position-specific delegated views ──
  console.log("\n── 5. Position-specific views ──");
  for (const u of testUsers) {
    if (u.positions.length === 0) continue;
    const label = `${u.address.slice(0, 8)}…`;
    const pos = u.positions[0];
    const mktId = pos.marketId;

    try {
      const [pSize, pEntry, pMargin, pnl] = await vault.getPositionSummary.staticCall(u.address, mktId);
      test(`getPositionSummary(${label}, mkt${mktId.toString().slice(0,8)})`, pSize.toString() === pos.size,
        `size=${ethers.formatUnits(pSize, 6)}, entry=${ethers.formatUnits(pEntry, 6)}`);
    } catch (e) { test(`getPositionSummary(${label})`, false, e.message?.slice(0, 80)); }

    try {
      const [liqPrice, hasPos] = await vault.getLiquidationPrice.staticCall(u.address, mktId);
      test(`getLiquidationPrice(${label}, mkt${mktId.toString().slice(0,8)})`, hasPos,
        `${ethers.formatUnits(liqPrice, 6)}, hasPosition=${hasPos}`);
    } catch (e) { test(`getLiquidationPrice(${label})`, false, e.message?.slice(0, 80)); }

    try {
      const [equity, notional, hasPos] = await vault.getPositionEquity.staticCall(u.address, mktId);
      test(`getPositionEquity(${label}, mkt${mktId.toString().slice(0,8)})`, hasPos,
        `equity=${ethers.formatUnits(equity, 6)}, notional=${ethers.formatUnits(notional, 6)}`);
    } catch (e) { test(`getPositionEquity(${label})`, false, e.message?.slice(0, 80)); }

    try {
      const [mmrBps, fillRatio, hasPos] = await vault.getEffectiveMaintenanceMarginBps.staticCall(u.address, mktId);
      test(`getEffectiveMaintenanceMarginBps(${label})`, hasPos && mmrBps > 0n, `${mmrBps.toString()} bps`);
    } catch (e) { test(`getEffectiveMaintenanceMarginBps(${label})`, false, e.message?.slice(0, 80)); }
  }

  // ── 6. Global state ──
  console.log("\n── 6. Global state reads ──");
  try {
    const total = await vault.totalCollateralDeposited();
    test("totalCollateralDeposited", total.toString() === snapshot.globalConfig.totalCollateralDeposited,
      ethers.formatUnits(total, 6));
  } catch (e) { test("totalCollateralDeposited", false, e.message?.slice(0, 60)); }

  try {
    const locked = await vault.totalMarginLocked();
    test("totalMarginLocked", locked.toString() === snapshot.globalConfig.totalMarginLocked,
      ethers.formatUnits(locked, 6));
  } catch (e) { test("totalMarginLocked", false, e.message?.slice(0, 60)); }

  try {
    const migDone = await vault.migrationComplete();
    test("migrationComplete()", migDone === false, `${migDone} (expected false — not yet locked)`);
  } catch (e) { test("migrationComplete()", false, e.message?.slice(0, 60)); }

  try {
    const paused = await vault.paused();
    test("paused()", paused === false, `${paused}`);
  } catch (e) { test("paused()", false, e.message?.slice(0, 60)); }

  // ── Summary ──
  console.log("\n════════════════════════════════════════════════");
  console.log(`  Results: ${pass} PASS, ${fail} FAIL`);
  console.log("════════════════════════════════════════════════\n");

  if (fail > 0) process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(e); process.exit(1); });
