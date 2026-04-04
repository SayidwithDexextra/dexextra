#!/usr/bin/env node
/**
 * upgrade-lifecycle-gasless-challenge.js
 *
 * Upgrades MarketLifecycleFacet on market Diamonds to add the gasless
 * challengeSettlementFor(address, uint256) function. This allows
 * the contract owner to challenge on behalf of a user via a relayer.
 *
 * Steps:
 *   1. Fetch markets from Supabase (or use a single address)
 *   2. Deploy the new MarketLifecycleFacet (or reuse an existing address)
 *   3. For each market: diamondCut — Replace existing selectors + Add new ones
 *
 * Env required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)
 *   ADMIN_PRIVATE_KEY (required), ADMIN_PRIVATE_KEY_2/3 (optional fallbacks)
 *
 * Usage:
 *   npx hardhat run scripts/upgrade-lifecycle-gasless-challenge.js --network hyperliquid
 */

const { ethers, artifacts } = require("hardhat");
const readline = require("readline");

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

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

function padRight(str, len) {
  str = String(str || "");
  return str.length >= len ? str : str + " ".repeat(len - str.length);
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
  return { selectors: sels, abi: artifact.abi };
}

async function fetchMarkets() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("markets")
    .select("id, symbol, market_identifier, market_address, market_status, is_active, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const rows = (data || []).filter((r) => isAddress(r.market_address));
  if (!rows.length) throw new Error("No markets with market_address found in Supabase.");
  return rows;
}

async function upgradeMarket({ orderBook, symbol, signer, facetAddress, selectors }) {
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    orderBook,
    ethers.provider,
  );
  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const add = [];
  const rep = [];
  const targetFacet = facetAddress.toLowerCase();

  for (const sel of selectors) {
    let cur = ethers.ZeroAddress;
    try {
      cur = await loupe.facetAddress(sel);
    } catch {
      cur = ethers.ZeroAddress;
    }
    if (!cur || cur === ethers.ZeroAddress) add.push(sel);
    else if (cur.toLowerCase() !== targetFacet) rep.push(sel);
  }

  if (!add.length && !rep.length) {
    console.log(`   ⏭️  ${symbol}: all selectors already point to this facet — skipping`);
    return { skipped: true };
  }

  console.log(`   📋 ${symbol}: replace=${rep.length} add=${add.length}`);
  if (add.length) console.log(`      New selectors: ${add.join(", ")}`);

  const cut = [];
  if (rep.length) cut.push({ facetAddress, action: FacetCutAction.Replace, functionSelectors: rep });
  if (add.length) cut.push({ facetAddress, action: FacetCutAction.Add, functionSelectors: add });

  const diamond = await ethers.getContractAt("IDiamondCut", orderBook, signer);
  const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
  console.log(`      tx: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`      ✅ mined at block ${rc.blockNumber}, gasUsed ${rc.gasUsed.toString()}`);
  return { skipped: false, txHash: tx.hash };
}

async function main() {
  console.log("\n💎 Upgrade MarketLifecycleFacet — Gasless challengeSettlementFor");
  console.log("═".repeat(80));

  // 1) Resolve signer
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing/invalid ADMIN_PRIVATE_KEY in env.");

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  const primaryDeployer = w1;
  console.log("👤 Primary deployer:", await w1.getAddress());

  // 2) Fetch markets
  console.log("\n🔎 Fetching markets from Supabase...");
  const markets = await fetchMarkets();
  console.log(`   Found ${markets.length} market(s) with contract addresses.\n`);

  console.log(padRight("Idx", 6), padRight("Symbol", 30), padRight("Address", 44), padRight("Active", 8), "Status");
  console.log("-".repeat(110));
  markets.forEach((m, i) => {
    console.log(
      padRight(`[${i}]`, 6),
      padRight(m.symbol || m.market_identifier, 30),
      padRight(m.market_address, 44),
      padRight(m.is_active ? "yes" : "no", 8),
      String(m.market_status || ""),
    );
  });

  const idxStr = (await ask(`\nSelect market index (or "all" for all markets): `)).trim().toLowerCase();
  let selectedMarkets;
  if (idxStr === "all") {
    selectedMarkets = markets;
    console.log(`\n🎯 Selected ALL ${markets.length} markets`);
  } else {
    const idx = Number(idxStr);
    if (!Number.isFinite(idx) || idx < 0 || idx >= markets.length) throw new Error("Invalid index");
    selectedMarkets = [markets[idx]];
    console.log(`\n🎯 Selected: ${selectedMarkets[0].symbol || selectedMarkets[0].market_identifier} @ ${selectedMarkets[0].market_address}`);
  }

  // 3) Deploy or reuse facet
  let facetAddress = String(process.env.MARKET_LIFECYCLE_FACET || "").trim();
  const deployAns = (await ask("\nDeploy NEW MarketLifecycleFacet? [Y/n]: ")).trim().toLowerCase();
  if (deployAns === "n" || deployAns === "no") {
    if (!isAddress(facetAddress)) {
      facetAddress = (await ask("Enter existing MarketLifecycleFacet address: ")).trim();
    }
    if (!isAddress(facetAddress)) throw new Error("Invalid facet address");
    console.log(`   ℹ️  Using existing facet: ${facetAddress}`);
  } else {
    console.log("🚀 Deploying MarketLifecycleFacet...");
    const Factory = await ethers.getContractFactory("MarketLifecycleFacet", primaryDeployer);
    const facet = await Factory.deploy();
    await facet.waitForDeployment();
    facetAddress = await facet.getAddress();
    const depTx = facet.deploymentTransaction && facet.deploymentTransaction();
    console.log(`   ✅ Deployed at: ${facetAddress}`);
    console.log(`      tx: ${depTx?.hash || "(unknown)"}`);
  }

  // 4) Build selectors from artifact
  const { selectors } = await selectorsFromArtifact("MarketLifecycleFacet");
  console.log(`\n📋 Total selectors from artifact: ${selectors.length}`);

  // 5) Upgrade each market
  console.log("\n🧩 Applying diamondCut to selected markets...\n");
  const results = [];

  for (const market of selectedMarkets) {
    const orderBook = market.market_address.trim();
    const label = market.symbol || market.market_identifier;

    // Resolve the correct signer (must match diamond owner)
    let signer;
    try {
      const ownerView = await ethers.getContractAt(["function owner() view returns (address)"], orderBook, ethers.provider);
      const owner = await ownerView.owner();
      const ownerLc = owner.toLowerCase();
      const candidates = [
        { w: w1, addr: (await w1.getAddress()).toLowerCase() },
        ...(w2 ? [{ w: w2, addr: (await w2.getAddress()).toLowerCase() }] : []),
        ...(w3 ? [{ w: w3, addr: (await w3.getAddress()).toLowerCase() }] : []),
      ];
      const picked = candidates.find((c) => c.addr === ownerLc);
      if (!picked) {
        console.log(`   ❌ ${label}: no signer matches owner ${owner} — skipping`);
        results.push({ label, orderBook, status: "owner_mismatch" });
        continue;
      }
      signer = picked.w;
    } catch (err) {
      console.log(`   ❌ ${label}: failed to read owner — ${err?.message || err}`);
      results.push({ label, orderBook, status: "error", error: err?.message });
      continue;
    }

    try {
      const res = await upgradeMarket({ orderBook, symbol: label, signer, facetAddress, selectors });
      results.push({ label, orderBook, status: res.skipped ? "skipped" : "upgraded", txHash: res.txHash });
    } catch (err) {
      console.log(`   ❌ ${label}: diamondCut failed — ${err?.message || err}`);
      results.push({ label, orderBook, status: "error", error: err?.message });
    }
  }

  // 6) Summary
  console.log("\n" + "═".repeat(80));
  console.log("📊 Results:\n");
  const upgraded = results.filter((r) => r.status === "upgraded");
  const skipped = results.filter((r) => r.status === "skipped");
  const failed = results.filter((r) => r.status === "error" || r.status === "owner_mismatch");
  console.log(`   ✅ Upgraded: ${upgraded.length}`);
  console.log(`   ⏭️  Skipped:  ${skipped.length}`);
  console.log(`   ❌ Failed:   ${failed.length}`);
  if (failed.length) {
    console.log("\n   Failed markets:");
    failed.forEach((r) => console.log(`      ${r.label} @ ${r.orderBook}: ${r.status} ${r.error || ""}`));
  }
  console.log(`\n   Facet: ${facetAddress}`);
  console.log("   New function: challengeSettlementFor(address challenger, uint256 alternativePrice)");
  console.log("\n✅ Done.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ upgrade-lifecycle-gasless-challenge failed:", e?.message || String(e));
    process.exit(1);
  });
