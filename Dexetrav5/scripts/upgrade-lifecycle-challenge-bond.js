#!/usr/bin/env node
/**
 * upgrade-lifecycle-challenge-bond.js
 *
 * Upgrades MarketLifecycleFacet on a selected market's Diamond to add
 * settlement challenge bond support. After the diamond cut it optionally
 * configures the bond amount and slash recipient.
 *
 * Steps:
 *   1. Fetch markets from Supabase, let you pick one
 *   2. Deploy the new MarketLifecycleFacet (or reuse an existing address)
 *   3. diamondCut: Replace existing selectors + Add new ones
 *   4. Optionally call setChallengeBondConfig(bondAmount, slashRecipient)
 *
 * Env required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)
 *   ADMIN_PRIVATE_KEY (required), ADMIN_PRIVATE_KEY_2/3 (optional fallbacks)
 *
 * Usage:
 *   npx hardhat run scripts/upgrade-lifecycle-challenge-bond.js --network hyperliquid
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

async function main() {
  console.log("\n💎 Upgrade MarketLifecycleFacet — Settlement Challenge Bond");
  console.log("═".repeat(80));

  // 1) Fetch markets and select
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

  const idxStr = await ask("\nSelect market index: ");
  const idx = Number(idxStr);
  if (!Number.isFinite(idx) || idx < 0 || idx >= markets.length) throw new Error("Invalid index");
  const target = markets[idx];
  const orderBook = target.market_address.trim();
  console.log(`\n🎯 Selected: ${target.symbol || target.market_identifier} @ ${orderBook}`);

  // 2) Resolve signer (must match diamond owner)
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing/invalid ADMIN_PRIVATE_KEY in env.");

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  const primaryDeployer = w1;

  const ownerView = await ethers.getContractAt(["function owner() view returns (address)"], orderBook, ethers.provider);
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
  const deployAns = (await ask("\nDeploy NEW MarketLifecycleFacet with challenge bond support? [Y/n]: ")).trim().toLowerCase();
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
    console.log(`      deployer: ${await primaryDeployer.getAddress()}`);
  }

  // 4) Build diamondCut (Add new selectors, Replace existing ones)
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

  console.log(`\n📋 Selector plan: replace=${rep.length} add=${add.length} (total selectors: ${selectors.length})`);
  if (add.length) console.log("   New selectors (Add):", add.join(", "));
  if (rep.length) console.log("   Existing selectors (Replace):", rep.join(", "));

  const cut = [];
  if (rep.length) cut.push({ facetAddress, action: FacetCutAction.Replace, functionSelectors: rep });
  if (add.length) cut.push({ facetAddress, action: FacetCutAction.Add, functionSelectors: add });

  if (!cut.length) {
    console.log("\n⚠️  No selector changes detected; all selectors already point to this facet.");
  } else {
    const diamond = await ethers.getContractAt("IDiamondCut", orderBook, signer);
    console.log("\n🧩 Submitting diamondCut...");
    const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
    console.log("   tx:", tx.hash);
    const rc = await tx.wait();
    console.log(`   ✅ diamondCut mined at block ${rc.blockNumber}, gasUsed ${rc.gasUsed.toString()}`);
  }

  // 5) Configure challenge bond
  const configAns = (await ask("\nConfigure challenge bond now? [Y/n]: ")).trim().toLowerCase();
  if (configAns !== "n" && configAns !== "no") {
    const bondAmountStr = (await ask("Bond amount in USDC (e.g. 50 for 50 USDC): ")).trim();
    const bondUsdc = Number(bondAmountStr);
    if (!Number.isFinite(bondUsdc) || bondUsdc <= 0) throw new Error("Invalid bond amount");
    const bondAmount6 = ethers.parseUnits(bondUsdc.toString(), 6);

    const defaultSlash = process.env.PROTOCOL_FEE_RECIPIENT || "";
    const slashPrompt = defaultSlash
      ? `Slash recipient address [default: ${defaultSlash}]: `
      : "Slash recipient address (treasury): ";
    let slashAddr = (await ask(slashPrompt)).trim();
    if (!slashAddr && defaultSlash) slashAddr = defaultSlash;
    if (!isAddress(slashAddr)) throw new Error("Invalid slash recipient address");

    const lifecycle = await ethers.getContractAt(
      ["function setChallengeBondConfig(uint256 bondAmount, address slashRecipient) external"],
      orderBook,
      signer
    );
    console.log(`\n💰 Setting challenge bond: ${bondUsdc} USDC (${bondAmount6.toString()} raw)`);
    console.log(`   Slash recipient: ${slashAddr}`);
    const tx = await lifecycle.setChallengeBondConfig(bondAmount6, slashAddr);
    console.log("   tx:", tx.hash);
    await tx.wait();
    console.log("   ✅ Challenge bond configured");

    // Verify
    const viewer = await ethers.getContractAt(
      ["function getChallengeBondConfig() view returns (uint256 bondAmount, address slashRecipient)"],
      orderBook,
      ethers.provider
    );
    const [configBond, configSlash] = await viewer.getChallengeBondConfig();
    console.log(`\n   🔍 Verification:`);
    console.log(`      bondAmount:      ${configBond.toString()} (${Number(configBond) / 1e6} USDC)`);
    console.log(`      slashRecipient:  ${configSlash}`);
  }

  console.log("\n" + "═".repeat(80));
  console.log("✅ Upgrade complete.");
  console.log(`   Market:     ${target.symbol || target.market_identifier}`);
  console.log(`   OrderBook:  ${orderBook}`);
  console.log(`   Facet:      ${facetAddress}`);
  console.log("\n   New functions available on the Diamond:");
  console.log("     • commitEvidence(string)                    — owner commits Wayback URL + hash at proposal time");
  console.log("     • getProposedEvidence()                     — view committed URL and hash");
  console.log("     • setChallengeBondConfig(uint256, address)  — owner sets bond amount + treasury");
  console.log("     • challengeSettlement(uint256)              — challenger posts bond + alt price");
  console.log("     • resolveChallenge(bool)                    — owner refunds or slashes bond");
  console.log("     • getChallengeBondConfig()                  — view bond config");
  console.log("     • getActiveChallengeInfo()                  — view active challenge state");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ upgrade-lifecycle-challenge-bond failed:", e?.message || String(e));
    process.exit(1);
  });
