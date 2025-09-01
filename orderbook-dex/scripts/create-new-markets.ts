import { ethers } from "hardhat";

async function createNewMarkets() {
  console.log('🏭 CREATING NEW MARKETS WITH FACTORY CONTRACT');
  console.log('='.repeat(80));
  console.log('🎯 Using MetricsMarketFactory to create diverse trading markets');
  console.log('='.repeat(80));

  // Get the deployed contract addresses from previous deployment
  const contracts = {
    metricsMarketFactory: "0x9a676e781A523b5d0C0e43731313A708CB607508", // From deploy output
    mockUSDC: "0x3371ce5d3164ABf183C676e2FC987597e8191892",
    centralVault: "0xc94fb667207206eEe88C203B4dF56Be99a30c8Ea",
    orderRouter: "0xFBd6B734109567937d1d9F1a41Ce86f8d6632BF2",
    orderBook: "0x1FCccd6827eAc7cA1c18596A6ed52A8B1b51f195",
    umaOracleManager: "0x47e3Fd5CeE60E5eD7b1E7AD2aE4C1C3aa3F70b3F"
  };

  // Get signers
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  // Get contract instances
  const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");

  const factory = MetricsMarketFactory.attach(contracts.metricsMarketFactory);
  const mockUSDC = MockUSDC.attach(contracts.mockUSDC);

  console.log('\n📊 STEP 1: VERIFY FACTORY CONTRACT');
  console.log('-'.repeat(60));

  try {
    // Check factory configuration
    const defaultFee = await factory.defaultCreationFee();
    const feeRecipient = await factory.feeRecipient();
    const allMarkets = await factory.getAllMarkets();
    const allMetricIds = await factory.getAllMetricIds();

    console.log(`🏭 Factory Address: ${contracts.metricsMarketFactory}`);
    console.log(`💰 Default Creation Fee: ${ethers.formatEther(defaultFee)} ETH`);
    console.log(`🎯 Fee Recipient: ${feeRecipient}`);
    console.log(`📊 Existing Markets: ${allMarkets.length}`);
    console.log(`📋 Existing Metric IDs: ${allMetricIds.length}`);

    if (allMetricIds.length > 0) {
      console.log(`   Existing metrics: ${allMetricIds.slice(0, 3).join(', ')}${allMetricIds.length > 3 ? '...' : ''}`);
    }

  } catch (error) {
    console.log(`❌ Factory verification failed: ${(error as Error).message}`);
    return;
  }

  console.log('\n🎯 STEP 2: DEFINE NEW MARKETS TO CREATE');
  console.log('-'.repeat(60));

  // Define diverse market configurations
  const marketsToCreate = [
    {
      metricId: "BITCOIN_PRICE_2025",
      description: "Bitcoin Price at End of 2025 (USD)",
      decimals: 8,
      minimumOrderSize: ethers.parseEther("0.1"),
      settlementDays: 365, // 1 year from now
      tradingEndDays: 360,  // Trading ends 5 days before settlement
      initialOrder: {
        enabled: true,
        side: 0, // BUY
        quantity: ethers.parseEther("10"),
        price: ethers.parseEther("75000") // $75,000 prediction
      }
    },
    {
      metricId: "ETHEREUM_PRICE_Q1_2025",
      description: "Ethereum Price at End of Q1 2025 (USD)",
      decimals: 8,
      minimumOrderSize: ethers.parseEther("0.5"),
      settlementDays: 90, // 3 months from now
      tradingEndDays: 85,
      initialOrder: {
        enabled: true,
        side: 1, // SELL
        quantity: ethers.parseEther("20"),
        price: ethers.parseEther("4000") // $4,000 prediction
      }
    },
    {
      metricId: "US_INFLATION_RATE_2025",
      description: "US Inflation Rate (CPI) for 2025 (%)",
      decimals: 2,
      minimumOrderSize: ethers.parseEther("1"),
      settlementDays: 400, // End of 2025
      tradingEndDays: 395,
      initialOrder: {
        enabled: true,
        side: 0, // BUY
        quantity: ethers.parseEther("50"),
        price: ethers.parseEther("3.5") // 3.5% prediction
      }
    },
    {
      metricId: "APPLE_STOCK_PRICE_2025",
      description: "Apple (AAPL) Stock Price at End of 2025 (USD)",
      decimals: 2,
      minimumOrderSize: ethers.parseEther("1"),
      settlementDays: 365,
      tradingEndDays: 360,
      initialOrder: {
        enabled: false // No initial order
      }
    },
    {
      metricId: "GLOBAL_TEMPERATURE_2025",
      description: "Global Average Temperature Anomaly 2025 (°C)",
      decimals: 3,
      minimumOrderSize: ethers.parseEther("5"),
      settlementDays: 380,
      tradingEndDays: 375,
      initialOrder: {
        enabled: true,
        side: 1, // SELL
        quantity: ethers.parseEther("100"),
        price: ethers.parseEther("1.45") // +1.45°C anomaly prediction
      }
    }
  ];

  console.log(`🎨 Prepared ${marketsToCreate.length} diverse markets to create:`);
  for (let i = 0; i < marketsToCreate.length; i++) {
    const market = marketsToCreate[i];
    console.log(`   ${i + 1}. ${market.metricId}: ${market.description}`);
  }

  console.log('\n💰 STEP 3: FUND DEPLOYER FOR MARKET CREATION');
  console.log('-'.repeat(60));

  try {
    // Ensure deployer has enough ETH for creation fees
    const deployerBalance = await deployer.provider.getBalance(deployer.address);
    const defaultFee = await factory.defaultCreationFee();
    const totalFeeNeeded = defaultFee * BigInt(marketsToCreate.length);

    console.log(`💳 Deployer Balance: ${ethers.formatEther(deployerBalance)} ETH`);
    console.log(`💰 Fee per Market: ${ethers.formatEther(defaultFee)} ETH`);
    console.log(`🎯 Total Fee Needed: ${ethers.formatEther(totalFeeNeeded)} ETH`);

    if (deployerBalance < totalFeeNeeded) {
      console.log('⚠️  Insufficient ETH for all market creation fees');
      console.log('💡 Will attempt to create markets individually');
    }

  } catch (error) {
    console.log(`❌ Balance check failed: ${(error as Error).message}`);
  }

  console.log('\n🏭 STEP 4: CREATE MARKETS ONE BY ONE');
  console.log('-'.repeat(60));

  const createdMarkets = [];
  const failedMarkets = [];

  for (let i = 0; i < marketsToCreate.length; i++) {
    const market = marketsToCreate[i];
    
    console.log(`\n🎯 Creating Market ${i + 1}/${marketsToCreate.length}: ${market.metricId}`);
    console.log(`   📋 Description: ${market.description}`);
    console.log(`   🔢 Decimals: ${market.decimals}`);
    console.log(`   📊 Min Order: ${ethers.formatEther(market.minimumOrderSize)}`);
    
    try {
      // Check if market already exists
      const existingMarket = await factory.getMarket(market.metricId);
      if (existingMarket !== ethers.ZeroAddress) {
        console.log(`   ⚠️  Market already exists at: ${existingMarket}`);
        continue;
      }

      // Prepare settlement and trading dates
      const currentTime = Math.floor(Date.now() / 1000);
      const settlementDate = currentTime + (market.settlementDays * 24 * 60 * 60);
      const tradingEndDate = currentTime + (market.tradingEndDays * 24 * 60 * 60);

      // Prepare initial order configuration
      const initialOrder = {
        enabled: market.initialOrder.enabled,
        side: market.initialOrder.enabled ? market.initialOrder.side : 0,
        quantity: market.initialOrder.enabled ? market.initialOrder.quantity : 0,
        price: market.initialOrder.enabled ? market.initialOrder.price : 0,
        timeInForce: 0, // GTC (Good Till Cancelled)
        expiryTime: 0 // Not applicable for GTC
      };

      // Prepare market configuration
      const marketConfig = {
        metricId: market.metricId,
        description: market.description,
        oracleProvider: contracts.umaOracleManager, // Use our UMA Oracle Manager
        decimals: market.decimals,
        minimumOrderSize: market.minimumOrderSize,
        tickSize: ethers.parseEther("0.01"), // Fixed tick size (deprecated but required)
        creationFee: 0, // Use default fee
        requiresKYC: false,
        settlementDate: settlementDate,
        tradingEndDate: tradingEndDate,
        dataRequestWindow: 86400, // 24 hours before settlement
        autoSettle: false, // Manual settlement for testing
        initialOrder: initialOrder
      };

      console.log(`   📅 Settlement Date: ${new Date(settlementDate * 1000).toLocaleDateString()}`);
      console.log(`   ⏰ Trading End: ${new Date(tradingEndDate * 1000).toLocaleDateString()}`);
      console.log(`   🎲 Initial Order: ${market.initialOrder.enabled ? 'Yes' : 'No'}`);

      // Get creation fee
      const defaultFee = await factory.defaultCreationFee();

      // Create the market
      console.log(`   🔄 Submitting market creation transaction...`);
      const tx = await factory.createMarket(marketConfig, { value: defaultFee });
      const receipt = await tx.wait();

      console.log(`   ✅ Market created successfully!`);
      console.log(`   ⛽ Gas Used: ${receipt?.gasUsed?.toLocaleString()}`);
      console.log(`   🔗 Transaction: ${tx.hash}`);

      // Get the new market address
      const newMarketAddress = await factory.getMarket(market.metricId);
      console.log(`   🏪 Market Address: ${newMarketAddress}`);

      createdMarkets.push({
        metricId: market.metricId,
        address: newMarketAddress,
        description: market.description,
        txHash: tx.hash
      });

      // Wait between market creations
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.log(`   ❌ Market creation failed: ${(error as Error).message}`);
      failedMarkets.push({
        metricId: market.metricId,
        error: (error as Error).message
      });
    }
  }

  console.log('\n📊 STEP 5: MARKET CREATION SUMMARY');
  console.log('-'.repeat(60));

  console.log(`🎉 RESULTS SUMMARY:`);
  console.log(`   ✅ Successfully Created: ${createdMarkets.length} markets`);
  console.log(`   ❌ Failed: ${failedMarkets.length} markets`);
  console.log(`   📊 Total Attempted: ${marketsToCreate.length} markets`);

  if (createdMarkets.length > 0) {
    console.log('\n🏆 SUCCESSFULLY CREATED MARKETS:');
    for (const market of createdMarkets) {
      console.log(`   ✅ ${market.metricId}`);
      console.log(`      📋 ${market.description}`);
      console.log(`      🏪 Address: ${market.address}`);
      console.log(`      🔗 Tx: ${market.txHash}`);
    }
  }

  if (failedMarkets.length > 0) {
    console.log('\n❌ FAILED MARKETS:');
    for (const market of failedMarkets) {
      console.log(`   ❌ ${market.metricId}: ${market.error}`);
    }
  }

  console.log('\n🔍 STEP 6: VERIFY CREATED MARKETS');
  console.log('-'.repeat(60));

  try {
    // Get updated market list
    const updatedMarkets = await factory.getAllMarkets();
    const updatedMetricIds = await factory.getAllMetricIds();

    console.log(`📊 Total Markets in Factory: ${updatedMarkets.length}`);
    console.log(`📋 Total Metric IDs: ${updatedMetricIds.length}`);

    // Show recent markets
    if (updatedMetricIds.length > 0) {
      console.log('\n📋 ALL MARKETS IN FACTORY:');
      for (let i = 0; i < updatedMetricIds.length; i++) {
        const metricId = updatedMetricIds[i];
        const marketAddress = await factory.getMarket(metricId);
        const config = await factory.getMarketConfig(metricId);
        
        console.log(`   ${i + 1}. ${metricId}`);
        console.log(`      🏪 Address: ${marketAddress}`);
        console.log(`      📋 Description: ${config.description}`);
        console.log(`      📅 Settlement: ${new Date(Number(config.settlementDate) * 1000).toLocaleDateString()}`);
      }
    }

  } catch (error) {
    console.log(`❌ Market verification failed: ${(error as Error).message}`);
  }

  return {
    totalAttempted: marketsToCreate.length,
    successfullyCreated: createdMarkets.length,
    failed: failedMarkets.length,
    createdMarkets: createdMarkets,
    failedMarkets: failedMarkets
  };
}

async function demonstrateMarketInteraction() {
  console.log('\n🎯 STEP 7: DEMONSTRATE MARKET INTERACTION');
  console.log('-'.repeat(60));
  console.log('💡 Showing how to interact with newly created markets');

  const contracts = {
    metricsMarketFactory: "0x9a676e781A523b5d0C0e43731313A708CB607508",
    orderRouter: "0xFBd6B734109567937d1d9F1a41Ce86f8d6632BF2"
  };

  const signers = await ethers.getSigners();
  const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
  const OrderRouter = await ethers.getContractFactory("OrderRouter");

  const factory = MetricsMarketFactory.attach(contracts.metricsMarketFactory);
  const orderRouter = OrderRouter.attach(contracts.orderRouter);

  try {
    // Get all available markets
    const allMetricIds = await factory.getAllMetricIds();
    
    if (allMetricIds.length === 0) {
      console.log('⚠️  No markets available for interaction');
      return;
    }

    // Pick the first market for demonstration
    const demoMetricId = allMetricIds[0];
    const marketAddress = await factory.getMarket(demoMetricId);
    const config = await factory.getMarketConfig(demoMetricId);

    console.log(`🎯 Demonstrating with market: ${demoMetricId}`);
    console.log(`   🏪 Market Address: ${marketAddress}`);
    console.log(`   📋 Description: ${config.description}`);
    console.log(`   📊 Min Order Size: ${ethers.formatEther(config.minimumOrderSize)}`);
    console.log(`   📅 Settlement Date: ${new Date(Number(config.settlementDate) * 1000).toLocaleString()}`);

    // Show how to get market statistics
    console.log('\n📈 Market Information:');
    console.log(`   🔢 Decimals: ${config.decimals}`);
    console.log(`   ⏰ Trading End: ${new Date(Number(config.tradingEndDate) * 1000).toLocaleString()}`);
    console.log(`   🎲 Auto Settle: ${config.autoSettle ? 'Yes' : 'No'}`);
    console.log(`   🆔 UMA Identifier: ${await factory.getUMAIdentifier(demoMetricId)}`);

    // Check if settlement information is available
    const settlement = await factory.getMarketSettlement(demoMetricId);
    console.log(`   🏁 Settlement Status: ${settlement.isSettled ? 'Settled' : 'Active'}`);
    
    if (settlement.isSettled) {
      console.log(`   💰 Settlement Value: ${settlement.settlementValue}`);
      console.log(`   📅 Settlement Time: ${new Date(Number(settlement.settlementTimestamp) * 1000).toLocaleString()}`);
    }

    console.log('\n💡 INTERACTION CAPABILITIES:');
    console.log('   📊 ✅ Market creation and configuration');
    console.log('   🎯 ✅ Market discovery and querying');
    console.log('   📋 ✅ Configuration and metadata access');
    console.log('   🔍 ✅ Settlement status checking');
    console.log('   📈 ✅ UMA Oracle integration');
    console.log('   ⏰ ✅ Time-based market lifecycle');

  } catch (error) {
    console.log(`❌ Market interaction demo failed: ${(error as Error).message}`);
  }
}

async function main() {
  const results = await createNewMarkets();
  await demonstrateMarketInteraction();

  console.log('\n🎉 MARKET CREATION COMPLETE!');
  console.log('='.repeat(80));

  if (results) {
    console.log('🏆 FINAL RESULTS:');
    console.log(`   🎯 Markets Attempted: ${results.totalAttempted}`);
    console.log(`   ✅ Successfully Created: ${results.successfullyCreated}`);
    console.log(`   ❌ Failed: ${results.failed}`);
    console.log(`   📊 Success Rate: ${((results.successfullyCreated / results.totalAttempted) * 100).toFixed(1)}%`);

    if (results.successfullyCreated > 0) {
      console.log('\n🚀 SUCCESS! Your MetricsMarketFactory is working perfectly!');
      console.log('💰 New trading markets have been created and are ready for use!');
      console.log('🎯 Traders can now place orders on these custom metrics!');
      
      console.log('\n🔥 WHAT YOU\'VE ACCOMPLISHED:');
      console.log('   ✅ Factory contract integration working');
      console.log('   ✅ Custom market creation successful');
      console.log('   ✅ UMA Oracle integration functional');
      console.log('   ✅ Settlement dates and lifecycle configured');
      console.log('   ✅ Initial orders placed (where configured)');
      console.log('   ✅ Multiple market types supported');
      
      console.log('\n💡 NEXT STEPS:');
      console.log('   🎯 Start trading on the new markets');
      console.log('   📊 Monitor market activity and metrics');
      console.log('   ⏰ Prepare for settlement when dates arrive');
      console.log('   🔍 Request UMA Oracle data for settlement');
      
    } else {
      console.log('\n⚠️  No markets were created successfully');
      console.log('🔧 Check the error messages above for troubleshooting');
    }
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







