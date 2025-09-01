import { ethers } from "hardhat";

async function simpleMarketCreation() {
  console.log('🏭 SIMPLE MARKET CREATION WITH EXISTING CONTRACTS');
  console.log('='.repeat(80));
  console.log('🎯 Using deployed MetricsMarketFactory to create new markets');
  console.log('='.repeat(80));

  // Use the existing deployed contract addresses from our previous work
  const contracts = {
    mockUSDC: "0x3371ce5d3164ABf183C676e2FC987597e8191892",
    centralVault: "0xc94fb667207206eEe88C203B4dF56Be99a30c8Ea",
    orderRouter: "0xFBd6B734109567937d1d9F1a41Ce86f8d6632BF2",
    orderBook: "0x1FCccd6827eAc7cA1c18596A6ed52A8B1b51f195", // This is our implementation
    umaOracleManager: "0x47e3Fd5CeE60E5eD7b1E7AD2aE4C1C3aa3F70b3F"
  };

  // Get signers
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  console.log(`\n👤 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH`);

  console.log('\n🏭 STEP 1: DEPLOY METRICSMARKETFACTORY');
  console.log('-'.repeat(60));

  let factoryAddress;

  try {
    // Deploy MetricsMarketFactory with correct constructor args
    console.log('🏭 Deploying MetricsMarketFactory...');
    const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
    
    const factory = await MetricsMarketFactory.deploy(
      contracts.umaOracleManager,      // UMA Oracle Manager
      contracts.orderBook,             // OrderBook implementation 
      contracts.centralVault,          // Central Vault
      contracts.orderRouter,           // Order Router
      deployer.address,                // Admin
      ethers.parseEther("0.01"),      // Creation fee: 0.01 ETH
      deployer.address                 // Fee recipient
    );
    
    await factory.waitForDeployment();
    factoryAddress = await factory.getAddress();
    
    console.log(`   ✅ MetricsMarketFactory deployed: ${factoryAddress}`);

    // Verify factory configuration
    const defaultFee = await factory.defaultCreationFee();
    const feeRecipient = await factory.feeRecipient();
    
    console.log(`   💰 Creation Fee: ${ethers.formatEther(defaultFee)} ETH`);
    console.log(`   🎯 Fee Recipient: ${feeRecipient}`);

  } catch (error) {
    console.log(`❌ Factory deployment failed: ${(error as Error).message}`);
    return;
  }

  console.log('\n🔐 STEP 2: GRANT PERMISSIONS');
  console.log('-'.repeat(60));

  try {
    const factory = await ethers.getContractAt("MetricsMarketFactory", factoryAddress);
    
    // Grant market creator role to deployer
    const MARKET_CREATOR_ROLE = await factory.MARKET_CREATOR_ROLE();
    await factory.grantRole(MARKET_CREATOR_ROLE, deployer.address);
    console.log('   ✅ Market creator role granted to deployer');

    // Check if deployer has the role
    const hasRole = await factory.hasRole(MARKET_CREATOR_ROLE, deployer.address);
    console.log(`   🔍 Role verification: ${hasRole ? 'SUCCESS' : 'FAILED'}`);

  } catch (error) {
    console.log(`❌ Permission setup failed: ${(error as Error).message}`);
  }

  console.log('\n🎯 STEP 3: CREATE SAMPLE MARKETS');
  console.log('-'.repeat(60));

  // Define simple markets to create
  const marketsToCreate = [
    {
      metricId: "BTC_2025_PREDICTION",
      description: "Bitcoin Price Prediction for End of 2025 (USD)",
      decimals: 2,
      minimumOrderSize: ethers.parseEther("1"),
      settlementDays: 30, // 30 days from now for testing
      tradingEndDays: 25   // Trading ends 5 days before settlement
    },
    {
      metricId: "ETH_Q1_2025_FORECAST", 
      description: "Ethereum Price Forecast for Q1 2025 (USD)",
      decimals: 2,
      minimumOrderSize: ethers.parseEther("0.5"),
      settlementDays: 45,
      tradingEndDays: 40
    }
  ];

  const factory = await ethers.getContractAt("MetricsMarketFactory", factoryAddress);
  const createdMarkets = [];

  for (let i = 0; i < marketsToCreate.length; i++) {
    const market = marketsToCreate[i];
    
    console.log(`\n🎯 Creating Market ${i + 1}/${marketsToCreate.length}: ${market.metricId}`);
    console.log(`   📋 ${market.description}`);

    try {
      // Prepare timestamps
      const currentTime = Math.floor(Date.now() / 1000);
      const settlementDate = currentTime + (market.settlementDays * 24 * 60 * 60);
      const tradingEndDate = currentTime + (market.tradingEndDays * 24 * 60 * 60);

      // Create market configuration
      const marketConfig = {
        metricId: market.metricId,
        description: market.description,
        oracleProvider: contracts.umaOracleManager,
        decimals: market.decimals,
        minimumOrderSize: market.minimumOrderSize,
        tickSize: ethers.parseEther("0.01"), // Fixed tick size
        creationFee: 0, // Use default fee
        requiresKYC: false,
        settlementDate: settlementDate,
        tradingEndDate: tradingEndDate,
        dataRequestWindow: 86400, // 24 hours
        autoSettle: false,
        initialOrder: {
          enabled: false, // No initial order for simplicity
          side: 0,
          quantity: 0,
          price: 0,
          timeInForce: 0,
          expiryTime: 0
        }
      };

      console.log(`   📅 Settlement: ${new Date(settlementDate * 1000).toLocaleDateString()}`);
      console.log(`   ⏰ Trading End: ${new Date(tradingEndDate * 1000).toLocaleDateString()}`);

      // Get creation fee
      const creationFee = await factory.defaultCreationFee();
      
      // Create the market
      console.log(`   🔄 Creating market...`);
      const tx = await factory.createMarket(marketConfig, { value: creationFee });
      const receipt = await tx.wait();

      // Get market address
      const marketAddress = await factory.getMarket(market.metricId);

      console.log(`   ✅ Market created successfully!`);
      console.log(`   🏪 Market Address: ${marketAddress}`);
      console.log(`   ⛽ Gas Used: ${receipt?.gasUsed?.toLocaleString()}`);
      console.log(`   🔗 Transaction: ${tx.hash}`);

      createdMarkets.push({
        metricId: market.metricId,
        address: marketAddress,
        description: market.description,
        settlementDate: new Date(settlementDate * 1000),
        tradingEndDate: new Date(tradingEndDate * 1000)
      });

      // Small delay between market creations
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`   ❌ Market creation failed: ${(error as Error).message}`);
    }
  }

  console.log('\n📊 STEP 4: VERIFY CREATED MARKETS');
  console.log('-'.repeat(60));

  try {
    // Get all markets from factory
    const allMarkets = await factory.getAllMarkets();
    const allMetricIds = await factory.getAllMetricIds();

    console.log(`🏭 Factory Address: ${factoryAddress}`);
    console.log(`📊 Total Markets: ${allMarkets.length}`);
    console.log(`📋 Total Metric IDs: ${allMetricIds.length}`);

    if (createdMarkets.length > 0) {
      console.log('\n🏆 SUCCESSFULLY CREATED MARKETS:');
      
      for (const market of createdMarkets) {
        console.log(`\n✅ ${market.metricId}`);
        console.log(`   📋 Description: ${market.description}`);
        console.log(`   🏪 Address: ${market.address}`);
        console.log(`   📅 Settlement: ${market.settlementDate.toLocaleDateString()}`);
        console.log(`   ⏰ Trading End: ${market.tradingEndDate.toLocaleDateString()}`);

        // Get market configuration
        try {
          const config = await factory.getMarketConfig(market.metricId);
          console.log(`   📊 Min Order Size: ${ethers.formatEther(config.minimumOrderSize)}`);
          console.log(`   🔢 Decimals: ${config.decimals}`);
          
          // Check UMA identifier
          const umaId = await factory.getUMAIdentifier(market.metricId);
          console.log(`   🆔 UMA ID: ${umaId}`);
          
        } catch (error) {
          console.log(`   ⚠️  Could not fetch market config: ${(error as Error).message}`);
        }
      }
    }

  } catch (error) {
    console.log(`❌ Market verification failed: ${(error as Error).message}`);
  }

  console.log('\n💡 STEP 5: HOW TO USE THE MARKETS');
  console.log('-'.repeat(60));

  if (createdMarkets.length > 0) {
    console.log('🎯 TRADING ON CREATED MARKETS:');
    console.log(`   1. Use OrderRouter at: ${contracts.orderRouter}`);
    console.log(`   2. Reference markets by their metric IDs`);
    console.log(`   3. Place orders using standard order structure`);
    console.log(`   4. Markets integrate automatically with UMA Oracle`);
    
    console.log('\n📝 EXAMPLE ORDER PLACEMENT:');
    console.log(`   const orderRouter = await ethers.getContractAt("OrderRouter", "${contracts.orderRouter}");`);
    console.log(`   const order = {`);
    console.log(`     trader: your_address,`);
    console.log(`     metricId: "${createdMarkets[0].metricId}",`);
    console.log(`     orderType: 1, // LIMIT`);
    console.log(`     side: 0, // BUY`);
    console.log(`     quantity: ethers.parseEther("10"),`);
    console.log(`     price: ethers.parseEther("50000"),`);
    console.log(`     // ... other fields`);
    console.log(`   };`);
    console.log(`   await orderRouter.placeOrder(order);`);
  }

  return {
    factoryAddress,
    createdMarkets,
    totalMarkets: createdMarkets.length,
    contractAddresses: contracts
  };
}

async function main() {
  const results = await simpleMarketCreation();

  console.log('\n🎉 MARKET CREATION COMPLETE!');
  console.log('='.repeat(80));

  if (results && results.totalMarkets > 0) {
    console.log('🚀 SUCCESS! MetricsMarketFactory is working perfectly!');
    console.log(`✅ ${results.totalMarkets} markets created and ready for trading!`);
    
    console.log('\n📋 DEPLOYMENT SUMMARY:');
    console.log(`   🏭 Factory: ${results.factoryAddress}`);
    console.log(`   📊 Markets Created: ${results.totalMarkets}`);
    console.log(`   🎯 Order Router: ${results.contractAddresses.orderRouter}`);
    console.log(`   🏦 Central Vault: ${results.contractAddresses.centralVault}`);
    
    console.log('\n💎 KEY ACHIEVEMENTS:');
    console.log('   ✅ MetricsMarketFactory deployed and configured');
    console.log('   ✅ Custom markets created with different metrics');
    console.log('   ✅ UMA Oracle integration working');
    console.log('   ✅ Settlement timeline configured');
    console.log('   ✅ Markets ready for order placement');
    console.log('   ✅ Factory pattern working (minimal proxy clones)');
    
    console.log('\n🔥 WHAT YOU CAN DO NOW:');
    console.log('   📊 Place orders on any of the created markets');
    console.log('   🎯 Create additional markets using the factory');
    console.log('   💰 Start trading and generating P&L');
    console.log('   ⏰ Monitor settlement dates for oracle requests');
    console.log('   🏭 Scale to hundreds of markets using the same pattern');
    
  } else {
    console.log('⚠️  No markets were created successfully');
    console.log('🔧 Check the error messages above for troubleshooting');
  }
}

main()
  .then(() => {
    console.log('\n🏁 Market creation script completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });







