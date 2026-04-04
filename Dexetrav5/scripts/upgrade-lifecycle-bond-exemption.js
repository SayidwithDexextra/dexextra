#!/usr/bin/env node
/**
 * upgrade-lifecycle-bond-exemption.js
 *
 * Upgrades MarketLifecycleFacet on a selected market's Diamond to add
 * proposal bond exemption support (v5 storage). After the diamond cut it
 * optionally grants exemption to an AI worker address.
 *
 * Steps:
 *   1. Fetch markets from Supabase, let you pick one (or all)
 *   2. Deploy the new MarketLifecycleFacet (or reuse an existing address)
 *   3. diamondCut: Replace existing selectors + Add new ones
 *   4. Optionally call setProposalBondExempt(aiWorkerAddress, true)
 *
 * Env required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)
 *   ADMIN_PRIVATE_KEY (required), ADMIN_PRIVATE_KEY_2/3 (optional fallbacks)
 *   AI_WORKER_ADDRESS (optional — address to grant bond exemption)
 *
 * Usage:
 *   npx hardhat run scripts/upgrade-lifecycle-bond-exemption.js --network hyperliquid
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

async function upgradeMarket(target, signer, facetAddress) {
  const orderBook = target.market_address.trim();
  console.log(`\n🎯 Upgrading: ${target.symbol || target.market_identifier} @ ${orderBook}`);

  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    orderBook,
    ethers.provider
  );
  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

  const { selectors } = await selectorsFromArtifact("MarketLifecycleFacet");
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

  console.log(`   Selector plan: replace=${rep.length} add=${add.length} (total: ${selectors.length})`);

  const cut = [];
  if (rep.length) cut.push({ facetAddress, action: FacetCutAction.Replace, functionSelectors: rep });
  if (add.length) cut.push({ facetAddress, action: FacetCutAction.Add, functionSelectors: add });

  if (!cut.length) {
    console.log("   ⚠️  No selector changes — already up to date.");
    return;
  }

  const diamond = await ethers.getContractAt("IDiamondCut", orderBook, signer);
  console.log("   🧩 Submitting diamondCut...");
  const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
  console.log("   tx:", tx.hash);
  const rc = await tx.wait();
  console.log(`   ✅ diamondCut mined at block ${rc.blockNumber}, gasUsed ${rc.gasUsed.toString()}`);
}

async function grantExemption(orderBook, signer, aiWorkerAddress) {
  const lifecycle = await ethers.getContractAt(
    [
      "function setProposalBondExempt(address account, bool exempt) external",
      "function isProposalBondExempt(address account) external view returns (bool)",
    ],
    orderBook,
    signer
  );

  const alreadyExempt = await lifecycle.isProposalBondExempt(aiWorkerAddress);
  if (alreadyExempt) {
    console.log(`   ℹ️  ${aiWorkerAddress} is already exempt on ${orderBook}`);
    return;
  }

  console.log(`   🔓 Granting bond exemption to ${aiWorkerAddress} on ${orderBook}...`);
  const tx = await lifecycle.setProposalBondExempt(aiWorkerAddress, true);
  console.log("   tx:", tx.hash);
  await tx.wait();
  console.log("   ✅ Exemption granted");

  const verified = await lifecycle.isProposalBondExempt(aiWorkerAddress);
  console.log(`   🔍 Verification: isProposalBondExempt = ${verified}`);
}

async function main() {
  console.log("\n💎 Upgrade MarketLifecycleFacet — Proposal Bond Exemption (v5)");
  console.log("═".repeat(80));

  // 1) Fetch markets
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
      String(m.market_status || "")
    );
  });

  const idxStr = await ask(`\nSelect market index (or "all" to upgrade all): `);
  let selectedMarkets;
  if (idxStr.trim().toLowerCase() === "all") {
    selectedMarkets = markets;
    console.log(`\n🎯 Selected ALL ${markets.length} markets`);
  } else {
    const idx = Number(idxStr);
    if (!Number.isFinite(idx) || idx < 0 || idx >= markets.length) throw new Error("Invalid index");
    selectedMarkets = [markets[idx]];
    console.log(`\n🎯 Selected: ${markets[idx].symbol || markets[idx].market_identifier}`);
  }

  // 2) Resolve signer
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing/invalid ADMIN_PRIVATE_KEY in env.");

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  const primaryDeployer = w1;

  // Verify owner for first market to get the signer
  const firstBook = selectedMarkets[0].market_address.trim();
  const ownerView = await ethers.getContractAt(["function owner() view returns (address)"], firstBook, ethers.provider);
  const owner = await ownerView.owner();
  const ownerLc = owner.toLowerCase();
  const candidates = [
    { w: w1, addr: (await w1.getAddress()).toLowerCase() },
    ...(w2 ? [{ w: w2, addr: (await w2.getAddress()).toLowerCase() }] : []),
    ...(w3 ? [{ w: w3, addr: (await w3.getAddress()).toLowerCase() }] : []),
  ];
  const picked = candidates.find((c) => c.addr === ownerLc);
  if (!picked) throw new Error(`No ADMIN_PRIVATE_KEY_* matches diamond.owner()=${owner}.`);
  const signer = picked.w;
  const signerAddr = await signer.getAddress();
  console.log(`✅ Diamond owner: ${owner}`);
  console.log(`✅ Using signer:  ${signerAddr}`);

  // 3) Deploy or reuse facet
  let facetAddress = String(process.env.MARKET_LIFECYCLE_FACET || "").trim();
  const deployAns = (await ask("\nDeploy NEW MarketLifecycleFacet with bond exemption support? [Y/n]: ")).trim().toLowerCase();
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

  // 4) Diamond cut for each selected market
  for (const target of selectedMarkets) {
    await upgradeMarket(target, signer, facetAddress);
  }

  // 5) Grant AI worker exemption
  const defaultAiAddr = process.env.AI_WORKER_ADDRESS || "";
  const exemptAns = (await ask("\nGrant bond exemption to AI worker? [Y/n]: ")).trim().toLowerCase();
  if (exemptAns !== "n" && exemptAns !== "no") {
    const aiPrompt = defaultAiAddr
      ? `AI worker address [default: ${defaultAiAddr}]: `
      : "AI worker address: ";
    let aiAddr = (await ask(aiPrompt)).trim();
    if (!aiAddr && defaultAiAddr) aiAddr = defaultAiAddr;
    if (!isAddress(aiAddr)) throw new Error("Invalid AI worker address");

    for (const target of selectedMarkets) {
      await grantExemption(target.market_address.trim(), signer, aiAddr);
    }
  }

  console.log("\n" + "═".repeat(80));
  console.log("✅ Upgrade complete.");
  console.log(`   Markets upgraded: ${selectedMarkets.length}`);
  console.log(`   Facet:            ${facetAddress}`);
  console.log("\n   New functions available on upgraded Diamonds:");
  console.log("     • setProposalBondExempt(address, bool)  — owner grants/revokes bond exemption");
  console.log("     • isProposalBondExempt(address)         — view exemption status");
  console.log("     • returnProposalBond()                  — owner returns escrowed proposal bond");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ upgrade-lifecycle-bond-exemption failed:", e?.message || String(e));
    process.exit(1);
  });
