const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🧮 Testing Isolated Bonding Curve Contract");

  try {
    // Deploy the test contract
    console.log("\n📦 Deploying TestBondingCurve...");
    const TestBondingCurve = await hre.ethers.getContractFactory(
      "TestBondingCurve"
    );
    const testCurve = await TestBondingCurve.deploy();
    await testCurve.waitForDeployment();
    console.log("TestBondingCurve deployed:", await testCurve.getAddress());

    // Get parameters
    console.log("\n📊 Contract parameters:");
    const params = await testCurve.getParameters();
    console.log("Starting price:", hre.ethers.formatEther(params[0]));
    console.log("Pump exponent:", hre.ethers.formatEther(params[1]));
    console.log("Steepness:", params[2].toString());
    console.log("Precision:", params[3].toString());

    // Test 1: Zero supply
    console.log("\n🧪 Test 1: Zero supply");
    try {
      const price0 = await testCurve.testBondingCurvePrice(0);
      console.log("✅ Zero supply price:", hre.ethers.formatEther(price0));
    } catch (e) {
      console.log("❌ Zero supply failed:", e.message);
    }

    // Test 2: Small supply ($0.001)
    console.log("\n🧪 Test 2: Small supply ($0.001)");
    try {
      const price1 = await testCurve.testBondingCurvePrice(
        hre.ethers.parseEther("0.001")
      );
      console.log("✅ $0.001 supply price:", hre.ethers.formatEther(price1));
    } catch (e) {
      console.log("❌ $0.001 supply failed:", e.message);
    }

    // Test 3: $1 supply
    console.log("\n🧪 Test 3: $1 supply");
    try {
      const price2 = await testCurve.testBondingCurvePrice(
        hre.ethers.parseEther("1")
      );
      console.log("✅ $1 supply price:", hre.ethers.formatEther(price2));
    } catch (e) {
      console.log("❌ $1 supply failed:", e.message);
      console.log("Error data:", e.data);
    }

    // Test 4: $2 supply (our problematic case)
    console.log("\n🧪 Test 4: $2 supply (problematic case)");
    try {
      const tx = await testCurve.testProblematicValues();
      const receipt = await tx.wait();

      console.log("✅ $2 supply succeeded!");

      // Parse events to see where it might have failed
      for (const log of receipt.logs) {
        try {
          const parsed = testCurve.interface.parseLog(log);
          if (parsed.name === "PriceCalculated") {
            const [totalSupply, price, step] = parsed.args;
            console.log(
              `   ${step}: totalSupply=${totalSupply.toString()}, price=${price.toString()}`
            );
          }
        } catch (e) {
          // Not our event
        }
      }

      const finalPrice = await testCurve.lastCalculatedPrice();
      console.log(
        "Final calculated price:",
        hre.ethers.formatEther(finalPrice)
      );
    } catch (e) {
      console.log("❌ $2 supply failed:", e.message);
      console.log("Error data:", e.data);

      if (
        e.data ===
        "0x4e487b710000000000000000000000000000000000000000000000000000000000000011"
      ) {
        console.log("This is the same arithmetic overflow we've been seeing!");
      }
    }

    // Test 5: Individual math operations with specific values
    console.log("\n🧪 Test 5: Individual math operations");
    try {
      // Test the exact values that would be computed
      const precision = BigInt("1000000000000000000"); // 1e18
      const steepness = BigInt("1000000000000000000"); // 1e18
      const totalSupply = BigInt("2000000000000000000"); // 2e18

      // supplyRatio = totalSupply * precision / steepness = 2e18 * 1e18 / 1e18 = 2e18
      const expectedSupplyRatio = (totalSupply * precision) / steepness;
      console.log("Expected supply ratio:", expectedSupplyRatio.toString());

      // base = precision + supplyRatio = 1e18 + 2e18 = 3e18
      const expectedBase = precision + expectedSupplyRatio;
      console.log("Expected base:", expectedBase.toString());

      // Test individual operations
      const testA = hre.ethers.parseEther("3"); // base
      const testB = hre.ethers.parseEther("1.2"); // exponent

      const mathResult = await testCurve.testMathOperations(testA, testB);
      console.log("✅ Math operations succeeded:");
      console.log("   3 + 1.2 =", hre.ethers.formatEther(mathResult[0]));
      console.log("   3 * 1.2 =", hre.ethers.formatEther(mathResult[1]));
      console.log("   3 ^ 1.2 =", hre.ethers.formatEther(mathResult[2]));
    } catch (e) {
      console.log("❌ Individual math operations failed:", e.message);
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
