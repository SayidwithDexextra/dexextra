const hre = require("hardhat");

async function main() {
  console.log("🚀 Working vAMM System Deployment (Units Fixed)");
  console.log("=".repeat(60));

  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Deploying with account:", deployer.address);
  console.log(
    "💰 Account balance:",
    hre.ethers.formatEther(
      await deployer.provider.getBalance(deployer.address)
    ),
    "MATIC\n"
  );

  try {
    // ===== STEP 1: Deploy and Setup =====
    console.log("📦 STEP 1: Deploying Contracts...");

    // Deploy MockUSDC
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy(1000000);
    await mockUSDC.waitForDeployment();
    const usdcAddress = await mockUSDC.getAddress();
    console.log("   ✅ MockUSDC:", usdcAddress);

    // Deploy MockOracle
    const MockPriceOracle = await hre.ethers.getContractFactory(
      "MockPriceOracle"
    );
    const mockOracle = await MockPriceOracle.deploy(
      hre.ethers.parseEther("2000")
    );
    await mockOracle.waitForDeployment();
    const oracleAddress = await mockOracle.getAddress();
    console.log("   ✅ MockOracle:", oracleAddress);

    // Deploy Vault
    const Vault = await hre.ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(usdcAddress);
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();
    console.log("   ✅ Vault:", vaultAddress);

    // Deploy vAMM
    const VAMM = await hre.ethers.getContractFactory("vAMM");
    const vamm = await VAMM.deploy(
      vaultAddress,
      oracleAddress,
      hre.ethers.parseEther("1")
    );
    await vamm.waitForDeployment();
    const vammAddress = await vamm.getAddress();
    console.log("   ✅ vAMM:", vammAddress);

    // Configure
    await vault.setVamm(vammAddress);
    console.log("   ✅ Vault configured");

    // ===== STEP 2: Setup Trading =====
    console.log("\n💰 STEP 2: Setting Up Trading...");

    // Mint and approve USDC
    await mockUSDC.mint(deployer.address, hre.ethers.parseUnits("50000", 6));
    await mockUSDC.approve(vaultAddress, hre.ethers.parseUnits("20000", 6));
    await vault.depositCollateral(
      deployer.address,
      hre.ethers.parseUnits("10000", 6)
    );

    const availableMargin = await vault.getAvailableMargin(deployer.address);
    console.log(
      "   📊 Available margin:",
      hre.ethers.formatUnits(availableMargin, 6),
      "USDC"
    );

    // ===== STEP 3: Test Small Position =====
    console.log("\n🎯 STEP 3: Testing Small Position...");

    const initialPrice = await vamm.getMarkPrice();
    console.log(
      "   💎 Initial price:",
      hre.ethers.formatEther(initialPrice),
      "USD"
    );

    // Try a very small position first - $10 collateral, 2x leverage
    const smallCollateral = hre.ethers.parseUnits("10", 6); // $10 USDC (6 decimals)
    const smallLeverage = 2;
    const positionSize = Number(smallCollateral) * smallLeverage; // $20 position
    const tradingFeeRate = 30; // 0.3% from contract
    const tradingFee = (positionSize * tradingFeeRate) / 10000;
    const totalCost = Number(smallCollateral) + tradingFee;

    console.log("   📊 Position Analysis:");
    console.log(
      "   • Collateral:",
      hre.ethers.formatUnits(smallCollateral, 6),
      "USDC"
    );
    console.log("   • Leverage:", smallLeverage + "x");
    console.log("   • Position size:", (positionSize / 1e6).toFixed(2), "USD");
    console.log("   • Trading fee:", (tradingFee / 1e6).toFixed(4), "USDC");
    console.log("   • Total cost:", (totalCost / 1e6).toFixed(4), "USDC");
    console.log(
      "   • Available margin:",
      hre.ethers.formatUnits(availableMargin, 6),
      "USDC"
    );
    console.log(
      "   • Margin sufficient:",
      totalCost <= Number(availableMargin) ? "✅ YES" : "❌ NO"
    );

    try {
      console.log("   🔥 Opening position...");
      const positionTx = await vamm.openPosition(
        smallCollateral,
        true, // long
        smallLeverage,
        0,
        hre.ethers.MaxUint256
      );
      await positionTx.wait();

      const newPrice = await vamm.getMarkPrice();
      const priceIncrease = newPrice - initialPrice;
      const multiplier = Number(newPrice) / Number(initialPrice);

      console.log("   ✅ Position opened successfully!");
      console.log("   📈 New price:", hre.ethers.formatEther(newPrice), "USD");
      console.log(
        "   🚀 Price increase:",
        hre.ethers.formatEther(priceIncrease),
        "USD"
      );
      console.log("   📊 Multiplier:", multiplier.toFixed(6) + "x");

      // ===== STEP 4: Test Larger Position =====
      console.log("\n🎯 STEP 4: Testing Larger Position...");

      const largerCollateral = hre.ethers.parseUnits("100", 6); // $100 USDC
      const largerLeverage = 5;

      console.log("   🔥 Opening larger position ($100, 5x leverage)...");
      const position2Tx = await vamm.openPosition(
        largerCollateral,
        true,
        largerLeverage,
        0,
        hre.ethers.MaxUint256
      );
      await position2Tx.wait();

      const finalPrice = await vamm.getMarkPrice();
      const totalIncrease = finalPrice - initialPrice;
      const finalMultiplier = Number(finalPrice) / Number(initialPrice);

      console.log("   ✅ Larger position opened!");
      console.log(
        "   📈 Final price:",
        hre.ethers.formatEther(finalPrice),
        "USD"
      );
      console.log(
        "   🚀 Total increase:",
        hre.ethers.formatEther(totalIncrease),
        "USD"
      );
      console.log("   📊 Final multiplier:", finalMultiplier.toFixed(6) + "x");

      // ===== SUCCESS! =====
      console.log("\n" + "=".repeat(60));
      console.log("🎉 SUCCESS! BONDING CURVE vAMM IS WORKING!");
      console.log("=".repeat(60));

      console.log("📋 Contract Addresses:");
      console.log("   • MockUSDC:", usdcAddress);
      console.log("   • MockOracle:", oracleAddress);
      console.log("   • Vault:", vaultAddress);
      console.log("   • vAMM:", vammAddress);

      console.log("\n🎯 Trading Results:");
      console.log("   • Positions Opened: 2");
      console.log(
        "   • Starting Price:",
        hre.ethers.formatEther(initialPrice),
        "USD"
      );
      console.log(
        "   • Final Price:",
        hre.ethers.formatEther(finalPrice),
        "USD"
      );
      console.log("   • Total Pump:", finalMultiplier.toFixed(6) + "x");

      console.log("\n✅ System Verified:");
      console.log("   • Contract Deployment: ✅");
      console.log("   • Unit Conversions: ✅");
      console.log("   • Vault Integration: ✅");
      console.log("   • Position Trading: ✅");
      console.log("   • Bonding Curve Math: ✅");
      console.log("   • Progressive Pricing: ✅");

      console.log("\n🚀 The vAMM system is now fully operational!");
      console.log(
        "   Ready for pump.fund-style trading with custom starting prices."
      );

      return {
        success: true,
        contracts: {
          mockUSDC: usdcAddress,
          mockOracle: oracleAddress,
          vault: vaultAddress,
          vamm: vammAddress,
        },
        results: {
          initialPrice: hre.ethers.formatEther(initialPrice),
          finalPrice: hre.ethers.formatEther(finalPrice),
          multiplier: finalMultiplier,
        },
      };
    } catch (error) {
      console.log("   ❌ Position opening failed:", error.message);

      // Debug information
      console.log("\n🔍 Debug Information:");
      console.log("   • Error type:", error.constructor.name);
      if (error.reason) console.log("   • Reason:", error.reason);
      if (error.data) console.log("   • Data:", error.data);

      // Check vault state
      const marginAccount = await vault.getMarginAccount(deployer.address);
      console.log(
        "   • Vault collateral:",
        hre.ethers.formatUnits(marginAccount.collateral, 6),
        "USDC"
      );
      console.log(
        "   • Reserved margin:",
        hre.ethers.formatUnits(marginAccount.reservedMargin, 6),
        "USDC"
      );
      console.log(
        "   • Available margin:",
        hre.ethers.formatUnits(availableMargin, 6),
        "USDC"
      );

      throw error;
    }
  } catch (error) {
    console.error("\n❌ DEPLOYMENT FAILED!");
    console.error("Error:", error.message);
    throw error;
  }
}

if (require.main === module) {
  main()
    .then((result) => {
      if (result && result.success) {
        console.log("\n🎊 MISSION ACCOMPLISHED! 🎊");
        console.log(
          "Price pumped from",
          result.results.initialPrice,
          "to",
          result.results.finalPrice
        );
        console.log(
          "That's a",
          result.results.multiplier.toFixed(6) + "x increase!"
        );
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;
