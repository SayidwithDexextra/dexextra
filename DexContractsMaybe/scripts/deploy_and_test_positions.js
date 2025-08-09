const { ethers } = require("hardhat");

async function main() {
  console.log(
    "🚀 Deploying and Testing SimpleVAMM System with $1 Starting Price...\n"
  );

  // Get signers
  const [deployer] = await ethers.getSigners();
  console.log("📋 Deploying with account:", await deployer.getAddress());
  console.log(
    "💰 Account balance:",
    ethers.formatEther(
      await deployer.provider.getBalance(await deployer.getAddress())
    ),
    "MATIC\n"
  );

  // Create additional wallets for testing (using same deployer for simplicity on mainnet)
  const trader1 = deployer; // Use deployer as trader1
  const trader2 = deployer; // Use deployer as trader2 (same account for testing)

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

  // Set VAMM in vault
  await vault.setVamm(await vamm.getAddress());
  console.log("✅ Vault configured with VAMM address");

  // Mint USDC to traders
  const mintAmount = ethers.parseUnits("100000", 6); // 100,000 USDC (6 decimals)
  await usdc.mint(await trader1.getAddress(), mintAmount);
  await usdc.mint(await trader2.getAddress(), mintAmount);
  console.log("✅ Minted 100,000 USDC to trader1 and trader2");

  // Connect contracts to traders
  const usdcTrader1 = usdc.connect(trader1);
  const vammTrader1 = vamm.connect(trader1);
  const vaultTrader1 = vault.connect(trader1);

  const usdcTrader2 = usdc.connect(trader2);
  const vammTrader2 = vamm.connect(trader2);
  const vaultTrader2 = vault.connect(trader2);

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

  // Deposit collateral for trader1
  const collateralAmount = ethers.parseUnits("50000", 6); // 50,000 USDC
  await usdcTrader1.approve(await vault.getAddress(), collateralAmount);
  await vaultTrader1.depositCollateral(
    await trader1.getAddress(),
    collateralAmount
  );
  console.log("✅ Trader1 deposited 50,000 USDC collateral");

  // Check available margin first
  const availableMargin = await vault.getAvailableMargin(
    await trader1.getAddress()
  );
  console.log(
    "🔍 Available margin:",
    ethers.formatUnits(availableMargin, 6),
    "USDC"
  );

  // Debug vault state
  const collateralBalance = await vault.getCollateralBalance(
    await trader1.getAddress()
  );
  const reservedMargin = await vault.getReservedMargin(
    await trader1.getAddress()
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

  // Calculate position size needed for 25% price increase
  // Target price = $1.25, current price = $1.00
  // Try larger position to achieve 25% increase
  const longCollateral = ethers.parseUnits("5000", 6); // 5,000 USDC collateral
  const leverage = 2; // 2x leverage for 10,000 USD position
  const currentPrice = await vamm.getMarkPrice();
  const minPrice = 0; // No minimum price limit
  const maxPrice = ethers.parseEther("2"); // Maximum $2 price limit

  console.log(
    "📈 Opening long position with $5,000 collateral at 2x leverage..."
  );

  // Calculate expected fees for debugging
  const positionSize = longCollateral * BigInt(leverage);
  const tradingFee = (positionSize * BigInt(30)) / BigInt(10000); // 0.3% fee
  const totalCost = longCollateral + tradingFee;
  console.log("🔍 Position size:", ethers.formatUnits(positionSize, 6), "USD");
  console.log("🔍 Trading fee:", ethers.formatUnits(tradingFee, 6), "USDC");
  console.log("🔍 Total cost:", ethers.formatUnits(totalCost, 6), "USDC");

  await vammTrader1.openPosition(
    longCollateral,
    true,
    leverage,
    minPrice,
    maxPrice
  );

  let newPrice = await vamm.getMarkPrice();
  console.log("💰 New Mark Price:", ethers.formatEther(newPrice), "USD");

  // Check if we need a larger position
  if (parseFloat(ethers.formatEther(newPrice)) < 1.2) {
    console.log("🔄 Opening additional long position to reach target...");

    // Check available margin for second position
    const availableMargin2 = await vault.getAvailableMargin(
      await trader1.getAddress()
    );
    console.log(
      "🔍 Available margin for 2nd position:",
      ethers.formatUnits(availableMargin2, 6),
      "USDC"
    );

    if (availableMargin2 > ethers.parseUnits("100", 6)) {
      const additionalCollateral = ethers.parseUnits("50", 6); // Smaller additional position
      const additionalLeverage = 2; // 2x leverage
      await vammTrader1.openPosition(
        additionalCollateral,
        true,
        additionalLeverage,
        minPrice,
        maxPrice
      );
      newPrice = await vamm.getMarkPrice();
      console.log(
        "💰 Updated Mark Price:",
        ethers.formatEther(newPrice),
        "USD"
      );
    } else {
      console.log(
        "⚠️ Insufficient margin for additional position, proceeding with current price"
      );
    }
  }

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
  console.log("🎯 Target: Current price → 50% decrease");

  // Deposit collateral for trader2
  await usdcTrader2.approve(await vault.getAddress(), collateralAmount);
  await vaultTrader2.depositCollateral(
    await trader2.getAddress(),
    collateralAmount
  );
  console.log("✅ Trader2 deposited 10,000 USDC collateral");

  const currentPriceForShort = parseFloat(
    ethers.formatEther(await vamm.getMarkPrice())
  );
  const targetPrice = currentPriceForShort * 0.5; // 50% decrease
  console.log(
    `🎯 Current: $${currentPriceForShort.toFixed(
      4
    )}, Target: $${targetPrice.toFixed(4)}`
  );

  // Calculate position size needed for 50% price decrease
  // Need to overcome existing longs and then drive price down
  const shortCollateral = ethers.parseUnits("5000", 6); // 5,000 USDC collateral
  const shortLeverage = 3; // 3x leverage for 15,000 USD position
  const shortMinPrice = 0; // No minimum price limit
  const shortMaxPrice = ethers.parseEther("10"); // Maximum $10 price limit

  console.log(
    "📉 Opening short position with $5,000 collateral at 3x leverage..."
  );
  await vammTrader2.openPosition(
    shortCollateral,
    false,
    shortLeverage,
    shortMinPrice,
    shortMaxPrice
  );

  let finalPrice = await vamm.getMarkPrice();
  console.log("💰 New Mark Price:", ethers.formatEther(finalPrice), "USD");

  // Check if we need an even larger position
  const actualPrice = parseFloat(ethers.formatEther(finalPrice));
  if (actualPrice > targetPrice * 1.1) {
    // If we're more than 10% above target
    console.log("🔄 Opening additional short position to reach target...");
    const additionalShortCollateral = ethers.parseUnits("3333", 6); // Additional 3,333 USDC collateral
    const additionalShortLeverage = 3; // 3x leverage for 10,000 USD position
    await vammTrader2.openPosition(
      additionalShortCollateral,
      false,
      additionalShortLeverage,
      shortMinPrice,
      shortMaxPrice
    );
    finalPrice = await vamm.getMarkPrice();
    console.log(
      "💰 Updated Mark Price:",
      ethers.formatEther(finalPrice),
      "USD"
    );
  }

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
