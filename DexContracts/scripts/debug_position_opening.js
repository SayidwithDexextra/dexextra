const hre = require("hardhat");

async function waitForTransaction(tx, description) {
  console.log(`   ⏳ ${description}... (Hash: ${tx.hash})`);
  const receipt = await tx.wait();
  console.log(`   ✅ ${description} confirmed (Block: ${receipt.blockNumber})`);
  return receipt;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🔍 Debugging Position Opening Failure");
  console.log("========================================");
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

    // ===== DEBUG POSITION OPENING =====
    console.log("\n🔍 Debugging position opening...");

    // Check all initial states
    const initialPrice = await vamm.getMarkPrice();
    const totalLongSize = await vamm.totalLongSize();
    const totalShortSize = await vamm.totalShortSize();
    const marginAccount = await vault.getMarginAccount(deployer.address);
    const availableMargin = await vault.getAvailableMargin(deployer.address);

    console.log("   📊 Initial States:");
    console.log("   • Mark price:", hre.ethers.formatEther(initialPrice));
    console.log("   • Total long size:", totalLongSize.toString());
    console.log("   • Total short size:", totalShortSize.toString());
    console.log(
      "   • Collateral:",
      hre.ethers.formatUnits(marginAccount.collateral, 6)
    );
    console.log(
      "   • Available margin:",
      hre.ethers.formatUnits(availableMargin, 6)
    );
    console.log(
      "   • Reserved margin:",
      hre.ethers.formatUnits(marginAccount.reservedMargin, 6)
    );

    // Test different position sizes to find the limit
    const testCases = [
      { collateral: "10", leverage: 2, desc: "$10, 2x leverage" },
      { collateral: "50", leverage: 3, desc: "$50, 3x leverage" },
      { collateral: "100", leverage: 5, desc: "$100, 5x leverage" },
    ];

    for (const testCase of testCases) {
      console.log(`\n🎯 Testing ${testCase.desc}...`);

      try {
        const collateralAmount = hre.ethers.parseUnits(testCase.collateral, 6);
        const leverage = testCase.leverage;
        const positionSize = Number(testCase.collateral) * leverage;

        console.log(`   📊 Position size: $${positionSize}`);

        // Check if we have enough margin
        const currentAvailable = await vault.getAvailableMargin(
          deployer.address
        );
        const tradingFee = positionSize * 0.003; // 0.3% fee
        const totalRequired = Number(testCase.collateral) + tradingFee;

        console.log(`   📊 Required: $${totalRequired.toFixed(2)}`);
        console.log(
          `   📊 Available: $${hre.ethers.formatUnits(currentAvailable, 6)}`
        );

        if (
          Number(hre.ethers.formatUnits(currentAvailable, 6)) < totalRequired
        ) {
          console.log("   ❌ Insufficient margin - skipping");
          continue;
        }

        // Test individual contract calls
        console.log("   🔍 Testing contract state checks...");

        // Check if contract is paused
        const isPaused = await vamm.paused();
        console.log("   • Contract paused:", isPaused);

        // Check pricing parameters
        const startingPrice = await vamm.startingPrice();
        const pumpExponent = await vamm.pumpExponent();
        console.log(
          "   • Starting price:",
          hre.ethers.formatEther(startingPrice)
        );
        console.log(
          "   • Pump exponent:",
          hre.ethers.formatEther(pumpExponent)
        );

        // Test price calculation manually
        console.log("   🔍 Testing price calculation...");
        try {
          const testPrice = await vamm.getMarkPrice();
          console.log(
            "   • Mark price call successful:",
            hre.ethers.formatEther(testPrice)
          );
        } catch (e) {
          console.log("   ❌ Mark price calculation failed:", e.message);
          continue;
        }

        // Test margin reservation
        console.log("   🔍 Testing margin reservation...");
        try {
          // This should be the exact call that openPosition makes
          await vault.reserveMargin.staticCall(
            deployer.address,
            collateralAmount + hre.ethers.parseUnits(tradingFee.toFixed(6), 6)
          );
          console.log("   • Margin reservation test passed");
        } catch (e) {
          console.log("   ❌ Margin reservation would fail:", e.message);
          continue;
        }

        // Now try the actual position opening
        console.log("   🔥 Opening position...");

        const openPositionTx = await vamm.openPosition(
          collateralAmount,
          true, // long
          leverage,
          0, // no slippage protection for testing
          hre.ethers.MaxUint256
        );

        const receipt = await waitForTransaction(
          openPositionTx,
          "Position opening"
        );

        // Check events
        const events = receipt.logs;
        console.log(`   📋 ${events.length} events emitted`);

        for (const log of events) {
          try {
            const parsed = vamm.interface.parseLog(log);
            console.log(`   • Event: ${parsed.name}`);
          } catch (e) {
            // Not a vAMM event
          }
        }

        // Check new price
        const newPrice = await vamm.getMarkPrice();
        const priceChange = newPrice - initialPrice;
        console.log("   ✅ Position opened successfully!");
        console.log("   📈 New price:", hre.ethers.formatEther(newPrice));
        console.log("   📊 Price change:", hre.ethers.formatEther(priceChange));

        break; // Stop after first success
      } catch (error) {
        console.log("   ❌ Position opening failed:", error.message);

        // Try to get more specific error information
        if (error.data) {
          console.log("   📋 Error data:", error.data);
        }

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
