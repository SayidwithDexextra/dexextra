import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Starting Hyperliquid LEGO Architecture Deployment...\n");
  
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH\n");

  // Step 1: Deploy MockUSDC
  console.log("📈 Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy(deployer.address);
  await mockUSDC.waitForDeployment();
  const mockUSDCAddress = await mockUSDC.getAddress();
  console.log("✅ MockUSDC deployed to:", mockUSDCAddress);

  // Step 2: Deploy VaultRouter
  console.log("\n🏦 Deploying VaultRouter...");
  const VaultRouter = await ethers.getContractFactory("VaultRouter");
  const vaultRouter = await VaultRouter.deploy(mockUSDCAddress, deployer.address);
  await vaultRouter.waitForDeployment();
  const vaultRouterAddress = await vaultRouter.getAddress();
  console.log("✅ VaultRouter deployed to:", vaultRouterAddress);

  // Step 3: Deploy OrderBookFactory
  console.log("\n🏭 Deploying OrderBookFactory...");
  const OrderBookFactory = await ethers.getContractFactory("OrderBookFactory");
  const factory = await OrderBookFactory.deploy(vaultRouterAddress, deployer.address);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("✅ OrderBookFactory deployed to:", factoryAddress);

  // Step 4: Deploy TradingRouter
  console.log("\n⚡ Deploying TradingRouter...");
  const TradingRouter = await ethers.getContractFactory("TradingRouter");
  const tradingRouter = await TradingRouter.deploy(vaultRouterAddress, factoryAddress, deployer.address);
  await tradingRouter.waitForDeployment();
  const tradingRouterAddress = await tradingRouter.getAddress();
  console.log("✅ TradingRouter deployed to:", tradingRouterAddress);

  // Step 5: Deploy UpgradeManager (LEGO Controller)
  console.log("\n🧩 Deploying UpgradeManager (LEGO Controller)...");
  const UpgradeManager = await ethers.getContractFactory("UpgradeManager");
  const upgradeManager = await UpgradeManager.deploy(
    vaultRouterAddress,
    factoryAddress, 
    tradingRouterAddress,
    mockUSDCAddress,
    deployer.address
  );
  await upgradeManager.waitForDeployment();
  const upgradeManagerAddress = await upgradeManager.getAddress();
  console.log("✅ UpgradeManager deployed to:", upgradeManagerAddress);

  // Step 6: Setup roles and permissions
  console.log("\n⚙️  Setting up LEGO architecture permissions...");
  
  // Grant SETTLEMENT_ROLE to deployer for testing
  const SETTLEMENT_ROLE = await vaultRouter.SETTLEMENT_ROLE();
  await vaultRouter.grantRole(SETTLEMENT_ROLE, deployer.address);
  console.log("✅ Granted SETTLEMENT_ROLE to deployer");

  // Grant MARKET_CREATOR_ROLE to deployer
  const MARKET_CREATOR_ROLE = await factory.MARKET_CREATOR_ROLE();
  await factory.grantRole(MARKET_CREATOR_ROLE, deployer.address);
  console.log("✅ Granted MARKET_CREATOR_ROLE to deployer");

  // Grant UPGRADER_ROLE to deployer for UpgradeManager
  const UPGRADER_ROLE = await upgradeManager.UPGRADER_ROLE();
  await upgradeManager.grantRole(UPGRADER_ROLE, deployer.address);
  console.log("✅ Granted UPGRADER_ROLE to deployer");

  // Mint initial USDC for testing
  const initialMintAmount = ethers.parseUnits("1000000", 6); // 1M USDC
  await mockUSDC.mint(deployer.address, initialMintAmount);
  console.log("✅ Minted 1,000,000 mUSDC to deployer");

  // Step 7: Create initial markets
  console.log("\n📊 Creating initial LEGO markets...");
  
  const marketCreationFee = await factory.marketCreationFee();
  
  console.log("Creating ETH/USD market...");
  const ethMarketTx = await factory.createTraditionalMarket("ETH/USD", {
    value: marketCreationFee
  });
  const ethMarketReceipt = await ethMarketTx.wait();
  const ethMarketEvent = ethMarketReceipt?.logs.find(
    (log: any) => log.fragment && log.fragment.name === 'MarketCreated'
  );
  if (ethMarketEvent) {
    console.log("✅ ETH/USD market created with ID:", ethMarketEvent.args[0]);
    console.log("   OrderBook address:", ethMarketEvent.args[1]);
  }

  console.log("Creating BTC/USD market...");
  const btcMarketTx = await factory.createTraditionalMarket("BTC/USD", {
    value: marketCreationFee
  });
  const btcMarketReceipt = await btcMarketTx.wait();
  const btcMarketEvent = btcMarketReceipt?.logs.find(
    (log: any) => log.fragment && log.fragment.name === 'MarketCreated'
  );
  if (btcMarketEvent) {
    console.log("✅ BTC/USD market created with ID:", btcMarketEvent.args[0]);
    console.log("   OrderBook address:", btcMarketEvent.args[1]);
  }

  // Create custom metric markets
  console.log("Creating World Population metric market...");
  const worldPopTx = await factory.createCustomMetricMarket("WORLD_POP", "world_population", {
    value: marketCreationFee
  });
  const worldPopReceipt = await worldPopTx.wait();
  const worldPopEvent = worldPopReceipt?.logs.find(
    (log: any) => log.fragment && log.fragment.name === 'MarketCreated'
  );
  if (worldPopEvent) {
    console.log("✅ World Population market created with ID:", worldPopEvent.args[0]);
    console.log("   OrderBook address:", worldPopEvent.args[1]);
  }

  // Step 8: Test LEGO functionality
  console.log("\n🧪 Testing LEGO Architecture...");
  
  // Test system health check
  const health = await upgradeManager.systemHealthCheck();
  console.log("System Health Check:");
  console.log(`   VaultRouter: ${health.vaultRouterHealthy ? '✅ Healthy' : '❌ Unhealthy'}`);
  console.log(`   Factory: ${health.factoryHealthy ? '✅ Healthy' : '❌ Unhealthy'}`);
  console.log(`   TradingRouter: ${health.tradingRouterHealthy ? '✅ Healthy' : '❌ Unhealthy'}`);
  console.log(`   Overall System: ${health.systemHealthy ? '✅ Healthy' : '❌ Unhealthy'}`);

  // Test getting all contract addresses
  const contracts = await upgradeManager.getAllContracts();
  console.log("\n📋 LEGO Contract Registry:");
  console.log(`   VaultRouter: ${contracts.vaultRouterAddr}`);
  console.log(`   Factory: ${contracts.factoryAddr}`);
  console.log(`   TradingRouter: ${contracts.tradingRouterAddr}`);
  console.log(`   CollateralToken: ${contracts.collateralTokenAddr}`);

  // Step 9: Display comprehensive summary
  console.log("\n📋 🧩 LEGO Architecture Deployment Summary");
  console.log("=========================================");
  console.log("Core LEGO Pieces:");
  console.log("MockUSDC (Collateral):", mockUSDCAddress);
  console.log("VaultRouter (Bank):", vaultRouterAddress);
  console.log("OrderBookFactory (Market Creator):", factoryAddress);
  console.log("TradingRouter (Unified Interface):", tradingRouterAddress);
  console.log("UpgradeManager (LEGO Controller):", upgradeManagerAddress);
  console.log("");
  
  console.log("🎯 Markets Created:");
  const allMarkets = await factory.getAllMarkets();
  console.log("Total markets:", allMarkets.length);
  
  for (let i = 0; i < allMarkets.length; i++) {
    const marketInfo = await factory.getMarket(allMarkets[i]);
    console.log(`- ${marketInfo.symbol} (${marketInfo.isCustomMetric ? 'Custom Metric' : 'Traditional'})`);
    console.log(`  Market ID: ${marketInfo.marketId}`);
    console.log(`  OrderBook: ${marketInfo.orderBookAddress}`);
    if (marketInfo.metricId) {
      console.log(`  Metric ID: ${marketInfo.metricId}`);
    }
  }

  console.log("\n🔧 LEGO Configuration");
  console.log("=====================");
  console.log("Market Creation Fee:", ethers.formatEther(marketCreationFee), "ETH");
  console.log("Creator Fee Rate:", await factory.creatorFeeRate(), "basis points");
  console.log("Upgrades Enabled:", await upgradeManager.upgradesEnabled());
  console.log("Upgrade Delay:", await upgradeManager.upgradeDelay(), "seconds");

  console.log("\n🧩 LEGO Upgrade Capabilities");
  console.log("============================");
  console.log("✅ Collateral Token (MockUSDC) - Upgradeable");
  console.log("✅ VaultRouter (Bank) - Upgradeable");
  console.log("✅ OrderBookFactory (Markets) - Upgradeable");
  console.log("✅ TradingRouter (Interface) - Upgradeable");
  console.log("✅ Individual OrderBooks - Independently controllable");
  console.log("✅ Emergency Pause/Resume - System-wide or individual");

  console.log("\n📚 LEGO Usage Examples");
  console.log("======================");
  console.log("// Upgrade collateral token:");
  console.log(`await upgradeManager.upgradeCollateralToken(newUSDC, "Real USDC migration");`);
  console.log("");
  console.log("// Upgrade vault router:");
  console.log(`await upgradeManager.upgradeVaultRouter(newVaultRouter, "Enhanced features");`);
  console.log("");
  console.log("// Emergency pause all:");
  console.log(`await upgradeManager.emergencyPauseAll();`);
  console.log("");
  console.log("// System health check:");
  console.log(`const health = await upgradeManager.systemHealthCheck();`);

  console.log("\n🎉 LEGO Architecture Deployment Completed Successfully!");
  console.log("\n💡 Next steps:");
  console.log("1. Test individual contract upgrades using UpgradeManager");
  console.log("2. Verify emergency pause/resume functionality");
  console.log("3. Set up monitoring for upgrade events");
  console.log("4. Configure timelock delays for production");
  console.log("5. Test batch upgrade scenarios");
  console.log("");
  console.log("📚 Read LEGO_ARCHITECTURE.md for detailed usage guide");
  console.log("");
  console.log("🔗 Frontend Integration Addresses:");
  console.log(`const MOCK_USDC = "${mockUSDCAddress}";`);
  console.log(`const VAULT_ROUTER = "${vaultRouterAddress}";`);
  console.log(`const ORDERBOOK_FACTORY = "${factoryAddress}";`);
  console.log(`const TRADING_ROUTER = "${tradingRouterAddress}";`);
  console.log(`const UPGRADE_MANAGER = "${upgradeManagerAddress}";`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ LEGO Architecture deployment failed:", error);
    process.exit(1);
  });

