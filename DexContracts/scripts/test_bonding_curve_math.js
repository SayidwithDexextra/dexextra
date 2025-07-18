const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🧮 Testing Bonding Curve Math");

  try {
    console.log("\n📦 Deploying minimal setup...");

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
      hre.ethers.parseEther("1") // $1 starting price
    );
    await vamm.waitForDeployment();

    console.log("Contracts deployed");

    // Test bonding curve parameters
    console.log("\n🔍 Testing bonding curve parameters...");
    const startingPrice = await vamm.startingPrice();
    const pumpExponent = await vamm.pumpExponent();
    const totalLongSize = await vamm.totalLongSize();

    console.log("Starting price:", hre.ethers.formatEther(startingPrice));
    console.log("Pump exponent:", hre.ethers.formatEther(pumpExponent));
    console.log("Total long size:", totalLongSize.toString());

    // Test getTotalSupply
    console.log("\n🔍 Testing getTotalSupply...");
    try {
      const totalSupply = await vamm.getTotalSupply();
      console.log("Total supply:", totalSupply.toString());
    } catch (e) {
      console.log("getTotalSupply failed:", e.message);
    }

    // Test getMarkPrice with zero supply
    console.log("\n🔍 Testing getMarkPrice with zero supply...");
    try {
      const markPrice = await vamm.getMarkPrice();
      console.log(
        "Mark price (zero supply):",
        hre.ethers.formatEther(markPrice)
      );
    } catch (e) {
      console.log("getMarkPrice failed:", e.message);
      console.log("Error data:", e.data);
      return; // Exit early if basic price calculation fails
    }

    // Test static calls for position opening without vault interactions
    console.log("\n🔍 Testing position opening logic isolation...");

    // Test each calculation step manually
    console.log("\n📊 Manual calculation verification:");
    const testCollateral = hre.ethers.parseEther("1"); // $1
    const testLeverage = 2;
    const testPositionSize = testCollateral * BigInt(testLeverage);

    console.log("Test collateral:", hre.ethers.formatEther(testCollateral));
    console.log(
      "Test position size:",
      hre.ethers.formatEther(testPositionSize)
    );

    // Simulate the position size update
    console.log("\n🔍 Testing bonding curve with simulated position...");

    // Check what happens if we had a position
    // We can't modify state directly, but we can calculate what the new price would be
    // by examining the bonding curve formula

    const PRICE_PRECISION = await vamm.PRICE_PRECISION();
    const BONDING_CURVE_STEEPNESS = await vamm.BONDING_CURVE_STEEPNESS();

    console.log("Price precision:", PRICE_PRECISION.toString());
    console.log("Bonding curve steepness:", BONDING_CURVE_STEEPNESS.toString());

    // Simulate what the total supply would be after opening a position
    const simulatedTotalSupply = testPositionSize;
    console.log(
      "Simulated total supply:",
      hre.ethers.formatEther(simulatedTotalSupply)
    );

    // Test if the math would work for this total supply
    console.log("\n🧮 Testing bonding curve math manually:");

    // supplyRatio = totalSupply * PRICE_PRECISION / BONDING_CURVE_STEEPNESS
    const supplyRatio =
      (simulatedTotalSupply * PRICE_PRECISION) / BONDING_CURVE_STEEPNESS;
    console.log("Supply ratio:", supplyRatio.toString());

    // base = PRICE_PRECISION + supplyRatio
    const base = PRICE_PRECISION + supplyRatio;
    console.log("Base:", base.toString());

    // This is where the overflow might happen - when we do base^exponent
    console.log("Pump exponent value:", pumpExponent.toString());

    // Check if the base value is reasonable for exponentiation
    const baseInEth = hre.ethers.formatEther(base);
    const exponentInEth = hre.ethers.formatEther(pumpExponent);
    console.log("Base (formatted):", baseInEth);
    console.log("Exponent (formatted):", exponentInEth);

    // If base > 1 and exponent > 1, this could cause massive overflow
    if (Number(baseInEth) > 2 && Number(exponentInEth) > 1.1) {
      console.log("⚠️  POTENTIAL OVERFLOW: Base too large for exponentiation!");
      console.log(
        "   Base^Exponent would be approximately:",
        Number(baseInEth) ** Number(exponentInEth)
      );

      // The bonding curve steepness might be too low, causing the base to grow too quickly
      console.log(
        "🔧 Suggested fix: Increase BONDING_CURVE_STEEPNESS to reduce supply ratio"
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
