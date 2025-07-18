const hre = require("hardhat");

async function waitForTransaction(tx, description) {
  console.log(`   ⏳ ${description}... (Hash: ${tx.hash})`);
  const receipt = await tx.wait();
  console.log(`   ✅ ${description} confirmed (Block: ${receipt.blockNumber})`);
  return receipt;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🔍 Debugging Position Opening - Fixed Unit Conversions");
  console.log("=====================================================");
  console.log("👤 Account:", deployer.address);

  try {
    // ===== DEPLOY CONTRACTS =====
    console.log("\n📦 Deploying contracts...");

    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy(1000000); // 1M USDC initial supply
    await mockUSDC.waitForDeployment();
    const usdcAddress = await mockUSDC.getAddress();
    console.log("   ✅ MockUSDC:", usdcAddress);

    const MockPriceOracle = await hre.ethers.getContractFactory(
      "MockPriceOracle"
    );
    const mockPriceOracle = await MockPriceOracle.deploy(
      hre.ethers.parseEther("2000")
    );
    await mockPriceOracle.waitForDeployment();
    const oracleAddress = await mockPriceOracle.getAddress();
    console.log("   ✅ MockOracle:", oracleAddress);

    const Vault = await hre.ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(usdcAddress);
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();
    console.log("   ✅ Vault:", vaultAddress);

    const VAMM = await hre.ethers.getContractFactory("vAMM");
    const vamm = await VAMM.deploy(
      vaultAddress,
      oracleAddress,
      hre.ethers.parseEther("1")
    );
    await vamm.waitForDeployment();
    const vammAddress = await vamm.getAddress();
    console.log("   ✅ vAMM:", vammAddress);

    // Configure vault
    const setVammTx = await vault.setVamm(vammAddress);
    await waitForTransaction(setVammTx, "Vault configuration");

    // ===== SETUP TOKENS =====
    console.log("\n💰 Setting up tokens...");

    const mintTx = await mockUSDC.mint(
      deployer.address,
      hre.ethers.parseUnits("10000", 6)
    );
    await waitForTransaction(mintTx, "USDC minting");

    const approveTx = await mockUSDC.approve(
      vaultAddress,
      hre.ethers.parseUnits("10000", 6)
    );
    await waitForTransaction(approveTx, "USDC approval");

    const depositTx = await vault.depositCollateral(
      deployer.address,
      hre.ethers.parseUnits("5000", 6)
    );
    await waitForTransaction(depositTx, "Collateral deposit");

    // ===== UNIT CONVERSION DEBUGGING =====
    console.log("\n🔍 Debugging unit conversions...");

    const initialPrice = await vamm.getMarkPrice();
    console.log(
      "   💎 Initial price:",
      hre.ethers.formatEther(initialPrice),
      "USD"
    );

    // Test cases with proper unit handling
    const testCases = [
      { collateralUSDC: "10", leverage: 2, desc: "$10 USDC, 2x leverage" },
      { collateralUSDC: "50", leverage: 3, desc: "$50 USDC, 3x leverage" },
    ];

    for (const testCase of testCases) {
      console.log(`\n🎯 Testing ${testCase.desc}...`);

      try {
        // CRITICAL: Use USDC decimals (6) for collateral amount
        const collateralAmountUSDC = hre.ethers.parseUnits(
          testCase.collateralUSDC,
          6
        );
        const leverage = testCase.leverage;

        console.log("   📊 Input Analysis:");
        console.log(
          "   • Collateral (USDC 6-decimal):",
          hre.ethers.formatUnits(collateralAmountUSDC, 6)
        );
        console.log("   • Leverage:", leverage);

        // Simulate the vAMM calculations
        // Position size = collateral * leverage (in contract, this should be in proper units)
        const positionSizeInContract = collateralAmountUSDC * BigInt(leverage);
        console.log(
          "   • Position size (raw calc):",
          positionSizeInContract.toString()
        );

        // Check what the contract expects
        console.log("\n   🔍 Contract State Analysis:");

        const currentPrice = await vamm.getMarkPrice();
        const tradingFeeRate = await vamm.tradingFeeRate();
        const basisPoints = await vamm.BASIS_POINTS();

        console.log(
          "   • Current price (18-decimal):",
          hre.ethers.formatEther(currentPrice)
        );
        console.log(
          "   • Trading fee rate:",
          tradingFeeRate.toString(),
          "basis points"
        );
        console.log("   • BASIS_POINTS:", basisPoints.toString());

        // Calculate expected fees manually
        const expectedFee =
          (positionSizeInContract * tradingFeeRate) / basisPoints;
        const totalCostExpected = collateralAmountUSDC + expectedFee;

        console.log(
          "   • Expected trading fee:",
          hre.ethers.formatUnits(expectedFee, 6)
        );
        console.log(
          "   • Expected total cost:",
          hre.ethers.formatUnits(totalCostExpected, 6)
        );

        // Check margin availability
        const availableMargin = await vault.getAvailableMargin(
          deployer.address
        );
        console.log(
          "   • Available margin:",
          hre.ethers.formatUnits(availableMargin, 6)
        );

        if (totalCostExpected > availableMargin) {
          console.log("   ❌ Insufficient margin for this position");
          continue;
        }

        // === CRITICAL FIX ===
        // The issue is that the vAMM contract expects collateral in 18-decimal format
        // but we're passing USDC amounts in 6-decimal format
        // We need to convert USDC (6 decimal) to 18-decimal for the vAMM contract

        const collateralAmount18Decimal = hre.ethers.parseUnits(
          testCase.collateralUSDC,
          18
        );

        console.log("\n   🔧 Unit Conversion Fix:");
        console.log(
          "   • Collateral (6-decimal USDC):",
          hre.ethers.formatUnits(collateralAmountUSDC, 6)
        );
        console.log(
          "   • Collateral (18-decimal for vAMM):",
          hre.ethers.formatEther(collateralAmount18Decimal)
        );

        // Try opening position with 18-decimal collateral amount
        console.log("   🔥 Opening position with 18-decimal conversion...");

        const openPositionTx = await vamm.openPosition(
          collateralAmount18Decimal, // Use 18-decimal amount
          true, // long
          leverage,
          0, // no slippage protection for testing
          hre.ethers.MaxUint256
        );

        const receipt = await waitForTransaction(
          openPositionTx,
          "Position opening"
        );

        // Success! Check the results
        const newPrice = await vamm.getMarkPrice();
        const totalLongSize = await vamm.totalLongSize();

        console.log("   ✅ Position opened successfully!");
        console.log("   📈 New price:", hre.ethers.formatEther(newPrice));
        console.log("   📊 Total long size:", totalLongSize.toString());
        console.log(
          "   💰 Price change:",
          hre.ethers.formatEther(newPrice - initialPrice)
        );

        // Parse events
        const events = receipt.logs;
        for (const log of events) {
          try {
            const parsed = vamm.interface.parseLog(log);
            if (parsed.name === "PositionOpened") {
              console.log("   📋 PositionOpened event:");
              console.log(
                "     • Position ID:",
                parsed.args.positionId.toString()
              );
              console.log("     • Size:", parsed.args.size.toString());
              console.log(
                "     • Price:",
                hre.ethers.formatEther(parsed.args.price)
              );
              console.log("     • Fee:", parsed.args.fee.toString());
            }
          } catch (e) {
            // Not a vAMM event
          }
        }

        break; // Stop after first success
      } catch (error) {
        console.log("   ❌ Position opening failed:", error.message);

        if (error.reason) {
          console.log("   📋 Error reason:", error.reason);
        }

        // Continue with next test case
      }
    }
  } catch (error) {
    console.error("💥 Script failed:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
