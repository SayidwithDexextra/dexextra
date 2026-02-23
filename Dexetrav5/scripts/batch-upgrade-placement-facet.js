#!/usr/bin/env node
/**
 * batch-upgrade-placement-facet.js
 *
 * Deploys OBOrderPlacementFacet once, then performs diamondCut on ALL active
 * markets except the ones listed in SKIP_ADDRESSES.
 *
 * Usage:
 *   npx hardhat run scripts/batch-upgrade-placement-facet.js --network hyperliquid
 */
const { ethers, artifacts } = require("hardhat");

const SKIP_ADDRESSES = new Set([
  "0xB6Ca359d31582BBa368a890Ed60e6e0E81937AA2".toLowerCase(), // BTC - already upgraded
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

async function main() {
  console.log("\n💎 Batch OBOrderPlacementFacet Upgrade");
  console.log("═".repeat(80));

  // Resolve admin keys
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing/invalid ADMIN_PRIVATE_KEY in env.");

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  const deployer = w1;

  console.log("Deployer:", await deployer.getAddress());

  // Use already-deployed OBOrderPlacementFacet from env
  const facetAddress = process.env.OB_ORDER_PLACEMENT_FACET;
  if (!facetAddress || !isAddress(facetAddress)) {
    throw new Error("Missing or invalid OB_ORDER_PLACEMENT_FACET in env.");
  }
  console.log(`\n✅ Using existing OBOrderPlacementFacet: ${facetAddress}`);

  // Get selectors
  const selectors = await selectorsFromArtifact("OBOrderPlacementFacet");
  console.log(`   ${selectors.length} selectors`);

  // Fetch markets
  console.log("\n🔎 Fetching markets from Supabase...");
  const allMarkets = await fetchMarkets();
  const markets = allMarkets.filter(
    (m) => m.is_active && !SKIP_ADDRESSES.has(m.market_address.trim().toLowerCase())
  );
  console.log(`   ${allMarkets.length} total, ${markets.length} active markets to upgrade (excluding skipped)\n`);

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
      // Resolve diamond owner -> pick matching signer
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

      // Build diamond cut (add new selectors, replace existing ones)
      const loupe = await ethers.getContractAt(
        ["function facetAddress(bytes4) view returns (address)"],
        orderBook,
        ethers.provider
      );
      const add = [];
      const rep = [];
      const targetLc = facetAddress.toLowerCase();
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

      const cut = [];
      if (rep.length) cut.push({ facetAddress, action: FacetCutAction.Replace, functionSelectors: rep });
      if (add.length) cut.push({ facetAddress, action: FacetCutAction.Add, functionSelectors: add });

      if (!cut.length) {
        console.log(`   ℹ️ Already up-to-date`);
        skipped++;
        continue;
      }

      console.log(`   replace=${rep.length} add=${add.length}`);
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
  console.log(`Facet address: ${facetAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ batch upgrade failed:", e?.message || String(e));
    process.exit(1);
  });
