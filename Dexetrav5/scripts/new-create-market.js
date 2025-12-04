#!/usr/bin/env node

// new-create-market.js - HyperLiquid mainnet: create a new Diamond OrderBook market
//
// Usage (from repo root):
//   npx hardhat --config Dexetrav5/hardhat.config.js \
//     run Dexetrav5/scripts/new-create-market.js --network hyperliquid -- \
//     --symbol GOLD-USD --metric-url "https://example.com/gold" --start-price 2500
//
// Env alternatives:
//   SYMBOL=GOLD-USD METRIC_URL=https://example.com/gold START_PRICE=2500 \
//   npx hardhat --config Dexetrav5/hardhat.config.js run Dexetrav5/scripts/new-create-market.js --network hyperliquid
//
// Notes:
// - Uses existing deployed CoreVault and FuturesMarketFactory (no redeploys)
// - Deploys fresh OrderBook facet contracts for the new Diamond
// - Grants CoreVault roles to the new OrderBook
// - Saves market via API (/api/markets/save) with fallback to Supabase

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Load env from common locations (prefer workspace root .env.local)
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
  require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
} catch (_) {}

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function getBool(flag, fallback = false) {
  return process.argv.includes(flag) ? true : fallback;
}

function readEnvAny(keys) {
  try {
    const search = Array.isArray(keys) ? keys : [String(keys || "")];
    for (const baseKey of search) {
      if (!baseKey) continue;
      const variants = [baseKey, `NEXT_PUBLIC_${baseKey}`];
      for (const k of variants) {
        const v = process.env[k];
        if (v != null && String(v).trim().length > 0) return String(v).trim();
      }
    }
  } catch (_) {}
  return null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const gfetch =
      global.fetch ||
      (await (async () =>
        (await import("node-fetch")).then((m) => m.default || m))());
    const res = await gfetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function loadFacetAbi(contractName) {
  try {
    const artifactPath = path.join(
      __dirname,
      "../artifacts",
      "src",
      "diamond",
      "facets",
      `${contractName}.sol`,
      `${contractName}.json`
    );
    const artifact = require(artifactPath);
    if (artifact && Array.isArray(artifact.abi)) return artifact.abi;
  } catch (_) {}
  return [];
}

function selectorsFromAbi(abi) {
  try {
    const iface = new ethers.Interface(abi);
    return iface.fragments
      .filter((f) => f && f.type === "function")
      .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
  } catch (_) {
    return [];
  }
}

async function submitHyperCoreAction(action) {
  const methods = [
    (process.env.HYPERCORE_ACTION_METHOD || "").trim() || undefined,
    "hypercore_submitAction",
    "core_submitAction",
    "hyperEVM_submitAction",
    "hyperEvm_submitAction",
    "hyperliquid_submitAction",
    "bigblocks_submitAction",
    "submitAction",
    "action",
  ].filter(Boolean);
  const tryWithProvider = async (provider) => {
    let lastErr = null;
    for (const m of methods) {
      try {
        const res = await provider.send(m, [action]);
        return { method: m, result: res };
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    throw new Error("No supported action RPC method found");
  };
  // First try the current Hardhat provider
  try {
    return await tryWithProvider(ethers.provider);
  } catch (_) {
    // Fallback to Hyperliquid native RPC for action endpoints
    try {
      const url =
        process.env.HYPERLIQUID_ACTION_RPC_URL ||
        process.env.HYPERCORE_RPC_URL ||
        process.env.RPC_URL_HYPERCORE ||
        "https://rpc.hyperliquid.xyz/v1";
      const alt = new ethers.JsonRpcProvider(url, 999);
      return await tryWithProvider(alt);
    } catch (e2) {
      throw e2;
    }
  }
}

async function isUsingBigBlocks(address) {
  const tryCheck = async (provider) => {
    try {
      // JSON-RPC custom endpoint documented in Hyperliquid docs
      // https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/json-rpc
      return await provider.send("eth_usingBigBlocks", [address]);
    } catch (_) {
      return null;
    }
  };
  // Try current provider first
  let res = await tryCheck(ethers.provider);
  if (typeof res === "boolean") return res;
  // Fallback to native Hyperliquid RPC
  try {
    const url =
      process.env.HYPERLIQUID_ACTION_RPC_URL ||
      process.env.HYPERCORE_RPC_URL ||
      process.env.RPC_URL_HYPERCORE ||
      "https://rpc.hyperliquid.xyz/v1";
    const alt = new ethers.JsonRpcProvider(url, 999);
    res = await tryCheck(alt);
    if (typeof res === "boolean") return res;
  } catch (_) {}
  return null;
}

async function getTxOverrides(preferBigBlock = false) {
  if (preferBigBlock) {
    try {
      const bb = await ethers.provider.send("eth_bigBlockGasPrice", []);
      let baseGas;
      if (typeof bb === "string") baseGas = BigInt(bb);
      else if (typeof bb === "number") baseGas = BigInt(bb);
      else if (bb && typeof bb.gasPrice !== "undefined")
        baseGas = BigInt(bb.gasPrice);
      if (baseGas && baseGas > 0n) {
        const bumped = (baseGas * 12n) / 10n; // +20%
        const minLegacy = ethers.parseUnits("20", "gwei");
        return { gasPrice: bumped > minLegacy ? bumped : minLegacy };
      }
    } catch (_) {
      // Try bigBlockGasPrice on Hyperliquid native RPC as a fallback
      try {
        const url =
          process.env.HYPERLIQUID_ACTION_RPC_URL ||
          process.env.HYPERCORE_RPC_URL ||
          process.env.RPC_URL_HYPERCORE ||
          "https://rpc.hyperliquid.xyz/v1";
        const alt = new ethers.JsonRpcProvider(url, 999);
        const bb = await alt.send("eth_bigBlockGasPrice", []);
        let baseGas;
        if (typeof bb === "string") baseGas = BigInt(bb);
        else if (typeof bb === "number") baseGas = BigInt(bb);
        else if (bb && typeof bb.gasPrice !== "undefined")
          baseGas = BigInt(bb.gasPrice);
        if (baseGas && baseGas > 0n) {
          const bumped = (baseGas * 12n) / 10n; // +20%
          const minLegacy = ethers.parseUnits("20", "gwei");
          return { gasPrice: bumped > minLegacy ? bumped : minLegacy };
        }
      } catch (_) {
        // fall through to standard fee logic
      }
    }
  }
  try {
    const fee = await ethers.provider.getFeeData();
    const minPriority = ethers.parseUnits("2", "gwei");
    const minMax = ethers.parseUnits("20", "gwei");
    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
      const maxPriority =
        fee.maxPriorityFeePerGas > minPriority
          ? fee.maxPriorityFeePerGas
          : minPriority;
      let maxFee = fee.maxFeePerGas + maxPriority;
      if (maxFee < minMax) maxFee = minMax;
      return { maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPriority };
    }
    const base = fee.gasPrice || ethers.parseUnits("10", "gwei");
    const bumped = (base * 12n) / 10n;
    const minLegacy = ethers.parseUnits("20", "gwei");
    return { gasPrice: bumped > minLegacy ? bumped : minLegacy };
  } catch (_) {
    return { gasPrice: ethers.parseUnits("20", "gwei") };
  }
}

// Deploy a facet contract with detailed logs and return { ctr, addr }
async function deployFacetWithLogs(contractName) {
  const Factory = await ethers.getContractFactory(contractName);
  console.log(`  • Deploying ${contractName}...`);
  const ctr = await Factory.deploy();
  let depTx = null;
  try {
    depTx =
      typeof ctr.deploymentTransaction === "function"
        ? ctr.deploymentTransaction()
        : ctr.deploymentTransaction || null;
  } catch (_) {
    depTx = ctr.deploymentTransaction || null;
  }
  if (depTx?.hash) {
    console.log(`    - tx: ${depTx.hash}`);
  }
  console.log("    - waiting for deployment...");
  await ctr.waitForDeployment();
  const addr = await ctr.getAddress();
  console.log(`    - deployed at: ${addr}`);
  try {
    if (depTx?.hash) {
      const rc = await ethers.provider.getTransactionReceipt(depTx.hash);
      if (rc) {
        const gasUsed = rc.gasUsed?.toString?.();
        console.log(
          `    - mined: block=${rc.blockNumber}${
            gasUsed ? ` gasUsed=${gasUsed}` : ""
          }`
        );
      }
    }
  } catch (_) {}
  return { ctr, addr };
}

async function resolveCoreContracts(deployer, effectiveNetworkName) {
  // Prefer env, then deployments JSON, then config helper
  const deploymentPath = path.join(
    __dirname,
    `../deployments/${effectiveNetworkName}-deployment.json`
  );
  let coreVaultAddr =
    process.env.CORE_VAULT_ADDRESS || process.env.CORE_VAULT || null;
  let factoryAddr =
    process.env.FUTURES_MARKET_FACTORY_ADDRESS ||
    process.env.FUTURES_MARKET_FACTORY ||
    null;
  try {
    if ((!coreVaultAddr || !factoryAddr) && fs.existsSync(deploymentPath)) {
      const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
      coreVaultAddr =
        coreVaultAddr || deployment?.contracts?.CORE_VAULT || null;
      factoryAddr =
        factoryAddr || deployment?.contracts?.FUTURES_MARKET_FACTORY || null;
    }
  } catch (_) {}
  if (!coreVaultAddr || !factoryAddr) {
    const { getContract } = require("../config/contracts");
    const coreVault = (await getContract("CORE_VAULT")).connect(deployer);
    const factory = (await getContract("FUTURES_MARKET_FACTORY")).connect(
      deployer
    );
    return { coreVault, factory };
  }
  const coreVault = await ethers.getContractAt(
    "CoreVault",
    coreVaultAddr,
    deployer
  );
  const factory = await ethers.getContractAt(
    "FuturesMarketFactory",
    factoryAddr,
    deployer
  );
  return { coreVault, factory };
}

async function buildCutViaApiOrEnv() {
  // 1) Try API
  try {
    const baseUrl = (
      process.env.APP_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, "");
    const res = await fetchWithTimeout(
      `${baseUrl}/api/orderbook/cut`,
      { method: "GET" },
      12000
    );
    if (res && res.ok) {
      const json = await res.json().catch(() => ({}));
      const cut = Array.isArray(json?.cut) ? json.cut : [];
      const initFacet = json?.initFacet || null;
      const cutArg = cut.map((c) => [
        c.facetAddress,
        typeof c.action === "number" ? c.action : 0,
        c.functionSelectors,
      ]);
      if (cutArg.length > 0 && initFacet) return { cutArg, initFacet };
    }
  } catch (_) {}
  // 2) Env fallback
  const initFacet = readEnvAny([
    "ORDER_BOOK_INIT_FACET",
    "ORDERBOOK_INIT_FACET",
    "ORDER_BOOK_INIT_FACET_ADDRESS",
    "ORDERBOOK_INIT_FACET_ADDRESS",
    "FACET_INIT",
    "FACET_INIT_ADDRESS",
    "OB_INIT_FACET",
    "OB_INIT_FACET_ADDRESS",
  ]);
  const adminFacet = readEnvAny([
    "OB_ADMIN_FACET",
    "OB_ADMIN_FACET_ADDRESS",
    "ORDER_BOOK_ADMIN_FACET",
    "ORDERBOOK_ADMIN_FACET",
    "ORDER_BOOK_ADMIN_FACET_ADDRESS",
    "ORDERBOOK_ADMIN_FACET_ADDRESS",
    "FACET_ADMIN",
    "FACET_ADMIN_ADDRESS",
  ]);
  const pricingFacet = readEnvAny([
    "OB_PRICING_FACET",
    "OB_PRICING_FACET_ADDRESS",
    "ORDER_BOOK_PRICING_FACET",
    "ORDERBOOK_PRICING_FACET",
    "ORDER_BOOK_PRICING_FACET_ADDRESS",
    "ORDERBOOK_PRICING_FACET_ADDRESS",
    "FACET_PRICING",
    "FACET_PRICING_ADDRESS",
  ]);
  const placementFacet = readEnvAny([
    "OB_ORDER_PLACEMENT_FACET",
    "OB_ORDER_PLACEMENT_FACET_ADDRESS",
    "ORDER_BOOK_PLACEMENT_FACET",
    "ORDERBOOK_PLACEMENT_FACET",
    "ORDER_BOOK_PLACEMENT_FACET_ADDRESS",
    "ORDERBOOK_PLACEMENT_FACET_ADDRESS",
    "FACET_PLACEMENT",
    "FACET_PLACEMENT_ADDRESS",
  ]);
  const execFacet = readEnvAny([
    "OB_TRADE_EXECUTION_FACET",
    "OB_TRADE_EXECUTION_FACET_ADDRESS",
    "ORDER_BOOK_EXECUTION_FACET",
    "ORDERBOOK_EXECUTION_FACET",
    "ORDER_BOOK_EXECUTION_FACET_ADDRESS",
    "ORDERBOOK_EXECUTION_FACET_ADDRESS",
    "FACET_EXEC",
    "FACET_EXEC_ADDRESS",
  ]);
  const liqFacet = readEnvAny([
    "OB_LIQUIDATION_FACET",
    "OB_LIQUIDATION_FACET_ADDRESS",
    "ORDER_BOOK_LIQUIDATION_FACET",
    "ORDERBOOK_LIQUIDATION_FACET",
    "ORDER_BOOK_LIQUIDATION_FACET_ADDRESS",
    "ORDERBOOK_LIQUIDATION_FACET_ADDRESS",
    "FACET_LIQ",
    "FACET_LIQ_ADDRESS",
  ]);
  const viewFacet = readEnvAny([
    "OB_VIEW_FACET",
    "OB_VIEW_FACET_ADDRESS",
    "ORDER_BOOK_VIEW_FACET",
    "ORDERBOOK_VIEW_FACET",
    "ORDER_BOOK_VIEW_FACET_ADDRESS",
    "ORDERBOOK_VIEW_FACET_ADDRESS",
    "FACET_VIEW",
    "FACET_VIEW_ADDRESS",
  ]);
  const settleFacet = readEnvAny([
    "OB_SETTLEMENT_FACET",
    "OB_SETTLEMENT_FACET_ADDRESS",
    "ORDER_BOOK_SETTLEMENT_FACET",
    "ORDERBOOK_SETTLEMENT_FACET",
    "ORDER_BOOK_SETTLEMENT_FACET_ADDRESS",
    "ORDERBOOK_SETTLEMENT_FACET_ADDRESS",
    "FACET_SETTLEMENT",
    "FACET_SETTLEMENT_ADDRESS",
  ]);
  const missing = [];
  if (!initFacet) missing.push("ORDER_BOOK_INIT_FACET");
  if (!adminFacet) missing.push("OB_ADMIN_FACET");
  if (!pricingFacet) missing.push("OB_PRICING_FACET");
  if (!placementFacet) missing.push("OB_ORDER_PLACEMENT_FACET");
  if (!execFacet) missing.push("OB_TRADE_EXECUTION_FACET");
  if (!liqFacet) missing.push("OB_LIQUIDATION_FACET");
  if (!viewFacet) missing.push("OB_VIEW_FACET");
  if (!settleFacet) missing.push("OB_SETTLEMENT_FACET");
  if (missing.length) {
    throw new Error(`Missing facet env vars: ${missing.join(", ")}`);
  }
  const adminSelectors = selectorsFromAbi(loadFacetAbi("OBAdminFacet"));
  const pricingSelectors = selectorsFromAbi(loadFacetAbi("OBPricingFacet"));
  const placementSelectors = selectorsFromAbi(
    loadFacetAbi("OBOrderPlacementFacet")
  );
  const execSelectors = selectorsFromAbi(loadFacetAbi("OBTradeExecutionFacet"));
  const liqSelectors = selectorsFromAbi(loadFacetAbi("OBLiquidationFacet"));
  const viewSelectors = selectorsFromAbi(loadFacetAbi("OBViewFacet"));
  const settleSelectors = selectorsFromAbi(loadFacetAbi("OBSettlementFacet"));
  const cutArg = [
    [adminFacet, 0, adminSelectors],
    [pricingFacet, 0, pricingSelectors],
    [placementFacet, 0, placementSelectors],
    [execFacet, 0, execSelectors],
    [liqFacet, 0, liqSelectors],
    [viewFacet, 0, viewSelectors],
    [settleFacet, 0, settleSelectors],
  ];
  return { cutArg, initFacet };
}

function getSupabaseClient() {
  try {
    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url || !serviceKey) return null;
    return createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch (_) {
    return null;
  }
}

async function saveMarketDirectSupabase(params) {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  const {
    marketIdentifier,
    symbol,
    name,
    description,
    category,
    decimals,
    minimumOrderSize,
    settlementDate,
    dataRequestWindowSeconds,
    chainId,
    networkName,
    creatorWalletAddress,
    marketAddress,
    marketIdBytes32,
    transactionHash,
    blockNumber,
    gasUsed,
  } = params;
  const insertPayload = {
    market_identifier: marketIdentifier || symbol,
    symbol,
    name: name || symbol,
    description: description || `OrderBook market for ${symbol}`,
    category: category || "CUSTOM",
    decimals: Number.isFinite(decimals)
      ? decimals
      : Number(process.env.DEFAULT_MARKET_DECIMALS || 8),
    minimum_order_size: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
    tick_size: 0.01,
    requires_kyc: false,
    settlement_date: settlementDate
      ? new Date(settlementDate * 1000).toISOString()
      : null,
    data_request_window_seconds: Number(
      dataRequestWindowSeconds ||
        process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS ||
        3600
    ),
    auto_settle: true,
    chain_id: chainId,
    network: networkName,
    creator_wallet_address: creatorWalletAddress || null,
    market_address: marketAddress,
    market_id_bytes32: marketIdBytes32,
    deployment_transaction_hash: transactionHash,
    deployment_block_number: blockNumber != null ? Number(blockNumber) : null,
    deployment_gas_used: gasUsed ? Number(gasUsed) : null,
    deployed_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("markets")
    .upsert([insertPayload], { onConflict: "market_identifier" });
  if (error) return false;
  return true;
}

function sanitizeSymbolForKey(symbol) {
  try {
    return String(symbol)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_");
  } catch {
    return "MARKET";
  }
}

async function main() {
  console.log("\n🚀 NEW CREATE MARKET (HyperLiquid mainnet)");
  console.log("═".repeat(80));

  // Validate network
  const network = await ethers.provider.getNetwork();
  const hhName = String(process.env.HARDHAT_NETWORK || "").toLowerCase();
  const isHyperliquid =
    hhName === "hyperliquid" || Number(network.chainId) === 999;
  if (!isHyperliquid) {
    throw new Error(
      "This script is restricted to HyperLiquid mainnet (use --network hyperliquid)."
    );
  }
  const effectiveNetworkName = "hyperliquid";
  console.log(
    `🌐 Network: ${effectiveNetworkName} (Chain ID: ${network.chainId})`
  );

  // Inputs
  const symbol = process.env.SYMBOL || getArg("--symbol") || getArg("-s");
  if (!symbol)
    throw new Error("--symbol is required (e.g., --symbol GOLD-USD)");
  const metricUrl =
    process.env.METRIC_URL ||
    getArg("--metric-url") ||
    getArg("-u") ||
    "https://example.com";
  const startPriceStr =
    process.env.START_PRICE || getArg("--start-price") || getArg("-p") || "1";
  const dataSource =
    process.env.DATA_SOURCE ||
    getArg("--data-source") ||
    getArg("-d") ||
    "User Provided";
  const tagsCsv = process.env.TAGS || getArg("--tags") || "";
  const tags = tagsCsv
    ? tagsCsv
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const marginBps = Number.isFinite(Number(process.env.MARGIN_BPS))
    ? Number(process.env.MARGIN_BPS)
    : Number(getArg("--margin-bps", 10000));
  const feeBps = Number.isFinite(Number(process.env.FEE_BPS))
    ? Number(process.env.FEE_BPS)
    : Number(getArg("--fee-bps", 0));
  const disableLeverage =
    (process.env.DISABLE_LEVERAGE ?? null) !== null
      ? String(process.env.DISABLE_LEVERAGE) !== "false"
      : getBool("--disable-leverage", true);
  const treasury = process.env.TREASURY || getArg("--treasury");

  const startPrice6 = ethers.parseUnits(String(startPriceStr), 6);
  const settlementTs = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

  let deployer = (await ethers.getSigners())[0];
  if (!deployer) throw new Error("No signer available");
  const feeRecipient = treasury || deployer.address;
  console.log("👤 Deployer:", deployer.address);
  console.log("🏦 Treasury:", feeRecipient);
  console.log(
    `🪙 ${symbol} • start=$${startPriceStr} • margin=${marginBps}bps • fee=${feeBps}bps`
  );

  // Resolve Core contracts
  const { coreVault, factory } = await resolveCoreContracts(
    deployer,
    effectiveNetworkName
  );
  console.log("🔗 CoreVault:", await coreVault.getAddress());
  console.log("🔗 FuturesMarketFactory:", await factory.getAddress());

  // Use pre-deployed OrderBook facet addresses (hard-coded)
  const initFacet = "0x4f61060d922A954E892Cf1bFbd2692319442bE43";
  const adminAddr = "0xa8c7398e414a5F4D805957Bba34CD3343Eb41885";
  const pricingAddr = "0x326978C5827a89144B19fBa1A79DF6b042d0c1CB";
  const placementAddr = "0xBA48A757F68CfF30bEE9AFf73A49489ad5891eb2";
  const execAddr = "0x86C3AcbaeeEA7E910C4253A842b577d1ac72071A";
  const liqAddr = "0x749A956619BdE7f7207B47e7e188cFDfd8dFe28F";
  const viewAddr = "0xDA41f991b01d44f0Ba909A351d9D5A2A913315aC";
  const settleAddr = "0xE8d285b63cE945A1fC0De964F21c856CDf180D7f";

  try {
    console.log("\n🔎 Facets (predeployed):");
    console.log("  • initFacet:", initFacet);
    console.log("  • adminFacet:", adminAddr);
    console.log("  • pricingFacet:", pricingAddr);
    console.log("  • placementFacet:", placementAddr);
    console.log("  • execFacet:", execAddr);
    console.log("  • liqFacet:", liqAddr);
    console.log("  • viewFacet:", viewAddr);
    console.log("  • settleFacet:", settleAddr);
  } catch (_) {}

  // Compute selectors from ABIs to ensure they match deployed facet code
  const adminSelectors = selectorsFromAbi(loadFacetAbi("OBAdminFacet"));
  const pricingSelectors = selectorsFromAbi(loadFacetAbi("OBPricingFacet"));
  const placementSelectors = selectorsFromAbi(
    loadFacetAbi("OBOrderPlacementFacet")
  );
  const execSelectors = selectorsFromAbi(loadFacetAbi("OBTradeExecutionFacet"));
  const liqSelectors = selectorsFromAbi(loadFacetAbi("OBLiquidationFacet"));
  const viewSelectors = selectorsFromAbi(loadFacetAbi("OBViewFacet"));
  const settleSelectors = selectorsFromAbi(loadFacetAbi("OBSettlementFacet"));

  try {
    console.log("\n🧮 Selector counts per facet:");
    console.log(`  • admin: ${adminSelectors.length}`);
    console.log(`  • pricing: ${pricingSelectors.length}`);
    console.log(`  • placement: ${placementSelectors.length}`);
    console.log(`  • exec: ${execSelectors.length}`);
    console.log(`  • liquidation: ${liqSelectors.length}`);
    console.log(`  • view: ${viewSelectors.length}`);
    console.log(`  • settlement: ${settleSelectors.length}`);
  } catch (_) {}

  const cutArg = [
    [adminAddr, 0, adminSelectors],
    [pricingAddr, 0, pricingSelectors],
    [placementAddr, 0, placementSelectors],
    [execAddr, 0, execSelectors],
    [liqAddr, 0, liqSelectors],
    [viewAddr, 0, viewSelectors],
    [settleAddr, 0, settleSelectors],
  ];
  // 🔎 High-visibility diagnostics for cutArg (full + summary)
  try {
    const cutPreview = cutArg.map(([addr, action, selectors]) => ({
      facetAddress: addr,
      action,
      selectorsCount: Array.isArray(selectors) ? selectors.length : 0,
    }));
    const bold = "\x1b[1m";
    const magenta = "\x1b[35m";
    const cyan = "\x1b[36m";
    const reset = "\x1b[0m";
    console.log(
      `\n${bold}${magenta}🧩 CUT ARG PREVIEW (per facet)${reset} ${cyan}→ verify selectorsCount matches expectations${reset}\n`,
      cutPreview
    );
    const fullJson = JSON.stringify(cutArg, null, 2);
    console.log(
      `${bold}${magenta}🧩 CUT ARG FULL JSON (for exact comparison)${reset}\n${fullJson}\n`
    );
  } catch (_) {}

  // Create market
  console.log("\n🏭 Creating market via FuturesMarketFactory...");
  console.log("  • symbol:", symbol);
  console.log("  • metricUrl:", metricUrl);
  console.log("  • settlementDate:", settlementTs);
  // Preflight estimate + static call
  try {
    const estimateFn = factory.getFunction("createFuturesMarketDiamond");
    const gas = await estimateFn.estimateGas(
      symbol,
      metricUrl,
      settlementTs,
      startPrice6,
      dataSource,
      tags,
      feeRecipient,
      cutArg,
      initFacet,
      "0x"
    );
    console.log("  • estimatedGas:", gas.toString());
  } catch (e) {
    console.log("  • gas estimation failed:", e?.message || e);
  }
  try {
    await factory
      .getFunction("createFuturesMarketDiamond")
      .staticCall(
        symbol,
        metricUrl,
        settlementTs,
        startPrice6,
        dataSource,
        tags,
        feeRecipient,
        cutArg,
        initFacet,
        "0x"
      );
    console.log("  • staticCall: OK");
  } catch (e) {
    console.log("  • staticCall reverted (continuing):", e?.message || e);
  }
  console.log("  • sending transaction...");
  let usingBigBlocks = false;
  try {
    console.log("    - enabling big blocks for deployer...");
    await submitHyperCoreAction({
      type: "evmUserModify",
      usingBigBlocks: true,
    });
    usingBigBlocks = true;
    console.log("    - big blocks enabled");
    try {
      const deployerAddr = await deployer.getAddress();
      let ok = await isUsingBigBlocks(deployerAddr);
      const start = Date.now();
      while (ok !== true && Date.now() - start < 8000) {
        await new Promise((r) => setTimeout(r, 500));
        ok = await isUsingBigBlocks(deployerAddr);
      }
      if (ok !== true) {
        console.log(
          "    - warning: eth_usingBigBlocks did not confirm; continuing"
        );
      }
    } catch (_) {}
  } catch (e) {
    console.log("    - could not enable big blocks:", e?.message || e);
  }
  // Guard: avoid sending heavy factory tx on small blocks unless explicitly allowed
  const allowSmallFactory =
    getBool("--allow-small-block-factory", false) ||
    String(process.env.ALLOW_SMALL_BLOCK_FACTORY || "").toLowerCase() ===
      "true";
  if (!usingBigBlocks && !allowSmallFactory) {
    throw new Error(
      [
        "Big blocks could not be enabled for the deployer, aborting heavy factory deployment to avoid 'exceeds block gas limit'.",
        "Set HYPERLIQUID_ACTION_RPC_URL=https://rpc.hyperliquid.xyz/v1 (or an equivalent native node) and ensure the deployer is a Core user (has received a Core asset like USDC).",
        "Alternatively, re-run with --allow-small-block-factory or ALLOW_SMALL_BLOCK_FACTORY=true to force small-block deploy (likely to fail).",
        "Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/json-rpc",
      ].join(" ")
    );
  }
  const tx = await factory.createFuturesMarketDiamond(
    symbol,
    metricUrl,
    settlementTs,
    startPrice6,
    dataSource,
    tags,
    feeRecipient,
    cutArg,
    initFacet,
    "0x",
    await getTxOverrides(usingBigBlocks)
  );
  console.log("  • tx:", tx.hash);
  console.log("  • awaiting confirmation...");
  const receipt = await tx.wait();
  console.log(
    `  ✅ Market created (block=${receipt?.blockNumber}${
      receipt?.gasUsed ? ` gasUsed=${receipt.gasUsed.toString()}` : ""
    })`
  );
  if (usingBigBlocks) {
    try {
      console.log("    - disabling big blocks for deployer...");
      await submitHyperCoreAction({
        type: "evmUserModify",
        usingBigBlocks: false,
      });
      console.log("    - big blocks disabled");
    } catch (e) {
      console.log("    - could not disable big blocks:", e?.message || e);
    }
  }

  // Parse event
  let orderBook, marketId;
  for (const log of receipt.logs || []) {
    try {
      const parsed = factory.interface.parseLog(log);
      if (parsed.name === "FuturesMarketCreated") {
        orderBook = parsed.args.orderBook;
        marketId = parsed.args.marketId;
        break;
      }
    } catch (_) {}
  }
  if (!orderBook || !marketId)
    throw new Error("Failed to parse FuturesMarketCreated event");
  console.log("  • OrderBook:", orderBook);
  console.log("  • Market ID:", marketId);

  // Configure roles only (trading params are set by OrderBookInitFacet during factory init)
  console.log("\n🔒 Using initializer defaults and configuring roles...");
  try {
    console.log("  • Initializer defaults applied by factory:");
    console.log("    - leverageEnabled: false");
    console.log("    - marginRequirementBps: 10000");
    console.log("    - tradingFee (bps): 10");
    console.log("    - feeRecipient:", feeRecipient);
  } catch (_) {}
  try {
    const ORDERBOOK_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("ORDERBOOK_ROLE")
    );
    const SETTLEMENT_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("SETTLEMENT_ROLE")
    );
    console.log("  • grantRole(ORDERBOOK_ROLE, orderBook)");
    const tA = await coreVault.grantRole(
      ORDERBOOK_ROLE,
      orderBook,
      await getTxOverrides(false)
    );
    console.log("    - tx:", tA.hash);
    const rA = await tA.wait();
    console.log(
      `    - mined (block=${rA?.blockNumber}${
        rA?.gasUsed ? ` gasUsed=${rA.gasUsed.toString()}` : ""
      })`
    );
    console.log("  • grantRole(SETTLEMENT_ROLE, orderBook)");
    const tB = await coreVault.grantRole(
      SETTLEMENT_ROLE,
      orderBook,
      await getTxOverrides(false)
    );
    console.log("    - tx:", tB.hash);
    const rB = await tB.wait();
    console.log(
      `    - mined (block=${rB?.blockNumber}${
        rB?.gasUsed ? ` gasUsed=${rB.gasUsed.toString()}` : ""
      })`
    );
    console.log("  ✅ Roles granted on CoreVault");
  } catch (e) {
    console.log("  ⚠️ Role grant failed:", e?.message || e);
  }

  // Save to DB via API; fallback to Supabase
  const initialOrder = {
    metricUrl,
    startPrice: String(ethers.formatUnits(startPrice6, 6)),
    dataSource,
    tags,
  };
  let saved = false;
  try {
    const baseUrl = (
      process.env.APP_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, "");
    console.log(`\n🗄️  Saving market via API → ${baseUrl}/api/markets/save`);
    const res = await fetchWithTimeout(
      `${baseUrl}/api/markets/save`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketIdentifier: symbol,
          symbol,
          name: `${(symbol.split("-")[0] || symbol).toUpperCase()} Futures`,
          description: `OrderBook market for ${symbol}`,
          category: Array.isArray(tags) && tags.length ? tags[0] : "CUSTOM",
          decimals: Number(process.env.DEFAULT_MARKET_DECIMALS || 8),
          minimumOrderSize: Number(
            process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1
          ),
          settlementDate: settlementTs,
          tradingEndDate: null,
          dataRequestWindowSeconds: Number(
            process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600
          ),
          autoSettle: true,
          oracleProvider: null,
          initialOrder,
          chainId: Number(network.chainId),
          networkName: effectiveNetworkName,
          creatorWalletAddress: deployer.address,
          marketAddress: orderBook,
          marketIdBytes32: marketId,
          transactionHash: receipt?.hash || null,
          blockNumber: receipt?.blockNumber || null,
          gasUsed: receipt?.gasUsed?.toString?.() || null,
        }),
      },
      12000
    );
    if (res) {
      console.log(
        `  • API response: ${res.status} ${res.statusText || ""}`.trim()
      );
    }
    if (res && res.ok) {
      console.log("🗄️  ✅ Market saved via API");
      saved = true;
    } else if (res) {
      try {
        const body = await res.json();
        if (body?.error) console.log("  • API error:", body.error);
      } catch (_) {}
    }
  } catch (_) {}
  if (!saved) {
    console.log("🗄️  Falling back to Supabase direct upsert...");
    const ok = await saveMarketDirectSupabase({
      marketIdentifier: symbol,
      symbol,
      name: `${(symbol.split("-")[0] || symbol).toUpperCase()} Futures`,
      description: `OrderBook market for ${symbol}`,
      category: Array.isArray(tags) && tags.length ? tags[0] : "CUSTOM",
      decimals: Number(process.env.DEFAULT_MARKET_DECIMALS || 8),
      minimumOrderSize: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
      settlementDate: settlementTs,
      dataRequestWindowSeconds: Number(
        process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600
      ),
      chainId: Number(network.chainId),
      networkName: effectiveNetworkName,
      creatorWalletAddress: deployer.address,
      marketAddress: orderBook,
      marketIdBytes32: marketId,
      transactionHash: receipt?.hash || null,
      blockNumber: receipt?.blockNumber || null,
      gasUsed: receipt?.gasUsed?.toString?.() || null,
    });
    console.log(
      ok
        ? "🗄️  ✅ Market saved via Supabase"
        : "🗄️  ⚠️ DB save skipped (no Supabase env)"
    );
  }

  // Update deployments JSON
  const deploymentPath = path.join(
    __dirname,
    `../deployments/${effectiveNetworkName}-deployment.json`
  );
  let deployment = {};
  try {
    if (fs.existsSync(deploymentPath)) {
      deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    }
  } catch (_) {}
  deployment.network = effectiveNetworkName;
  deployment.chainId = Number(network.chainId);
  deployment.timestamp = new Date().toISOString();
  deployment.contracts = deployment.contracts || {};
  const keyBase = sanitizeSymbolForKey(symbol.split("-")[0] || symbol);
  deployment.contracts[`${keyBase}_ORDERBOOK`] = orderBook;
  deployment.contracts[`${keyBase}_MARKET_ID`] = marketId;
  deployment.markets = Array.isArray(deployment.markets)
    ? deployment.markets
    : [];
  const entry = {
    symbol,
    marketId,
    orderBook,
    metricUrl,
    settlementDate: settlementTs,
    startPrice: startPrice6.toString(),
    dataSource,
    tags,
  };
  const existingIdx = deployment.markets.findIndex((m) => m.symbol === symbol);
  if (existingIdx >= 0) deployment.markets[existingIdx] = entry;
  else deployment.markets.push(entry);
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(
    "📝  ✅ Deployment updated:",
    path.relative(process.cwd(), deploymentPath)
  );

  console.log("\n✅ Market ready!");
  console.log("═".repeat(80));
  console.log(`🎯 ${symbol} → ${orderBook}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
