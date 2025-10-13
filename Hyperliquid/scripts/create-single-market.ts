import { ethers } from "hardhat";

/**
 * Simple script to create a single OrderBook market using OrderBookFactoryMinimal
 * 
 * Usage:
 * npx hardhat run scripts/create-single-market.ts --network polygon
 * 
 * Factory: 0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75
 * VaultRouter: 0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7
 */

// Configuration - Edit these values to create your market
const MARKET_CONFIG = {
  symbol: "SILVER/USD",  // Change this to your desired symbol
  description: "Silver futures market with price discovery"
};

// Production contract addresses
const FACTORY_ADDRESS = "0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75";
const VAULT_ROUTER_ADDRESS = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";

async function main() {
  console.log("🚀 Creating OrderBook Market via OrderBookFactoryMinimal\n");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("📋 Deployer:", deployer.address);

  // Check balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "MATIC");

  // Connect to factory
  console.log("🏭 Connecting to factory:", FACTORY_ADDRESS);
  const factory = await ethers.getContractAt("OrderBookFactoryMinimal", FACTORY_ADDRESS);

  // Verify deployer is owner
  const owner = await factory.owner();
  console.log("👤 Factory owner:", owner);
  
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.error("❌ ERROR: Deployer is not the factory owner!");
    console.error("   Only the factory owner can create markets");
    console.error("   Factory owner:", owner);
    console.error("   Current deployer:", deployer.address);
    process.exit(1);
  }
  console.log("✅ Deployer is factory owner");

  // Get creation fee
  const creationFee = await factory.marketCreationFee();
  console.log("💵 Creation fee:", ethers.formatEther(creationFee), "MATIC");

  // Check sufficient balance
  if (balance < creationFee) {
    console.error("❌ ERROR: Insufficient balance for market creation");
    console.error(`   Need: ${ethers.formatEther(creationFee)} MATIC`);
    console.error(`   Have: ${ethers.formatEther(balance)} MATIC`);
    process.exit(1);
  }

  // Check if market already exists
  console.log(`\n🔍 Checking if market "${MARKET_CONFIG.symbol}" already exists...`);
  try {
    const existingMarketId = await factory.getMarketBySymbol(MARKET_CONFIG.symbol);
    if (existingMarketId !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      console.log("⚠️  Market already exists!");
      const marketInfo = await factory.getMarket(existingMarketId);
      console.log("   Market ID:", existingMarketId);
      console.log("   OrderBook:", marketInfo.orderBookAddress);
      console.log("   Active:", marketInfo.isActive);
      return;
    }
  } catch (error) {
    // Market doesn't exist, continue
  }

  console.log(`\n📊 Creating market: ${MARKET_CONFIG.symbol}`);
  console.log(`📝 Description: ${MARKET_CONFIG.description}`);

  try {
    // Create the market
    console.log("🔄 Submitting transaction...");
    const tx = await factory.createTraditionalMarket(MARKET_CONFIG.symbol, {
      value: creationFee,
      gasLimit: 3000000
    });

    console.log("⏳ Transaction submitted:", tx.hash);
    console.log("⏳ Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed!");

    // Parse the MarketCreated event
    const marketCreatedEvent = receipt.logs.find((log: any) => {
      try {
        const parsed = factory.interface.parseLog(log);
        return parsed?.name === 'MarketCreated';
      } catch {
        return false;
      }
    });

    if (!marketCreatedEvent) {
      throw new Error("MarketCreated event not found");
    }

    const parsedEvent = factory.interface.parseLog(marketCreatedEvent);
    const marketId = parsedEvent.args[0];
    const orderBookAddress = parsedEvent.args[1];
    const symbol = parsedEvent.args[2];

    // Display results
    console.log("\n" + "=".repeat(50));
    console.log("🎉 MARKET CREATED SUCCESSFULLY!");
    console.log("=".repeat(50));
    console.log(`📊 Symbol: ${symbol}`);
    console.log(`🆔 Market ID: ${marketId}`);
    console.log(`🏪 OrderBook Address: ${orderBookAddress}`);
    console.log(`⛽ Gas Used: ${receipt.gasUsed.toLocaleString()}`);
    console.log(`💰 Fee Paid: ${ethers.formatEther(creationFee)} MATIC`);
    console.log(`🔗 Transaction: ${tx.hash}`);

    // Verify market registration
    console.log("\n🔍 Verifying market registration...");
    const marketInfo = await factory.getMarket(marketId);
    console.log("✅ Market verified in factory registry");
    console.log(`   Active: ${marketInfo.isActive}`);
    console.log(`   Creator: ${marketInfo.creator}`);

    // Show contract links
    console.log("\n🔗 Contract Links:");
    console.log(`   Factory: https://polygonscan.com/address/${FACTORY_ADDRESS}`);
    console.log(`   OrderBook: https://polygonscan.com/address/${orderBookAddress}`);
    console.log(`   Transaction: https://polygonscan.com/tx/${tx.hash}`);

    // Show current factory stats
    console.log("\n📈 Factory Statistics:");
    const totalMarkets = await factory.getTotalMarkets();
    console.log(`   Total Markets: ${totalMarkets}`);

  } catch (error: any) {
    console.error("\n❌ Market creation failed!");
    console.error("Error:", error.message);
    
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    
    if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
      console.error("\n💡 Possible causes:");
      console.error("   - Market symbol already exists");
      console.error("   - Insufficient permissions");
      console.error("   - Contract is paused");
    }
    
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("\n✅ Script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
