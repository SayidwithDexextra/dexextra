const { ethers } = require("hardhat");

async function main() {
  console.log("🔄 Redeploying TradingRouter with corrected OrderBookFactoryMinimal interface...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Contract addresses (from previous deployment)
  const VAULT_ROUTER_ADDRESS = "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5";
  const FACTORY_ADDRESS = "0x0fB0A98DC0cA49B72A0BC972D78e8bda7ef2EABF";
  
  console.log("Using VaultRouter:", VAULT_ROUTER_ADDRESS);
  console.log("Using Factory:", FACTORY_ADDRESS);

  // Deploy new TradingRouter
  console.log("\n📦 Deploying TradingRouter...");
  const TradingRouter = await ethers.getContractFactory("TradingRouter");
  const tradingRouter = await TradingRouter.deploy(
    VAULT_ROUTER_ADDRESS,
    FACTORY_ADDRESS,
    deployer.address
  );

  await tradingRouter.waitForDeployment();
  const tradingRouterAddress = await tradingRouter.getAddress();

  console.log("✅ TradingRouter deployed to:", tradingRouterAddress);

  // Test the fix
  console.log("\n🧪 Testing the fix...");
  
  try {
    // Test isPaused
    const isPaused = await tradingRouter.isPaused();
    console.log("✅ isPaused() works:", isPaused);

    // Test factory
    const factoryAddress = await tradingRouter.factory();
    console.log("✅ factory() works:", factoryAddress);

    // Test getMultiMarketPrices with the real market ID
    const marketId = "0x41e77fd5318a7e3c379ff8fe985be494211c1b2a0a0fa1fa2f99ac7d5060892a";
    console.log("Testing getMultiMarketPrices with market ID:", marketId);
    
    const result = await tradingRouter.getMultiMarketPrices([marketId]);
    console.log("✅ getMultiMarketPrices() works:", {
      bestBids: result[0].map((bid: any) => ethers.formatUnits(bid, 18)),
      bestAsks: result[1].map((ask: any) => ethers.formatUnits(ask, 18))
    });

  } catch (error) {
    console.error("❌ Test failed:", error);
  }

  console.log("\n🎯 Deployment Summary:");
  console.log("Old TradingRouter: 0x58BC190eE9d66eE49Dc1eeeEd2aBc1284216c8e6");
  console.log("New TradingRouter:", tradingRouterAddress);
  console.log("\n⚠️  Update CONTRACT_ADDRESSES.tradingRouter in your frontend config!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
