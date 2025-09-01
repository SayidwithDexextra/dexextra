import { ethers } from "hardhat";
import { saveMarketCreation, MarketCreationData } from './utils/supabase-client';

async function createSilverV2MarketFinal() {
  console.log('🥈 CREATING SILVER V2 MARKET - FINAL VERSION');
  console.log('='.repeat(80));
  console.log('🎯 Creating SILVER_V2 market with 0.01 tick size and Supabase integration');
  console.log('='.repeat(80));

  // Deployed contract addresses from the recent Polygon deployment
  const contracts = {
    umaOracleManager: "0x9Fc90Cd2E4345a51b55EC6ecEeDf31051Db20cD4",
    centralVault: "0x602B4B1fe6BBC10096970D4693D94376527D04ab", 
    orderRouter: "0xfB46c35282634b578BfAd7a40A28F089B5f8430A",
    orderBookImplementation: "0x053Fa4b76A8661A9FF653F58d20FA15521b1bc63",
    metricsMarketFactory: "0xec83CDAf6DE9A6C97363966E2Be1c7CfE680687d",
    mockUMAFinder: "0xFf5ca5947bf914c225b5E8A69913CB7f9790ee1e",
    mockUSDC: "0x194b4517a61D569aC8DBC47a22ed6F665B77a331"
  };

  // Get signers
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  
  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`⛽ Network: ${(await ethers.provider.getNetwork()).name} (Chain ID: ${(await ethers.provider.getNetwork()).chainId})`);

  // Get contract instances
  const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
  const OrderRouter = await ethers.getContractFactory("OrderRouter");

  const factory = MetricsMarketFactory.attach(contracts.metricsMarketFactory);
  const router = OrderRouter.attach(contracts.orderRouter);

  console.log('\n📊 STEP 1: VERIFY CONTRACT SETUP');
  console.log('-'.repeat(60));

  try {
    // Check factory configuration
    const defaultFee = await factory.defaultCreationFee();
    const allMarkets = await factory.getAllMarkets();
    
    console.log(`🏭 Factory Address: ${contracts.metricsMarketFactory}`);
    console.log(`💰 Default Creation Fee: ${ethers.formatEther(defaultFee)} MATIC`);
    console.log(`📊 Existing Markets: ${allMarkets.length}`);

  } catch (error) {
    console.log(`❌ Setup verification failed: ${(error as Error).message}`);
    return;
  }

  console.log('\n🥈 STEP 2: DEFINE SILVER V2 MARKET CONFIGURATION');
  console.log('-'.repeat(60));

  // Use a clean, simple market ID for SILVER V2
  const silverMarketConfig = {
    metricId: "SILVER_V2",
    description: "Silver Price at End of 2025 (USD per ounce) - Version 2 with automatic 0.01 tick size",
    decimals: 8,
    minimumOrderSize: ethers.parseEther("1.0"), // 1 USDC minimum
    settlementDays: 334, // End of 2025 (approximately 11 months from now)
    tradingEndDays: 329,  // Trading ends 5 days before settlement
    tickSize: "0.01", // Fixed tick size as requested
    category: "COMMODITIES",
    requiresKyc: false,
    dataRequestWindowSeconds: 86400, // 24 hours
    autoSettle: true,
    oracleProvider: deployer.address,
    initialOrder: {
      enabled: true,
      side: 0, // BUY
      quantity: ethers.parseEther("100"), // 100 USDC worth
      price: ethers.parseEther("32.50") // $32.50 prediction for silver
    }
  };

  console.log(`📊 Market ID: ${silverMarketConfig.metricId}`);
  console.log(`📝 Description: ${silverMarketConfig.description}`);
  console.log(`💰 Minimum Order Size: ${ethers.formatEther(silverMarketConfig.minimumOrderSize)} USDC`);
  console.log(`📈 Tick Size: ${silverMarketConfig.tickSize} USD`);
  console.log(`⏰ Settlement: ${silverMarketConfig.settlementDays} days from now`);
  console.log(`🛑 Trading End: ${silverMarketConfig.tradingEndDays} days from now`);

  console.log('\n🔍 STEP 3: CHECK IF MARKET ALREADY EXISTS');
  console.log('-'.repeat(60));

  try {
    // Check if SILVER_V2 already exists in router
    const existingMarket = await router.marketOrderBooks(silverMarketConfig.metricId);
    if (existingMarket !== '0x0000000000000000000000000000000000000000') {
      console.log(`⚠️  SILVER_V2 market already exists at: ${existingMarket}`);
      console.log('🎯 Using existing market for database integration...');
      
      // Save existing market to Supabase if not already there
      console.log('\n💾 SAVING EXISTING MARKET TO SUPABASE');
      console.log('-'.repeat(60));
      
      const now = new Date();
      const settlementDate = new Date(now.getTime() + silverMarketConfig.settlementDays * 24 * 60 * 60 * 1000);
      const tradingEndDate = new Date(now.getTime() + silverMarketConfig.tradingEndDays * 24 * 60 * 60 * 1000);
      
      const marketData: MarketCreationData = {
        metricId: silverMarketConfig.metricId,
        description: silverMarketConfig.description,
        category: silverMarketConfig.category,
        decimals: silverMarketConfig.decimals,
        minimumOrderSize: ethers.formatEther(silverMarketConfig.minimumOrderSize),
        requiresKyc: silverMarketConfig.requiresKyc,
        settlementDate: settlementDate,
        tradingEndDate: tradingEndDate,
        dataRequestWindowSeconds: silverMarketConfig.dataRequestWindowSeconds,
        autoSettle: silverMarketConfig.autoSettle,
        oracleProvider: silverMarketConfig.oracleProvider,
        initialOrder: {
          enabled: silverMarketConfig.initialOrder.enabled,
          side: silverMarketConfig.initialOrder.side === 0 ? 'BUY' : 'SELL',
          quantity: ethers.formatEther(silverMarketConfig.initialOrder.quantity),
          price: ethers.formatEther(silverMarketConfig.initialOrder.price),
          timeInForce: 'GTC'
        },
        creationFee: ethers.formatEther(await factory.defaultCreationFee()),
        marketAddress: existingMarket,
        factoryAddress: contracts.metricsMarketFactory,
        centralVaultAddress: contracts.centralVault,
        orderRouterAddress: contracts.orderRouter,
        umaOracleManagerAddress: contracts.umaOracleManager,
        chainId: Number((await ethers.provider.getNetwork()).chainId),
        deploymentTransactionHash: '', // Not available for existing market
        deploymentBlockNumber: 0, // Not available for existing market
        deploymentGasUsed: 0,
        creatorWalletAddress: deployer.address
      };

      const marketId = await saveMarketCreation(marketData);
      
      if (marketId) {
        console.log(`✅ Existing market saved to Supabase with ID: ${marketId}`);
      } else {
        console.log('⚠️  Market exists but failed to save to Supabase (might already be saved)`');
      }
      
      console.log('\n🎉 SILVER V2 MARKET INTEGRATION COMPLETED');
      console.log('='.repeat(80));
      console.log(`🥈 Market ID: ${silverMarketConfig.metricId}`);
      console.log(`🏪 Market Address: ${existingMarket}`);
      console.log(`📈 Tick Size: ${silverMarketConfig.tickSize} USD (automatic)`);
      console.log(`🆔 Database ID: ${marketId || 'Already exists or failed to save'}`);
      console.log(`🔗 Contract: https://polygonscan.com/address/${existingMarket}`);
      return;
    }
  } catch (error) {
    console.log(`❌ Market check failed: ${(error as Error).message}`);
  }

  console.log('\n🏗️ STEP 4: CREATE NEW SILVER V2 MARKET');
  console.log('-'.repeat(60));

  try {
    // Calculate dates
    const now = new Date();
    const settlementDate = new Date(now.getTime() + silverMarketConfig.settlementDays * 24 * 60 * 60 * 1000);
    const tradingEndDate = new Date(now.getTime() + silverMarketConfig.tradingEndDays * 24 * 60 * 60 * 1000);

    console.log(`📅 Settlement Date: ${settlementDate.toISOString()}`);
    console.log(`🛑 Trading End Date: ${tradingEndDate.toISOString()}`);

    // Prepare initial order struct
    const initialOrder = {
      enabled: silverMarketConfig.initialOrder.enabled,
      side: silverMarketConfig.initialOrder.side,
      quantity: silverMarketConfig.initialOrder.quantity,
      price: silverMarketConfig.initialOrder.price,
      timeInForce: 0, // GTC (Good Till Cancelled)
      expiryTime: 0 // No expiry for GTC
    };

    // Prepare market configuration for smart contract (includes initial order)
    const marketConfig = {
      metricId: silverMarketConfig.metricId,
      description: silverMarketConfig.description,
      oracleProvider: silverMarketConfig.oracleProvider,
      decimals: silverMarketConfig.decimals,
      minimumOrderSize: silverMarketConfig.minimumOrderSize,
      tickSize: ethers.parseEther(silverMarketConfig.tickSize), // Fixed tick size of 0.01
      creationFee: await factory.defaultCreationFee(),
      requiresKYC: silverMarketConfig.requiresKyc,
      settlementDate: Math.floor(settlementDate.getTime() / 1000),
      tradingEndDate: Math.floor(tradingEndDate.getTime() / 1000),
      dataRequestWindow: silverMarketConfig.dataRequestWindowSeconds,
      autoSettle: silverMarketConfig.autoSettle,
      initialOrder: initialOrder
    };

    console.log('\n🚀 Creating market transaction...');
    
    // Create market with value for creation fee
    const createTx = await factory.createMarket(
      marketConfig,
      { value: marketConfig.creationFee }
    );

    console.log(`📝 Transaction hash: ${createTx.hash}`);
    console.log('⏳ Waiting for transaction confirmation...');

    const receipt = await createTx.wait();
    console.log(`✅ Transaction confirmed in block ${receipt?.blockNumber}`);
    console.log(`⛽ Gas used: ${receipt?.gasUsed?.toString()}`);

    // Extract market address from events
    let marketAddress = '';
    if (receipt?.logs) {
      for (const log of receipt.logs) {
        try {
          const parsed = factory.interface.parseLog(log);
          if (parsed?.name === 'MarketCreated') {
            marketAddress = parsed.args.marketAddress;
            console.log(`🏪 Market deployed at: ${marketAddress}`);
            break;
          }
        } catch (e) {
          // Skip logs that don't match our interface
        }
      }
    }

    if (!marketAddress) {
      console.log('⚠️  Could not extract market address from transaction logs');
      return;
    }

    console.log('\n💾 STEP 5: SAVE TO SUPABASE DATABASE');
    console.log('-'.repeat(60));

    // Prepare data for Supabase
    const marketData: MarketCreationData = {
      metricId: silverMarketConfig.metricId,
      description: silverMarketConfig.description,
      category: silverMarketConfig.category,
      decimals: silverMarketConfig.decimals,
      minimumOrderSize: ethers.formatEther(silverMarketConfig.minimumOrderSize),
      requiresKyc: silverMarketConfig.requiresKyc,
      settlementDate: settlementDate,
      tradingEndDate: tradingEndDate,
      dataRequestWindowSeconds: silverMarketConfig.dataRequestWindowSeconds,
      autoSettle: silverMarketConfig.autoSettle,
      oracleProvider: silverMarketConfig.oracleProvider,
      initialOrder: {
        enabled: silverMarketConfig.initialOrder.enabled,
        side: silverMarketConfig.initialOrder.side === 0 ? 'BUY' : 'SELL',
        quantity: ethers.formatEther(silverMarketConfig.initialOrder.quantity),
        price: ethers.formatEther(silverMarketConfig.initialOrder.price),
        timeInForce: 'GTC'
      },
      creationFee: ethers.formatEther(marketConfig.creationFee),
      marketAddress: marketAddress,
      factoryAddress: contracts.metricsMarketFactory,
      centralVaultAddress: contracts.centralVault,
      orderRouterAddress: contracts.orderRouter,
      umaOracleManagerAddress: contracts.umaOracleManager,
      chainId: Number((await ethers.provider.getNetwork()).chainId),
      deploymentTransactionHash: createTx.hash,
      deploymentBlockNumber: receipt?.blockNumber || 0,
      deploymentGasUsed: Number(receipt?.gasUsed?.toString() || 0),
      creatorWalletAddress: deployer.address
    };

    console.log('💾 Saving market data to Supabase...');
    const marketId = await saveMarketCreation(marketData);

    if (marketId) {
      console.log(`✅ Market successfully saved to Supabase with ID: ${marketId}`);
    } else {
      console.log('⚠️  Market created on blockchain but failed to save to Supabase');
    }

    console.log('\n🎉 SILVER V2 MARKET CREATION COMPLETED');
    console.log('='.repeat(80));
    console.log(`🥈 Market ID: ${silverMarketConfig.metricId}`);
    console.log(`🏪 Market Address: ${marketAddress}`);
    console.log(`📊 Factory Address: ${contracts.metricsMarketFactory}`);
    console.log(`💰 Creation Fee Paid: ${ethers.formatEther(marketConfig.creationFee)} MATIC`);
    console.log(`📈 Tick Size: ${silverMarketConfig.tickSize} USD (automatic)`);
    console.log(`🆔 Database ID: ${marketId || 'Not saved'}`);
    console.log(`🔗 Transaction: https://polygonscan.com/tx/${createTx.hash}`);
    console.log(`🏪 Contract: https://polygonscan.com/address/${marketAddress}`);

    // Verify the market was created correctly
    console.log('\n🔍 STEP 6: VERIFY MARKET CREATION');
    console.log('-'.repeat(60));

    try {
      const newMarkets = await factory.getAllMarkets();
      const silverMarketExists = await router.marketOrderBooks(silverMarketConfig.metricId);
      
      console.log(`📊 Total markets after creation: ${newMarkets.length}`);
      console.log(`🥈 SILVER_V2 registered in router: ${silverMarketExists !== '0x0000000000000000000000000000000000000000'}`);
      console.log(`🏪 Router registered address: ${silverMarketExists}`);

    } catch (error) {
      console.log(`⚠️  Market verification failed: ${(error as Error).message}`);
    }

  } catch (error) {
    console.error('❌ Market creation failed:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('MetricAlreadyExists')) {
        console.log('💡 Suggestion: SILVER_V2 market already exists. Try a different metric ID like SILVER_V3');
      } else if (error.message.includes('insufficient funds')) {
        console.log('💡 Suggestion: Add more MATIC to your wallet for gas fees');
      } else if (error.message.includes('Market already registered')) {
        console.log('💡 The market is already registered in the router but not in the factory. This is unusual.');
      }
    }
  }
}

// Execute the script
if (require.main === module) {
  createSilverV2MarketFinal()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('💥 Script execution failed:', error);
      process.exit(1);
    });
}

export { createSilverV2MarketFinal };
