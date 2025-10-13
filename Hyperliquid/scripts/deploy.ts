import { ethers } from "hardhat";
import { Contract } from "ethers";

async function main() {
  console.log("🚀 Starting Hyperliquid OrderBook Protocol deployment...\n");
  
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

  // Step 4: Setup initial configuration
  console.log("\n⚙️  Setting up initial configuration...");
  
  // Grant SETTLEMENT_ROLE to deployer for testing
  const SETTLEMENT_ROLE = await vaultRouter.SETTLEMENT_ROLE();
  await vaultRouter.grantRole(SETTLEMENT_ROLE, deployer.address);
  console.log("✅ Granted SETTLEMENT_ROLE to deployer");

  // Grant MARKET_CREATOR_ROLE to deployer
  const MARKET_CREATOR_ROLE = await factory.MARKET_CREATOR_ROLE();
  await factory.grantRole(MARKET_CREATOR_ROLE, deployer.address);
  console.log("✅ Granted MARKET_CREATOR_ROLE to deployer");

  // Mint initial USDC for testing
  const initialMintAmount = ethers.parseUnits("1000000", 6); // 1M USDC
  await mockUSDC.mint(deployer.address, initialMintAmount);
  console.log("✅ Minted 1,000,000 mUSDC to deployer");

  // Step 5: Create initial markets
  console.log("\n📊 Creating initial markets...");
  
  // Create traditional markets
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

  console.log("Creating Taylor Swift Spotify Listeners market...");
  const spotifyTx = await factory.createCustomMetricMarket("SPOTIFY_TS", "spotify_listeners_TaylorSwift", {
    value: marketCreationFee
  });
  const spotifyReceipt = await spotifyTx.wait();
  const spotifyEvent = spotifyReceipt?.logs.find(
    (log: any) => log.fragment && log.fragment.name === 'MarketCreated'
  );
  if (spotifyEvent) {
    console.log("✅ Taylor Swift Spotify market created with ID:", spotifyEvent.args[0]);
    console.log("   OrderBook address:", spotifyEvent.args[1]);
  }

  // Step 6: Display summary
  console.log("\n📋 Deployment Summary");
  console.log("=====================================");
  console.log("MockUSDC:", mockUSDCAddress);
  console.log("VaultRouter:", vaultRouterAddress);
  console.log("OrderBookFactory:", factoryAddress);
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

  console.log("\n🔧 Configuration");
  console.log("=====================================");
  console.log("Market Creation Fee:", ethers.formatEther(marketCreationFee), "ETH");
  console.log("Creator Fee Rate:", await factory.creatorFeeRate(), "basis points");
  console.log("");

  // Step 7: Setup test data (for development)
  if (process.env.SETUP_TEST_DATA === "true") {
    console.log("🧪 Setting up test data...");
    
    // Set initial metric values
    const worldPopMarketId = await factory.getMarketByMetric("world_population");
    const worldPopOrderBook = await ethers.getContractAt("OrderBook", 
      (await factory.getMarket(worldPopMarketId)).orderBookAddress
    );
    await worldPopOrderBook.updateMetricValue(ethers.parseUnits("8000000000", 0)); // 8 billion
    console.log("✅ Set world population to 8 billion");

    const spotifyMarketId = await factory.getMarketByMetric("spotify_listeners_TaylorSwift");
    const spotifyOrderBook = await ethers.getContractAt("OrderBook", 
      (await factory.getMarket(spotifyMarketId)).orderBookAddress
    );
    await spotifyOrderBook.updateMetricValue(ethers.parseUnits("90000000", 0)); // 90M listeners
    console.log("✅ Set Taylor Swift Spotify listeners to 90M");
  }

  console.log("\n🎉 Deployment completed successfully!");
  console.log("\n💡 Next steps:");
  console.log("1. Verify contracts on block explorer if needed");
  console.log("2. Set up oracle feeds for traditional markets");
  console.log("3. Configure frontend with contract addresses");
  console.log("4. Test the system with sample trades");
  console.log("");
  console.log("📚 Use the following addresses in your frontend:");
  console.log(`const MOCK_USDC = "${mockUSDCAddress}";`);
  console.log(`const VAULT_ROUTER = "${vaultRouterAddress}";`);
  console.log(`const ORDERBOOK_FACTORY = "${factoryAddress}";`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });

