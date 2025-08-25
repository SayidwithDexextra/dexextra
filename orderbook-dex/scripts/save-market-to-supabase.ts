import { ethers } from "hardhat";
import { saveMarketCreation, MarketCreationData } from "./utils/supabase-client";

/**
 * Save the Silver V1 market to Supabase database
 */
async function main() {
  console.log("💾 Saving Silver V1 market to Supabase...");

  // Get deployer info
  const [deployer] = await ethers.getSigners();
  
  // Market data from our deployment
  const marketData: MarketCreationData = {
    // Step 1: Market Information
    metricId: "SILVER_V1",
    description: "Premium Silver Price Tracking Market - Track and trade on silver price movements with high precision",
    category: "Commodities",

    // Step 2: Trading Configuration
    decimals: 8,
    minimumOrderSize: 1.0, // 1 USDC minimum
    tickSize: 0.01, // $0.01 minimum price increment
    requiresKyc: false,

    // Step 3: Settlement Configuration
    settlementDate: new Date("2025-09-28T00:00:00Z"), // September 28, 2025
    tradingEndDate: new Date("2025-09-27T23:59:59Z"), // Trading ends 1 minute before settlement
    dataRequestWindowSeconds: 3600, // 1 hour window for data requests
    autoSettle: true,
    oracleProvider: "0xCa1B94AD513097fC17bBBdB146787e026E62132b", // UMA Oracle Manager

    // Step 3: Initial Order Configuration
    initialOrder: {
      side: "BUY",
      price: 10.00,
      quantity: 100,
      orderType: "LIMIT"
    },

    // Step 4: Market Images (placeholder URLs)
    bannerImageUrl: null,
    iconImageUrl: null,
    supportingPhotoUrls: [],

    // Step 5: Advanced Settings
    creationFee: 0.0, // Zero creation fee as configured

    // Smart Contract Addresses (from our deployment)
    marketAddress: "0x07d317C87E6d8AF322463aCF024f1e28D38F6117", // Silver V1 Market
    factoryAddress: "0x354f188944eF514eEEf05d8a31E63B33f87f16E0", // MetricsMarketFactory
    centralVaultAddress: "0x9E5996Cb44AC7F60a9A46cACF175E87ab677fC1C", // CentralVault
    orderRouterAddress: "0x516a1790a04250FC6A5966A528D02eF20E1c1891", // OrderRouter
    umaOracleManagerAddress: "0xCa1B94AD513097fC17bBBdB146787e026E62132b", // UMA Oracle Manager

    // Blockchain Information
    chainId: 137, // Polygon mainnet
    deploymentTransactionHash: null, // Will be updated when we have the actual hash
    deploymentBlockNumber: null,
    deploymentGasUsed: null,

    // Market Status and Analytics
    marketStatus: "ACTIVE" as const,
    totalVolume: 0,
    totalTrades: 0,
    openInterestLong: 0,
    openInterestShort: 0,
    lastTradePrice: null,
    settlementValue: null,
    settlementTimestamp: null,

    // User Information
    creatorWalletAddress: deployer.address,
    creatorUserId: null, // Will be linked to user profile if available

    // AI Metric Resolution Link
    metricResolutionId: null,

    // Timestamps
    deployedAt: new Date()
  };

  try {
    // Save to Supabase
    const marketId = await saveMarketCreation(marketData);
    
    if (marketId) {
      console.log("✅ Successfully saved Silver V1 market to Supabase!");
      console.log("📋 Market Details:");
      console.log(`   - Market ID: ${marketId}`);
      console.log(`   - Metric ID: ${marketData.metricId}`);
      console.log(`   - Description: ${marketData.description}`);
      console.log(`   - Market Address: ${marketData.marketAddress}`);
      console.log(`   - Chain ID: ${marketData.chainId}`);
      console.log(`   - Creator: ${marketData.creatorWalletAddress}`);
      console.log(`   - Status: ${marketData.marketStatus}`);
      console.log(`   - Settlement Date: ${marketData.settlementDate}`);
      
      console.log("\\n🎯 Market is now visible in active_orderbook_markets view!");
      console.log("🔗 You can query it with: SELECT * FROM active_orderbook_markets WHERE metric_id = 'SILVER_V1'");
    } else {
      console.log("❌ Failed to save market to Supabase");
      console.log("🔧 Check your Supabase configuration:");
      console.log("   - SUPABASE_URL environment variable");
      console.log("   - SUPABASE_SERVICE_ROLE_KEY environment variable");
    }

  } catch (error) {
    console.error("❌ Error saving market to Supabase:", error);
    
    if (error instanceof Error) {
      console.error("Error details:", error.message);
      
      // Provide helpful debugging info
      if (error.message.includes("connect")) {
        console.log("\\n🔧 Connection Error - Check:");
        console.log("   - Internet connection");
        console.log("   - Supabase URL is correct");
        console.log("   - Firewall settings");
      } else if (error.message.includes("auth")) {
        console.log("\\n🔧 Authentication Error - Check:");
        console.log("   - SUPABASE_SERVICE_ROLE_KEY is correct");
        console.log("   - Key has necessary permissions");
      } else if (error.message.includes("constraint") || error.message.includes("violation")) {
        console.log("\\n🔧 Data Validation Error - Check:");
        console.log("   - All required fields are provided");
        console.log("   - Data formats match database constraints");
        console.log("   - No duplicate metric_id values");
      }
    }
  }
}

// Execute the script
main()
  .then(() => {
    console.log("\\n✨ Script completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Script failed:", error);
    process.exit(1);
  });
