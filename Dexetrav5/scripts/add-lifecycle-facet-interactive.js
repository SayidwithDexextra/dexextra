#!/usr/bin/env node

/**
 * add-lifecycle-facet-interactive.js
 *
 * Interactive helper to:
 * - Read markets from Supabase (id, symbol, market_address, settlement_date)
 * - Let you pick a target market (Diamond / OrderBook address)
 * - Deploy MarketLifecycleFacet (or reuse an address you provide)
 * - diamondCut: Add all lifecycle selectors
 * - Optionally initialize lifecycle in the same transaction
 *
 * Env required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (or SUPABASE_ANON_KEY with RLS allowing select)
 *
 * Optional:
 *   HARDHAT_NETWORK=...
 *   PARENT_ADDRESS=0x...  (to set parent during initializeLifecycle)
 */

const { ethers, artifacts } = require("hardhat");
const readline = require("readline");

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
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
    .select("id, symbol, market_identifier, market_address, settlement_date, market_status, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  // Filter to rows that have an OrderBook address
  const rows = (data || []).filter((r) => r.market_address && /^0x[a-fA-F0-9]{40}$/.test(r.market_address));
  if (!rows.length) throw new Error("No markets with market_address found in Supabase.");
  return rows;
}

function formatDate(d) {
  try { return new Date(d).toISOString(); } catch { return String(d || ""); }
}

function padRight(str, len) {
  str = String(str || "");
  if (str.length >= len) return str;
  return str + " ".repeat(len - str.length);
}

async function getLifecycleSelectors() {
  // Use Hardhat artifacts to ensure ABI is available regardless of factory shape
  const artifact = await artifacts.readArtifact("MarketLifecycleFacet");
  // Build selectors directly from ABI entries to avoid Interface shape differences
  const fns = (artifact.abi || []).filter((e) => e && e.type === "function");
  return fns.map((f) => {
    const sig = `${f.name}(${(f.inputs || []).map((i) => i.type).join(",")})`;
    return ethers.id(sig).slice(0, 10);
  });
}

async function main() {
  console.log("\n💎 Add MarketLifecycleFacet (interactive)");
  console.log("═".repeat(80));

  // 1) Load markets from Supabase
  console.log("🔎 Fetching markets from Supabase...");
  const markets = await fetchMarkets();
  console.log(`   Found ${markets.length} market(s) with contract addresses.\n`);

  // 2) List & select
  console.log(padRight("Idx", 6), padRight("Symbol", 14), padRight("Address", 44), padRight("Status", 12), "Settlement Date");
  console.log("-".repeat(100));
  markets.forEach((m, i) => {
    console.log(
      padRight(`[${i}]`, 6),
      padRight(m.symbol || m.market_identifier, 14),
      padRight(m.market_address, 44),
      padRight(m.market_status || "", 12),
      formatDate(m.settlement_date)
    );
  });
  const idxStr = await ask("\nSelect market index: ");
  const idx = Number(idxStr);
  if (!Number.isFinite(idx) || idx < 0 || idx >= markets.length) {
    throw new Error("Invalid index");
  }
  const target = markets[idx];
  const orderBook = target.market_address;
  console.log(`\n🎯 Selected: ${target.symbol || target.market_identifier} @ ${orderBook}\n`);

  // 3) Decide facet address (deploy or reuse)
  let facetAddress = (process.env.MARKET_LIFECYCLE_FACET || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(facetAddress)) {
    const deployAns = (await ask("Deploy new MarketLifecycleFacet? [Y/n]: ")).trim().toLowerCase();
    if (deployAns === "n" || deployAns === "no") {
      facetAddress = (await ask("Enter existing MarketLifecycleFacet address: ")).trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(facetAddress)) throw new Error("Invalid facet address");
    } else {
      console.log("🚀 Deploying MarketLifecycleFacet...");
      const FacetFactory = await ethers.getContractFactory("MarketLifecycleFacet");
      const facet = await FacetFactory.deploy();
      await facet.waitForDeployment();
      facetAddress = await facet.getAddress();
      console.log("   ✅ Deployed facet at:", facetAddress);
    }
  } else {
    console.log("Using facet from env MARKET_LIFECYCLE_FACET:", facetAddress);
  }

  // 4) Prepare diamondCut (Add all selectors from the facet)
  const selectors = await getLifecycleSelectors();
  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const cut = [
    {
      facetAddress,
      action: FacetCutAction.Add,
      functionSelectors: selectors,
    },
  ];

  // 5) Ask if we should initialize lifecycle in same tx (with preset timestamp options)
  const nowSec = Math.floor(Date.now() / 1000);
  const hasSupabaseDate = !!target.settlement_date;
  const supabaseTs = hasSupabaseDate ? Math.floor(new Date(target.settlement_date).getTime() / 1000) : 0;
  const presets = [
    { key: "A", label: "30 minutes", seconds: 30 * 60 },
    { key: "B", label: "1 hour", seconds: 60 * 60 },
    { key: "C", label: "6 hours", seconds: 6 * 60 * 60 },
    { key: "D", label: "12 hours", seconds: 12 * 60 * 60 },
    { key: "E", label: "1 day", seconds: 24 * 60 * 60 },
    { key: "F", label: "3 days", seconds: 3 * 24 * 60 * 60 },
    { key: "G", label: "1 week", seconds: 7 * 24 * 60 * 60 },
    { key: "H", label: "30 days", seconds: 30 * 24 * 60 * 60 },
    { key: "I", label: "90 days", seconds: 90 * 24 * 60 * 60 },
    { key: "J", label: "6 months (~180d)", seconds: 180 * 24 * 60 * 60 },
    { key: "K", label: "1 year (365d)", seconds: 365 * 24 * 60 * 60 },
  ];
  console.log("Preset settlement options (from now):");
  presets.forEach((p) => {
    const ts = nowSec + p.seconds;
    console.log(`  [${p.key}] ${p.label} → ${ts} (${new Date(ts * 1000).toISOString()})`);
  });
  if (hasSupabaseDate) {
    console.log(`  [S] Supabase settlement_date → ${supabaseTs} (${new Date(supabaseTs * 1000).toISOString()})`);
  }
  console.log("  [custom] Enter a UNIX timestamp (seconds) to use a specific time");
  const initAns = (await ask(`Initialize lifecycle now? [Y/n]: `)).trim().toLowerCase();
  let initAddress = ethers.ZeroAddress;
  let initCalldata = "0x";
  if (!(initAns === "n" || initAns === "no")) {
    const choice = (await ask("Choose preset (A-K" + (hasSupabaseDate ? " or S" : "") + ") or enter UNIX seconds (or press Enter for 1 year): ")).trim();
    let settlementTimestamp = 0;
    const upper = choice.toUpperCase();
    if (!choice) {
      settlementTimestamp = nowSec + 365 * 24 * 60 * 60;
    } else if (hasSupabaseDate && upper === "S") {
      settlementTimestamp = supabaseTs;
    } else {
      const preset = presets.find((p) => p.key === upper);
      if (preset) {
        settlementTimestamp = nowSec + preset.seconds;
      } else if (/^\d+$/.test(choice)) {
        settlementTimestamp = Number(choice);
      } else {
        console.log("Unrecognized choice; defaulting to 1 year.");
        settlementTimestamp = nowSec + 365 * 24 * 60 * 60;
      }
    }
    if (!Number.isFinite(settlementTimestamp) || settlementTimestamp <= Math.floor(Date.now() / 1000)) {
      throw new Error("settlementTimestamp must be in the future (seconds since epoch)");
    }
    console.log(`Using settlementTimestamp: ${settlementTimestamp} (UTC ISO: ${new Date(settlementTimestamp * 1000).toISOString()})`);
    const parent = (process.env.PARENT_ADDRESS || (await ask("Parent market address (0x... or blank for none): ")).trim()) || ethers.ZeroAddress;
    if (parent !== ethers.ZeroAddress && !/^0x[a-fA-F0-9]{40}$/.test(parent)) {
      throw new Error("Invalid parent address");
    }
    const artifact = await artifacts.readArtifact("MarketLifecycleFacet");
    const iface = new ethers.Interface(artifact.abi);
    initAddress = facetAddress;
    initCalldata = iface.encodeFunctionData("initializeLifecycle", [settlementTimestamp, parent]);
  }

  // 6) Execute diamondCut on the target Diamond (OrderBook)
  const diamond = await ethers.getContractAt("IDiamondCut", orderBook);
  console.log("\n🧩 diamondCut(Add selectors...)");
  const tx = await diamond.diamondCut(cut, initAddress, initCalldata);
  console.log("   tx:", tx.hash);
  const rc = await tx.wait();
  console.log("✅ diamondCut complete at block", rc.blockNumber);

  // Done
  console.log("\nAll set. You can now call lifecycle views/actions on:", orderBook);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ add-lifecycle-facet-interactive failed:", e?.message || String(e));
    process.exit(1);
  });


