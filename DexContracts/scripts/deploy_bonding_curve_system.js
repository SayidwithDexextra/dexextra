const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying Bonding Curve vAMM System...\n");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Deploying contracts with account:", deployer.address);
  console.log(
    "💰 Account balance:",
    hre.ethers.formatEther(
      await deployer.provider.getBalance(deployer.address)
    ),
    "ETH\n"
  );

  // ===== DEPLOY BASE CONTRACTS =====
  console.log("=".repeat(60));
  console.log("📦 DEPLOYING BASE CONTRACTS");
  console.log("=".repeat(60));

  // Deploy MockUSDC (collateral token)
  console.log("\n💰 Deploying MockUSDC...");
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
  const oraclePrice = hre.ethers.parseEther("2000"); // $2000 (used as reference)
  const mockOracle = await MockPriceOracle.deploy(oraclePrice);
  await mockOracle.waitForDeployment();
  const oracleAddress = await mockOracle.getAddress();
  console.log("✅ MockPriceOracle deployed to:", oracleAddress);

  // Deploy Bonding Curve vAMMFactory
  console.log("\n🏭 Deploying Bonding Curve vAMMFactory...");
  const VAMMFactory = await hre.ethers.getContractFactory("vAMMFactory");
  const vammFactory = await VAMMFactory.deploy();
  await vammFactory.waitForDeployment();
  const factoryAddress = await vammFactory.getAddress();
  console.log("✅ Bonding Curve vAMMFactory deployed to:", factoryAddress);

  // Get deployment fee
  const deploymentFee = await vammFactory.deploymentFee();
  console.log(
    "💸 Deployment fee:",
    hre.ethers.formatEther(deploymentFee),
    "ETH"
  );

  // ===== CREATE DEMO MARKETS =====
  console.log("\n" + "=".repeat(60));
  console.log("🏪 CREATING DEMO BONDING CURVE MARKETS");
  console.log("=".repeat(60));

  const markets = [];

  // 1. PUMP MARKET - Ultra low starting price for maximum pump potential
  console.log("\n🚀 Creating PUMP Market (Maximum pump potential)...");
  const pumpTx = await vammFactory.createPumpMarket(
    "ROCKET",
    oracleAddress,
    usdcAddress,
    { value: deploymentFee }
  );
  await pumpTx.wait();
  console.log("✅ PUMP Market created: ROCKET");

  // 2. STANDARD MARKET - Custom balanced starting price
  console.log("\n⚖️ Creating STANDARD Market (Balanced pump/stability)...");
  const standardPrice = hre.ethers.parseEther("8"); // $8.00 starting price
  const standardTx = await vammFactory.createStandardMarket(
    "BALANCED",
    oracleAddress,
    usdcAddress,
    standardPrice,
    { value: deploymentFee }
  );
  await standardTx.wait();
  console.log("✅ STANDARD Market created: BALANCED at $8.00");

  // 3. BLUE CHIP MARKET - High starting price for stability
  console.log("\n💎 Creating BLUE CHIP Market (Premium/stable)...");
  const blueChipPrice = hre.ethers.parseEther("500"); // $500 starting price
  const blueChipTx = await vammFactory.createBlueChipMarket(
    "PREMIUM",
    oracleAddress,
    usdcAddress,
    blueChipPrice,
    { value: deploymentFee }
  );
  await blueChipTx.wait();
  console.log("✅ BLUE CHIP Market created: PREMIUM at $500.00");

  // 4. CUSTOM MARKET - Ultra micro-cap for extreme pumps
  console.log("\n🌙 Creating CUSTOM Market (Ultra micro-cap)...");
  const ultraMicroPrice = hre.ethers.parseUnits("1", 14); // $0.0001
  const customTx = await vammFactory.createMarket(
    "MOON",
    oracleAddress,
    usdcAddress,
    ultraMicroPrice,
    { value: deploymentFee }
  );
  await customTx.wait();
  console.log("✅ CUSTOM Market created: MOON at $0.0001");

  // ===== ANALYZE MARKETS =====
  console.log("\n" + "=".repeat(60));
  console.log("📊 MARKET ANALYSIS");
  console.log("=".repeat(60));

  // Get all market IDs
  const allMarketIds = await vammFactory.getAllMarketIds();
  console.log(`\n📋 Total markets created: ${allMarketIds.length}`);

  for (let i = 0; i < allMarketIds.length; i++) {
    const marketInfo = await vammFactory.getMarket(allMarketIds[i]);
    const vammContract = await hre.ethers.getContractAt(
      "vAMM",
      marketInfo.vamm
    );

    console.log(`\n📈 Market ${i + 1}: ${marketInfo.symbol}`);
    console.log(`   • Type: ${getMarketTypeName(marketInfo.marketType)}`);
    console.log(
      `   • Starting Price: $${hre.ethers.formatEther(
        marketInfo.startingPrice
      )}`
    );
    console.log(`   • vAMM Address: ${marketInfo.vamm}`);
    console.log(`   • Vault Address: ${marketInfo.vault}`);

    // Get bonding curve info
    try {
      const bondingInfo = await vammContract.getBondingCurveInfo();
      console.log(
        `   • Current Price: $${hre.ethers.formatEther(
          bondingInfo.currentPrice
        )}`
      );
      console.log(`   • Total Supply: ${bondingInfo.totalSupply.toString()}`);
      console.log(
        `   • Max Price: $${hre.ethers.formatEther(bondingInfo.maxPrice)}`
      );
    } catch (error) {
      console.log(`   • Bonding curve info: Error (${error.message})`);
    }
  }

  // ===== DEMONSTRATE PRICE CALCULATION =====
  console.log("\n" + "=".repeat(60));
  console.log("🧮 BONDING CURVE PRICE DEMONSTRATIONS");
  console.log("=".repeat(60));

  // Get the PUMP market for demonstration
  const pumpMarkets = await vammFactory.getPumpMarkets();
  if (pumpMarkets.length > 0) {
    const pumpMarketInfo = await vammFactory.getMarket(pumpMarkets[0]);
    const pumpVAMM = await hre.ethers.getContractAt(
      "vAMM",
      pumpMarketInfo.vamm
    );

    console.log(`\n🚀 PUMP Market Analysis: ${pumpMarketInfo.symbol}`);
    console.log(
      `   Starting Price: $${hre.ethers.formatEther(
        pumpMarketInfo.startingPrice
      )}`
    );

    // Simulate different buy amounts
    const buyAmounts = [
      hre.ethers.parseEther("1000"), // $1000 position
      hre.ethers.parseEther("10000"), // $10000 position
      hre.ethers.parseEther("100000"), // $100000 position
    ];

    for (const amount of buyAmounts) {
      try {
        const buyCost = await pumpVAMM.calculateBuyCost(amount);
        const priceImpact = await pumpVAMM.getPriceImpact(amount, true);

        console.log(`   Buy $${hre.ethers.formatEther(amount)}:`);
        console.log(`     • Total Cost: $${hre.ethers.formatEther(buyCost)}`);
        console.log(
          `     • Price Impact: $${hre.ethers.formatEther(priceImpact)}`
        );
      } catch (error) {
        console.log(`     • Error calculating: ${error.message}`);
      }
    }
  }

  // ===== TEST FAUCET =====
  console.log("\n" + "=".repeat(60));
  console.log("💧 TESTING USDC FAUCET");
  console.log("=".repeat(60));

  const faucetAmount = hre.ethers.parseUnits("10000", 6); // 10,000 USDC
  await mockUSDC.faucet(faucetAmount);
  const balance = await mockUSDC.balanceOf(deployer.address);
  console.log(
    `✅ Received ${hre.ethers.formatUnits(balance, 6)} USDC from faucet`
  );

  // ===== FINAL SUMMARY =====
  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));

  const defaultPrices = await vammFactory.getDefaultStartingPrices();

  console.log("\n📋 Deployment Summary:");
  console.log(`   • MockUSDC: ${usdcAddress}`);
  console.log(`   • MockOracle: ${oracleAddress}`);
  console.log(`   • Bonding Curve Factory: ${factoryAddress}`);
  console.log(`   • Total Markets: ${allMarketIds.length}`);

  console.log("\n💰 Default Starting Prices:");
  console.log(`   • PUMP: $${hre.ethers.formatEther(defaultPrices.pumpPrice)}`);
  console.log(
    `   • STANDARD: $${hre.ethers.formatEther(defaultPrices.standardPrice)}`
  );
  console.log(
    `   • BLUE CHIP: $${hre.ethers.formatEther(defaultPrices.blueChipPrice)}`
  );

  console.log("\n🎯 Bonding Curve Features:");
  console.log("   ✅ Custom starting prices (any amount)");
  console.log("   ✅ Progressive difficulty (early pumps easier)");
  console.log("   ✅ Multiple market types (PUMP/STANDARD/BLUE_CHIP)");
  console.log("   ✅ Price impact calculations");
  console.log("   ✅ Backwards compatibility with legacy systems");

  console.log("\n🔧 Next Steps:");
  console.log("   • Deposit USDC collateral to start trading");
  console.log("   • Open positions to see bonding curve in action");
  console.log("   • Create more markets with different starting prices");
  console.log("   • Watch how early buys create massive pumps!");

  return {
    mockUSDC: usdcAddress,
    mockOracle: oracleAddress,
    vammFactory: factoryAddress,
    markets: allMarketIds,
  };
}

function getMarketTypeName(typeNumber) {
  const types = ["PUMP", "STANDARD", "BLUE_CHIP"];
  return types[typeNumber] || "UNKNOWN";
}

// Handle script execution
main()
  .then((result) => {
    console.log("\n✨ Bonding curve system ready for pump.fund style trading!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
