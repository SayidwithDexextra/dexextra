/**
 * Continue Hyperliquid deployment from Phase 4 onwards
 * Uses already-deployed CoreVault and existing facets from .env.local
 * 
 * Run: npx hardhat run scripts/deploy-hyperliquid-continue.js --network hyperliquid
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🚀 HYPERLIQUID DEPLOYMENT - CONTINUATION FROM PHASE 4");
  console.log("═".repeat(80));

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const network = await ethers.provider.getNetwork();

  console.log(`\n🌐 Network: hyperliquid (Chain ID: ${network.chainId})`);
  console.log(`📋 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

  // Use existing CoreVault from .env.local (deployed in previous run)
  const CORE_VAULT = process.env.CORE_VAULT_ADDRESS;
  const TREASURY = process.env.TREASURY_ADDRESS || deployer.address;

  if (!CORE_VAULT) {
    throw new Error("CORE_VAULT_ADDRESS not found in .env.local");
  }

  console.log(`\n✅ Using existing CoreVault: ${CORE_VAULT}`);

  // Existing facet addresses from .env.local
  const facetAddresses = {
    OrderBookInitFacet: process.env.ORDER_BOOK_INIT_FACET,
    OBAdminFacet: process.env.OB_ADMIN_FACET,
    OBPricingFacet: process.env.OB_PRICING_FACET,
    OBOrderPlacementFacet: process.env.OB_ORDER_PLACEMENT_FACET,
    OBTradeExecutionFacet: process.env.OB_TRADE_EXECUTION_FACET,
    OBLiquidationFacet: process.env.OB_LIQUIDATION_FACET,
    OBViewFacet: process.env.OB_VIEW_FACET,
    OBSettlementFacet: process.env.OB_SETTLEMENT_FACET,
    OBBatchSettlementFacet: process.env.OB_BATCH_SETTLEMENT_FACET,
    MarketLifecycleFacet: process.env.MARKET_LIFECYCLE_FACET,
    MetaTradeFacet: process.env.META_TRADE_FACET,
    OrderBookVaultAdminFacet: process.env.ORDERBOOK_VAULT_FACET,
  };

  console.log(`\n📋 Facets from .env.local:`);
  for (const [name, addr] of Object.entries(facetAddresses)) {
    if (addr) console.log(`   ${name}: ${addr}`);
  }

  const contracts = { CORE_VAULT };

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
    deployer.address,
    takerFeeBps,
    makerFeeBps,
    TREASURY,
    protocolFeeShareBps
  );
  await feeRegistry.waitForDeployment();
  contracts.FEE_REGISTRY = await feeRegistry.getAddress();
  console.log(`     ✅ FeeRegistry: ${contracts.FEE_REGISTRY}`);

  // 4.2 FacetRegistry
  console.log("\n  4.2 Deploying FacetRegistry...");
  const FacetRegistry = await ethers.getContractFactory("FacetRegistry");
  const facetRegistry = await FacetRegistry.deploy(deployer.address);
  await facetRegistry.waitForDeployment();
  contracts.FACET_REGISTRY = await facetRegistry.getAddress();
  console.log(`     ✅ FacetRegistry: ${contracts.FACET_REGISTRY}`);

  // 4.3 Register facets
  console.log("\n  4.3 Registering facets...");
  const facetsToRegister = Object.entries(facetAddresses).filter(
    ([name, addr]) => addr && name !== "OrderBookInitFacet"
  );

  for (const [name, address] of facetsToRegister) {
    try {
      const facetContract = await ethers.getContractAt(name, address);
      // Get all function selectors from the interface
      const selectors = facetContract.interface.fragments
        .filter(f => f.type === "function")
        .map(f => facetContract.interface.getFunction(f.name).selector);

      if (selectors.length > 0) {
        const tx = await facetRegistry.registerFacet(address, selectors);
        await tx.wait();
        console.log(`     ✅ Registered ${name}: ${selectors.length} selectors`);
      }
    } catch (e) {
      console.log(`     ⚠️  Could not register ${name}: ${e.message}`);
    }
  }

  // 4.3b Set FeeRegistry on FacetRegistry
  console.log("\n  4.3b Setting FeeRegistry on FacetRegistry...");
  let tx = await facetRegistry.setFeeRegistry(contracts.FEE_REGISTRY);
  await tx.wait();
  console.log(`     ✅ FacetRegistry.feeRegistry set`);

  // 4.4 FuturesMarketFactoryV2
  console.log("\n  4.4 Deploying FuturesMarketFactoryV2...");
  const FuturesMarketFactoryV2 = await ethers.getContractFactory("FuturesMarketFactoryV2");
  // Constructor: (_vault, _admin, _feeRecipient)
  const factory = await FuturesMarketFactoryV2.deploy(
    CORE_VAULT,          // _vault
    deployer.address,    // _admin
    TREASURY             // _feeRecipient
  );
  await factory.waitForDeployment();
  contracts.FUTURES_MARKET_FACTORY = await factory.getAddress();
  console.log(`     ✅ FuturesMarketFactoryV2: ${contracts.FUTURES_MARKET_FACTORY}`);

  // Configure factory with facet registry
  tx = await factory.setFacetRegistry(contracts.FACET_REGISTRY);
  await tx.wait();
  console.log(`     ✅ FacetRegistry set on factory`);
  
  if (facetAddresses.OrderBookInitFacet) {
    tx = await factory.setInitFacet(facetAddresses.OrderBookInitFacet);
    await tx.wait();
    console.log(`     ✅ InitFacet set on factory`);
  }

  // 4.5 MarketBondManager
  console.log("\n  4.5 Deploying MarketBondManager...");
  const MarketBondManager = await ethers.getContractFactory("MarketBondManager");
  const bondManager = await MarketBondManager.deploy(CORE_VAULT, contracts.FUTURES_MARKET_FACTORY);
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

  // Get CoreVault contract to set session registry
  const coreVault = await ethers.getContractAt("CoreVault", CORE_VAULT);
  tx = await coreVault.setSessionRegistry(contracts.GLOBAL_SESSION_REGISTRY);
  await tx.wait();
  console.log(`  ✅ SessionRegistry set on CoreVault`);

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 6: COLLATERAL HUB
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 PHASE 6: COLLATERAL HUB");
  console.log("─".repeat(60));

  const CollateralHub = await ethers.getContractFactory("CollateralHub");
  const collateralHub = await CollateralHub.deploy(
    deployer.address,
    CORE_VAULT,
    deployer.address
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
  tx = await coreVault.setMMRParams(500, 10000);
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
    contracts,
    facets: facetAddresses,
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  const outputPath = path.join(deploymentsDir, "hyperliquid-real-usdc-deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));
  console.log(`✅ Saved to: ${outputPath}`);

  // Summary
  console.log("\n" + "═".repeat(80));
  console.log("✅ HYPERLIQUID DEPLOYMENT COMPLETE");
  console.log("═".repeat(80));
  console.log(`
📋 Deployed Contracts:
   CoreVault:             ${CORE_VAULT}
   CollateralHub:         ${contracts.COLLATERAL_HUB}
   FuturesMarketFactoryV2: ${contracts.FUTURES_MARKET_FACTORY}
   FacetRegistry:         ${contracts.FACET_REGISTRY}
   FeeRegistry:           ${contracts.FEE_REGISTRY}
   MarketBondManager:     ${contracts.MARKET_BOND_MANAGER}
   GlobalSessionRegistry: ${contracts.GLOBAL_SESSION_REGISTRY}

🔧 Next Steps:
   1. Update .env.local with new contract addresses
   2. Deploy SpokeVault on Arbitrum
   3. Register Arbitrum spoke on CollateralHub
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ DEPLOYMENT FAILED:", error.message);
    console.error(error);
    process.exit(1);
  });
