const hre = require("hardhat");

async function main() {
  console.log("🔍 Debug Unit Conversion Issue");
  console.log("========================================");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Account:", deployer.address);

  try {
    // Deploy minimal setup
    console.log("\n📦 Deploying contracts...");

    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy(1000000);
    await mockUSDC.waitForDeployment();

    const MockPriceOracle = await hre.ethers.getContractFactory(
      "MockPriceOracle"
    );
    const mockOracle = await MockPriceOracle.deploy(
      hre.ethers.parseEther("2000")
    );
    await mockOracle.waitForDeployment();

    const Vault = await hre.ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(await mockUSDC.getAddress());
    await vault.waitForDeployment();

    const VAMM = await hre.ethers.getContractFactory("vAMM");
    const vamm = await VAMM.deploy(
      await vault.getAddress(),
      await mockOracle.getAddress(),
      hre.ethers.parseEther("1") // $1 starting price
    );
    await vamm.waitForDeployment();

    await vault.setVamm(await vamm.getAddress());

    // Setup tokens properly
    console.log("\n💰 Setting up tokens...");
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

    console.log("✅ Setup complete");

    // Check current margin
    const availableMargin = await vault.getAvailableMargin(deployer.address);
    console.log(
      "Available margin:",
      hre.ethers.formatUnits(availableMargin, 6),
      "USDC"
    );

    // Debug the unit conversion without opening positions yet
    console.log("\n🔍 Testing unit conversions...");

    const testCases = [
      {
        collateral: hre.ethers.parseUnits("50", 6),
        leverage: 3,
        label: "$50 USDC (6-decimal) with 3x leverage",
      },
      {
        collateral: hre.ethers.parseEther("50"),
        leverage: 3,
        label: "$50 (18-decimal) with 3x leverage",
      },
      {
        collateral: hre.ethers.parseUnits("1", 6),
        leverage: 2,
        label: "$1 USDC (6-decimal) with 2x leverage",
      },
      {
        collateral: hre.ethers.parseEther("1"),
        leverage: 2,
        label: "$1 (18-decimal) with 2x leverage",
      },
    ];

    for (const testCase of testCases) {
      console.log(`\n🧪 Testing: ${testCase.label}`);
      console.log(`   Input collateral: ${testCase.collateral.toString()}`);

      // Calculate what the vAMM will compute
      const positionSize = testCase.collateral * BigInt(testCase.leverage);
      const tradingFeeRate = BigInt(30); // 0.3%
      const basisPoints = BigInt(10000);
      const tradingFee = (positionSize * tradingFeeRate) / basisPoints;
      const totalCost = testCase.collateral + tradingFee;
      const totalCostUSDC = totalCost / BigInt(1e12); // The conversion in vAMM

      console.log(`   Position size: ${positionSize.toString()}`);
      console.log(`   Trading fee: ${tradingFee.toString()}`);
      console.log(`   Total cost (original): ${totalCost.toString()}`);
      console.log(`   Total cost (after /1e12): ${totalCostUSDC.toString()}`);

      if (totalCostUSDC === BigInt(0)) {
        console.log(
          `   ❌ PROBLEM: Unit conversion results in 0! This will fail with "invalid amount"`
        );
      } else {
        console.log(`   ✅ Unit conversion produces non-zero value`);
        console.log(
          `   💰 Required margin: ${hre.ethers.formatUnits(
            totalCostUSDC,
            6
          )} USDC`
        );

        if (totalCostUSDC > availableMargin) {
          console.log(
            `   ⚠️  WARNING: Required margin exceeds available margin`
          );
        }
      }
    }

    // Now let's test the problem by examining what happens in the deploy_success.js case
    console.log("\n🎯 Testing the failing case from deploy_success.js...");
    const failingCollateral = hre.ethers.parseUnits("50", 6); // $50 USDC
    const failingLeverage = 3;

    console.log("Failing case analysis:");
    console.log(
      "  Collateral amount:",
      failingCollateral.toString(),
      "(50 USDC in 6 decimals)"
    );
    console.log("  Leverage:", failingLeverage);

    const failingPositionSize = failingCollateral * BigInt(failingLeverage);
    const failingTradingFee =
      (failingPositionSize * BigInt(30)) / BigInt(10000);
    const failingTotalCost = failingCollateral + failingTradingFee;
    const failingTotalCostUSDC = failingTotalCost / BigInt(1e12);

    console.log("  Position size:", failingPositionSize.toString());
    console.log("  Trading fee:", failingTradingFee.toString());
    console.log("  Total cost:", failingTotalCost.toString());
    console.log("  Total cost USDC:", failingTotalCostUSDC.toString());

    if (failingTotalCostUSDC === BigInt(0)) {
      console.log(
        "  🎯 FOUND THE ISSUE: $50 USDC (6-decimal) becomes 0 after conversion!"
      );
      console.log("  📊 Analysis:");
      console.log("    - Input: 50,000,000 (50 USDC in 6 decimals)");
      console.log("    - Position size: 150,000,000 (150 USDC in 6 decimals)");
      console.log("    - Trading fee: 45,000 (0.045 USDC in 6 decimals)");
      console.log("    - Total cost: 50,045,000 (50.045 USDC in 6 decimals)");
      console.log(
        "    - After /1e12: 0 (because 50,045,000 < 1,000,000,000,000)"
      );
      console.log(
        "  💡 SOLUTION: The vAMM expects 18-decimal inputs, not 6-decimal!"
      );
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
