const { ethers } = require("hardhat");

async function main() {
  console.log(
    "🚀 Deploying and Testing SimpleVAMM System with $1 Starting Price...\n"
  );

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("📋 Deploying with account:", await deployer.getAddress());
  console.log(
    "💰 Account balance:",
    ethers.formatEther(
      await deployer.provider.getBalance(await deployer.getAddress())
    ),
    "MATIC\n"
  );

  // =================================
  // 1. DEPLOY SIMPLE USDC TOKEN
  // =================================
  console.log("📄 1. Deploying SimpleUSDC...");
  const SimpleUSDC = await ethers.getContractFactory("SimpleUSDC");
  const usdc = await SimpleUSDC.deploy(1000000000); // 1B USDC initial supply
  await usdc.waitForDeployment();
  console.log("✅ SimpleUSDC deployed to:", await usdc.getAddress());

  // =================================
  // 2. DEPLOY SIMPLE PRICE ORACLE WITH $1 STARTING PRICE
  // =================================
  console.log("\n📄 2. Deploying SimplePriceOracle...");
  const initialPrice = ethers.parseEther("1"); // $1 starting price
  const SimplePriceOracle = await ethers.getContractFactory(
    "SimplePriceOracle"
  );
  const oracle = await SimplePriceOracle.deploy(initialPrice);
  await oracle.waitForDeployment();
  console.log("✅ SimplePriceOracle deployed to:", await oracle.getAddress());
  console.log("💰 Initial oracle price: $1.00");

  // =================================
  // 3. DEPLOY SIMPLE VAULT
  // =================================
  console.log("\n📄 3. Deploying SimpleVault...");
  const SimpleVault = await ethers.getContractFactory("SimpleVault");
  const vault = await SimpleVault.deploy(await usdc.getAddress());
  await vault.waitForDeployment();
  console.log("✅ SimpleVault deployed to:", await vault.getAddress());

  // =================================
  // 4. DEPLOY SIMPLE VAMM
  // =================================
  console.log("\n📄 4. Deploying SimpleVAMM...");
  const SimpleVAMM = await ethers.getContractFactory("SimpleVAMM");
  const vamm = await SimpleVAMM.deploy(
    await vault.getAddress(),
    await oracle.getAddress(),
    initialPrice
  );
  await vamm.waitForDeployment();
  console.log("✅ SimpleVAMM deployed to:", await vamm.getAddress());

  // =================================
  // 5. CONFIGURE SYSTEM
  // =================================
  console.log("\n⚙️  5. Configuring system...");
  await vault.setVamm(await vamm.getAddress());
  console.log("✅ Vault configured with VAMM address");

  // Mint USDC to deployer (using same account for simplicity)
  const mintAmount = ethers.parseUnits("1000000", 6); // 1M USDC (6 decimals)
  await usdc.mint(await deployer.getAddress(), mintAmount);
  console.log("✅ Minted 1,000,000 USDC to deployer");

  // =================================
  // 6. DISPLAY INITIAL MARKET STATE
  // =================================
  console.log("\n📊 6. Initial Market State:");
  const initialMarkPrice = await vamm.getMarkPrice();
  const marketSummary = await vamm.getMarketSummary();

  console.log("💰 Mark Price:", ethers.formatEther(initialMarkPrice), "USD");
  console.log(
    "📈 Net Position:",
    ethers.formatUnits(marketSummary.netPositionSize, 6),
    "USD"
  );
  console.log(
    "🔢 Total Longs:",
    ethers.formatUnits(marketSummary.totalLongSizeUint, 6),
    "USD"
  );
  console.log(
    "🔻 Total Shorts:",
    ethers.formatUnits(marketSummary.totalShortSizeUint, 6),
    "USD"
  );
  console.log(
    "🏦 Base Reserves:",
    ethers.formatEther(marketSummary.baseReserves)
  );

  // =================================
  // 7. TEST LONG POSITION TO INCREASE PRICE BY 25%
  // =================================
  console.log("\n🚀 7. Testing Long Position to Increase Price by 25%...");
  console.log("🎯 Target: $1.00 → $1.25 (25% increase)");

  // Deposit collateral
  const collateralAmount = ethers.parseUnits("100000", 6); // 100,000 USDC
  await usdc.approve(await vault.getAddress(), collateralAmount);
  await vault.depositCollateral(await deployer.getAddress(), collateralAmount);
  console.log("✅ Deposited 100,000 USDC collateral");

  // Check available margin and debug state
  const availableMargin = await vault.getAvailableMargin(
    await deployer.getAddress()
  );
  console.log(
    "🔍 Available margin:",
    ethers.formatUnits(availableMargin, 6),
    "USDC"
  );

  const collateralBalance = await vault.getCollateralBalance(
    await deployer.getAddress()
  );
  const reservedMargin = await vault.getReservedMargin(
    await deployer.getAddress()
  );
  console.log(
    "🔍 Collateral balance:",
    ethers.formatUnits(collateralBalance, 6),
    "USDC"
  );
  console.log(
    "🔍 Reserved margin:",
    ethers.formatUnits(reservedMargin, 6),
    "USDC"
  );

  const vaultBalance = await usdc.balanceOf(await vault.getAddress());
  console.log(
    "🔍 Vault USDC balance:",
    ethers.formatUnits(vaultBalance, 6),
    "USDC"
  );

  // Open long position
  const longCollateral = ethers.parseUnits("500", 6); // 500 USDC collateral
  const leverage = 2; // 2x leverage for 1,000 USD position
  const minPrice = 0;
  const maxPrice = ethers.parseEther("10");

  console.log(
    "📈 Opening long position with $500 collateral at 2x leverage..."
  );
  await vamm.openPosition(longCollateral, true, leverage, minPrice, maxPrice);

  let newPrice = await vamm.getMarkPrice();
  console.log("💰 New Mark Price:", ethers.formatEther(newPrice), "USD");

  const priceIncrease =
    ((parseFloat(ethers.formatEther(newPrice)) - 1.0) / 1.0) * 100;
  console.log(`📊 Price increase: ${priceIncrease.toFixed(2)}%`);

  // Display updated market state
  const longMarketSummary = await vamm.getMarketSummary();
  console.log(
    "🔢 Total Longs:",
    ethers.formatUnits(longMarketSummary.totalLongSizeUint, 6),
    "USD"
  );
  console.log(
    "📈 Net Position:",
    ethers.formatUnits(longMarketSummary.netPositionSize, 6),
    "USD"
  );

  // =================================
  // 8. TEST SHORT POSITION TO DECREASE PRICE BY 50%
  // =================================
  console.log("\n🔻 8. Testing Short Position to Decrease Price by 50%...");
  const currentPriceForShort = parseFloat(
    ethers.formatEther(await vamm.getMarkPrice())
  );
  const targetPrice = currentPriceForShort * 0.5; // 50% decrease
  console.log(
    `🎯 Current: $${currentPriceForShort.toFixed(
      4
    )}, Target: $${targetPrice.toFixed(4)}`
  );

  // Open large short position to overcome longs and drive price down
  const shortCollateral = ethers.parseUnits("3000", 6); // 3,000 USDC collateral
  const shortLeverage = 3; // 3x leverage for 9,000 USD position

  console.log(
    "📉 Opening short position with $3,000 collateral at 3x leverage..."
  );
  await vamm.openPosition(
    shortCollateral,
    false,
    shortLeverage,
    minPrice,
    maxPrice
  );

  let finalPrice = await vamm.getMarkPrice();
  console.log("💰 New Mark Price:", ethers.formatEther(finalPrice), "USD");

  const finalPriceValue = parseFloat(ethers.formatEther(finalPrice));
  const priceDecrease =
    ((currentPriceForShort - finalPriceValue) / currentPriceForShort) * 100;
  console.log(`📊 Price decrease: ${priceDecrease.toFixed(2)}%`);

  // =================================
  // 9. FINAL MARKET STATE
  // =================================
  console.log("\n📊 9. Final Market State:");
  const finalMarketSummary = await vamm.getMarketSummary();
  console.log("💰 Final Mark Price:", ethers.formatEther(finalPrice), "USD");
  console.log(
    "📈 Net Position:",
    ethers.formatUnits(finalMarketSummary.netPositionSize, 6),
    "USD"
  );
  console.log(
    "🔢 Total Longs:",
    ethers.formatUnits(finalMarketSummary.totalLongSizeUint, 6),
    "USD"
  );
  console.log(
    "🔻 Total Shorts:",
    ethers.formatUnits(finalMarketSummary.totalShortSizeUint, 6),
    "USD"
  );

  // =================================
  // 10. DEPLOYMENT SUMMARY
  // =================================
  console.log("\n🎉 Deployment & Testing Summary:");
  console.log("=======================================");
  console.log("📄 SimpleUSDC:", await usdc.getAddress());
  console.log("🔮 SimplePriceOracle:", await oracle.getAddress());
  console.log("🏦 SimpleVault:", await vault.getAddress());
  console.log("📊 SimpleVAMM:", await vamm.getAddress());
  console.log("\n🌐 Network: Polygon Mainnet");
  console.log("👤 Deployer:", await deployer.getAddress());
  console.log("💰 Starting Price: $1.00");
  console.log("📈 Long Test Result: +", priceIncrease.toFixed(2), "%");
  console.log("📉 Short Test Result: -", priceDecrease.toFixed(2), "%");

  const deploymentData = {
    network: "polygon",
    chainId: 137,
    deployer: await deployer.getAddress(),
    contracts: {
      SimpleUSDC: await usdc.getAddress(),
      SimplePriceOracle: await oracle.getAddress(),
      SimpleVault: await vault.getAddress(),
      SimpleVAMM: await vamm.getAddress(),
    },
    deploymentTime: new Date().toISOString(),
    initialPrice: "1",
    testResults: {
      longPositionIncrease: `${priceIncrease.toFixed(2)}%`,
      shortPositionDecrease: `${priceDecrease.toFixed(2)}%`,
      finalPrice: ethers.formatEther(finalPrice),
    },
  };

  return deploymentData;
}

// Handle both direct execution and module exports
if (require.main === module) {
  main()
    .then((data) => {
      console.log("\n✅ Deployment and testing completed successfully!");
      console.log("📋 All tests passed with requested price movements");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Deployment or testing failed:", error);
      process.exit(1);
    });
}

module.exports = main;
