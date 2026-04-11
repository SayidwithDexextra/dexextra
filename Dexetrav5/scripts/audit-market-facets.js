#!/usr/bin/env node
/**
 * audit-market-facets.js
 * 
 * Audits all active markets to check if they have the latest facet implementations.
 * Compares each market's facet addresses against the expected (latest) addresses.
 * 
 * Reference market: 0x78BB10E86BC6958307FEfd5EbD2206F6ab149795 (CRONOS-CRO-PRICE-10apr26)
 * This market is known to be fully up-to-date with all latest facets.
 * 
 * Usage:
 *   npx hardhat run scripts/audit-market-facets.js --network hyperliquid
 * 
 * Options:
 *   --market=0x...     Audit specific market only
 *   --json             Output results as JSON
 *   --active-only      Only audit ACTIVE markets (skip SETTLED, EXPIRED, etc.)
 *   --needs-upgrade    Only show markets that need upgrades
 *   --reference=0x...  Use a different reference market
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

// Parse CLI args and env vars (env vars allow passing options without Hardhat complaining)
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json") || process.env.JSON_OUTPUT === "1";
const activeOnly = args.includes("--active-only") || process.env.ACTIVE_ONLY === "1";
const needsUpgradeOnly = args.includes("--needs-upgrade") || process.env.NEEDS_UPGRADE === "1";
const marketArg = args.find(a => a.startsWith("--market="));
const specificMarket = marketArg ? marketArg.replace("--market=", "").trim() : (process.env.MARKET || null);
const refArg = args.find(a => a.startsWith("--reference="));
const referenceMarket = refArg 
  ? refArg.replace("--reference=", "").trim() 
  : (process.env.REFERENCE_MARKET || "0x78BB10E86BC6958307FEfd5EbD2206F6ab149795");

// Expected (latest) facet addresses from env
// These should match the reference market (0x78BB10E8...)
const EXPECTED_FACETS = {
  OBOrderPlacementFacet: process.env.OB_ORDER_PLACEMENT_FACET || process.env.NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET,
  OBTradeExecutionFacet: process.env.OB_TRADE_EXECUTION_FACET || process.env.NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET,
  OBLiquidationFacet: process.env.OB_LIQUIDATION_FACET || process.env.NEXT_PUBLIC_OB_LIQUIDATION_FACET,
  OBSettlementFacet: process.env.OB_SETTLEMENT_FACET || process.env.NEXT_PUBLIC_OB_SETTLEMENT_FACET,
  OBViewFacet: process.env.OB_VIEW_FACET || process.env.NEXT_PUBLIC_OB_VIEW_FACET,
  OBAdminFacet: process.env.OB_ADMIN_FACET || process.env.NEXT_PUBLIC_OB_ADMIN_FACET,
  OBPricingFacet: process.env.OB_PRICING_FACET || process.env.NEXT_PUBLIC_OB_PRICING_FACET,
  MarketLifecycleFacet: process.env.MARKET_LIFECYCLE_FACET || process.env.NEXT_PUBLIC_MARKET_LIFECYCLE_FACET,
  MetaTradeFacet: process.env.META_TRADE_FACET || process.env.NEXT_PUBLIC_META_TRADE_FACET,
};

// Lifecycle states
const LIFECYCLE_STATES = ['ACTIVE', 'ROLLOVER_WINDOW', 'CHALLENGE_WINDOW', 'SETTLED', 'EXPIRED'];
const ACTIVE_STATES = ['ACTIVE', 'ROLLOVER_WINDOW', 'CHALLENGE_WINDOW'];

// Key selectors to check for each facet (using actual function signatures from artifacts)
const FACET_SELECTORS = {
  OBOrderPlacementFacet: [
    { name: "placeLimitOrder", sig: "placeLimitOrder(uint256,uint256,bool)" },
    { name: "placeMarketOrder", sig: "placeMarketOrder(uint256,bool)" },
    { name: "cancelOrder", sig: "cancelOrder(uint256)" },
  ],
  OBTradeExecutionFacet: [
    { name: "getRecentTrades", sig: "getRecentTrades(uint256)" },
    { name: "getTradeStatistics", sig: "getTradeStatistics()" },
  ],
  OBLiquidationFacet: [
    { name: "liquidateDirect", sig: "liquidateDirect(address)" },
    { name: "pokeLiquidations", sig: "pokeLiquidations()" },
  ],
  OBSettlementFacet: [
    { name: "settleMarket", sig: "settleMarket(uint256)" },
    { name: "isSettled", sig: "isSettled()" },
  ],
  OBViewFacet: [
    { name: "bestBid", sig: "bestBid()" },
    { name: "bestAsk", sig: "bestAsk()" },
    { name: "getOrder", sig: "getOrder(uint256)" },
  ],
  MarketLifecycleFacet: [
    { name: "getLifecycleState", sig: "getLifecycleState()" },
    { name: "syncLifecycle", sig: "syncLifecycle()" },
  ],
  MetaTradeFacet: [
    { name: "metaPlaceMarginMarket", sig: "metaPlaceMarginMarket((address,uint256,bool,uint256,uint256),bytes)" },
  ],
};

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Fetch facet addresses from the reference market (known good state)
async function getReferenceFacets(refAddress) {
  const facets = {};
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    refAddress
  );
  
  for (const [facetName, selectors] of Object.entries(FACET_SELECTORS)) {
    for (const { sig } of selectors) {
      const selector = ethers.id(sig).slice(0, 10);
      try {
        const addr = await loupe.facetAddress(selector);
        if (addr !== ethers.ZeroAddress) {
          facets[facetName] = addr;
          break; // Only need one selector per facet
        }
      } catch {}
    }
  }
  
  return facets;
}

async function getMarkets() {
  if (specificMarket) {
    return [{ market_address: specificMarket, symbol: "SPECIFIED" }];
  }
  
  const sb = getSupabase();
  if (!sb) {
    console.error("Supabase not configured. Use --market=0x... to audit a specific market.");
    process.exit(1);
  }
  
  const { data, error } = await sb
    .from("markets")
    .select("market_address, symbol, created_at")
    .not("market_address", "is", null)
    .order("created_at", { ascending: false });
  
  if (error) {
    console.error("Failed to fetch markets:", error.message);
    process.exit(1);
  }
  
  return data || [];
}

async function auditMarket(marketAddress, symbol) {
  const result = {
    market: marketAddress,
    symbol,
    facets: {},
    issues: [],
    upToDate: true,
    lineage: { parent: null, child: null },
    state: null,
  };
  
  // First check if the contract is a valid diamond by trying a simple call
  try {
    const loupe = await ethers.getContractAt(
      ["function facetAddress(bytes4) view returns (address)"],
      marketAddress
    );
    
    // Test call to see if contract exists
    const testSelector = ethers.id("placeLimitOrder(uint256,uint256,bool)").slice(0, 10);
    await loupe.facetAddress(testSelector);
  } catch (err) {
    // Contract doesn't exist or isn't a diamond
    result.upToDate = false;
    result.issues.push("Contract not accessible or not a diamond");
    return result;
  }
  
  // Get lineage info if available
  try {
    const lifecycle = await ethers.getContractAt(
      [
        "function getMarketLineage() view returns (address parent, address child)",
        "function getLifecycleState() view returns (uint8)"
      ],
      marketAddress
    );
    const lineage = await lifecycle.getMarketLineage();
    result.lineage.parent = lineage.parent !== ethers.ZeroAddress ? lineage.parent : null;
    result.lineage.child = lineage.child !== ethers.ZeroAddress ? lineage.child : null;
    
    const stateNum = await lifecycle.getLifecycleState();
    const states = ['ACTIVE', 'ROLLOVER_WINDOW', 'CHALLENGE_WINDOW', 'SETTLED', 'EXPIRED'];
    result.state = states[stateNum] || String(stateNum);
  } catch {
    // Lifecycle not available
  }
  
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    marketAddress
  );
  
  for (const [facetName, selectors] of Object.entries(FACET_SELECTORS)) {
    const expectedAddr = EXPECTED_FACETS[facetName];
    if (!expectedAddr) continue;
    
    for (const { name, sig } of selectors) {
      const selector = ethers.id(sig).slice(0, 10);
      try {
        const actualAddr = await loupe.facetAddress(selector);
        
        if (actualAddr === ethers.ZeroAddress) {
          result.facets[`${facetName}.${name}`] = {
            selector,
            expected: expectedAddr,
            actual: "NOT_INSTALLED",
            match: false,
          };
          result.issues.push(`${facetName}.${name}: Not installed`);
          result.upToDate = false;
        } else if (actualAddr.toLowerCase() !== expectedAddr.toLowerCase()) {
          result.facets[`${facetName}.${name}`] = {
            selector,
            expected: expectedAddr,
            actual: actualAddr,
            match: false,
          };
          result.issues.push(`${facetName}.${name}: Outdated (${actualAddr.slice(0, 10)}... vs ${expectedAddr.slice(0, 10)}...)`);
          result.upToDate = false;
        } else {
          result.facets[`${facetName}.${name}`] = {
            selector,
            expected: expectedAddr,
            actual: actualAddr,
            match: true,
          };
        }
      } catch (err) {
        result.facets[`${facetName}.${name}`] = {
          selector,
          expected: expectedAddr,
          actual: "ERROR",
          match: false,
          error: err.message,
        };
        result.issues.push(`${facetName}.${name}: Error checking - ${err.message}`);
        result.upToDate = false;
      }
    }
  }
  
  return result;
}

async function main() {
  console.log("\n🔍 Market Facet Audit");
  console.log("═".repeat(80));
  
  // First, fetch facets from the reference market to validate our env vars
  if (!jsonOutput) {
    console.log(`\n🎯 Reference Market: ${referenceMarket}`);
    console.log("   Fetching facet addresses from reference...");
  }
  
  let referenceFacets = {};
  try {
    referenceFacets = await getReferenceFacets(referenceMarket);
    if (!jsonOutput) {
      console.log("   ✅ Reference market is accessible\n");
    }
  } catch (err) {
    console.error(`   ❌ Failed to read reference market: ${err.message}`);
    console.error("   Falling back to env vars only.\n");
  }
  
  // Merge reference facets with env vars (reference takes precedence for validation)
  const effectiveExpected = { ...EXPECTED_FACETS };
  let envMismatches = [];
  for (const [name, refAddr] of Object.entries(referenceFacets)) {
    const envAddr = EXPECTED_FACETS[name];
    if (envAddr && envAddr.toLowerCase() !== refAddr.toLowerCase()) {
      envMismatches.push({ facet: name, env: envAddr, reference: refAddr });
    }
    // Use reference as source of truth
    effectiveExpected[name] = refAddr;
  }
  
  // Show expected facet addresses and any mismatches
  if (!jsonOutput) {
    console.log("📋 Expected (Latest) Facet Addresses:");
    for (const [name, addr] of Object.entries(effectiveExpected)) {
      if (addr) {
        const fromRef = referenceFacets[name] ? " (from reference)" : " (from env)";
        console.log(`   ${name}: ${addr}${fromRef}`);
      }
    }
    
    if (envMismatches.length > 0) {
      console.log("\n⚠️  ENV MISMATCHES (env vars don't match reference market):");
      for (const m of envMismatches) {
        console.log(`   ${m.facet}:`);
        console.log(`      env:       ${m.env}`);
        console.log(`      reference: ${m.reference}`);
      }
      console.log("   → Consider updating your .env.local or Vercel env vars");
    }
    console.log("");
  }
  
  const allMarkets = await getMarkets();
  
  // Filter markets if needed
  let markets = allMarkets;
  if (!jsonOutput && (activeOnly || needsUpgradeOnly)) {
    console.log(`📊 Filters: ${activeOnly ? '--active-only ' : ''}${needsUpgradeOnly ? '--needs-upgrade ' : ''}`);
  }
  
  console.log(`\n📊 Auditing ${markets.length} market(s)...\n`);
  
  const results = [];
  let upToDateCount = 0;
  let outdatedCount = 0;
  let skippedCount = 0;
  
  for (const market of markets) {
    if (!market.market_address) continue;
    
    // Skip reference market (we know it's up to date)
    if (market.market_address.toLowerCase() === referenceMarket.toLowerCase()) {
      results.push({
        market: market.market_address,
        symbol: market.symbol,
        upToDate: true,
        isReference: true,
        state: 'REFERENCE',
      });
      upToDateCount++;
      if (!jsonOutput && !needsUpgradeOnly) {
        console.log(`🎯 ${market.symbol} (${market.market_address.slice(0, 10)}...): REFERENCE MARKET`);
      }
      continue;
    }
    
    try {
      const result = await auditMarket(market.market_address, market.symbol);
      
      // Apply --active-only filter
      if (activeOnly && result.state && !ACTIVE_STATES.includes(result.state)) {
        skippedCount++;
        continue;
      }
      
      results.push(result);
      
      if (result.upToDate) {
        upToDateCount++;
        if (!jsonOutput && !needsUpgradeOnly) {
          let extra = '';
          if (result.state) extra += ` [${result.state}]`;
          if (result.lineage.parent) extra += ` (child of ${result.lineage.parent.slice(0,10)}...)`;
          if (result.lineage.child) extra += ` → has child`;
          console.log(`✅ ${market.symbol} (${market.market_address.slice(0, 10)}...): Up to date${extra}`);
        }
      } else {
        outdatedCount++;
        if (!jsonOutput) {
          let extra = '';
          if (result.state) extra += ` [${result.state}]`;
          if (result.lineage.parent) extra += ` (child of ${result.lineage.parent.slice(0,10)}...)`;
          if (result.lineage.child) extra += ` → has child`;
          console.log(`❌ ${market.symbol} (${market.market_address.slice(0, 10)}...): NEEDS UPGRADE${extra}`);
          for (const issue of result.issues) {
            console.log(`   - ${issue}`);
          }
        }
      }
    } catch (err) {
      results.push({
        market: market.market_address,
        symbol: market.symbol,
        error: err.message,
        upToDate: false,
      });
      outdatedCount++;
      if (!jsonOutput) {
        console.log(`⚠️  ${market.symbol} (${market.market_address.slice(0, 10)}...): Error - ${err.message}`);
      }
    }
  }
  
  // Summary
  console.log("\n" + "═".repeat(80));
  console.log("📈 Summary:");
  console.log(`   ✅ Up to date: ${upToDateCount}`);
  console.log(`   ❌ Needs upgrade: ${outdatedCount}`);
  if (skippedCount > 0) {
    console.log(`   ⏭️  Skipped (inactive): ${skippedCount}`);
  }
  console.log(`   📊 Total audited: ${results.length}`);
  
  if (envMismatches.length > 0) {
    console.log(`\n⚠️  ${envMismatches.length} env var mismatch(es) detected - update .env.local or Vercel`);
  }
  
  if (outdatedCount > 0) {
    console.log("\n💡 To upgrade outdated markets, run:");
    console.log("   npx hardhat run scripts/batch-upgrade-market-facets.js --network hyperliquid");
    console.log("\n   Or for a specific market:");
    console.log("   MARKET_ADDRESS=0x... npx hardhat run scripts/upgrade-single-placement-facet.js --network hyperliquid");
  }
  
  if (jsonOutput) {
    console.log("\n" + JSON.stringify({ 
      reference: referenceMarket,
      envMismatches,
      results, 
      summary: { 
        upToDate: upToDateCount, 
        outdated: outdatedCount, 
        skipped: skippedCount,
        total: results.length 
      } 
    }, null, 2));
  }
  
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Audit failed:", e?.message || String(e));
    process.exit(1);
  });
