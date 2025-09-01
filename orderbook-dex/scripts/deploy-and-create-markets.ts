import { ethers } from "hardhat";

async function deployAndCreateMarkets() {
  console.log('🚀 DEPLOY CONTRACTS AND CREATE MARKETS');
  console.log('='.repeat(80));
  console.log('🎯 Complete deployment and market creation workflow');
  console.log('='.repeat(80));

  // Get signers
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  console.log(`\n👤 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH`);

  console.log('\n🔧 STEP 1: DEPLOY CORE CONTRACTS');
  console.log('-'.repeat(60));

  let deployedContracts = {};

  try {
    // Deploy MockUSDC
    console.log('💰 Deploying MockUSDC...');
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy("Mock USDC", "USDC", 6);
    await mockUSDC.waitForDeployment();
    deployedContracts.mockUSDC = await mockUSDC.getAddress();
    console.log(`   ✅ MockUSDC: ${deployedContracts.mockUSDC}`);

    // Deploy MockUMAFinder
    console.log('🔍 Deploying MockUMAFinder...');
    const MockUMAFinder = await ethers.getContractFactory("MockUMAFinder");
    const mockUMAFinder = await MockUMAFinder.deploy();
    await mockUMAFinder.waitForDeployment();
    deployedContracts.mockUMAFinder = await mockUMAFinder.getAddress();
    console.log(`   ✅ MockUMAFinder: ${deployedContracts.mockUMAFinder}`);

    // Deploy UMAOracleManager
    console.log('🏛️ Deploying UMAOracleManager...');
    const UMAOracleManager = await ethers.getContractFactory("UMAOracleManager");
    const umaOracleManager = await UMAOracleManager.deploy(
      deployedContracts.mockUMAFinder,
      deployedContracts.mockUSDC, // Bond currency
      ethers.parseEther("1000"), // Min bond
      ethers.parseEther("100"),  // Default reward
      7200 // Default liveness (2 hours)
    );
    await umaOracleManager.waitForDeployment();
    deployedContracts.umaOracleManager = await umaOracleManager.getAddress();
    console.log(`   ✅ UMAOracleManager: ${deployedContracts.umaOracleManager}`);

    // Deploy CentralVault
    console.log('🏦 Deploying CentralVault...');
    const CentralVault = await ethers.getContractFactory("CentralVault");
    const centralVault = await CentralVault.deploy(
      deployedContracts.mockUSDC, // Primary collateral
      deployer.address, // Admin
      20 // 0.2% trading fee
    );
    await centralVault.waitForDeployment();
    deployedContracts.centralVault = await centralVault.getAddress();
    console.log(`   ✅ CentralVault: ${deployedContracts.centralVault}`);

    // Deploy OrderBook implementation
    console.log('📊 Deploying OrderBook implementation...');
    const OrderBook = await ethers.getContractFactory("OrderBook");
    const orderBookImpl = await OrderBook.deploy();
    await orderBookImpl.waitForDeployment();
    deployedContracts.orderBookImpl = await orderBookImpl.getAddress();
    console.log(`   ✅ OrderBook Implementation: ${deployedContracts.orderBookImpl}`);

    // Deploy OrderRouter
    console.log('🎯 Deploying OrderRouter...');
    const OrderRouter = await ethers.getContractFactory("OrderRouter");
    const orderRouter = await OrderRouter.deploy(
      deployedContracts.centralVault,
      deployer.address
    );
    await orderRouter.waitForDeployment();
    deployedContracts.orderRouter = await orderRouter.getAddress();
    console.log(`   ✅ OrderRouter: ${deployedContracts.orderRouter}`);

    // Deploy MetricsMarketFactory
    console.log('🏭 Deploying MetricsMarketFactory...');
    const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
    const factory = await MetricsMarketFactory.deploy(
      deployedContracts.umaOracleManager,
      deployedContracts.orderBookImpl,
      deployedContracts.centralVault,
      deployedContracts.orderRouter,
      deployer.address, // Admin
      ethers.parseEther("0.01"), // 0.01 ETH creation fee
      deployer.address // Fee recipient
    );
    await factory.waitForDeployment();
    deployedContracts.factory = await factory.getAddress();
    console.log(`   ✅ MetricsMarketFactory: ${deployedContracts.factory}`);

    console.log('\n✅ All contracts deployed successfully!');

  } catch (error) {
    console.log(`❌ Deployment failed: ${(error as Error).message}`);
    return;
  }

  console.log('\n🔗 STEP 2: CONFIGURE CONTRACT INTERACTIONS');
  console.log('-'.repeat(60));

  try {
    // Get contract instances
    const centralVault = await ethers.getContractAt("CentralVault", deployedContracts.centralVault);
    const orderRouter = await ethers.getContractAt("OrderRouter", deployedContracts.orderRouter);
    const factory = await ethers.getContractAt("MetricsMarketFactory", deployedContracts.factory);

    // Set up authorizations
    console.log('🔐 Setting up contract authorizations...');
    
    // Authorize OrderRouter with CentralVault
    await centralVault.setMarketAuthorization(deployedContracts.orderRouter, true);
    console.log('   ✅ OrderRouter authorized with CentralVault');

    // Grant market creator role to deployer
    const MARKET_CREATOR_ROLE = await factory.MARKET_CREATOR_ROLE();
    await factory.grantRole(MARKET_CREATOR_ROLE, deployer.address);
    console.log('   ✅ Market creator role granted to deployer');

    console.log('✅ Contract configuration complete!');

  } catch (error) {
    console.log(`❌ Configuration failed: ${(error as Error).message}`);
  }

  console.log('\n🎯 STEP 3: CREATE DIVERSE MARKETS');
  console.log('-'.repeat(60));

  // Define markets to create
  const marketsToCreate = [
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
        price: ethers.parseEther("80000") // $80,000 prediction
      }
    },
    {
      metricId: "ETHEREUM_Q2_2025_PRICE",
      description: "Ethereum Price at End of Q2 2025 (USD)",
      decimals: 2,
      minimumOrderSize: ethers.parseEther("0.5"),
      settlementDays: 180,
      tradingEndDays: 175,
      initialOrder: {
        enabled: true,
        side: 1, // SELL
        quantity: ethers.parseEther("10"),
        price: ethers.parseEther("4500") // $4,500 prediction
      }
    },
    {
      metricId: "INFLATION_RATE_US_2025",
      description: "US Annual Inflation Rate 2025 (%)",
      decimals: 2,
      minimumOrderSize: ethers.parseEther("1"),
      settlementDays: 400,
      tradingEndDays: 395,
      initialOrder: {
        enabled: false
      }
    },
    {
      metricId: "TESLA_STOCK_EOY_2025",
      description: "Tesla (TSLA) Stock Price End of 2025 (USD)",
      decimals: 2,
      minimumOrderSize: ethers.parseEther("1"),
      settlementDays: 365,
      tradingEndDays: 360,
      initialOrder: {
        enabled: true,
        side: 0, // BUY
        quantity: ethers.parseEther("20"),
        price: ethers.parseEther("300") // $300 prediction
      }
    }
  ];

  const factory = await ethers.getContractAt("MetricsMarketFactory", deployedContracts.factory);
  const createdMarkets = [];

  for (let i = 0; i < marketsToCreate.length; i++) {
    const market = marketsToCreate[i];
    
    console.log(`\n🎯 Creating Market ${i + 1}/${marketsToCreate.length}: ${market.metricId}`);
    console.log(`   📋 ${market.description}`);

    try {
      // Prepare dates
      const currentTime = Math.floor(Date.now() / 1000);
      const settlementDate = currentTime + (market.settlementDays * 24 * 60 * 60);
      const tradingEndDate = currentTime + (market.tradingEndDays * 24 * 60 * 60);

      // Prepare market configuration
      const marketConfig = {
        metricId: market.metricId,
        description: market.description,
        oracleProvider: deployedContracts.umaOracleManager,
        decimals: market.decimals,
        minimumOrderSize: market.minimumOrderSize,
        tickSize: ethers.parseEther("0.01"), // Fixed
        creationFee: 0, // Use default
        requiresKYC: false,
        settlementDate: settlementDate,
        tradingEndDate: tradingEndDate,
        dataRequestWindow: 86400,
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

      // Get creation fee
      const creationFee = await factory.defaultCreationFee();
      
      // Create market
      const tx = await factory.createMarket(marketConfig, { value: creationFee });
      const receipt = await tx.wait();

      // Get market address
      const marketAddress = await factory.getMarket(market.metricId);

      console.log(`   ✅ Market created successfully!`);
      console.log(`   🏪 Address: ${marketAddress}`);
      console.log(`   ⛽ Gas: ${receipt?.gasUsed?.toLocaleString()}`);
      console.log(`   🔗 Tx: ${tx.hash}`);

      createdMarkets.push({
        metricId: market.metricId,
        address: marketAddress,
        description: market.description
      });

    } catch (error) {
      console.log(`   ❌ Failed: ${(error as Error).message}`);
    }
  }

  console.log('\n📊 STEP 4: MARKET CREATION SUMMARY');
  console.log('-'.repeat(60));

  console.log(`🎉 Successfully created ${createdMarkets.length}/${marketsToCreate.length} markets!`);

  if (createdMarkets.length > 0) {
    console.log('\n🏆 CREATED MARKETS:');
    for (const market of createdMarkets) {
      console.log(`   ✅ ${market.metricId}`);
      console.log(`      📋 ${market.description}`);
      console.log(`      🏪 ${market.address}`);
    }

    // Verify markets in factory
    console.log('\n🔍 Verifying markets in factory...');
    const allMarkets = await factory.getAllMarkets();
    const allMetricIds = await factory.getAllMetricIds();
    
    console.log(`📊 Total markets in factory: ${allMarkets.length}`);
    console.log(`📋 Total metric IDs: ${allMetricIds.length}`);

    console.log('\n🎯 HOW TO INTERACT WITH MARKETS:');
    console.log('   1. Use OrderRouter to place orders on any market');
    console.log('   2. Reference markets by their metric ID');
    console.log('   3. Markets automatically handle UMA Oracle integration');
    console.log('   4. Settlement will occur on the configured dates');
    console.log('   5. Use factory.getMarket(metricId) to get market address');

    console.log('\n📋 CONTRACT ADDRESSES:');
    for (const [name, address] of Object.entries(deployedContracts)) {
      console.log(`   ${name}: ${address}`);
    }
  }

  return {
    deployedContracts,
    createdMarkets,
    totalMarkets: createdMarkets.length
  };
}

async function main() {
  const results = await deployAndCreateMarkets();

  console.log('\n🎉 DEPLOYMENT AND MARKET CREATION COMPLETE!');
  console.log('='.repeat(80));

  if (results && results.totalMarkets > 0) {
    console.log('🚀 SUCCESS! Your MetricsMarketFactory is fully operational!');
    console.log(`✅ ${results.totalMarkets} markets created and ready for trading!`);
    
    console.log('\n💎 WHAT YOU CAN DO NOW:');
    console.log('   🎯 Place orders on any of the created markets');
    console.log('   📊 Monitor market activity and order books');
    console.log('   💰 Generate P&L through trading');
    console.log('   ⏰ Prepare for settlement when dates arrive');
    console.log('   🔍 Request UMA Oracle data for final settlement');
    
  } else {
    console.log('⚠️  Market creation had issues - check logs above');
  }
}

main()
  .then(() => {
    console.log('\n🏁 Deploy and create markets completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Process failed:', error);
    process.exit(1);
  });







