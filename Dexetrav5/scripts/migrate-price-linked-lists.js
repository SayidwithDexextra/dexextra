#!/usr/bin/env node
/**
 * migrate-price-linked-lists.js
 *
 * One-time migration script to populate the sorted price linked list pointers
 * from existing buyPrices[] and sellPrices[] arrays in deployed order books.
 *
 * This script:
 * 1. Reads existing price levels from each order book
 * 2. Sorts them (descending for buys, ascending for sells)
 * 3. Calls admin functions to initialize the linked list pointers
 *
 * Usage:
 *   npx hardhat run scripts/migrate-price-linked-lists.js --network hyperliquid
 *
 * Environment variables required:
 *   ADMIN_PRIVATE_KEY - Primary admin key
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
 *
 * Optional:
 *   SINGLE_MARKET - Migrate only a single market address
 *   DRY_RUN=true - Only read data, don't write
 */
const { ethers } = require("hardhat");

function isAddress(v) {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v.trim());
}

function normalizePk(v) {
  let raw = String(v || "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  if (!raw) return "";
  const pk = raw.startsWith("0x") ? raw : `0x${raw}`;
  return /^0x[a-fA-F0-9]{64}$/.test(pk) ? pk : "";
}

async function fetchMarkets() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/ANON_KEY in env.");
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("markets")
    .select("id, symbol, market_identifier, market_address, market_status, is_active")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data || []).filter((r) => isAddress(r.market_address));
}

const ORDER_BOOK_READ_ABI = [
  "function owner() view returns (address)",
  "function getBuyPrices() view returns (uint256[])",
  "function getSellPrices() view returns (uint256[])",
  "function getBuyLevelExists(uint256 price) view returns (bool)",
  "function getSellLevelExists(uint256 price) view returns (bool)",
  "function bestBid() view returns (uint256)",
  "function bestAsk() view returns (uint256)",
];

const MIGRATION_ABI = [
  "function initializePriceLinkedLists(uint256[] calldata sortedBuyPrices, uint256[] calldata sortedSellPrices) external",
];

async function main() {
  console.log("\n🔗 Price Linked List Migration");
  console.log("═".repeat(80));

  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  if (!pk1) throw new Error("Missing/invalid ADMIN_PRIVATE_KEY in env.");

  const dryRun = process.env.DRY_RUN === "true";
  const singleMarket = process.env.SINGLE_MARKET;

  if (dryRun) {
    console.log("⚠️  DRY RUN MODE - no writes will be performed\n");
  }

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  console.log("Admin:", await w1.getAddress());

  let markets;
  if (singleMarket && isAddress(singleMarket)) {
    console.log(`\n📍 Migrating single market: ${singleMarket}`);
    markets = [{ market_address: singleMarket, symbol: "SINGLE" }];
  } else {
    console.log("\n🔎 Fetching markets from Supabase...");
    const allMarkets = await fetchMarkets();
    markets = allMarkets.filter((m) => m.is_active);
    console.log(`   ${markets.length} active markets to check\n`);
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const orderBook = m.market_address.trim();
    const label = `[${i + 1}/${markets.length}] ${m.symbol || "MARKET"}`;
    console.log(`\n${label} @ ${orderBook}`);

    try {
      const ob = await ethers.getContractAt(ORDER_BOOK_READ_ABI, orderBook, ethers.provider);

      let buyPrices = [];
      let sellPrices = [];

      try {
        buyPrices = await ob.getBuyPrices();
        sellPrices = await ob.getSellPrices();
      } catch (e) {
        console.log(`   ⚠️ Cannot read price arrays (old contract version?): ${e.message.slice(0, 60)}`);
        skipped++;
        continue;
      }

      const activeBuyPrices = [];
      for (const price of buyPrices) {
        try {
          const exists = await ob.getBuyLevelExists(price);
          if (exists) activeBuyPrices.push(price);
        } catch {
          activeBuyPrices.push(price);
        }
      }

      const activeSellPrices = [];
      for (const price of sellPrices) {
        try {
          const exists = await ob.getSellLevelExists(price);
          if (exists) activeSellPrices.push(price);
        } catch {
          activeSellPrices.push(price);
        }
      }

      const sortedBuyPrices = [...activeBuyPrices].sort((a, b) => {
        const aBig = BigInt(a.toString());
        const bBig = BigInt(b.toString());
        return bBig > aBig ? 1 : bBig < aBig ? -1 : 0;
      });

      const sortedSellPrices = [...activeSellPrices].sort((a, b) => {
        const aBig = BigInt(a.toString());
        const bBig = BigInt(b.toString());
        return aBig > bBig ? 1 : aBig < bBig ? -1 : 0;
      });

      console.log(`   Buy prices: ${sortedBuyPrices.length} active`);
      console.log(`   Sell prices: ${sortedSellPrices.length} active`);

      if (sortedBuyPrices.length === 0 && sortedSellPrices.length === 0) {
        console.log(`   ℹ️ No active price levels to migrate`);
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(`   🔍 DRY RUN: would initialize linked lists`);
        if (sortedBuyPrices.length > 0) {
          console.log(`      Buy head: ${sortedBuyPrices[0]} (highest)`);
        }
        if (sortedSellPrices.length > 0) {
          console.log(`      Sell head: ${sortedSellPrices[0]} (lowest)`);
        }
        migrated++;
        continue;
      }

      const owner = (await ob.owner()).toLowerCase();
      const adminAddr = (await w1.getAddress()).toLowerCase();
      if (owner !== adminAddr) {
        console.log(`   ⚠️ SKIP: admin ${adminAddr} is not owner ${owner}`);
        skipped++;
        continue;
      }

      const obWithSigner = await ethers.getContractAt(MIGRATION_ABI, orderBook, w1);

      try {
        const tx = await obWithSigner.initializePriceLinkedLists(sortedBuyPrices, sortedSellPrices);
        console.log(`   tx: ${tx.hash}`);
        const rc = await tx.wait();
        console.log(`   ✅ mined block ${rc.blockNumber}, gas ${rc.gasUsed.toString()}`);
        migrated++;
      } catch (e) {
        if (e.message.includes("function selector was not recognized")) {
          console.log(`   ⚠️ initializePriceLinkedLists not available (needs facet upgrade first)`);
          skipped++;
        } else {
          throw e;
        }
      }
    } catch (e) {
      console.log(`   ❌ FAILED: ${e.message?.slice(0, 120)}`);
      failed++;
    }
  }

  console.log("\n" + "═".repeat(80));
  console.log(`Done. migrated=${migrated} skipped=${skipped} failed=${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ migration failed:", e?.message || String(e));
    process.exit(1);
  });
