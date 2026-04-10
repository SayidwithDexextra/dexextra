#!/usr/bin/env node
/**
 * batch-upgrade-market-facets.js
 * 
 * Upgrades multiple markets to use the new optimized facets.
 * Fetches active markets from Supabase and performs diamond cuts.
 * 
 * Usage:
 *   npx hardhat run scripts/batch-upgrade-market-facets.js --network hyperliquid
 * 
 * Options:
 *   --dry-run        Show what would be done without executing
 *   --limit=N        Only upgrade first N markets (default: all)
 *   --market=0x...   Upgrade specific market address only
 *   --skip-settled   Skip markets that are already settled
 */
const { ethers, artifacts } = require("hardhat");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");

// Load env
try {
  require("dotenv").config({ path: path.join(process.cwd(), "..", ".env.local") });
  require("dotenv").config({ path: path.join(process.cwd(), "..", ".env") });
  require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });
} catch (_) {}

// Parse CLI args
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const skipSettled = args.includes("--skip-settled");
const limitArg = args.find(a => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.replace("--limit=", ""), 10) : null;
const marketArg = args.find(a => a.startsWith("--market="));
const specificMarket = marketArg ? marketArg.replace("--market=", "").trim() : null;

// New optimized facet addresses
const NEW_FACETS = {
  OBOrderPlacementFacet: process.env.OB_ORDER_PLACEMENT_FACET || process.env.NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET,
  OBTradeExecutionFacet: process.env.OB_TRADE_EXECUTION_FACET || process.env.NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET,
  OBLiquidationFacet: process.env.OB_LIQUIDATION_FACET || process.env.NEXT_PUBLIC_OB_LIQUIDATION_FACET,
  OBAdminViewFacet: process.env.OB_ADMIN_VIEW_FACET || process.env.NEXT_PUBLIC_OB_ADMIN_VIEW_FACET,
};

// Old facet addresses (to identify markets that need upgrading)
const OLD_FACETS = {
  OBOrderPlacementFacet: "0xE0eEd23d340E060762C77e1a72cbfb45855681D9",
  OBTradeExecutionFacet: "0xCd396BCE332729F05D9C6396861d2293058c1731",
  OBLiquidationFacet: "0xA82D87f1fbEe7f1BaC4a4Abd96FffA6bE5D18d89",
};

function renderType(t) {
  const type = t.type || "";
  const arr = type.match(/(\[.*\])$/);
  const base = type.replace(/(\[.*\])$/, "");
  if (base === "tuple") {
    return "(" + (t.components || []).map(renderType).join(",") + ")" + (arr ? arr[1] : "");
  }
  return type;
}

function getSelectorsFromAbi(abi) {
  const fns = abi.filter(e => e.type === "function");
  return fns.map(f => {
    const sig = f.name + "(" + (f.inputs || []).map(renderType).join(",") + ")";
    return ethers.id(sig).slice(0, 10);
  });
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function getMarketsToUpgrade() {
  if (specificMarket) {
    return [{ contract_address: specificMarket, symbol: "SPECIFIED" }];
  }

  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase not configured");

  let query = supabase
    .from("markets")
    .select("contract_address, symbol, status, settlement_date")
    .not("contract_address", "is", null);

  if (skipSettled) {
    query = query.neq("status", "settled");
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  
  if (error) throw new Error(`Supabase error: ${error.message}`);
  
  let markets = data || [];
  if (limit && limit > 0) {
    markets = markets.slice(0, limit);
  }
  
  return markets;
}

async function checkNeedsUpgrade(marketAddress, loupe) {
  // Check if any selector points to an old facet
  const placementArtifact = await artifacts.readArtifact("OBOrderPlacementFacet");
  const selectors = getSelectorsFromAbi(placementArtifact.abi);
  
  if (selectors.length === 0) return { needsUpgrade: false, reason: "no selectors" };

  // Check first selector
  try {
    const currentFacet = await loupe.facetAddress(selectors[0]);
    if (currentFacet.toLowerCase() === OLD_FACETS.OBOrderPlacementFacet.toLowerCase()) {
      return { needsUpgrade: true, reason: "has old placement facet" };
    }
    if (currentFacet.toLowerCase() === NEW_FACETS.OBOrderPlacementFacet?.toLowerCase()) {
      return { needsUpgrade: false, reason: "already upgraded" };
    }
    return { needsUpgrade: false, reason: "unknown facet version" };
  } catch {
    return { needsUpgrade: false, reason: "loupe call failed" };
  }
}

async function buildCutsForMarket(marketAddress) {
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4 selector) view returns (address)"],
    marketAddress,
    ethers.provider
  );

  const cuts = [];
  const details = [];

  // Process each facet type
  for (const [facetName, newAddress] of Object.entries(NEW_FACETS)) {
    if (!newAddress || !ethers.isAddress(newAddress)) {
      details.push({ facet: facetName, status: "skipped", reason: "no address" });
      continue;
    }

    let artifact;
    try {
      artifact = await artifacts.readArtifact(facetName);
    } catch {
      details.push({ facet: facetName, status: "skipped", reason: "artifact not found" });
      continue;
    }

    const selectors = getSelectorsFromAbi(artifact.abi);
    const toAdd = [];
    const toReplace = [];

    for (const sel of selectors) {
      let currentFacet = ethers.ZeroAddress;
      try {
        currentFacet = await loupe.facetAddress(sel);
      } catch {}

      if (!currentFacet || currentFacet === ethers.ZeroAddress) {
        toAdd.push(sel);
      } else if (currentFacet.toLowerCase() !== newAddress.toLowerCase()) {
        toReplace.push(sel);
      }
    }

    if (toReplace.length > 0) {
      cuts.push({ facetAddress: newAddress, action: 1, functionSelectors: toReplace });
    }
    if (toAdd.length > 0) {
      cuts.push({ facetAddress: newAddress, action: 0, functionSelectors: toAdd });
    }

    details.push({
      facet: facetName,
      status: (toAdd.length + toReplace.length) > 0 ? "update" : "current",
      add: toAdd.length,
      replace: toReplace.length,
    });
  }

  return { cuts, details };
}

async function main() {
  console.log("\n💎 Batch Market Facet Upgrade");
  console.log("═".repeat(60));

  if (isDryRun) {
    console.log("🔍 DRY RUN MODE - No transactions will be sent\n");
  }

  // Validate new facet addresses
  const missingFacets = Object.entries(NEW_FACETS)
    .filter(([_, addr]) => !addr || !ethers.isAddress(addr))
    .map(([name]) => name);

  if (missingFacets.length > 0) {
    console.log("⚠️  Missing facet addresses:", missingFacets.join(", "));
    console.log("   Set these in .env.local before running.\n");
  }

  console.log("New facet addresses:");
  for (const [name, addr] of Object.entries(NEW_FACETS)) {
    console.log(`   ${name}: ${addr || "(not set)"}`);
  }

  // Get signer
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  const balance = await ethers.provider.getBalance(signerAddress);
  console.log(`\nSigner: ${signerAddress}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

  // Get markets to upgrade
  console.log("Fetching markets...");
  const markets = await getMarketsToUpgrade();
  console.log(`Found ${markets.length} market(s)\n`);

  if (markets.length === 0) {
    console.log("No markets to upgrade.");
    return;
  }

  // Process each market
  const results = [];
  let upgraded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    const addr = market.contract_address;
    const symbol = market.symbol || "Unknown";

    console.log(`\n[${i + 1}/${markets.length}] ${symbol}`);
    console.log(`    Address: ${addr}`);

    if (!addr || !ethers.isAddress(addr)) {
      console.log("    ⚠️  Invalid address, skipping");
      skipped++;
      continue;
    }

    try {
      // Build cuts
      const { cuts, details } = await buildCutsForMarket(addr);

      // Show details
      for (const d of details) {
        if (d.status === "update") {
          console.log(`    📦 ${d.facet}: +${d.add} add, ~${d.replace} replace`);
        } else if (d.status === "current") {
          console.log(`    ✓  ${d.facet}: already current`);
        } else {
          console.log(`    ⚠️  ${d.facet}: ${d.reason}`);
        }
      }

      if (cuts.length === 0) {
        console.log("    ✅ Already up to date");
        skipped++;
        results.push({ market: addr, symbol, status: "current" });
        continue;
      }

      if (isDryRun) {
        console.log(`    🔍 Would execute ${cuts.length} cut operation(s)`);
        results.push({ market: addr, symbol, status: "dry-run", cuts: cuts.length });
        continue;
      }

      // Execute diamond cut
      console.log(`    🔧 Executing diamond cut (${cuts.length} operations)...`);
      const diamond = await ethers.getContractAt("IDiamondCut", addr, signer);
      const tx = await diamond.diamondCut(cuts, ethers.ZeroAddress, "0x");
      console.log(`    TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`    ✅ Upgraded! Gas: ${receipt.gasUsed.toString()}`);
      
      upgraded++;
      results.push({ market: addr, symbol, status: "upgraded", tx: tx.hash });

    } catch (error) {
      console.log(`    ❌ Failed: ${error?.reason || error?.message || error}`);
      failed++;
      results.push({ market: addr, symbol, status: "failed", error: error?.message });
    }
  }

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("📊 Summary:");
  console.log(`   Total markets: ${markets.length}`);
  console.log(`   Upgraded: ${upgraded}`);
  console.log(`   Skipped (already current): ${skipped}`);
  console.log(`   Failed: ${failed}`);

  if (isDryRun) {
    console.log("\n🔍 This was a dry run. Run without --dry-run to execute upgrades.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Error:", e?.message || String(e));
    process.exit(1);
  });
