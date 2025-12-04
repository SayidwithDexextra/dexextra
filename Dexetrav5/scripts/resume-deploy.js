#!/usr/bin/env node

// resume-deploy.js - Continue a partially completed deployment after a gas failure
//
// This script attaches to already-deployed core contracts (MockUSDC, VaultAnalytics,
// PositionManager, CoreVault, LiquidationManager) and resumes from the point where
// deploy.js failed when deploying the FuturesMarketFactory. It then continues with
// facets, market creation, configuration, optional Supabase save, account funding,
// and config updates — mirroring deploy.js behavior from STEP 1.5 onward.
//
// Usage examples:
//   From repo root (preferred):
//     npx hardhat --config Dexetrav5/hardhat.config.js \
//       run Dexetrav5/scripts/resume-deploy.js --network hyperliquid \
//       --usdc 0x... --vault 0x... --liq 0x... --va 0x... --pm 0x... \
//       --force-new-factory
//
//   Or via env (.env.local preferred at repo root):
//     MOCK_USDC_ADDRESS=0x...
//     CORE_VAULT_ADDRESS=0x...
//     LIQUIDATION_MANAGER_ADDRESS=0x...
//     VAULT_ANALYTICS_ADDRESS=0x...
//     POSITION_MANAGER_ADDRESS=0x...
//
// Notes:
// - Idempotent where possible. If FUTURES_MARKET_FACTORY_ADDRESS is provided,
//   factory deployment is skipped and we attach to it.
// - Mirrors deploy.js technical implementation for consistency.

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Load env with preference for repo root .env.local
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

const { createClient } = require("@supabase/supabase-js");

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (
    idx !== -1 &&
    process.argv[idx + 1] &&
    !String(process.argv[idx + 1]).startsWith("--")
  ) {
    return process.argv[idx + 1];
  }
  return undefined;
}

function getBoolEnv(key, defaultVal = false) {
  const raw = process.env[key];
  if (raw === undefined) return defaultVal;
  const v = String(raw).toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
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

  // 1) Find existing by market_identifier; if network differs, use network-specific identifier
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

  // 2) Create if missing via RPC (ensures defaults and RLS compatibility)
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

  // 3) Update deployment info via RPC when enabled (default: enable unless localhost)
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

  // Fallback: direct table update using service role
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

async function updateContractsFile(contracts) {
  const configPath = path.join(__dirname, "../config/contracts.js");
  try {
    let content = fs.readFileSync(configPath, "utf8");
    Object.entries(contracts).forEach(([name, address]) => {
      const regex = new RegExp(`${name}:\\s*"0x[a-fA-F0-9]+"`, "g");
      content = content.replace(regex, `${name}: "${address}"`);
    });
    if (contracts.ALUMINUM_ORDERBOOK) {
      content = content.replace(
        /ORDERBOOK:\s*"0x[a-fA-F0-9]+"/,
        `ORDERBOOK: "${contracts.ALUMINUM_ORDERBOOK}"`
      );
      if (!content.includes('ALUMINUM_ORDERBOOK: "OrderBook"')) {
        content = content.replace(
          /MOCK_USDC: "MockUSDC",/,
          `MOCK_USDC: "MockUSDC",\n  ALUMINUM_ORDERBOOK: "OrderBook",`
        );
      }
      if (contracts.ALUMINUM_MARKET_ID) {
        const aluBlockRegex = /ALUMINUM:\s*\{[\s\S]*?\}/m;
        const m = content.match(aluBlockRegex);
        if (m) {
          const updated = m[0].replace(
            /marketId:\s*[^,]+,/,
            `marketId: "${contracts.ALUMINUM_MARKET_ID}",`
          );
          content = content.replace(aluBlockRegex, updated);
        }
      }
      if (!content.includes("ALUMINUM: {")) {
        const aluminumInfo = `\n  ALUMINUM: {\n    symbol: "ALU-USD",\n    marketId: "${
          contracts.ALUMINUM_MARKET_ID || "0x"
        }",\n    name: "Aluminum Futures",\n    orderBook: "${
          contracts.ALUMINUM_ORDERBOOK
        }",\n    leverageEnabled: false,\n    maxLeverage: "1x",\n    marginRequirement: "100%",\n    defaultMargin: "100%",\n    riskLevel: "LOW",\n    collateralRatio: "1:1",\n    features: {\n      marginRelease: true,\n      cumulativeTracking: true,\n      multiPriceLevel: true,\n    },\n  },`;
        const btcEndMatch = content.match(/BTC:\s*{[^}]*}[^}]*},/s);
        if (btcEndMatch) {
          const insertPos = btcEndMatch.index + btcEndMatch[0].length;
          content =
            content.slice(0, insertPos) +
            aluminumInfo +
            content.slice(insertPos);
        }
      }
    }
    fs.writeFileSync(configPath, content);
  } catch (error) {
    console.log("  ⚠️  Could not fully update contracts.js:", error.message);
    console.log("  Please verify the configuration manually");
  }
}

// Configuration defaults matching deploy.js
const USDC_PER_USER = "10000";
const COLLATERAL_PER_USER = "1000";
const USER1_COLLATERAL = "1000";
const USER2_COLLATERAL = "1000";
const USER3_COLLATERAL = "1000";
const NUM_USERS = 5;
const ENABLE_INITIAL_TRADES = false;

const PREFUNDED_DEPLOYER_PRIVATE_KEY =
  process.env.PREFUNDED_DEPLOYER_PRIVATE_KEY;

async function main() {
  console.log("\n🔁 RESUME DEPLOYMENT (from factory onwards)");
  console.log("═".repeat(80));

  // Network info & signers
  const network = await ethers.provider.getNetwork();
  const networkNameRaw = process.env.HARDHAT_NETWORK || "unknown";
  let networkName = networkNameRaw;
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

  let signers = await ethers.getSigners();
  // Optionally include a pre-funded deployer when provided via env
  if (PREFUNDED_DEPLOYER_PRIVATE_KEY) {
    try {
      const prefundedDeployer = new ethers.Wallet(
        PREFUNDED_DEPLOYER_PRIVATE_KEY,
        ethers.provider
      );
      signers = [prefundedDeployer, ...signers];
    } catch (_) {}
  }
  // Fallback: build signers list from env keys if none provided by Hardhat
  if (!signers || signers.length === 0) {
    const candidateKeys = [
      process.env.PRIVATE_KEY_DEPLOYER,
      process.env.PRIVATE_KEY_USER1,
      process.env.PRIVATE_KEY_USER2,
      process.env.PRIVATE_KEY_USER3,
      process.env.PRIVATE_KEY_USER4,
      process.env.PRIVATE_KEY,
      process.env.PREFUNDED_DEPLOYER_PRIVATE_KEY,
    ].filter(Boolean);
    const unique = Array.from(
      new Set(candidateKeys.map((k) => String(k).trim()))
    );
    if (unique.length === 0) {
      throw new Error(
        "❌ No signers available. Set PRIVATE_KEY (or *_USER1..4 / PRIVATE_KEY_DEPLOYER) in your environment."
      );
    }
    signers = unique.map((pk) => new ethers.Wallet(pk, ethers.provider));
  }
  // Proceed even if fewer than NUM_USERS signers are present
  if (signers.length < NUM_USERS) {
    console.log(
      `ℹ️  Proceeding with ${signers.length} signer(s); expected ${NUM_USERS}. Funding will target available accounts.`
    );
  }
  const [deployer] = signers;

  console.log(`🌐 Network: ${networkName} (Chain ID: ${network.chainId})`);
  console.log("📋 Deployer:", deployer.address);

  // Resolve existing addresses (env or CLI)
  const mockUsdcAddr = process.env.MOCK_USDC_ADDRESS || getArg("--usdc");
  const coreVaultAddr = process.env.CORE_VAULT_ADDRESS || getArg("--vault");
  const liqMgrAddr = process.env.LIQUIDATION_MANAGER_ADDRESS || getArg("--liq");
  const vaultAnalyticsAddr =
    process.env.VAULT_ANALYTICS_ADDRESS || getArg("--va");
  const positionManagerAddr =
    process.env.POSITION_MANAGER_ADDRESS || getArg("--pm");
  const forceNewFactory =
    process.argv.includes("--force-new-factory") ||
    process.argv.includes("--new-factory") ||
    getBoolEnv("FORCE_NEW_FACTORY", false);
  const existingFactoryAddr = forceNewFactory
    ? undefined
    : process.env.FUTURES_MARKET_FACTORY_ADDRESS || getArg("--factory");

  if (
    !mockUsdcAddr ||
    !coreVaultAddr ||
    !liqMgrAddr ||
    !vaultAnalyticsAddr ||
    !positionManagerAddr
  ) {
    throw new Error(
      "Missing required addresses. Provide --usdc, --vault, --liq, --va, --pm or set the corresponding *_ADDRESS env vars."
    );
  }

  const contracts = {
    MOCK_USDC: mockUsdcAddr,
    CORE_VAULT: coreVaultAddr,
    LIQUIDATION_MANAGER: liqMgrAddr,
    VAULT_ANALYTICS: vaultAnalyticsAddr,
    POSITION_MANAGER: positionManagerAddr,
  };

  const mockUSDC = await ethers.getContractAt(
    "MockUSDC",
    contracts.MOCK_USDC,
    deployer
  );
  const coreVault = await ethers.getContractAt(
    "CoreVault",
    contracts.CORE_VAULT,
    deployer
  );

  // Ensure liquidation manager is set (idempotent)
  try {
    await coreVault.setLiquidationManager(contracts.LIQUIDATION_MANAGER);
    console.log("🔧 Ensured CoreVault.liquidationManager is set");
  } catch (e) {
    console.log("ℹ️  Skipped setLiquidationManager (likely already set)");
  }

  // Deploy or attach to FuturesMarketFactory
  let factory;
  if (existingFactoryAddr) {
    factory = await ethers.getContractAt(
      "FuturesMarketFactory",
      existingFactoryAddr,
      deployer
    );
    contracts.FUTURES_MARKET_FACTORY = existingFactoryAddr;
    console.log("🏭 Using existing FuturesMarketFactory:", existingFactoryAddr);
  } else {
    console.log("\n5️⃣ Deploying FuturesMarketFactory...");
    const FuturesMarketFactory = await ethers.getContractFactory(
      "FuturesMarketFactory"
    );
    const factoryDeployed = await FuturesMarketFactory.deploy(
      contracts.CORE_VAULT,
      deployer.address,
      deployer.address
    );
    await factoryDeployed.waitForDeployment();
    contracts.FUTURES_MARKET_FACTORY = await factoryDeployed.getAddress();
    factory = factoryDeployed;
    console.log(
      "     ✅ FuturesMarketFactory deployed at:",
      contracts.FUTURES_MARKET_FACTORY
    );
  }

  // Deploy Diamond facets
  console.log("\n5️⃣b Deploying Diamond facets for OrderBook...");
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
  console.log("     • OrderBookInitFacet:", await initFacet.getAddress());
  const adminFacet = await OBAdminFacet.deploy();
  await adminFacet.waitForDeployment();
  console.log("     • OBAdminFacet:", await adminFacet.getAddress());
  const pricingFacet = await OBPricingFacet.deploy();
  await pricingFacet.waitForDeployment();
  console.log("     • OBPricingFacet:", await pricingFacet.getAddress());
  const placementFacet = await OBOrderPlacementFacet.deploy();
  await placementFacet.waitForDeployment();
  console.log(
    "     • OBOrderPlacementFacet:",
    await placementFacet.getAddress()
  );
  const execFacet = await OBTradeExecutionFacet.deploy();
  await execFacet.waitForDeployment();
  console.log("     • OBTradeExecutionFacet:", await execFacet.getAddress());
  const liqFacet = await OBLiquidationFacet.deploy();
  await liqFacet.waitForDeployment();
  console.log("     • OBLiquidationFacet:", await liqFacet.getAddress());
  const viewFacet = await OBViewFacet.deploy();
  await viewFacet.waitForDeployment();
  console.log("     • OBViewFacet:", await viewFacet.getAddress());
  const settlementFacet = await OBSettlementFacet.deploy();
  await settlementFacet.waitForDeployment();
  console.log("     • OBSettlementFacet:", await settlementFacet.getAddress());

  const initAddr = await initFacet.getAddress();
  const adminAddr = await adminFacet.getAddress();
  const pricingAddr = await pricingFacet.getAddress();
  const placementAddr = await placementFacet.getAddress();
  const execAddr = await execFacet.getAddress();
  const liqAddr = await liqFacet.getAddress();
  const viewAddr = await viewFacet.getAddress();
  const settlementAddr = await settlementFacet.getAddress();

  console.log("     ✅ Facets deployed:");
  console.log("        init:", initAddr);
  console.log("        admin:", adminAddr);
  console.log("        pricing:", pricingAddr);
  console.log("        placement:", placementAddr);
  console.log("        execution:", execAddr);
  console.log("        liquidation:", liqAddr);
  console.log("        settlement:", settlementAddr);

  // Conservative defaults on factory
  try {
    console.log(
      "  🔧 Setting factory defaults: margin=10000 bps, fee=0 bps..."
    );
    await factory.updateDefaultParameters(10000, 0);
    console.log(
      "     ✅ Factory default parameters updated (100% margin, 0% fee)"
    );
  } catch (e) {
    console.log(
      "     ⚠️  Could not update factory default parameters:",
      e?.message || e
    );
  }

  // Authorization on CoreVault for factory and risk params
  console.log("\n🔒 Setting up authorization...");
  const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("SETTLEMENT_ROLE")
  );
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));

  console.log("  → Granting FACTORY_ROLE to FuturesMarketFactory...");
  await coreVault.grantRole(FACTORY_ROLE, contracts.FUTURES_MARKET_FACTORY);
  console.log("  → Granting SETTLEMENT_ROLE to FuturesMarketFactory...");
  await coreVault.grantRole(SETTLEMENT_ROLE, contracts.FUTURES_MARKET_FACTORY);
  console.log("  → Setting global MMR params (fixed 20%)...");
  await coreVault.setMmrParams(1000, 1000, 2000, 0, 1);
  console.log("     ✅ MMR params set");

  // Create ALUMINUM market (mirrors deploy.js)
  console.log("\n🏭 Creating ALUMINUM market (Diamond)...");
  const marketSymbol = "ALU-USD";
  const marketId = ethers.keccak256(ethers.toUtf8Bytes(marketSymbol));
  const metricUrl = "https://www.lme.com/en/metals/non-ferrous/lme-aluminium/";
  const settlementDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const startPrice = ethers.parseUnits("2500", 6);
  const dataSource = "London Metal Exchange";
  const tags = ["COMMODITIES", "METALS", "ALUMINUM"];

  const FacetCutAction = { Add: 0 };
  function selectors(iface) {
    return iface.fragments
      .filter((f) => f.type === "function")
      .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
  }

  const cut = [
    {
      facetAddress: adminAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(adminFacet.interface),
    },
    {
      facetAddress: pricingAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(pricingFacet.interface),
    },
    {
      facetAddress: placementAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(placementFacet.interface),
    },
    {
      facetAddress: execAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(execFacet.interface),
    },
    {
      facetAddress: liqAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(liqFacet.interface),
    },
    {
      facetAddress: viewAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(viewFacet.interface),
    },
    {
      facetAddress: settlementAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(settlementFacet.interface),
    },
  ];

  const createTx = await factory.createFuturesMarketDiamond(
    marketSymbol,
    metricUrl,
    settlementDate,
    startPrice,
    dataSource,
    tags,
    deployer.address,
    cut,
    initAddr,
    "0x"
  );
  const receipt = await createTx.wait();
  console.log("     ✅ Market created!");

  // Parse event
  let actualMarketId;
  const evt = receipt.logs.find((log) => {
    try {
      const parsed = factory.interface.parseLog(log);
      return parsed.name === "FuturesMarketCreated";
    } catch {
      return false;
    }
  });
  if (!evt) throw new Error("Failed to get OrderBook address from event");
  const parsedEvent = factory.interface.parseLog(evt);
  contracts.ALUMINUM_ORDERBOOK = parsedEvent.args.orderBook;
  actualMarketId = parsedEvent.args.marketId;
  contracts.ALUMINUM_MARKET_ID = actualMarketId;
  console.log("     ✅ ALUMINUM OrderBook:", contracts.ALUMINUM_ORDERBOOK);
  console.log("     ✅ Market ID:", actualMarketId);

  // Configure OB via admin facet
  try {
    const obAdmin = await ethers.getContractAt(
      "OBAdminFacet",
      contracts.ALUMINUM_ORDERBOOK,
      deployer
    );
    console.log(
      "  🔧 Configuring Diamond OB params (100% margin, 0% fee, treasury=deployer)..."
    );
    await obAdmin.updateTradingParameters(10000, 0, deployer.address);
    console.log("     ✅ Diamond OB trading parameters set");
  } catch (e) {
    console.log(
      "     ⚠️  Could not set Diamond OB trading parameters:",
      e?.message || e
    );
  }

  // Set initial mark price for the market
  console.log("  📊 Setting initial mark price...");
  await coreVault.grantRole(SETTLEMENT_ROLE, deployer.address);
  const actualInitialPrice = ethers.parseUnits("1", 6);
  await coreVault.updateMarkPrice(actualMarketId, actualInitialPrice);
  console.log(
    `     ✅ Mark price set to $${ethers.formatUnits(
      actualInitialPrice,
      6
    )} (matching initial liquidity)`
  );

  // Grant roles to OB
  await coreVault.grantRole(ORDERBOOK_ROLE, contracts.ALUMINUM_ORDERBOOK);
  console.log("     ✅ ORDERBOOK_ROLE granted to OrderBook");
  await coreVault.grantRole(SETTLEMENT_ROLE, contracts.ALUMINUM_ORDERBOOK);
  console.log("     ✅ SETTLEMENT_ROLE granted to OrderBook");

  // Optional: Save to Supabase
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
        startPrice: String(ethers.formatUnits(startPrice, 6)),
        dataSource,
        tags,
      };
      await saveMarketToSupabase({
        marketIdentifier: marketSymbol,
        symbol: marketSymbol,
        name: "Aluminum Futures",
        description:
          networkName === "localhost"
            ? "Aluminum futures (localhost test save)."
            : networkName === "hyperliquid"
            ? "Aluminum futures on HyperLiquid Mainnet."
            : "Aluminum futures on HyperLiquid Testnet.",
        category: "COMMODITIES",
        decimals,
        minimumOrderSize: minOrder,
        requiresKyc: false,
        settlementDate,
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
        marketAddress: contracts.ALUMINUM_ORDERBOOK,
        factoryAddress: contracts.FUTURES_MARKET_FACTORY,
        centralVaultAddress: contracts.CORE_VAULT,
        orderRouterAddress: null,
        positionManagerAddress: contracts.POSITION_MANAGER,
        liquidationManagerAddress: contracts.LIQUIDATION_MANAGER,
        vaultAnalyticsAddress: contracts.VAULT_ANALYTICS,
        usdcTokenAddress: contracts.MOCK_USDC,
        umaOracleManagerAddress: null,
        marketIdBytes32: actualMarketId,
        transactionHash: receipt?.hash || null,
        blockNumber: receipt?.blockNumber || null,
        gasUsed: receipt?.gasUsed?.toString?.() || null,
      });
    } catch (e) {
      console.log("  ⚠️  Supabase save failed:", e?.message || e);
    }
  } else {
    if (networkName === "localhost") {
      console.log(
        "\nℹ️  Skipping Supabase save on localhost (SAVE_TO_SUPABASE_LOCALHOST is not truthy)"
      );
    } else {
      console.log(
        "\nℹ️  Skipping Supabase save (network not supported for Supabase saving)"
      );
    }
  }

  // Fund trading accounts (mirrors deploy.js)
  console.log("\n💰 Funding trading accounts...");
  for (let i = 0; i < Math.min(NUM_USERS, signers.length); i++) {
    const user = signers[i];
    const userType = i === 0 ? "Deployer" : `User ${i}`;
    console.log(`  ${userType}: ${user.address}`);
    try {
      const mintAmount = ethers.parseUnits(USDC_PER_USER, 6);
      await mockUSDC.connect(deployer).mint(user.address, mintAmount);
      console.log(`     ✅ Minted ${USDC_PER_USER} USDC`);
      let collateralAmountStr = COLLATERAL_PER_USER;
      if (i === 1) collateralAmountStr = USER1_COLLATERAL;
      else if (i === 2) collateralAmountStr = USER2_COLLATERAL;
      else if (i === 3) collateralAmountStr = USER3_COLLATERAL;
      const collateralAmount = ethers.parseUnits(collateralAmountStr, 6);
      await mockUSDC
        .connect(user)
        .approve(contracts.CORE_VAULT, collateralAmount);
      await coreVault.connect(user).depositCollateral(collateralAmount);
      console.log(
        `     ✅ Deposited ${collateralAmountStr} USDC as collateral`
      );
    } catch (error) {
      console.log(`     ❌ Error: ${error.message}`);
    }
  }

  // Optional: initial orders/trades (same flag default as deploy.js)
  console.log("\n📈 Initial orders & trades");
  if (ENABLE_INITIAL_TRADES) {
    try {
      const orderPlacement = await ethers.getContractAt(
        "OBOrderPlacementFacet",
        contracts.ALUMINUM_ORDERBOOK
      );
      const tradeExec = await ethers.getContractAt(
        "OBTradeExecutionFacet",
        contracts.ALUMINUM_ORDERBOOK
      );
      const viewFacetRuntime = await ethers.getContractAt(
        "OBViewFacet",
        contracts.ALUMINUM_ORDERBOOK
      );

      const price = ethers.parseUnits("1", 6);
      const amountEach = ethers.parseUnits("4", 18);
      const amountEach2 = ethers.parseUnits("6", 18);

      await (
        await orderPlacement
          .connect(deployer)
          .placeMarginLimitOrder(price, amountEach, true)
      ).wait();
      const user1Signer = signers[1];
      await (
        await orderPlacement
          .connect(user1Signer)
          .placeMarginLimitOrder(price, amountEach2, true)
      ).wait();

      const bestBid = await viewFacetRuntime.bestBid();
      const bestAsk = await viewFacetRuntime.bestAsk();
      console.log(`     📊 Best Bid: $${ethers.formatUnits(bestBid, 6)}`);
      console.log(`     📊 Best Ask: $${ethers.formatUnits(bestAsk, 6)}`);

      const user3 = signers[3];
      const totalSellAmount = ethers.parseUnits("10", 18);
      await (
        await tradeExec
          .connect(user3)
          .placeMarginMarketOrder(totalSellAmount, false)
      ).wait();
      console.log("     ✅ Market sell order executed successfully!");

      const user2 = signers[2];
      const user2Price = ethers.parseUnits("2.3", 6);
      const user2Amount = ethers.parseUnits("20", 18);
      await (
        await orderPlacement
          .connect(user2)
          .placeMarginLimitOrder(user2Price, user2Amount, false)
      ).wait();
      console.log("     ✅ Limit sell order placed successfully!");
    } catch (error) {
      console.log(`     ⚠️  Could not place initial orders: ${error.message}`);
      console.log("     Order placement is optional - deployment can continue");
    }
  } else {
    console.log(
      "⏭️  Skipped placing initial orders (ENABLE_INITIAL_TRADES=false)"
    );
  }

  // Update configuration & save deployment JSON
  console.log("\n📝 Updating configuration...");
  await updateContractsFile(contracts);
  console.log("  ✅ Updated config/contracts.js");

  const deploymentInfo = {
    network: networkName,
    chainId: Number(network.chainId),
    timestamp: new Date().toISOString(),
    contracts: contracts,
    deployer: deployer.address,
    allUsers: signers.slice(0, NUM_USERS).map((signer, index) => ({
      index,
      address: signer.address,
      role: index === 0 ? "deployer" : `user${index}`,
    })),
    aluminumMarket: {
      marketId: actualMarketId,
      symbol: marketSymbol,
      orderBook: contracts.ALUMINUM_ORDERBOOK,
    },
  };
  const deploymentPath = path.join(
    __dirname,
    `../deployments/${networkName}-deployment.json`
  );
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("  ✅ Saved deployment info");

  console.log("\n✅ Resume deployment complete!");
  console.log("═".repeat(80));
  console.log("📚 Deployed:");
  console.log("  CORE_VAULT:", contracts.CORE_VAULT);
  console.log("  FUTURES_MARKET_FACTORY:", contracts.FUTURES_MARKET_FACTORY);
  console.log("  ALUMINUM_ORDERBOOK:", contracts.ALUMINUM_ORDERBOOK);
  console.log("  ALUMINUM_MARKET_ID:", contracts.ALUMINUM_MARKET_ID);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ RESUME FAILED:", error?.message || error);
    process.exit(1);
  });
