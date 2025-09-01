import { ethers } from "hardhat";

async function createSilverV2Unique() {
  console.log('🥈 CREATING SILVER V2 MARKET WITH UNIQUE NAME');
  console.log('='.repeat(80));

  // Deployed contract addresses
  const contracts = {
    umaOracleManager: "0x9Fc90Cd2E4345a51b55EC6ecEeDf31051Db20cD4",
    centralVault: "0x602B4B1fe6BBC10096970D4693D94376527D04ab", 
    orderRouter: "0xfB46c35282634b578BfAd7a40A28F089B5f8430A",
    orderBookImplementation: "0x053Fa4b76A8661A9FF653F58d20FA15521b1bc63",
    metricsMarketFactory: "0xec83CDAf6DE9A6C97363966E2Be1c7CfE680687d"
  };

  // Get signers
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  
  console.log(`👤 Deployer: ${deployer.address}`);

  // Get contract instances
  const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
  const factory = MetricsMarketFactory.attach(contracts.metricsMarketFactory);

  // Use timestamp for unique market ID
  const timestamp = Math.floor(Date.now() / 1000);
  const marketId = `SILVER_V2_AUTO_TICK_${timestamp}`;
  
  console.log(`🎯 Creating market: ${marketId}`);
  console.log(`📈 Features: Automatic 0.01 tick size, Polygon mainnet`);

  try {
    // Calculate dates
    const now = new Date();
    const settlementDate = new Date(now.getTime() + 334 * 24 * 60 * 60 * 1000); // 334 days
    const tradingEndDate = new Date(now.getTime() + 329 * 24 * 60 * 60 * 1000); // 329 days

    // Prepare initial order struct
    const initialOrder = {
      enabled: true,
      side: 0, // BUY
      quantity: ethers.parseEther("100"), // 100 USDC worth
      price: ethers.parseEther("32.50"), // $32.50 prediction for silver
      timeInForce: 0, // GTC
      expiryTime: 0 // No expiry for GTC
    };

    // Prepare market configuration
    const marketConfig = {
      metricId: marketId,
      description: "Silver Price at End of 2025 (USD per ounce) - V2 with automatic 0.01 tick size",
      oracleProvider: deployer.address,
      decimals: 8,
      minimumOrderSize: ethers.parseEther("1.0"),
      tickSize: ethers.parseEther("0.01"), // Automatic 0.01 tick size
      creationFee: 0,
      requiresKYC: false,
      settlementDate: Math.floor(settlementDate.getTime() / 1000),
      tradingEndDate: Math.floor(tradingEndDate.getTime() / 1000),
      dataRequestWindow: 86400, // 24 hours
      autoSettle: true,
      initialOrder: initialOrder
    };

    console.log('\n🚀 Creating market transaction...');
    
    const createTx = await factory.createMarket(marketConfig, { value: 0 });
    console.log(`📝 Transaction hash: ${createTx.hash}`);
    
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

    console.log('\n🎉 SILVER V2 MARKET CREATED SUCCESSFULLY');
    console.log('='.repeat(80));
    console.log(`🥈 Market ID: ${marketId}`);
    console.log(`🏪 Market Address: ${marketAddress}`);
    console.log(`📈 Tick Size: 0.01 USD (automatic)`);
    console.log(`💰 Initial Order: 100 USDC BUY at $32.50`);
    console.log(`📅 Settlement: ${settlementDate.toISOString()}`);
    console.log(`🔗 Transaction: https://polygonscan.com/tx/${createTx.hash}`);
    console.log(`🏪 Contract: https://polygonscan.com/address/${marketAddress}`);

    // Return data for Supabase integration
    return {
      success: true,
      marketId,
      marketAddress,
      transactionHash: createTx.hash,
      blockNumber: receipt?.blockNumber || 0,
      gasUsed: Number(receipt?.gasUsed?.toString() || 0),
      settlementDate,
      tradingEndDate,
      deployerAddress: deployer.address
    };

  } catch (error) {
    console.error('❌ Market creation failed:', error);
    return { success: false, error: (error as Error).message };
  }
}

// Execute the script
if (require.main === module) {
  createSilverV2Unique()
    .then((result) => {
      if (result.success) {
        console.log('✅ Market creation completed successfully');
      } else {
        console.log('❌ Market creation failed');
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Script execution failed:', error);
      process.exit(1);
    });
}

export { createSilverV2Unique };
