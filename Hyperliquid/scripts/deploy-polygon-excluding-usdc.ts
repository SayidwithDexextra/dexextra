import { ethers } from "hardhat";
import { createClient } from '@supabase/supabase-js';

/**
 * Deploy HyperLiquid contracts to Polygon EXCLUDING MockUSDC
 * Uses existing MockUSDC deployment: 0xA2258Ff3aC4f5c77ca17562238164a0205A5b289
 * 
 * This deployment script includes all the scaling fixes from ORDERBOOK_SCALING_ISSUES.md
 */

interface DeploymentConfig {
  network: string;
  gasPrice?: string;
  gasLimit?: number;
  existingMockUSDC: string; // Use existing MockUSDC address
  marketName: string;
  marketDescription?: string;
  initialCollateralAmount?: string;
}

interface DeploymentAddresses {
  mockUSDC: string;          // Existing address - not deployed
  vaultRouter: string;
  orderBookFactory: string;
  tradingRouter: string;
  upgradeManager: string;
  orderBooks: Record<string, string>;
}

interface SupabaseConfig {
  url: string;
  anonKey: string;
}

class PolygonContractDeployer {
  private config: DeploymentConfig;
  private deployedAddresses: DeploymentAddresses;
  private deployer: any;
  private supabase: any;
  private supabaseConfig: SupabaseConfig;
  private marketId: string = "";

  constructor(config: DeploymentConfig, supabaseConfig: SupabaseConfig) {
    this.config = config;
    this.supabaseConfig = supabaseConfig;
    this.supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);
    this.deployedAddresses = {
      mockUSDC: config.existingMockUSDC, // Use existing address
      vaultRouter: "",
      orderBookFactory: "",
      tradingRouter: "",
      upgradeManager: "",
      orderBooks: {}
    };
  }

  /**
   * Deploy all contracts excluding MockUSDC
   */
  async deployAll(): Promise<DeploymentAddresses> {
    console.log("🚀 Starting HyperLiquid deployment on", this.config.network);
    console.log("📍 Using existing MockUSDC at:", this.config.existingMockUSDC);
    
    [this.deployer] = await ethers.getSigners();
    console.log("📝 Deploying with account:", this.deployer.address);
    
    const balance = await this.deployer.provider.getBalance(this.deployer.address);
    console.log("💰 Account balance:", ethers.formatEther(balance), "MATIC");

    try {
      // Verify existing MockUSDC
      await this.verifyExistingMockUSDC();
      
      // Deploy new contracts
      await this.deployVaultRouter();
      await this.deployOrderBookFactory();
      await this.deployTradingRouter();
      await this.deployUpgradeManager();
      
      // Setup roles and permissions
      await this.setupRoles();
      
      // Create Aluminum V1 market
      await this.createAluminumMarket();
      
      // Save deployment data
      await this.saveToSupabase();
      await this.saveDeploymentAddresses();
      
      console.log("✅ All contracts deployed successfully!");
      return this.deployedAddresses;
      
    } catch (error) {
      console.error("❌ Deployment failed:", error);
      throw error;
    }
  }

  /**
   * Verify existing MockUSDC contract
   */
  private async verifyExistingMockUSDC(): Promise<void> {
    console.log("\n🔍 Verifying existing MockUSDC...");
    
    try {
      const mockUSDC = await ethers.getContractAt("MockUSDC", this.config.existingMockUSDC);
      const name = await mockUSDC.name();
      const symbol = await mockUSDC.symbol();
      const decimals = await mockUSDC.decimals();
      
      console.log("   ✅ MockUSDC verified:");
      console.log("     Name:", name);
      console.log("     Symbol:", symbol);
      console.log("     Decimals:", decimals.toString());
      console.log("     Address:", this.config.existingMockUSDC);
      
    } catch (error) {
      console.error("❌ Failed to verify existing MockUSDC:", error);
      throw new Error(`MockUSDC at ${this.config.existingMockUSDC} is not accessible`);
    }
  }

  /**
   * Deploy VaultRouter contract
   */
  private async deployVaultRouter(): Promise<void> {
    console.log("\n🏦 Deploying VaultRouter...");
    
    const VaultRouter = await ethers.getContractFactory("VaultRouter");
    const vaultRouter = await VaultRouter.deploy(
      this.deployedAddresses.mockUSDC,
      this.deployer.address,
      {
        gasPrice: this.config.gasPrice ? ethers.parseUnits(this.config.gasPrice, "gwei") : undefined,
        gasLimit: this.config.gasLimit
      }
    );
    
    await vaultRouter.waitForDeployment();
    this.deployedAddresses.vaultRouter = await vaultRouter.getAddress();
    
    console.log("   ✅ VaultRouter deployed to:", this.deployedAddresses.vaultRouter);
  }

  /**
   * Deploy OrderBookFactoryMinimal contract
   */
  private async deployOrderBookFactory(): Promise<void> {
    console.log("\n🏭 Deploying OrderBookFactoryMinimal...");
    
    const OrderBookFactory = await ethers.getContractFactory("OrderBookFactoryMinimal");
    const factory = await OrderBookFactory.deploy(
      this.deployedAddresses.vaultRouter,
      this.deployer.address,
      {
        gasPrice: this.config.gasPrice ? ethers.parseUnits(this.config.gasPrice, "gwei") : undefined,
        gasLimit: this.config.gasLimit
      }
    );
    
    await factory.waitForDeployment();
    this.deployedAddresses.orderBookFactory = await factory.getAddress();
    
    console.log("   ✅ OrderBookFactoryMinimal deployed to:", this.deployedAddresses.orderBookFactory);
  }

  /**
   * Deploy TradingRouter contract (WITH SCALING FIXES)
   */
  private async deployTradingRouter(): Promise<void> {
    console.log("\n🛣️  Deploying TradingRouter (with scaling fixes)...");
    
    const TradingRouter = await ethers.getContractFactory("TradingRouter");
    const router = await TradingRouter.deploy(
      this.deployedAddresses.vaultRouter,
      this.deployedAddresses.orderBookFactory,
      this.deployer.address,
      {
        gasPrice: this.config.gasPrice ? ethers.parseUnits(this.config.gasPrice, "gwei") : undefined,
        gasLimit: this.config.gasLimit
      }
    );
    
    await router.waitForDeployment();
    this.deployedAddresses.tradingRouter = await router.getAddress();
    
    console.log("   ✅ TradingRouter deployed to:", this.deployedAddresses.tradingRouter);
    console.log("   📋 Includes fixes: _getOrderBook function, unified interface");
  }

  /**
   * Deploy UpgradeManager contract
   */
  private async deployUpgradeManager(): Promise<void> {
    console.log("\n⬆️  Deploying UpgradeManager...");
    
    const UpgradeManager = await ethers.getContractFactory("UpgradeManager");
    const upgradeManager = await UpgradeManager.deploy(
      this.deployedAddresses.vaultRouter,
      this.deployedAddresses.orderBookFactory,
      this.deployedAddresses.tradingRouter,
      this.deployedAddresses.mockUSDC, // collateralToken
      this.deployer.address, // admin
      {
        gasPrice: this.config.gasPrice ? ethers.parseUnits(this.config.gasPrice, "gwei") : undefined,
        gasLimit: this.config.gasLimit
      }
    );
    
    await upgradeManager.waitForDeployment();
    this.deployedAddresses.upgradeManager = await upgradeManager.getAddress();
    
    console.log("   ✅ UpgradeManager deployed to:", this.deployedAddresses.upgradeManager);
  }

  /**
   * Setup roles and permissions
   */
  private async setupRoles(): Promise<void> {
    console.log("\n🔐 Setting up roles and permissions...");
    
    const vaultRouter = await ethers.getContractAt("VaultRouter", this.deployedAddresses.vaultRouter);
    const factory = await ethers.getContractAt("OrderBookFactoryMinimal", this.deployedAddresses.orderBookFactory);
    
    // Grant TradingRouter access to VaultRouter
    const SETTLEMENT_ROLE = await vaultRouter.SETTLEMENT_ROLE();
    await vaultRouter.grantRole(SETTLEMENT_ROLE, this.deployedAddresses.tradingRouter);
    console.log("   ✅ Granted SETTLEMENT_ROLE to TradingRouter");
    
    // Grant deployer admin roles for testing
    await vaultRouter.grantRole(SETTLEMENT_ROLE, this.deployer.address);
    console.log("   ✅ Granted SETTLEMENT_ROLE to deployer");
    
    console.log("   ✅ Roles setup completed");
  }

  /**
   * Create Aluminum V1 market (WITH SCALING FIXES)
   */
  private async createAluminumMarket(): Promise<void> {
    console.log("\n📈 Creating Aluminum V1 market (with scaling fixes)...");
    
    const factory = await ethers.getContractAt("OrderBookFactoryMinimal", this.deployedAddresses.orderBookFactory);
    const marketCreationFee = await factory.marketCreationFee();
    
    console.log(`   Creating market: ${this.config.marketName}`);
    console.log(`   Market creation fee: ${ethers.formatEther(marketCreationFee)} MATIC`);
    
    const tx = await factory.createTraditionalMarket(this.config.marketName, {
      value: marketCreationFee,
      gasPrice: this.config.gasPrice ? ethers.parseUnits(this.config.gasPrice, "gwei") : undefined
    });
    
    const receipt = await tx.wait();
    
    // Extract OrderBook address from event
    const marketCreatedEvent = receipt?.logs.find(
      (log: any) => log.fragment && log.fragment.name === 'MarketCreated'
    );
    
    if (marketCreatedEvent) {
      const orderBookAddress = marketCreatedEvent.args[1];
      this.deployedAddresses.orderBooks[this.config.marketName] = orderBookAddress;
      console.log(`   ✅ ${this.config.marketName} OrderBook deployed to: ${orderBookAddress}`);
      console.log("   📋 OrderBook includes scaling fixes:");
      console.log("     - PRICE_PRECISION = 1e6 (6 decimals)");
      console.log("     - MARGIN_PERCENTAGE = 10 (10% margin)");
      console.log("     - MAX_REASONABLE_PRICE = 1000e6 ($1000 max)");
      console.log("     - Proper input validation");
      
      // Store transaction details for Supabase
      this.marketId = ethers.id(`${this.config.marketName}_MARKET`);
      
    } else {
      throw new Error(`Could not extract OrderBook address for ${this.config.marketName}`);
    }
    
    console.log("   ✅ Aluminum V1 market creation completed");
  }

  /**
   * Save deployment data to Supabase database
   */
  private async saveToSupabase(): Promise<void> {
    console.log("\n💾 Saving deployment data to Supabase...");
    
    try {
      // Get network chain ID
      const chainId = await this.deployer.provider.getNetwork().then((n: any) => n.chainId);
      
      // Prepare market data for Supabase
      const marketData = {
        metric_id: this.config.marketName.toUpperCase().replace(/\s+/g, '_'),
        description: this.config.marketDescription || `${this.config.marketName} futures market with scaling fixes`,
        category: 'COMMODITY',
        decimals: 18,
        minimum_order_size: 0.01,
        tick_size: 0.01,
        requires_kyc: false,
        auto_settle: true,
        oracle_provider: this.deployedAddresses.upgradeManager,
        creation_fee: 0,
        is_active: true,
        market_address: this.deployedAddresses.orderBooks[this.config.marketName],
        factory_address: this.deployedAddresses.orderBookFactory,
        central_vault_address: this.deployedAddresses.vaultRouter,
        order_router_address: this.deployedAddresses.tradingRouter,
        uma_oracle_manager_address: this.deployedAddresses.upgradeManager,
        chain_id: Number(chainId),
        market_status: 'ACTIVE',
        total_volume: 0,
        total_trades: 0,
        open_interest_long: 0,
        open_interest_short: 0,
        creator_wallet_address: this.deployer.address,
        deployed_at: new Date().toISOString()
      };

      // Insert into orderbook_markets table
      const { data, error } = await this.supabase
        .from('orderbook_markets')
        .insert([marketData])
        .select();

      if (error) {
        console.error("❌ Error saving to Supabase:", error);
        throw error;
      }

      console.log("✅ Successfully saved market data to Supabase");
      console.log(`   Market ID in database: ${data[0]?.id}`);
      
    } catch (error) {
      console.error("❌ Failed to save to Supabase:", error);
      // Don't throw error - deployment should continue even if DB save fails
    }
  }

  /**
   * Save deployment addresses to file
   */
  private async saveDeploymentAddresses(): Promise<void> {
    const fs = require('fs');
    const deploymentData = {
      network: this.config.network,
      timestamp: new Date().toISOString(),
      deployer: this.deployer.address,
      addresses: this.deployedAddresses,
      config: this.config,
      notes: {
        mockUSDC: "REUSED existing deployment",
        upgrades: [
          "TradingRouter includes _getOrderBook function",
          "OrderBook includes decimal precision fixes",
          "Market orders have price bounds validation",
          "Enhanced error messages for debugging"
        ]
      }
    };
    
    const filename = `deployments-polygon-updated-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(deploymentData, null, 2));
    
    console.log(`💾 Deployment addresses saved to: ${filename}`);
    
    // Update environment variables file
    this.updateEnvFile();
  }

  /**
   * Update .env file with deployment addresses
   */
  private updateEnvFile(): void {
    const fs = require('fs');
    const envUpdates = [
      `# HyperLiquid ${this.config.network} Updated Deployment Addresses`,
      `# Generated on ${new Date().toISOString()}`,
      `# NOTE: MockUSDC address is REUSED from existing deployment`,
      ``,
      `NETWORK=${this.config.network}`,
      `DEPLOYER_ADDRESS=${this.deployer.address}`,
      ``,
      `# Contract Addresses`,
      `MOCK_USDC_ADDRESS=${this.deployedAddresses.mockUSDC}`,
      `VAULT_ROUTER_ADDRESS=${this.deployedAddresses.vaultRouter}`,
      `ORDERBOOK_FACTORY_ADDRESS=${this.deployedAddresses.orderBookFactory}`,
      `TRADING_ROUTER_ADDRESS=${this.deployedAddresses.tradingRouter}`,
      `UPGRADE_MANAGER_ADDRESS=${this.deployedAddresses.upgradeManager}`,
      ``,
      `# Market OrderBooks`,
    ];

    // Add OrderBook addresses
    Object.entries(this.deployedAddresses.orderBooks).forEach(([marketName, address]) => {
      const envVar = `${marketName.replace(/\s+/g, '_').toUpperCase()}_ORDERBOOK_ADDRESS`;
      envUpdates.push(`${envVar}=${address}`);
    });

    envUpdates.push('');
    envUpdates.push('# Deployment Notes');
    envUpdates.push('# - MockUSDC reused from previous deployment');
    envUpdates.push('# - All contracts include scaling fixes');
    envUpdates.push('# - TradingRouter has _getOrderBook function');
    envUpdates.push('# - OrderBook has proper decimal precision');

    const envContent = envUpdates.join('\n');
    fs.writeFileSync('.env.deployment.updated', envContent);
    
    console.log("📝 Updated environment variables saved to: .env.deployment.updated");
  }

  /**
   * Print deployment summary
   */
  printDeploymentSummary(): void {
    console.log("\n🎉 DEPLOYMENT SUMMARY");
    console.log("=" .repeat(70));
    console.log(`Network: ${this.config.network}`);
    console.log(`Deployer: ${this.deployer.address}`);
    console.log("");
    
    console.log("Contract Addresses:");
    console.log(`  MockUSDC (REUSED):    ${this.deployedAddresses.mockUSDC}`);
    console.log(`  VaultRouter (NEW):    ${this.deployedAddresses.vaultRouter}`);
    console.log(`  OrderBookFactory:     ${this.deployedAddresses.orderBookFactory}`);
    console.log(`  TradingRouter:        ${this.deployedAddresses.tradingRouter}`);
    console.log(`  UpgradeManager:       ${this.deployedAddresses.upgradeManager}`);
    console.log("");
    
    console.log("Market OrderBooks:");
    Object.entries(this.deployedAddresses.orderBooks).forEach(([marketName, address]) => {
      console.log(`  ${marketName}: ${address}`);
    });

    console.log("");
    console.log("🔧 Scaling Fixes Applied:");
    console.log("  ✅ TradingRouter._getOrderBook() function implemented");
    console.log("  ✅ OrderBook decimal precision standardized (6 decimals)");
    console.log("  ✅ Market order price bounds validation");
    console.log("  ✅ Enhanced input validation and error messages");
    console.log("  ✅ Proper margin calculation with PRICE_PRECISION");
    
    console.log("=" .repeat(70));
  }
}

/**
 * Main deployment function
 */
async function main() {
  const network = process.env.HARDHAT_NETWORK || "polygon";
  
  const config: DeploymentConfig = {
    network: network,
    gasPrice: process.env.GAS_PRICE || "30", // 30 gwei for Polygon
    gasLimit: process.env.GAS_LIMIT ? parseInt(process.env.GAS_LIMIT) : 8000000,
    existingMockUSDC: "0xA2258Ff3aC4f5c77ca17562238164a0205A5b289", // Existing deployment
    marketName: "Aluminum V1",
    marketDescription: "Aluminum V1 futures market with scaling fixes for production",
    initialCollateralAmount: "1000000" // 1M USDC for testing
  };

  const supabaseConfig: SupabaseConfig = {
    url: "https://khhknmobkkkvvogznxdj.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaGtubW9ia2trdnZvZ3pueGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEzODYyNjcsImV4cCI6MjA2Njk2MjI2N30.vt_7kDR-6IrDYqdrMTzCo5NyFXYZQU-X_OwEtOP1u24"
  };

  console.log("🌟 HyperLiquid Updated Deployment Configuration:");
  console.log("   Network:", config.network);
  console.log("   Existing MockUSDC:", config.existingMockUSDC);
  console.log("   Gas Price:", config.gasPrice, "gwei");
  console.log("   Gas Limit:", config.gasLimit);
  console.log("   Market:", config.marketName);
  console.log("   Scaling Fixes: ENABLED");

  const deployer = new PolygonContractDeployer(config, supabaseConfig);
  
  try {
    // Deploy all contracts (excluding MockUSDC)
    const addresses = await deployer.deployAll();
    deployer.printDeploymentSummary();
    
    console.log("\n🚀 Deployment completed successfully!");
    console.log("🔗 Ready for contract verification on Polygonscan");
    
  } catch (error) {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }
}

// Handle script execution
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { PolygonContractDeployer };
