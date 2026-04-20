#!/usr/bin/env node
/**
 * upgrade-single-market-facets.js
 * 
 * Upgrades a single market's facets via diamondCut.
 * Usage: MARKET_SYMBOL="BANANA" npx hardhat run scripts/upgrade-single-market-facets.js --network hyperliquid
 */
const { ethers, artifacts } = require("hardhat");

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
  return fns.map((f) => {
    const inputsSig = (f.inputs || []).map(renderType).join(",");
    const sig = `${f.name}(${inputsSig})`;
    return ethers.id(sig).slice(0, 10);
  });
}

async function main() {
  const searchTerm = process.env.MARKET_SYMBOL || "BANANA";
  console.log(`\n🔍 Searching for market: ${searchTerm}`);
  console.log("═".repeat(60));

  // Find market in Supabase
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: markets, error } = await supabase
    .from("markets")
    .select("id, symbol, market_identifier, market_address, is_active")
    .or(`symbol.ilike.%${searchTerm}%,market_identifier.ilike.%${searchTerm}%`)
    .limit(10);

  if (error) throw error;
  if (!markets || markets.length === 0) {
    throw new Error(`No market found matching "${searchTerm}"`);
  }

  console.log(`\nFound ${markets.length} market(s):`);
  markets.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.symbol || m.market_identifier}`);
    console.log(`     Address: ${m.market_address}`);
    console.log(`     Active: ${m.is_active}`);
  });

  // Use the first match
  const market = markets[0];
  const orderBook = market.market_address;
  console.log(`\n📍 Upgrading: ${market.symbol || market.market_identifier}`);
  console.log(`   Address: ${orderBook}`);

  // Setup signer
  const pk = process.env.ADMIN_PRIVATE_KEY;
  if (!pk) throw new Error("Missing ADMIN_PRIVATE_KEY");
  const signer = new ethers.Wallet(pk, ethers.provider);
  console.log(`   Signer: ${signer.address}`);

  // Check ownership
  const ownerView = await ethers.getContractAt(
    ["function owner() view returns (address)"],
    orderBook,
    ethers.provider
  );
  const owner = await ownerView.owner();
  console.log(`   Owner: ${owner}`);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not the owner. Owner: ${owner}`);
  }

  // New facet addresses (from env or defaults from recent deployment)
  const liquidationFacet = process.env.OB_LIQUIDATION_FACET || "0xA82D87f1fbEe7f1BaC4a4Abd96FffA6bE5D18d89";
  
  console.log(`\n📦 New OBLiquidationFacet: ${liquidationFacet}`);

  // Get selectors
  const liquidationSelectors = await selectorsFromArtifact("OBLiquidationFacet");
  console.log(`   Selectors: ${liquidationSelectors.length}`);

  // Check current facet mappings
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    orderBook,
    ethers.provider
  );

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const cut = [];
  const add = [];
  const rep = [];

  for (const sel of liquidationSelectors) {
    let cur = ethers.ZeroAddress;
    try {
      cur = await loupe.facetAddress(sel);
    } catch {
      cur = ethers.ZeroAddress;
    }
    
    if (!cur || cur === ethers.ZeroAddress) {
      add.push(sel);
    } else if (cur.toLowerCase() !== liquidationFacet.toLowerCase()) {
      rep.push(sel);
    }
  }

  if (rep.length) {
    cut.push({ facetAddress: liquidationFacet, action: FacetCutAction.Replace, functionSelectors: rep });
    console.log(`   Replace: ${rep.length} selectors`);
  }
  if (add.length) {
    cut.push({ facetAddress: liquidationFacet, action: FacetCutAction.Add, functionSelectors: add });
    console.log(`   Add: ${add.length} selectors`);
  }

  if (cut.length === 0) {
    console.log("\n✓ Market already has the latest facet!");
    return;
  }

  // Execute diamondCut
  console.log("\n🔧 Executing diamondCut...");
  const nonce = await ethers.provider.getTransactionCount(signer.address, "pending");
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ? feeData.gasPrice * 2n : undefined;

  const diamond = await ethers.getContractAt("IDiamondCut", orderBook, signer);
  const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x", { nonce, gasPrice });
  console.log(`   tx: ${tx.hash}`);
  
  const receipt = await tx.wait();
  console.log(`   ✅ Mined block ${receipt.blockNumber}, gas ${receipt.gasUsed.toString()}`);

  // Verify
  const verifyAddr = await loupe.facetAddress(liquidationSelectors[0]);
  console.log(`\n✓ Selector ${liquidationSelectors[0]} → ${verifyAddr}`);
  console.log("\n" + "═".repeat(60));
  console.log("Done! Market upgraded successfully.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Failed:", e?.message || String(e));
    process.exit(1);
  });
