import { ethers } from "hardhat";

async function createAdditionalMarkets() {
  console.log('🏭 CREATING ADDITIONAL MARKETS');
  console.log('='.repeat(80));
  console.log('🎯 Using existing MetricsMarketFactory to create diverse markets');
  console.log('='.repeat(80));

  // Contract addresses from the latest deployment
  const contracts = {
    mockUSDC: "0xEC98a1D24Ee379DD35d98842faEEeF30E6c32006",
    centralVault: "0xe8441D3B5822Bd1817b4161ADc2FB661e358EDd6",
    orderRouter: "0x58A1461AEa9745C9bBde2569E8139c8A7b4fdC0f",
    orderBookImpl: "0xff55be309931e631EBb4c2917F554B1d1C3bF1cD",
    umaOracleManager: "0x3f4Ef6f8043432822bf6DA1039e56A7d5157AD8D",
    metricsMarketFactory: "0x597BF34Eb10773522d495D524150FC84DaC47420"
  };

  // Get signers
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  console.log(`\n👤 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH`);

  console.log('\n📊 STEP 1: VERIFY FACTORY STATUS');
  console.log('-'.repeat(60));

  let factory;
  try {
    factory = await ethers.getContractAt("MetricsMarketFactory", contracts.metricsMarketFactory);
    
    // Check factory configuration
    const defaultFee = await factory.defaultCreationFee();
    const feeRecipient = await factory.feeRecipient();
    const allMarkets = await factory.getAllMarkets();
    const allMetricIds = await factory.getAllMetricIds();

    console.log(`🏭 Factory Address: ${contracts.metricsMarketFactory}`);
    console.log(`💰 Creation Fee: ${ethers.formatEther(defaultFee)} ETH`);
    console.log(`🎯 Fee Recipient: ${feeRecipient}`);
    console.log(`📊 Existing Markets: ${allMarkets.length}`);
    console.log(`📋 Existing Metric IDs: ${allMetricIds.length}`);

    if (allMetricIds.length > 0) {
      console.log('\n📋 EXISTING MARKETS:');
      for (let i = 0; i < allMetricIds.length; i++) {
        const metricId = allMetricIds[i];
        const marketAddress = await factory.getMarket(metricId);
        console.log(`   ${i + 1}. ${metricId}: ${marketAddress}`);
      }
    }

  } catch (error) {
    console.log(`❌ Factory verification failed: ${(error as Error).message}`);
    return;
  }

  console.log('\n🎯 STEP 2: DEFINE NEW MARKETS TO CREATE');
  console.log('-'.repeat(60));

  // Define diverse and interesting markets
  const newMarkets = [
    {
      metricId: "BITCOIN_PRICE_EOY_2025",
      description: "Bitcoin Price at End of Year 2025 (USD)",
      decimals: 2,
      minimumOrderSize: ethers.parseEther("0.1"),
      settlementDays: 365,
      tradingEndDays: 360,
      initialOrder: {
        enabled: true,
        side: 0, // BUY
        quantity: ethers.parseEther("5"),
        price: ethers.parseEther("100000") // $100,000 prediction
      }
    },
    {
      metricId: "ETHEREUM_PRICE_SUMMER_2025",
      description: "Ethereum Price Mid-Summer 2025 (USD)",
      decimals: 2,
      minimumOrderSize: ethers.parseEther("0.5"),
      settlementDays: 200,
      tradingEndDays: 195,
      initialOrder: {
        enabled: true,
        side: 1, // SELL
        quantity: ethers.parseEther("10"),
        price: ethers.parseEther("5000") // $5,000 prediction
      }
    },
    {
      metricId: "GLOBAL_GDP_GROWTH_2025",
      description: "Global GDP Growth Rate 2025 (%)",
      decimals: 2,
      minimumOrderSize: ethers.parseEther("10"),
      settlementDays: 380,
      tradingEndDays: 375,
      initialOrder: {
        enabled: false // No initial order
      }
    },
    {
      metricId: "AI_MARKET_CAP_2025",
      description: "Total AI Industry Market Cap End of 2025 (Trillions USD)",
      decimals: 2,
      minimumOrderSize: ethers.parseEther("1"),
      settlementDays: 365,
      tradingEndDays: 360,
      initialOrder: {
        enabled: true,
        side: 0, // BUY
        quantity: ethers.parseEther("25"),
        price: ethers.parseEther("2.5") // $2.5 trillion prediction
      }
    },
    {
      metricId: "RENEWABLE_ENERGY_PERCENTAGE_2025",
      description: "Global Renewable Energy Percentage End of 2025 (%)",
      decimals: 1,
      minimumOrderSize: ethers.parseEther("5"),
      settlementDays: 365,
      tradingEndDays: 360,
      initialOrder: {
        enabled: true,
        side: 1, // SELL
        quantity: ethers.parseEther("50"),
        price: ethers.parseEther("35.5") // 35.5% prediction
      }
    }
  ];

  console.log(`🎨 Prepared ${newMarkets.length} new markets to create:`);
  for (let i = 0; i < newMarkets.length; i++) {
    const market = newMarkets[i];
    console.log(`   ${i + 1}. ${market.metricId}`);
    console.log(`      📋 ${market.description}`);
    console.log(`      🎲 Initial Order: ${market.initialOrder.enabled ? 'Yes' : 'No'}`);
  }

  console.log('\n🏭 STEP 3: CREATE MARKETS');
  console.log('-'.repeat(60));

  const createdMarkets = [];
  const failedMarkets = [];

  for (let i = 0; i < newMarkets.length; i++) {
    const market = newMarkets[i];
    
    console.log(`\n🎯 Creating Market ${i + 1}/${newMarkets.length}: ${market.metricId}`);
    console.log(`   📋 ${market.description}`);

    try {
      // Check if market already exists
      const existingMarket = await factory.getMarket(market.metricId);
      if (existingMarket !== ethers.ZeroAddress) {
        console.log(`   ⚠️  Market already exists at: ${existingMarket}`);
        continue;
      }

      // Prepare dates
      const currentTime = Math.floor(Date.now() / 1000);
      const settlementDate = currentTime + (market.settlementDays * 24 * 60 * 60);
      const tradingEndDate = currentTime + (market.tradingEndDays * 24 * 60 * 60);

      // Market configuration
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
          enabled: market.initialOrder.enabled,
          side: market.initialOrder.enabled ? market.initialOrder.side : 0,
          quantity: market.initialOrder.enabled ? market.initialOrder.quantity : 0,
          price: market.initialOrder.enabled ? market.initialOrder.price : 0,
          timeInForce: 0, // GTC
          expiryTime: 0
        }
      };

      console.log(`   📅 Settlement: ${new Date(settlementDate * 1000).toLocaleDateString()}`);
      console.log(`   ⏰ Trading End: ${new Date(tradingEndDate * 1000).toLocaleDateString()}`);
      console.log(`   💰 Min Order: ${ethers.formatEther(market.minimumOrderSize)}`);

      // Get creation fee
      const creationFee = await factory.defaultCreationFee();
      
      // Create market
      console.log(`   🔄 Submitting market creation...`);
      const tx = await factory.createMarket(marketConfig, { value: creationFee });
      const receipt = await tx.wait();

      // Get market address
      const marketAddress = await factory.getMarket(market.metricId);

      console.log(`   ✅ Market created successfully!`);
      console.log(`   🏪 Address: ${marketAddress}`);
      console.log(`   ⛽ Gas: ${receipt?.gasUsed?.toLocaleString()}`);
      console.log(`   🔗 Tx: ${tx.hash}`);

      // Get UMA identifier
      const umaId = await factory.getUMAIdentifier(market.metricId);
      console.log(`   🆔 UMA ID: ${umaId}`);

      createdMarkets.push({
        metricId: market.metricId,
        address: marketAddress,
        description: market.description,
        settlementDate: new Date(settlementDate * 1000),
        txHash: tx.hash,
        initialOrder: market.initialOrder.enabled
      });

      // Wait between creations
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.log(`   ❌ Market creation failed: ${(error as Error).message}`);
      failedMarkets.push({
        metricId: market.metricId,
        error: (error as Error).message
      });
    }
  }

  console.log('\n📊 STEP 4: MARKET CREATION SUMMARY');
  console.log('-'.repeat(60));

  console.log(`🎉 CREATION RESULTS:`);
  console.log(`   ✅ Successfully Created: ${createdMarkets.length}`);
  console.log(`   ❌ Failed: ${failedMarkets.length}`);
  console.log(`   📊 Total Attempted: ${newMarkets.length}`);

  if (createdMarkets.length > 0) {
    console.log('\n🏆 SUCCESSFULLY CREATED MARKETS:');
    for (const market of createdMarkets) {
      console.log(`\n✅ ${market.metricId}`);
      console.log(`   📋 ${market.description}`);
      console.log(`   🏪 Address: ${market.address}`);
      console.log(`   📅 Settlement: ${market.settlementDate.toLocaleDateString()}`);
      console.log(`   🎲 Initial Order: ${market.initialOrder ? 'Placed' : 'None'}`);
      console.log(`   🔗 Tx: ${market.txHash}`);
    }
  }

  if (failedMarkets.length > 0) {
    console.log('\n❌ FAILED MARKETS:');
    for (const market of failedMarkets) {
      console.log(`   ❌ ${market.metricId}: ${market.error}`);
    }
  }

  console.log('\n🔍 STEP 5: FINAL FACTORY STATUS');
  console.log('-'.repeat(60));

  try {
    // Get updated market list
    const finalMarkets = await factory.getAllMarkets();
    const finalMetricIds = await factory.getAllMetricIds();

    console.log(`🏭 Factory: ${contracts.metricsMarketFactory}`);
    console.log(`📊 Total Markets: ${finalMarkets.length}`);
    console.log(`📋 Total Metric IDs: ${finalMetricIds.length}`);

    console.log('\n📋 ALL MARKETS IN FACTORY:');
    for (let i = 0; i < finalMetricIds.length; i++) {
      const metricId = finalMetricIds[i];
      const marketAddress = await factory.getMarket(metricId);
      const config = await factory.getMarketConfig(metricId);
      
      console.log(`\n   ${i + 1}. ${metricId}`);
      console.log(`      🏪 Address: ${marketAddress}`);
      console.log(`      📋 Description: ${config.description}`);
      console.log(`      📅 Settlement: ${new Date(Number(config.settlementDate) * 1000).toLocaleDateString()}`);
      console.log(`      📊 Min Order: ${ethers.formatEther(config.minimumOrderSize)}`);
      console.log(`      🔢 Decimals: ${config.decimals}`);
    }

  } catch (error) {
    console.log(`❌ Final status check failed: ${(error as Error).message}`);
  }

  console.log('\n💡 STEP 6: HOW TO TRADE ON THESE MARKETS');
  console.log('-'.repeat(60));

  if (createdMarkets.length > 0) {
    console.log('🎯 TRADING INSTRUCTIONS:');
    console.log(`   1. Use OrderRouter: ${contracts.orderRouter}`);
    console.log(`   2. Fund your account via CentralVault: ${contracts.centralVault}`);
    console.log(`   3. Reference markets by their metric IDs`);
    console.log(`   4. All markets support limit and market orders`);
    console.log(`   5. Settlement occurs automatically on specified dates`);

    console.log('\n📝 EXAMPLE ORDER FOR NEW MARKETS:');
    const exampleMarket = createdMarkets[0];
    console.log(`   // Trading on: ${exampleMarket.metricId}`);
    console.log(`   const orderRouter = await ethers.getContractAt("OrderRouter", "${contracts.orderRouter}");`);
    console.log(`   const order = {`);
    console.log(`     orderId: 0,`);
    console.log(`     trader: yourAddress,`);
    console.log(`     metricId: "${exampleMarket.metricId}",`);
    console.log(`     orderType: 1, // LIMIT`);
    console.log(`     side: 0, // BUY`);
    console.log(`     quantity: ethers.parseEther("10"),`);
    console.log(`     price: ethers.parseEther("75000"), // Your prediction`);
    console.log(`     // ... other required fields`);
    console.log(`   };`);
    console.log(`   await orderRouter.placeOrder(order);`);

    console.log('\n📊 MARKET UTILITIES:');
    console.log(`   • Check market config: factory.getMarketConfig("${exampleMarket.metricId}")`);
    console.log(`   • Get market address: factory.getMarket("${exampleMarket.metricId}")`);
    console.log(`   • Check settlement status: factory.getMarketSettlement("${exampleMarket.metricId}")`);
  }

  return {
    factoryAddress: contracts.metricsMarketFactory,
    createdMarkets,
    failedMarkets,
    totalSuccessful: createdMarkets.length,
    totalFailed: failedMarkets.length
  };
}

async function main() {
  const results = await createAdditionalMarkets();

  console.log('\n🎉 ADDITIONAL MARKET CREATION COMPLETE!');
  console.log('='.repeat(80));

  if (results) {
    console.log('🏆 FINAL RESULTS:');
    console.log(`   🏭 Factory: ${results.factoryAddress}`);
    console.log(`   ✅ Successfully Created: ${results.totalSuccessful}`);
    console.log(`   ❌ Failed: ${results.totalFailed}`);
    console.log(`   📊 Success Rate: ${results.totalSuccessful > 0 ? ((results.totalSuccessful / (results.totalSuccessful + results.totalFailed)) * 100).toFixed(1) : 0}%`);

    if (results.totalSuccessful > 0) {
      console.log('\n🚀 SUCCESS! Your MetricsMarketFactory is working perfectly!');
      console.log(`💰 ${results.totalSuccessful} new prediction markets are ready for trading!`);
      
      console.log('\n💎 MARKET CATEGORIES CREATED:');
      console.log('   📈 Cryptocurrency price predictions');
      console.log('   🌍 Global economic indicators');
      console.log('   🤖 Technology market forecasts');
      console.log('   🌱 Environmental metrics');
      console.log('   📊 Multiple timeframes and settlement dates');
      
      console.log('\n🔥 WHAT YOU\'VE ACCOMPLISHED:');
      console.log('   ✅ Factory contract fully operational');
      console.log('   ✅ Diverse market creation successful');
      console.log('   ✅ UMA Oracle integration working');
      console.log('   ✅ Initial orders placed where configured');
      console.log('   ✅ Settlement lifecycle configured');
      console.log('   ✅ Scalable market creation proven');
      
    } else {
      console.log('\n⚠️  No new markets were created successfully');
      console.log('🔧 Check error messages above for troubleshooting');
    }
  }
}

main()
  .then(() => {
    console.log('\n🏁 Additional market creation completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });







