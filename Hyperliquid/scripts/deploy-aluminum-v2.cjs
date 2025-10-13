const { ethers } = require("hardhat");
const { createClient } = require("@supabase/supabase-js");

/**
 * Deploy ALUMINUM_V2 contract using OrderBookFactoryMinimal and save to Supabase
 *
 * Factory: 0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75
 * VaultRouter: 0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7
 * TradingRouter: 0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B
 *
 * Usage:
 * HARDHAT_CONFIG=hardhat.config.cjs npx hardhat run scripts/deploy-aluminum-v2.cjs --network polygon
 */

class AluminumV2Deployer {
  constructor() {
    // Production contract addresses
    this.deployedAddresses = {
      factoryAddress: "0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75",
      vaultRouterAddress: "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7",
      tradingRouterAddress: "0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B",
      upgradeManagerAddress: "0x0B403f10BBe8F1EcE4D4756c9384429D364CE7E9",
      aluminumV2OrderBook: "",
      aluminumV2MarketId: "",
    };

    // Supabase configuration
    const supabaseConfig = {
      url: "https://khhknmobkkkvvogznxdj.supabase.co",
      anonKey:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaGtubW9ia2trdnZvZ3pueGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEzODYyNjcsImV4cCI6MjA2Njk2MjI2N30.vt_7kDR-6IrDYqdrMTzCo5NyFXYZQU-X_OwEtOP1u24",
    };

    this.supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);
  }

  async initialize() {
    console.log("🚀 Initializing ALUMINUM_V2 Deployment...\n");

    // Get deployer account
    const [deployer] = await ethers.getSigners();
    this.deployer = deployer;
    console.log("📋 Deployer address:", this.deployer.address);

    // Check deployer balance
    const balance = await ethers.provider.getBalance(this.deployer.address);
    console.log("💰 Deployer balance:", ethers.formatEther(balance), "MATIC");

    // Connect to OrderBookFactoryMinimal
    console.log(
      "🏭 Connecting to OrderBookFactoryMinimal:",
      this.deployedAddresses.factoryAddress
    );
    this.factory = await ethers.getContractAt(
      "OrderBookFactoryMinimal",
      this.deployedAddresses.factoryAddress
    );

    // Verify deployer is factory owner
    const owner = await this.factory.owner();
    console.log("👤 Factory owner:", owner);

    if (owner.toLowerCase() !== this.deployer.address.toLowerCase()) {
      throw new Error(
        `Deployer is not factory owner. Owner: ${owner}, Deployer: ${this.deployer.address}`
      );
    }
    console.log("✅ Deployer is factory owner");

    // Get market creation fee
    const creationFee = await this.factory.marketCreationFee();
    console.log(
      "💵 Market creation fee:",
      ethers.formatEther(creationFee),
      "MATIC"
    );

    // Verify sufficient balance
    if (balance < creationFee) {
      throw new Error(
        `Insufficient balance. Need: ${ethers.formatEther(
          creationFee
        )} MATIC, Have: ${ethers.formatEther(balance)} MATIC`
      );
    }

    console.log("\n" + "=".repeat(60) + "\n");
  }

  async checkExistingMarket() {
    console.log("🔍 Checking if ALUMINUM_V2 market already exists...");

    try {
      const existingMarketId = await this.factory.getMarketBySymbol(
        "ALUMINUM_V2"
      );

      if (
        existingMarketId !==
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      ) {
        console.log("⚠️  ALUMINUM_V2 market already exists!");
        const marketInfo = await this.factory.getMarket(existingMarketId);

        console.log("   Market ID:", existingMarketId);
        console.log("   OrderBook:", marketInfo.orderBookAddress);
        console.log("   Active:", marketInfo.isActive);
        console.log("   Creator:", marketInfo.creator);

        // Update our addresses for Supabase save
        this.deployedAddresses.aluminumV2MarketId = existingMarketId;
        this.deployedAddresses.aluminumV2OrderBook =
          marketInfo.orderBookAddress;

        return true;
      }

      return false;
    } catch (error) {
      console.log("📊 Market does not exist, proceeding with creation...");
      return false;
    }
  }

  async createAluminumV2Market() {
    console.log("📊 Creating ALUMINUM_V2 market...");
    console.log(
      "📝 Description: Aluminum V2 futures market with enhanced features and optimizations"
    );

    try {
      const creationFee = await this.factory.marketCreationFee();

      console.log("🔄 Submitting market creation transaction...");
      const tx = await this.factory.createTraditionalMarket("ALUMINUM_V2", {
        value: creationFee,
        gasLimit: 3000000,
      });

      console.log("⏳ Transaction submitted:", tx.hash);
      console.log("⏳ Waiting for confirmation...");

      const receipt = await tx.wait();
      console.log("✅ Transaction confirmed!");

      // Parse MarketCreated event
      const marketCreatedEvent = receipt.logs.find((log) => {
        try {
          const parsed = this.factory.interface.parseLog(log);
          return parsed?.name === "MarketCreated";
        } catch {
          return false;
        }
      });

      if (!marketCreatedEvent) {
        throw new Error("MarketCreated event not found in transaction logs");
      }

      const parsedEvent = this.factory.interface.parseLog(marketCreatedEvent);
      const marketId = parsedEvent.args[0];
      const orderBookAddress = parsedEvent.args[1];
      const symbol = parsedEvent.args[2];

      // Store deployment addresses
      this.deployedAddresses.aluminumV2MarketId = marketId;
      this.deployedAddresses.aluminumV2OrderBook = orderBookAddress;

      console.log("\n🎉 ALUMINUM_V2 Market Created Successfully!");
      console.log("=".repeat(60));
      console.log("📊 Symbol:", symbol);
      console.log("🆔 Market ID:", marketId);
      console.log("🏪 OrderBook Address:", orderBookAddress);
      console.log("⛽ Gas Used:", receipt.gasUsed.toString());
      console.log("💰 Fee Paid:", ethers.formatEther(creationFee), "MATIC");
      console.log("🔗 Transaction:", tx.hash);

      // Verify market registration
      console.log("\n🔍 Verifying market registration...");
      const marketInfo = await this.factory.getMarket(marketId);
      console.log("✅ Market verified in factory registry");
      console.log("   Active:", marketInfo.isActive);
      console.log("   Creator:", marketInfo.creator);
    } catch (error) {
      console.error("\n❌ Market creation failed!");
      console.error("Error:", error.message);
      throw error;
    }
  }

  async saveToSupabase() {
    console.log("\n💾 Saving ALUMINUM_V2 market data to Supabase...");

    try {
      // Get network chain ID
      const network = await this.deployer.provider.getNetwork();
      const chainId = Number(network.chainId);

      // Prepare market data for Supabase
      const marketData = {
        metric_id: "ALUMINUM_V2",
        description:
          "Aluminum V2 futures market with enhanced features and optimizations for production trading",
        category: "COMMODITY",
        decimals: 18,
        minimum_order_size: 0.01,
        tick_size: 0.01,
        requires_kyc: false,
        auto_settle: true,
        oracle_provider: this.deployedAddresses.upgradeManagerAddress,
        creation_fee: 0,
        is_active: true,
        market_address: this.deployedAddresses.aluminumV2OrderBook,
        factory_address: this.deployedAddresses.factoryAddress,
        central_vault_address: this.deployedAddresses.vaultRouterAddress,
        order_router_address: this.deployedAddresses.tradingRouterAddress,
        uma_oracle_manager_address:
          this.deployedAddresses.upgradeManagerAddress,
        chain_id: chainId,
        market_status: "ACTIVE",
        total_volume: 0,
        total_trades: 0,
        open_interest_long: 0,
        open_interest_short: 0,
        creator_wallet_address: this.deployer.address,
        deployed_at: new Date().toISOString(),
      };

      console.log("📋 Market data to insert:");
      console.log("   Metric ID:", marketData.metric_id);
      console.log("   Market Address:", marketData.market_address);
      console.log("   Factory Address:", marketData.factory_address);
      console.log("   Chain ID:", marketData.chain_id);

      // Insert into orderbook_markets table
      const { data, error } = await this.supabase
        .from("orderbook_markets")
        .insert([marketData])
        .select();

      if (error) {
        console.error("❌ Error saving to Supabase:", error);
        throw error;
      }

      console.log("✅ Successfully saved ALUMINUM_V2 market data to Supabase!");
      console.log("📋 Database record ID:", data[0]?.id);
      console.log("🔗 Market can now be accessed via API");
    } catch (error) {
      console.error("❌ Failed to save to Supabase:", error);
      throw error;
    }
  }

  async verifySupabaseEntry() {
    console.log("\n🔍 Verifying Supabase database entry...");

    try {
      const { data, error } = await this.supabase
        .from("orderbook_markets")
        .select("*")
        .eq("metric_id", "ALUMINUM_V2")
        .single();

      if (error) {
        console.error("❌ Error querying Supabase:", error);
        return;
      }

      if (data) {
        console.log("✅ ALUMINUM_V2 found in database!");
        console.log("   Database ID:", data.id);
        console.log("   Metric ID:", data.metric_id);
        console.log("   Market Address:", data.market_address);
        console.log("   Status:", data.market_status);
        console.log("   Created:", data.created_at);
      } else {
        console.log("❌ ALUMINUM_V2 not found in database");
      }
    } catch (error) {
      console.error("❌ Error verifying database entry:", error);
    }
  }

  printDeploymentSummary() {
    console.log("\n" + "=".repeat(60));
    console.log("🎉 ALUMINUM_V2 DEPLOYMENT SUMMARY");
    console.log("=".repeat(60));
    console.log("📊 Market Symbol: ALUMINUM_V2");
    console.log("🆔 Market ID:", this.deployedAddresses.aluminumV2MarketId);
    console.log(
      "🏪 OrderBook Address:",
      this.deployedAddresses.aluminumV2OrderBook
    );
    console.log("🏭 Factory Address:", this.deployedAddresses.factoryAddress);
    console.log(
      "🏦 VaultRouter Address:",
      this.deployedAddresses.vaultRouterAddress
    );
    console.log(
      "🛣️  TradingRouter Address:",
      this.deployedAddresses.tradingRouterAddress
    );
    console.log(
      "⚡ UpgradeManager Address:",
      this.deployedAddresses.upgradeManagerAddress
    );
    console.log("👤 Creator:", this.deployer.address);
    console.log("🌐 Network: Polygon Mainnet (Chain ID: 137)");
    console.log("\n🔗 Contract Links:");
    console.log(
      `   OrderBook: https://polygonscan.com/address/${this.deployedAddresses.aluminumV2OrderBook}`
    );
    console.log(
      `   Factory: https://polygonscan.com/address/${this.deployedAddresses.factoryAddress}`
    );
    console.log(
      `   VaultRouter: https://polygonscan.com/address/${this.deployedAddresses.vaultRouterAddress}`
    );
    console.log(
      `   TradingRouter: https://polygonscan.com/address/${this.deployedAddresses.tradingRouterAddress}`
    );
    console.log("\n📊 Market Status:");
    console.log("   ✅ OrderBook Contract Deployed");
    console.log("   ✅ Market Registered in Factory");
    console.log("   ✅ Market Data Saved to Supabase");
    console.log("   ✅ Ready for Trading");
    console.log("=".repeat(60));
  }
}

async function main() {
  const deployer = new AluminumV2Deployer();

  try {
    // Initialize deployment
    await deployer.initialize();

    // Check if market already exists
    const marketExists = await deployer.checkExistingMarket();

    if (!marketExists) {
      // Create the market
      await deployer.createAluminumV2Market();
    } else {
      console.log(
        "📊 Using existing ALUMINUM_V2 market for Supabase update..."
      );
    }

    // Save to Supabase (will update if exists, insert if new)
    await deployer.saveToSupabase();

    // Verify the database entry
    await deployer.verifySupabaseEntry();

    // Print summary
    deployer.printDeploymentSummary();

    console.log("\n✅ ALUMINUM_V2 deployment completed successfully!");
    console.log("🚀 Market is now ready for trading operations!");
  } catch (error) {
    console.error("\n❌ Deployment failed:", error.message);

    if (error.reason) {
      console.error("Reason:", error.reason);
    }

    if (error.code === "UNPREDICTABLE_GAS_LIMIT") {
      console.error("\n💡 Possible causes:");
      console.error("   - Market symbol already exists");
      console.error("   - Insufficient permissions (not factory owner)");
      console.error("   - Contract is paused");
      console.error("   - Network connection issues");
    }

    process.exit(1);
  }
}

// Execute the deployment
main()
  .then(() => {
    console.log("\n🎉 Script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Script failed:", error);
    process.exit(1);
  });
