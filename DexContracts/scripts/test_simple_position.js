const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🧪 Simple Position Test");
  console.log("Account:", deployer.address);

  try {
    // Deploy minimal contracts
    console.log("\n📦 Deploying...");

    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy(1000000);
    await mockUSDC.waitForDeployment();
    console.log("MockUSDC deployed");

    const MockPriceOracle = await hre.ethers.getContractFactory(
      "MockPriceOracle"
    );
    const mockPriceOracle = await MockPriceOracle.deploy(
      hre.ethers.parseEther("2000")
    );
    await mockPriceOracle.waitForDeployment();
    console.log("Oracle deployed");

    const Vault = await hre.ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(await mockUSDC.getAddress());
    await vault.waitForDeployment();
    console.log("Vault deployed");

    const VAMM = await hre.ethers.getContractFactory("vAMM");
    const vamm = await VAMM.deploy(
      await vault.getAddress(),
      await mockPriceOracle.getAddress(),
      hre.ethers.parseEther("1") // $1 starting price
    );
    await vamm.waitForDeployment();
    console.log("vAMM deployed");

    // Configure
    await vault.setVamm(await vamm.getAddress());
    console.log("Vault configured");

    // Setup tokens
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
    ); // $100 USDC
    await depositTx.wait();
    console.log("Collateral deposited");

    // Test tiny position first
    console.log("\n🎯 Testing tiny position...");
    const initialPrice = await vamm.getMarkPrice();
    console.log("Initial price:", hre.ethers.formatEther(initialPrice));

    // Test the arithmetic manually first
    console.log("\n🔍 Manual arithmetic test:");
    const testCollateral = hre.ethers.parseUnits("1", 18); // $1 in 18 decimals
    const testLeverage = 2;
    const testPositionSize = testCollateral * BigInt(testLeverage);
    const testTradingFeeRate = BigInt(30); // 0.3%
    const testBasisPoints = BigInt(10000);

    console.log("Test collateral (18-decimal):", testCollateral.toString());
    console.log("Test position size:", testPositionSize.toString());

    const testTradingFee =
      (testPositionSize * testTradingFeeRate) / testBasisPoints;
    const testTotalCost = testCollateral + testTradingFee;
    const testTotalCostUSDC = testTotalCost / BigInt(1e12);

    console.log("Test trading fee:", testTradingFee.toString());
    console.log("Test total cost (18-decimal):", testTotalCost.toString());
    console.log("Test total cost (6-decimal):", testTotalCostUSDC.toString());

    // Check available margin
    const availableMargin = await vault.getAvailableMargin(deployer.address);
    console.log(
      "Available margin:",
      hre.ethers.formatUnits(availableMargin, 6)
    );

    // Try the smallest possible position
    try {
      console.log("\n🔥 Opening $1 position with 2x leverage...");
      const tx = await vamm.openPosition(
        hre.ethers.parseUnits("1", 18), // $1 collateral in 18 decimals
        true, // long
        2, // 2x leverage
        0, // no min price
        hre.ethers.MaxUint256 // no max price
      );
      await tx.wait();

      const newPrice = await vamm.getMarkPrice();
      console.log("✅ SUCCESS! Position opened");
      console.log("New price:", hre.ethers.formatEther(newPrice));
      console.log(
        "Price change:",
        hre.ethers.formatEther(newPrice - initialPrice)
      );
    } catch (error) {
      console.log("❌ Failed:", error.message);
      console.log("Error data:", error.data);

      // Let's try even smaller
      try {
        console.log("\n🔥 Trying $0.1 position...");
        const tx = await vamm.openPosition(
          hre.ethers.parseUnits("0.1", 18), // $0.1 collateral
          true,
          2,
          0,
          hre.ethers.MaxUint256
        );
        await tx.wait();
        console.log("✅ SUCCESS with $0.1!");
      } catch (error2) {
        console.log("❌ Even $0.1 failed:", error2.message);

        // Test static calls to isolate the issue
        console.log("\n🔍 Testing static calls...");
        try {
          const staticPrice = await vamm.getMarkPrice.staticCall();
          console.log(
            "Static price call works:",
            hre.ethers.formatEther(staticPrice)
          );
        } catch (e) {
          console.log("Static price call failed:", e.message);
        }

        try {
          await vamm.openPosition.staticCall(
            hre.ethers.parseUnits("0.1", 18),
            true,
            2,
            0,
            hre.ethers.MaxUint256
          );
          console.log("Static openPosition call works");
        } catch (e) {
          console.log("Static openPosition failed:", e.message);
        }
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
