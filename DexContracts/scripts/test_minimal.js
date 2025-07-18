const hre = require("hardhat");

async function main() {
  console.log("🔬 Minimal vAMM Test - Isolating the Issue");
  console.log("=".repeat(50));

  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Testing with account:", deployer.address);

  try {
    // Deploy only the problematic contract to test PRBMath
    console.log("\n🧪 Testing PRBMath functionality...");
    const VAMM = await hre.ethers.getContractFactory("vAMM");

    // Create mock addresses for testing
    const mockVault = deployer.address; // Use deployer as mock
    const mockOracle = deployer.address; // Use deployer as mock
    const startingPrice = hre.ethers.parseEther("1");

    console.log(
      "   📈 Deploying vAMM with starting price:",
      hre.ethers.formatEther(startingPrice),
      "USD"
    );

    const vamm = await VAMM.deploy(mockVault, mockOracle, startingPrice);
    await vamm.waitForDeployment();
    const vammAddress = await vamm.getAddress();

    console.log("   ✅ vAMM deployed to:", vammAddress);

    // Test basic getters that might use PRBMath
    console.log("\n🔍 Testing basic functions...");

    try {
      const startingPriceFetched = await vamm.startingPrice();
      console.log(
        "   ✅ Starting price:",
        hre.ethers.formatEther(startingPriceFetched),
        "USD"
      );
    } catch (error) {
      console.log("   ❌ Starting price failed:", error.message);
    }

    try {
      const totalSupply = await vamm.getTotalSupply();
      console.log("   ✅ Total supply:", totalSupply.toString());
    } catch (error) {
      console.log("   ❌ Total supply failed:", error.message);
    }

    try {
      const markPrice = await vamm.getMarkPrice();
      console.log(
        "   ✅ Mark price:",
        hre.ethers.formatEther(markPrice),
        "USD"
      );
    } catch (error) {
      console.log("   ❌ Mark price failed:", error.message);
      console.log("   📋 This is likely the source of our issue!");
    }

    // If mark price works, test with some supply
    try {
      console.log("\n🧮 Testing PRBMath with manual values...");

      // Let's see if we can call getMarkPrice with some totalLongSize
      // We'll need to check if there's a way to set it manually for testing

      const pumpExponent = await vamm.pumpExponent();
      console.log("   📊 Pump exponent:", pumpExponent.toString());

      const bondingCurveSteepness = await vamm.BONDING_CURVE_STEEPNESS();
      console.log(
        "   📊 Bonding curve steepness:",
        bondingCurveSteepness.toString()
      );
    } catch (error) {
      console.log("   ❌ PRBMath constants failed:", error.message);
    }

    console.log("\n✅ Basic deployment successful!");
    console.log("🎯 The issue likely occurs when:");
    console.log(
      "   • Opening positions (which calls getMarkPrice with non-zero supply)"
    );
    console.log("   • PRBMath calculations overflow or underflow");
    console.log("   • Power calculations with specific values");

    return { success: true, vammAddress };
  } catch (error) {
    console.error("\n❌ MINIMAL TEST FAILED!");
    console.error("Error:", error.message);

    if (error.reason) {
      console.error("Reason:", error.reason);
    }

    if (error.data) {
      console.error("Error data:", error.data);
    }

    // Specific checks for common issues
    if (error.message.includes("invalid opcode")) {
      console.error("\n🔍 Analysis: Invalid opcode suggests:");
      console.error("   • PRBMath library compilation issue");
      console.error("   • Solidity version mismatch");
      console.error("   • Missing library dependencies");
    }

    if (error.message.includes("execution reverted")) {
      console.error("\n🔍 Analysis: Execution reverted suggests:");
      console.error("   • Mathematical overflow in PRBMath");
      console.error("   • Division by zero");
      console.error("   • Assertion failure in library");
    }

    throw error;
  }
}

if (require.main === module) {
  main()
    .then((result) => {
      if (result && result.success) {
        console.log("\n🎊 Minimal test passed! Issue is in trading logic.");
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;
