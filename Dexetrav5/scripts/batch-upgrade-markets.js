#!/usr/bin/env node
/**
 * batch-upgrade-markets.js
 *
 * Performs diamondCut on multiple markets to upgrade ALL outdated facets.
 * Uses the reference market (0x78BB10E8...) to determine correct facet addresses.
 *
 * Usage:
 *   MARKETS="0x...,0x...,0x..." npx hardhat run scripts/batch-upgrade-markets.js --network hyperliquid
 */
const { ethers, artifacts } = require("hardhat");
const path = require("path");

// Load env
try {
  require("dotenv").config({ path: path.join(process.cwd(), "..", ".env.local") });
  require("dotenv").config({ path: path.join(process.cwd(), "..", ".env") });
} catch (_) {}

const REFERENCE_MARKET = "0x78BB10E86BC6958307FEfd5EbD2206F6ab149795";

const FACET_CONFIGS = [
  { name: "OBOrderPlacementFacet", envKey: "OB_ORDER_PLACEMENT_FACET" },
  { name: "OBTradeExecutionFacet", envKey: "OB_TRADE_EXECUTION_FACET" },
  { name: "OBLiquidationFacet", envKey: "OB_LIQUIDATION_FACET" },
  { name: "OBSettlementFacet", envKey: "OB_SETTLEMENT_FACET" },
  { name: "OBViewFacet", envKey: "OB_VIEW_FACET" },
  { name: "MarketLifecycleFacet", envKey: "MARKET_LIFECYCLE_FACET" },
  { name: "MetaTradeFacet", envKey: "META_TRADE_FACET" },
];

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
  try {
    const artifact = await artifacts.readArtifact(contractName);
    const fns = (artifact.abi || []).filter((e) => e && e.type === "function");
    return fns.map((f) => {
      const inputsSig = (f.inputs || []).map(renderType).join(",");
      const sig = `${f.name}(${inputsSig})`;
      return ethers.id(sig).slice(0, 10);
    });
  } catch {
    return [];
  }
}

async function getReferenceFacetAddresses() {
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    REFERENCE_MARKET
  );
  
  const facetAddresses = {};
  
  for (const config of FACET_CONFIGS) {
    const selectors = await selectorsFromArtifact(config.name);
    if (selectors.length === 0) continue;
    
    try {
      const addr = await loupe.facetAddress(selectors[0]);
      if (addr && addr !== ethers.ZeroAddress) {
        facetAddresses[config.name] = addr;
      }
    } catch {}
  }
  
  return facetAddresses;
}

async function upgradeMarket(marketAddress, referenceFacets, signer) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`📍 Upgrading: ${marketAddress}`);
  
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    marketAddress
  );
  
  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const cuts = [];
  
  for (const config of FACET_CONFIGS) {
    const targetAddr = referenceFacets[config.name];
    if (!targetAddr) continue;
    
    const selectors = await selectorsFromArtifact(config.name);
    if (selectors.length === 0) continue;
    
    const add = [];
    const rep = [];
    const targetLc = targetAddr.toLowerCase();
    
    for (const sel of selectors) {
      let cur = ethers.ZeroAddress;
      try {
        cur = await loupe.facetAddress(sel);
      } catch {
        cur = ethers.ZeroAddress;
      }
      
      if (!cur || cur === ethers.ZeroAddress) {
        add.push(sel);
      } else if (cur.toLowerCase() !== targetLc) {
        rep.push(sel);
      }
    }
    
    if (rep.length > 0) {
      cuts.push({ facetAddress: targetAddr, action: FacetCutAction.Replace, functionSelectors: rep });
      console.log(`   ${config.name}: ${rep.length} replace`);
    }
    if (add.length > 0) {
      cuts.push({ facetAddress: targetAddr, action: FacetCutAction.Add, functionSelectors: add });
      console.log(`   ${config.name}: ${add.length} add`);
    }
  }
  
  if (cuts.length === 0) {
    console.log("   ✅ Already up-to-date");
    return { success: true, noChanges: true };
  }
  
  try {
    const diamond = await ethers.getContractAt("IDiamondCut", marketAddress, signer);
    const tx = await diamond.diamondCut(cuts, ethers.ZeroAddress, "0x");
    console.log(`   tx: ${tx.hash}`);
    const rc = await tx.wait();
    console.log(`   ✅ Mined in block ${rc.blockNumber}, gas: ${rc.gasUsed.toString()}`);
    return { success: true };
  } catch (e) {
    console.log(`   ❌ FAILED: ${e.message?.slice(0, 100)}`);
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log("\n💎 Batch Market Upgrade");
  console.log("═".repeat(80));
  
  // Parse markets from env
  const marketsEnv = process.env.MARKETS || "";
  const markets = marketsEnv.split(",").map(m => m.trim()).filter(m => /^0x[a-fA-F0-9]{40}$/.test(m));
  
  if (markets.length === 0) {
    throw new Error("No valid markets provided. Set MARKETS='0x...,0x...' env var.");
  }
  
  console.log(`\n📊 Markets to upgrade: ${markets.length}`);
  markets.forEach((m, i) => console.log(`   ${i + 1}. ${m}`));
  
  // Get reference facet addresses
  console.log(`\n🎯 Fetching facet addresses from reference market...`);
  console.log(`   Reference: ${REFERENCE_MARKET}`);
  const referenceFacets = await getReferenceFacetAddresses();
  console.log(`   Found ${Object.keys(referenceFacets).length} facets:`);
  for (const [name, addr] of Object.entries(referenceFacets)) {
    console.log(`   - ${name}: ${addr.slice(0, 10)}...`);
  }
  
  // Resolve admin keys
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing/invalid ADMIN_PRIVATE_KEY in env.");
  
  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  
  const signers = [
    { w: w1, addr: (await w1.getAddress()).toLowerCase() },
    ...(w2 ? [{ w: w2, addr: (await w2.getAddress()).toLowerCase() }] : []),
    ...(w3 ? [{ w: w3, addr: (await w3.getAddress()).toLowerCase() }] : []),
  ];
  
  console.log(`\n🔑 Available signers: ${signers.map(s => s.addr.slice(0, 10) + '...').join(', ')}`);
  
  // Upgrade each market
  const results = { success: 0, failed: 0, noChanges: 0 };
  
  for (const marketAddress of markets) {
    try {
      // Get owner and find matching signer
      const ownerView = await ethers.getContractAt(
        ["function owner() view returns (address)"],
        marketAddress
      );
      const owner = (await ownerView.owner()).toLowerCase();
      const picked = signers.find(s => s.addr === owner);
      
      if (!picked) {
        console.log(`\n${"─".repeat(60)}`);
        console.log(`📍 ${marketAddress}`);
        console.log(`   ❌ No signer matches owner ${owner}`);
        results.failed++;
        continue;
      }
      
      const result = await upgradeMarket(marketAddress, referenceFacets, picked.w);
      if (result.success) {
        if (result.noChanges) {
          results.noChanges++;
        } else {
          results.success++;
        }
      } else {
        results.failed++;
      }
    } catch (e) {
      console.log(`\n${"─".repeat(60)}`);
      console.log(`📍 ${marketAddress}`);
      console.log(`   ❌ ERROR: ${e.message?.slice(0, 100)}`);
      results.failed++;
    }
  }
  
  // Summary
  console.log("\n" + "═".repeat(80));
  console.log("📈 Summary:");
  console.log(`   ✅ Upgraded: ${results.success}`);
  console.log(`   ⏭️  No changes needed: ${results.noChanges}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  console.log(`   📊 Total: ${markets.length}`);
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Batch upgrade failed:", e?.message || String(e));
    process.exit(1);
  });
