#!/usr/bin/env node
/**
 * upgrade-fee-structure-interactive.js
 *
 * Interactive script to deploy and upgrade Diamond facets on selected markets.
 * Supports upgrading ALL facets or a SINGLE facet.
 *
 * Steps:
 *   1. Fetch deployed markets from Supabase
 *   2. Choose which facet(s) to upgrade (single or all)
 *   3. Let operator select which markets to upgrade (multi-select)
 *   4. Optionally configure fee structure after upgrade
 *   5. Deploy new facet instances (once, reused across all selected markets)
 *   6. For each market: diamondCut to replace/add selectors
 *
 * Env required:
 *   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ADMIN_PRIVATE_KEY          (primary deploy + upgrade signer)
 *   ADMIN_PRIVATE_KEY_2/3      (optional fallbacks for diamond ownership)
 *
 * Usage:
 *   npx hardhat run scripts/upgrade-fee-structure-interactive.js --network hyperliquid
 *   npx hardhat run scripts/upgrade-fee-structure-interactive.js --network localhost
 */
const { ethers, artifacts } = require("hardhat");
const readline = require("readline");

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
    .select("id, symbol, market_identifier, market_address, market_status, is_active, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const rows = (data || []).filter((r) => isAddress(r.market_address));
  if (!rows.length) throw new Error("No markets with market_address found in Supabase.");
  return rows;
}

// ────────────────────────── artifact selectors ──────────────────────────

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

// ────────────────────────── diamondCut ──────────────────────────

async function buildCut(facetNames, facetAddresses, orderBookAddress) {
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    orderBookAddress,
    ethers.provider
  );
  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const cut = [];

  for (const name of facetNames) {
    const { selectors } = await selectorsFromArtifact(name);
    const add = [];
    const rep = [];
    const targetFacet = facetAddresses[name].toLowerCase();
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
    if (rep.length) cut.push({ facetAddress: facetAddresses[name], action: FacetCutAction.Replace, functionSelectors: rep });
    if (add.length) cut.push({ facetAddress: facetAddresses[name], action: FacetCutAction.Add, functionSelectors: add });
    console.log(`   ${name}: replace=${rep.length}  add=${add.length}`);
  }
  return cut;
}

// ────────────────────────── main ──────────────────────────

async function main() {
  console.log("\n💎 Diamond Facet Upgrade (Interactive)");
  console.log("═".repeat(80));

  // ── All available facets ──
  const ALL_FACETS = [
    "OBTradeExecutionFacet",
    "OBOrderPlacementFacet",
    "OBAdminFacet",
    "OBViewFacet",
    "OBLiquidationFacet",
  ];

  const facetEnvMap = {
    OBTradeExecutionFacet: "OB_TRADE_EXECUTION_FACET",
    OBOrderPlacementFacet: "OB_ORDER_PLACEMENT_FACET",
    OBAdminFacet: "OB_ADMIN_FACET",
    OBViewFacet: "OB_VIEW_FACET",
    OBLiquidationFacet: "OB_LIQUIDATION_FACET",
  };

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

  // ── 2. Select which facet(s) to upgrade ──
  console.log("\nWhich facets do you want to upgrade?");
  ALL_FACETS.forEach((f, i) => console.log(`   [${i}] ${f}`));
  console.log(`   [a] ALL facets`);
  const facetSel = (await ask("\nFacet selection (indices comma-separated, or 'a' for all): ")).trim().toLowerCase();

  let facetNames;
  if (facetSel === "a" || facetSel === "all") {
    facetNames = [...ALL_FACETS];
  } else {
    const indices = facetSel.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0 && n < ALL_FACETS.length);
    if (!indices.length) throw new Error("No valid facets selected.");
    facetNames = [...new Set(indices.map((i) => ALL_FACETS[i]))];
  }
  console.log(`\n✅ Upgrading ${facetNames.length} facet(s): ${facetNames.join(", ")}`);

  // ── 3. Fetch markets from Supabase ──
  console.log("\n🔎 Fetching markets from Supabase...");
  const markets = await fetchMarkets();
  console.log(`   Found ${markets.length} market(s) with contract addresses.\n`);

  console.log(padRight("Idx", 6), padRight("Symbol", 18), padRight("Address", 44), padRight("Active", 8), "Status");
  console.log("-".repeat(95));
  markets.forEach((m, i) => {
    console.log(
      padRight(`[${i}]`, 6),
      padRight(m.symbol || m.market_identifier || m.id, 18),
      padRight(m.market_address, 44),
      padRight(m.is_active ? "yes" : "no", 8),
      String(m.market_status || "")
    );
  });

  // ── 4. Multi-select markets ──
  console.log("\nEnter market indices to upgrade (comma-separated), 'all' for all, or 'q' to quit.");
  const selStr = (await ask("Selection: ")).trim();
  if (selStr.toLowerCase() === "q") return;

  let selectedIndices;
  if (selStr.toLowerCase() === "all") {
    selectedIndices = markets.map((_, i) => i);
  } else {
    selectedIndices = selStr.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0 && n < markets.length);
  }
  if (!selectedIndices.length) throw new Error("No valid markets selected.");

  const selectedMarkets = selectedIndices.map((i) => markets[i]);
  console.log(`\n✅ Selected ${selectedMarkets.length} market(s):`);
  selectedMarkets.forEach((m) => console.log(`   - ${m.symbol || m.market_identifier || m.id} @ ${m.market_address}`));

  // ── 5. Optional fee configuration (only if OBAdminFacet is being upgraded or user wants) ──
  let configureFees = false;
  let takerFeeBps, makerFeeBps, protocolFeeRecipient, protocolFeeShareBps;

  const feeAns = (await ask("\nConfigure fee structure after upgrade? [y/N]: ")).trim().toLowerCase();
  if (feeAns === "y" || feeAns === "yes") {
    configureFees = true;
    console.log("\n📊 Fee Configuration");
    const takerInput = (await ask("Taker fee bps [default: 45 = 0.045%]: ")).trim();
    const makerInput = (await ask("Maker fee bps [default: 15 = 0.015%]: ")).trim();
    const protocolAddrInput = (await ask("Protocol fee recipient address: ")).trim();
    const shareInput = (await ask("Protocol share bps [default: 8000 = 80%]: ")).trim();

    takerFeeBps = takerInput ? Number(takerInput) : 45;
    makerFeeBps = makerInput ? Number(makerInput) : 15;
    protocolFeeRecipient = protocolAddrInput;
    protocolFeeShareBps = shareInput ? Number(shareInput) : 8000;

    if (!isAddress(protocolFeeRecipient)) throw new Error("Invalid protocol fee recipient address.");
    if (takerFeeBps > 500) throw new Error("Taker fee too high (max 500 bps = 5%).");
    if (makerFeeBps > 500) throw new Error("Maker fee too high (max 500 bps = 5%).");
    if (protocolFeeShareBps > 10000) throw new Error("Protocol share > 100%.");

    console.log(`\n   Taker fee:       ${takerFeeBps} bps (${(takerFeeBps / 100).toFixed(3)}%)`);
    console.log(`   Maker fee:       ${makerFeeBps} bps (${(makerFeeBps / 100).toFixed(3)}%)`);
    console.log(`   Protocol addr:   ${protocolFeeRecipient}`);
    console.log(`   Protocol share:  ${protocolFeeShareBps} bps (${(protocolFeeShareBps / 100).toFixed(1)}%)`);
    console.log(`   Market owner:    ${(10000 - protocolFeeShareBps) / 100}% (goes to existing feeRecipient per market)`);
  }

  const confirm1 = (await ask("\nProceed with upgrade? [y/N]: ")).trim().toLowerCase();
  if (confirm1 !== "y" && confirm1 !== "yes") {
    console.log("Aborted.");
    return;
  }

  // ── 6. Deploy new facets or reuse existing ──
  const deployAns = (await ask("\nDeploy new facet instances? [y = deploy fresh, n = reuse from env]: ")).trim().toLowerCase();
  const shouldDeploy = deployAns === "y" || deployAns === "yes";

  const facetAddresses = {};
  if (shouldDeploy) {
    console.log("\n🔧 Deploying upgraded facets...");
    for (const name of facetNames) {
      facetAddresses[name] = await deployFacet(name, primaryDeployer);
    }
  } else {
    console.log("\n📋 Reusing pre-deployed facet addresses from env...");
    for (const name of facetNames) {
      const envKey = facetEnvMap[name];
      const addr = process.env[envKey] || process.env[`NEXT_PUBLIC_${envKey}`] || "";
      if (!isAddress(addr)) throw new Error(`Missing or invalid env var ${envKey}=${addr}. Set it or choose deploy.`);
      facetAddresses[name] = addr.trim();
      console.log(`   ✅ ${name}: ${facetAddresses[name]}  (from ${envKey})`);
    }
  }

  console.log("\n📦 Facet addresses for upgrade:");
  for (const name of facetNames) {
    console.log(`   ${padRight(name, 30)} ${facetAddresses[name]}`);
  }

  // ── 7. Upgrade each selected market ──
  const candidates = [
    { w: w1, addr: (await w1.getAddress()).toLowerCase() },
    ...(w2 ? [{ w: w2, addr: (await w2.getAddress()).toLowerCase() }] : []),
    ...(w3 ? [{ w: w3, addr: (await w3.getAddress()).toLowerCase() }] : []),
  ];

  const results = [];

  for (let mi = 0; mi < selectedMarkets.length; mi++) {
    const market = selectedMarkets[mi];
    const label = market.symbol || market.market_identifier || market.id;
    const orderBook = market.market_address.trim();

    console.log(`\n${"─".repeat(80)}`);
    console.log(`[${mi + 1}/${selectedMarkets.length}] ${label} @ ${orderBook}`);

    // Resolve owner signer
    let owner;
    try {
      const ownerView = await ethers.getContractAt(["function owner() view returns (address)"], orderBook, ethers.provider);
      owner = await ownerView.owner();
    } catch (e) {
      console.log(`   ⚠️  Cannot read owner(): ${e?.message || e}. Skipping.`);
      results.push({ label, address: orderBook, status: "SKIPPED", reason: "owner() failed" });
      continue;
    }

    const picked = candidates.find((c) => c.addr === owner.toLowerCase());
    if (!picked) {
      console.log(`   ⚠️  No ADMIN_PRIVATE_KEY matches diamond owner ${owner}. Skipping.`);
      results.push({ label, address: orderBook, status: "SKIPPED", reason: `owner=${owner} not in keys` });
      continue;
    }
    const signer = picked.w;
    console.log(`   Owner: ${owner}  |  Signer: ${await signer.getAddress()}`);

    // Build and execute diamondCut
    try {
      console.log("   Building diamondCut...");
      const cut = await buildCut(facetNames, facetAddresses, orderBook);

      if (cut.length) {
        const diamond = await ethers.getContractAt("IDiamondCut", orderBook, signer);
        console.log("   🧩 Submitting diamondCut...");
        const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
        console.log(`   tx: ${tx.hash}`);
        const rc = await tx.wait();
        console.log(`   ✅ diamondCut mined at block ${rc.blockNumber}, gas=${rc.gasUsed.toString()}`);
      } else {
        console.log("   ℹ️  No selector changes needed (already up to date).");
      }

      // Optionally configure fees
      if (configureFees) {
        console.log("   📊 Calling updateFeeStructure...");
        const admin = await ethers.getContractAt(
          ["function updateFeeStructure(uint256,uint256,address,uint256) external"],
          orderBook,
          signer
        );
        const feeTx = await admin.updateFeeStructure(takerFeeBps, makerFeeBps, protocolFeeRecipient, protocolFeeShareBps);
        console.log(`   tx: ${feeTx.hash}`);
        await feeTx.wait();
        console.log(`   ✅ Fee structure configured.`);

        const view = await ethers.getContractAt(
          ["function getFeeStructure() view returns (uint256,uint256,address,uint256,uint256,address)"],
          orderBook,
          ethers.provider
        );
        const fs = await view.getFeeStructure();
        console.log(`   Verified: taker=${fs[0].toString()}bps  maker=${fs[1].toString()}bps  proto=${fs[2]}  share=${fs[3].toString()}bps`);
      }

      results.push({ label, address: orderBook, status: "OK" });
    } catch (e) {
      console.log(`   ❌ Failed: ${e?.message || e}`);
      results.push({ label, address: orderBook, status: "FAILED", reason: e?.message || String(e) });
    }
  }

  // ── 8. Summary ──
  console.log(`\n${"═".repeat(80)}`);
  console.log("SUMMARY");
  console.log(`${"═".repeat(80)}`);
  console.log(`Facets upgraded: ${facetNames.join(", ")}`);
  results.forEach((r) => {
    const icon = r.status === "OK" ? "✅" : r.status === "SKIPPED" ? "⏭️ " : "❌";
    console.log(`${icon} ${padRight(r.label, 18)} ${padRight(r.address, 44)} ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
  });

  const ok = results.filter((r) => r.status === "OK").length;
  const skip = results.filter((r) => r.status === "SKIPPED").length;
  const fail = results.filter((r) => r.status === "FAILED").length;
  console.log(`\nTotal: ${ok} upgraded, ${skip} skipped, ${fail} failed out of ${results.length}.`);

  console.log("\nDeployed facet addresses (save to env for reuse):");
  for (const name of facetNames) {
    console.log(`   ${facetEnvMap[name]}=${facetAddresses[name]}`);
  }
  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ upgrade-fee-structure-interactive failed:", e?.message || String(e));
    process.exit(1);
  });
