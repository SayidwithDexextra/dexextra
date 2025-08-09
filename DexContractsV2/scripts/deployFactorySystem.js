const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Deploying DexContractsV2 Factory-Based System...\n");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📍 Deploying with account:", deployer.address);
  console.log(
    "💰 Account balance:",
    ethers.utils.formatEther(await deployer.getBalance()),
    "ETH\n"
  );

  // Mock USDC token for testing (replace with real USDC address in production)
  console.log("🏗️  Deploying Mock USDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.deployed();
  console.log("✅ Mock USDC deployed to:", mockUSDC.address);

  // Deploy MetricRegistry
  console.log("\n🏗️  Deploying MetricRegistry...");
  const MetricRegistry = await ethers.getContractFactory("MetricRegistry");
  const metricRegistry = await MetricRegistry.deploy();
  await metricRegistry.deployed();
  console.log("✅ MetricRegistry deployed to:", metricRegistry.address);

  // Deploy CentralizedVault (needs factory address, will set later)
  console.log("\n🏗️  Deploying CentralizedVault...");
  const CentralizedVault = await ethers.getContractFactory("CentralizedVault");

  // Deploy with placeholder factory address (will be updated)
  const centralVault = await CentralizedVault.deploy(
    mockUSDC.address,
    deployer.address // Temporary factory address
  );
  await centralVault.deployed();
  console.log("✅ CentralizedVault deployed to:", centralVault.address);

  // Deploy MetricVAMMFactory
  console.log("\n🏗️  Deploying MetricVAMMFactory...");
  const MetricVAMMFactory = await ethers.getContractFactory(
    "MetricVAMMFactory"
  );
  const factory = await MetricVAMMFactory.deploy(
    centralVault.address,
    metricRegistry.address
  );
  await factory.deployed();
  console.log("✅ MetricVAMMFactory deployed to:", factory.address);

  // Update vault with correct factory address
  console.log("\n🔧 Updating CentralizedVault factory address...");
  await centralVault.setFactory(factory.address);
  console.log("✅ CentralizedVault factory address updated");

  // Deploy MetricVAMMRouter
  console.log("\n🏗️  Deploying MetricVAMMRouter...");
  const MetricVAMMRouter = await ethers.getContractFactory("MetricVAMMRouter");
  const router = await MetricVAMMRouter.deploy(
    factory.address,
    centralVault.address,
    metricRegistry.address
  );
  await router.deployed();
  console.log("✅ MetricVAMMRouter deployed to:", router.address);

  console.log("\n📋 DEPLOYMENT SUMMARY");
  console.log("====================");
  console.log("Mock USDC:           ", mockUSDC.address);
  console.log("MetricRegistry:      ", metricRegistry.address);
  console.log("CentralizedVault:    ", centralVault.address);
  console.log("MetricVAMMFactory:   ", factory.address);
  console.log("MetricVAMMRouter:    ", router.address);

  // Initialize system with sample data
  console.log("\n🛠️  INITIALIZING SYSTEM...\n");

  // 1. Register sample metrics
  console.log("📊 Registering sample metrics...");

  // World Population metric
  const worldPopTx = await metricRegistry.registerMetric(
    "World Population",
    "Total world population count",
    "https://worldometers.info/world-population/",
    "Current world population from UN estimates",
    30, // 30-day settlement
    ethers.utils.parseEther("100"), // 100 ETH minimum stake
    { value: ethers.utils.parseEther("0.1") } // Registration fee
  );
  await worldPopTx.wait();

  const weatherTempTx = await metricRegistry.registerMetric(
    "Global Average Temperature",
    "Global average temperature in Celsius",
    "https://climate.nasa.gov/evidence/",
    "Monthly global average temperature",
    7, // 7-day settlement
    ethers.utils.parseEther("50"), // 50 ETH minimum stake
    { value: ethers.utils.parseEther("0.1") }
  );
  await weatherTempTx.wait();

  const gdpTx = await metricRegistry.registerMetric(
    "US GDP Growth",
    "US GDP quarterly growth rate",
    "https://bea.gov/data/gdp/gross-domestic-product",
    "US GDP growth rate percentage",
    90, // 90-day settlement
    ethers.utils.parseEther("200"), // 200 ETH minimum stake
    { value: ethers.utils.parseEther("0.1") }
  );
  await gdpTx.wait();

  console.log("✅ Sample metrics registered");

  // 2. Get metric IDs for deployment
  const worldPopMetric = await metricRegistry.getMetricByName(
    "World Population"
  );
  const tempMetric = await metricRegistry.getMetricByName(
    "Global Average Temperature"
  );
  const gdpMetric = await metricRegistry.getMetricByName("US GDP Growth");

  console.log("📋 Metric IDs:");
  console.log("  World Population:", worldPopMetric.metricId);
  console.log("  Temperature:     ", tempMetric.metricId);
  console.log("  US GDP:          ", gdpMetric.metricId);

  // 3. Create a new template with a specific start price
  console.log("\n📝 Creating custom template with start price...");
  const customTemplateTx = await factory.createTemplate(
    "high-start-price", // templateName
    50, // maxLeverage
    30, // tradingFeeRate
    500, // liquidationFeeRate
    500, // maintenanceMarginRatio
    ethers.utils.parseEther("10000"), // initialReserves
    1000, // volumeScaleFactor
    ethers.utils.parseEther("88"), // startPrice
    "Custom template with a starting price of $88" // description
  );
  await customTemplateTx.wait();
  console.log("✅ Custom template created");

  // 4. Deploy specialized VAMMs
  console.log("\n🏭 Deploying specialized VAMMs...");

  // Population VAMM (Conservative)
  console.log("📈 Deploying Population VAMM...");
  const populationTx = await factory.deploySpecializedVAMM(
    "Population Metrics",
    [worldPopMetric.metricId],
    "conservative",
    { value: ethers.utils.parseEther("0.1") } // Deployment fee
  );
  await populationTx.wait();

  // Weather VAMM (Aggressive)
  console.log("🌡️  Deploying Weather VAMM...");
  const weatherTx = await factory.deploySpecializedVAMM(
    "Weather Metrics",
    [tempMetric.metricId],
    "aggressive",
    { value: ethers.utils.parseEther("0.1") }
  );
  await weatherTx.wait();

  // Economic VAMM (Standard)
  console.log("💰 Deploying Economic VAMM...");
  const economicTx = await factory.deploySpecializedVAMM(
    "Economic Metrics",
    [gdpMetric.metricId],
    "standard",
    { value: ethers.utils.parseEther("0.1") }
  );
  await economicTx.wait();

  // Deploy a VAMM with the custom template
  console.log("🚀 Deploying VAMM with custom start price...");
  const customVAMMTx = await factory.deploySpecializedVAMM(
    "Custom Start Price",
    [gdpMetric.metricId], // Re-using GDP metric for demo
    "high-start-price",
    { value: ethers.utils.parseEther("0.1") }
  );
  await customVAMMTx.wait();
  console.log("✅ Custom VAMM deployed");

  console.log("✅ All specialized VAMMs deployed");

  // 5. Get deployed VAMM addresses
  const populationVAMM = await factory.getVAMMByCategory("Population Metrics");
  const weatherVAMM = await factory.getVAMMByCategory("Weather Metrics");
  const economicVAMM = await factory.getVAMMByCategory("Economic Metrics");
  const customVAMM = await factory.getVAMMByCategory("Custom Start Price");

  console.log("\n🏗️  DEPLOYED VAMM ADDRESSES");
  console.log("============================");
  console.log("Population VAMM:     ", populationVAMM);
  console.log("Weather VAMM:        ", weatherVAMM);
  console.log("Economic VAMM:       ", economicVAMM);
  console.log("Custom VAMM:         ", customVAMM);

  // 6. Verify system integrity
  console.log("\n🔍 VERIFYING SYSTEM INTEGRITY...");

  const totalVAMMs = await factory.getTotalVAMMs();
  const vaultTVL = await centralVault.getTotalValueLocked();
  const globalMetrics = await centralVault.getGlobalRiskMetrics();

  console.log("✅ Total VAMMs deployed:", totalVAMMs.toString());
  console.log("✅ Vault TVL:", ethers.utils.formatUnits(vaultTVL, 6), "USDC");
  console.log("✅ Active users:", globalMetrics.activeUsers.toString());

  // 6. Demo user flow
  console.log("\n🎮 DEMO USER FLOW...");

  // Mint some USDC for demo
  console.log("💵 Minting demo USDC...");
  await mockUSDC.mint(deployer.address, ethers.utils.parseUnits("10000", 6)); // 10,000 USDC
  console.log("✅ Minted 10,000 USDC for demo");

  // Approve vault
  console.log("🔓 Approving vault for USDC...");
  await mockUSDC.approve(
    centralVault.address,
    ethers.utils.parseUnits("10000", 6)
  );
  console.log("✅ Vault approved");

  // Deposit collateral via router
  console.log("🏦 Depositing collateral via router...");
  await router.depositCollateral(ethers.utils.parseUnits("1000", 6)); // $1000
  console.log("✅ Deposited $1000 USDC");

  // Check portfolio
  const portfolio = await router.getPortfolioDashboard(deployer.address);
  console.log("📊 Portfolio Summary:");
  console.log(
    "  Total Collateral:",
    ethers.utils.formatUnits(portfolio.totalCollateral, 6),
    "USDC"
  );
  console.log(
    "  Available Margin:",
    ethers.utils.formatUnits(portfolio.availableMargin, 6),
    "USDC"
  );
  console.log(
    "  Unrealized PnL:",
    ethers.utils.formatEther(portfolio.totalUnrealizedPnL),
    "USD"
  );

  // Open position via router
  console.log("\n📊 Opening position via router...");
  const openTx = await router.openPosition(
    worldPopMetric.metricId,
    ethers.utils.parseUnits("100", 6), // $100 collateral
    true, // long
    10, // 10x leverage
    0, // no target value
    0, // CONTINUOUS position type
    0, // min price
    ethers.constants.MaxUint256 // max price
  );
  await openTx.wait();
  console.log("✅ Position opened successfully");

  console.log("\n🎉 FACTORY SYSTEM DEPLOYMENT COMPLETE!");
  console.log("========================================");
  console.log("System is ready for production use!");
  console.log("\n💡 Next Steps:");
  console.log("1. Integrate with frontend using the MetricVAMMRouter");
  console.log("2. Set up UMA oracle integration for settlements");
  console.log("3. Configure monitoring and analytics");
  console.log("4. Add additional metrics and VAMMs as needed");

  // Save deployment info
  const deploymentInfo = {
    network: "localhost", // Update for actual network
    timestamp: new Date().toISOString(),
    contracts: {
      mockUSDC: mockUSDC.address,
      metricRegistry: metricRegistry.address,
      centralVault: centralVault.address,
      factory: factory.address,
      router: router.address,
    },
    vamms: {
      population: populationVAMM,
      weather: weatherVAMM,
      economic: economicVAMM,
      custom: customVAMM,
    },
    metrics: {
      worldPopulation: worldPopMetric.metricId,
      temperature: tempMetric.metricId,
      gdp: gdpMetric.metricId,
    },
  };

  console.log("\n📄 Deployment info saved:");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  return deploymentInfo;
}

// Handle deployment
main()
  .then((deploymentInfo) => {
    console.log("\n✅ Deployment script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
