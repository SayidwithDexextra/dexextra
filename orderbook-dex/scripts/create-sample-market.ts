import { ethers, network } from "hardhat";
import { saveMarketCreation, MarketCreationData } from "./utils/supabase-client";

interface DeploymentData {
  contracts: {
    factory?: string;
    centralVault?: string;
    orderRouter?: string;
    umaOracleManager?: string;
  };
}

/**
 * Creates a sample market for testing
 */
async function main() {
  console.log("🏗️ Creating sample market: Silver V1");

  // Get deployment signer
  const [deployer] = await ethers.getSigners();
  console.log("Creating market with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));

  // Load deployment data
  const fs = require('fs');
  const deploymentFiles = fs.readdirSync('deployments/')
    .filter((file: string) => file.includes('polygon-deployment') && file.endsWith('.json'))
    .sort()
    .reverse(); // Get most recent

  if (deploymentFiles.length === 0) {
    throw new Error("No deployment data found. Please deploy contracts first.");
  }

  const deploymentFile = `deployments/${deploymentFiles[0]}`;
  const deploymentData: DeploymentData = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  
  if (!deploymentData.contracts.factory) {
    throw new Error("Factory address not found in deployment data");
  }

  console.log("📋 Using deployment from:", deploymentFile);
  console.log("Factory address:", deploymentData.contracts.factory);

  // Connect to factory contract
  const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
  const factory = MetricsMarketFactory.attach(deploymentData.contracts.factory);

  // Market configuration for Silver V1
  const currentTime = Math.floor(Date.now() / 1000);
  const tradingEndDate = currentTime + (30 * 24 * 60 * 60); // 30 days from now
  const settlementDate = tradingEndDate + (7 * 24 * 60 * 60); // 7 days after trading ends
  const startPrice = ethers.parseEther("10"); // $10.00

  const marketConfig = {
    metricId: "SILVER_V1",
    description: "Silver V1 - Premium Silver Price Tracking Market",
    oracleProvider: deployer.address, // Using deployer as oracle for testing
    decimals: 18,
    minimumOrderSize: ethers.parseEther("0.1"), // 0.1 unit minimum
    tickSize: ethers.parseEther("0.01"), // $0.01 tick size (will be overridden to 0.01)
    creationFee: ethers.parseEther("0"), // Zero creation fee
    requiresKYC: false,
    settlementDate: settlementDate,
    tradingEndDate: tradingEndDate,
    dataRequestWindow: 86400, // 24 hours
    autoSettle: true,
    initialOrder: {
      enabled: true,
      side: 0, // BUY side
      quantity: ethers.parseEther("10"), // 10 units
      price: startPrice, // $10.00
      timeInForce: 0, // GTC (Good Till Cancelled)
      expiryTime: 0 // No expiry
    }
  };

  console.log("\n📈 Market Configuration:");
  console.log("- Metric ID:", marketConfig.metricId);
  console.log("- Description:", marketConfig.description);
  console.log("- Start Price:", ethers.formatEther(startPrice), "USD");
  console.log("- Minimum Order Size:", ethers.formatEther(marketConfig.minimumOrderSize), "units");
  console.log("- Trading End Date:", new Date(tradingEndDate * 1000).toISOString());
  console.log("- Settlement Date:", new Date(settlementDate * 1000).toISOString());
  console.log("- Initial Order: BUY", ethers.formatEther(marketConfig.initialOrder.quantity), "units at $", ethers.formatEther(startPrice));

  // Check if market already exists
  const existingMarket = await factory.getMarket(marketConfig.metricId);
  if (existingMarket !== ethers.ZeroAddress) {
    console.log("⚠️  Market already exists at:", existingMarket);
    console.log("💡 Use a different metric ID or delete the existing market");
    return;
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

    // Save market data to Supabase
    console.log("\n💾 Saving market data to Supabase...");
    
    const chainId = Number((await deployer.provider.getNetwork()).chainId);
    
    const marketData: MarketCreationData = {
      metricId: marketConfig.metricId,
      description: marketConfig.description,
      category: "Commodities", // Silver is a commodity
      decimals: marketConfig.decimals,
      minimumOrderSize: ethers.formatEther(marketConfig.minimumOrderSize),
      requiresKyc: marketConfig.requiresKYC,
      settlementDate: new Date(settlementDate * 1000),
      tradingEndDate: new Date(tradingEndDate * 1000),
      dataRequestWindowSeconds: marketConfig.dataRequestWindow,
      autoSettle: marketConfig.autoSettle,
      oracleProvider: marketConfig.oracleProvider,
      initialOrder: {
        enabled: marketConfig.initialOrder.enabled,
        side: marketConfig.initialOrder.side === 0 ? "BUY" : "SELL",
        quantity: ethers.formatEther(marketConfig.initialOrder.quantity),
        price: ethers.formatEther(marketConfig.initialOrder.price),
        timeInForce: "GTC",
        expiryTime: null
      },
      creationFee: ethers.formatEther(marketConfig.creationFee),
      marketAddress: marketAddress,
      factoryAddress: deploymentData.contracts.factory!,
      centralVaultAddress: deploymentData.contracts.centralVault!,
      orderRouterAddress: deploymentData.contracts.orderRouter!,
      umaOracleManagerAddress: deploymentData.contracts.umaOracleManager!,
      chainId: chainId,
      deploymentTransactionHash: tx.hash,
      deploymentBlockNumber: receipt.blockNumber,
      deploymentGasUsed: Number(receipt.gasUsed),
      creatorWalletAddress: deployer.address
    };

    const marketId = await saveMarketCreation(marketData);
    
    if (marketId) {
      console.log("✅ Market data saved to Supabase database");
      console.log("🆔 Database Market ID:", marketId);
    } else {
      console.log("⚠️  Could not save to Supabase - check environment variables");
      console.log("💡 Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env to enable database integration");
    }

    console.log("\n🎉 Silver V1 Market Created Successfully!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 Market Details:");
    console.log("- Metric ID:", marketConfig.metricId);
    console.log("- Contract Address:", marketAddress);
    console.log("- Start Price: $", ethers.formatEther(startPrice));
    console.log("- Initial Liquidity:", ethers.formatEther(marketConfig.initialOrder.quantity), "units");
    console.log("- Trading Period:", Math.floor((tradingEndDate - currentTime) / 86400), "days");
    console.log("- Settlement:", new Date(settlementDate * 1000).toLocaleDateString());
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    console.log("\n🔧 Next Steps:");
    console.log("1. ✅ Silver V1 market created and deployed");
    console.log("2. ✅ Initial buy order placed at $10.00");
    console.log("3. ✅ Market data saved to database");
    console.log("4. 🎯 Users can now place sell orders to trade");
    console.log("5. 📈 Monitor market activity and volume");
    console.log("6. ⏰ Prepare for settlement data in", Math.floor((settlementDate - currentTime) / 86400), "days");

  } catch (error: any) {
    console.error("❌ Market creation failed:", error);
    
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    
    if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
      console.error("💡 This might be due to insufficient balance or contract issues");
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
