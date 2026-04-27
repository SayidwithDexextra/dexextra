/**
 * Continue Hyperliquid deployment from Phase 4.4 onwards
 * Uses already-deployed: CoreVault, FeeRegistry, FacetRegistry (with registered facets)
 * 
 * Run: npx hardhat run scripts/deploy-hyperliquid-continue-4.4.js --network hyperliquid
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🚀 HYPERLIQUID DEPLOYMENT - CONTINUATION FROM PHASE 4.4");
  console.log("═".repeat(80));

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const network = await ethers.provider.getNetwork();

  console.log(`\n🌐 Network: hyperliquid (Chain ID: ${network.chainId})`);
  console.log(`📋 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

  // Already deployed contracts
  const CORE_VAULT = "0x13C0EE284eF74E10A6442077718D57e2C50Ee88F";
  const FEE_REGISTRY = "0xee410D42623c041C946732755a854d5fBc0539Cb";
  const FACET_REGISTRY = "0x8B4188ba820F0cffE2ef77900F818DEFC8Ec743D";
  const TREASURY = deployer.address;
  
  // OrderBookInitFacet from .env.local
  const ORDER_BOOK_INIT_FACET = process.env.ORDER_BOOK_INIT_FACET || "0x6117F19a4e7Fe0a25D0697BC5a47c2FaDb028755";

  console.log(`\n✅ Using existing contracts:`);
  console.log(`   CoreVault:     ${CORE_VAULT}`);
  console.log(`   FeeRegistry:   ${FEE_REGISTRY}`);
  console.log(`   FacetRegistry: ${FACET_REGISTRY}`);

  const contracts = { 
    CORE_VAULT, 
    FEE_REGISTRY, 
    FACET_REGISTRY 
  };

  // Get CoreVault contract instance
  const coreVault = await ethers.getContractAt("CoreVault", CORE_VAULT);

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 4.4: FUTURES MARKET FACTORY V2
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 PHASE 4.4: FUTURES MARKET FACTORY V2");
  console.log("─".repeat(60));

  const FuturesMarketFactoryV2 = await ethers.getContractFactory("FuturesMarketFactoryV2");
  // Constructor: (_vault, _admin, _feeRecipient)
  const factory = await FuturesMarketFactoryV2.deploy(
    CORE_VAULT,          // _vault
    deployer.address,    // _admin
    TREASURY             // _feeRecipient
  );
  await factory.waitForDeployment();
  contracts.FUTURES_MARKET_FACTORY = await factory.getAddress();
  console.log(`  ✅ FuturesMarketFactoryV2: ${contracts.FUTURES_MARKET_FACTORY}`);

  // Configure factory
  let tx = await factory.setFacetRegistry(FACET_REGISTRY);
  await tx.wait();
  console.log(`  ✅ FacetRegistry set on factory`);

  tx = await factory.setInitFacet(ORDER_BOOK_INIT_FACET);
  await tx.wait();
  console.log(`  ✅ InitFacet set on factory`);

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 4.5: MARKET BOND MANAGER
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 PHASE 4.5: MARKET BOND MANAGER");
  console.log("─".repeat(60));

  const MarketBondManager = await ethers.getContractFactory("MarketBondManager");
  const bondManager = await MarketBondManager.deploy(CORE_VAULT, contracts.FUTURES_MARKET_FACTORY);
  await bondManager.waitForDeployment();
  contracts.MARKET_BOND_MANAGER = await bondManager.getAddress();
  console.log(`  ✅ MarketBondManager: ${contracts.MARKET_BOND_MANAGER}`);

  tx = await factory.setBondManager(contracts.MARKET_BOND_MANAGER);
  await tx.wait();
  console.log(`  ✅ BondManager set on factory`);

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
  // PHASE 6: COLLATERAL HUB
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 PHASE 6: COLLATERAL HUB");
  console.log("─".repeat(60));

  const CollateralHub = await ethers.getContractFactory("CollateralHub");
  const collateralHub = await CollateralHub.deploy(
    deployer.address,    // admin
    CORE_VAULT,          // coreVault
    deployer.address     // operator
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
📋 All Deployed Contracts:
   CoreVault:             ${CORE_VAULT}
   FeeRegistry:           ${FEE_REGISTRY}
   FacetRegistry:         ${FACET_REGISTRY}
   FuturesMarketFactoryV2: ${contracts.FUTURES_MARKET_FACTORY}
   MarketBondManager:     ${contracts.MARKET_BOND_MANAGER}
   GlobalSessionRegistry: ${contracts.GLOBAL_SESSION_REGISTRY}
   CollateralHub:         ${contracts.COLLATERAL_HUB}

🔧 Next Steps:
   1. Update .env.local with new contract addresses
   2. Deploy SpokeVault on Arbitrum:
      npx hardhat run scripts/deploy-arbitrum-spoke.js --network arbitrum
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
