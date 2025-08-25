import { ethers, network } from "hardhat";

/**
 * Creates Silver V1 market directly without initial order to avoid role issues
 */
async function main() {
  console.log("🏗️ Creating Silver V1 market on Polygon");

  // Get deployment signer
  const [deployer] = await ethers.getSigners();
  console.log("Creating market with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));

  // Contract addresses from successful deployment
  const FACTORY_ADDRESS = "0x354f188944eF514eEEf05d8a31E63B33f87f16E0";
  const ORDER_ROUTER_ADDRESS = "0x516a1790a04250FC6A5966A528D02eF20E1c1891";

  // Connect to contracts
  const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
  const factory = MetricsMarketFactory.attach(FACTORY_ADDRESS);

  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const orderRouter = OrderRouter.attach(ORDER_ROUTER_ADDRESS);

  // Grant MARKET_CREATOR_ROLE to deployer
  console.log("🔑 Granting MARKET_CREATOR_ROLE to deployer...");
  try {
    const MARKET_CREATOR_ROLE = await factory.MARKET_CREATOR_ROLE();
    const hasRole = await factory.hasRole(MARKET_CREATOR_ROLE, deployer.address);
    
    if (!hasRole) {
      const grantTx = await factory.grantMarketCreatorRole(deployer.address);
      await grantTx.wait();
      console.log("✅ MARKET_CREATOR_ROLE granted");
    } else {
      console.log("✅ Already has MARKET_CREATOR_ROLE");
    }
  } catch (error) {
    console.log("⚠️  Could not grant role, proceeding anyway...");
  }

  // Market configuration for Silver V1 (simplified - no initial order)
  const currentTime = Math.floor(Date.now() / 1000);
  const tradingEndDate = currentTime + (30 * 24 * 60 * 60); // 30 days from now
  const settlementDate = tradingEndDate + (7 * 24 * 60 * 60); // 7 days after trading ends

  const marketConfig = {
    metricId: "SILVER_V1",
    description: "Silver V1 - Premium Silver Price Tracking Market",
    oracleProvider: deployer.address, // Using deployer as oracle for testing
    decimals: 18,
    minimumOrderSize: ethers.parseEther("0.1"), // 0.1 unit minimum
    tickSize: ethers.parseEther("0.01"), // Will be overridden to 0.01
    creationFee: ethers.parseEther("0"), // Zero creation fee
    requiresKYC: false,
    settlementDate: settlementDate,
    tradingEndDate: tradingEndDate,
    dataRequestWindow: 86400, // 24 hours
    autoSettle: true,
    initialOrder: {
      enabled: false, // Disabled to avoid role issues
      side: 0,
      quantity: ethers.parseEther("0"),
      price: ethers.parseEther("0"),
      timeInForce: 0,
      expiryTime: 0
    }
  };

  console.log("\n📈 Market Configuration:");
  console.log("- Metric ID:", marketConfig.metricId);
  console.log("- Description:", marketConfig.description);
  console.log("- Minimum Order Size:", ethers.formatEther(marketConfig.minimumOrderSize), "units");
  console.log("- Trading End Date:", new Date(tradingEndDate * 1000).toISOString());
  console.log("- Settlement Date:", new Date(settlementDate * 1000).toISOString());
  console.log("- Initial Order: Disabled (will add manually after market creation)");

  // Check if market already exists
  try {
    const existingMarket = await factory.getMarket(marketConfig.metricId);
    if (existingMarket !== ethers.ZeroAddress) {
      console.log("⚠️  Market already exists at:", existingMarket);
      console.log("🎯 Market is ready for trading!");
      
      // Show next steps
      console.log("\n🔧 Next Steps:");
      console.log("1. ✅ Silver V1 market already deployed");
      console.log("2. 📈 You can now place orders manually");
      console.log("3. 💰 Use the market address above for trading");
      return;
    }
  } catch (error) {
    console.log("Error checking existing market, proceeding with creation...");
  }

  // Create the market
  console.log("\n🚀 Creating market on-chain...");
  
  try {
    const tx = await factory.createMarket(marketConfig, {
      value: marketConfig.creationFee // Pay creation fee (0 in our case)
    });
    
    console.log("📝 Transaction submitted:", tx.hash);
    console.log("⏳ Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log("✅ Market created successfully!");
    console.log("⛽ Gas used:", receipt.gasUsed.toString());
    console.log("📦 Block number:", receipt.blockNumber);

    // Get the market address from the event
    const marketCreatedEvent = receipt.logs.find((log: any) => {
      try {
        const parsedLog = factory.interface.parseLog(log);
        return parsedLog.name === 'MarketCreated';
      } catch {
        return false;
      }
    });

    let marketAddress = "";
    if (marketCreatedEvent) {
      const parsedEvent = factory.interface.parseLog(marketCreatedEvent);
      marketAddress = parsedEvent.args.marketAddress;
      console.log("🏪 Market contract deployed at:", marketAddress);
    }

    console.log("\n🎉 Silver V1 Market Created Successfully!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 Market Details:");
    console.log("- Metric ID:", marketConfig.metricId);
    console.log("- Contract Address:", marketAddress);
    console.log("- Category: Commodities (Silver)");
    console.log("- Trading Period:", Math.floor((tradingEndDate - currentTime) / 86400), "days");
    console.log("- Settlement:", new Date(settlementDate * 1000).toLocaleDateString());
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    console.log("\n🔧 Next Steps:");
    console.log("1. ✅ Silver V1 market created and deployed");
    console.log("2. 🎯 Market is ready for trading");
    console.log("3. 📈 Users can now place buy and sell orders");
    console.log("4. 💰 Suggested starting price: $10.00");
    console.log("5. ⏰ Settlement in", Math.floor((settlementDate - currentTime) / 86400), "days");

    console.log("\n💡 To place the first order at $10:");
    console.log("1. Connect to market:", marketAddress);
    console.log("2. Place a BUY order: 10 units at $10.00");
    console.log("3. This will create initial liquidity");

  } catch (error: any) {
    console.error("❌ Market creation failed:", error);
    
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    
    if (error.message.includes("missing role")) {
      console.error("💡 The factory contract needs MARKET_CREATOR_ROLE");
      console.error("💡 Try granting the role manually or using the admin account");
    }
    
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
