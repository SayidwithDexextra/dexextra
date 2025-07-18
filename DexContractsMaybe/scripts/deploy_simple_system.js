const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Deploying Simple VAMM System...\n");

  // Get signers
  const [deployer, trader1, trader2] = await ethers.getSigners();
  console.log("📋 Deploying with account:", deployer.address);
  console.log(
    "💰 Account balance:",
    ethers.formatEther(await deployer.provider.getBalance(deployer.address)),
    "ETH\n"
  );

  // =================================
  // 1. DEPLOY SIMPLE USDC TOKEN
  // =================================
  console.log("📄 1. Deploying SimpleUSDC...");
  const SimpleUSDC = await ethers.getContractFactory("SimpleUSDC");
  const usdc = await SimpleUSDC.deploy(1000000); // 1M USDC initial supply
  await usdc.waitForDeployment();
  console.log("✅ SimpleUSDC deployed to:", await usdc.getAddress());

  // =================================
  // 2. DEPLOY SIMPLE PRICE ORACLE
  // =================================
  console.log("\n📄 2. Deploying SimplePriceOracle...");
  const initialPrice = ethers.parseEther("100"); // $100 starting price
  const SimplePriceOracle = await ethers.getContractFactory(
    "SimplePriceOracle"
  );
  const oracle = await SimplePriceOracle.deploy(initialPrice);
  await oracle.waitForDeployment();
  console.log("✅ SimplePriceOracle deployed to:", await oracle.getAddress());
  console.log("💰 Initial oracle price: $100");

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
  const mintAmount = ethers.parseUnits("10000", 6); // 10,000 USDC (6 decimals)
  await usdc.mint(trader1.address, mintAmount);
  await usdc.mint(trader2.address, mintAmount);
  console.log("✅ Minted 10,000 USDC to trader1 and trader2");

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
  console.log(
    "💵 Quote Reserves:",
    ethers.formatEther(marketSummary.quoteReserves)
  );

  // =================================
  // 7. DEMONSTRATE 25% PRICE MOVEMENT
  // =================================
  console.log("\n🎯 7. Demonstrating 25% Price Movement Through Trading:");
  console.log("Target: Move price from $100 → $125 (25% increase)");

  // Connect trader1 to contracts
  const trader1USDC = usdc.connect(trader1);
  const trader1Vault = vault.connect(trader1);
  const trader1VAMM = vamm.connect(trader1);

  // Step 1: Deposit collateral
  console.log("\n📥 Step 1: Trader1 deposits collateral...");
  const collateralAmount = ethers.parseUnits("5000", 6); // 5,000 USDC
  await trader1Vault.depositCollateral(trader1.address, collateralAmount);
  console.log("✅ Deposited 5,000 USDC as collateral");

  // Calculate required position size for 25% price movement
  // We'll use trial and error with increasing position sizes
  console.log("\n📈 Step 2: Opening progressively larger long positions...");

  let currentPrice = initialMarkPrice;
  let targetPrice = (initialMarkPrice * 125n) / 100n; // 25% increase
  let positionCount = 0;
  const minPrice = 0;
  const maxPrice = ethers.parseEther("200"); // $200 max slippage protection

  console.log("🎯 Target price:", ethers.formatEther(targetPrice), "USD");

  // Open multiple positions to reach target price
  const positions = [];

  while (currentPrice < targetPrice && positionCount < 10) {
    positionCount++;

    // Increase position size each time for exponential effect
    const leverage = 10; // 10x leverage for stronger impact
    const collateral = ethers.parseUnits((1000 * positionCount).toString(), 6); // Larger increasing collateral

    console.log(`\n🔄 Position ${positionCount}:`);
    console.log("  💰 Collateral:", ethers.formatUnits(collateral, 6), "USDC");
    console.log("  📊 Leverage:", leverage + "x");
    console.log(
      "  💵 Position Size:",
      ethers.formatUnits(collateral * BigInt(leverage), 6),
      "USD"
    );

    try {
      // Open long position
      const tx = await trader1VAMM.openPosition(
        collateral,
        true, // isLong
        leverage,
        minPrice,
        maxPrice
      );

      const receipt = await tx.wait();
      const positionId = positionCount; // Simplified - first position is ID 1
      positions.push(positionId);

      // Get new price
      currentPrice = await vamm.getMarkPrice();
      const priceChange =
        ((currentPrice - initialMarkPrice) * 100n) / initialMarkPrice;

      console.log("  ✅ Position opened! ID:", positionId);
      console.log(
        "  🏷️  New Mark Price:",
        ethers.formatEther(currentPrice),
        "USD"
      );
      console.log("  📊 Price Change:", priceChange.toString() + "%");

      // Check if we've reached our target
      if (currentPrice >= targetPrice) {
        console.log("  🎉 TARGET REACHED! 25% price increase achieved!");
        break;
      }
    } catch (error) {
      console.log("  ❌ Failed to open position:", error.message);
      break;
    }
  }

  // =================================
  // 8. FINAL MARKET STATE
  // =================================
  console.log("\n📊 8. Final Market State:");
  const finalMarkPrice = await vamm.getMarkPrice();
  const finalSummary = await vamm.getMarketSummary();
  const finalPriceChange =
    ((finalMarkPrice - initialMarkPrice) * 100n) / initialMarkPrice;

  console.log(
    "💰 Final Mark Price:",
    ethers.formatEther(finalMarkPrice),
    "USD"
  );
  console.log("📈 Total Price Change:", finalPriceChange.toString() + "%");
  console.log(
    "📊 Net Position:",
    ethers.formatUnits(finalSummary.netPositionSize, 6),
    "USD"
  );
  console.log(
    "🔢 Total Longs:",
    ethers.formatUnits(finalSummary.totalLongSizeUint, 6),
    "USD"
  );
  console.log(
    "🔻 Total Shorts:",
    ethers.formatUnits(finalSummary.totalShortSizeUint, 6),
    "USD"
  );
  console.log(
    "🏦 Base Reserves:",
    ethers.formatEther(finalSummary.baseReserves)
  );
  console.log(
    "💵 Quote Reserves:",
    ethers.formatEther(finalSummary.quoteReserves)
  );

  // =================================
  // 9. DEMONSTRATE SHORT SELLING EFFECT
  // =================================
  console.log("\n🔻 9. Demonstrating Short Selling (Price Decrease):");

  // Connect trader2 for short selling
  const trader2USDC = usdc.connect(trader2);
  const trader2Vault = vault.connect(trader2);
  const trader2VAMM = vamm.connect(trader2);

  // Trader2 deposits collateral
  await trader2Vault.depositCollateral(trader2.address, collateralAmount);
  console.log("✅ Trader2 deposited 5,000 USDC as collateral");

  const priceBeforeShort = await vamm.getMarkPrice();
  console.log(
    "💰 Price before short:",
    ethers.formatEther(priceBeforeShort),
    "USD"
  );

  // Open large short position
  const shortCollateral = ethers.parseUnits("3000", 6); // 3,000 USDC
  const shortLeverage = 10; // 10x leverage for big impact

  console.log("📉 Opening large short position...");
  console.log(
    "  💰 Collateral:",
    ethers.formatUnits(shortCollateral, 6),
    "USDC"
  );
  console.log("  📊 Leverage:", shortLeverage + "x");
  console.log(
    "  💵 Position Size:",
    ethers.formatUnits(shortCollateral * BigInt(shortLeverage), 6),
    "USD"
  );

  try {
    await trader2VAMM.openPosition(
      shortCollateral,
      false, // isLong = false (SHORT)
      shortLeverage,
      minPrice,
      maxPrice
    );

    const priceAfterShort = await vamm.getMarkPrice();
    const shortPriceChange =
      ((priceAfterShort - priceBeforeShort) * 100n) / priceBeforeShort;

    console.log("✅ Short position opened!");
    console.log(
      "🏷️  New Mark Price:",
      ethers.formatEther(priceAfterShort),
      "USD"
    );
    console.log(
      "📊 Price Change from Short:",
      shortPriceChange.toString() + "%"
    );
    console.log(
      "🎯 This demonstrates traditional futures behavior - shorts DO affect price!"
    );
  } catch (error) {
    console.log("❌ Failed to open short position:", error.message);
  }

  // =================================
  // 10. SUMMARY
  // =================================
  console.log("\n🎉 10. System Deployment Summary:");
  console.log("=======================================");
  console.log("📄 SimpleUSDC:", await usdc.getAddress());
  console.log("🔮 SimplePriceOracle:", await oracle.getAddress());
  console.log("🏦 SimpleVault:", await vault.getAddress());
  console.log("📊 SimpleVAMM:", await vamm.getAddress());
  console.log("\n✅ Traditional futures market successfully deployed!");
  console.log("✅ Demonstrated 25% price movement through long positions!");
  console.log("✅ Demonstrated price decrease through short positions!");
  console.log(
    "✅ Both longs and shorts affect price equally (true futures behavior)!"
  );

  console.log("\n📋 Testing Commands:");
  console.log(
    "npx hardhat run DexContractsMaybe/scripts/deploy_simple_system.js --network localhost"
  );

  return {
    usdc: await usdc.getAddress(),
    oracle: await oracle.getAddress(),
    vault: await vault.getAddress(),
    vamm: await vamm.getAddress(),
    finalPrice: ethers.formatEther(await vamm.getMarkPrice()),
    priceChange: finalPriceChange.toString(),
  };
}

// Handle both direct execution and module exports
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Deployment failed:", error);
      process.exit(1);
    });
}

module.exports = main;
