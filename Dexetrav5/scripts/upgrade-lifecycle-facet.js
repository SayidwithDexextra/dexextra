#!/usr/bin/env node

/**
 * upgrade-lifecycle-facet.js
 *
 * Interactive upgrade helper for MarketLifecycleFacet:
 * - Select target market (Diamond) from Supabase (or ORDERBOOK env fallback)
 * - Deploy new MarketLifecycleFacet or reuse an existing one
 * - Resolve diamond owner signer from ADMIN_PRIVATE_KEY[_2/_3]
 * - Build Add/Replace selector plan and execute diamondCut
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)
 *   ADMIN_PRIVATE_KEY (+ optional _2/_3)
 *
 * Optional:
 *   ORDERBOOK=0x...                // bypass interactive market selection
 *   MARKET_LIFECYCLE_FACET=0x...   // reuse existing facet address
 */

const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => {
    rl.close();
    resolve(ans);
  }));
}

function isAddress(v) {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v.trim());
}

function padRight(str, len) {
  str = String(str || "");
  if (str.length >= len) return str;
  return str + " ".repeat(len - str.length);
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

function readDeployment(networkName) {
  const p = path.join(__dirname, `../deployments/${networkName}-deployment.json`);
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  return null;
}

async function fetchMarkets() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/ANON_KEY in env.");
  }
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("markets")
    .select("id, symbol, market_identifier, market_address, market_status, is_active, chain_id, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const rows = (data || []).filter((r) => isAddress(r.market_address));
  if (!rows.length) throw new Error("No markets with market_address found in Supabase.");
  return rows;
}

async function getLifecycleSelectors() {
  const artifact = await artifacts.readArtifact("MarketLifecycleFacet");
  const fns = (artifact.abi || []).filter((e) => e && e.type === "function");
  return fns.map((f) => {
    const sig = `${f.name}(${(f.inputs || []).map((i) => i.type).join(",")})`;
    return ethers.id(sig).slice(0, 10);
  });
}

async function resolveOrderBook(networkName, chainId) {
  if (isAddress(process.env.ORDERBOOK || "")) {
    return process.env.ORDERBOOK.trim();
  }

  // Interactive Supabase selection flow (mimics other interactive scripts)
  console.log("\n🔎 Fetching markets from Supabase...");
  const markets = await fetchMarkets();
  const filtered = markets.filter((m) => Number(m.chain_id || chainId) === Number(chainId));
  const list = filtered.length ? filtered : markets;
  if (!list.length) throw new Error("No markets found for current network.");

  console.log(`Found ${list.length} market(s) with contract addresses.\n`);
  console.log(
    padRight("Idx", 6),
    padRight("Symbol", 14),
    padRight("Address", 44),
    padRight("Active", 8),
    "Status"
  );
  console.log("-".repeat(90));
  list.forEach((m, i) => {
    console.log(
      padRight(`[${i}]`, 6),
      padRight(m.symbol || m.market_identifier, 14),
      padRight(m.market_address, 44),
      padRight(m.is_active ? "yes" : "no", 8),
      String(m.market_status || "")
    );
  });

  const idxStr = await ask("\nSelect market index: ");
  const idx = Number(idxStr);
  if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) {
    throw new Error("Invalid market index.");
  }
  return String(list[idx].market_address);
}

async function resolveLifecycleFacetAddress(deployment, deploySigner) {
  let facetAddress = String(process.env.MARKET_LIFECYCLE_FACET || "").trim();
  if (!isAddress(facetAddress)) {
    facetAddress = String(deployment?.contracts?.MARKET_LIFECYCLE_FACET || "").trim();
  }

  if (isAddress(facetAddress)) {
    console.log("🧩 Using MarketLifecycleFacet:", facetAddress);
    return facetAddress;
  }

  const ans = (await ask("Deploy new MarketLifecycleFacet? [Y/n]: ")).trim().toLowerCase();
  if (ans === "n" || ans === "no") {
    const existing = (await ask("Enter existing MarketLifecycleFacet address: ")).trim();
    if (!isAddress(existing)) throw new Error("Invalid facet address.");
    console.log("🧩 Using MarketLifecycleFacet:", existing);
    return existing;
  }

  console.log("🚀 Deploying MarketLifecycleFacet...");
  const FacetFactory = await ethers.getContractFactory("MarketLifecycleFacet", deploySigner);
  const facet = await FacetFactory.deploy();
  await facet.waitForDeployment();
  facetAddress = await facet.getAddress();
  console.log("✅ Deployed MarketLifecycleFacet:", facetAddress);
  return facetAddress;
}

async function resolveDiamondSigner(orderBook) {
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing/invalid ADMIN_PRIVATE_KEY.");

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  const ownerView = await ethers.getContractAt(["function owner() view returns (address)"], orderBook, ethers.provider);
  const owner = String(await ownerView.owner()).toLowerCase();

  const candidates = [
    { w: w1, addr: String(await w1.getAddress()).toLowerCase(), label: "ADMIN_PRIVATE_KEY" },
    ...(w2 ? [{ w: w2, addr: String(await w2.getAddress()).toLowerCase(), label: "ADMIN_PRIVATE_KEY_2" }] : []),
    ...(w3 ? [{ w: w3, addr: String(await w3.getAddress()).toLowerCase(), label: "ADMIN_PRIVATE_KEY_3" }] : []),
  ];
  const picked = candidates.find((c) => c.addr === owner);
  if (!picked) {
    throw new Error(`No admin key matches diamond owner: ${owner}`);
  }
  return { signer: picked.w, owner, pickedLabel: picked.label };
}

async function main() {
  const network = await ethers.provider.getNetwork();
  let networkName = process.env.HARDHAT_NETWORK || "unknown";
  if ((networkName === "hardhat" || networkName === "unknown") && Number(network.chainId) === 31337) {
    networkName = "localhost";
  } else if (Number(network.chainId) === 999) {
    networkName = "hyperliquid";
  } else if (Number(network.chainId) === 998) {
    networkName = "hyperliquid_testnet";
  }
  console.log(`\n💎 Interactive Lifecycle Facet Upgrade (${networkName}, chainId=${network.chainId})`);

  const deployment = readDeployment(networkName) || {};

  let orderBook = await resolveOrderBook(networkName, Number(network.chainId));
  if (!isAddress(orderBook)) {
    orderBook = String(deployment?.defaultMarket?.orderBook || "");
  }
  if (!isAddress(orderBook) && Array.isArray(deployment.markets) && deployment.markets.length > 0) {
    orderBook = String(deployment.markets[0]?.orderBook || "");
  }
  if (!isAddress(orderBook)) {
    throw new Error("ORDERBOOK could not be resolved.");
  }
  console.log("🎯 Target Diamond (OrderBook):", orderBook);

  // Deployer can be any valid key; default to ADMIN_PRIVATE_KEY wallet for consistency.
  const deployPk = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  if (!deployPk) throw new Error("Missing ADMIN_PRIVATE_KEY for deploy signer.");
  const deploySigner = new ethers.Wallet(deployPk, ethers.provider);
  const facetAddress = await resolveLifecycleFacetAddress(deployment, deploySigner);

  const { signer, owner, pickedLabel } = await resolveDiamondSigner(orderBook);
  console.log("👤 Diamond owner:", owner);
  console.log("🔐 diamondCut signer:", await signer.getAddress(), `(${pickedLabel})`);

  const selectors = await getLifecycleSelectors();
  if (!Array.isArray(selectors) || selectors.length === 0) {
    throw new Error("No selectors built for MarketLifecycleFacet.");
  }

  const loupe = await ethers.getContractAt(["function facetAddress(bytes4) view returns (address)"], orderBook);
  const addSelectors = [];
  const replaceSelectors = [];
  for (const sel of selectors) {
    try {
      const addr = await loupe.facetAddress(sel);
      if (!addr || addr === ethers.ZeroAddress) addSelectors.push(sel);
      else if (String(addr).toLowerCase() !== facetAddress.toLowerCase()) replaceSelectors.push(sel);
    } catch {
      addSelectors.push(sel);
    }
  }

  console.log("🧮 Selector plan:", { replace: replaceSelectors.length, add: addSelectors.length });
  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const cut = [];
  if (replaceSelectors.length) {
    cut.push({ facetAddress, action: FacetCutAction.Replace, functionSelectors: replaceSelectors });
  }
  if (addSelectors.length) {
    cut.push({ facetAddress, action: FacetCutAction.Add, functionSelectors: addSelectors });
  }
  if (!cut.length) {
    console.log("ℹ️ No lifecycle selector changes detected; already up to date.");
    return;
  }

  console.log("⏳ Submitting diamondCut...");
  const diamond = await ethers.getContractAt("IDiamondCut", orderBook, signer);
  const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
  console.log("   tx:", tx.hash);
  const rc = await tx.wait();
  console.log(`✅ Upgrade complete. Block: ${rc.blockNumber} Gas: ${rc.gasUsed}`);
  console.log("   orderBook:", orderBook);
  console.log("   lifecycleFacet:", facetAddress);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ upgrade-lifecycle-facet failed:", e?.message || String(e));
    process.exit(1);
  });


