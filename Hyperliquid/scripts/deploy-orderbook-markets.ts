import { ethers } from "hardhat";

/**
 * Script for deploying OrderBook markets using OrderBookFactoryMinimal
 * Factory Address: 0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75
 * VaultRouter: 0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7
 */

interface MarketConfig {
  symbol: string;
  description: string;
  isCustomMetric?: boolean;
  metricId?: string;
}

interface DeploymentResult {
  marketId: string;
  orderBookAddress: string;
  symbol: string;
  txHash: string;
  gasUsed: string;
  creationFee: string;
}

class OrderBookMarketDeployer {
  private factory: any;
  private deployer: any;
  private factoryAddress: string;
  private vaultRouterAddress: string;

  constructor() {
    // Production addresses from contract-summary.md
    this.factoryAddress = "0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75";
    this.vaultRouterAddress = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";
  }

  async initialize(): Promise<void> {
    console.log("🚀 Initializing OrderBook Market Deployer...\n");

    // Get deployer account
    [this.deployer] = await ethers.getSigners();
    console.log("📋 Deployer address:", this.deployer.address);

    // Get deployer balance
    const balance = await ethers.provider.getBalance(this.deployer.address);
    console.log("💰 Deployer balance:", ethers.formatEther(balance), "MATIC");

    // Connect to existing factory
    this.factory = await ethers.getContractAt("OrderBookFactoryMinimal", this.factoryAddress);
    console.log("🏭 Connected to OrderBookFactoryMinimal:", this.factoryAddress);

    // Verify factory owner
    const owner = await this.factory.owner();
    console.log("👤 Factory owner:", owner);
    console.log("🔐 Is deployer owner?", owner.toLowerCase() === this.deployer.address.toLowerCase());

    // Get current market creation fee
    const creationFee = await this.factory.marketCreationFee();
    console.log("💵 Market creation fee:", ethers.formatEther(creationFee), "MATIC");

    console.log("\n" + "=".repeat(60) + "\n");
  }

  async deployMarket(config: MarketConfig): Promise<DeploymentResult> {
    console.log(`📊 Creating market: ${config.symbol}`);
    console.log(`📝 Description: ${config.description}`);

    try {
      // Get creation fee
      const creationFee = await this.factory.marketCreationFee();
      
      // Check if deployer has sufficient balance
      const balance = await ethers.provider.getBalance(this.deployer.address);
      if (balance < creationFee) {
        throw new Error(`Insufficient balance. Need ${ethers.formatEther(creationFee)} MATIC, have ${ethers.formatEther(balance)} MATIC`);
      }

      // Check if market already exists
      const existingMarketId = await this.factory.getMarketBySymbol(config.symbol);
      if (existingMarketId !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
        console.log("⚠️  Market with this symbol already exists");
        const existingMarket = await this.factory.getMarket(existingMarketId);
        return {
          marketId: existingMarketId,
          orderBookAddress: existingMarket.orderBookAddress,
          symbol: config.symbol,
          txHash: "EXISTING_MARKET",
          gasUsed: "0",
          creationFee: ethers.formatEther(creationFee)
        };
      }

      let tx: any;
      
      if (config.isCustomMetric && config.metricId) {
        // This would be for OrderBookFactory (not Minimal), but keeping for reference
        console.log("⚠️  Note: OrderBookFactoryMinimal doesn't support custom metrics");
        console.log("🔄 Creating as traditional market instead...");
      }
      
      // Create traditional market (only option for Minimal factory)
      console.log("🔄 Submitting market creation transaction...");
      tx = await this.factory.createTraditionalMarket(config.symbol, {
        value: creationFee,
        gasLimit: 3000000 // Set reasonable gas limit
      });

      console.log("⏳ Waiting for transaction confirmation...");
      console.log("🔗 Transaction hash:", tx.hash);

      const receipt = await tx.wait();
      console.log("✅ Transaction confirmed!");

      // Extract market creation event
      const marketCreatedEvent = receipt.logs.find(
        (log: any) => {
          try {
            const parsed = this.factory.interface.parseLog(log);
            return parsed?.name === 'MarketCreated';
          } catch {
            return false;
          }
        }
      );

      if (!marketCreatedEvent) {
        throw new Error("MarketCreated event not found in transaction logs");
      }

      const parsedEvent = this.factory.interface.parseLog(marketCreatedEvent);
      const marketId = parsedEvent.args[0];
      const orderBookAddress = parsedEvent.args[1];

      console.log("🎯 Market created successfully!");
      console.log("   📋 Market ID:", marketId);
      console.log("   🏪 OrderBook Address:", orderBookAddress);
      console.log("   ⛽ Gas Used:", receipt.gasUsed.toLocaleString());
      console.log("   💰 Creation Fee:", ethers.formatEther(creationFee), "MATIC");

      // Verify the market was registered correctly
      const marketInfo = await this.factory.getMarket(marketId);
      console.log("   ✅ Market verified in registry");
      console.log("   🔍 Active:", marketInfo.isActive);
      console.log("   👤 Creator:", marketInfo.creator);

      return {
        marketId: marketId,
        orderBookAddress: orderBookAddress,
        symbol: config.symbol,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
        creationFee: ethers.formatEther(creationFee)
      };

    } catch (error: any) {
      console.error("❌ Market creation failed:");
      console.error("   Error:", error.message);
      
      if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
        console.error("   💡 Suggestion: Check if you have MARKET_CREATOR_ROLE or if factory is paused");
      }
      
      throw error;
    }
  }

  async deployMultipleMarkets(markets: MarketConfig[]): Promise<DeploymentResult[]> {
    console.log(`📊 Deploying ${markets.length} markets...\n`);

    const results: DeploymentResult[] = [];
    
    for (let i = 0; i < markets.length; i++) {
      const market = markets[i];
      console.log(`\n[${i + 1}/${markets.length}] Processing: ${market.symbol}`);
      console.log("-".repeat(40));

      try {
        const result = await this.deployMarket(market);
        results.push(result);
        
        // Wait between deployments to avoid nonce issues
        if (i < markets.length - 1) {
          console.log("⏳ Waiting 2 seconds before next deployment...");
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error: any) {
        console.error(`❌ Failed to deploy ${market.symbol}:`, error.message);
        // Continue with next market
        continue;
      }
    }

    return results;
  }

  async getFactoryStats(): Promise<void> {
    console.log("\n📈 Factory Statistics:");
    console.log("-".repeat(30));

    const totalMarkets = await this.factory.getTotalMarkets();
    console.log("📊 Total Markets:", totalMarkets.toString());

    const allMarkets = await this.factory.getAllMarkets();
    console.log("📋 Market IDs:", allMarkets.length);

    for (let i = 0; i < Math.min(allMarkets.length, 5); i++) {
      const marketId = allMarkets[i];
      const marketInfo = await this.factory.getMarket(marketId);
      console.log(`   ${i + 1}. ${marketInfo.symbol} (${marketInfo.orderBookAddress})`);
    }

    if (allMarkets.length > 5) {
      console.log(`   ... and ${allMarkets.length - 5} more markets`);
    }
  }
}

async function main() {
  const deployer = new OrderBookMarketDeployer();
  
  try {
    // Initialize deployer
    await deployer.initialize();

    // Define markets to create
    const marketsToCreate: MarketConfig[] = [
      {
        symbol: "ETH/USD",
        description: "Ethereum to USD traditional trading pair"
      },
      {
        symbol: "BTC/USD", 
        description: "Bitcoin to USD traditional trading pair"
      },
      {
        symbol: "MATIC/USD",
        description: "Polygon MATIC to USD trading pair"
      },
      {
        symbol: "SOL/USD",
        description: "Solana to USD trading pair"
      }
    ];

    console.log("🎯 Markets to deploy:");
    marketsToCreate.forEach((market, i) => {
      console.log(`   ${i + 1}. ${market.symbol} - ${market.description}`);
    });
    console.log("");

    // Deploy markets
    const results = await deployer.deployMultipleMarkets(marketsToCreate);

    // Display results
    console.log("\n" + "=".repeat(60));
    console.log("📋 DEPLOYMENT SUMMARY");
    console.log("=".repeat(60));

    if (results.length === 0) {
      console.log("❌ No markets were successfully deployed");
      return;
    }

    results.forEach((result, i) => {
      console.log(`\n${i + 1}. ${result.symbol}`);
      console.log(`   Market ID: ${result.marketId}`);
      console.log(`   OrderBook: ${result.orderBookAddress}`);
      console.log(`   Tx Hash: ${result.txHash}`);
      console.log(`   Gas Used: ${result.gasUsed}`);
      console.log(`   Fee Paid: ${result.creationFee} MATIC`);
    });

    // Show factory stats
    await deployer.getFactoryStats();

    console.log("\n✅ Market deployment completed!");
    console.log("🔗 Factory Contract: https://polygonscan.com/address/0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75");
    
  } catch (error: any) {
    console.error("\n❌ Deployment failed:", error.message);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { OrderBookMarketDeployer, MarketConfig, DeploymentResult };
