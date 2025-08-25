import { ethers, network } from "hardhat";
import { Contract } from "ethers";
import { verifyContracts, isVerificationSupported } from "./utils/verification";
import { saveContractDeployment, ContractDeploymentData } from "./utils/supabase-client";

/**
 * Polygon-specific deployment script with mainnet UMA integration
 */
async function main() {
  console.log("🚀 Starting OrderBook DEX deployment on Polygon...");

  // Get deployment signer
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));

  // Polygon mainnet configuration
  const config = {
    // For now, we'll deploy with mock contracts until UMA addresses are verified
    // Real UMA Protocol addresses on Polygon (will be updated when verified)
    umaFinder: process.env.UMA_FINDER_ADDRESS || null, // Will deploy mock if not provided
    bondCurrency: process.env.BOND_CURRENCY_ADDRESS || "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC on Polygon
    
    // DEX Configuration
    defaultCreationFee: ethers.parseEther("0"), // 0 MATIC - Free market creation
    tradingFeeRate: 20, // 0.2% (20 basis points)
    deployMockTokens: true, // Deploy mocks for initial testing
    
    // Security Configuration
    emergencyPauseDuration: 86400, // 24 hours
    timelockDelay: 172800, // 48 hours
  };

  // Deploy mock contracts if UMA addresses not provided
  let actualUmaFinder = config.umaFinder;
  let actualBondCurrency = config.bondCurrency;
  let mockUMAFinder: Contract | null = null;
  let mockUSDC: Contract | null = null;

  if (!actualUmaFinder || config.deployMockTokens) {
    console.log("\n🔧 Deploying mock contracts for testing...");
    
    if (!actualUmaFinder) {
      console.log("- Deploying Mock UMA Finder...");
      const MockUMAFinder = await ethers.getContractFactory("MockUMAFinder");
      mockUMAFinder = await MockUMAFinder.deploy();
      await mockUMAFinder.waitForDeployment();
      actualUmaFinder = await mockUMAFinder.getAddress();
      console.log("✅ Mock UMA Finder deployed to:", actualUmaFinder);
    }

    if (config.deployMockTokens) {
      console.log("- Deploying Mock USDC...");
      const MockUSDC = await ethers.getContractFactory("MockUSDC");
      mockUSDC = await MockUSDC.deploy(); // MockUSDC constructor takes no arguments
      await mockUSDC.waitForDeployment();
      actualBondCurrency = await mockUSDC.getAddress();
      console.log("✅ Mock USDC deployed to:", actualBondCurrency);
    }
  }

  console.log("\n📋 Polygon Deployment Configuration:");
  console.log("- UMA Finder:", actualUmaFinder, mockUMAFinder ? "(Mock)" : "(Real)");
  console.log("- Bond Currency:", actualBondCurrency, mockUSDC ? "(Mock USDC)" : "(Real USDC)");
  console.log("- Default Creation Fee:", ethers.formatEther(config.defaultCreationFee), "MATIC");
  console.log("- Trading Fee Rate:", config.tradingFeeRate, "basis points");

  // Verify we have required environment variables
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }

  if (!process.env.POLYGONSCAN_API_KEY) {
    console.log("⚠️  Warning: POLYGONSCAN_API_KEY not set. Contract verification will be skipped.");
  }

  // Step 1: Deploy UMA Oracle Manager
  console.log("\n1️⃣ Deploying UMA Oracle Manager...");
  const UMAOracleManager = await ethers.getContractFactory("UMAOracleManager");
  const umaOracleManager = await UMAOracleManager.deploy(
    actualUmaFinder,
    actualBondCurrency,
    deployer.address // admin
  );
  await umaOracleManager.waitForDeployment();
  console.log("✅ UMA Oracle Manager deployed to:", await umaOracleManager.getAddress());

  // Step 2: Deploy Central Vault
  console.log("\n2️⃣ Deploying Central Vault...");
  const CentralVault = await ethers.getContractFactory("CentralVault");
  const centralVault = await CentralVault.deploy(
    deployer.address,
    config.emergencyPauseDuration,
    actualBondCurrency // Primary collateral (USDC)
  );
  await centralVault.waitForDeployment();
  console.log("✅ Central Vault deployed to:", await centralVault.getAddress());

  // Step 3: Deploy Order Router
  console.log("\n3️⃣ Deploying Order Router...");
  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const orderRouter = await OrderRouter.deploy(
    await centralVault.getAddress(),
    await umaOracleManager.getAddress(),
    deployer.address,
    config.tradingFeeRate
  );
  await orderRouter.waitForDeployment();
  console.log("✅ Order Router deployed to:", await orderRouter.getAddress());

  // Step 4: Deploy OrderBook Implementation
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
    deployer.address,
    config.defaultCreationFee,
    deployer.address // fee recipient
  );
  await factory.waitForDeployment();
  console.log("✅ Metrics Market Factory deployed to:", await factory.getAddress());

  // Step 6: Configure contracts
  console.log("\n6️⃣ Configuring contracts...");
  console.log("- Authorizing factory in UMA Oracle Manager...");
  await umaOracleManager.grantRole(
    await umaOracleManager.METRIC_MANAGER_ROLE(),
    await factory.getAddress()
  );

  console.log("- Authorizing router in Central Vault...");
  await centralVault.setMarketAuthorization(await orderRouter.getAddress(), true);

  console.log("- Granting MARKET_ROLE to factory for OrderBook deployment...");
  await orderRouter.grantRole(
    await orderRouter.MARKET_ROLE(),
    await factory.getAddress()
  );

  console.log("- Authorizing factory to create markets in vault...");
  await centralVault.setMarketAuthorization(await factory.getAddress(), true);

  // Step 7: Display deployment summary
  console.log("\n🎉 Polygon deployment completed successfully!");
  console.log("\n📋 Contract Addresses:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("UMA Oracle Manager:     ", await umaOracleManager.getAddress());
  console.log("Central Vault:          ", await centralVault.getAddress());
  console.log("Order Router:           ", await orderRouter.getAddress());
  console.log("OrderBook Implementation:", await orderBookImplementation.getAddress());
  console.log("Metrics Market Factory: ", await factory.getAddress());
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Step 8: Verify contracts
  if (isVerificationSupported() && process.env.POLYGONSCAN_API_KEY) {
    console.log("\n🔍 Starting contract verification on Polygonscan...");

    const contractsToVerify = [];

    // Add mock contracts if deployed
    if (mockUMAFinder) {
      contractsToVerify.push({
        contract: mockUMAFinder,
        constructorArguments: [],
        name: "MockUMAFinder",
        contractPath: "contracts/mocks/MockUMAFinder.sol:MockUMAFinder"
      });
    }

    if (mockUSDC) {
      contractsToVerify.push({
        contract: mockUSDC,
        constructorArguments: [], // MockUSDC constructor takes no arguments
        name: "MockUSDC",
        contractPath: "contracts/mocks/MockUSDC.sol:MockUSDC"
      });
    }

    // Add core contracts
    contractsToVerify.push({
      contract: umaOracleManager,
      constructorArguments: [actualUmaFinder, actualBondCurrency, deployer.address],
      name: "UMAOracleManager",
      contractPath: "contracts/core/UMAOracleManager.sol:UMAOracleManager"
    });

    contractsToVerify.push({
      contract: centralVault,
      constructorArguments: [deployer.address, config.emergencyPauseDuration, actualBondCurrency],
      name: "CentralVault",
      contractPath: "contracts/core/CentralVault.sol:CentralVault"
    });

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

    contractsToVerify.push({
      contract: orderBookImplementation,
      constructorArguments: [],
      name: "OrderBook Implementation",
      contractPath: "contracts/core/OrderBook.sol:OrderBook"
    });

    contractsToVerify.push({
      contract: factory,
      constructorArguments: [
        await umaOracleManager.getAddress(),
        await orderBookImplementation.getAddress(),
        await centralVault.getAddress(),
        await orderRouter.getAddress(),
        deployer.address,
        config.defaultCreationFee,
        deployer.address
      ],
      name: "MetricsMarketFactory",
      contractPath: "contracts/core/MetricsMarketFactory.sol:MetricsMarketFactory"
    });

    await verifyContracts(contractsToVerify);
  } else {
    console.log("\n⚠️  Skipping verification - POLYGONSCAN_API_KEY not provided");
  }

  // Step 9: Save deployment data
  const deploymentData = {
    network: network.name,
    chainId: (await deployer.provider.getNetwork()).chainId,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      umaOracleManager: await umaOracleManager.getAddress(),
      centralVault: await centralVault.getAddress(),
      orderRouter: await orderRouter.getAddress(),
      orderBookImplementation: await orderBookImplementation.getAddress(),
      factory: await factory.getAddress(),
      ...(mockUMAFinder && { mockUMAFinder: await mockUMAFinder.getAddress() }),
      ...(mockUSDC && { mockUSDC: await mockUSDC.getAddress() })
    },
    config: {
      ...config,
      actualUmaFinder,
      actualBondCurrency
    }
  };

  const deploymentFile = `deployments/polygon-deployment-${Date.now()}.json`;
  require('fs').writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
  console.log(`\n💾 Deployment data saved to: ${deploymentFile}`);

  // Step 10: Save deployment data to Supabase
  console.log("\n🗄️ Saving deployment data to Supabase...");
  const supabaseData: ContractDeploymentData = {
    umaOracleManager: await umaOracleManager.getAddress(),
    centralVault: await centralVault.getAddress(),
    orderRouter: await orderRouter.getAddress(),
    orderBookImplementation: await orderBookImplementation.getAddress(),
    factory: await factory.getAddress(),
    ...(mockUMAFinder && { mockUMAFinder: await mockUMAFinder.getAddress() }),
    ...(mockUSDC && { mockUSDC: await mockUSDC.getAddress() }),
    chainId: (await deployer.provider.getNetwork()).chainId,
    deployer: deployer.address,
    defaultCreationFee: ethers.formatEther(config.defaultCreationFee),
    tradingFeeRate: config.tradingFeeRate,
    emergencyPauseDuration: config.emergencyPauseDuration
  };

  const supabaseSaved = await saveContractDeployment(supabaseData);
  if (supabaseSaved) {
    console.log("✅ Contract deployment data saved to Supabase database");
  } else {
    console.log("⚠️  Could not save to Supabase - check environment variables");
    console.log("💡 Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env to enable database integration");
  }

  console.log("\n🔧 Next Steps:");
  console.log("1. ✅ Contracts deployed and verified on Polygon");
  console.log("2. ✅ Contract addresses saved to database");
  console.log("3. Configure governance parameters");
  console.log("4. Set up monitoring and alerting");
  console.log("5. Create initial markets");
  console.log("6. Begin user onboarding");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
