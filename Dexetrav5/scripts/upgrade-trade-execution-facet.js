#!/usr/bin/env node
/**
 * upgrade-trade-execution-facet.js
 *
 * Deploys the fixed OBTradeExecutionFacet and upgrades existing OrderBook
 * Diamond contracts via diamondCut.
 *
 * FIX: _distributeFee was using deductFees + transferCollateral. The
 *      transferCollateral function only checks userCollateral (raw mapping),
 *      ignoring userCrossChainCredit. When traders deposit via cross-chain
 *      (CollateralHub/SpokeVault), their fees are credited as cross-chain
 *      credit to the market owner, but transferCollateral fails with !balance.
 *      The fix splits the fee into two separate deductFees calls (owner share
 *      + protocol share), which correctly handles both collateral types.
 *
 * Modes:
 *   Interactive (default): fetches markets from Supabase, lets you pick which
 *                          OrderBooks to upgrade.
 *   Single target:        set ORDERBOOK=0x... in env to skip Supabase and
 *                          upgrade a single OrderBook.
 *   Pre-deployed facet:   set OB_TRADE_EXECUTION_FACET=0x... to skip deploy.
 *
 * Env required:
 *   ADMIN_PRIVATE_KEY              (required — diamond owner / deployer)
 *   ADMIN_PRIVATE_KEY_2 / _3       (optional fallbacks for diamond owner)
 *
 * Env optional:
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY   (for interactive market list)
 *   ORDERBOOK=0x...                            (single-target mode)
 *   OB_TRADE_EXECUTION_FACET=0x...             (skip deploy, use existing)
 *
 * Usage:
 *   npx hardhat run Dexetrav5/scripts/upgrade-trade-execution-facet.js --network hyperliquid
 */
const { ethers, artifacts } = require("hardhat");
const readline = require("readline");
const path = require("path");
const fs = require("fs");

// Load .env.local at repo root, then default .env
try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (ans) => { rl.close(); resolve(ans); })
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

function selectorsFromAbi(abi) {
  const fns = (abi || []).filter((e) => e && e.type === "function");
  return fns.map((f) => {
    const inputsSig = (f.inputs || []).map(renderType).join(",");
    const sig = `${f.name}(${inputsSig})`;
    return ethers.id(sig).slice(0, 10);
  });
}

function padRight(str, len) {
  str = String(str || "");
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function resolveNetworkName(rawName, chainId) {
  const n = String(rawName || "").toLowerCase();
  if (["hyperliquid_mainnet", "hyperliquid-mainnet", "hl", "hl_mainnet", "hl-mainnet", "hyperliquid"].includes(n)) return "hyperliquid";
  if (["hyperliquid-testnet", "hl_testnet", "hl-testnet", "hyperliquid_testnet"].includes(n)) return "hyperliquid_testnet";
  if ((n === "hardhat" || n === "unknown") && chainId === 31337) return "localhost";
  if (chainId === 999) return "hyperliquid";
  if (chainId === 998) return "hyperliquid_testnet";
  return n;
}

async function fetchMarketsFromSupabase() {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from("markets")
      .select("id, symbol, market_identifier, market_address, market_status, is_active")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return (data || []).filter((r) => isAddress(r.market_address));
  } catch (e) {
    console.warn("⚠️  Could not fetch markets from Supabase:", e?.message || e);
    return null;
  }
}

async function main() {
  console.log("\n🔧 OBTradeExecutionFacet Upgrade — Fix !balance on cross-chain fee splits");
  console.log("═".repeat(80));
  console.log("Fix: _distributeFee now uses two deductFees calls instead of");
  console.log("     deductFees + transferCollateral (which ignores userCrossChainCredit).\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = resolveNetworkName(process.env.HARDHAT_NETWORK, chainId);
  console.log(`🌐 Network: ${networkName} (Chain ID: ${chainId})`);

  // --- Resolve admin signer(s) ---
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);

  let primaryDeployer;
  if (pk1) {
    primaryDeployer = new ethers.Wallet(pk1, ethers.provider);
  } else {
    [primaryDeployer] = await ethers.getSigners();
    console.warn("⚠️  No ADMIN_PRIVATE_KEY set — using default Hardhat signer.");
  }
  const deployerAddr = await primaryDeployer.getAddress();
  console.log(`👤 Deployer: ${deployerAddr}`);

  const bal = await ethers.provider.getBalance(deployerAddr);
  console.log(`💰 Balance: ${ethers.formatEther(bal)} ETH`);
  if (bal === 0n) console.warn("⚠️  Deployer has 0 ETH — transactions will fail!");

  // --- Step 1: Deploy or reuse OBTradeExecutionFacet ---
  const presetFacet = String(process.env.OB_TRADE_EXECUTION_FACET || "").trim();
  let facetAddress;

  if (isAddress(presetFacet) && !process.env.DEPLOY_NEW) {
    console.log(`\n📦 Found existing OBTradeExecutionFacet in env: ${presetFacet}`);
    const choice = await ask("Deploy a NEW facet or use this one? [1=deploy new, 2=use existing]: ");
    if (choice.trim() === "2") {
      facetAddress = presetFacet;
      console.log(`   Using existing: ${facetAddress}`);
    } else {
      facetAddress = null; // fall through to deploy
    }
  }

  if (!facetAddress) {
    console.log("\n⛏️  Deploying fixed OBTradeExecutionFacet...");
    const Factory = await ethers.getContractFactory("OBTradeExecutionFacet", primaryDeployer);
    const facet = await Factory.deploy();
    await facet.waitForDeployment();
    facetAddress = await facet.getAddress();
    const depTx = facet.deploymentTransaction?.();
    console.log(`✅ Deployed OBTradeExecutionFacet at: ${facetAddress}`);
    console.log(`   tx: ${depTx?.hash || "(unknown)"}`);

    // Save to deployment file
    const deploymentPath = path.join(__dirname, `../deployments/${networkName}-deployment.json`);
    try {
      let deployment = {};
      if (fs.existsSync(deploymentPath)) {
        deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
      }
      deployment.contracts = deployment.contracts || {};
      deployment.contracts.OB_TRADE_EXECUTION_FACET = facetAddress;
      deployment.contracts.OB_TRADE_EXECUTION_FACET_UPGRADED_AT = new Date().toISOString();
      fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
      fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
      console.log(`📝 Recorded in ${path.relative(process.cwd(), deploymentPath)}`);
    } catch (e) {
      console.warn(`⚠️  Could not save deployment file: ${e?.message}`);
    }
  }

  // --- Step 2: Determine target OrderBook(s) ---
  let targets = [];
  const envOrderBook = String(process.env.ORDERBOOK || "").trim();

  if (isAddress(envOrderBook)) {
    targets = [{ symbol: "(env)", market_address: envOrderBook }];
    console.log(`\n🎯 Single target from env: ${envOrderBook}`);
  } else {
    console.log("\n🔎 Fetching markets from Supabase...");
    const markets = await fetchMarketsFromSupabase();

    if (!markets || !markets.length) {
      const manual = await ask("No markets found. Enter OrderBook address manually (or q to quit): ");
      if (manual.toLowerCase() === "q" || !isAddress(manual.trim())) {
        console.log("Exiting.");
        return;
      }
      targets = [{ symbol: "(manual)", market_address: manual.trim() }];
    } else {
      console.log(`   Found ${markets.length} market(s).\n`);
      console.log(padRight("Idx", 6), padRight("Symbol", 20), padRight("Address", 44), padRight("Active", 8), "Status");
      console.log("─".repeat(96));
      markets.forEach((m, i) => {
        console.log(
          padRight(`[${i}]`, 6),
          padRight(m.symbol || m.market_identifier, 20),
          padRight(m.market_address, 44),
          padRight(m.is_active ? "yes" : "no", 8),
          String(m.market_status || "")
        );
      });

      const sel = await ask("\nSelect market indices (comma-separated, or 'all'): ");
      if (sel.trim().toLowerCase() === "all") {
        targets = markets;
      } else {
        const indices = sel.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0 && n < markets.length);
        if (!indices.length) {
          console.log("No valid indices. Exiting.");
          return;
        }
        targets = indices.map((i) => markets[i]);
      }
    }
  }

  console.log(`\n🎯 Upgrading ${targets.length} OrderBook(s):`);
  targets.forEach((t) => console.log(`   ${t.symbol || t.market_identifier || "?"} → ${t.market_address}`));

  // --- Step 3: Build selector list from artifact ---
  const artifact = await artifacts.readArtifact("OBTradeExecutionFacet");
  const allSelectors = selectorsFromAbi(artifact.abi);
  console.log(`\n📋 OBTradeExecutionFacet has ${allSelectors.length} function selectors`);

  // --- Step 4: Upgrade each target ---
  const wallets = [
    { w: primaryDeployer, addr: deployerAddr.toLowerCase() },
    ...(pk2 ? [{ w: new ethers.Wallet(pk2, ethers.provider), addr: new ethers.Wallet(pk2).address.toLowerCase() }] : []),
    ...(pk3 ? [{ w: new ethers.Wallet(pk3, ethers.provider), addr: new ethers.Wallet(pk3).address.toLowerCase() }] : []),
  ];

  const FacetCutAction = { Add: 0, Replace: 1 };
  const results = [];

  for (const target of targets) {
    const orderBook = target.market_address.trim();
    const label = target.symbol || target.market_identifier || orderBook;
    console.log(`\n${"─".repeat(60)}`);
    console.log(`🔄 Upgrading: ${label} @ ${orderBook}`);

    try {
      // Find the diamond owner and match to a wallet
      const ownerView = await ethers.getContractAt(["function owner() view returns (address)"], orderBook, ethers.provider);
      const owner = await ownerView.owner();
      const picked = wallets.find((c) => c.addr === owner.toLowerCase());
      if (!picked) {
        console.error(`   ❌ No ADMIN_PRIVATE_KEY matches diamond owner ${owner}. Skipping.`);
        results.push({ label, orderBook, status: "SKIPPED", reason: `owner mismatch (${owner})` });
        continue;
      }
      const signer = picked.w;
      console.log(`   Owner: ${owner}`);
      console.log(`   Signer: ${await signer.getAddress()}`);

      // Check existing selectors to determine Add vs Replace
      const loupe = await ethers.getContractAt(["function facetAddress(bytes4) view returns (address)"], orderBook, ethers.provider);
      const add = [];
      const rep = [];
      const targetLc = facetAddress.toLowerCase();

      for (const sel of allSelectors) {
        let cur = ethers.ZeroAddress;
        try { cur = await loupe.facetAddress(sel); } catch { cur = ethers.ZeroAddress; }
        if (!cur || cur === ethers.ZeroAddress) {
          add.push(sel);
        } else if (cur.toLowerCase() !== targetLc) {
          rep.push(sel);
        }
      }

      console.log(`   Selectors: ${rep.length} replace, ${add.length} add, ${allSelectors.length - rep.length - add.length} unchanged`);

      if (rep.length === 0 && add.length === 0) {
        console.log("   ✅ Already up-to-date. No diamondCut needed.");
        results.push({ label, orderBook, status: "UP_TO_DATE" });
        continue;
      }

      // Build cut
      const cut = [];
      if (rep.length) cut.push({ facetAddress, action: FacetCutAction.Replace, functionSelectors: rep });
      if (add.length) cut.push({ facetAddress, action: FacetCutAction.Add, functionSelectors: add });

      // Confirm before executing
      if (targets.length === 1) {
        const confirm = await ask(`   Execute diamondCut on ${label}? [y/N]: `);
        if (confirm.trim().toLowerCase() !== "y" && confirm.trim().toLowerCase() !== "yes") {
          console.log("   Skipped by user.");
          results.push({ label, orderBook, status: "SKIPPED", reason: "user declined" });
          continue;
        }
      }

      // Execute diamondCut
      const diamond = await ethers.getContractAt("IDiamondCut", orderBook, signer);
      console.log("   🧩 Submitting diamondCut...");
      const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
      console.log(`   tx: ${tx.hash}`);
      const rc = await tx.wait();
      console.log(`   ✅ diamondCut mined — block ${rc.blockNumber}, gas ${rc.gasUsed.toString()}`);
      results.push({ label, orderBook, status: "UPGRADED", tx: tx.hash, block: rc.blockNumber });

      // Verify: check that a known selector now points to the new facet
      try {
        const verifyAddr = await loupe.facetAddress(allSelectors[0]);
        if (verifyAddr.toLowerCase() === targetLc) {
          console.log("   ✅ Verification passed: selector routes to new facet");
        } else {
          console.warn(`   ⚠️  Verification: selector routes to ${verifyAddr}, expected ${facetAddress}`);
        }
      } catch (e) {
        console.warn(`   ⚠️  Verification call failed: ${e?.message}`);
      }

    } catch (e) {
      console.error(`   ❌ Failed: ${e?.message || e}`);
      results.push({ label, orderBook, status: "FAILED", error: e?.message });
    }
  }

  // --- Summary ---
  console.log(`\n${"═".repeat(80)}`);
  console.log("📊 Upgrade Summary");
  console.log(`${"─".repeat(80)}`);
  console.log(`   Facet:    ${facetAddress}`);
  console.log(`   Network:  ${networkName} (chain ${chainId})`);
  console.log(`   Deployer: ${deployerAddr}\n`);

  for (const r of results) {
    const icon = r.status === "UPGRADED" ? "✅" : r.status === "UP_TO_DATE" ? "☑️" : r.status === "SKIPPED" ? "⏭️" : "❌";
    const extra = r.tx ? ` tx=${r.tx}` : r.reason ? ` (${r.reason})` : r.error ? ` (${r.error})` : "";
    console.log(`   ${icon} ${padRight(r.label, 20)} ${r.status}${extra}`);
  }

  const upgraded = results.filter((r) => r.status === "UPGRADED").length;
  const failed = results.filter((r) => r.status === "FAILED").length;
  console.log(`\n   Total: ${results.length} | Upgraded: ${upgraded} | Failed: ${failed}`);
  console.log("═".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ upgrade-trade-execution-facet failed:", e?.message || String(e));
    process.exit(1);
  });
