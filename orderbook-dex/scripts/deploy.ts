import { ethers, network } from "hardhat";
import { Contract } from "ethers";
import { verifyContracts, isVerificationSupported, generateVerificationInstructions, getBlockExplorerUrl } from "./utils/verification";

async function main() {
  console.log("🚀 Starting OrderBook DEX deployment with UMA Oracle integration...");

  // Get deployment signer
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));

  // Deployment configuration
  const config = {
    // UMA Protocol addresses (use mock addresses for local testing)
    umaFinder: process.env.UMA_FINDER_ADDRESS || ethers.ZeroAddress, // Mock address for local testing
    bondCurrency: process.env.BOND_CURRENCY_ADDRESS || ethers.ZeroAddress, // Will be set to MockUSDC later
    
    // DEX Configuration
    defaultCreationFee: ethers.parseEther("0"), // FREE market creation
    tradingFeeRate: 20, // 0.2% (20 basis points)
    deployMockTokens: true, // Always deploy mock tokens for testing
    
    // Security Configuration
    emergencyPauseDuration: 86400, // 24 hours
    timelockDelay: 172800, // 48 hours
    
    // Oracle Configuration
    defaultLiveness: 7200, // 2 hours
    minBond: ethers.parseEther("1000"), // 1000 tokens
    defaultReward: ethers.parseEther("100"), // 100 tokens
  };

  // Validate configuration for production
  const network = await deployer.provider.getNetwork();
  if (network.chainId === 1n) { // Mainnet
    require(process.env.UMA_FINDER_ADDRESS, "UMA_FINDER_ADDRESS required for mainnet");
    require(process.env.BOND_CURRENCY_ADDRESS, "BOND_CURRENCY_ADDRESS required for mainnet");
    require(!config.deployMockTokens, "Mock tokens not allowed on mainnet");
    console.log("⚠️  MAINNET DEPLOYMENT - Using production configuration");
  }

  console.log("\n📋 Deployment Configuration:");
  console.log("- UMA Finder:", config.umaFinder);
  console.log("- Bond Currency:", config.bondCurrency);
  console.log("- Default Creation Fee:", ethers.formatEther(config.defaultCreationFee), "ETH");
  console.log("- Trading Fee Rate:", config.tradingFeeRate, "basis points");

  // Step 0.5: Deploy Mock UMA Finder for testing
  console.log("\n0️⃣.5️⃣ Deploying Mock UMA Finder...");
  const MockUMAFinder = await ethers.getContractFactory("MockUMAFinder");
  const mockUMAFinder = await MockUMAFinder.deploy();
  await mockUMAFinder.waitForDeployment();
  const mockFinderAddress = await mockUMAFinder.getAddress();
  console.log("✅ Mock UMA Finder deployed to:", mockFinderAddress);
  
  // Update config to use mock finder
  config.umaFinder = mockFinderAddress;

  // Step 0.8: Deploy Mock USDC first (always needed for bond currency)
  let mockUSDC: Contract | null = null;
  console.log("\n0️⃣.8️⃣ Deploying Mock USDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  console.log("✅ Mock USDC deployed to:", await mockUSDC.getAddress());
  
  // Mint initial supply to deployer for testing
  console.log("- Minting initial USDC supply to deployer...");
  await mockUSDC.mintLarge(deployer.address); // 1M USDC
  console.log("- Minted 1,000,000 USDC to deployer");
  
  // Update bond currency to use Mock USDC for testing
  config.bondCurrency = await mockUSDC.getAddress();
  console.log("- Updated bond currency to Mock USDC for testing");

  // Step 1: Deploy UMA Oracle Manager
  console.log("\n1️⃣ Deploying UMA Oracle Manager...");
  const UMAOracleManager = await ethers.getContractFactory("UMAOracleManager");
  const umaOracleManager = await UMAOracleManager.deploy(
    config.umaFinder,
    config.bondCurrency,
    deployer.address // admin
  );
  await umaOracleManager.waitForDeployment();
  console.log("✅ UMA Oracle Manager deployed to:", await umaOracleManager.getAddress());

  // Step 2: Deploy Central Vault
  console.log("\n2️⃣ Deploying Central Vault...");
  const CentralVault = await ethers.getContractFactory("CentralVault");
  
  // Determine primary collateral token
  let primaryCollateralToken = ethers.ZeroAddress; // Default to ETH
  if (mockUSDC && config.deployMockTokens) {
    primaryCollateralToken = await mockUSDC.getAddress();
    console.log("- Using MockUSDC as primary collateral token");
  } else if (config.bondCurrency !== process.env.UMA_FINDER_ADDRESS) {
    primaryCollateralToken = config.bondCurrency;
    console.log("- Using configured bond currency as primary collateral token");
  }
  
  const centralVault = await CentralVault.deploy(
    deployer.address, // admin
    config.emergencyPauseDuration,
    primaryCollateralToken // primary collateral token
  );
  await centralVault.waitForDeployment();
  console.log("✅ Central Vault deployed to:", await centralVault.getAddress());
  
  // Display collateral configuration
  const [collateralToken, isERC20, name, symbol] = await centralVault.getPrimaryCollateralToken();
  console.log(`- Primary Collateral: ${name} (${symbol}) at ${collateralToken}`);
  console.log(`- Is ERC20: ${isERC20}`);

  // Step 3: Deploy Order Router
  console.log("\n3️⃣ Deploying Order Router...");
  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const orderRouter = await OrderRouter.deploy(
    await centralVault.getAddress(),
    await umaOracleManager.getAddress(),
    deployer.address, // admin
    config.tradingFeeRate
  );
  await orderRouter.waitForDeployment();
  console.log("✅ Order Router deployed to:", await orderRouter.getAddress());

  // Step 4: Deploy OrderBook Implementation (for cloning)
  console.log("\n4️⃣ Deploying OrderBook Implementation...");
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBookImplementation = await OrderBook.deploy();
  await orderBookImplementation.waitForDeployment();
  console.log("✅ OrderBook Implementation deployed to:", await orderBookImplementation.getAddress());

  // Step 5: Deploy Metrics Market Factory
  console.log("\n5️⃣ Deploying Metrics Market Factory...");
  const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
  const factory = await MetricsMarketFactory.deploy(
    await umaOracleManager.getAddress(),
    await orderBookImplementation.getAddress(),
    await centralVault.getAddress(),
    await orderRouter.getAddress(),
    deployer.address, // admin
    config.defaultCreationFee,
    deployer.address // fee recipient
  );
  await factory.waitForDeployment();
  console.log("✅ Metrics Market Factory deployed to:", await factory.getAddress());

  // Step 6: Configure contracts
  console.log("\n6️⃣ Configuring contracts...");

  // Authorize factory in UMA Oracle Manager (both old and new roles for compatibility)
  console.log("- Authorizing factory in UMA Oracle Manager...");
  await umaOracleManager.grantRole(
    await umaOracleManager.METRIC_MANAGER_ROLE(),
    await factory.getAddress()
  );
  
  // Grant new FACTORY_ROLE for permissionless market creation
  console.log("- Granting FACTORY_ROLE to MetricsMarketFactory in UMA Oracle Manager...");
  await umaOracleManager.grantFactoryRole(await factory.getAddress());

  // Authorize router in Central Vault
  console.log("- Authorizing router in Central Vault...");
  await centralVault.setMarketAuthorization(await orderRouter.getAddress(), true);

  // Grant MARKET_ROLE to OrderBook contracts via factory
  console.log("- Granting MARKET_ROLE to factory for OrderBook deployment...");
  await orderRouter.grantRole(
    await orderRouter.MARKET_ROLE(),
    await factory.getAddress()
  );
  
  // Grant new FACTORY_ROLE for automatic market registration
  console.log("- Granting FACTORY_ROLE to MetricsMarketFactory in OrderRouter...");
  await orderRouter.grantFactoryRole(await factory.getAddress());

  // Configure market authorization for factory to create OrderBooks
  console.log("- Authorizing factory to create markets in vault...");
  await centralVault.setMarketAuthorization(await factory.getAddress(), true);

  // Step 7: Create sample metrics
  console.log("\n7️⃣ Creating sample metrics...");

  // Configure sample UMA metrics
  const sampleMetrics = [
    {
      identifier: ethers.keccak256(ethers.toUtf8Bytes("METRIC_WORLD_POPULATION_2024")),
      description: "World Population Count for 2024",
      decimals: 0,
      minBond: config.minBond,
      defaultReward: config.defaultReward,
      livenessPeriod: config.defaultLiveness,
      isActive: true,
      authorizedRequesters: []
    },
    {
      identifier: ethers.keccak256(ethers.toUtf8Bytes("METRIC_GLOBAL_TEMP_ANOMALY")),
      description: "Global Temperature Anomaly (Celsius)",
      decimals: 2,
      minBond: config.minBond,
      defaultReward: config.defaultReward,
      livenessPeriod: config.defaultLiveness,
      isActive: true,
      authorizedRequesters: []
    },
    {
      identifier: ethers.keccak256(ethers.toUtf8Bytes("METRIC_BTC_HASH_RATE")),
      description: "Bitcoin Network Hash Rate (EH/s)",
      decimals: 2,
      minBond: config.minBond,
      defaultReward: config.defaultReward,
      livenessPeriod: config.defaultLiveness,
      isActive: true,
      authorizedRequesters: []
    }
  ];

  for (const metric of sampleMetrics) {
    console.log(`- Configuring metric: ${metric.description}...`);
    await umaOracleManager.configureMetric(metric);
  }

  // Step 8: Create sample markets
  console.log("\n8️⃣ Creating sample markets...");

  const currentTime = Math.floor(Date.now() / 1000);
  const oneMonth = 30 * 24 * 3600; // 30 days
  const oneWeek = 7 * 24 * 3600;   // 7 days
  const oneDay = 24 * 3600;        // 1 day

  const sampleMarkets = [
    {
      metricId: "WORLD_POPULATION_2024",
      description: "World Population Count for 2024",
      oracleProvider: await umaOracleManager.getAddress(),
      decimals: 0,
      minimumOrderSize: ethers.parseEther("0.01"),
      tickSize: ethers.parseEther("0.01"), // Fixed tick size: 0.01
      creationFee: config.defaultCreationFee,
      requiresKYC: false,
      settlementDate: currentTime + oneMonth,     // Settles in 1 month
      tradingEndDate: currentTime + oneMonth - oneDay, // Trading ends 1 day before settlement
      dataRequestWindow: 3 * oneDay,             // Request data 3 days before settlement
      autoSettle: true,
      initialOrder: {
        enabled: false,
        side: 0, // BUY
        quantity: 0,
        price: 0,
        timeInForce: 0, // GTC
        expiryTime: 0
      }
    },
    {
      metricId: "GLOBAL_TEMP_ANOMALY_Q4_2024",
      description: "Global Temperature Anomaly Q4 2024 (Celsius)",
      oracleProvider: await umaOracleManager.getAddress(),
      decimals: 2,
      minimumOrderSize: ethers.parseEther("0.01"),
      tickSize: ethers.parseEther("0.01"), // Fixed tick size: 0.01
      creationFee: config.defaultCreationFee,
      requiresKYC: false,
      settlementDate: currentTime + 2 * oneMonth, // Settles in 2 months
      tradingEndDate: currentTime + 2 * oneMonth - oneDay,
      dataRequestWindow: 5 * oneDay,             // Request data 5 days before settlement
      autoSettle: true,
      initialOrder: {
        enabled: false,
        side: 0, // BUY
        quantity: 0,
        price: 0,
        timeInForce: 0, // GTC
        expiryTime: 0
      }
    },
    {
      metricId: "BTC_HASH_RATE_DEC_2024",
      description: "Bitcoin Network Hash Rate December 2024 (EH/s)",
      oracleProvider: await umaOracleManager.getAddress(),
      decimals: 2,
      minimumOrderSize: ethers.parseEther("0.01"),
      tickSize: ethers.parseEther("0.01"), // Fixed tick size: 0.01
      creationFee: config.defaultCreationFee,
      requiresKYC: false,
      settlementDate: currentTime + oneWeek,      // Settles in 1 week (for testing)
      tradingEndDate: currentTime + oneWeek - oneDay,
      dataRequestWindow: 2 * oneDay,             // Request data 2 days before settlement
      autoSettle: true,
      initialOrder: {
        enabled: false,
        side: 0, // BUY
        quantity: 0,
        price: 0,
        timeInForce: 0, // GTC
        expiryTime: 0
      }
    }
  ];

  for (const market of sampleMarkets) {
    console.log(`- Creating market: ${market.description}...`);
    const tx = await factory.createMarket(market, {
      value: market.creationFee
    });
    await tx.wait();
    
    const marketAddress = await factory.getMarket(market.metricId);
    console.log(`  ✅ Market created at: ${marketAddress}`);
  }

  // Step 9: Display deployment summary
  console.log("\n🎉 Deployment completed successfully!");
  console.log("\n📋 Contract Addresses:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Mock UMA Finder:        ", mockFinderAddress);
  if (mockUSDC) {
    console.log("Mock USDC:              ", await mockUSDC.getAddress());
  }
  console.log("UMA Oracle Manager:     ", await umaOracleManager.getAddress());
  console.log("Central Vault:          ", await centralVault.getAddress());
  console.log("Order Router:           ", await orderRouter.getAddress());
  console.log("OrderBook Implementation:", await orderBookImplementation.getAddress());
  console.log("Metrics Market Factory: ", await factory.getAddress());
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  console.log("\n📊 Sample Markets Created:");
  for (const market of sampleMarkets) {
    const marketAddress = await factory.getMarket(market.metricId);
    console.log(`${market.metricId}: ${marketAddress}`);
  }

  // Step 10: Verify contracts on block explorers
  console.log("\n🔍 Starting contract verification...");
  
  if (isVerificationSupported()) {
    // Prepare contracts for verification
    const contractsToVerify = [];
    
    // Add MockUMAFinder
    contractsToVerify.push({
      contract: mockUMAFinder,
      constructorArguments: [],
      name: "MockUMAFinder",
      contractPath: "contracts/mocks/MockUMAFinder.sol:MockUMAFinder"
    });
    
    // Add MockUSDC if deployed
    if (mockUSDC) {
      contractsToVerify.push({
        contract: mockUSDC,
        constructorArguments: [],
        name: "MockUSDC", 
        contractPath: "contracts/mocks/MockUSDC.sol:MockUSDC"
      });
    }
    
    // Add UMAOracleManager
    contractsToVerify.push({
      contract: umaOracleManager,
      constructorArguments: [
        config.umaFinder,
        config.bondCurrency,
        deployer.address
      ],
      name: "UMAOracleManager",
      contractPath: "contracts/core/UMAOracleManager.sol:UMAOracleManager"
    });
    
    // Add CentralVault
    contractsToVerify.push({
      contract: centralVault,
      constructorArguments: [
        deployer.address,
        config.emergencyPauseDuration,
        config.bondCurrency // Primary collateral
      ],
      name: "CentralVault",
      contractPath: "contracts/core/CentralVault.sol:CentralVault"
    });
    
    // Add OrderRouter
    contractsToVerify.push({
      contract: orderRouter,
      constructorArguments: [
        await centralVault.getAddress(),
        await umaOracleManager.getAddress(),
        deployer.address,
        config.tradingFeeRate
      ],
      name: "OrderRouter",
      contractPath: "contracts/core/OrderRouter.sol:OrderRouter"
    });
    
    // Add OrderBook Implementation
    contractsToVerify.push({
      contract: orderBookImplementation,
      constructorArguments: [],
      name: "OrderBook Implementation",
      contractPath: "contracts/core/OrderBook.sol:OrderBook"
    });
    
    // Add MetricsMarketFactory
    contractsToVerify.push({
      contract: factory,
      constructorArguments: [
        await umaOracleManager.getAddress(),
        await orderBookImplementation.getAddress(),
        await centralVault.getAddress(),
        await orderRouter.getAddress(),
        deployer.address,
        config.defaultCreationFee,
        deployer.address // fee recipient
      ],
      name: "MetricsMarketFactory",
      contractPath: "contracts/core/MetricsMarketFactory.sol:MetricsMarketFactory"
    });
    
    // Perform verification
    const verificationResult = await verifyContracts(contractsToVerify);
    
    if (verificationResult.failed > 0) {
      console.log("\n⚠️  Some contracts failed verification. Generating manual verification instructions...");
      
      const failedContracts = [];
      for (const contractInfo of contractsToVerify) {
        const address = await contractInfo.contract.getAddress();
        failedContracts.push({
          address,
          constructorArguments: contractInfo.constructorArguments,
          name: contractInfo.name,
          contractPath: contractInfo.contractPath
        });
      }
      
      const instructions = generateVerificationInstructions(failedContracts);
      console.log(instructions);
      
      // Save instructions to file
      const instructionsFile = `deployments/verification-instructions-${Date.now()}.txt`;
      require('fs').writeFileSync(instructionsFile, instructions);
      console.log(`📄 Verification instructions saved to: ${instructionsFile}`);
    }
    
  } else {
    console.log(`ℹ️  Automatic verification not supported on network: ${network.name}`);
    console.log("💡 For mainnet/testnet deployments, verification will be performed automatically.");
  }

  console.log("\n🔧 Next Steps:");
  console.log("1. ✅ Contract verification completed/initiated");
  console.log("2. Set up monitoring and alerting");
  console.log("3. Configure governance parameters");
  console.log("4. Initialize insurance fund");
  console.log("5. Begin user onboarding");

  // Save deployment addresses to file
  const deploymentData = {
    network: await deployer.provider.getNetwork(),
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      mockUMAFinder: {
        address: mockFinderAddress,
        explorerUrl: getBlockExplorerUrl(mockFinderAddress)
      },
      mockUSDC: mockUSDC ? {
        address: await mockUSDC.getAddress(),
        explorerUrl: getBlockExplorerUrl(await mockUSDC.getAddress())
      } : null,
      umaOracleManager: {
        address: await umaOracleManager.getAddress(),
        explorerUrl: getBlockExplorerUrl(await umaOracleManager.getAddress())
      },
      centralVault: {
        address: await centralVault.getAddress(),
        explorerUrl: getBlockExplorerUrl(await centralVault.getAddress())
      },
      orderRouter: {
        address: await orderRouter.getAddress(),
        explorerUrl: getBlockExplorerUrl(await orderRouter.getAddress())
      },
      orderBookImplementation: {
        address: await orderBookImplementation.getAddress(),
        explorerUrl: getBlockExplorerUrl(await orderBookImplementation.getAddress())
      },
      factory: {
        address: await factory.getAddress(),
        explorerUrl: getBlockExplorerUrl(await factory.getAddress())
      }
    },
    markets: {}
  };

  for (const market of sampleMarkets) {
    const marketAddress = await factory.getMarket(market.metricId);
    deploymentData.markets[market.metricId] = marketAddress;
  }

  const fs = require('fs');
  const deploymentFile = `deployments/deployment-${Date.now()}.json`;
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
  console.log(`\n💾 Deployment data saved to: ${deploymentFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
