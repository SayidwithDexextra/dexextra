#!/usr/bin/env node
/**
 * upgrade-orderbook-optimization.js
 *
 * Deploys optimized order book facets (OBOrderPlacementFacet, OBTradeExecutionFacet, 
 * OBLiquidationFacet) and performs diamondCut on ALL active markets.
 *
 * Optimizations included:
 * - Sorted price linked lists for O(1) price level navigation
 * - Doubly-linked orders for O(1) order removal
 * - O(1) user order indexing
 * - Batched trade execution
 * - Deferred liquidation checks
 *
 * Usage:
 *   npx hardhat run scripts/upgrade-orderbook-optimization.js --network hyperliquid
 *
 * Environment variables required:
 *   ADMIN_PRIVATE_KEY - Primary admin key
 *   ADMIN_PRIVATE_KEY_2 - (optional) Secondary admin key
 *   ADMIN_PRIVATE_KEY_3 - (optional) Tertiary admin key
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
 *
 * Optional:
 *   SKIP_DEPLOY=true - Skip facet deployment, use existing addresses
 *   OB_ORDER_PLACEMENT_FACET - Pre-deployed OBOrderPlacementFacet address
 *   OB_TRADE_EXECUTION_FACET - Pre-deployed OBTradeExecutionFacet address
 *   OB_LIQUIDATION_FACET - Pre-deployed OBLiquidationFacet address
 */
const { ethers, artifacts } = require("hardhat");

const SKIP_ADDRESSES = new Set([
  // Add any market addresses to skip here
]);

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

function renderType(t) {
  const type = t.type || "";
  const arraySuffixMatch = type.match(/(\[.*\])$/);
  const arraySuffix = arraySuffixMatch ? arraySuffixMatch[1] : "";
  const base = type.replace(/(\[.*\])$/, "");
  if (base === "tuple") {
    const comps = (t.components || []).map(renderType).join(",");
    return `(${comps})${arraySuffix}`;
  }
  return `${base}${arraySuffix}`;
}

async function selectorsFromArtifact(contractName) {
  const artifact = await artifacts.readArtifact(contractName);
  const fns = (artifact.abi || []).filter((e) => e && e.type === "function");
  const sels = fns.map((f) => {
    const inputsSig = (f.inputs || []).map(renderType).join(",");
    const sig = `${f.name}(${inputsSig})`;
    return ethers.id(sig).slice(0, 10);
  });
  return sels;
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

async function deployFacet(deployer, contractName) {
  console.log(`\n📦 Deploying ${contractName}...`);
  const Factory = await ethers.getContractFactory(contractName, deployer);
  const facet = await Factory.deploy();
  await facet.waitForDeployment();
  const address = await facet.getAddress();
  console.log(`   ✅ Deployed to: ${address}`);
  return address;
}

async function main() {
  console.log("\n💎 Order Book Optimization Upgrade");
  console.log("═".repeat(80));
  console.log("\nOptimizations:");
  console.log("  • Sorted price linked lists (O(1) navigation)");
  console.log("  • Doubly-linked orders (O(1) removal)");
  console.log("  • O(1) user order indexing");
  console.log("  • Batched trade execution");
  console.log("  • Deferred liquidation checks");
  console.log("═".repeat(80));

  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing/invalid ADMIN_PRIVATE_KEY in env.");

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  const deployer = w1;

  console.log("\nDeployer:", await deployer.getAddress());

  const skipDeploy = process.env.SKIP_DEPLOY === "true";
  let placementFacetAddr, executionFacetAddr, liquidationFacetAddr;

  if (skipDeploy) {
    placementFacetAddr = process.env.OB_ORDER_PLACEMENT_FACET;
    executionFacetAddr = process.env.OB_TRADE_EXECUTION_FACET;
    liquidationFacetAddr = process.env.OB_LIQUIDATION_FACET;
    
    if (!isAddress(placementFacetAddr) || !isAddress(executionFacetAddr) || !isAddress(liquidationFacetAddr)) {
      throw new Error("SKIP_DEPLOY=true but missing facet addresses in env");
    }
    
    console.log("\n✅ Using pre-deployed facets:");
    console.log(`   OBOrderPlacementFacet: ${placementFacetAddr}`);
    console.log(`   OBTradeExecutionFacet: ${executionFacetAddr}`);
    console.log(`   OBLiquidationFacet: ${liquidationFacetAddr}`);
  } else {
    placementFacetAddr = await deployFacet(deployer, "OBOrderPlacementFacet");
    executionFacetAddr = await deployFacet(deployer, "OBTradeExecutionFacet");
    liquidationFacetAddr = await deployFacet(deployer, "OBLiquidationFacet");
    
    console.log("\n📋 Deployed facet addresses (save these for env):");
    console.log(`   OB_ORDER_PLACEMENT_FACET=${placementFacetAddr}`);
    console.log(`   OB_TRADE_EXECUTION_FACET=${executionFacetAddr}`);
    console.log(`   OB_LIQUIDATION_FACET=${liquidationFacetAddr}`);
  }

  const placementSelectors = await selectorsFromArtifact("OBOrderPlacementFacet");
  const executionSelectors = await selectorsFromArtifact("OBTradeExecutionFacet");
  const liquidationSelectors = await selectorsFromArtifact("OBLiquidationFacet");

  console.log(`\n📊 Selector counts:`);
  console.log(`   OBOrderPlacementFacet: ${placementSelectors.length}`);
  console.log(`   OBTradeExecutionFacet: ${executionSelectors.length}`);
  console.log(`   OBLiquidationFacet: ${liquidationSelectors.length}`);

  console.log("\n🔎 Fetching markets from Supabase...");
  const allMarkets = await fetchMarkets();
  const markets = allMarkets.filter(
    (m) => m.is_active && !SKIP_ADDRESSES.has(m.market_address.trim().toLowerCase())
  );
  console.log(`   ${allMarkets.length} total, ${markets.length} active markets to upgrade\n`);

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const orderBook = m.market_address.trim();
    const label = `[${i + 1}/${markets.length}] ${m.symbol || m.market_identifier}`;
    console.log(`\n${label} @ ${orderBook}`);

    try {
      const ownerView = await ethers.getContractAt(
        ["function owner() view returns (address)"],
        orderBook,
        ethers.provider
      );
      const owner = (await ownerView.owner()).toLowerCase();
      const candidates = [
        { w: w1, addr: (await w1.getAddress()).toLowerCase() },
        ...(w2 ? [{ w: w2, addr: (await w2.getAddress()).toLowerCase() }] : []),
        ...(w3 ? [{ w: w3, addr: (await w3.getAddress()).toLowerCase() }] : []),
      ];
      const picked = candidates.find((c) => c.addr === owner);
      if (!picked) {
        console.log(`   ⚠️ SKIP: no admin key matches owner ${owner}`);
        skipped++;
        continue;
      }
      const signer = picked.w;

      const loupe = await ethers.getContractAt(
        ["function facetAddress(bytes4) view returns (address)"],
        orderBook,
        ethers.provider
      );

      const cut = [];

      for (const { facetAddr, selectors, name } of [
        { facetAddr: placementFacetAddr, selectors: placementSelectors, name: "Placement" },
        { facetAddr: executionFacetAddr, selectors: executionSelectors, name: "Execution" },
        { facetAddr: liquidationFacetAddr, selectors: liquidationSelectors, name: "Liquidation" },
      ]) {
        const add = [];
        const rep = [];
        const targetLc = facetAddr.toLowerCase();
        
        for (const sel of selectors) {
          let cur = ethers.ZeroAddress;
          try {
            cur = await loupe.facetAddress(sel);
          } catch {
            cur = ethers.ZeroAddress;
          }
          if (!cur || cur === ethers.ZeroAddress) add.push(sel);
          else if (cur.toLowerCase() !== targetLc) rep.push(sel);
        }

        if (rep.length) cut.push({ facetAddress: facetAddr, action: FacetCutAction.Replace, functionSelectors: rep });
        if (add.length) cut.push({ facetAddress: facetAddr, action: FacetCutAction.Add, functionSelectors: add });
        
        if (rep.length || add.length) {
          console.log(`   ${name}: replace=${rep.length} add=${add.length}`);
        }
      }

      if (!cut.length) {
        console.log(`   ℹ️ Already up-to-date`);
        skipped++;
        continue;
      }

      const diamond = await ethers.getContractAt("IDiamondCut", orderBook, signer);
      const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
      console.log(`   tx: ${tx.hash}`);
      const rc = await tx.wait();
      console.log(`   ✅ mined block ${rc.blockNumber}, gas ${rc.gasUsed.toString()}`);
      success++;
    } catch (e) {
      console.log(`   ❌ FAILED: ${e.message?.slice(0, 120)}`);
      failed++;
    }
  }

  console.log("\n" + "═".repeat(80));
  console.log(`Done. success=${success} skipped=${skipped} failed=${failed}`);
  console.log("\nDeployed facet addresses:");
  console.log(`  OB_ORDER_PLACEMENT_FACET=${placementFacetAddr}`);
  console.log(`  OB_TRADE_EXECUTION_FACET=${executionFacetAddr}`);
  console.log(`  OB_LIQUIDATION_FACET=${liquidationFacetAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ upgrade failed:", e?.message || String(e));
    process.exit(1);
  });
