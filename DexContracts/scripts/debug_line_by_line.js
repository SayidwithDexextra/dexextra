const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🔍 Line-by-Line Debug of openPosition");

  try {
    // Quick setup
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy(1000000);
    await mockUSDC.waitForDeployment();

    const MockPriceOracle = await hre.ethers.getContractFactory(
      "MockPriceOracle"
    );
    const mockPriceOracle = await MockPriceOracle.deploy(
      hre.ethers.parseEther("2000")
    );
    await mockPriceOracle.waitForDeployment();

    const Vault = await hre.ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(await mockUSDC.getAddress());
    await vault.waitForDeployment();

    const VAMM = await hre.ethers.getContractFactory("vAMM");
    const vamm = await VAMM.deploy(
      await vault.getAddress(),
      await mockPriceOracle.getAddress(),
      hre.ethers.parseEther("1")
    );
    await vamm.waitForDeployment();

    await vault.setVamm(await vamm.getAddress());

    // Minimal setup
    const mintTx = await mockUSDC.mint(
      deployer.address,
      hre.ethers.parseUnits("1000", 6)
    );
    await mintTx.wait();
    const approveTx = await mockUSDC.approve(
      await vault.getAddress(),
      hre.ethers.parseUnits("1000", 6)
    );
    await approveTx.wait();
    const depositTx = await vault.depositCollateral(
      deployer.address,
      hre.ethers.parseUnits("100", 6)
    );
    await depositTx.wait();

    console.log("Setup complete");

    // Test individual function calls that openPosition makes
    console.log("\n🔍 Testing each openPosition step individually...");

    const collateralAmount = hre.ethers.parseEther("1"); // $1
    const leverage = 2;
    const isLong = true;
    const minPrice = 0;
    const maxPrice = hre.ethers.MaxUint256;

    console.log("Parameters:");
    console.log("- Collateral:", hre.ethers.formatEther(collateralAmount));
    console.log("- Leverage:", leverage);

    // Step 1: Check initial validations
    console.log("\n📋 Step 1: Input validation");
    console.log("- collateralAmount > 0:", collateralAmount > 0);
    console.log("- leverage in range:", leverage >= 1 && leverage <= 100);

    // Step 2: Check if contract is paused
    console.log("\n📋 Step 2: Contract state");
    const isPaused = await vamm.paused();
    console.log("- Contract paused:", isPaused);

    // Step 3: updateFunding()
    console.log("\n📋 Step 3: Testing updateFunding()");
    try {
      await vamm.updateFunding.staticCall();
      console.log("✅ updateFunding() works");
    } catch (e) {
      console.log("❌ updateFunding() failed:", e.message);
      return;
    }

    // Step 4: Calculate position size
    console.log("\n📋 Step 4: Position size calculation");
    const positionSize = collateralAmount * BigInt(leverage);
    console.log("- Position size:", hre.ethers.formatEther(positionSize));

    // Step 5: Test getMarkPrice()
    console.log("\n📋 Step 5: Testing getMarkPrice()");
    try {
      const currentPrice = await vamm.getMarkPrice();
      console.log("✅ Current price:", hre.ethers.formatEther(currentPrice));

      // Check slippage constraints
      console.log("- Price >= minPrice:", currentPrice >= minPrice);
      console.log("- Price <= maxPrice:", currentPrice <= maxPrice);
    } catch (e) {
      console.log("❌ getMarkPrice() failed:", e.message);
      return;
    }

    // Step 6: Trading fee calculation
    console.log("\n📋 Step 6: Fee calculation");
    const tradingFeeRate = await vamm.tradingFeeRate();
    const basisPoints = await vamm.BASIS_POINTS();
    const tradingFee = (positionSize * tradingFeeRate) / basisPoints;
    const totalCost = collateralAmount + tradingFee;

    console.log("- Trading fee rate:", tradingFeeRate.toString());
    console.log("- Trading fee:", hre.ethers.formatEther(tradingFee));
    console.log(
      "- Total cost (18-decimal):",
      hre.ethers.formatEther(totalCost)
    );

    // Step 7: Unit conversion
    console.log("\n📋 Step 7: Unit conversion");
    const totalCostUSDC = totalCost / BigInt(1e12);
    console.log(
      "- Total cost (6-decimal):",
      hre.ethers.formatUnits(totalCostUSDC, 6)
    );

    // Step 8: Test vault.reserveMargin() in isolation
    console.log("\n📋 Step 8: Testing vault.reserveMargin()");
    try {
      await vault.reserveMargin.staticCall(deployer.address, totalCostUSDC);
      console.log("✅ reserveMargin() would work");
    } catch (e) {
      console.log("❌ reserveMargin() would fail:", e.message);

      const availableMargin = await vault.getAvailableMargin(deployer.address);
      console.log(
        "- Available margin:",
        hre.ethers.formatUnits(availableMargin, 6)
      );
      console.log(
        "- Required margin:",
        hre.ethers.formatUnits(totalCostUSDC, 6)
      );
      return;
    }

    // Step 9: Test position tracking updates
    console.log("\n📋 Step 9: Position tracking simulation");
    const currentTotalLongSize = await vamm.totalLongSize();
    console.log("- Current total long size:", currentTotalLongSize.toString());
    console.log(
      "- Would become:",
      (currentTotalLongSize + positionSize).toString()
    );

    // Step 10: Test _updateLegacyReserves() indirectly by testing getMarkPrice after simulated update
    console.log(
      "\n📋 Step 10: Testing price calculation with simulated position"
    );

    // We can't actually modify state, but we can calculate what the new price would be
    const simulatedTotalSupply = positionSize; // Since we start from 0
    console.log(
      "- Simulated total supply:",
      hre.ethers.formatEther(simulatedTotalSupply)
    );

    // Test the bonding curve math that would happen
    const PRICE_PRECISION = await vamm.PRICE_PRECISION();
    const BONDING_CURVE_STEEPNESS = await vamm.BONDING_CURVE_STEEPNESS();
    const startingPrice = await vamm.startingPrice();
    const pumpExponent = await vamm.pumpExponent();

    console.log("- Price precision:", PRICE_PRECISION.toString());
    console.log(
      "- Bonding curve steepness:",
      BONDING_CURVE_STEEPNESS.toString()
    );
    console.log("- Starting price:", hre.ethers.formatEther(startingPrice));
    console.log("- Pump exponent:", hre.ethers.formatEther(pumpExponent));

    // Step 11: Try the actual openPosition call with detailed error catching
    console.log("\n📋 Step 11: Attempting actual openPosition...");
    try {
      const tx = await vamm.openPosition(
        collateralAmount,
        isLong,
        leverage,
        minPrice,
        maxPrice,
        { gasLimit: 500000 } // Set explicit gas limit
      );
      await tx.wait();
      console.log("🎉 SUCCESS! Position opened");

      const newPrice = await vamm.getMarkPrice();
      console.log("New price:", hre.ethers.formatEther(newPrice));
    } catch (error) {
      console.log("❌ openPosition failed:", error.message);

      if (error.data) {
        console.log("Error data:", error.data);

        // Decode the error if possible
        if (
          error.data ===
          "0x4e487b710000000000000000000000000000000000000000000000000000000000000011"
        ) {
          console.log("This is arithmetic underflow/overflow (Panic 0x11)");
        }
      }

      // Try to narrow down which exact line is failing by testing with even smaller amounts
      console.log("\n🔬 Testing with ultra-small amounts...");
      try {
        await vamm.openPosition.staticCall(
          hre.ethers.parseEther("0.001"), // $0.001
          isLong,
          leverage,
          minPrice,
          maxPrice
        );
        console.log("✅ $0.001 position would work");
      } catch (e) {
        console.log("❌ Even $0.001 fails:", e.message);
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
