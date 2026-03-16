#!/usr/bin/env node
/**
 * upgrade-fee-structure-interactive.js
 *
 * Sweeps ALL markets from Supabase, checks each Diamond for the full set of
 * facets, and upgrades any that are missing or pointing at stale addresses.
 *
 * Modes:
 *   --dry-run       Scan only; report which markets need upgrades without executing.
 *   --deploy        Deploy fresh facet instances instead of reading from env.
 *   --skip-confirm  Skip the confirmation prompt before executing cuts.
 *
 * Env required:
 *   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ADMIN_PRIVATE_KEY          (primary deploy + upgrade signer)
 *   ADMIN_PRIVATE_KEY_2/3      (optional fallbacks for diamond ownership)
 *
 * Facet addresses are read from env (e.g. OB_ADMIN_FACET, META_TRADE_FACET, …).
 * Any facet whose env var is missing is skipped with a warning.
 *
 * Usage:
 *   npx hardhat run scripts/upgrade-fee-structure-interactive.js --network hyperliquid
 *   npx hardhat run scripts/upgrade-fee-structure-interactive.js --network hyperliquid --dry-run
 *   npx hardhat run scripts/upgrade-fee-structure-interactive.js --network localhost
 */
const { ethers, artifacts } = require("hardhat");
const readline = require("readline");

// ────────────────────────── CLI flags ──────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");
const DEPLOY_FRESH = process.argv.includes("--deploy");
const SKIP_CONFIRM = process.argv.includes("--skip-confirm");

// ────────────────────────── facet registry ──────────────────────────

const ALL_FACETS = [
  { name: "OBAdminFacet",              envKey: "OB_ADMIN_FACET" },
  { name: "OBOrderPlacementFacet",     envKey: "OB_ORDER_PLACEMENT_FACET" },
  { name: "OBTradeExecutionFacet",     envKey: "OB_TRADE_EXECUTION_FACET" },
  { name: "OBViewFacet",              envKey: "OB_VIEW_FACET" },
  { name: "OBLiquidationFacet",       envKey: "OB_LIQUIDATION_FACET" },
  { name: "OBPricingFacet",           envKey: "OB_PRICING_FACET" },
  { name: "OBSettlementFacet",        envKey: "OB_SETTLEMENT_FACET" },
  { name: "OBMaintenanceFacet",       envKey: "OB_MAINTENANCE_FACET" },
  { name: "MetaTradeFacet",           envKey: "META_TRADE_FACET" },
  { name: "MarketLifecycleFacet",     envKey: "MARKET_LIFECYCLE_FACET" },
  { name: "OrderBookVaultAdminFacet", envKey: "ORDERBOOK_VAULT_FACET" },
];

// ────────────────────────── helpers ──────────────────────────

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
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

// ────────────────────────── supabase ──────────────────────────

async function fetchMarkets() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
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

// ────────────────────────── artifact selectors ──────────────────────────

const _selectorCache = {};

async function selectorsFromArtifact(contractName) {
  if (_selectorCache[contractName]) return _selectorCache[contractName];
  const artifact = await artifacts.readArtifact(contractName);
  const fns = (artifact.abi || []).filter((e) => e && e.type === "function");
  const sels = fns.map((f) => {
    const inputsSig = (f.inputs || []).map(renderType).join(",");
    const sig = `${f.name}(${inputsSig})`;
    return ethers.id(sig).slice(0, 10);
  });
  _selectorCache[contractName] = { selectors: sels, abi: artifact.abi };
  return _selectorCache[contractName];
}

// ────────────────────────── deploy ──────────────────────────

async function deployFacet(contractName, deploySigner) {
  const Factory = await ethers.getContractFactory(contractName, deploySigner);
  const facet = await Factory.deploy();
  await facet.waitForDeployment();
  const addr = await facet.getAddress();
  const depTx = facet.deploymentTransaction && facet.deploymentTransaction();
  const hash = depTx && depTx.hash ? depTx.hash : "(unknown)";
  console.log(`   ✅ Deployed ${contractName} at ${addr}  (tx: ${hash})`);
  return addr;
}

// ────────────────────────── per-market scan ──────────────────────────

async function scanMarket(orderBookAddress, activeFacets) {
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    orderBookAddress,
    ethers.provider
  );

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const cut = [];
  const details = [];

  for (const { name, address } of activeFacets) {
    const { selectors } = await selectorsFromArtifact(name);
    const add = [];
    const rep = [];
    const targetLc = address.toLowerCase();

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

    if (rep.length) cut.push({ facetAddress: address, action: FacetCutAction.Replace, functionSelectors: rep });
    if (add.length) cut.push({ facetAddress: address, action: FacetCutAction.Add, functionSelectors: add });

    if (add.length || rep.length) {
      details.push({ name, add: add.length, replace: rep.length });
    }
  }

  return { cut, details };
}

// ────────────────────────── main ──────────────────────────

async function main() {
  console.log("\n💎 Diamond Facet Sweep – All Markets × All Facets");
  console.log("═".repeat(80));
  if (DRY_RUN) console.log("🔍 DRY RUN mode — no transactions will be sent.\n");

  // ── 1. Resolve admin signers ──
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing/invalid ADMIN_PRIVATE_KEY in env.");

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  const primaryDeployer = w1;
  console.log(`Primary deployer: ${await primaryDeployer.getAddress()}`);

  const candidates = [
    { w: w1, addr: (await w1.getAddress()).toLowerCase(), label: "ADMIN_PRIVATE_KEY" },
    ...(w2 ? [{ w: w2, addr: (await w2.getAddress()).toLowerCase(), label: "ADMIN_PRIVATE_KEY_2" }] : []),
    ...(w3 ? [{ w: w3, addr: (await w3.getAddress()).toLowerCase(), label: "ADMIN_PRIVATE_KEY_3" }] : []),
  ];

  // ── 1b. Check wallet balances ──
  const MIN_BALANCE_WEI = ethers.parseUnits("0.0002", "ether"); // ~1 diamondCut worth of gas
  console.log("\n💰 Signer wallet balances:");
  let anyLow = false;
  for (const c of candidates) {
    const bal = await ethers.provider.getBalance(c.addr);
    const balFormatted = ethers.formatEther(bal);
    const sufficient = bal >= MIN_BALANCE_WEI;
    const icon = sufficient ? "✅" : "⚠️";
    if (!sufficient) anyLow = true;
    console.log(`   ${icon} ${padRight(c.label, 22)} ${c.addr}   ${balFormatted} HYPE`);
  }
  if (anyLow) {
    console.log("\n   ⚠️  One or more signers have low balance. Upgrades requiring those wallets will fail.");
    if (!SKIP_CONFIRM && !DRY_RUN) {
      const ans = (await ask("   Continue anyway? [y/N]: ")).trim().toLowerCase();
      if (ans !== "y" && ans !== "yes") {
        console.log("   Aborted. Fund the wallets and retry.");
        return;
      }
    }
  }

  // ── 2. Resolve facet addresses ──
  console.log("\n📋 Resolving facet addresses...");
  const activeFacets = [];
  const skippedFacets = [];

  if (DEPLOY_FRESH) {
    console.log("🔧 Deploying fresh facet instances...\n");
    for (const facet of ALL_FACETS) {
      try {
        const addr = await deployFacet(facet.name, primaryDeployer);
        activeFacets.push({ name: facet.name, envKey: facet.envKey, address: addr });
      } catch (e) {
        console.log(`   ⚠️  Failed to deploy ${facet.name}: ${e?.message || e}`);
        skippedFacets.push({ name: facet.name, reason: `deploy failed: ${e?.message}` });
      }
    }
  } else {
    for (const facet of ALL_FACETS) {
      const addr = (process.env[facet.envKey] || process.env[`NEXT_PUBLIC_${facet.envKey}`] || "").trim();
      if (isAddress(addr)) {
        activeFacets.push({ name: facet.name, envKey: facet.envKey, address: addr });
      } else {
        skippedFacets.push({ name: facet.name, reason: `${facet.envKey} not set` });
      }
    }
  }

  console.log(`\n   Active facets (${activeFacets.length}):`);
  for (const f of activeFacets) {
    console.log(`      ${padRight(f.name, 30)} ${f.address}`);
  }
  if (skippedFacets.length) {
    console.log(`\n   ⚠️  Skipped facets (${skippedFacets.length}):`);
    for (const f of skippedFacets) {
      console.log(`      ${padRight(f.name, 30)} ${f.reason}`);
    }
  }

  if (!activeFacets.length) {
    throw new Error("No facet addresses available. Set env vars or use --deploy.");
  }

  // ── 3. Fetch all markets from Supabase ──
  console.log("\n🔎 Fetching markets from Supabase...");
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const allMarkets = await fetchMarkets();

  const markets = allMarkets.filter((m) => {
    if (m.chain_id && Number(m.chain_id) !== chainId) return false;
    return true;
  });

  console.log(`   ${allMarkets.length} total markets, ${markets.length} on chain ${chainId}\n`);

  console.log(padRight("Idx", 6), padRight("Symbol", 18), padRight("Address", 44), padRight("Active", 8), "Status");
  console.log("─".repeat(95));
  markets.forEach((m, i) => {
    console.log(
      padRight(`[${i}]`, 6),
      padRight(m.symbol || m.market_identifier || m.id, 18),
      padRight(m.market_address, 44),
      padRight(m.is_active ? "yes" : "no", 8),
      String(m.market_status || "")
    );
  });

  // ── 4. Scan all markets ──
  console.log(`\n🔍 Scanning ${markets.length} market(s) against ${activeFacets.length} facet(s)...\n`);

  const scanResults = [];

  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    const label = market.symbol || market.market_identifier || market.id;
    const orderBook = market.market_address.trim();

    process.stdout.write(`   [${i + 1}/${markets.length}] ${padRight(label, 18)} `);

    let owner;
    try {
      const ownerView = await ethers.getContractAt(["function owner() view returns (address)"], orderBook, ethers.provider);
      owner = await ownerView.owner();
    } catch (e) {
      console.log(`⚠️  owner() failed – skipping`);
      scanResults.push({ label, address: orderBook, status: "SKIP", reason: "owner() reverted", cut: [], details: [] });
      continue;
    }

    const picked = candidates.find((c) => c.addr === owner.toLowerCase());
    if (!picked) {
      console.log(`⚠️  owner=${owner} — no matching key`);
      scanResults.push({ label, address: orderBook, status: "SKIP", reason: `owner=${owner} not in keys`, cut: [], details: [] });
      continue;
    }

    try {
      const { cut, details } = await scanMarket(orderBook, activeFacets);
      if (cut.length === 0) {
        console.log(`✅ up to date`);
        scanResults.push({ label, address: orderBook, status: "CURRENT", signer: picked.w, cut, details });
      } else {
        const summary = details.map((d) => `${d.name}(+${d.add}/~${d.replace})`).join(" ");
        console.log(`🔄 needs upgrade: ${summary}`);
        scanResults.push({ label, address: orderBook, status: "NEEDS_UPGRADE", signer: picked.w, cut, details });
      }
    } catch (e) {
      console.log(`❌ scan error: ${(e?.message || String(e)).slice(0, 80)}`);
      scanResults.push({ label, address: orderBook, status: "ERROR", reason: e?.message || String(e), cut: [], details: [] });
    }
  }

  // ── 5. Scan summary ──
  const needsUpgrade = scanResults.filter((r) => r.status === "NEEDS_UPGRADE");
  const current = scanResults.filter((r) => r.status === "CURRENT");
  const skipped = scanResults.filter((r) => r.status === "SKIP");
  const errors = scanResults.filter((r) => r.status === "ERROR");

  console.log(`\n${"═".repeat(80)}`);
  console.log("SCAN SUMMARY");
  console.log(`${"═".repeat(80)}`);
  console.log(`   ✅ Up to date:     ${current.length}`);
  console.log(`   🔄 Needs upgrade:  ${needsUpgrade.length}`);
  console.log(`   ⏭️  Skipped:        ${skipped.length}`);
  console.log(`   ❌ Errors:         ${errors.length}`);

  if (needsUpgrade.length) {
    console.log("\n   Markets needing upgrade:");
    for (const r of needsUpgrade) {
      const facetList = r.details.map((d) => `${d.name}(+${d.add}/~${d.replace})`).join(", ");
      console.log(`      ${padRight(r.label, 18)} ${r.address}  →  ${facetList}`);
    }
  }

  if (!needsUpgrade.length) {
    console.log("\n🎉 All markets are up to date. Nothing to do.");
    return;
  }

  if (DRY_RUN) {
    console.log("\n🔍 Dry run complete. Re-run without --dry-run to execute upgrades.");
    return;
  }

  // ── 6. Confirm and execute ──
  if (!SKIP_CONFIRM) {
    const confirm1 = (await ask(`\nProceed with upgrading ${needsUpgrade.length} market(s)? [y/N]: `)).trim().toLowerCase();
    if (confirm1 !== "y" && confirm1 !== "yes") {
      console.log("Aborted.");
      return;
    }
  }

  console.log(`\n🚀 Executing diamondCut on ${needsUpgrade.length} market(s)...\n`);
  const execResults = [];

  for (let mi = 0; mi < needsUpgrade.length; mi++) {
    const entry = needsUpgrade[mi];
    const { label, address: orderBook, cut, signer, details } = entry;

    console.log(`${"─".repeat(80)}`);
    console.log(`[${mi + 1}/${needsUpgrade.length}] ${label} @ ${orderBook}`);
    for (const d of details) {
      console.log(`   ${padRight(d.name, 30)} add=${d.add}  replace=${d.replace}`);
    }

    try {
      const diamond = await ethers.getContractAt("IDiamondCut", orderBook, signer);
      console.log("   🧩 Submitting diamondCut...");
      const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
      console.log(`   tx: ${tx.hash}`);
      const rc = await tx.wait();
      console.log(`   ✅ Mined block ${rc.blockNumber}, gas=${rc.gasUsed.toString()}`);
      execResults.push({ label, address: orderBook, status: "OK" });
    } catch (e) {
      console.log(`   ❌ Failed: ${(e?.message || String(e)).slice(0, 120)}`);
      execResults.push({ label, address: orderBook, status: "FAILED", reason: e?.message || String(e) });
    }
  }

  // ── 7. Final summary ──
  console.log(`\n${"═".repeat(80)}`);
  console.log("EXECUTION SUMMARY");
  console.log(`${"═".repeat(80)}`);

  const ok = execResults.filter((r) => r.status === "OK").length;
  const fail = execResults.filter((r) => r.status === "FAILED").length;

  for (const r of execResults) {
    const icon = r.status === "OK" ? "✅" : "❌";
    console.log(`${icon} ${padRight(r.label, 18)} ${padRight(r.address, 44)} ${r.status}${r.reason ? ` (${r.reason.slice(0, 60)})` : ""}`);
  }
  console.log(`\nTotal: ${ok} upgraded, ${fail} failed out of ${execResults.length}.`);

  console.log("\nFacet addresses used:");
  for (const f of activeFacets) {
    console.log(`   ${padRight(f.envKey || f.name, 30)} ${f.address}`);
  }

  if (skipped.length) {
    console.log("\nSkipped markets:");
    for (const s of skipped) {
      console.log(`   ⏭️  ${padRight(s.label, 18)} ${s.address}  (${s.reason})`);
    }
  }

  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ upgrade-fee-structure-interactive failed:", e?.message || String(e));
    process.exit(1);
  });
