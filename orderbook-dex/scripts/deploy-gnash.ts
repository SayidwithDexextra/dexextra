import { ethers, network } from "hardhat";
import { Contract } from "ethers";

// Enhanced logging utility
class Logger {
  private static colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
  };

  static info(message: string, data?: any) {
    console.log(`${this.colors.blue}ℹ️  INFO:${this.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static success(message: string, data?: any) {
    console.log(`${this.colors.green}✅ SUCCESS:${this.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static warning(message: string, data?: any) {
    console.log(`${this.colors.yellow}⚠️  WARNING:${this.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static error(message: string, error?: any) {
    console.log(`${this.colors.red}❌ ERROR:${this.colors.reset} ${message}`);
    if (error) console.error(error);
  }

  static debug(message: string, data?: any) {
    console.log(`${this.colors.dim}🐛 DEBUG:${this.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static step(step: number, message: string) {
    console.log(`\n${this.colors.cyan}${step}️⃣ ${message}${this.colors.reset}`);
    console.log("━".repeat(60));
  }

  static separator() {
    console.log("━".repeat(80));
  }
}

async function main() {
  Logger.step(0, "Starting Gnash Blockchain OrderBook DEX Deployment");
  
  // Network validation
  const networkInfo = await ethers.provider.getNetwork();
  Logger.info("Network Information", {
    name: network.name,
    chainId: networkInfo.chainId.toString(),
    isGnash: network.name === 'gnash'
  });

  if (network.name !== 'gnash') {
    Logger.warning(`Deploying to ${network.name} instead of Gnash - proceeding anyway for testing`);
  }

  // Get deployment signer
  const [deployer] = await ethers.getSigners();
  const deployerBalance = await deployer.provider.getBalance(deployer.address);
  
  Logger.info("Deployer Information", {
    address: deployer.address,
    balance: ethers.formatEther(deployerBalance) + " ETH",
    hasEnoughBalance: deployerBalance > ethers.parseEther("1")
  });

  if (deployerBalance < ethers.parseEther("0.1")) {
    Logger.warning("Low deployer balance - may need more ETH for gas fees");
  }

  // Enhanced deployment configuration with debugging
  const config = {
    // Mock addresses for Gnash testing
    umaFinder: ethers.ZeroAddress,
    bondCurrency: ethers.ZeroAddress,
    
    // DEX Configuration with debug-friendly values
    defaultCreationFee: ethers.parseEther("0.01"), // Lower fee for testing
    tradingFeeRate: 10, // 0.1% (10 basis points) - reduced for testing
    deployMockTokens: true,
    
    // Security Configuration
    emergencyPauseDuration: 3600, // 1 hour for testing
    timelockDelay: 7200, // 2 hours for testing
    
    // Oracle Configuration
    defaultLiveness: 3600, // 1 hour minimum for testing
    minBond: ethers.parseEther("1000"), // 1000 tokens minimum required
    defaultReward: ethers.parseEther("100"), // 100 tokens
    
    // Debug Configuration
    enableDebugLogs: true,
    logLevel: "DEBUG"
  };

  Logger.info("Deployment Configuration", config);

  Logger.step(1, "Deploying Mock Infrastructure");

  // Deploy Mock UMA Finder
  Logger.debug("Deploying Mock UMA Finder with enhanced logging");
  const MockUMAFinder = await ethers.getContractFactory("MockUMAFinder");
  const mockUMAFinder = await MockUMAFinder.deploy();
  await mockUMAFinder.waitForDeployment();
  const mockFinderAddress = await mockUMAFinder.getAddress();
  
  Logger.success("Mock UMA Finder Deployed", {
    address: mockFinderAddress,
    txHash: mockUMAFinder.deploymentTransaction()?.hash
  });

  // Update config
  config.umaFinder = mockFinderAddress;

  // Deploy Mock USDC with enhanced features
  Logger.debug("Deploying Mock USDC with debugging capabilities");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  const mockUSDCAddress = await mockUSDC.getAddress();
  
  Logger.success("Mock USDC Deployed", {
    address: mockUSDCAddress,
    txHash: mockUSDC.deploymentTransaction()?.hash
  });

  // Mint tokens for testing with detailed logging
  Logger.debug("Minting test tokens to deployer");
  const mintTx = await mockUSDC.mintLarge(deployer.address);
  await mintTx.wait();
  
  const deployerBalance_USDC = await mockUSDC.balanceOf(deployer.address);
  Logger.success("Test tokens minted", {
    recipient: deployer.address,
    amount: ethers.formatUnits(deployerBalance_USDC, 6) + " USDC",
    txHash: mintTx.hash
  });

  config.bondCurrency = mockUSDCAddress;

  Logger.step(2, "Deploying Core OrderBook Infrastructure");

  // Deploy UMA Oracle Manager with debugging
  Logger.debug("Deploying UMA Oracle Manager");
  const UMAOracleManager = await ethers.getContractFactory("UMAOracleManager");
  const umaOracleManager = await UMAOracleManager.deploy(
    config.umaFinder,
    config.bondCurrency,
    deployer.address
  );
  await umaOracleManager.waitForDeployment();
  const oracleManagerAddress = await umaOracleManager.getAddress();
  
  Logger.success("UMA Oracle Manager Deployed", {
    address: oracleManagerAddress,
    finder: config.umaFinder,
    bondCurrency: config.bondCurrency,
    admin: deployer.address
  });

  // Deploy Central Vault with debugging
  Logger.debug("Deploying Central Vault");
  const CentralVault = await ethers.getContractFactory("CentralVault");
  const centralVault = await CentralVault.deploy(
    deployer.address,
    config.emergencyPauseDuration,
    config.bondCurrency // Use USDC as primary collateral
  );
  await centralVault.waitForDeployment();
  const vaultAddress = await centralVault.getAddress();
  
  Logger.success("Central Vault Deployed", {
    address: vaultAddress,
    admin: deployer.address,
    emergencyPauseDuration: config.emergencyPauseDuration,
    primaryCollateral: config.bondCurrency
  });

  // Get and log collateral configuration
  const [collateralToken, isERC20, name, symbol] = await centralVault.getPrimaryCollateralToken();
  Logger.info("Vault Collateral Configuration", {
    token: collateralToken,
    isERC20,
    name,
    symbol
  });

  // Deploy Order Router with debugging
  Logger.debug("Deploying Order Router");
  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const orderRouter = await OrderRouter.deploy(
    vaultAddress,
    oracleManagerAddress,
    deployer.address,
    config.tradingFeeRate
  );
  await orderRouter.waitForDeployment();
  const routerAddress = await orderRouter.getAddress();
  
  Logger.success("Order Router Deployed", {
    address: routerAddress,
    vault: vaultAddress,
    oracleManager: oracleManagerAddress,
    admin: deployer.address,
    tradingFeeRate: config.tradingFeeRate
  });

  // Deploy OrderBook Implementation
  Logger.debug("Deploying OrderBook Implementation");
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBookImplementation = await OrderBook.deploy();
  await orderBookImplementation.waitForDeployment();
  const orderBookImplAddress = await orderBookImplementation.getAddress();
  
  Logger.success("OrderBook Implementation Deployed", {
    address: orderBookImplAddress
  });

  // Deploy Metrics Market Factory
  Logger.debug("Deploying Metrics Market Factory");
  const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
  const factory = await MetricsMarketFactory.deploy(
    oracleManagerAddress,
    orderBookImplAddress,
    vaultAddress,
    routerAddress,
    deployer.address,
    config.defaultCreationFee,
    deployer.address
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  
  Logger.success("Metrics Market Factory Deployed", {
    address: factoryAddress,
    oracleManager: oracleManagerAddress,
    orderBookImpl: orderBookImplAddress,
    vault: vaultAddress,
    router: routerAddress,
    creationFee: ethers.formatEther(config.defaultCreationFee)
  });

  Logger.step(3, "Configuring Contract Permissions with Debugging");

  // Configure permissions with detailed logging
  Logger.debug("Granting METRIC_MANAGER_ROLE to factory");
  const metricManagerRole = await umaOracleManager.METRIC_MANAGER_ROLE();
  const grantMetricTx = await umaOracleManager.grantRole(metricManagerRole, factoryAddress);
  await grantMetricTx.wait();
  Logger.success("METRIC_MANAGER_ROLE granted", {
    role: metricManagerRole,
    account: factoryAddress,
    txHash: grantMetricTx.hash
  });

  Logger.debug("Authorizing router in Central Vault");
  const authRouterTx = await centralVault.setMarketAuthorization(routerAddress, true);
  await authRouterTx.wait();
  Logger.success("Router authorized in vault", {
    router: routerAddress,
    txHash: authRouterTx.hash
  });

  Logger.debug("Granting MARKET_ROLE to factory");
  const marketRole = await orderRouter.MARKET_ROLE();
  const grantMarketTx = await orderRouter.grantRole(marketRole, factoryAddress);
  await grantMarketTx.wait();
  Logger.success("MARKET_ROLE granted", {
    role: marketRole,
    account: factoryAddress,
    txHash: grantMarketTx.hash
  });

  Logger.debug("Authorizing factory in Central Vault");
  const authFactoryTx = await centralVault.setMarketAuthorization(factoryAddress, true);
  await authFactoryTx.wait();
  Logger.success("Factory authorized in vault", {
    factory: factoryAddress,
    txHash: authFactoryTx.hash
  });

  Logger.step(4, "Creating Test Market for Limit Order Testing");

  // Create a simple test market with debugging
  const currentTime = Math.floor(Date.now() / 1000);
  const testMarket = {
    metricId: "GNASH_TEST_METRIC_" + Date.now(),
    description: "Test Market for Gnash Limit Order Testing",
    oracleProvider: oracleManagerAddress,
    decimals: 2,
    minimumOrderSize: ethers.parseEther("0.001"), // Very small for testing
    tickSize: ethers.parseEther("0.01"),
    creationFee: config.defaultCreationFee,
    requiresKYC: false,
    settlementDate: currentTime + 3600,        // Settles in 1 hour
    tradingEndDate: currentTime + 3300,        // Trading ends 55 minutes from now
    dataRequestWindow: 300,                    // Request data 5 minutes before settlement
    autoSettle: true,
    initialOrder: {
      enabled: false,
      side: 0,
      quantity: 0,
      price: 0,
      timeInForce: 0,
      expiryTime: 0
    }
  };

  Logger.info("Creating test market", testMarket);

  // Configure the metric in UMA Oracle Manager first
  const testMetricConfig = {
    identifier: ethers.keccak256(ethers.toUtf8Bytes(testMarket.metricId)),
    description: testMarket.description,
    decimals: testMarket.decimals,
    minBond: config.minBond,
    defaultReward: config.defaultReward,
    livenessPeriod: config.defaultLiveness,
    isActive: true,
    authorizedRequesters: []
  };

  Logger.debug("Configuring test metric in oracle manager");
  const configMetricTx = await umaOracleManager.configureMetric(testMetricConfig);
  await configMetricTx.wait();
  Logger.success("Test metric configured", {
    identifier: testMetricConfig.identifier,
    txHash: configMetricTx.hash
  });

  Logger.debug("Creating market via factory");
  const createMarketTx = await factory.createMarket(testMarket, {
    value: config.defaultCreationFee
  });
  await createMarketTx.wait();
  
  const marketAddress = await factory.getMarket(testMarket.metricId);
  Logger.success("Test market created", {
    metricId: testMarket.metricId,
    marketAddress: marketAddress,
    txHash: createMarketTx.hash
  });

  Logger.step(5, "Preparing for Limit Order Testing");

  // Approve USDC for trading
  Logger.debug("Approving USDC for trading");
  const approvalAmount = ethers.parseUnits("10000", 6); // 10,000 USDC
  const approveTx = await mockUSDC.approve(vaultAddress, approvalAmount);
  await approveTx.wait();
  Logger.success("USDC approved for trading", {
    spender: vaultAddress,
    amount: ethers.formatUnits(approvalAmount, 6) + " USDC",
    txHash: approveTx.hash
  });

  // Deposit collateral to vault
  Logger.debug("Depositing collateral to vault");
  const depositAmount = ethers.parseUnits("1000", 6); // 1,000 USDC
  const depositTx = await centralVault.deposit(mockUSDCAddress, depositAmount);
  await depositTx.wait();
  Logger.success("Collateral deposited", {
    token: mockUSDCAddress,
    amount: ethers.formatUnits(depositAmount, 6) + " USDC",
    txHash: depositTx.hash
  });

  // Check vault balance
  const vaultBalance = await centralVault.getUserBalance(deployer.address, mockUSDCAddress);
  Logger.info("Vault balance after deposit", {
    user: deployer.address,
    token: mockUSDCAddress,
    available: ethers.formatUnits(vaultBalance.available, 6) + " USDC",
    allocated: ethers.formatUnits(vaultBalance.allocated, 6) + " USDC",
    locked: ethers.formatUnits(vaultBalance.locked, 6) + " USDC"
  });

  Logger.step(6, "Deployment Summary and Instructions");

  const deploymentSummary = {
    network: {
      name: network.name,
      chainId: networkInfo.chainId.toString()
    },
    contracts: {
      mockUMAFinder: mockFinderAddress,
      mockUSDC: mockUSDCAddress,
      umaOracleManager: oracleManagerAddress,
      centralVault: vaultAddress,
      orderRouter: routerAddress,
      orderBookImplementation: orderBookImplAddress,
      factory: factoryAddress
    },
    testMarket: {
      metricId: testMarket.metricId,
      address: marketAddress,
      tradingEndTime: new Date(testMarket.tradingEndDate * 1000).toISOString(),
      settlementTime: new Date(testMarket.settlementDate * 1000).toISOString()
    },
    userSetup: {
      deployer: deployer.address,
      usdcBalance: ethers.formatUnits(deployerBalance_USDC, 6) + " USDC",
      vaultBalance: {
        available: ethers.formatUnits(vaultBalance.available, 6) + " USDC",
        allocated: ethers.formatUnits(vaultBalance.allocated, 6) + " USDC",
        locked: ethers.formatUnits(vaultBalance.locked, 6) + " USDC"
      }
    }
  };

  Logger.success("Deployment completed successfully!", deploymentSummary);

  // Save deployment data
  const fs = require('fs');
  const deploymentFile = `deployments/gnash-deployment-${Date.now()}.json`;
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentSummary, null, 2));
  Logger.info("Deployment data saved to: " + deploymentFile);

  Logger.separator();
  console.log("🚀 Ready for Limit Order Testing!");
  console.log("\nNext Steps:");
  console.log("1. Run the limit order test script");
  console.log("2. Submit buy and sell orders");
  console.log("3. Test order matching mechanism");
  console.log("4. Monitor debug logs for order execution");

  return deploymentSummary;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    Logger.error("Deployment failed", error);
    process.exit(1);
  });
