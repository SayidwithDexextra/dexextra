import { ethers } from "hardhat";

async function debugMarketRegistration() {
  console.log('🔍 DEBUGGING MARKET REGISTRATION');
  console.log('='.repeat(80));

  // Deployed contract addresses
  const contracts = {
    orderRouter: "0xfB46c35282634b578BfAd7a40A28F089B5f8430A",
    metricsMarketFactory: "0xec83CDAf6DE9A6C97363966E2Be1c7CfE680687d"
  };

  // Get signers
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  
  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`🛣️  OrderRouter: ${contracts.orderRouter}`);
  console.log(`🏭 Factory: ${contracts.metricsMarketFactory}`);

  // Get contract instances
  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
  
  const router = OrderRouter.attach(contracts.orderRouter);
  const factory = MetricsMarketFactory.attach(contracts.metricsMarketFactory);

  try {
    console.log('\n📊 FACTORY STATE:');
    console.log('-'.repeat(30));
    
    const allMarkets = await factory.getAllMarkets();
    const allMetricIds = await factory.getAllMetricIds();
    
    console.log(`📊 Factory Markets: ${allMarkets.length}`);
    console.log(`📋 Factory Metric IDs: ${allMetricIds.length}`);
    
    if (allMetricIds.length > 0) {
      console.log('📝 Metric IDs:');
      allMetricIds.forEach((id, index) => {
        console.log(`   ${index + 1}. ${id}`);
      });
    }

    console.log('\n🛣️  ROUTER STATE:');
    console.log('-'.repeat(30));
    
    // Check some common market IDs
    const testMarketIds = [
      'SILVER_V2',
      'SILVER_V2_1756338341',
      'BITCOIN_PRICE_2025',
      'ETHEREUM_PRICE_Q1_2025'
    ];
    
    for (const metricId of testMarketIds) {
      try {
        const marketAddress = await router.marketOrderBooks(metricId);
        if (marketAddress !== '0x0000000000000000000000000000000000000000') {
          console.log(`✅ ${metricId}: ${marketAddress}`);
        } else {
          console.log(`❌ ${metricId}: Not registered`);
        }
      } catch (e) {
        console.log(`❌ ${metricId}: Error checking - ${(e as Error).message}`);
      }
    }

    // Test market creation with a simple market ID
    console.log('\n🧪 TESTING SIMPLE MARKET CREATION:');
    console.log('-'.repeat(40));
    
    const testMetricId = `TEST_MARKET_${Math.floor(Date.now() / 1000)}`;
    console.log(`🎯 Test Market ID: ${testMetricId}`);
    
    // Check if test market is already registered
    const testMarketAddress = await router.marketOrderBooks(testMetricId);
    console.log(`🔍 Test market registered: ${testMarketAddress !== '0x0000000000000000000000000000000000000000'}`);
    
    if (testMarketAddress === '0x0000000000000000000000000000000000000000') {
      console.log('✅ Test market ID is available, proceeding with creation test...');
      
      // Create minimal market config
      const now = new Date();
      const settlementDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
      const tradingEndDate = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000); // 25 days
      
      const initialOrder = {
        enabled: false,
        side: 0,
        quantity: 0,
        price: 0,
        timeInForce: 0,
        expiryTime: 0
      };

      const marketConfig = {
        metricId: testMetricId,
        description: "Test Market for Debugging",
        oracleProvider: deployer.address,
        decimals: 8,
        minimumOrderSize: ethers.parseEther("1.0"),
        tickSize: ethers.parseEther("0.01"),
        creationFee: 0,
        requiresKYC: false,
        settlementDate: Math.floor(settlementDate.getTime() / 1000),
        tradingEndDate: Math.floor(tradingEndDate.getTime() / 1000),
        dataRequestWindow: 86400,
        autoSettle: true,
        initialOrder: initialOrder
      };

      console.log('🚀 Attempting to create test market...');
      
      try {
        const createTx = await factory.createMarket(marketConfig, { value: 0 });
        console.log(`✅ Test market created! TX: ${createTx.hash}`);
        
        const receipt = await createTx.wait();
        console.log(`📦 Block: ${receipt?.blockNumber}, Gas: ${receipt?.gasUsed?.toString()}`);
        
        // Check if market was registered
        const newMarketAddress = await router.marketOrderBooks(testMetricId);
        console.log(`🏪 New market address: ${newMarketAddress}`);
        
      } catch (createError) {
        console.log(`❌ Test market creation failed: ${(createError as Error).message}`);
      }
    }

  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

// Execute the script
if (require.main === module) {
  debugMarketRegistration()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('💥 Script execution failed:', error);
      process.exit(1);
    });
}

export { debugMarketRegistration };
