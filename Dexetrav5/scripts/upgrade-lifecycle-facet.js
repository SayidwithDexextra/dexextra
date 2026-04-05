#!/usr/bin/env node

/**
 * upgrade-lifecycle-facet.js
 *
 * Deploys a new MarketLifecycleFacet and performs a diamondCut Replace
 * on one or more market Diamonds.
 *
 * Usage:
 *   npx hardhat run scripts/upgrade-lifecycle-facet.js --network hyperliquid
 *
 * Env vars:
 *   MARKET_ADDRESS - Single market to upgrade (optional, will prompt if not set)
 *   MARKET_LIFECYCLE_FACET - Use existing facet address instead of deploying new
 */

const { ethers, artifacts } = require("hardhat");
const readline = require("readline");

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

async function fetchMarkets() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("markets")
    .select("id, symbol, market_identifier, market_address, settlement_date, market_status")
    .not("market_address", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);
  
  if (error) {
    console.error("Supabase error:", error.message);
    return null;
  }
  return (data || []).filter((r) => /^0x[a-fA-F0-9]{40}$/.test(r.market_address));
}

async function getLifecycleSelectors() {
  const artifact = await artifacts.readArtifact("MarketLifecycleFacet");
  const fns = (artifact.abi || []).filter((e) => e && e.type === "function");
  return fns.map((f) => {
    const sig = `${f.name}(${(f.inputs || []).map((i) => i.type).join(",")})`;
    return ethers.id(sig).slice(0, 10);
  });
}

async function main() {
  const [signer] = await ethers.getSigners();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";

  console.log("\n" + "=".repeat(70));
  console.log("  UPGRADE MarketLifecycleFacet");
  console.log("=".repeat(70));
  console.log(`Network:  ${networkName}`);
  console.log(`Signer:   ${signer.address}`);
  console.log("=".repeat(70));

  // Step 1: Deploy new facet (or use existing)
  let facetAddress = (process.env.MARKET_LIFECYCLE_FACET || "").trim();
  
  if (!/^0x[a-fA-F0-9]{40}$/.test(facetAddress)) {
    console.log("\n📦 Deploying new MarketLifecycleFacet...");
    const FacetFactory = await ethers.getContractFactory("MarketLifecycleFacet");
    const facet = await FacetFactory.deploy();
    await facet.waitForDeployment();
    facetAddress = await facet.getAddress();
    console.log(`   ✅ Deployed at: ${facetAddress}`);
  } else {
    console.log(`\n📦 Using existing facet: ${facetAddress}`);
  }

  // Step 2: Select market(s) to upgrade
  let targetAddress = (process.env.MARKET_ADDRESS || "").trim();
  
  if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
    console.log("\n🔎 Fetching markets from Supabase...");
    const markets = await fetchMarkets();
    
    if (markets && markets.length > 0) {
      console.log("\nAvailable markets:");
      markets.forEach((m, i) => {
        console.log(`  [${i}] ${(m.symbol || m.market_identifier).padEnd(20)} ${m.market_address} (${m.market_status || 'unknown'})`);
      });
      
      const choice = await ask("\nSelect market index (or 'all' to upgrade all, or paste address): ");
      
      if (choice.toLowerCase() === 'all') {
        // Upgrade all markets
        console.log(`\n🚀 Upgrading ALL ${markets.length} markets...`);
        for (let i = 0; i < markets.length; i++) {
          const m = markets[i];
          console.log(`\n[${i + 1}/${markets.length}] ${m.symbol || m.market_identifier}`);
          await upgradeSingleMarket(m.market_address, facetAddress);
        }
        console.log("\n✅ All markets upgraded!");
        return;
      } else if (/^\d+$/.test(choice)) {
        const idx = parseInt(choice);
        if (idx >= 0 && idx < markets.length) {
          targetAddress = markets[idx].market_address;
          console.log(`\n🎯 Selected: ${markets[idx].symbol || markets[idx].market_identifier}`);
        }
      } else if (/^0x[a-fA-F0-9]{40}$/.test(choice)) {
        targetAddress = choice;
      }
    }
    
    if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
      targetAddress = await ask("Enter market Diamond address: ");
    }
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
    throw new Error("Invalid market address");
  }

  await upgradeSingleMarket(targetAddress, facetAddress);
  console.log("\n✅ Upgrade complete!");
}

async function upgradeSingleMarket(marketAddress, facetAddress) {
  console.log(`   Market: ${marketAddress}`);
  console.log(`   Facet:  ${facetAddress}`);

  // Get selectors
  const selectors = await getLifecycleSelectors();
  console.log(`   Selectors: ${selectors.length} functions`);

  // Check which selectors already exist on the diamond
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4 selector) external view returns (address)"],
    marketAddress
  );

  const existingSelectors = [];
  const newSelectors = [];

  for (const sel of selectors) {
    try {
      const existingFacet = await loupe.facetAddress(sel);
      if (existingFacet !== ethers.ZeroAddress) {
        existingSelectors.push(sel);
      } else {
        newSelectors.push(sel);
      }
    } catch {
      newSelectors.push(sel);
    }
  }

  console.log(`   Existing selectors to Replace: ${existingSelectors.length}`);
  console.log(`   New selectors to Add: ${newSelectors.length}`);

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const cuts = [];

  if (existingSelectors.length > 0) {
    cuts.push({
      facetAddress: facetAddress,
      action: FacetCutAction.Replace,
      functionSelectors: existingSelectors,
    });
  }

  if (newSelectors.length > 0) {
    cuts.push({
      facetAddress: facetAddress,
      action: FacetCutAction.Add,
      functionSelectors: newSelectors,
    });
  }

  if (cuts.length === 0) {
    console.log("   ⚠️  No selectors to update");
    return;
  }

  // Execute diamondCut
  const diamond = await ethers.getContractAt("IDiamondCut", marketAddress);
  console.log("   🔧 Executing diamondCut...");
  
  const tx = await diamond.diamondCut(cuts, ethers.ZeroAddress, "0x", { gasLimit: 2_000_000n });
  console.log(`   Tx: ${tx.hash}`);
  
  const receipt = await tx.wait();
  console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Error:", e?.message || String(e));
    process.exit(1);
  });
