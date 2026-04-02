/**
 * CoreVault State Snapshot
 *
 * Reads ALL on-chain state from a live CoreVault and writes it to a JSON file.
 * Used before a CoreVault redeploy/migration to capture the full state that
 * must be replayed into the new vault.
 *
 * Env:
 *   CORE_VAULT_ADDRESS  (required)
 *   MOCK_USDC_ADDRESS   (required – collateral token)
 *   RPC_URL             (required)
 *
 * Run:
 *   node scripts/snapshot-corevault.js
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

const CORE_VAULT_ADDRESS = process.env.CORE_VAULT_ADDRESS;
const USDC_ADDRESS = process.env.MOCK_USDC_ADDRESS;
const RPC_URL = process.env.RPC_URL || process.env.HYPERLIQUID_RPC_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!CORE_VAULT_ADDRESS || !USDC_ADDRESS || !RPC_URL) {
  console.error("Missing env: CORE_VAULT_ADDRESS, MOCK_USDC_ADDRESS, RPC_URL");
  process.exit(1);
}

const VAULT_ABI = [
  // User enumeration
  "function allKnownUsers(uint256) view returns (address)",
  // User state
  "function userCollateral(address) view returns (uint256)",
  "function userCrossChainCredit(address) view returns (uint256)",
  "function userRealizedPnL(address) view returns (int256)",
  "function userSocializedLoss(address) view returns (uint256)",
  "function getUserPositions(address) view returns (tuple(bytes32 marketId, int256 size, uint256 entryPrice, uint256 marginLocked, uint256 socializedLossAccrued6, uint256 haircutUnits18, uint256 liquidationPrice)[])",
  "function userPendingOrders(address, uint256) view returns (bytes32 orderId, uint256 marginReserved, uint256 timestamp)",
  "function userMarketIds(address, uint256) view returns (bytes32)",
  "function topUpNonces(address) view returns (uint256)",
  "function isUnderLiquidationPosition(address, bytes32) view returns (bool)",
  // Market state
  "function marketToOrderBook(bytes32) view returns (address)",
  "function registeredOrderBooks(address) view returns (bool)",
  "function marketMarkPrices(bytes32) view returns (uint256)",
  "function marketBadDebt(bytes32) view returns (uint256)",
  "function marketSettled(bytes32) view returns (bool)",
  "function marketDisputed(bytes32) view returns (bool)",
  // Global config (public)
  "function baseMmrBps() view returns (uint256)",
  "function penaltyMmrBps() view returns (uint256)",
  "function maxMmrBps() view returns (uint256)",
  "function scalingSlopeBps() view returns (uint256)",
  "function priceGapSlopeBps() view returns (uint256)",
  "function mmrLiquidityDepthLevels() view returns (uint256)",
  "function totalCollateralDeposited() view returns (uint256)",
  "function totalMarginLocked() view returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function safeCall(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function readArrayMapping(contract, fnName, user, maxLen = 200) {
  const items = [];
  for (let i = 0; i < maxLen; i++) {
    try {
      const val = await contract[fnName](user, i);
      items.push(val);
    } catch {
      break;
    }
  }
  return items;
}

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  CoreVault State Snapshot");
  console.log("═══════════════════════════════════════════════");
  console.log("Vault:", CORE_VAULT_ADDRESS);
  console.log("USDC:", USDC_ADDRESS);
  console.log("RPC:", RPC_URL.slice(0, 50) + "...");
  console.log("");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const vault = new ethers.Contract(CORE_VAULT_ADDRESS, VAULT_ABI, provider);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);

  // ── 1. Read allKnownUsers ──
  console.log("[1/6] Enumerating allKnownUsers...");
  const users = [];
  for (let i = 0; ; i++) {
    try {
      const addr = await vault.allKnownUsers(i);
      users.push(addr);
    } catch {
      break;
    }
  }
  console.log(`  Found ${users.length} users`);

  // ── 2. Per-user state ──
  console.log("[2/6] Reading per-user state...");
  const userStates = [];

  for (let u = 0; u < users.length; u++) {
    const addr = users[u];
    process.stdout.write(`  User ${u + 1}/${users.length}: ${addr}\r`);

    const [collateral, crossChainCredit, realizedPnL, socializedLoss, positions, topUpNonce] =
      await Promise.all([
        vault.userCollateral(addr),
        vault.userCrossChainCredit(addr),
        vault.userRealizedPnL(addr),
        vault.userSocializedLoss(addr),
        vault.getUserPositions(addr),
        vault.topUpNonces(addr),
      ]);

    const marketIds = await readArrayMapping(vault, "userMarketIds", addr);

    const pendingOrders = await readArrayMapping(vault, "userPendingOrders", addr);
    const pendingOrdersSerialized = pendingOrders.map((po) => ({
      orderId: po.orderId || po[0],
      marginReserved: (po.marginReserved || po[1]).toString(),
      timestamp: (po.timestamp || po[2]).toString(),
    }));

    const positionsSerialized = positions.map((p) => ({
      marketId: p.marketId,
      size: p.size.toString(),
      entryPrice: p.entryPrice.toString(),
      marginLocked: p.marginLocked.toString(),
      socializedLossAccrued6: p.socializedLossAccrued6.toString(),
      haircutUnits18: p.haircutUnits18.toString(),
      liquidationPrice: p.liquidationPrice.toString(),
    }));

    // Check liquidation flags for each position
    const liquidationFlags = {};
    for (const pos of positions) {
      const isUnder = await safeCall(
        () => vault.isUnderLiquidationPosition(addr, pos.marketId),
        false
      );
      if (isUnder) liquidationFlags[pos.marketId] = true;
    }

    userStates.push({
      address: addr,
      userCollateral: collateral.toString(),
      userCrossChainCredit: crossChainCredit.toString(),
      userRealizedPnL: realizedPnL.toString(),
      userSocializedLoss: socializedLoss.toString(),
      topUpNonce: topUpNonce.toString(),
      positions: positionsSerialized,
      pendingOrders: pendingOrdersSerialized,
      marketIds: marketIds.map((id) => id.toString()),
      liquidationFlags,
    });
  }
  console.log(`  Done — ${userStates.length} users read`);

  // ── 3. Collect all unique marketIds (on-chain user data + Supabase) ──
  console.log("[3/7] Collecting market IDs...");
  const marketIdSet = new Set();
  for (const u of userStates) {
    for (const mid of u.marketIds) marketIdSet.add(mid);
    for (const p of u.positions) marketIdSet.add(p.marketId);
  }
  console.log(`  From user data: ${marketIdSet.size} markets`);

  // Pull ALL deployed markets from Supabase for completeness
  let supabaseMarkets = [];
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const url = `${SUPABASE_URL}/rest/v1/markets?deployment_status=eq.DEPLOYED&select=symbol,market_id_bytes32,market_address,market_status,is_active,settlement_value,created_at`;
      const resp = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      });
      if (resp.ok) {
        supabaseMarkets = await resp.json();
        for (const m of supabaseMarkets) {
          if (m.market_id_bytes32) marketIdSet.add(m.market_id_bytes32);
        }
        console.log(`  From Supabase: ${supabaseMarkets.length} deployed markets`);
      } else {
        console.log(`  Supabase fetch failed: ${resp.status}`);
      }
    } catch (e) {
      console.log(`  Supabase fetch error: ${e.message}`);
    }
  } else {
    console.log("  Supabase credentials not set — skipping DB market enumeration");
  }

  const marketIds = [...marketIdSet];
  console.log(`  Total unique: ${marketIds.length} markets`);

  // ── 4. Per-market state ──
  console.log("[4/7] Reading per-market state...");
  const marketStates = [];
  for (const mid of marketIds) {
    const [orderBook, markPrice, badDebt, settled, disputed] = await Promise.all([
      vault.marketToOrderBook(mid),
      vault.marketMarkPrices(mid),
      vault.marketBadDebt(mid),
      vault.marketSettled(mid),
      vault.marketDisputed(mid),
    ]);

    const isRegistered = orderBook !== ethers.ZeroAddress
      ? await safeCall(() => vault.registeredOrderBooks(orderBook), false)
      : false;

    // Attach Supabase metadata if available
    const sbMatch = supabaseMarkets.find((s) => s.market_id_bytes32 === mid);
    marketStates.push({
      marketId: mid,
      symbol: sbMatch?.symbol || null,
      orderBook,
      orderBookRegistered: isRegistered,
      markPrice: markPrice.toString(),
      badDebt: badDebt.toString(),
      settled,
      disputed,
      supabaseStatus: sbMatch?.market_status || null,
      supabaseSettlementValue: sbMatch?.settlement_value || null,
      supabaseIsActive: sbMatch?.is_active ?? null,
    });
  }
  console.log(`  Done — ${marketStates.length} markets read`);

  // ── 5. Global config ──
  console.log("[5/7] Reading global config...");
  const [
    baseMmrBps,
    penaltyMmrBps,
    maxMmrBps,
    scalingSlopeBps,
    priceGapSlopeBps,
    mmrLiquidityDepthLevels,
    totalCollateralDeposited,
    totalMarginLocked,
  ] = await Promise.all([
    vault.baseMmrBps(),
    vault.penaltyMmrBps(),
    vault.maxMmrBps(),
    vault.scalingSlopeBps(),
    vault.priceGapSlopeBps(),
    vault.mmrLiquidityDepthLevels(),
    vault.totalCollateralDeposited(),
    vault.totalMarginLocked(),
  ]);

  const usdcBalance = await usdc.balanceOf(CORE_VAULT_ADDRESS);
  const usdcDecimals = await usdc.decimals();

  const globalConfig = {
    baseMmrBps: baseMmrBps.toString(),
    penaltyMmrBps: penaltyMmrBps.toString(),
    maxMmrBps: maxMmrBps.toString(),
    scalingSlopeBps: scalingSlopeBps.toString(),
    priceGapSlopeBps: priceGapSlopeBps.toString(),
    mmrLiquidityDepthLevels: mmrLiquidityDepthLevels.toString(),
    totalCollateralDeposited: totalCollateralDeposited.toString(),
    totalMarginLocked: totalMarginLocked.toString(),
  };

  // ── 6. Collect all registered orderbooks from market data ──
  console.log("[6/7] Building orderbook registry...");
  const orderBookSet = new Set();
  for (const m of marketStates) {
    if (m.orderBook !== ethers.ZeroAddress) orderBookSet.add(m.orderBook);
  }
  const registeredOrderBooks = [];
  for (const ob of orderBookSet) {
    const isReg = await safeCall(() => vault.registeredOrderBooks(ob), false);
    registeredOrderBooks.push({ address: ob, registered: isReg });
  }

  // ── 7. Market breakdown ──
  console.log("[7/7] Analyzing market breakdown...");
  const onChainSettled = marketStates.filter((m) => m.settled).length;
  const onChainActive = marketStates.filter((m) => !m.settled).length;
  const onChainDisputed = marketStates.filter((m) => m.disputed).length;
  const withOrderBook = marketStates.filter((m) => m.orderBook !== ethers.ZeroAddress).length;
  const withoutOrderBook = marketStates.filter((m) => m.orderBook === ethers.ZeroAddress).length;

  // ── Assemble snapshot ──
  const sumCollateral = userStates.reduce((s, u) => s + BigInt(u.userCollateral), 0n);
  const sumCredit = userStates.reduce((s, u) => s + BigInt(u.userCrossChainCredit), 0n);
  const sumRealizedPnL = userStates.reduce((s, u) => s + BigInt(u.userRealizedPnL), 0n);
  const totalPositions = userStates.reduce((s, u) => s + u.positions.length, 0);
  const totalPendingOrders = userStates.reduce((s, u) => s + u.pendingOrders.length, 0);

  const snapshot = {
    metadata: {
      coreVaultAddress: CORE_VAULT_ADDRESS,
      collateralToken: USDC_ADDRESS,
      collateralDecimals: Number(usdcDecimals),
      chainId: (await provider.getNetwork()).chainId.toString(),
      blockNumber: (await provider.getBlockNumber()).toString(),
      timestamp: new Date().toISOString(),
      snapshotVersion: "1.0.0",
    },
    summary: {
      totalUsers: users.length,
      totalMarkets: marketIds.length,
      marketsFromUserData: marketIds.length - (supabaseMarkets.length > 0 ? supabaseMarkets.filter((s) => !userStates.some((u) => u.marketIds.includes(s.market_id_bytes32) || u.positions.some((p) => p.marketId === s.market_id_bytes32))).length : 0),
      marketsFromSupabase: supabaseMarkets.length,
      marketsOnChainSettled: onChainSettled,
      marketsOnChainActive: onChainActive,
      marketsOnChainDisputed: onChainDisputed,
      marketsWithOrderBook: withOrderBook,
      marketsWithoutOrderBook: withoutOrderBook,
      totalPositions,
      totalPendingOrders,
      totalRegisteredOrderBooks: registeredOrderBooks.filter((o) => o.registered).length,
      sumUserCollateral: sumCollateral.toString(),
      sumUserCrossChainCredit: sumCredit.toString(),
      sumUserRealizedPnL: sumRealizedPnL.toString(),
      vaultUsdcBalance: usdcBalance.toString(),
      collateralAccountingMatch: sumCollateral.toString() === totalCollateralDeposited.toString(),
      vaultUsdcFormatted: ethers.formatUnits(usdcBalance, usdcDecimals),
      sumCollateralFormatted: ethers.formatUnits(sumCollateral, usdcDecimals),
      sumCreditFormatted: ethers.formatUnits(sumCredit, usdcDecimals),
    },
    globalConfig,
    users: userStates,
    markets: marketStates,
    registeredOrderBooks,
  };

  // ── Write ──
  const outDir = path.resolve(__dirname, "../snapshots");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const filename = `corevault-snapshot-${Date.now()}.json`;
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("  Snapshot Complete");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Users:              ${users.length}`);
  console.log(`  Markets (total):    ${marketIds.length}`);
  console.log(`    On-chain active:  ${onChainActive}`);
  console.log(`    On-chain settled: ${onChainSettled}`);
  console.log(`    On-chain disputed:${onChainDisputed}`);
  console.log(`    With OrderBook:   ${withOrderBook}`);
  console.log(`    No OrderBook:     ${withoutOrderBook}`);
  console.log(`  Positions:          ${totalPositions}`);
  console.log(`  Pending Orders:     ${totalPendingOrders}`);
  console.log(`  OrderBooks:         ${registeredOrderBooks.filter((o) => o.registered).length}`);
  console.log(`  USDC in vault:      ${ethers.formatUnits(usdcBalance, usdcDecimals)} USDC`);
  console.log(`  Sum collateral:     ${ethers.formatUnits(sumCollateral, usdcDecimals)} USDC`);
  console.log(`  Sum credit:         ${ethers.formatUnits(sumCredit, usdcDecimals)} USDC`);
  console.log(`  Accounting match:   ${sumCollateral.toString() === totalCollateralDeposited.toString()}`);
  console.log("");
  console.log(`  Written to: ${outPath}`);
  console.log("═══════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Snapshot failed:", err);
  process.exit(1);
});
