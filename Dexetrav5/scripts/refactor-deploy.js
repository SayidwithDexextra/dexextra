#!/usr/bin/env node

/**
 * refactor-deploy.js
 *
 * HyperLiquid-only deploy that:
 * - Deploys new core contracts (MockUSDC or provided USDC, CoreVault, LiquidationManager, FuturesMarketFactory, OB facets)
 * - Grants required roles on CoreVault and OrderBooks
 * - Creates a sample ALUMINUM market
 * - Skips all external / cross-chain (spoke/inbox/outbox) deployments
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Load env (.env.local preferred)
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

async function main() {
  console.log("═".repeat(80));
  console.log("HyperLiquid-only deploy (no spokes / bridge contracts)");
  const logDeployed = (label, addr, txHash) => {
    const hashPart = txHash ? `  tx: ${txHash}` : "  tx: n/a";
    console.log(`   • ${label}: ${addr}   ${hashPart}`);
  };

  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || network.name || "unknown";
  const lowerNet = String(networkName).toLowerCase();
  const isHubNetwork =
    ["hyperliquid", "hyperliquid_testnet", "localhost", "hardhat"].includes(
      lowerNet
    ) || network.chainId === 31337n;
  const isPolygonLike =
    lowerNet.includes("polygon") || lowerNet.includes("mumbai");
  const isArbitrumLike = lowerNet.includes("arbitrum");
  if (!isHubNetwork && !isPolygonLike && !isArbitrumLike) {
    throw new Error(
      `Unsupported network ${networkName} (${network.chainId}). Expected hub (hyperliquid/localhost) or spoke (polygon/mumbai/arbitrum).`
    );
  }
  const [deployer] = await ethers.getSigners();
  console.log(`🌐 Network: ${networkName} (chainId=${network.chainId})`);
  console.log("👤 Deployer:", deployer.address);
  console.log("🧭 Env snapshot (deploy-critical):");
  console.log("   HARDHAT_NETWORK:", process.env.HARDHAT_NETWORK || "");
  console.log("   MOCK_USDC_ADDRESS:", process.env.MOCK_USDC_ADDRESS || "");
  console.log(
    "   SPOKE_POLYGON_USDC_ADDRESS (fallback):",
    process.env.SPOKE_POLYGON_USDC_ADDRESS || ""
  );
  console.log(
    "   SESSION_REGISTRY_ADDRESS:",
    process.env.SESSION_REGISTRY_ADDRESS || ""
  );
  console.log("   REGISTRY (alias):", process.env.REGISTRY || "");
  console.log(
    "   NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS:",
    process.env.NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS || ""
  );
  console.log(
    "   TREASURY_ADDRESS:",
    process.env.TREASURY_ADDRESS || "(default=deployer)"
  );
  console.log("   HUB_INBOX_ADDRESS:", process.env.HUB_INBOX_ADDRESS || "");
  console.log("   HUB_OUTBOX_ADDRESS:", process.env.HUB_OUTBOX_ADDRESS || "");
  console.log(
    "   SPOKE_INBOX_ADDRESS (shared):",
    process.env.SPOKE_INBOX_ADDRESS || ""
  );
  console.log(
    "   SPOKE_OUTBOX_ADDRESS (shared):",
    process.env.SPOKE_OUTBOX_ADDRESS || ""
  );
  console.log(
    "   SPOKE_INBOX_ADDRESS_POLYGON:",
    process.env.SPOKE_INBOX_ADDRESS_POLYGON || ""
  );
  console.log(
    "   SPOKE_OUTBOX_ADDRESS_POLYGON:",
    process.env.SPOKE_OUTBOX_ADDRESS_POLYGON || ""
  );
  console.log(
    "   SPOKE_INBOX_ADDRESS_ARBITRUM:",
    process.env.SPOKE_INBOX_ADDRESS_ARBITRUM || ""
  );
  console.log(
    "   SPOKE_OUTBOX_ADDRESS_ARBITRUM:",
    process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM || ""
  );
  console.log(
    "   SPOKE_POLYGON_VAULT_ADDRESS:",
    process.env.SPOKE_POLYGON_VAULT_ADDRESS || ""
  );
  console.log(
    "   SPOKE_POLYGON_USDC_ADDRESS:",
    process.env.SPOKE_POLYGON_USDC_ADDRESS || ""
  );
  console.log(
    "   SPOKE_ARBITRUM_VAULT_ADDRESS:",
    process.env.SPOKE_ARBITRUM_VAULT_ADDRESS || ""
  );
  console.log(
    "   SPOKE_ARBITRUM_USDC_ADDRESS:",
    process.env.SPOKE_ARBITRUM_USDC_ADDRESS || ""
  );

  const contracts = {};

  // ============================================
  // SPOKE-ONLY MODE (Polygon/Arbitrum) — redeploy SpokeVault with active deposit
  // ============================================
  if (isPolygonLike || isArbitrumLike) {
    const TAG = isPolygonLike ? "POLYGON" : "ARBITRUM";
    const usdcEnvKey = `SPOKE_${TAG}_USDC_ADDRESS`;
    const inboxEnvKey = `SPOKE_INBOX_ADDRESS${
      isPolygonLike ? "_POLYGON" : "_ARBITRUM"
    }`;
    const usdc = process.env[usdcEnvKey];
    const inbox =
      process.env[inboxEnvKey] ||
      process.env.SPOKE_INBOX_ADDRESS ||
      process.env.SPOKE_INBOX;
    if (!usdc)
      throw new Error(`${usdcEnvKey} is required to deploy SpokeVault`);
    console.log(`\n🌉 Deploying SpokeVault (${TAG}) with deposit() support...`);
    console.log(`   USDC: ${usdc}`);
    console.log(`   Inbox (BRIDGE_INBOX_ROLE): ${inbox || "(none set)"}`);
    const SpokeVault = await ethers.getContractFactory("SpokeVault");
    const initialAllowed = [usdc];
    const spoke = await SpokeVault.deploy(
      initialAllowed,
      deployer.address,
      inbox || ethers.ZeroAddress
    );
    await spoke.waitForDeployment();
    const spokeAddr = await spoke.getAddress();
    contracts[`SPOKE_${TAG}_VAULT`] = spokeAddr;
    logDeployed(
      `SpokeVault (${TAG})`,
      spokeAddr,
      spoke.deploymentTransaction()?.hash
    );
    if (!inbox) {
      console.log(
        "   ℹ️ No inbox provided; you can later call setBridgeInbox()"
      );
    }
    const outPathSpoke = path.join(
      __dirname,
      `../deployments/${networkName}-spoke-deployment.json`
    );
    fs.mkdirSync(path.dirname(outPathSpoke), { recursive: true });
    fs.writeFileSync(outPathSpoke, JSON.stringify(contracts, null, 2));
    console.log(`\n📝 Saved deployment -> ${outPathSpoke}`);
    console.log("\n✅ Spoke deployment complete.");
    return;
  }

  // Resolve or deploy USDC
  const existingUsdc =
    process.env.MOCK_USDC_ADDRESS || process.env.SPOKE_POLYGON_USDC_ADDRESS; // fallback if reused

  if (existingUsdc) {
    console.log("  ℹ️  Using existing USDC address:", existingUsdc);
    contracts.MOCK_USDC = existingUsdc;
  } else {
    console.log("  1️⃣ Deploying MockUSDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC", deployer);
    const mockUSDC = await MockUSDC.deploy(deployer.address);
    await mockUSDC.waitForDeployment();
    contracts.MOCK_USDC = await mockUSDC.getAddress();
    logDeployed(
      "MockUSDC",
      contracts.MOCK_USDC,
      mockUSDC.deploymentTransaction()?.hash
    );
  }

  // Libraries
  console.log("  2️⃣ Deploying VaultAnalytics...");
  const VaultAnalytics = await ethers.getContractFactory("VaultAnalytics");
  const vaultAnalytics = await VaultAnalytics.deploy();
  await vaultAnalytics.waitForDeployment();
  contracts.VAULT_ANALYTICS = await vaultAnalytics.getAddress();
  logDeployed(
    "VaultAnalytics",
    contracts.VAULT_ANALYTICS,
    vaultAnalytics.deploymentTransaction()?.hash
  );

  console.log("  3️⃣ Deploying PositionManager...");
  const PositionManager = await ethers.getContractFactory("PositionManager");
  const positionManager = await PositionManager.deploy();
  await positionManager.waitForDeployment();
  contracts.POSITION_MANAGER = await positionManager.getAddress();
  logDeployed(
    "PositionManager",
    contracts.POSITION_MANAGER,
    positionManager.deploymentTransaction()?.hash
  );

  // CoreVault
  console.log("  4️⃣ Deploying CoreVault...");
  const CoreVault = await ethers.getContractFactory("CoreVault", {
    libraries: {
      VaultAnalytics: contracts.VAULT_ANALYTICS,
      PositionManager: contracts.POSITION_MANAGER,
    },
  });
  const coreVault = await CoreVault.deploy(
    contracts.MOCK_USDC,
    deployer.address
  );
  await coreVault.waitForDeployment();
  contracts.CORE_VAULT = await coreVault.getAddress();
  logDeployed(
    "CoreVault",
    contracts.CORE_VAULT,
    coreVault.deploymentTransaction()?.hash
  );

  // LiquidationManager
  console.log("  4️⃣b Deploying LiquidationManager...");
  const LiquidationManager = await ethers.getContractFactory(
    "LiquidationManager",
    {
      libraries: {
        VaultAnalytics: contracts.VAULT_ANALYTICS,
        PositionManager: contracts.POSITION_MANAGER,
      },
    }
  );
  const liqMgr = await LiquidationManager.deploy(
    contracts.MOCK_USDC,
    deployer.address
  );
  await liqMgr.waitForDeployment();
  contracts.LIQUIDATION_MANAGER = await liqMgr.getAddress();
  logDeployed(
    "LiquidationManager",
    contracts.LIQUIDATION_MANAGER,
    liqMgr.deploymentTransaction()?.hash
  );
  await coreVault.setLiquidationManager(contracts.LIQUIDATION_MANAGER);
  console.log("     🔧 CoreVault.liquidationManager set");

  // FuturesMarketFactory
  console.log("  5️⃣ Deploying FuturesMarketFactory...");
  const FuturesMarketFactory = await ethers.getContractFactory(
    "FuturesMarketFactory"
  );
  const factory = await FuturesMarketFactory.deploy(
    contracts.CORE_VAULT,
    deployer.address,
    deployer.address
  );
  await factory.waitForDeployment();
  contracts.FUTURES_MARKET_FACTORY = await factory.getAddress();
  logDeployed(
    "FuturesMarketFactory",
    contracts.FUTURES_MARKET_FACTORY,
    factory.deploymentTransaction()?.hash
  );

  // OB facets
  console.log("  5️⃣b Deploying OrderBook facets...");
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
  const MarketLifecycleFacet = await ethers.getContractFactory(
    "MarketLifecycleFacet"
  );
  const MetaTradeFacet = await ethers.getContractFactory("MetaTradeFacet");

  const initFacet = await OrderBookInitFacet.deploy();
  const adminFacet = await OBAdminFacet.deploy();
  const pricingFacet = await OBPricingFacet.deploy();
  const placementFacet = await OBOrderPlacementFacet.deploy();
  const execFacet = await OBTradeExecutionFacet.deploy();
  const liqFacet = await OBLiquidationFacet.deploy();
  const viewFacet = await OBViewFacet.deploy();
  const settlementFacet = await OBSettlementFacet.deploy();
  const lifecycleFacet = await MarketLifecycleFacet.deploy();
  const metaFacet = await MetaTradeFacet.deploy();

  await Promise.all([
    initFacet.waitForDeployment(),
    adminFacet.waitForDeployment(),
    pricingFacet.waitForDeployment(),
    placementFacet.waitForDeployment(),
    execFacet.waitForDeployment(),
    liqFacet.waitForDeployment(),
    viewFacet.waitForDeployment(),
    settlementFacet.waitForDeployment(),
    lifecycleFacet.waitForDeployment(),
    metaFacet.waitForDeployment(),
  ]);

  const initAddr = await initFacet.getAddress();
  const adminAddr = await adminFacet.getAddress();
  const pricingAddr = await pricingFacet.getAddress();
  const placementAddr = await placementFacet.getAddress();
  const execAddr = await execFacet.getAddress();
  const liqAddr = await liqFacet.getAddress();
  const viewAddr = await viewFacet.getAddress();
  const settlementAddr = await settlementFacet.getAddress();
  const lifecycleAddr = await lifecycleFacet.getAddress();
  const metaAddr = await metaFacet.getAddress();
  contracts.MARKET_LIFECYCLE_FACET = lifecycleAddr;

  logDeployed(
    "OrderBookInitFacet",
    initAddr,
    initFacet.deploymentTransaction()?.hash
  );
  logDeployed(
    "OBAdminFacet",
    adminAddr,
    adminFacet.deploymentTransaction()?.hash
  );
  logDeployed(
    "OBPricingFacet",
    pricingAddr,
    pricingFacet.deploymentTransaction()?.hash
  );
  logDeployed(
    "OBOrderPlacementFacet",
    placementAddr,
    placementFacet.deploymentTransaction()?.hash
  );
  logDeployed(
    "OBTradeExecutionFacet",
    execAddr,
    execFacet.deploymentTransaction()?.hash
  );
  logDeployed(
    "OBLiquidationFacet",
    liqAddr,
    liqFacet.deploymentTransaction()?.hash
  );
  logDeployed("OBViewFacet", viewAddr, viewFacet.deploymentTransaction()?.hash);
  logDeployed(
    "OBSettlementFacet",
    settlementAddr,
    settlementFacet.deploymentTransaction()?.hash
  );
  logDeployed(
    "MarketLifecycleFacet",
    lifecycleAddr,
    lifecycleFacet.deploymentTransaction()?.hash
  );
  logDeployed(
    "MetaTradeFacet",
    metaAddr,
    metaFacet.deploymentTransaction()?.hash
  );

  // Factory defaults
  await factory.updateDefaultParameters(10000, 0); // 100% margin, 0 fee

  // Roles on CoreVault
  const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("SETTLEMENT_ROLE")
  );
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  const EXTERNAL_CREDITOR_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE")
  );

  console.log("🔒 Granting roles on CoreVault...");
  await coreVault.grantRole(FACTORY_ROLE, contracts.FUTURES_MARKET_FACTORY);
  await coreVault.grantRole(SETTLEMENT_ROLE, contracts.FUTURES_MARKET_FACTORY);
  // Optional local crediting ability
  if (["localhost", "hardhat"].includes(String(networkName).toLowerCase())) {
    await coreVault.grantRole(EXTERNAL_CREDITOR_ROLE, deployer.address);
  }

  // Set MMR baseline (10% buffer + 10% penalty = 20% cap)
  await coreVault.setMmrParams(1000, 1000, 2000, 0, 1);

  // Create sample ALUMINUM market
  console.log("\n🚀 Creating ALUMINUM market (Diamond)...");
  const marketSymbol = "ALU-USD";
  const metricUrl = "https://www.lme.com/en/metals/non-ferrous/lme-aluminium/";
  const settlementDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const startPrice = ethers.parseUnits("2500", 6);
  const dataSource = "London Metal Exchange";
  const tags = ["COMMODITIES", "METALS", "ALUMINUM"];
  const marginRequirementBps = 10000;
  const tradingFee = 0;

  const cut = [];
  const FacetCutAction = { Add: 0 };
  const selectors = (iface) =>
    iface.fragments
      .filter((f) => f.type === "function")
      .map((f) => ethers.id(f.format("sighash")).slice(0, 10));

  cut.push({
    facetAddress: adminAddr,
    action: FacetCutAction.Add,
    functionSelectors: selectors(adminFacet.interface),
  });
  cut.push({
    facetAddress: pricingAddr,
    action: FacetCutAction.Add,
    functionSelectors: selectors(pricingFacet.interface),
  });
  cut.push({
    facetAddress: placementAddr,
    action: FacetCutAction.Add,
    functionSelectors: selectors(placementFacet.interface),
  });
  cut.push({
    facetAddress: execAddr,
    action: FacetCutAction.Add,
    functionSelectors: selectors(execFacet.interface),
  });
  cut.push({
    facetAddress: liqAddr,
    action: FacetCutAction.Add,
    functionSelectors: selectors(liqFacet.interface),
  });
  cut.push({
    facetAddress: viewAddr,
    action: FacetCutAction.Add,
    functionSelectors: selectors(viewFacet.interface),
  });
  cut.push({
    facetAddress: settlementAddr,
    action: FacetCutAction.Add,
    functionSelectors: selectors(settlementFacet.interface),
  });
  cut.push({
    facetAddress: lifecycleAddr,
    action: FacetCutAction.Add,
    functionSelectors: selectors(lifecycleFacet.interface),
  });
  cut.push({
    facetAddress: metaAddr,
    action: FacetCutAction.Add,
    functionSelectors: selectors(metaFacet.interface),
  });

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
  console.log(`  ✅ Market created  tx: ${createTx.hash}`);

  const event = receipt.logs.find((log) => {
    try {
      const parsed = factory.interface.parseLog(log);
      return parsed.name === "FuturesMarketCreated";
    } catch (_) {
      return false;
    }
  });
  if (!event) throw new Error("Could not parse FuturesMarketCreated event");
  const parsedEvent = factory.interface.parseLog(event);
  contracts.ALUMINUM_ORDERBOOK = parsedEvent.args.orderBook;
  contracts.ALUMINUM_MARKET_ID = parsedEvent.args.marketId;
  console.log("     OrderBook:", contracts.ALUMINUM_ORDERBOOK);
  console.log("     MarketId:", contracts.ALUMINUM_MARKET_ID);

  // Grant roles to OrderBook
  await coreVault.grantRole(ORDERBOOK_ROLE, contracts.ALUMINUM_ORDERBOOK);
  await coreVault.grantRole(SETTLEMENT_ROLE, contracts.ALUMINUM_ORDERBOOK);

  // Wire session registry on the freshly created OrderBook (gasless)
  const registryEnv =
    process.env.SESSION_REGISTRY_ADDRESS ||
    process.env.REGISTRY ||
    process.env.NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS;
  if (registryEnv) {
    try {
      const meta = await ethers.getContractAt(
        "MetaTradeFacet",
        contracts.ALUMINUM_ORDERBOOK
      );
      console.log(
        "  🔗 Setting session registry on OrderBook to:",
        registryEnv
      );
      await meta.setSessionRegistry(registryEnv);
      console.log("     ✅ Session registry wired");
    } catch (e) {
      console.log(
        "     ⚠️  Could not set session registry on OrderBook:",
        e?.message || e
      );
    }
  } else {
    console.log(
      "  ℹ️  Skipping session registry wiring (SESSION_REGISTRY_ADDRESS not set)"
    );
  }

  // Set initial mark price to $1 for bootstrapping
  const actualInitialPrice = ethers.parseUnits("1", 6);
  await coreVault.grantRole(SETTLEMENT_ROLE, deployer.address);
  await coreVault.updateMarkPrice(
    contracts.ALUMINUM_MARKET_ID,
    actualInitialPrice
  );
  console.log("     Initial mark price set to $1.00");

  // ================================
  // Deploy CollateralHub (fresh) and wire to existing spokes
  // ================================
  console.log("\n🏦 Deploying CollateralHub (fresh)...");
  const CollateralHub = await ethers.getContractFactory("CollateralHub");
  const hubAdmin = process.env.COLLATERAL_HUB_ADMIN || deployer.address;
  const hubOperator =
    process.env.CORE_VAULT_OPERATOR_ADDRESS || deployer.address;
  const collateralHub = await CollateralHub.deploy(
    hubAdmin,
    contracts.CORE_VAULT,
    hubOperator
  );
  await collateralHub.waitForDeployment();
  contracts.COLLATERAL_HUB = await collateralHub.getAddress();
  console.log("     ✅ CollateralHub deployed at:", contracts.COLLATERAL_HUB);

  // Grant role on CoreVault to the new CollateralHub
  await coreVault.grantRole(EXTERNAL_CREDITOR_ROLE, contracts.COLLATERAL_HUB);
  console.log("     ✅ Granted EXTERNAL_CREDITOR_ROLE to CollateralHub");

  // Register existing spokes (Polygon, Arbitrum) on the new hub
  const spokePolyVault = process.env.SPOKE_POLYGON_VAULT_ADDRESS;
  const spokePolyUsdc = process.env.SPOKE_POLYGON_USDC_ADDRESS;
  const spokePolyChainId = Number(
    process.env.SPOKE_POLYGON_CHAIN_ID || process.env.SPOKE_CHAIN_ID || 137
  );
  if (spokePolyVault && spokePolyUsdc) {
    try {
      await collateralHub.registerSpoke(spokePolyChainId, {
        spokeVault: spokePolyVault,
        usdc: spokePolyUsdc,
        enabled: true,
      });
      console.log(
        `     ✅ Registered Polygon spoke vault ${spokePolyVault} (chainId=${spokePolyChainId})`
      );
    } catch (e) {
      console.log(
        "     ⚠️  Polygon spoke registration failed:",
        e?.message || e
      );
    }
  } else {
    console.log("     ℹ️  Skipping Polygon spoke registration (env missing)");
  }

  const spokeArbVault = process.env.SPOKE_ARBITRUM_VAULT_ADDRESS;
  const spokeArbUsdc = process.env.SPOKE_ARBITRUM_USDC_ADDRESS;
  const spokeArbChainId = Number(
    process.env.SPOKE_ARBITRUM_CHAIN_ID || process.env.SPOKE_CHAIN_ID || 42161
  );
  if (spokeArbVault && spokeArbUsdc) {
    try {
      await collateralHub.registerSpoke(spokeArbChainId, {
        spokeVault: spokeArbVault,
        usdc: spokeArbUsdc,
        enabled: true,
      });
      console.log(
        `     ✅ Registered Arbitrum spoke vault ${spokeArbVault} (chainId=${spokeArbChainId})`
      );
    } catch (e) {
      console.log(
        "     ⚠️  Arbitrum spoke registration failed:",
        e?.message || e
      );
    }
  } else {
    console.log("     ℹ️  Skipping Arbitrum spoke registration (env missing)");
  }

  // ================================
  // Hub Wormhole remote-app mappings (reuse existing inbox/outbox + spokes)
  // ================================
  const hubInboxAddr = process.env.HUB_INBOX_ADDRESS;
  const hubOutboxAddr = process.env.HUB_OUTBOX_ADDRESS;

  function toBytes32Address(addr) {
    if (!addr) return "0x" + "00".repeat(32);
    const hex = addr.toLowerCase().replace(/^0x/, "");
    if (hex.length !== 40) throw new Error(`Invalid EVM address: ${addr}`);
    return "0x" + "0".repeat(24) + hex;
  }

  // Hub Wormhole remote-app mappings (reuse existing inbox/outbox + spokes)
  if (hubInboxAddr && hubOutboxAddr) {
    try {
      console.log(
        "  🔗 Wiring hub inbox/outbox remote apps (reuse existing bridge)..."
      );
      const hubInbox = await ethers.getContractAt(
        "HubBridgeInboxWormhole",
        hubInboxAddr
      );
      const hubOutbox = await ethers.getContractAt(
        "HubBridgeOutboxWormhole",
        hubOutboxAddr
      );

      const domainPolygon = process.env.BRIDGE_DOMAIN_POLYGON;
      const remoteAppPolygon =
        process.env.BRIDGE_REMOTE_APP_POLYGON ||
        (process.env.SPOKE_OUTBOX_ADDRESS_POLYGON
          ? toBytes32Address(process.env.SPOKE_OUTBOX_ADDRESS_POLYGON)
          : process.env.SPOKE_OUTBOX_ADDRESS
          ? toBytes32Address(process.env.SPOKE_OUTBOX_ADDRESS)
          : null);
      if (domainPolygon && remoteAppPolygon) {
        await hubInbox.setRemoteApp(Number(domainPolygon), remoteAppPolygon);
        console.log(
          `     ✅ HUB_INBOX: set POLYGON remote app ${remoteAppPolygon}`
        );
      }
      const polygonInbox = process.env.SPOKE_INBOX_ADDRESS_POLYGON
        ? toBytes32Address(process.env.SPOKE_INBOX_ADDRESS_POLYGON)
        : process.env.SPOKE_INBOX_ADDRESS
        ? toBytes32Address(process.env.SPOKE_INBOX_ADDRESS)
        : null;
      if (domainPolygon && polygonInbox) {
        await hubOutbox.setRemoteApp(Number(domainPolygon), polygonInbox);
        console.log(`     ✅ HUB_OUTBOX: set POLYGON inbox ${polygonInbox}`);
      }

      const domainArbitrum = process.env.BRIDGE_DOMAIN_ARBITRUM;
      const remoteAppArbitrum =
        process.env.BRIDGE_REMOTE_APP_ARBITRUM ||
        (process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM
          ? toBytes32Address(process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM)
          : null);
      if (domainArbitrum && remoteAppArbitrum) {
        await hubInbox.setRemoteApp(Number(domainArbitrum), remoteAppArbitrum);
        console.log(
          `     ✅ HUB_INBOX: set ARBITRUM remote app ${remoteAppArbitrum}`
        );
      }
      const arbitrumInbox = process.env.SPOKE_INBOX_ADDRESS_ARBITRUM
        ? toBytes32Address(process.env.SPOKE_INBOX_ADDRESS_ARBITRUM)
        : null;
      if (domainArbitrum && arbitrumInbox) {
        await hubOutbox.setRemoteApp(Number(domainArbitrum), arbitrumInbox);
        console.log(`     ✅ HUB_OUTBOX: set ARBITRUM inbox ${arbitrumInbox}`);
      }

      console.log("     ✅ Hub bridge wiring complete");
    } catch (e) {
      console.log(
        "     ⚠️  Hub bridge wiring failed (inbox/outbox):",
        e?.message || e
      );
    }
  } else {
    console.log(
      "  ℹ️  HUB_INBOX_ADDRESS/HUB_OUTBOX_ADDRESS not set; skipping bridge wiring"
    );
  }

  // Persist deployment
  const outPath = path.join(
    __dirname,
    `../deployments/${networkName}-refactor-deployment.json`
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(contracts, null, 2));
  console.log(`\n📝 Saved deployment -> ${outPath}`);

  console.log("\n✅ Refactor deploy complete (HyperLiquid-only).");
}

main().catch((err) => {
  console.error("❌ Deployment failed:", err);
  process.exit(1);
});









