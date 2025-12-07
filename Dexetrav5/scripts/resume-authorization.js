#!/usr/bin/env node

// resume-authorization.js - Resume deployment starting at authorization stage
//
// Use this when the previous run failed around granting roles (e.g.,
// "🔒 Setting up authorization... → Granting FACTORY_ROLE ...").
// This script:
//   1) Attaches to existing CoreVault and FuturesMarketFactory
//   2) Grants FACTORY_ROLE and SETTLEMENT_ROLE to the factory
//   3) Sets global MMR params
//   4) Ensures OrderBook facets (deploys if not provided)
//   5) Creates the market (Diamond), configures trading params
//   6) Grants OB roles on CoreVault, sets initial mark price
//   7) Optionally saves to Supabase, funds accounts, updates configs/deployments
//
// Example (mainnet):
//   npx hardhat --config Dexetrav5/hardhat.config.js \
//     run Dexetrav5/scripts/resume-authorization.js --network hyperliquid \
//     --symbol ALU-USD --metric-url https://www.lme.com/en/metals/non-ferrous/lme-aluminium/
//
// You can pass core addresses via env or CLI:
//   CORE_VAULT_ADDRESS=0x... FUTURES_MARKET_FACTORY_ADDRESS=0x...
// or
//   --vault 0x... --factory 0x...
//
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

const { createClient } = require("@supabase/supabase-js");

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (
    idx !== -1 &&
    process.argv[idx + 1] &&
    !String(process.argv[idx + 1]).startsWith("--")
  ) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function getBool(flag, fallback = false) {
  return process.argv.includes(flag) ? true : fallback;
}

function getBoolEnv(key, fallback = false) {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const v = String(raw).toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function readEnvAny(names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

async function getTxOverrides() {
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
    const bumped = (base * 12n) / 10n; // +20%
    const minLegacy = ethers.parseUnits("20", "gwei");
    return { gasPrice: bumped > minLegacy ? bumped : minLegacy };
  } catch (_) {
    return { gasPrice: ethers.parseUnits("20", "gwei") };
  }
}

function getRevertData(error) {
  try {
    if (error?.data && typeof error.data === "string") return error.data;
    if (error?.error?.data && typeof error.error.data === "string")
      return error.error.data;
    if (error?.info?.error?.data && typeof error.info.error.data === "string")
      return error.info.error.data;
    const msg = String(error?.message || "");
    if (msg.startsWith("0x") && msg.length > 10) return msg.trim();
  } catch (_) {}
  return undefined;
}

async function decodeAndLog(error) {
  const data = getRevertData(error);
  if (!data) {
    console.log("  ↪ No revert data available to decode.");
    return;
  }
  const candidates = [
    "CoreVault",
    "FuturesMarketFactory",
    "OBAdminFacet",
    "OBPricingFacet",
    "OBOrderPlacementFacet",
    "OBTradeExecutionFacet",
    "OBLiquidationFacet",
    "OBViewFacet",
    "OBSettlementFacet",
    "OrderBook",
  ];
  for (const name of candidates) {
    try {
      const f = await ethers.getContractFactory(name);
      const parsed = f.interface.parseError(data);
      if (parsed) {
        console.log(
          `  ↪ Decoded revert by ${name}: ${parsed.name}(${
            parsed.signature
          }) args=${JSON.stringify(parsed.args)}`
        );
        return;
      }
    } catch (_) {}
  }
  console.log(`  ↪ Could not decode revert; data=${data}`);
}

// Nonce management to avoid accidental same-nonce replacements
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

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function saveMarketToSupabase(params) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.log("  ⚠️  Supabase env not configured. Skipping DB save.");
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
    // deployment info
    marketAddress,
    factoryAddress,
    centralVaultAddress,
    orderRouterAddress = null,
    positionManagerAddress,
    liquidationManagerAddress,
    vaultAnalyticsAddress,
    usdcTokenAddress,
    umaOracleManagerAddress = null,
    marketIdBytes32,
    transactionHash = null,
    blockNumber = null,
    gasUsed = null,
  } = params;

  let effectiveMarketIdentifier = marketIdentifier;
  const { data: existing, error: findErr } = await supabase
    .from("markets")
    .select("id, network, market_identifier")
    .eq("market_identifier", marketIdentifier)
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
    const altIdentifier = `${marketIdentifier}-${suffix}`;
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
        "  ℹ️  Using existing network-specific market:",
        effectiveMarketIdentifier
      );
    } else {
      effectiveMarketIdentifier = altIdentifier;
      marketIdUuid = null;
      console.log(
        "  ℹ️  Creating network-specific market:",
        effectiveMarketIdentifier
      );
    }
  }

  if (!marketIdUuid) {
    const { data: createdId, error: createErr } = await supabase.rpc(
      "create_market",
      {
        p_market_identifier: effectiveMarketIdentifier,
        p_symbol: symbol,
        p_name: name,
        p_description: description,
        p_category: category,
        p_decimals: decimals,
        p_minimum_order_size: minimumOrderSize,
        p_requires_kyc: requiresKyc,
        p_settlement_date: new Date(settlementDate * 1000).toISOString(),
        p_trading_end_date: tradingEndDate,
        p_data_request_window_seconds: dataRequestWindowSeconds,
        p_auto_settle: autoSettle,
        p_oracle_provider: oracleProvider,
        p_initial_order: initialOrder,
        p_chain_id: chainId,
        p_network: networkName,
        p_creator_wallet_address: creatorWalletAddress,
        p_banner_image_url: bannerImageUrl,
        p_icon_image_url: iconImageUrl,
        p_supporting_photo_urls: supportingPhotoUrls,
      }
    );
    if (createErr) {
      console.log(
        "  ℹ️  RPC create failed, falling back to direct insert:",
        createErr?.message || createErr
      );
      const insertPayload = {
        market_identifier: effectiveMarketIdentifier,
        symbol,
        name,
        description,
        category,
        decimals,
        minimum_order_size: minimumOrderSize,
        tick_size: 0.01,
        requires_kyc: requiresKyc,
        settlement_date: new Date(settlementDate * 1000).toISOString(),
        trading_end_date: tradingEndDate,
        data_request_window_seconds: dataRequestWindowSeconds,
        auto_settle: autoSettle,
        oracle_provider: oracleProvider,
        initial_order: initialOrder,
        chain_id: chainId,
        network: networkName,
        creator_wallet_address: creatorWalletAddress,
        banner_image_url: bannerImageUrl,
        icon_image_url: iconImageUrl,
        supporting_photo_urls: supportingPhotoUrls,
      };
      const { data: inserted, error: insertErr } = await supabase
        .from("markets")
        .insert(insertPayload)
        .select("id")
        .single();
      if (insertErr) throw insertErr;
      marketIdUuid = inserted.id;
      console.log(
        "  ✅ Supabase: market created (direct insert UUID)",
        marketIdUuid
      );
    } else {
      marketIdUuid = createdId;
      console.log("  ✅ Supabase: market created (UUID)", marketIdUuid);
    }
  } else {
    console.log(
      "  ℹ️  Supabase: market exists (UUID)",
      marketIdUuid,
      "(identifier:",
      effectiveMarketIdentifier + ")"
    );
  }

  const rawUseRpc = process.env.SUPABASE_USE_RPC_UPDATE;
  let useRpc;
  if (rawUseRpc === undefined) {
    useRpc = (params.networkName || "").toLowerCase() !== "localhost";
  } else {
    const v = String(rawUseRpc).toLowerCase();
    useRpc = v === "true" || v === "1" || v === "yes" || v === "on";
  }

  if (useRpc) {
    const { error: updateErr } = await supabase.rpc(
      "update_market_deployment",
      {
        p_market_id: marketIdUuid,
        p_market_address: marketAddress,
        p_factory_address: factoryAddress,
        p_central_vault_address: centralVaultAddress,
        p_order_router_address: orderRouterAddress,
        p_position_manager_address: positionManagerAddress,
        p_liquidation_manager_address: liquidationManagerAddress,
        p_vault_analytics_address: vaultAnalyticsAddress,
        p_usdc_token_address: usdcTokenAddress,
        p_uma_oracle_manager_address: umaOracleManagerAddress,
        p_market_id_bytes32: marketIdBytes32,
        p_transaction_hash: transactionHash,
        p_block_number: blockNumber,
        p_gas_used: gasUsed ? Number(gasUsed) : null,
      }
    );
    if (!updateErr) {
      console.log("  ✅ Supabase: deployment info updated (RPC)");
      return;
    }
    console.log(
      "  ℹ️  RPC update failed, falling back to direct markets update:",
      updateErr?.message || updateErr
    );
  }

  const directUpdate = {
    market_address: marketAddress,
    factory_address: factoryAddress,
    central_vault_address: centralVaultAddress,
    order_router_address: orderRouterAddress,
    position_manager_address: positionManagerAddress,
    liquidation_manager_address: liquidationManagerAddress,
    vault_analytics_address: vaultAnalyticsAddress,
    usdc_token_address: usdcTokenAddress,
    uma_oracle_manager_address: umaOracleManagerAddress,
    market_id_bytes32: marketIdBytes32,
    deployment_transaction_hash: transactionHash,
    deployment_block_number: blockNumber != null ? Number(blockNumber) : null,
    deployment_gas_used: gasUsed ? Number(gasUsed) : null,
    deployed_at: new Date().toISOString(),
    market_status: "ACTIVE",
    deployment_status: "DEPLOYED",
  };
  const { error: tblUpdErr } = await supabase
    .from("markets")
    .update(directUpdate)
    .eq("id", marketIdUuid);
  if (tblUpdErr) throw tblUpdErr;
  console.log("  ✅ Supabase: deployment info updated (direct table update)");
}

const USDC_PER_USER = "10000";
const COLLATERAL_PER_USER = "1000";
const USER1_COLLATERAL = "1000";
const USER2_COLLATERAL = "1000";
const USER3_COLLATERAL = "1000";
const NUM_USERS = 5;
const ENABLE_INITIAL_TRADES = false;

async function main() {
  console.log("\n🔁 RESUME FROM AUTHORIZATION");
  console.log("═".repeat(80));

  const symbol = process.env.SYMBOL || getArg("--symbol", "ALU-USD");
  const metricUrl =
    process.env.METRIC_URL ||
    getArg(
      "--metric-url",
      "https://www.lme.com/en/metals/non-ferrous/lme-aluminium/"
    );
  const dataSource =
    process.env.DATA_SOURCE || getArg("--data-source", "London Metal Exchange");
  const tagsCsv =
    process.env.TAGS || getArg("--tags", "COMMODITIES,METALS,ALUMINUM");
  const tags = tagsCsv
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const startPrice6 = ethers.parseUnits(
    String(process.env.START_PRICE || getArg("--start-price", "2500")),
    6
  );
  const settlementTs = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

  const network = await ethers.provider.getNetwork();
  const rawNetworkName = process.env.HARDHAT_NETWORK || "unknown";
  let networkName = rawNetworkName;
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
  console.log(`🌐 Network: ${networkName} (Chain ID: ${network.chainId})`);

  // Resolve signer(s)
  let signers = await ethers.getSigners();
  if (!signers || signers.length === 0) {
    const keys = [
      process.env.PRIVATE_KEY_DEPLOYER,
      process.env.PRIVATE_KEY_USER1,
      process.env.PRIVATE_KEY_USER2,
      process.env.PRIVATE_KEY_USER3,
      process.env.PRIVATE_KEY_USER4,
      process.env.PRIVATE_KEY,
    ].filter(Boolean);
    const unique = Array.from(new Set(keys.map((k) => String(k).trim())));
    if (unique.length === 0)
      throw new Error("No signers available (set PRIVATE_KEY or *_USERx)");
    signers = unique.map((pk) => new ethers.Wallet(pk, ethers.provider));
  }
  const [deployer] = signers;
  console.log("👤 Deployer:", deployer.address);

  const nonceMgr = await createNonceManager(deployer);

  // Resolve core contracts
  const envVault = process.env.CORE_VAULT_ADDRESS || getArg("--vault");
  const envFactory =
    process.env.FUTURES_MARKET_FACTORY_ADDRESS || getArg("--factory");
  let coreVault, factory;
  if (envVault && envFactory) {
    coreVault = await ethers.getContractAt("CoreVault", envVault, deployer);
    factory = await ethers.getContractAt(
      "FuturesMarketFactory",
      envFactory,
      deployer
    );
    console.log("🔗 Using CoreVault:", envVault);
    console.log("🔗 Using FuturesMarketFactory:", envFactory);
  } else {
    try {
      const deploymentPath = path.join(
        __dirname,
        `../deployments/${networkName}-deployment.json`
      );
      const dep = fs.existsSync(deploymentPath)
        ? JSON.parse(fs.readFileSync(deploymentPath, "utf8"))
        : {};
      const dv = dep?.contracts?.CORE_VAULT;
      const df = dep?.contracts?.FUTURES_MARKET_FACTORY;
      if (!dv || !df) throw new Error("No deployment contracts found");
      coreVault = await ethers.getContractAt("CoreVault", dv, deployer);
      factory = await ethers.getContractAt(
        "FuturesMarketFactory",
        df,
        deployer
      );
      console.log("🔗 Using CoreVault from deployments:", dv);
      console.log("🔗 Using FuturesMarketFactory from deployments:", df);
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
    }
  }

  // Authorization
  console.log("\n🔒 STEP: AUTHORIZATION");
  const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("SETTLEMENT_ROLE")
  );
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  const authTx = { factoryRole: null, settlementRole: null, mmr: null };
  console.log("  → Granting FACTORY_ROLE to FuturesMarketFactory...");
  try {
    const tx = await coreVault.grantRole(
      FACTORY_ROLE,
      await factory.getAddress(),
      await nonceMgr.nextOverrides()
    );
    console.log("     ✅ FACTORY_ROLE grant sent:", tx.hash);
    const rc = await tx.wait();
    authTx.factoryRole = rc?.hash || tx.hash;
    console.log("     ✅ FACTORY_ROLE granted (mined):", authTx.factoryRole);
  } catch (e) {
    console.log("  ❌ grantRole(FACTORY_ROLE) reverted:", extractError(e));
    await decodeAndLog(e);
    throw e;
  }
  console.log("  → Granting SETTLEMENT_ROLE to FuturesMarketFactory...");
  try {
    const tx = await coreVault.grantRole(
      SETTLEMENT_ROLE,
      await factory.getAddress(),
      await nonceMgr.nextOverrides()
    );
    console.log("     ✅ SETTLEMENT_ROLE grant sent:", tx.hash);
    const rc = await tx.wait();
    authTx.settlementRole = rc?.hash || tx.hash;
    console.log(
      "     ✅ SETTLEMENT_ROLE granted (mined):",
      authTx.settlementRole
    );
  } catch (e) {
    console.log("  ❌ grantRole(SETTLEMENT_ROLE) reverted:", extractError(e));
    await decodeAndLog(e);
    throw e;
  }
  console.log("  → Setting global MMR params (fixed 20%)...");
  try {
    const tx = await coreVault.setMmrParams(
      1000,
      1000,
      2000,
      1,
      await nonceMgr.nextOverrides()
    );
    console.log("     ✅ setMmrParams sent:", tx.hash);
    const rc = await tx.wait();
    authTx.mmr = rc?.hash || tx.hash;
    console.log("     ✅ MMR params set (mined):", authTx.mmr);
  } catch (e) {
    console.log("  ❌ setMmrParams reverted:", extractError(e));
    await decodeAndLog(e);
    throw e;
  }
  console.log(
    `\n✅ Authorization complete. Tx hashes → FACTORY_ROLE=${authTx.factoryRole} SETTLEMENT_ROLE=${authTx.settlementRole} SET_MMR=${authTx.mmr}`
  );

  // Best-effort: ensure deployer has collateral to cover marketCreationFee if not factory admin
  try {
    const mockAddr = process.env.MOCK_USDC_ADDRESS;
    if (mockAddr) {
      const mockUSDC = await ethers.getContractAt(
        "MockUSDC",
        mockAddr,
        deployer
      );
      const mintAmount = ethers.parseUnits("200", 6);
      await mockUSDC.mint(
        deployer.address,
        mintAmount,
        await nonceMgr.nextOverrides()
      );
      await mockUSDC.approve(
        await coreVault.getAddress(),
        mintAmount,
        await nonceMgr.nextOverrides()
      );
      await coreVault.depositCollateral(
        mintAmount,
        await nonceMgr.nextOverrides()
      );
      console.log("  ✅ Pre-funded deployer with 200 USDC collateral");
    }
  } catch (_) {}

  // Facets (reuse env if provided)
  console.log("\n🔧 Ensuring OrderBook facets...");
  const envInit =
    readEnvAny([
      "ORDER_BOOK_INIT_FACET",
      "ORDERBOOK_INIT_FACET",
      "ORDER_BOOK_INIT_FACET_ADDRESS",
      "ORDERBOOK_INIT_FACET_ADDRESS",
      "FACET_INIT",
      "FACET_INIT_ADDRESS",
      "OB_INIT_FACET",
      "OB_INIT_FACET_ADDRESS",
    ]) || getArg("--init-facet");
  const envAdmin =
    readEnvAny([
      "ORDER_BOOK_ADMIN_FACET",
      "ORDERBOOK_ADMIN_FACET",
      "ORDER_BOOK_ADMIN_FACET_ADDRESS",
      "ORDERBOOK_ADMIN_FACET_ADDRESS",
      "FACET_ADMIN",
      "FACET_ADMIN_ADDRESS",
      "OB_ADMIN_FACET",
      "OB_ADMIN_FACET_ADDRESS",
    ]) || getArg("--admin-facet");
  const envPricing =
    readEnvAny([
      "ORDER_BOOK_PRICING_FACET",
      "ORDERBOOK_PRICING_FACET",
      "ORDER_BOOK_PRICING_FACET_ADDRESS",
      "ORDERBOOK_PRICING_FACET_ADDRESS",
      "FACET_PRICING",
      "FACET_PRICING_ADDRESS",
      "OB_PRICING_FACET",
      "OB_PRICING_FACET_ADDRESS",
    ]) || getArg("--pricing-facet");
  const envPlacement =
    readEnvAny([
      "ORDER_BOOK_PLACEMENT_FACET",
      "ORDERBOOK_PLACEMENT_FACET",
      "ORDER_BOOK_PLACEMENT_FACET_ADDRESS",
      "ORDERBOOK_PLACEMENT_FACET_ADDRESS",
      "OB_ORDER_PLACEMENT_FACET",
      "OB_ORDER_PLACEMENT_FACET_ADDRESS",
      "FACET_PLACEMENT",
      "FACET_PLACEMENT_ADDRESS",
    ]) || getArg("--placement-facet");
  const envExec =
    readEnvAny([
      "ORDER_BOOK_EXECUTION_FACET",
      "ORDERBOOK_EXECUTION_FACET",
      "ORDER_BOOK_EXECUTION_FACET_ADDRESS",
      "ORDERBOOK_EXECUTION_FACET_ADDRESS",
      "OB_TRADE_EXECUTION_FACET",
      "OB_TRADE_EXECUTION_FACET_ADDRESS",
      "FACET_EXEC",
      "FACET_EXEC_ADDRESS",
    ]) || getArg("--exec-facet");
  const envLiq =
    readEnvAny([
      "ORDER_BOOK_LIQUIDATION_FACET",
      "ORDERBOOK_LIQUIDATION_FACET",
      "ORDER_BOOK_LIQUIDATION_FACET_ADDRESS",
      "ORDERBOOK_LIQUIDATION_FACET_ADDRESS",
      "OB_LIQUIDATION_FACET",
      "OB_LIQUIDATION_FACET_ADDRESS",
      "FACET_LIQ",
      "FACET_LIQ_ADDRESS",
    ]) || getArg("--liq-facet");
  const envView =
    readEnvAny([
      "ORDER_BOOK_VIEW_FACET",
      "ORDERBOOK_VIEW_FACET",
      "ORDER_BOOK_VIEW_FACET_ADDRESS",
      "ORDERBOOK_VIEW_FACET_ADDRESS",
      "OB_VIEW_FACET",
      "OB_VIEW_FACET_ADDRESS",
      "FACET_VIEW",
      "FACET_VIEW_ADDRESS",
    ]) || getArg("--view-facet");
  const envSettlement =
    readEnvAny([
      "ORDER_BOOK_SETTLEMENT_FACET",
      "ORDERBOOK_SETTLEMENT_FACET",
      "ORDER_BOOK_SETTLEMENT_FACET_ADDRESS",
      "ORDERBOOK_SETTLEMENT_FACET_ADDRESS",
      "OB_SETTLEMENT_FACET",
      "OB_SETTLEMENT_FACET_ADDRESS",
      "FACET_SETTLEMENT",
      "FACET_SETTLEMENT_ADDRESS",
    ]) || getArg("--settlement-facet");
  const needsDeploy = !(
    envInit &&
    envAdmin &&
    envPricing &&
    envPlacement &&
    envExec &&
    envLiq &&
    envView &&
    envSettlement
  );

  let initAddr,
    adminAddr,
    pricingAddr,
    placementAddr,
    execAddr,
    liqAddr,
    viewAddr,
    settlementAddr;
  if (needsDeploy) {
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

    console.log("  • Deploying OrderBookInitFacet...");
    const initFacet = await OrderBookInitFacet.deploy();
    await initFacet.waitForDeployment();
    initAddr = await initFacet.getAddress();
    console.log("    - OrderBookInitFacet:", initAddr);

    console.log("  • Deploying OBAdminFacet...");
    const adminFacet = await OBAdminFacet.deploy();
    await adminFacet.waitForDeployment();
    adminAddr = await adminFacet.getAddress();
    console.log("    - OBAdminFacet:", adminAddr);

    console.log("  • Deploying OBPricingFacet...");
    const pricingFacet = await OBPricingFacet.deploy();
    await pricingFacet.waitForDeployment();
    pricingAddr = await pricingFacet.getAddress();
    console.log("    - OBPricingFacet:", pricingAddr);

    console.log("  • Deploying OBOrderPlacementFacet...");
    const placementFacet = await OBOrderPlacementFacet.deploy();
    await placementFacet.waitForDeployment();
    placementAddr = await placementFacet.getAddress();
    console.log("    - OBOrderPlacementFacet:", placementAddr);

    console.log("  • Deploying OBTradeExecutionFacet...");
    const execFacet = await OBTradeExecutionFacet.deploy();
    await execFacet.waitForDeployment();
    execAddr = await execFacet.getAddress();
    console.log("    - OBTradeExecutionFacet:", execAddr);

    console.log("  • Deploying OBLiquidationFacet...");
    const liqFacet = await OBLiquidationFacet.deploy();
    await liqFacet.waitForDeployment();
    liqAddr = await liqFacet.getAddress();
    console.log("    - OBLiquidationFacet:", liqAddr);

    console.log("  • Deploying OBViewFacet...");
    const viewFacet = await OBViewFacet.deploy();
    await viewFacet.waitForDeployment();
    viewAddr = await viewFacet.getAddress();
    console.log("    - OBViewFacet:", viewAddr);

    console.log("  • Deploying OBSettlementFacet...");
    const settlementFacet = await OBSettlementFacet.deploy();
    await settlementFacet.waitForDeployment();
    settlementAddr = await settlementFacet.getAddress();
    console.log("    - OBSettlementFacet:", settlementAddr);
  } else {
    initAddr = envInit;
    adminAddr = envAdmin;
    pricingAddr = envPricing;
    placementAddr = envPlacement;
    execAddr = envExec;
    liqAddr = envLiq;
    viewAddr = envView;
    settlementAddr = envSettlement;
    console.log("  • Reusing provided facet addresses");
  }

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

  function selectors(iface) {
    return iface.fragments
      .filter((f) => f.type === "function")
      .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
  }
  const FacetCutAction = { Add: 0 };
  const cut = [
    {
      facetAddress: adminAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBAdminFacet.interface),
    },
    {
      facetAddress: pricingAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBPricingFacet.interface),
    },
    {
      facetAddress: placementAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBOrderPlacementFacet.interface),
    },
    {
      facetAddress: execAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBTradeExecutionFacet.interface),
    },
    {
      facetAddress: liqAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBLiquidationFacet.interface),
    },
    {
      facetAddress: viewAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBViewFacet.interface),
    },
    {
      facetAddress: settlementAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBSettlementFacet.interface),
    },
  ];

  // Create market
  console.log("\n🏭 Creating market (Diamond)...");
  try {
    // Preflight static call decode
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
          deployer.address,
          cut,
          initAddr,
          "0x"
        );
    } catch (e) {
      console.log(
        "  ❌ createFuturesMarketDiamond static reverted:",
        extractError(e)
      );
      await decodeAndLog(e);
      throw e;
    }
    const tx = await factory.createFuturesMarketDiamond(
      symbol,
      metricUrl,
      settlementTs,
      startPrice6,
      dataSource,
      tags,
      deployer.address,
      cut,
      initAddr,
      "0x",
      await nonceMgr.nextOverrides()
    );
    const receipt = await tx.wait();
    console.log("  ✅ Market created");
    // Parse event
    let orderBook, marketId;
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
    // Continue with OB config below (existing code uses variables)
    var __orderBook = orderBook;
    var __marketId = marketId;
    orderBook = __orderBook; // retain names
    marketId = __marketId;
  } catch (e) {
    console.log("  ❌ createFuturesMarketDiamond reverted:", extractError(e));
    await decodeAndLog(e);
    throw e;
  }

  // Configure OB
  const obAdmin = await ethers.getContractAt(
    "OBAdminFacet",
    orderBook,
    deployer
  );
  try {
    console.log(
      "\n🔧 Configuring OB trading params (100% margin, 0% fee, treasury=deployer)..."
    );
    await obAdmin.updateTradingParameters(
      10000,
      0,
      deployer.address,
      await nonceMgr.nextOverrides()
    );
    console.log("  ✅ Trading params updated");
  } catch (e) {
    console.log("  ⚠️ Could not set trading params:", extractError(e));
  }
  try {
    await obAdmin.disableLeverage(await nonceMgr.nextOverrides());
    console.log("  ✅ Leverage disabled");
  } catch (_) {}

  // Roles for OB and initial mark price
  console.log("\n🔒 Assigning OB roles + initial mark price...");
  await coreVault.grantRole(
    ORDERBOOK_ROLE,
    orderBook,
    await nonceMgr.nextOverrides()
  );
  await coreVault.grantRole(
    SETTLEMENT_ROLE,
    orderBook,
    await nonceMgr.nextOverrides()
  );
  await coreVault.grantRole(
    SETTLEMENT_ROLE,
    deployer.address,
    await nonceMgr.nextOverrides()
  );
  await coreVault.updateMarkPrice(
    marketId,
    ethers.parseUnits("1", 6),
    await nonceMgr.nextOverrides()
  );
  console.log("  ✅ OB roles granted and mark price set to $1");

  // Optional: Supabase
  const saveOnLocalhost = getBoolEnv("SAVE_TO_SUPABASE_LOCALHOST", false);
  const shouldSaveToSupabase =
    networkName === "hyperliquid" ||
    networkName === "hyperliquid_testnet" ||
    (networkName === "localhost" && saveOnLocalhost);
  if (shouldSaveToSupabase) {
    try {
      console.log(
        `\n🗄️  Saving market to Supabase (network=${networkName})...`
      );
      const decimals = Number(process.env.DEFAULT_MARKET_DECIMALS || 8);
      const minOrder = Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1);
      const windowSec = Number(
        process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600
      );
      const initialOrder = {
        metricUrl,
        startPrice: String(ethers.formatUnits(startPrice6, 6)),
        dataSource,
        tags,
      };
      await saveMarketToSupabase({
        marketIdentifier: symbol,
        symbol,
        name: "Aluminum Futures",
        description:
          networkName === "hyperliquid"
            ? "Aluminum futures on HyperLiquid Mainnet."
            : "Aluminum futures (dev)",
        category: "COMMODITIES",
        decimals,
        minimumOrderSize: minOrder,
        requiresKyc: false,
        settlementDate: settlementTs,
        tradingEndDate: null,
        dataRequestWindowSeconds: windowSec,
        autoSettle: true,
        oracleProvider: null,
        initialOrder,
        chainId: Number(network.chainId),
        networkName,
        creatorWalletAddress: deployer.address,
        bannerImageUrl: null,
        iconImageUrl: null,
        supportingPhotoUrls: [],
        marketAddress: orderBook,
        factoryAddress: await factory.getAddress(),
        centralVaultAddress: await coreVault.getAddress(),
        orderRouterAddress: null,
        positionManagerAddress: process.env.POSITION_MANAGER_ADDRESS || null,
        liquidationManagerAddress:
          process.env.LIQUIDATION_MANAGER_ADDRESS || null,
        vaultAnalyticsAddress: process.env.VAULT_ANALYTICS_ADDRESS || null,
        usdcTokenAddress: process.env.MOCK_USDC_ADDRESS || null,
        umaOraclManagerAddress: null,
        marketIdBytes32: marketId,
        transactionHash: receipt?.hash || null,
        blockNumber: receipt?.blockNumber || null,
        gasUsed: receipt?.gasUsed?.toString?.() || null,
      });
    } catch (e) {
      console.log("  ⚠️  Supabase save failed:", extractError(e));
    }
  }

  // Funding
  console.log("\n💰 Funding (best-effort for available signers)...");
  try {
    const mockAddr = process.env.MOCK_USDC_ADDRESS;
    if (mockAddr) {
      const mockUSDC = await ethers.getContractAt(
        "MockUSDC",
        mockAddr,
        deployer
      );
      for (let i = 0; i < Math.min(NUM_USERS, signers.length); i++) {
        const user = signers[i];
        const mintAmount = ethers.parseUnits(USDC_PER_USER, 6);
        await mockUSDC
          .connect(deployer)
          .mint(user.address, mintAmount, await getTxOverrides());
        const collateralStr =
          i === 1
            ? USER1_COLLATERAL
            : i === 2
            ? USER2_COLLATERAL
            : i === 3
            ? USER3_COLLATERAL
            : COLLATERAL_PER_USER;
        const collateral = ethers.parseUnits(collateralStr, 6);
        await mockUSDC
          .connect(user)
          .approve(
            await coreVault.getAddress(),
            collateral,
            await getTxOverrides()
          );
        await coreVault
          .connect(user)
          .depositCollateral(collateral, await getTxOverrides());
      }
      console.log("  ✅ Accounts funded");
    } else {
      console.log("  ℹ️  MOCK_USDC_ADDRESS not set; skipping funding");
    }
  } catch (e) {
    console.log("  ⚠️  Funding failed:", extractError(e));
  }

  // Update config + deployments
  console.log("\n📝 Updating deployment file...");
  const deploymentPath = path.join(
    __dirname,
    `../deployments/${networkName}-deployment.json`
  );
  let dep = {};
  try {
    if (fs.existsSync(deploymentPath))
      dep = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  } catch (_) {}
  dep.network = networkName;
  dep.chainId = Number(network.chainId);
  dep.timestamp = new Date().toISOString();
  dep.contracts = dep.contracts || {};
  dep.contracts.ORDERBOOK = orderBook;
  dep.contracts.MARKET_ID = marketId;
  const aluKey = symbol
    .split("-")[0]
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  dep.contracts[`${aluKey}_ORDERBOOK`] = orderBook;
  dep.contracts[`${aluKey}_MARKET_ID`] = marketId;
  dep.markets = Array.isArray(dep.markets) ? dep.markets : [];
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
  const idx = dep.markets.findIndex((m) => m.symbol === symbol);
  if (idx >= 0) dep.markets[idx] = entry;
  else dep.markets.push(entry);
  fs.writeFileSync(deploymentPath, JSON.stringify(dep, null, 2));
  console.log(
    "  ✅ Deployment updated:",
    path.relative(process.cwd(), deploymentPath)
  );

  console.log("\n✅ Resume from authorization complete.");
  console.log("═".repeat(80));
  console.log(`🎯 ${symbol} → ${orderBook}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ resume-authorization failed:", extractError(e));
    process.exit(1);
  });
