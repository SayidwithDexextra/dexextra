#!/usr/bin/env node

/**
 * upgrade-gasless-facets.js
 *
 * Deploys (if needed) and registers:
 *  - Updated OBOrderPlacementFacet (Replace existing selectors; Add new "By" selectors)
 *  - New MetaTradeFacet (Add all selectors)
 *
 * Also syncs ABIs for OBOrderPlacementFacet and MetaTradeFacet into src/lib/abis/facets.
 *
 * Usage:
 *   HARDHAT_NETWORK=hyperliquid ORDERBOOK=0x... npx hardhat run Dexetrav5/scripts/upgrade-gasless-facets.js --network hyperliquid
 *
 * Flags (after `--` if needed by your shell):
 *   --force-new-session-registry   Deploy a new GlobalSessionRegistry even if SESSION_REGISTRY_ADDRESS is set.
 *
 * Optional env overrides:
 *   OB_PLACEMENT_FACET=0x...   // use existing deployed facet address instead of deploying
 *   META_TRADE_FACET=0x...     // use existing deployed facet address instead of deploying
 */

const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Pretty logger
const sep = () =>
  console.log("────────────────────────────────────────────────────────────");
const ok = (msg, extra) => console.log(`✅ ${msg}`, extra ?? "");
const info = (msg, extra) => console.log(`ℹ️  ${msg}`, extra ?? "");
const warn = (msg, extra) => console.log(`⚠️  ${msg}`, extra ?? "");
const head = (title) => {
  sep();
  console.log(`🧩 ${title}`);
  sep();
};
const logKV = (label, value) => console.log(`   • ${label}:`, value);

function readDeployment(networkName) {
  const p = path.join(
    __dirname,
    `../deployments/${networkName}-deployment.json`
  );
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  return null;
}

function renderType(t) {
  // Handles tuples and nested arrays: tuple, tuple[], tuple[2], etc.
  const type = t.type || "";
  // Match array suffix if present, e.g., tuple[], tuple[2], tuple[][], uint256[]
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
  return { selectors: sels, abi: artifact.abi, artifact };
}

async function deployFacetIfNeeded(contractName, preset, labelForLog) {
  if (preset && /^0x[a-fA-F0-9]{40}$/.test(preset)) {
    info(`Using existing ${contractName} from ${labelForLog}: ${preset}`);
    return preset;
  }
  const signerOverride = arguments.length >= 4 ? arguments[3] : null;
  const Factory = signerOverride
    ? await ethers.getContractFactory(contractName, signerOverride)
    : await ethers.getContractFactory(contractName);
  const facet = await Factory.deploy();
  await facet.waitForDeployment();
  const addr = await facet.getAddress();
  ok(`Deployed ${contractName}`, addr);
  return addr;
}

function isAddress(v) {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  const network = await ethers.provider.getNetwork();
  let networkName = process.env.HARDHAT_NETWORK || "unknown";
  if (
    (networkName === "hardhat" || networkName === "unknown") &&
    Number(network.chainId) === 31337
  ) {
    networkName = "localhost";
  } else if (Number(network.chainId) === 999) {
    networkName = "hyperliquid";
  } else if (Number(network.chainId) === 998) {
    networkName = "hyperliquid_testnet";
  }
  head("Gasless Facets Upgrade");
  info("Network");
  logKV("name", networkName);
  logKV("chainId", String(network.chainId));

  const forceNewRegistry =
    hasFlag("--force-new-session-registry") ||
    String(process.env.FORCE_NEW_SESSION_REGISTRY || "false").toLowerCase() ===
      "true";
  if (forceNewRegistry) {
    warn(
      "force-new-session-registry enabled: will deploy a new GlobalSessionRegistry"
    );
  }

  const deployment = readDeployment(networkName) || {};
  // Resolve ORDERBOOK target
  let orderBook = process.env.ORDERBOOK || "";
  if (!orderBook) {
    orderBook = deployment?.defaultMarket?.orderBook || "";
  }
  if (
    !orderBook &&
    Array.isArray(deployment.markets) &&
    deployment.markets.length > 0
  ) {
    orderBook = deployment.markets[0]?.orderBook || "";
  }
  if (!orderBook || !/^0x[a-fA-F0-9]{40}$/.test(orderBook)) {
    throw new Error(
      "ORDERBOOK not provided and could not resolve from deployments file."
    );
  }
  info("Target Diamond (OrderBook)");
  logKV("orderBook", orderBook);

  // Support multiple diamond owners by allowing ADMIN_PRIVATE_KEY_2 as well.
  // We'll pick the signer per OrderBook based on diamond.owner().
  function normalizePk(v) {
    let raw = String(v || "").trim();
    // Common .env.local pattern: values wrapped in quotes
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1).trim();
    }
    if (!raw) return "";
    const pk = raw.startsWith("0x") ? raw : `0x${raw}`;
    return /^0x[a-fA-F0-9]{64}$/.test(pk) ? pk : "";
  }

  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) {
    throw new Error(
      "Missing/invalid ADMIN_PRIVATE_KEY in env (needed to perform diamondCut as owner)."
    );
  }

  const adminWallet1 = new ethers.Wallet(pk1, ethers.provider);
  const adminAddr1 = await adminWallet1.getAddress();
  const adminWallet2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const adminAddr2 = adminWallet2 ? await adminWallet2.getAddress() : null;
  const adminWallet3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  const adminAddr3 = adminWallet3 ? await adminWallet3.getAddress() : null;

  const adminWalletsByAddr = new Map();
  adminWalletsByAddr.set(adminAddr1.toLowerCase(), adminWallet1);
  if (adminAddr2)
    adminWalletsByAddr.set(adminAddr2.toLowerCase(), adminWallet2);
  if (adminAddr3)
    adminWalletsByAddr.set(adminAddr3.toLowerCase(), adminWallet3);

  function pickAdminWalletByOwner(ownerAddr) {
    return (
      adminWalletsByAddr.get(String(ownerAddr || "").toLowerCase()) || null
    );
  }

  info("Upgrade signers");
  logKV("ADMIN_PRIVATE_KEY address", adminAddr1);
  logKV("ADMIN_PRIVATE_KEY_2 address", adminAddr2 || "(unset)");
  logKV("ADMIN_PRIVATE_KEY_3 address", adminAddr3 || "(unset)");
  // Debug (safe): presence vs validity so you can see if .env is being read and if parsing failed
  logKV(
    "ADMIN_PRIVATE_KEY_2 present",
    Boolean(String(process.env.ADMIN_PRIVATE_KEY_2 || "").trim())
  );
  logKV("ADMIN_PRIVATE_KEY_2 valid", Boolean(pk2));
  logKV(
    "ADMIN_PRIVATE_KEY_3 present",
    Boolean(String(process.env.ADMIN_PRIVATE_KEY_3 || "").trim())
  );
  logKV("ADMIN_PRIVATE_KEY_3 valid", Boolean(pk3));

  const skippedNotOwner = [];
  const skippedAlreadyMigrated = [];
  const skippedErrors = [];

  // Helper to upgrade one diamond
  async function upgradeOne(orderBook, obFacetAddr, metaFacetAddr) {
    info("Upgrading diamond", { orderBook });
    let diamondSigner = null;
    // Preflight ownership check to avoid revert on diamondCut
    try {
      const own = await ethers.getContractAt(
        ["function owner() view returns (address)"],
        orderBook,
        ethers.provider
      );
      const ownerAddr = await own.owner();
      logKV(`diamond.owner`, ownerAddr);
      diamondSigner = pickAdminWalletByOwner(ownerAddr);
      if (!diamondSigner) {
        warn("Skipping orderbook: no admin key matches diamond owner", {
          orderBook,
          owner: ownerAddr,
          admin1: adminAddr1,
          admin2: adminAddr2 || null,
        });
        skippedNotOwner.push({ orderBook, owner: ownerAddr });
        return { skipped: true, reason: "not_owner" };
      }
    } catch (e) {
      skippedErrors.push({
        orderBook,
        step: "owner_check",
        error: e?.message || String(e),
      });
      throw e;
    }
    const loupe = await ethers.getContractAt(
      ["function facetAddress(bytes4) view returns (address)"],
      orderBook
    );
    const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
    const cut = [];

    // OBOrderPlacementFacet
    const { selectors: obSelectors, abi: obAbi } = await selectorsFromArtifact(
      "OBOrderPlacementFacet"
    );
    const obAdd = [];
    const obReplace = [];
    for (const sel of obSelectors) {
      try {
        const addr = await loupe.facetAddress(sel);
        if (!addr || addr === ethers.ZeroAddress) {
          obAdd.push(sel);
        } else if (addr.toLowerCase() !== obFacetAddr.toLowerCase()) {
          obReplace.push(sel);
        }
      } catch {
        obAdd.push(sel);
      }
    }
    if (obReplace.length)
      cut.push({
        facetAddress: obFacetAddr,
        action: FacetCutAction.Replace,
        functionSelectors: obReplace,
      });
    if (obAdd.length)
      cut.push({
        facetAddress: obFacetAddr,
        action: FacetCutAction.Add,
        functionSelectors: obAdd,
      });
    ok("OBOrderPlacementFacet selector plan", {
      replace: obReplace.length,
      add: obAdd.length,
    });

    // MetaTradeFacet
    const { selectors: metaSelectors, abi: metaAbi } =
      await selectorsFromArtifact("MetaTradeFacet");
    const metaAdd = [];
    const metaReplace = [];
    for (const sel of metaSelectors) {
      try {
        const addr = await loupe.facetAddress(sel);
        if (!addr || addr === ethers.ZeroAddress) metaAdd.push(sel);
        else if (addr.toLowerCase() !== metaFacetAddr.toLowerCase())
          metaReplace.push(sel);
      } catch {
        metaAdd.push(sel);
      }
    }
    if (metaReplace.length)
      cut.push({
        facetAddress: metaFacetAddr,
        action: FacetCutAction.Replace,
        functionSelectors: metaReplace,
      });
    if (metaAdd.length)
      cut.push({
        facetAddress: metaFacetAddr,
        action: FacetCutAction.Add,
        functionSelectors: metaAdd,
      });
    ok("MetaTradeFacet selector plan", {
      replace: metaReplace.length,
      add: metaAdd.length,
    });

    // If there is nothing to change, treat as already migrated IF registry is attached and orderbook is allowed.
    // This prevents re-sending no-op txs on reruns.
    if (
      obReplace.length === 0 &&
      obAdd.length === 0 &&
      metaReplace.length === 0 &&
      metaAdd.length === 0
    ) {
      let registryAttached = false;
      let allowedOnRegistry = false;
      try {
        const facet = await ethers.getContractAt(
          ["function sessionRegistry() view returns (address)"],
          orderBook,
          ethers.provider
        );
        const cur = await facet.sessionRegistry();
        registryAttached = cur && cur !== ethers.ZeroAddress;
      } catch {}
      try {
        const registry = await ethers.getContractAt(
          ["function allowedOrderbook(address) view returns (bool)"],
          registryAddr,
          ethers.provider
        );
        allowedOnRegistry = await registry.allowedOrderbook(orderBook);
      } catch {}
      if (registryAttached && allowedOnRegistry) {
        info(
          "Skipping orderbook: already migrated (selectors + registry wiring)",
          { orderBook }
        );
        skippedAlreadyMigrated.push(orderBook);
        return { skipped: true, reason: "already_migrated" };
      }
      // Otherwise, allow ensureRegistryAttached to run (it may still need to attach).
      return {
        skipped: false,
        reason: "selectors_ok_needs_attach",
        diamondSigner,
      };
    }

    if (!cut.length) {
      warn(
        "No selectors to add/replace for this diamond. Skipping diamondCut."
      );
      return { skipped: false, reason: "no_cut" };
    }
    head("diamondCut");
    info("Submitting diamondCut");
    logKV("entries", cut.length);
    const diamond = await ethers.getContractAt(
      "IDiamondCut",
      orderBook,
      diamondSigner
    );
    const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
    info("Tx submitted", { hash: tx.hash });
    const rc = await tx.wait();
    ok("Tx mined");
    logKV("block", rc.blockNumber);
    logKV("gasUsed", rc.gasUsed.toString());
    return { skipped: false, reason: "upgraded", diamondSigner };
  }

  // 1) Resolve facet addresses: in batch mode, require presets (skip deployment)
  const obPreset =
    process.env.OB_ORDER_PLACEMENT_FACET ||
    process.env.OB_PLACEMENT_FACET ||
    "";
  const metaPreset = process.env.META_TRADE_FACET || "";
  const batchMode = !process.env.ORDERBOOK; // apply across markets if ORDERBOOK not set
  let obFacetAddr, metaFacetAddr;
  if (batchMode) {
    if (!isAddress(obPreset) || !isAddress(metaPreset)) {
      throw new Error(
        "In batch mode, set OB_ORDER_PLACEMENT_FACET and META_TRADE_FACET to valid addresses to skip deployment."
      );
    }
    info("Batch mode: using provided facet addresses only");
    obFacetAddr = obPreset;
    metaFacetAddr = metaPreset;
  } else {
    obFacetAddr = await deployFacetIfNeeded(
      "OBOrderPlacementFacet",
      obPreset,
      obPreset
        ? process.env.OB_ORDER_PLACEMENT_FACET
          ? "OB_ORDER_PLACEMENT_FACET"
          : "OB_PLACEMENT_FACET"
        : "auto-deploy",
      adminWallet1
    );
    metaFacetAddr = await deployFacetIfNeeded(
      "MetaTradeFacet",
      metaPreset,
      metaPreset ? "META_TRADE_FACET" : "auto-deploy",
      adminWallet1
    );
  }

  // Resolve the GlobalSessionRegistry once (important for batch mode).
  // We do NOT redeploy on reruns; set SESSION_REGISTRY_ADDRESS to the new registry address.
  const signerAddr = adminAddr1;
  const currentEnv =
    process.env.SESSION_REGISTRY_ADDRESS || process.env.REGISTRY || "";
  let registryAddr = "";
  if (currentEnv && /^0x[a-fA-F0-9]{40}$/.test(currentEnv)) {
    info(
      "[UpGas][script] Using existing GlobalSessionRegistry from env",
      currentEnv
    );
    registryAddr = currentEnv;
  } else {
    throw new Error(
      "SESSION_REGISTRY_ADDRESS is missing/invalid. For reruns, set it to the already-deployed new registry address to avoid redeploy."
    );
  }

  // Registry allowlisting must be performed by the registry owner.
  const registryOwner = await ethers.getContractAt(
    ["function owner() view returns (address)"],
    registryAddr,
    ethers.provider
  );
  const registryOwnerAddr = await registryOwner.owner();
  const registrySigner = pickAdminWalletByOwner(registryOwnerAddr);
  info("SessionRegistry owner");
  logKV("registry", registryAddr);
  logKV("owner", registryOwnerAddr);
  if (!registrySigner) {
    throw new Error(
      `No admin key matches SessionRegistry.owner()=${registryOwnerAddr}. Add ADMIN_PRIVATE_KEY_2 (or use the correct owner key).`
    );
  }

  // 2) Build selectors
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    orderBook
  );

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const cut = [];

  if (batchMode) {
    head("Supabase discovery");
    const url =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key)
      throw new Error(
        "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or ANON) for batch mode"
      );
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, key);
    const excludeSymbolsRaw = (process.env.EXCLUDE_SYMBOLS || "NICKEL")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const excludeOrderBooksRaw = (process.env.EXCLUDE_ORDERBOOKS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    info("Exclusions");
    logKV("symbols", excludeSymbolsRaw);
    logKV("orderBooks", excludeOrderBooksRaw);
    // Fetch markets
    const { data, error } = await supabase
      .from("markets")
      .select("symbol, market_address, chain_id, market_status, is_active")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    const targets = [];
    for (const row of data || []) {
      const addr = (row.market_address || "").toLowerCase();
      const sym = (row.symbol || "").toUpperCase();
      const active = row.is_active && row.market_status === "ACTIVE";
      if (!isAddress(addr)) continue;
      if (!active) continue;
      if (Number(row.chain_id) !== Number(network.chainId)) continue;
      if (excludeSymbolsRaw.some((x) => sym.startsWith(x))) continue;
      if (excludeOrderBooksRaw.includes(addr)) continue;
      targets.push(addr);
    }
    // Unique
    const uniqueTargets = [...new Set(targets)];
    ok("Targets resolved", { count: uniqueTargets.length });
    for (const ob of uniqueTargets) {
      const res = await upgradeOne(ob, obFacetAddr, metaFacetAddr);
      if (res?.skipped) continue;
      await ensureRegistryAttached(
        ob,
        registryAddr,
        res?.diamondSigner,
        registrySigner
      );
    }
  } else {
    const res = await upgradeOne(orderBook, obFacetAddr, metaFacetAddr);
    if (!res?.skipped) {
      await ensureRegistryAttached(
        orderBook,
        registryAddr,
        res?.diamondSigner,
        registrySigner
      );
    }
  }

  // 4) Sync ABIs to frontend facets folder
  const destDir = path.resolve(
    __dirname,
    "..",
    "..",
    "src",
    "lib",
    "abis",
    "facets"
  );
  fs.mkdirSync(destDir, { recursive: true });
  // Always load fresh full ABIs from artifacts to ensure completeness
  const obArtifactFinal = await artifacts.readArtifact("OBOrderPlacementFacet");
  const metaArtifactFinal = await artifacts.readArtifact("MetaTradeFacet");
  const registryArtifactFinal = await artifacts.readArtifact(
    "GlobalSessionRegistry"
  );
  const obAbi = obArtifactFinal.abi;
  const metaAbi = metaArtifactFinal.abi;
  const registryAbi = registryArtifactFinal.abi;
  const writeAbi = (name, abi) => {
    const outPath = path.join(destDir, `${name}.json`);
    const content = JSON.stringify({ abi }, null, 2) + "\n";
    fs.writeFileSync(outPath, content, "utf8");
    ok(`Synced ABI -> ${name}.json`);
    logKV("path", outPath);
  };
  writeAbi("OBOrderPlacementFacet", obAbi);
  writeAbi("MetaTradeFacet", metaAbi);

  // Also sync GlobalSessionRegistry ABI (used by app API routes)
  const registryOut = path.resolve(
    __dirname,
    "..",
    "..",
    "src",
    "lib",
    "abis",
    "GlobalSessionRegistry.json"
  );
  fs.writeFileSync(
    registryOut,
    JSON.stringify({ abi: registryAbi }, null, 2) + "\n",
    "utf8"
  );
  ok("Synced ABI -> GlobalSessionRegistry.json");
  logKV("path", registryOut);

  head("Completed");
  ok("Upgrade finished");
  logKV("OrderBook", orderBook);
  logKV("OBOrderPlacementFacet", obFacetAddr);
  logKV("MetaTradeFacet", metaFacetAddr);
  logKV("GlobalSessionRegistry", registryAddr);

  sep();
  console.log("Skipped orderbooks");
  sep();
  console.log("notOwner:", skippedNotOwner.length);
  for (const s of skippedNotOwner)
    console.log("  -", s.orderBook, "(owner", s.owner + ")");
  console.log("alreadyMigrated:", skippedAlreadyMigrated.length);
  for (const ob of skippedAlreadyMigrated) console.log("  -", ob);
  console.log("errors:", skippedErrors.length);
  for (const e of skippedErrors)
    console.log("  -", e.orderBook, e.step, e.error);
}

/**
 * Resolve or deploy a GlobalSessionRegistry and attach it:
 *  - Deploy if SESSION_REGISTRY_ADDRESS is not set
 *  - setAllowedOrderbook(orderBook, true)
 *  - setSessionRegistry(orderBook)
 */
async function ensureRegistryAttached(
  orderBook,
  registryAddr,
  diamondSigner,
  registrySigner
) {
  if (!registryAddr || !/^0x[a-fA-F0-9]{40}$/.test(registryAddr)) {
    throw new Error("ensureRegistryAttached: missing/invalid registryAddr");
  }
  const sDiamond = diamondSigner || (await ethers.getSigners())[0];
  const sRegistry = registrySigner || sDiamond;
  // Allow this orderbook
  const registry = await ethers.getContractAt(
    [
      "function allowedOrderbook(address) view returns (bool)",
      "function setAllowedOrderbook(address,bool) external",
    ],
    registryAddr,
    sRegistry
  );
  const allowed = await registry.allowedOrderbook(orderBook);
  if (!allowed) {
    info("[UpGas][script] Allowing orderbook on registry", orderBook);
    const tx = await registry.setAllowedOrderbook(orderBook, true);
    info("[UpGas][script] setAllowedOrderbook tx", tx.hash);
    await tx.wait();
    ok("[UpGas][script] Orderbook allowed on registry");
  } else {
    info("[UpGas][script] Orderbook already allowed on registry", orderBook);
  }
  // Set sessionRegistry on diamond
  try {
    const loupe = await ethers.getContractAt(
      ["function facetAddress(bytes4) view returns (address)"],
      orderBook
    );
    const selSessionRegistry = ethers.id("sessionRegistry()").slice(0, 10);
    const selSetSessionRegistry = ethers
      .id("setSessionRegistry(address)")
      .slice(0, 10);
    const viewFacet = await loupe.facetAddress(selSessionRegistry);
    const setFacet = await loupe.facetAddress(selSetSessionRegistry);
    const hasView = viewFacet && viewFacet !== ethers.ZeroAddress;
    const hasSet = setFacet && setFacet !== ethers.ZeroAddress;
    if (!hasView || !hasSet) {
      warn(
        "[UpGas][script] sessionRegistry functions not found on diamond; skipping attach",
        {
          hasView,
          hasSet,
        }
      );
      return;
    }
    const facet = await ethers.getContractAt(
      [
        "function setSessionRegistry(address) external",
        "function sessionRegistry() view returns (address)",
      ],
      orderBook,
      sDiamond
    );
    const current = await facet.sessionRegistry();
    if (current?.toLowerCase?.() !== registryAddr.toLowerCase()) {
      info("[UpGas][script] Setting sessionRegistry on diamond", {
        orderBook,
        registryAddr,
      });
      const tx2 = await facet.setSessionRegistry(registryAddr);
      info("[UpGas][script] setSessionRegistry tx", tx2.hash);
      await tx2.wait();
      ok("[UpGas][script] sessionRegistry set on diamond");
    } else {
      info("[UpGas][script] sessionRegistry already set on diamond", current);
    }
  } catch (e) {
    warn(
      "[UpGas][script] Skipping sessionRegistry attach due to error",
      e?.message || String(e)
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ upgrade-gasless-facets failed:", e?.message || String(e));
    process.exit(1);
  });
