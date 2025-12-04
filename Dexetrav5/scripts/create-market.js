#!/usr/bin/env node

// create-market.js - Create a new Diamond-based market using the existing factory
//
// IMPORTANT: When using Hardhat CLI, pass script args after a "--" separator.
// If your shell is in Dexetrav5/:
//   npx hardhat run scripts/create-market.js --network localhost -- \
//     --symbol Gold-USD \
//     --metric-url "https://example.com/alu" \
//     --start-price 1 \
//     --data-source "Example Source" \
//     --tags "COMMODITIES,METALS" \
//     --margin-bps 10000 \
//     --fee-bps 0 \
//     --treasury 0xYourTreasury
// From repo root:
//   npx hardhat --config Dexetrav5/hardhat.config.js \
//     run Dexetrav5/scripts/create-market.js --network localhost -- \
//     --symbol Gold-USD
//
// HyperLiquid Mainnet example:
//   npx hardhat --config Dexetrav5/hardhat.config.js \
//     run Dexetrav5/scripts/create-market.js --network hyperliquid -- \
//     --symbol ALU-USD --start-price 1
//
// HyperLiquid Testnet example:
//   npx hardhat --config Dexetrav5/hardhat.config.js \
//     run Dexetrav5/scripts/create-market.js --network hyperliquid_testnet -- \
//     --symbol ALU-USD --start-price 1
//
// Alternatively, you can use environment variables (recommended to avoid HH305):
//   SYMBOL=Gold-USD START_PRICE=1 METRIC_URL=https://example.com \
//   npx hardhat run scripts/create-market.js --network localhost
//
// Notes:
// - Reuses the already deployed CoreVault and FuturesMarketFactory
// - Deploys fresh facet contracts for the new Diamond OrderBook
// - Grants ORDERBOOK_ROLE and SETTLEMENT_ROLE to the new OrderBook on CoreVault
// - Updates deployments/{network}-deployment.json by appending to markets[]
// - Updates Dexetrav5/config/contracts.js ORDERBOOK pointer to the new OB (optional)

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const fetch = require("node-fetch");

// Load env from common locations so Hardhat scripts can see Next.js .env.local
try {
  // Workspace root
  require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });
  // Dexetrav5 folder (in case vars are kept alongside hardhat config)
  require("dotenv").config({ path: path.join(__dirname, "../.env.local") });
  require("dotenv").config({ path: path.join(__dirname, "../.env") });
} catch (_) {}

// Lightweight CLI arg parser
function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function getBool(flag, fallback = false) {
  const has = process.argv.includes(flag);
  return has ? true : fallback;
}

function toBps(input, defaultValue) {
  if (input === undefined || input === null) return defaultValue;
  const n = Number(input);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaultValue;
}

function extractError(error) {
  try {
    return (
      error?.shortMessage ||
      error?.reason ||
      error?.error?.message ||
      (typeof error?.data === "string" ? error.data : undefined) ||
      error?.message ||
      String(error)
    );
  } catch (_) {
    return String(error);
  }
}

function logStep(step, status, data) {
  try {
    const payload = {
      area: "create_market",
      step,
      status,
      timestamp: new Date().toISOString(),
    };
    if (data && typeof data === "object") Object.assign(payload, data);
    console.log(JSON.stringify(payload));
  } catch (_) {}
}

async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const ms = Number(process.env.API_TIMEOUT_MS || timeoutMs || 12000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
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

async function getTxOverrides() {
  try {
    // Prefer HyperEVM big block gas price when enabled
    if (USING_BIG_BLOCKS) {
      try {
        const bb = await ethers.provider.send("bigBlockGasPrice", []);
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
        // Fall back to standard fee data if bigBlockGasPrice is unavailable
      }
    }
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
    const bumped = (base * 12n) / 10n; // +20%
    const minLegacy = ethers.parseUnits("20", "gwei");
    return { gasPrice: bumped > minLegacy ? bumped : minLegacy };
  } catch (_) {
    return { gasPrice: ethers.parseUnits("20", "gwei") };
  }
}

// Nonce manager to ensure strictly sequential txs and avoid replacement issues
async function createNonceManager(signer) {
  const address = await signer.getAddress();
  let next = await signer.provider.getTransactionCount(address, "pending");
  return {
    async nextOverrides() {
      const fee = await getTxOverrides();
      const ov = { ...fee, nonce: next };
      next += 1;
      return ov;
    },
  };
}

// Global flag toggled when big blocks are enabled for this user
let USING_BIG_BLOCKS = false;

async function submitHyperCoreAction(action) {
  try {
    // Allow overriding RPC method via env; try common fallbacks if not set
    const envMethod =
      process.env.HYPERCORE_ACTION_METHOD &&
      String(process.env.HYPERCORE_ACTION_METHOD).trim();
    const methods = (envMethod ? [envMethod] : []).concat([
      "hypercore_submitAction",
      "core_submitAction",
      "hyperEVM_submitAction",
      "hyperEvm_submitAction",
      "hyperliquid_submitAction",
      "bigblocks_submitAction",
      "submitAction",
      "action",
    ]);
    for (const m of methods) {
      try {
        const res = await ethers.provider.send(m, [action]);
        return res;
      } catch (_) {}
    }
    throw new Error("No supported action RPC method found");
  } catch (e) {
    throw e;
  }
}

// Load facet ABI from Hardhat artifacts; fallback is not required here because artifacts are shipped
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const artifact = require(artifactPath);
    if (artifact && Array.isArray(artifact.abi)) return artifact.abi;
  } catch (_) {}
  return [];
}

function selectorsFromAbi(abi) {
  try {
    const iface = new ethers.Interface(abi);
    return iface.fragments
      .filter((frag) => frag && frag.type === "function")
      .map((frag) => ethers.id(frag.format("sighash")).slice(0, 10));
  } catch (_) {
    return [];
  }
}

// Verify that critical placement selectors are present on the Diamond; add if missing
// placementFacetOverride: optional facet address to use for diamondCut (falls back to env)
async function ensurePlacementSelectors(
  orderBookAddress,
  nonceManager,
  placementFacetOverride
) {
  try {
    const loupeAbi = ["function facetAddress(bytes4) view returns (address)"];
    const cutAbi = [
      "function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)",
    ];
    const loupe = await ethers.getContractAt(loupeAbi, orderBookAddress);
    const diamondCut = await ethers.getContractAt(cutAbi, orderBookAddress);

    // Critical placement function signatures required by the UI
    const placementSignatures = [
      "placeLimitOrder(uint256,uint256,bool)",
      "placeMarginLimitOrder(uint256,uint256,bool)",
      "placeMarketOrder(uint256,bool)",
      "placeMarginMarketOrder(uint256,bool)",
      "placeMarketOrderWithSlippage(uint256,bool,uint256)",
      "placeMarginMarketOrderWithSlippage(uint256,bool,uint256)",
      "cancelOrder(uint256)",
    ];
    const requiredSelectors = placementSignatures.map((sig) =>
      ethers.id(sig).slice(0, 10)
    );

    // Determine which selectors are missing from the Diamond
    const missing = [];
    for (const sel of requiredSelectors) {
      try {
        const addr = await loupe.facetAddress(sel);
        if (!addr || String(addr).toLowerCase() === ethers.ZeroAddress) {
          missing.push(sel);
        }
      } catch {
        // If loupe call fails, assume missing
        missing.push(sel);
      }
    }
    if (missing.length === 0) {
      console.log("  ✅ Diamond already exposes all placement selectors");
      return;
    }

    // Resolve Order Placement facet address from override then env
    const placementFacetAddr =
      placementFacetOverride ||
      readEnvAny([
        "OB_ORDER_PLACEMENT_FACET",
        "OB_ORDER_PLACEMENT_FACET_ADDRESS",
        "ORDER_BOOK_PLACEMENT_FACET",
        "ORDERBOOK_PLACEMENT_FACET",
        "ORDER_BOOK_PLACEMENT_FACET_ADDRESS",
        "ORDERBOOK_PLACEMENT_FACET_ADDRESS",
        "FACET_PLACEMENT",
        "FACET_PLACEMENT_ADDRESS",
      ]) ||
      null;
    if (!placementFacetAddr) {
      console.log(
        "  ⚠️ Cannot repair selectors: OB_ORDER_PLACEMENT_FACET env is not set"
      );
      return;
    }
    console.log(
      "  • Using OBOrderPlacementFacet for repair:",
      placementFacetAddr
    );

    // Prepare and execute a minimal diamondCut to add missing placement selectors
    console.log(
      "  • Adding missing placement selectors via diamondCut:",
      missing.length
    );
    const cut = [
      {
        facetAddress: placementFacetAddr,
        action: 0, // Add
        functionSelectors: missing,
      },
    ];
    const overrides =
      nonceManager && typeof nonceManager.nextOverrides === "function"
        ? await nonceManager.nextOverrides()
        : await getTxOverrides();
    const tx = await diamondCut.diamondCut(
      cut,
      ethers.ZeroAddress,
      "0x",
      overrides
    );
    console.log("    - diamondCut tx:", tx.hash);
    const rc = await tx.wait();
    console.log(
      "  ✅ diamondCut applied to expose placement selectors:",
      rc?.hash || tx.hash
    );
  } catch (e) {
    console.log(
      "  ⚠️ ensurePlacementSelectors failed:",
      e?.message || String(e)
    );
  }
}

async function buildCutViaApiOrEnv() {
  const baseUrl = (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  // 1) Try API (mirrors CreateMarket form)
  try {
    logStep("build_cut_api", "start", { url: `${baseUrl}/api/orderbook/cut` });
    const res = await fetchWithTimeout(
      `${baseUrl}/api/orderbook/cut`,
      { method: "GET" },
      12000
    );
    if (res && res.ok) {
      const { cut, initFacet } = await res
        .json()
        .catch((e) => ({ cut: null, initFacet: null }));
      const cutArg = (Array.isArray(cut) ? cut : []).map((c) => [
        c.facetAddress,
        typeof c.action === "number" ? c.action : 0,
        c.functionSelectors,
      ]);
      const totalSelectors = (Array.isArray(cutArg) ? cutArg : []).reduce(
        (acc, c) => acc + (Array.isArray(c[2]) ? c[2].length : 0),
        0
      );
      logStep("build_cut_api", "success", {
        cutLength: cutArg.length,
        totalSelectors,
        hasInitFacet: Boolean(initFacet),
      });
      try {
        console.log("\n🔎 Facets (API):");
        if (initFacet) console.log("  • initFacet:", initFacet);
        cutArg.forEach((item, idx) => {
          const addr = item?.[0];
          const sels = (item?.[2] || []).length;
          console.log(`  • [${idx}] facetAddress=${addr} selectors=${sels}`);
        });
      } catch {}
      if (cutArg.length > 0 && initFacet)
        return { cutArg, initFacet, facets: { initFacet } };
    } else if (res) {
      logStep("build_cut_api", "error", {
        status: res.status,
        statusText: res.statusText,
      });
    }
  } catch (e) {
    logStep("build_cut_api", "error", { message: e?.message || String(e) });
  }

  // 2) Fallback to env + artifacts (no facet deployments!)
  logStep("build_cut_env", "start");
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
    logStep("build_cut_env", "error", { missing });
    throw new Error(
      `Missing required facet env variables: ${missing.join(", ")}`
    );
  }
  logStep("build_cut_env", "success", {
    hasInitFacet: Boolean(initFacet),
    adminFacet,
    pricingFacet,
    placementFacet,
    execFacet,
    liqFacet,
    viewFacet,
    settleFacet,
  });
  try {
    console.log("\n🔎 Facets (env):");
    if (initFacet) console.log("  • initFacet:", initFacet);
    console.log("  • adminFacet:", adminFacet);
    console.log("  • pricingFacet:", pricingFacet);
    console.log("  • placementFacet:", placementFacet);
    console.log("  • execFacet:", execFacet);
    console.log("  • liqFacet:", liqFacet);
    console.log("  • viewFacet:", viewFacet);
    console.log("  • settleFacet:", settleFacet);
  } catch {}

  // Build selectors from artifacts (same approach as API)
  logStep("build_cut_artifacts", "start");
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
  const totalSelectors = cutArg.reduce(
    (acc, c) => acc + (Array.isArray(c[2]) ? c[2].length : 0),
    0
  );
  logStep("build_cut_artifacts", "success", {
    perFacet: {
      admin: adminSelectors.length,
      pricing: pricingSelectors.length,
      placement: placementSelectors.length,
      exec: execSelectors.length,
      liq: liqSelectors.length,
      view: viewSelectors.length,
      settle: settleSelectors.length,
    },
    totalSelectors,
  });
  try {
    console.log("\n🔎 Facets (cutArg compiled from artifacts):");
    cutArg.forEach((item, idx) => {
      const addr = item?.[0];
      const sels = (item?.[2] || []).length;
      console.log(`  • [${idx}] facetAddress=${addr} selectors=${sels}`);
    });
  } catch {}

  return {
    cutArg,
    initFacet,
    facets: {
      initFacet,
      adminFacet,
      pricingFacet,
      placementFacet,
      execFacet,
      liqFacet,
      viewFacet,
      settleFacet,
    },
  };
}

function sanitizeSymbolForKey(symbol) {
  try {
    // Use uppercased symbol sans non-alphanumerics for contract key helpers
    return String(symbol)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_");
  } catch {
    return "MARKET";
  }
}

// Supabase helpers
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

async function saveMarketToSupabase(params) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.log("  ⚠️ Supabase env not configured. Skipping DB save.");
    return;
  }

  const {
    marketIdentifier,
    symbol,
    name,
    description,
    category,
    decimals,
    minimumOrderSize,
    requiresKyc = false,
    settlementDate,
    tradingEndDate = null,
    dataRequestWindowSeconds,
    autoSettle = true,
    oracleProvider = null,
    initialOrder,
    chainId,
    networkName,
    creatorWalletAddress,
    bannerImageUrl = null,
    iconImageUrl = null,
    supportingPhotoUrls = [],
    // deployment
    marketAddress,
    marketIdBytes32,
    transactionHash = null,
    blockNumber = null,
    gasUsed = null,
  } = params;

  // Find existing by market_identifier
  let effectiveMarketIdentifier = String(
    marketIdentifier || symbol || ""
  ).toUpperCase();
  if (!effectiveMarketIdentifier) {
    console.log("  ⚠️ No market identifier provided for Supabase.");
    return;
  }
  const { data: existing, error: findErr } = await supabase
    .from("markets")
    .select("id, network, market_identifier")
    .eq("market_identifier", effectiveMarketIdentifier)
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;

  let marketIdUuid = existing?.id || null;
  if (
    existing &&
    existing.network &&
    networkName &&
    existing.network !== networkName
  ) {
    const suffix = String(networkName)
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "_");
    const altIdentifier = `${effectiveMarketIdentifier}-${suffix}`;
    const { data: alt, error: altErr } = await supabase
      .from("markets")
      .select("id")
      .eq("market_identifier", altIdentifier)
      .limit(1)
      .maybeSingle();
    if (altErr) throw altErr;
    if (alt?.id) {
      effectiveMarketIdentifier = altIdentifier;
      marketIdUuid = alt.id;
      console.log(
        "  ℹ️ Using existing network-specific market:",
        effectiveMarketIdentifier
      );
    } else {
      effectiveMarketIdentifier = altIdentifier;
      marketIdUuid = null;
      console.log(
        "  ℹ️ Creating network-specific market:",
        effectiveMarketIdentifier
      );
    }
  }

  // Insert missing with all required fields we know
  if (!marketIdUuid) {
    const insertPayload = {
      market_identifier: effectiveMarketIdentifier,
      symbol,
      name: name || symbol,
      description: description || `OrderBook market for ${symbol}`,
      category:
        category ||
        (Array.isArray(initialOrder?.tags) && initialOrder.tags[0]) ||
        "CUSTOM",
      decimals: Number.isFinite(decimals)
        ? decimals
        : Number(process.env.DEFAULT_MARKET_DECIMALS || 8),
      minimum_order_size: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
      tick_size: 0.01,
      requires_kyc: Boolean(requiresKyc),
      settlement_date: settlementDate
        ? new Date(settlementDate * 1000).toISOString()
        : null,
      trading_end_date: tradingEndDate,
      data_request_window_seconds: Number(
        process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600
      ),
      auto_settle: autoSettle,
      oracle_provider: oracleProvider,
      initial_order: initialOrder || null,
      chain_id: chainId,
      network: networkName,
      creator_wallet_address: creatorWalletAddress || null,
      banner_image_url: bannerImageUrl,
      icon_image_url: iconImageUrl,
      supporting_photo_urls: supportingPhotoUrls,
      market_address: marketAddress,
      market_id_bytes32: marketIdBytes32,
      deployment_transaction_hash: transactionHash,
      deployment_block_number: blockNumber != null ? Number(blockNumber) : null,
      deployment_gas_used: gasUsed ? Number(gasUsed) : null,
      deployed_at: new Date().toISOString(),
    };
    const { data: inserted, error: insertErr } = await supabase
      .from("markets")
      .insert(insertPayload)
      .select("id")
      .single();
    if (insertErr) throw insertErr;
    marketIdUuid = inserted.id;
    console.log("  ✅ Supabase: market created (UUID)", marketIdUuid);
    // Ensure a default ticker row exists for this market
    try {
      const { error: tickerErr } = await supabase.from("market_tickers").upsert(
        [
          {
            market_id: marketIdUuid,
            mark_price: 0,
            last_update: new Date().toISOString(),
            is_stale: true,
          },
        ],
        { onConflict: "market_id" }
      );
      if (tickerErr) {
        console.log(
          "  ⚠️ Supabase: ticker upsert failed:",
          tickerErr.message || tickerErr
        );
      } else {
        console.log("  ✅ Supabase: ticker initialized for market");
      }
    } catch (e) {
      console.log("  ⚠️ Supabase: ticker upsert threw:", e?.message || e);
    }
    return;
  }

  // Update deployment info for existing row
  const updatePayload = {
    market_address: marketAddress,
    market_id_bytes32: marketIdBytes32,
    chain_id: chainId,
    network: networkName,
    deployment_transaction_hash: transactionHash,
    deployment_block_number: blockNumber != null ? Number(blockNumber) : null,
    deployment_gas_used: gasUsed ? Number(gasUsed) : null,
    deployed_at: new Date().toISOString(),
  };
  const { error: updErr } = await supabase
    .from("markets")
    .update(updatePayload)
    .eq("id", marketIdUuid);
  if (updErr) {
    console.log("  ⚠️ Supabase update failed:", updErr.message || updErr);
    return;
  }
  console.log("  ✅ Supabase: market updated with deployment details");
  // Ensure a default ticker row exists for this market
  try {
    const { error: tickerErr } = await supabase.from("market_tickers").upsert(
      [
        {
          market_id: marketIdUuid,
          mark_price: 0,
          last_update: new Date().toISOString(),
          is_stale: true,
        },
      ],
      { onConflict: "market_id" }
    );
    if (tickerErr) {
      console.log(
        "  ⚠️ Supabase: ticker upsert failed:",
        tickerErr.message || tickerErr
      );
    } else {
      console.log("  ✅ Supabase: ticker initialized for market");
    }
  } catch (e) {
    console.log("  ⚠️ Supabase: ticker upsert threw:", e?.message || e);
  }
}

async function main() {
  console.log("\n🚀 CREATE MARKET (Diamond)");
  console.log("═".repeat(80));

  const symbol = process.env.SYMBOL || getArg("--symbol") || getArg("-s");
  if (!symbol) throw new Error("--symbol is required, e.g. --symbol ALU-USD");
  const metricUrl =
    process.env.METRIC_URL ||
    getArg("--metric-url") ||
    getArg("-u") ||
    "https://example.com";
  const startPriceStr =
    process.env.START_PRICE || getArg("--start-price") || getArg("-p") || "1"; // dollars
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
  const marginBps = toBps(
    process.env.MARGIN_BPS ?? getArg("--margin-bps"),
    10000
  ); // default 100% margin
  const feeBps = toBps(process.env.FEE_BPS ?? getArg("--fee-bps"), 0); // default 0 bps
  const disableLeverage =
    (process.env.DISABLE_LEVERAGE ?? null) !== null
      ? String(process.env.DISABLE_LEVERAGE) !== "false"
      : getBool("--disable-leverage", true);
  const switchInteractive =
    (process.env.SWITCH_INTERACTIVE ?? null) !== null
      ? String(process.env.SWITCH_INTERACTIVE) !== "false"
      : getBool("--switch-interactive", true); // update ORDERBOOK pointer
  const skipApiGrant =
    (process.env.SKIP_API_GRANT ?? null) !== null
      ? String(process.env.SKIP_API_GRANT) !== "false"
      : getBool("--skip-api-grant", false);

  const startPrice6 = ethers.parseUnits(String(startPriceStr), 6);

  const network = await ethers.provider.getNetwork();
  const rawNetworkName = process.env.HARDHAT_NETWORK || "unknown";
  // Normalize common aliases and fall back to chainId mapping
  const normalizedName = (() => {
    const n = String(rawNetworkName || "").toLowerCase();
    if (
      n === "hyperliquid_mainnet" ||
      n === "hyperliquid-mainnet" ||
      n === "hl" ||
      n === "hl_mainnet" ||
      n === "hl-mainnet"
    )
      return "hyperliquid";
    if (n === "hyperliquid-testnet" || n === "hl_testnet" || n === "hl-testnet")
      return "hyperliquid_testnet";
    return n;
  })();
  let effectiveNetworkName = normalizedName;
  if (
    (effectiveNetworkName === "hardhat" ||
      effectiveNetworkName === "unknown") &&
    Number(network.chainId) === 31337
  ) {
    effectiveNetworkName = "localhost";
  } else if (Number(network.chainId) === 999) {
    effectiveNetworkName = "hyperliquid";
  } else if (Number(network.chainId) === 998) {
    effectiveNetworkName = "hyperliquid_testnet";
  }
  console.log(
    `🌐 Network: ${effectiveNetworkName} (Chain ID: ${network.chainId})`
  );
  console.log(`🪙 Symbol: ${symbol}`);
  console.log(`🔗 Metric URL: ${metricUrl}`);
  console.log(`💵 Start Price: $${startPriceStr}`);
  console.log(`🧮 Params: margin=${marginBps}bps, fee=${feeBps}bps`);
  if (tags.length) console.log(`🏷️ Tags: ${tags.join(", ")}`);
  logStep("network", "success", {
    rawNetworkName,
    normalizedName,
    effectiveNetworkName,
    chainId: Number(network.chainId),
    symbol,
    startPriceStr,
  });

  // Enable HyperEVM big blocks for this user when on Hyperliquid networks
  let bigBlocksEnabled = false;
  if (
    effectiveNetworkName === "hyperliquid" ||
    effectiveNetworkName === "hyperliquid_testnet"
  ) {
    try {
      console.log("\n⚙️  Enabling HyperCore big blocks for user...");
      await submitHyperCoreAction({
        type: "evmUserModify",
        usingBigBlocks: true,
      });
      USING_BIG_BLOCKS = true;
      bigBlocksEnabled = true;
      console.log("  ✅ usingBigBlocks enabled");
    } catch (e) {
      console.log("  ⚠️ Could not enable big blocks:", e?.message || e);
    }
  }

  // Resolve deployment path for the active network (map hardhat→localhost, chain→hyperliquid[_testnet])
  const deploymentPath = path.join(
    __dirname,
    `../deployments/${effectiveNetworkName}-deployment.json`
  );
  console.log(
    "📁 Deployment file:",
    path.relative(process.cwd(), deploymentPath)
  );
  logStep("deployment_file", "start", { deploymentPath });

  let deployer = (await ethers.getSigners())[0];
  if (!deployer) {
    const fallbackPk =
      "0xe5b1ad83fbb29db6b094e70507476573ca17d5ba1bbbe81fd00363d7ffbe35bb";
    if (!fallbackPk) {
      throw new Error(
        "No signer available. Set PRIVATE_KEY or PRIVATE_KEY_DEPLOYER in env."
      );
    }
    deployer = new ethers.Wallet(fallbackPk, ethers.provider);
  }
  console.log("👤 Deployer:", deployer.address);
  logStep("resolve_signer", "success", { address: deployer.address });

  // Ensure sequential txs with explicit nonce and fee overrides
  const nonceMgr = await createNonceManager(deployer);

  // Treasury defaults to deployer unless overridden
  const treasury =
    process.env.TREASURY || getArg("--treasury") || deployer.address;
  console.log("🏦 Treasury:", treasury);

  // Resolve core contracts (prefer .env, then deployments, then config)
  let coreVault, factory;
  try {
    const envCoreVault =
      process.env.CORE_VAULT_ADDRESS || process.env.CORE_VAULT;
    const envFactory =
      process.env.FUTURES_MARKET_FACTORY_ADDRESS ||
      process.env.FUTURES_MARKET_FACTORY;

    let deploymentData = {};
    if (fs.existsSync(deploymentPath)) {
      deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    }

    const coreVaultAddr = envCoreVault || deploymentData?.contracts?.CORE_VAULT;
    const factoryAddr =
      envFactory || deploymentData?.contracts?.FUTURES_MARKET_FACTORY;

    if (coreVaultAddr && factoryAddr) {
      coreVault = await ethers.getContractAt(
        "CoreVault",
        coreVaultAddr,
        deployer
      );
      factory = await ethers.getContractAt(
        "FuturesMarketFactory",
        factoryAddr,
        deployer
      );
      console.log(
        envCoreVault
          ? "🔗 Using CoreVault from env:"
          : "🔗 Using CoreVault from deployments:",
        coreVaultAddr
      );
      console.log(
        envFactory
          ? "🔗 Using FuturesMarketFactory from env:"
          : "🔗 Using FuturesMarketFactory from deployments:",
        factoryAddr
      );
      logStep("resolve_core_contracts", "success", {
        source: envCoreVault ? "env" : "deployments",
        coreVault: coreVaultAddr,
        factory: factoryAddr,
      });
    } else {
      const { getContract } = require("../config/contracts");
      coreVault = (await getContract("CORE_VAULT")).connect(deployer);
      factory = (await getContract("FUTURES_MARKET_FACTORY")).connect(deployer);
      console.log(
        "🔗 Using CoreVault from config:",
        await coreVault.getAddress()
      );
      console.log(
        "🔗 Using FuturesMarketFactory from config:",
        await factory.getAddress()
      );
      logStep("resolve_core_contracts", "success", {
        source: "config",
        coreVault: await coreVault.getAddress(),
        factory: await factory.getAddress(),
      });
    }
  } catch (_) {
    const { getContract } = require("../config/contracts");
    coreVault = (await getContract("CORE_VAULT")).connect(deployer);
    factory = (await getContract("FUTURES_MARKET_FACTORY")).connect(deployer);
    console.log(
      "🔗 Using CoreVault from config:",
      await coreVault.getAddress()
    );
    console.log(
      "🔗 Using FuturesMarketFactory from config:",
      await factory.getAddress()
    );
    logStep("resolve_core_contracts", "success", {
      source: "config_catch",
      coreVault: await coreVault.getAddress(),
      factory: await factory.getAddress(),
    });
  }

  // Build facet cut for Hyperliquid using pre-deployed facet addresses from env/API
  let cutArg, initFacetAddr;
  if (effectiveNetworkName === "hyperliquid") {
    console.log(
      "\n🔧 Resolving OrderBook facets from env/API (Hyperliquid mainnet)..."
    );
    logStep("resolve_facets", "start", { mode: "hyperliquid_env_or_api" });
    try {
      const built = await buildCutViaApiOrEnv();
      cutArg = built.cutArg;
      initFacetAddr = built.initFacet;
      logStep("resolve_facets", "success", {
        cutLength: Array.isArray(cutArg) ? cutArg.length : 0,
        hasInitFacet: Boolean(initFacetAddr),
      });
      try {
        console.log("\n🔎 Facets (resolved):");
        if (built?.facets?.initFacet)
          console.log("  • initFacet:", built.facets.initFacet);
        if (Array.isArray(cutArg)) {
          cutArg.forEach((item, idx) => {
            const addr = item?.[0];
            const sels = (item?.[2] || []).length;
            console.log(`  • [${idx}] facetAddress=${addr} selectors=${sels}`);
          });
        }
      } catch {}
    } catch (e) {
      console.log(
        "  ❌ Could not build facet cut from env/API:",
        e?.message || e
      );
      logStep("resolve_facets", "error", { message: e?.message || String(e) });
      throw e;
    }
    console.log(
      "📦 Total selectors:",
      (Array.isArray(cutArg) ? cutArg : []).reduce(
        (acc, c) => acc + (Array.isArray(c[2]) ? c[2].length : 0),
        0
      )
    );
  } else {
    // Fallback: legacy local facet deployments for non-Hyperliquid networks
    console.log("\n🔧 Deploying OrderBook facets (non-Hyperliquid network)...");
    const OrderBookInitFacet = await ethers.getContractFactory(
      "OrderBookInitFacet"
    );
    const OBAdminFacet = await ethers.getContractFactory("OBAdminFacet");
    const OBPricingFacet = await ethers.getContractFactory("OBPricingFacet");
    const OBOrderPlacementFacet = await ethers.getContractFactory(
      "OBOrderPlacementFacet"
    );
    const OBTradeExecutionFacet = await ethers.getContractFactory(
      "OBTradeExecutionFacet"
    );
    const OBLiquidationFacet = await ethers.getContractFactory(
      "OBLiquidationFacet"
    );
    const OBViewFacet = await ethers.getContractFactory("OBViewFacet");
    const OBSettlementFacet = await ethers.getContractFactory(
      "OBSettlementFacet"
    );

    const initFacet = await OrderBookInitFacet.deploy();
    await initFacet.waitForDeployment();
    const adminFacet = await OBAdminFacet.deploy();
    await adminFacet.waitForDeployment();
    const pricingFacet = await OBPricingFacet.deploy();
    await pricingFacet.waitForDeployment();
    const placementFacet = await OBOrderPlacementFacet.deploy();
    await placementFacet.waitForDeployment();
    const execFacet = await OBTradeExecutionFacet.deploy();
    await execFacet.waitForDeployment();
    const liqFacet = await OBLiquidationFacet.deploy();
    await liqFacet.waitForDeployment();
    const viewFacet = await OBViewFacet.deploy();
    await viewFacet.waitForDeployment();
    const settlementFacet = await OBSettlementFacet.deploy();
    await settlementFacet.waitForDeployment();

    function selectors(iface) {
      return iface.fragments
        .filter((f) => f.type === "function")
        .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
    }
    const adminSelectors = selectors(adminFacet.interface);
    const pricingSelectors = selectors(pricingFacet.interface);
    const placementSelectors = selectors(placementFacet.interface);
    const execSelectors = selectors(execFacet.interface);
    const liqSelectors = selectors(liqFacet.interface);
    const viewSelectors = selectors(viewFacet.interface);
    const settleSelectors = selectors(settlementFacet.interface);

    const initFacetAddrLocal = await initFacet.getAddress();
    const adminAddrLocal = await adminFacet.getAddress();
    const pricingAddrLocal = await pricingFacet.getAddress();
    const placementAddrLocal = await placementFacet.getAddress();
    const execAddrLocal = await execFacet.getAddress();
    const liqAddrLocal = await liqFacet.getAddress();
    const viewAddrLocal = await viewFacet.getAddress();
    const settleAddrLocal = await settlementFacet.getAddress();

    try {
      console.log("\n🔎 Facets (deployed locally):");
      console.log("  • initFacet:", initFacetAddrLocal);
      console.log("  • adminFacet:", adminAddrLocal);
      console.log("  • pricingFacet:", pricingAddrLocal);
      console.log("  • placementFacet:", placementAddrLocal);
      console.log("  • execFacet:", execAddrLocal);
      console.log("  • liqFacet:", liqAddrLocal);
      console.log("  • viewFacet:", viewAddrLocal);
      console.log("  • settleFacet:", settleAddrLocal);
    } catch {}

    cutArg = [
      [adminAddrLocal, 0, adminSelectors],
      [pricingAddrLocal, 0, pricingSelectors],
      [placementAddrLocal, 0, placementSelectors],
      [execAddrLocal, 0, execSelectors],
      [liqAddrLocal, 0, liqSelectors],
      [viewAddrLocal, 0, viewSelectors],
      [settleAddrLocal, 0, settleSelectors],
    ];
    initFacetAddr = initFacetAddrLocal;
  }

  console.log("\n🏭 Creating market via FuturesMarketFactory...");
  const settlementTs = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  console.log("  • Args:");
  console.log("    - symbol:", symbol);
  console.log("    - metricUrl:", metricUrl);
  console.log("    - settlementDate:", settlementTs);
  console.log("    - startPrice6:", startPrice6.toString());
  console.log("    - dataSource:", dataSource);
  console.log("    - tags:", JSON.stringify(tags));
  console.log("    - treasury:", deployer.address);
  if (effectiveNetworkName === "hyperliquid") {
    console.log("    - initFacet:", initFacetAddr);
  }

  // Preflight diagnostics
  try {
    logStep("estimate_gas", "start");
    const estimateFn = factory.getFunction("createFuturesMarketDiamond");
    const gas = await estimateFn.estimateGas(
      symbol,
      metricUrl,
      settlementTs,
      startPrice6,
      dataSource,
      tags,
      deployer.address,
      cutArg,
      effectiveNetworkName === "hyperliquid"
        ? initFacetAddr
        : await (async () => initFacetAddr)(),
      "0x"
    );
    console.log("  • Estimated gas:", gas.toString());
    logStep("estimate_gas", "success", { gas: gas.toString() });
  } catch (e) {
    console.log("  ⚠️ Gas estimation failed:", extractError(e));
    logStep("estimate_gas", "error", { error: extractError(e) });
  }
  try {
    logStep("static_call", "start");
    const staticRes = await factory
      .getFunction("createFuturesMarketDiamond")
      .staticCall(
        symbol,
        metricUrl,
        settlementTs,
        startPrice6,
        dataSource,
        tags,
        deployer.address,
        cutArg,
        effectiveNetworkName === "hyperliquid"
          ? initFacetAddr
          : await (async () => initFacetAddr)(),
        "0x"
      );
    console.log("  • Static call OK. Expected return: ", staticRes);
    logStep("static_call", "success");
  } catch (e) {
    console.log("  ⚠️ Static call reverted:", extractError(e));
    logStep("static_call", "error", { error: extractError(e) });
  }

  let receipt;
  try {
    const createTx = await factory.createFuturesMarketDiamond(
      symbol,
      metricUrl,
      settlementTs,
      startPrice6,
      dataSource,
      tags,
      deployer.address,
      cutArg,
      effectiveNetworkName === "hyperliquid"
        ? initFacetAddr
        : await (async () => initFacetAddr)(),
      "0x",
      await nonceMgr.nextOverrides()
    );
    console.log("  • Tx sent:", createTx.hash);
    receipt = await createTx.wait();
    console.log("  ✅ Market created");
    logStep("tx", "success", {
      tx: createTx.hash,
      blockNumber: receipt?.blockNumber,
    });
  } catch (e) {
    console.log("  ❌ createFuturesMarketDiamond failed:", extractError(e));
    logStep("tx", "error", { error: extractError(e) });
    throw e;
  }

  let orderBook, marketId;
  // Parse event FuturesMarketCreated(orderBook, marketId, ...)
  logStep("parse_event", "start", {
    logCount: Array.isArray(receipt?.logs) ? receipt.logs.length : 0,
  });
  for (const log of receipt.logs) {
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
  logStep("parse_event", "success", { orderBook, marketId });

  // Configure OB and grant roles
  console.log("\n🔒 Configuring roles and trading params...");
  const obAdmin = await ethers.getContractAt(
    "OBAdminFacet",
    orderBook,
    deployer
  );
  try {
    console.log(
      `  • updateTradingParameters(marginBps=${marginBps}, feeBps=${feeBps}, treasury=${treasury})`
    );
    const tx1 = await obAdmin.updateTradingParameters(
      marginBps,
      feeBps,
      treasury,
      await nonceMgr.nextOverrides()
    );
    console.log("  • updateTradingParameters tx:", tx1.hash);
    const r1 = await tx1.wait();
    console.log("  ✅ Trading params updated:", r1?.hash || tx1.hash);
  } catch (e) {
    console.log("  ⚠️ Could not set trading params:", e?.message || e);
  }
  if (disableLeverage) {
    try {
      console.log("  • Disabling leverage...");
      const tx2 = await obAdmin.disableLeverage(await nonceMgr.nextOverrides());
      console.log("  • disableLeverage tx:", tx2.hash);
      const r2 = await tx2.wait();
      console.log("  ✅ Leverage disabled:", r2?.hash || tx2.hash);
    } catch (e) {
      console.log("  ⚠️ Could not disable leverage (maybe already disabled)");
    }
  }

  if (effectiveNetworkName === "hyperliquid") {
    // Prefer server-side role grant via API unless explicitly skipped
    if (skipApiGrant) {
      console.log(
        "  • Skipping API role grant (flag set); granting directly..."
      );
      const ORDERBOOK_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("ORDERBOOK_ROLE")
      );
      const SETTLEMENT_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("SETTLEMENT_ROLE")
      );
      const txA = await coreVault.grantRole(
        ORDERBOOK_ROLE,
        orderBook,
        await nonceMgr.nextOverrides()
      );
      console.log("  • grantRole(ORDERBOOK_ROLE) tx:", txA.hash);
      const rcA = await txA.wait();
      console.log("  ✅ ORDERBOOK_ROLE granted:", rcA?.hash || txA.hash);
      const txB = await coreVault.grantRole(
        SETTLEMENT_ROLE,
        orderBook,
        await nonceMgr.nextOverrides()
      );
      console.log("  • grantRole(SETTLEMENT_ROLE) tx:", txB.hash);
      const rcB = await txB.wait();
      console.log("  ✅ SETTLEMENT_ROLE granted:", rcB?.hash || txB.hash);
      console.log("  ✅ Roles granted on CoreVault (direct)");
      logStep("grant_roles_direct", "success");
    } else {
      const baseUrl = (
        process.env.APP_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000"
      ).replace(/\/$/, "");
      try {
        console.log("  • Granting roles via API...");
        logStep("grant_roles_api", "start", {
          url: `${baseUrl}/api/markets/grant-roles`,
        });
        const resp = await fetchWithTimeout(
          `${baseUrl}/api/markets/grant-roles`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderBook,
              coreVault: await coreVault.getAddress(),
            }),
          },
          12000
        );
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err?.error || `HTTP ${resp.status}`);
        }
        console.log("  ✅ Roles granted via API");
        logStep("grant_roles_api", "success");
      } catch (e) {
        console.log(
          "  ⚠️ API role grant failed, falling back to direct grant:",
          e?.message || e
        );
        const ORDERBOOK_ROLE = ethers.keccak256(
          ethers.toUtf8Bytes("ORDERBOOK_ROLE")
        );
        const SETTLEMENT_ROLE = ethers.keccak256(
          ethers.toUtf8Bytes("SETTLEMENT_ROLE")
        );
        const txA = await coreVault.grantRole(
          ORDERBOOK_ROLE,
          orderBook,
          await nonceMgr.nextOverrides()
        );
        console.log("  • grantRole(ORDERBOOK_ROLE) tx:", txA.hash);
        const rcA = await txA.wait();
        console.log("  ✅ ORDERBOOK_ROLE granted:", rcA?.hash || txA.hash);
        const txB = await coreVault.grantRole(
          SETTLEMENT_ROLE,
          orderBook,
          await nonceMgr.nextOverrides()
        );
        console.log("  • grantRole(SETTLEMENT_ROLE) tx:", txB.hash);
        const rcB = await txB.wait();
        console.log("  ✅ SETTLEMENT_ROLE granted:", rcB?.hash || txB.hash);
        console.log("  ✅ Roles granted on CoreVault (fallback)");
        logStep("grant_roles_fallback", "success");
      }
    }
  } else {
    const ORDERBOOK_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("ORDERBOOK_ROLE")
    );
    const SETTLEMENT_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("SETTLEMENT_ROLE")
    );
    console.log("  • Granting ORDERBOOK_ROLE to:", orderBook);
    const tx1 = await coreVault.grantRole(
      ORDERBOOK_ROLE,
      orderBook,
      await nonceMgr.nextOverrides()
    );
    console.log("    - tx:", tx1.hash);
    const r1 = await tx1.wait();
    console.log("    - mined:", r1?.hash || tx1.hash);
    console.log("  • Granting SETTLEMENT_ROLE to:", orderBook);
    const tx2 = await coreVault.grantRole(
      SETTLEMENT_ROLE,
      orderBook,
      await nonceMgr.nextOverrides()
    );
    console.log("    - tx:", tx2.hash);
    const r2 = await tx2.wait();
    console.log("    - mined:", r2?.hash || tx2.hash);
    console.log("  ✅ Roles granted on CoreVault");
    logStep("grant_roles", "success");
  }

  // Post-deploy verification: ensure required placement selectors exist on the Diamond
  try {
    console.log("\n🔍 Verifying Diamond placement selectors...");
    // Prefer explicit placement facet address for repair: env first; otherwise infer from cutArg
    let placementFacetOverride =
      readEnvAny([
        "OB_ORDER_PLACEMENT_FACET",
        "OB_ORDER_PLACEMENT_FACET_ADDRESS",
        "ORDER_BOOK_PLACEMENT_FACET",
        "ORDERBOOK_PLACEMENT_FACET",
        "ORDER_BOOK_PLACEMENT_FACET_ADDRESS",
        "ORDERBOOK_PLACEMENT_FACET_ADDRESS",
        "FACET_PLACEMENT",
        "FACET_PLACEMENT_ADDRESS",
      ]) || null;
    if (!placementFacetOverride && Array.isArray(cutArg)) {
      try {
        const targetSel = ethers
          .id("placeLimitOrder(uint256,uint256,bool)")
          .slice(0, 10);
        const match = cutArg.find(
          (c) => Array.isArray(c?.[2]) && c[2].includes(targetSel)
        );
        if (match && ethers.isAddress(match[0]))
          placementFacetOverride = match[0];
      } catch {}
    }
    await ensurePlacementSelectors(
      orderBook,
      nonceMgr,
      placementFacetOverride || undefined
    );

    // Additional probe: verify selector via loupe and staticCall
    try {
      const LoupeABI = ["function facetAddress(bytes4) view returns (address)"];
      const loupe = new ethers.Contract(orderBook, LoupeABI, wallet);
      const sel = ethers
        .id("placeMarginMarketOrderWithSlippage(uint256,bool,uint256)")
        .slice(0, 10);
      const facetAddr = await loupe.facetAddress(sel);
      console.log(
        "  • facetAddress(placeMarginMarketOrderWithSlippage):",
        facetAddr
      );
    } catch {}
    try {
      const obPlacement = new ethers.Contract(
        orderBook,
        OBOrderPlacementFacetABI,
        wallet
      );
      // Expect business-logic revert (e.g., no liquidity) if function exists
      await obPlacement
        .getFunction("placeMarginMarketOrderWithSlippage")
        .staticCall(1n, true, 100);
    } catch (probeErr) {
      const reason = extractError(probeErr);
      if (String(reason).includes("Diamond: Function does not exist")) {
        console.log(
          "  ❌ Selector probe indicates missing function after repair, retrying ensurePlacementSelectors..."
        );
        await ensurePlacementSelectors(
          orderBook,
          nonceMgr,
          placementFacetOverride || undefined
        );
      } else {
        console.log(
          "  ✅ Selector probe indicates function is present (revert is expected if no liquidity)"
        );
      }
    }
  } catch (_) {}

  // Save to DB via API (mirrors CreateMarket form); fallback to direct Supabase service
  try {
    const initialOrder = {
      metricUrl,
      startPrice: String(ethers.formatUnits(startPrice6, 6)),
      dataSource,
      tags,
    };
    if (effectiveNetworkName === "hyperliquid") {
      const baseUrl = (
        process.env.APP_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000"
      ).replace(/\/$/, "");
      console.log("\n🗄️  Saving market via API...");
      logStep("save_market_api", "start", {
        url: `${baseUrl}/api/markets/save`,
      });
      const resp = await fetchWithTimeout(
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
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${resp.status}`);
      }
      console.log("  ✅ Market saved via API");
      logStep("save_market_api", "success");
    } else {
      console.log("\n🗄️  Saving market to Supabase (service role)...");
      await saveMarketToSupabase({
        marketIdentifier: symbol,
        symbol,
        name: `${(symbol.split("-")[0] || symbol).toUpperCase()} Futures`,
        description: `OrderBook market for ${symbol}`,
        category: Array.isArray(tags) && tags.length ? tags[0] : "CUSTOM",
        decimals: Number(process.env.DEFAULT_MARKET_DECIMALS || 8),
        minimumOrderSize: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
        requiresKyc: false,
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
      });
      console.log("  ✅ Market saved via Supabase service role");
      logStep("save_market_supabase", "success");
    }
  } catch (e) {
    console.log("  ⚠️ Save failed:", e?.message || e);
    logStep("save_market", "error", { error: e?.message || String(e) });
  }

  // Persist to deployments JSON
  console.log("\n📝 Updating deployment file...");
  // deploymentPath already set based on effectiveNetworkName
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
  // Add convenience contract keys
  deployment.contracts[`${keyBase}_ORDERBOOK`] = orderBook;
  deployment.contracts[`${keyBase}_MARKET_ID`] = marketId;

  // Maintain backward-compatible ALUMINUM keys for ALU-USD
  if (symbol.toUpperCase() === "ALU-USD") {
    deployment.contracts["ALUMINUM_ORDERBOOK"] = orderBook;
    deployment.contracts["ALUMINUM_MARKET_ID"] = marketId;
  }

  // Append to markets[] and also keep aluminumMarket for backward compat
  deployment.markets = Array.isArray(deployment.markets)
    ? deployment.markets
    : [];
  // If this is the first time adding to markets[], migrate legacy aluminumMarket into markets[]
  if (
    deployment.aluminumMarket &&
    !deployment.markets.find(
      (m) => m && m.symbol === (deployment.aluminumMarket.symbol || "ALU-USD")
    )
  ) {
    deployment.markets.push({
      symbol: deployment.aluminumMarket.symbol || "ALU-USD",
      marketId: deployment.aluminumMarket.marketId,
      orderBook: deployment.aluminumMarket.orderBook,
      metricUrl: deployment.metricUrl || "",
      settlementDate: deployment.settlementDate || 0,
      startPrice: deployment.startPrice || "0",
      dataSource: "Legacy",
      tags: [],
    });
  }
  const marketEntry = {
    symbol,
    marketId,
    orderBook,
    metricUrl,
    settlementDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    startPrice: startPrice6.toString(),
    dataSource,
    tags,
  };
  // Upsert by symbol
  const existingIdx = deployment.markets.findIndex((m) => m.symbol === symbol);
  if (existingIdx >= 0) deployment.markets[existingIdx] = marketEntry;
  else deployment.markets.push(marketEntry);

  if (symbol.toUpperCase() === "ALU-USD") {
    deployment.aluminumMarket = { symbol, marketId, orderBook };
  }

  // If requested, make this new market the default for interactive tools
  if (switchInteractive) {
    deployment.defaultMarket = { symbol, marketId, orderBook };
    // Also expose generic pointers for convenience
    deployment.contracts.ORDERBOOK = orderBook;
    deployment.contracts.MARKET_ID = marketId;
  }

  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(
    "  ✅ Deployment updated:",
    path.relative(process.cwd(), deploymentPath)
  );
  logStep("deployment_file", "success", {
    updated: true,
    marketsCount: Array.isArray(deployment.markets)
      ? deployment.markets.length
      : 0,
  });

  // Optionally point generic ORDERBOOK in contracts.js to this new market for interactive trader
  if (switchInteractive) {
    try {
      const configPath = path.join(__dirname, "../config/contracts.js");
      let content = fs.readFileSync(configPath, "utf8");
      // Update ORDERBOOK generic pointer
      if (/ORDERBOOK:\s*"0x[a-fA-F0-9]+"/.test(content)) {
        content = content.replace(
          /ORDERBOOK:\s*"0x[a-fA-F0-9]+"/g,
          `ORDERBOOK: "${orderBook}"`
        );
      } else {
        // Add ORDERBOOK if missing under addresses block
        content = content.replace(
          /CONTRACT_ADDRESSES\s*=\s*\{([\s\S]*?)\n\s*\};/m,
          (m, inner) =>
            `CONTRACT_ADDRESSES = {${inner}\n  ORDERBOOK: "${orderBook}",\n};`
        );
      }
      fs.writeFileSync(configPath, content);
      console.log("  ✅ Updated config/contracts.js ORDERBOOK →", orderBook);
    } catch (e) {
      console.log(
        "  ⚠️ Could not update config/contracts.js ORDERBOOK:",
        e?.message || e
      );
    }
  }

  // Disable big blocks after all writes finish
  if (bigBlocksEnabled) {
    try {
      console.log("\n🔄 Disabling HyperCore big blocks for user...");
      await submitHyperCoreAction({
        type: "evmUserModify",
        usingBigBlocks: false,
      });
      USING_BIG_BLOCKS = false;
      console.log("  ✅ usingBigBlocks disabled");
    } catch (e) {
      console.log("  ⚠️ Could not disable big blocks:", e?.message || e);
    }
  }

  console.log("\n✅ Market ready!");
  console.log("═".repeat(80));
  console.log(`🎯 ${symbol} → ${orderBook}`);
  console.log(
    `💡 To trade: npx hardhat run scripts/interactive-trader.js --network ${effectiveNetworkName}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
