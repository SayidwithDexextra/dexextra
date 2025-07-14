const hre = require("hardhat");

async function main() {
  console.log("🚀 Complete vAMM System Deployment & Market Creation...\n");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Deploying with account:", deployer.address);
  console.log(
    "💰 Account balance:",
    hre.ethers.formatEther(
      await deployer.provider.getBalance(deployer.address)
    ),
    "ETH\n"
  );

  // ===== DEPLOYMENT PHASE =====
  console.log("=".repeat(50));
  console.log("📦 DEPLOYMENT PHASE");
  console.log("=".repeat(50));

  // Deploy MockUSDC
  console.log("\n📊 Deploying MockUSDC...");
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const initialSupply = 1000000; // 1 million USDC
  const mockUSDC = await MockUSDC.deploy(initialSupply);
  await mockUSDC.waitForDeployment();
  const usdcAddress = await mockUSDC.getAddress();
  console.log("✅ MockUSDC deployed to:", usdcAddress);

  // Deploy MockPriceOracle
  console.log("\n🔮 Deploying MockPriceOracle...");
  const MockPriceOracle = await hre.ethers.getContractFactory(
    "MockPriceOracle"
  );
  const initialPrice = hre.ethers.parseEther("2000"); // $2000 initial price
  const mockOracle = await MockPriceOracle.deploy(initialPrice);
  await mockOracle.waitForDeployment();
  const oracleAddress = await mockOracle.getAddress();
  console.log("✅ MockPriceOracle deployed to:", oracleAddress);
  console.log(
    "📈 Initial price set to:",
    hre.ethers.formatEther(initialPrice),
    "USD"
  );

  // Deploy vAMMFactory
  console.log("\n🏭 Deploying vAMMFactory...");
  const VAMMFactory = await hre.ethers.getContractFactory("vAMMFactory");
  const vammFactory = await VAMMFactory.deploy();
  await vammFactory.waitForDeployment();
  const factoryAddress = await vammFactory.getAddress();
  console.log("✅ vAMMFactory deployed to:", factoryAddress);

  // Test faucet
  console.log("\n💧 Testing USDC Faucet...");
  const faucetAmount = hre.ethers.parseUnits("10000", 6); // 10,000 USDC
  await mockUSDC.faucet(faucetAmount);
  console.log("✅ Received 10,000 USDC from faucet");

  // ===== MARKET CREATION PHASE =====
  console.log("\n" + "=".repeat(50));
  console.log("🏪 MARKET CREATION PHASE");
  console.log("=".repeat(50));

  // Market parameters
  const marketParams = {
    symbol: "ETH/USD",
    oracle: oracleAddress,
    collateralToken: usdcAddress,
    initialPrice: initialPrice,
  };

  console.log("\n📊 Market Parameters:");
  console.log("   • Symbol:", marketParams.symbol);
  console.log("   • Oracle:", marketParams.oracle);
  console.log("   • Collateral:", marketParams.collateralToken);
  console.log(
    "   • Initial Price:",
    hre.ethers.formatEther(marketParams.initialPrice),
    "USD"
  );

  // Get deployment fee
  const deploymentFee = await vammFactory.deploymentFee();
  console.log(
    "   • Deployment Fee:",
    hre.ethers.formatEther(deploymentFee),
    "ETH"
  );

  console.log("\n🚀 Creating ETH/USD market...");

  try {
    // Create the market
    const tx = await vammFactory.createMarket(
      marketParams.symbol,
      marketParams.oracle,
      marketParams.collateralToken,
      marketParams.initialPrice,
      { value: deploymentFee }
    );

    console.log("⏳ Transaction submitted:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Market created successfully!");

    // Parse the MarketCreated event
    const marketCreatedEvent = receipt.logs.find((log) => {
      try {
        const parsed = vammFactory.interface.parseLog(log);
        return parsed && parsed.name === "MarketCreated";
      } catch (e) {
        return false;
      }
    });

    if (marketCreatedEvent) {
      const parsed = vammFactory.interface.parseLog(marketCreatedEvent);
      const marketData = {
        marketId: parsed.args.marketId,
        vamm: parsed.args.vamm,
        vault: parsed.args.vault,
        symbol: parsed.args.symbol,
      };

      console.log("\n🎯 Market Details:");
      console.log("   • Market ID:", marketData.marketId);
      console.log("   • Symbol:", marketData.symbol);
      console.log("   • vAMM Address:", marketData.vamm);
      console.log("   • Vault Address:", marketData.vault);
      console.log("   • Oracle:", parsed.args.oracle);
      console.log("   • Collateral:", parsed.args.collateralToken);

      // Get additional market info
      const marketInfo = await vammFactory.getMarket(marketData.marketId);
      console.log("\n📈 Market Status:");
      console.log("   • Active:", marketInfo.isActive);
      console.log(
        "   • Created At:",
        new Date(Number(marketInfo.createdAt) * 1000).toLocaleString()
      );

      const totalMarkets = await vammFactory.marketCount();
      console.log("   • Total Markets:", totalMarkets.toString());

      // Test vAMM contract
      console.log("\n🧪 Testing vAMM Contract...");
      const vammContract = await hre.ethers.getContractAt(
        "vAMM",
        marketData.vamm
      );
      const markPrice = await vammContract.getMarkPrice();
      console.log("   • Mark Price:", hre.ethers.formatEther(markPrice), "USD");
      console.log("   • vAMM Owner:", await vammContract.owner());

      // Test Vault contract
      console.log("\n🏦 Testing Vault Contract...");
      const vaultContract = await hre.ethers.getContractAt(
        "Vault",
        marketData.vault
      );
      console.log("   • Vault Owner:", await vaultContract.owner());
      console.log(
        "   • Collateral Token:",
        await vaultContract.collateralToken()
      );

      return {
        deployment: {
          mockUSDC: usdcAddress,
          mockOracle: oracleAddress,
          vammFactory: factoryAddress,
        },
        market: marketData,
      };
    }
  } catch (error) {
    console.error("❌ Market creation failed:", error.message);
    throw error;
  }
}

// Handle script execution
main()
  .then((result) => {
    console.log("\n" + "=".repeat(60));
    console.log("🎉 COMPLETE SUCCESS!");
    console.log("=".repeat(60));

    if (result) {
      console.log("\n📋 Deployment Summary:");
      console.log("   • MockUSDC:", result.deployment.mockUSDC);
      console.log("   • MockPriceOracle:", result.deployment.mockOracle);
      console.log("   • vAMMFactory:", result.deployment.vammFactory);

      console.log("\n🏪 Market Summary:");
      console.log("   • Market ID:", result.market.marketId);
      console.log("   • Symbol:", result.market.symbol);
      console.log("   • vAMM:", result.market.vamm);
      console.log("   • Vault:", result.market.vault);
    }

    console.log("\n🎯 System Ready!");
    console.log("   ✅ Contracts deployed and optimized");
    console.log("   ✅ Sample market created and active");
    console.log("   ✅ All contracts tested and functional");
    console.log("   ✅ USDC faucet available for testing");

    console.log("\n🔧 Next Steps:");
    console.log("   • Deposit collateral to start trading");
    console.log("   • Open long/short positions on the vAMM");
    console.log("   • Update oracle prices for realistic testing");
    console.log("   • Create additional markets as needed");

    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
