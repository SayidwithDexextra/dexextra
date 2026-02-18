#!/usr/bin/env node
/**
 * upgrade-orderbook-facets-interactive.js
 *
 * Interactive helper to:
 * - Read markets from Supabase (symbol + market_address)
 * - Select a target market (OrderBook Diamond address)
 * - Optionally deploy new facet instances
 * - diamondCut: Add/Replace selectors to attach the new facets
 *
 * Env required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY if RLS allows select)
 *
 * Admin keys:
 *   ADMIN_PRIVATE_KEY (required)
 *   ADMIN_PRIVATE_KEY_2 / ADMIN_PRIVATE_KEY_3 (optional fallbacks)
 *
 * Usage:
 *   npx hardhat run scripts/upgrade-orderbook-facets-interactive.js --network hyperliquid
 */
const { ethers, artifacts } = require("hardhat");
const readline = require("readline");

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

async function fetchMarkets() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/ANON_KEY in env.");
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

function padRight(str, len) {
  str = String(str || "");
  if (str.length >= len) return str;
  return str + " ".repeat(len - str.length);
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

async function deployFacetIfNeeded(contractName, deploy, presetEnvVar, deploySigner) {
  const preset = String(process.env[presetEnvVar] || "").trim();
  if (!deploy) {
    if (!isAddress(preset)) throw new Error(`Set ${presetEnvVar} to an existing ${contractName} address (or choose deploy=1).`);
    console.log(`   ℹ️  Using ${contractName} from env ${presetEnvVar}: ${preset}`);
    return preset;
  }
  const Factory = deploySigner
    ? await ethers.getContractFactory(contractName, deploySigner)
    : await ethers.getContractFactory(contractName);
  const facet = await Factory.deploy();
  await facet.waitForDeployment();
  const addr = await facet.getAddress();
  const depTx = facet.deploymentTransaction && facet.deploymentTransaction();
  const hash = depTx && depTx.hash ? depTx.hash : "(unknown)";
  const deployer = deploySigner ? await deploySigner.getAddress() : "(hardhat default signer)";
  console.log(`   ✅ Deployed ${contractName} at ${addr}`);
  console.log(`      deployer: ${deployer}`);
  console.log(`      deployTx: ${hash}`);
  return addr;
}

async function main() {
  console.log("\n💎 Interactive Diamond Facet Upgrade (OrderBook)");
  console.log("═".repeat(80));

  // 1) Decide deploy vs env
  const deployAns = (await ask("Deploy new facet instances? [1=yes, 0=no]: ")).trim();
  const deploy = deployAns === "1" || deployAns.toLowerCase() === "y" || deployAns.toLowerCase() === "yes";
  console.log(`Mode: ${deploy ? "DEPLOY + ATTACH" : "ATTACH FROM ENV"}`);

  // 2) Load markets from Supabase and select one
  console.log("\n🔎 Fetching markets from Supabase...");
  const markets = await fetchMarkets();
  console.log(`   Found ${markets.length} market(s) with contract addresses.\n`);

  console.log(padRight("Idx", 6), padRight("Symbol", 14), padRight("Address", 44), padRight("Active", 8), "Status");
  console.log("-".repeat(90));
  markets.forEach((m, i) => {
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
  if (!Number.isFinite(idx) || idx < 0 || idx >= markets.length) throw new Error("Invalid index");
  const target = markets[idx];
  const orderBook = target.market_address.trim();
  console.log(`\n🎯 Selected: ${target.symbol || target.market_identifier} @ ${orderBook}`);

  // 3) Resolve signer that can call diamondCut (must match diamond owner)
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing/invalid ADMIN_PRIVATE_KEY in env.");

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  const primaryDeployer = w1; // Always deploy facets with ADMIN_PRIVATE_KEY

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
    throw new Error(`No ADMIN_PRIVATE_KEY_* matches diamond.owner()=${owner}.`);
  }
  const signer = picked.w;
  const signerAddr = await signer.getAddress();
  console.log(`✅ Using upgrade signer: ${signerAddr}`);
  console.log(`✅ Using primary deployer (ADMIN_PRIVATE_KEY): ${await primaryDeployer.getAddress()}`);

  // 4) Which facets to upgrade
  const defaultFacetNames = ["OBOrderPlacementFacet", "OBLiquidationFacet", "OBSettlementFacet", "OBMaintenanceFacet"];
  console.log("\nFacets available to attach/replace:");
  defaultFacetNames.forEach((n, i) => console.log(`  [${i}] ${n}`));
  const facetSel = (await ask("Enter comma-separated indices to upgrade (default: 0,1,2,3): ")).trim();
  const indices = facetSel
    ? facetSel.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
    : [0, 1, 2, 3];
  const facetNames = indices.map((i) => defaultFacetNames[i]).filter(Boolean);
  if (!facetNames.length) throw new Error("No facets selected.");
  console.log("Upgrading facets:", facetNames.join(", "));

  // 5) Deploy (or read from env) facet addresses
  const envVarForFacet = {
    OBOrderPlacementFacet: "OB_ORDER_PLACEMENT_FACET",
    OBLiquidationFacet: "OB_LIQUIDATION_FACET",
    OBSettlementFacet: "OB_SETTLEMENT_FACET",
    OBMaintenanceFacet: "OB_MAINTENANCE_FACET",
  };

  const facetAddr = {};
  for (const name of facetNames) {
    const envVar = envVarForFacet[name];
    if (!envVar) throw new Error(`Missing env var mapping for facet ${name}`);
    console.log(`\n🔧 ${deploy ? "Deploying" : "Using env"} ${name} (${envVar})...`);
    // IMPORTANT:
    // - Deploy facets with ADMIN_PRIVATE_KEY (primaryDeployer) so deployments are consistent.
    // - diamondCut still uses the owner-matching signer (required by the diamond).
    facetAddr[name] = await deployFacetIfNeeded(name, deploy, envVar, primaryDeployer);
    console.log(`   ${name}: ${facetAddr[name]}`);
  }

  console.log("\n📦 Facet addresses (summary)");
  console.log(
    JSON.stringify(
      {
        orderBook,
        diamondOwner: owner,
        diamondCutSigner: signerAddr,
        primaryDeployer: await primaryDeployer.getAddress(),
        facets: facetAddr,
      },
      null,
      2
    )
  );

  // 6) Build diamondCut
  const loupe = await ethers.getContractAt(["function facetAddress(bytes4) view returns (address)"], orderBook, ethers.provider);
  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const cut = [];

  for (const name of facetNames) {
    const { selectors } = await selectorsFromArtifact(name);
    const add = [];
    const rep = [];
    const targetFacet = facetAddr[name].toLowerCase();
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
    if (rep.length) cut.push({ facetAddress: facetAddr[name], action: FacetCutAction.Replace, functionSelectors: rep });
    if (add.length) cut.push({ facetAddress: facetAddr[name], action: FacetCutAction.Add, functionSelectors: add });
    console.log(`\nSelector plan for ${name}: replace=${rep.length} add=${add.length}`);
  }

  // 7) Execute diamondCut (if needed)
  if (!cut.length) {
    console.log("\nNo selector changes detected; skipping diamondCut.");
  } else {
    const diamond = await ethers.getContractAt("IDiamondCut", orderBook, signer);
    console.log("\n🧩 Submitting diamondCut...");
    const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
    console.log("tx:", tx.hash);
    const rc = await tx.wait();
    console.log("✅ diamondCut mined at block", rc.blockNumber, "gasUsed", rc.gasUsed.toString());
  }

  // 8) Optional: initialize price-level linked list pointers (auto)
  // IMPORTANT: This should run even if we skipped diamondCut due to no selector changes.
  if (facetNames.includes("OBMaintenanceFacet")) {
    const initAns = (await ask("\nInitialize price-level linked list now? [y/N]: ")).trim().toLowerCase();
    if (initAns === "y" || initAns === "yes") {
      const maint = await ethers.getContractAt(
        [
          "function getActiveBuyPrices() view returns (uint256[] memory)",
          "function getActiveSellPrices() view returns (uint256[] memory)",
          "function adminSetBuyPriceList(uint256[] calldata) external",
          "function adminSetSellPriceList(uint256[] calldata) external",
        ],
        orderBook,
        signer
      );

      console.log("🔎 Reading active price levels from contract (view calls)...");
      const buyRaw = await maint.getActiveBuyPrices();
      const sellRaw = await maint.getActiveSellPrices();

      // Convert to BigInt arrays and sort
      const buy = [...buyRaw].map((x) => BigInt(x.toString()));
      const sell = [...sellRaw].map((x) => BigInt(x.toString()));

      buy.sort((a, b) => (a === b ? 0 : a > b ? -1 : 1)); // desc
      sell.sort((a, b) => (a === b ? 0 : a < b ? -1 : 1)); // asc

      console.log(`Active levels found: buy=${buy.length} sell=${sell.length}`);
      if (buy.length === 0 && sell.length === 0) {
        console.log("ℹ️  No resting liquidity levels found. This is normal for a brand-new orderbook.");
        console.log("    No initialization needed; the linked list will build itself as orders are placed.");
      } else {
        if (buy.length) {
          console.log("↘️  Initializing BUY linked list (desc)...");
          const txb = await maint.adminSetBuyPriceList(buy);
          console.log("adminSetBuyPriceList tx:", txb.hash);
          await txb.wait();
          console.log("✅ buy price list initialized");
        }
        if (sell.length) {
          console.log("↗️  Initializing SELL linked list (asc)...");
          const txs = await maint.adminSetSellPriceList(sell);
          console.log("adminSetSellPriceList tx:", txs.hash);
          await txs.wait();
          console.log("✅ sell price list initialized");
        }
      }
    }
  } else if (facetNames.includes("OBOrderPlacementFacet")) {
    console.log("\nNote: price-level linked list init helpers moved to OBMaintenanceFacet.");
    console.log("      Re-run and include OBMaintenanceFacet if you want to initialize pointers here.");
  }

  console.log("\nDone.");
  console.log("OrderBook:", orderBook);
  for (const name of facetNames) console.log(`${name}: ${facetAddr[name]}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ upgrade-orderbook-facets-interactive failed:", e?.message || String(e));
    process.exit(1);
  });

