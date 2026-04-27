/**
 * Deploy fresh CoreVault infrastructure on Hyperliquid
 * Resets all user state (collateral, positions, margins)
 * 
 * REUSED (stateless):
 *   - Libraries (VaultAnalytics, PositionManager)
 *   - Managers (VaultViewsManager, SettlementManager, LiquidationManager)
 *   - Diamond Facets (all OB* facets, MarketLifecycleFacet, etc.)
 * 
 * FRESH DEPLOYMENT (stateful or points to CoreVault):
 *   - CoreVault (holds user balances, positions, margins)
 *   - CollateralHub (points to CoreVault, holds processed deposit/withdraw IDs)
 *   - FuturesMarketFactoryV2 (points to CoreVault)
 *   - MarketBondManager (points to CoreVault)
 *   - GlobalSessionRegistry (holds session state)
 *   - FeeRegistry, FacetRegistry (new factory infrastructure)
 * 
 * Run: npx hardhat run scripts/deploy-hyperliquid-fresh.js --network hyperliquid
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🚀 HYPERLIQUID FRESH DEPLOYMENT - RESET STATE");
  console.log("═".repeat(80));

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const network = await ethers.provider.getNetwork();

  console.log(`\n🌐 Network: hyperliquid (Chain ID: ${network.chainId})`);
  console.log(`📋 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

  // Configuration - read from .env.local (source of truth)
  const HYPERLIQUID_USDC = process.env.MOCK_USDC_ADDRESS || "0x2343A6Ad12D0d1091C45b166901B25a281D3eD9D";
  const TREASURY = process.env.TREASURY_ADDRESS || deployer.address;

  // Existing contract addresses from .env.local (stateless contracts to reuse)
  const existingContracts = {
    // Libraries
    VAULT_ANALYTICS: process.env.VAULT_ANALYTICS_ADDRESS,
    POSITION_MANAGER: process.env.POSITION_MANAGER_ADDRESS,
    // Managers (delegatecall targets)
    VAULT_VIEWS_MANAGER: process.env.VAULT_VIEWS_MANAGER_ADDRESS,
    SETTLEMENT_MANAGER: process.env.SETTLEMENT_MANAGER_ADDRESS,
    LIQUIDATION_MANAGER: process.env.LIQUIDATION_MANAGER_ADDRESS,
    // Facets
    ORDER_BOOK_INIT_FACET: process.env.ORDER_BOOK_INIT_FACET,
    OB_ADMIN_FACET: process.env.OB_ADMIN_FACET,
    OB_PRICING_FACET: process.env.OB_PRICING_FACET,
    OB_ORDER_PLACEMENT_FACET: process.env.OB_ORDER_PLACEMENT_FACET,
    OB_TRADE_EXECUTION_FACET: process.env.OB_TRADE_EXECUTION_FACET,
    OB_LIQUIDATION_FACET: process.env.OB_LIQUIDATION_FACET,
    OB_VIEW_FACET: process.env.OB_VIEW_FACET,
    OB_SETTLEMENT_FACET: process.env.OB_SETTLEMENT_FACET,
    OB_BATCH_SETTLEMENT_FACET: process.env.OB_BATCH_SETTLEMENT_FACET,
    MARKET_LIFECYCLE_FACET: process.env.MARKET_LIFECYCLE_FACET,
    META_TRADE_FACET: process.env.META_TRADE_FACET,
    ORDERBOOK_VAULT_FACET: process.env.ORDERBOOK_VAULT_FACET,
  };

  console.log(`✅ Loading existing contract addresses from .env.local`);

  const contracts = {};
  const facetAddresses = {};

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1: VALIDATE ENVIRONMENT
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 PHASE 1: ENVIRONMENT VALIDATION");
  console.log("─".repeat(60));

  // Validate USDC token
  const usdc = await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol:IERC20Metadata",
    HYPERLIQUID_USDC
  );
  try {
    const decimals = await usdc.decimals();
    const symbol = await usdc.symbol();
    console.log(`✅ Collateral token: ${symbol} (${decimals} decimals) at ${HYPERLIQUID_USDC}`);
    if (decimals !== 6n) {
      throw new Error(`Expected 6 decimals, got ${decimals}`);
    }
  } catch (e) {
    console.log(`⚠️  Could not verify token at ${HYPERLIQUID_USDC}: ${e.message}`);
    console.log(`   Proceeding anyway (token may be MockUSDC)`);
  }

  console.log(`\n📋 Configuration:`);
  console.log(`   Treasury: ${TREASURY}`);
  console.log(`   Collateral Token: ${HYPERLIQUID_USDC}`);

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: CORE INFRASTRUCTURE
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 PHASE 2: CORE INFRASTRUCTURE");
  console.log("─".repeat(60));

  // 2.1 Libraries (reuse from .env.local - stateless)
  console.log("\n  2.1 Libraries (stateless - reuse from .env.local)...");
  
  async function reuseOrDeploy(name, existingAddress, factory) {
    if (existingAddress) {
      const code = await ethers.provider.getCode(existingAddress);
      if (code !== "0x") {
        console.log(`     ♻️  Reusing ${name}: ${existingAddress}`);
        return existingAddress;
      }
      console.log(`     ⚠️  ${name} at ${existingAddress} has no code, deploying fresh`);
    }
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    console.log(`     ✅ Deployed ${name}: ${addr}`);
    return addr;
  }

  const VaultAnalytics = await ethers.getContractFactory("VaultAnalytics");
  contracts.VAULT_ANALYTICS = await reuseOrDeploy("VaultAnalytics", existingContracts.VAULT_ANALYTICS, VaultAnalytics);

  const PositionManager = await ethers.getContractFactory("PositionManager");
  contracts.POSITION_MANAGER = await reuseOrDeploy("PositionManager", existingContracts.POSITION_MANAGER, PositionManager);

  // 2.2 Deploy CoreVault (UUPS)
  console.log("\n  2.2 Deploying CoreVault (UUPS)...");

  const CoreVault = await ethers.getContractFactory("CoreVault", {
    libraries: {
      PositionManager: contracts.POSITION_MANAGER,
    },
  });

  // Deploy implementation
  const coreVaultImpl = await CoreVault.deploy(HYPERLIQUID_USDC);
  await coreVaultImpl.waitForDeployment();
  contracts.CORE_VAULT_IMPL = await coreVaultImpl.getAddress();
  console.log(`     ✅ CoreVault Implementation: ${contracts.CORE_VAULT_IMPL}`);

  // Deploy proxy
  const initData = CoreVault.interface.encodeFunctionData("initialize", [deployer.address]);
  const ERC1967Proxy = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await ERC1967Proxy.deploy(contracts.CORE_VAULT_IMPL, initData);
  await proxy.waitForDeployment();
  contracts.CORE_VAULT = await proxy.getAddress();
  console.log(`     ✅ CoreVault Proxy: ${contracts.CORE_VAULT}`);

  const coreVault = CoreVault.attach(contracts.CORE_VAULT);

  // 2.3 Delegatecall Targets (stateless - reuse from .env.local)
  console.log("\n  2.3 Delegatecall Targets (stateless - reuse from .env.local)...");

  // Reuse existing managers from .env.local (they're stateless delegatecall targets)
  const existingVVM = existingContracts.VAULT_VIEWS_MANAGER;
  const existingSM = existingContracts.SETTLEMENT_MANAGER;
  const existingLM = existingContracts.LIQUIDATION_MANAGER;

  if (existingVVM && (await ethers.provider.getCode(existingVVM)) !== "0x") {
    contracts.VAULT_VIEWS_MANAGER = existingVVM;
    console.log(`     ♻️  Reusing VaultViewsManager: ${existingVVM}`);
  } else {
    const VaultViewsManager = await ethers.getContractFactory("VaultViewsManager", {
      libraries: { VaultAnalytics: contracts.VAULT_ANALYTICS },
    });
    const vaultViewsManager = await VaultViewsManager.deploy();
    await vaultViewsManager.waitForDeployment();
    contracts.VAULT_VIEWS_MANAGER = await vaultViewsManager.getAddress();
    console.log(`     ✅ Deployed VaultViewsManager: ${contracts.VAULT_VIEWS_MANAGER}`);
  }

  if (existingSM && (await ethers.provider.getCode(existingSM)) !== "0x") {
    contracts.SETTLEMENT_MANAGER = existingSM;
    console.log(`     ♻️  Reusing SettlementManager: ${existingSM}`);
  } else {
    const SettlementManager = await ethers.getContractFactory("SettlementManager", {
      libraries: { PositionManager: contracts.POSITION_MANAGER },
    });
    const settlementManager = await SettlementManager.deploy();
    await settlementManager.waitForDeployment();
    contracts.SETTLEMENT_MANAGER = await settlementManager.getAddress();
    console.log(`     ✅ Deployed SettlementManager: ${contracts.SETTLEMENT_MANAGER}`);
  }

  if (existingLM && (await ethers.provider.getCode(existingLM)) !== "0x") {
    contracts.LIQUIDATION_MANAGER = existingLM;
    console.log(`     ♻️  Reusing LiquidationManager: ${existingLM}`);
  } else {
    const LiquidationManager = await ethers.getContractFactory("LiquidationManager", {
      libraries: { PositionManager: contracts.POSITION_MANAGER },
    });
    const liquidationManager = await LiquidationManager.deploy();
    await liquidationManager.waitForDeployment();
    contracts.LIQUIDATION_MANAGER = await liquidationManager.getAddress();
    console.log(`     ✅ Deployed LiquidationManager: ${contracts.LIQUIDATION_MANAGER}`);
  }

  // 2.4 Wire managers
  console.log("\n  2.4 Wiring Managers into CoreVault...");
  let tx = await coreVault.setViewsManager(contracts.VAULT_VIEWS_MANAGER);
  await tx.wait();
  tx = await coreVault.setSettlementManager(contracts.SETTLEMENT_MANAGER);
  await tx.wait();
  tx = await coreVault.setLiquidationManager(contracts.LIQUIDATION_MANAGER);
  await tx.wait();
  console.log(`     ✅ All managers configured`);

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 3: DIAMOND FACETS (reuse where possible)
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 PHASE 3: DIAMOND FACETS");
  console.log("─".repeat(60));

  const facetNames = [
    "OrderBookInitFacet",
    "OBAdminFacet",
    "OBAdminViewFacet",
    "OBPricingFacet",
    "OBOrderPlacementFacet",
    "OBTradeExecutionFacet",
    "OBLiquidationFacet",
    "OBViewFacet",
    "OBSettlementFacet",
    "OBBatchSettlementFacet",
    "OBMaintenanceFacet",
    "MarketLifecycleFacet",
    "MetaTradeFacet",
    "OrderBookVaultAdminFacet",
  ];

  // Map contract names to .env.local keys
  const facetEnvMap = {
    "OrderBookInitFacet": "ORDER_BOOK_INIT_FACET",
    "OBAdminFacet": "OB_ADMIN_FACET",
    "OBAdminViewFacet": "OB_ADMIN_VIEW_FACET",  // Not in .env.local
    "OBPricingFacet": "OB_PRICING_FACET",
    "OBOrderPlacementFacet": "OB_ORDER_PLACEMENT_FACET",
    "OBTradeExecutionFacet": "OB_TRADE_EXECUTION_FACET",
    "OBLiquidationFacet": "OB_LIQUIDATION_FACET",
    "OBViewFacet": "OB_VIEW_FACET",
    "OBSettlementFacet": "OB_SETTLEMENT_FACET",
    "OBBatchSettlementFacet": "OB_BATCH_SETTLEMENT_FACET",
    "OBMaintenanceFacet": "OB_MAINTENANCE_FACET",  // Not in .env.local
    "MarketLifecycleFacet": "MARKET_LIFECYCLE_FACET",
    "MetaTradeFacet": "META_TRADE_FACET",
    "OrderBookVaultAdminFacet": "ORDERBOOK_VAULT_FACET",
  };

  for (const facetName of facetNames) {
    const envKey = facetEnvMap[facetName];
    let existingAddress = existingContracts[envKey];

    // Verify existing contract has code
    if (existingAddress) {
      const code = await ethers.provider.getCode(existingAddress);
      if (code === "0x") {
        console.log(`  ⚠️  ${facetName} at ${existingAddress} has no code, deploying fresh`);
        existingAddress = null;
      }
    }

    if (existingAddress) {
      facetAddresses[facetName] = existingAddress;
      console.log(`  ♻️  Reusing ${facetName}: ${existingAddress}`);
    } else {
      try {
        const Facet = await ethers.getContractFactory(facetName);
        const facet = await Facet.deploy();
        await facet.waitForDeployment();
        facetAddresses[facetName] = await facet.getAddress();
        console.log(`  ✅ Deployed ${facetName}: ${facetAddresses[facetName]}`);
      } catch (e) {
        console.log(`  ⚠️  Could not deploy ${facetName}: ${e.message}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 4: FACTORY INFRASTRUCTURE
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 PHASE 4: FACTORY INFRASTRUCTURE");
  console.log("─".repeat(60));

  // Fee configuration
  const takerFeeBps = parseInt(process.env.TAKER_FEE_BPS || "7");
  const makerFeeBps = parseInt(process.env.MAKER_FEE_BPS || "3");
  const protocolFeeShareBps = parseInt(process.env.PROTOCOL_FEE_SHARE_BPS || "8000");

  // 4.1 FeeRegistry
  console.log("\n  4.1 Deploying FeeRegistry...");
  const FeeRegistry = await ethers.getContractFactory("FeeRegistry");
  const feeRegistry = await FeeRegistry.deploy(
    deployer.address,    // admin
    takerFeeBps,         // taker fee (0.07%)
    makerFeeBps,         // maker fee (0.03%)
    TREASURY,            // protocol fee recipient
    protocolFeeShareBps  // protocol share (80%)
  );
  await feeRegistry.waitForDeployment();
  contracts.FEE_REGISTRY = await feeRegistry.getAddress();
  console.log(`     ✅ FeeRegistry: ${contracts.FEE_REGISTRY}`);
  console.log(`        Taker: ${takerFeeBps}bps, Maker: ${makerFeeBps}bps, Protocol: ${protocolFeeShareBps}bps`);

  // 4.2 FacetRegistry
  console.log("\n  4.2 Deploying FacetRegistry...");
  const FacetRegistry = await ethers.getContractFactory("FacetRegistry");
  const facetRegistry = await FacetRegistry.deploy(deployer.address);
  await facetRegistry.waitForDeployment();
  contracts.FACET_REGISTRY = await facetRegistry.getAddress();
  console.log(`     ✅ FacetRegistry: ${contracts.FACET_REGISTRY}`);

  // 4.3 Register facets
  console.log("\n  4.3 Registering facets...");
  const facetsToRegister = Object.entries(facetAddresses).filter(([name]) => name !== "OrderBookInitFacet");
  
  for (const [name, address] of facetsToRegister) {
    try {
      const facetContract = await ethers.getContractAt(name, address);
      const selectors = Object.keys(facetContract.interface.fragments)
        .filter(key => facetContract.interface.fragments[key].type === "function")
        .map(key => facetContract.interface.getFunction(key).selector);
      
      if (selectors.length > 0) {
        tx = await facetRegistry.registerFacet(address, selectors);
        await tx.wait();
        console.log(`     ✅ Registered ${name}: ${selectors.length} selectors`);
      }
    } catch (e) {
      console.log(`     ⚠️  Could not register ${name}: ${e.message}`);
    }
  }

  // 4.3b Set FeeRegistry on FacetRegistry
  console.log("\n  4.3b Setting FeeRegistry on FacetRegistry...");
  tx = await facetRegistry.setFeeRegistry(contracts.FEE_REGISTRY);
  await tx.wait();
  console.log(`     ✅ FacetRegistry.feeRegistry set`);

  // 4.4 FuturesMarketFactoryV2
  console.log("\n  4.4 Deploying FuturesMarketFactoryV2...");
  const FuturesMarketFactoryV2 = await ethers.getContractFactory("FuturesMarketFactoryV2");
  const factory = await FuturesMarketFactoryV2.deploy(
    deployer.address,           // admin
    contracts.CORE_VAULT,       // coreVault
    contracts.FACET_REGISTRY,   // facetRegistry
    TREASURY                    // feeRecipient
  );
  await factory.waitForDeployment();
  contracts.FUTURES_MARKET_FACTORY = await factory.getAddress();
  console.log(`     ✅ FuturesMarketFactoryV2: ${contracts.FUTURES_MARKET_FACTORY}`);

  // Configure factory
  tx = await factory.setFacetRegistry(contracts.FACET_REGISTRY);
  await tx.wait();
  if (facetAddresses.OrderBookInitFacet) {
    tx = await factory.setInitFacet(facetAddresses.OrderBookInitFacet);
    await tx.wait();
  }
  console.log(`     ✅ Factory configured`);

  // 4.5 MarketBondManager
  console.log("\n  4.5 Deploying MarketBondManager...");
  const MarketBondManager = await ethers.getContractFactory("MarketBondManager");
  const bondManager = await MarketBondManager.deploy(
    contracts.CORE_VAULT,
    contracts.FUTURES_MARKET_FACTORY
  );
  await bondManager.waitForDeployment();
  contracts.MARKET_BOND_MANAGER = await bondManager.getAddress();
  console.log(`     ✅ MarketBondManager: ${contracts.MARKET_BOND_MANAGER}`);

  tx = await factory.setBondManager(contracts.MARKET_BOND_MANAGER);
  await tx.wait();
  console.log(`     ✅ BondManager set on factory`);

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 5: SESSION REGISTRY
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 PHASE 5: SESSION REGISTRY");
  console.log("─".repeat(60));

  const GlobalSessionRegistry = await ethers.getContractFactory("GlobalSessionRegistry");
  const sessionRegistry = await GlobalSessionRegistry.deploy(deployer.address);
  await sessionRegistry.waitForDeployment();
  contracts.GLOBAL_SESSION_REGISTRY = await sessionRegistry.getAddress();
  console.log(`  ✅ GlobalSessionRegistry: ${contracts.GLOBAL_SESSION_REGISTRY}`);

  tx = await coreVault.setSessionRegistry(contracts.GLOBAL_SESSION_REGISTRY);
  await tx.wait();
  console.log(`  ✅ SessionRegistry set on CoreVault`);

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 6: COLLATERAL HUB (Cross-Chain)
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 PHASE 6: COLLATERAL HUB");
  console.log("─".repeat(60));

  const CollateralHub = await ethers.getContractFactory("CollateralHub");
  const collateralHub = await CollateralHub.deploy(
    deployer.address,      // admin
    contracts.CORE_VAULT,  // coreVault
    deployer.address       // operator (pool account)
  );
  await collateralHub.waitForDeployment();
  contracts.COLLATERAL_HUB = await collateralHub.getAddress();
  console.log(`  ✅ CollateralHub: ${contracts.COLLATERAL_HUB}`);

  // Grant EXTERNAL_CREDITOR_ROLE to CollateralHub
  const EXTERNAL_CREDITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE"));
  tx = await coreVault.grantRole(EXTERNAL_CREDITOR_ROLE, contracts.COLLATERAL_HUB);
  await tx.wait();
  console.log(`  ✅ EXTERNAL_CREDITOR_ROLE granted to CollateralHub`);

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 7: AUTHORIZATION
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 PHASE 7: AUTHORIZATION");
  console.log("─".repeat(60));

  const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));

  tx = await coreVault.grantRole(FACTORY_ROLE, contracts.FUTURES_MARKET_FACTORY);
  await tx.wait();
  console.log(`  ✅ FACTORY_ROLE granted to FuturesMarketFactoryV2`);

  tx = await coreVault.grantRole(SETTLEMENT_ROLE, contracts.FUTURES_MARKET_FACTORY);
  await tx.wait();
  console.log(`  ✅ SETTLEMENT_ROLE granted to FuturesMarketFactoryV2`);

  tx = await coreVault.grantRole(SETTLEMENT_ROLE, contracts.MARKET_BOND_MANAGER);
  await tx.wait();
  console.log(`  ✅ SETTLEMENT_ROLE granted to MarketBondManager`);

  // Set MMR parameters
  tx = await coreVault.setMMRParams(500, 10000); // 5% MMR, 100% liquidation penalty
  await tx.wait();
  console.log(`  ✅ MMR parameters set (5%, 100%)`);

  // ═══════════════════════════════════════════════════════════════════
  // SAVE DEPLOYMENT
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 SAVING DEPLOYMENT");
  console.log("─".repeat(60));

  const deployment = {
    timestamp: new Date().toISOString(),
    network: "hyperliquid",
    chainId: Number(network.chainId),
    deployer: deployer.address,
    collateralToken: HYPERLIQUID_USDC,
    contracts: {
      ...contracts,
      ...Object.fromEntries(
        Object.entries(facetAddresses).map(([k, v]) => [k.replace(/([A-Z])/g, '_$1').toUpperCase().slice(1), v])
      ),
    },
    facets: facetAddresses,
    feeConfig: { takerFeeBps, makerFeeBps, protocolFeeShareBps },
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const outputPath = path.join(deploymentsDir, "hyperliquid-fresh-deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));
  console.log(`✅ Saved to: ${outputPath}`);

  // Summary
  console.log("\n" + "═".repeat(80));
  console.log("✅ HYPERLIQUID DEPLOYMENT COMPLETE");
  console.log("═".repeat(80));
  console.log(`
📋 Core Infrastructure:
   CoreVault (Proxy):     ${contracts.CORE_VAULT}
   CoreVault (Impl):      ${contracts.CORE_VAULT_IMPL}
   CollateralHub:         ${contracts.COLLATERAL_HUB}
   FuturesMarketFactoryV2: ${contracts.FUTURES_MARKET_FACTORY}
   FacetRegistry:         ${contracts.FACET_REGISTRY}
   FeeRegistry:           ${contracts.FEE_REGISTRY}
   MarketBondManager:     ${contracts.MARKET_BOND_MANAGER}
   GlobalSessionRegistry: ${contracts.GLOBAL_SESSION_REGISTRY}

🔧 Next Steps:
   1. Deploy SpokeVault on Arbitrum (if not done):
      npx hardhat run scripts/deploy-arbitrum-spoke.js --network arbitrum
   
   2. Register Arbitrum spoke on CollateralHub:
      collateralHub.registerSpoke(42161, {
        spokeVault: <arbitrum_spoke_address>,
        usdc: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
        enabled: true
      })
   
   3. Set bridge inbox on Arbitrum SpokeVault
   
   4. Update .env.local with new contract addresses
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ DEPLOYMENT FAILED:", error.message);
    console.error(error);
    process.exit(1);
  });
