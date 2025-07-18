const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🔢 Testing Simple Math (No PRBMath)");

  try {
    console.log("\n📦 Deploying TestSimpleMath...");
    const TestSimpleMath = await hre.ethers.getContractFactory("TestSimpleMath");
    const testMath = await TestSimpleMath.deploy();
    await testMath.waitForDeployment();
    console.log("TestSimpleMath deployed:", await testMath.getAddress());

    // Test 1: Basic arithmetic
    console.log("\n🧪 Test 1: Basic arithmetic");
    try {
      const result = await testMath.testBasicMath(hre.ethers.parseEther("3"), hre.ethers.parseEther("1.5"));
      console.log("✅ Basic math works:");
      console.log("   3 + 1.5 =", hre.ethers.formatEther(result[0]));
      console.log("   3 * 1.5 =", hre.ethers.formatEther(result[1]));
    } catch (e) {
      console.log("❌ Basic math failed:", e.message);
    }

    // Test 2: Linear bonding curve
    console.log("\n🧪 Test 2: Linear bonding curve");
    try {
      const price = await testMath.testSpecificValues();
      console.log("✅ Linear bonding curve works:");
      console.log("   $2 supply → price:", hre.ethers.formatEther(price));
    } catch (e) {
      console.log("❌ Linear bonding curve failed:", e.message);
    }

    // Test 3: Step by step calculation
    console.log("\n🧪 Test 3: Step-by-step calculation");
    try {
      const steps = await testMath.testStepByStep(hre.ethers.parseEther("2"));
      console.log("✅ Step-by-step calculation works:");
      console.log("   Supply ratio:", hre.ethers.formatEther(steps[0]));
      console.log("   Multiplier:", hre.ethers.formatEther(steps[1]));
      console.log("   Final price:", hre.ethers.formatEther(steps[2]));
    } catch (e) {
      console.log("❌ Step-by-step calculation failed:", e.message);
    }

    // Test 4: Test with various supply values
    console.log("\n🧪 Test 4: Various supply values");
    const testValues = ["0.001", "0.1", "1", "2", "10", "100"];
    
    for (const value of testValues) {
      try {
        const supply = hre.ethers.parseEther(value);
        const price = await testMath.testLinearBondingCurve(supply);
        console.log(`✅ $${value} supply → $${hre.ethers.formatEther(price)} price`);
      } catch (e) {
        console.log(`❌ $${value} supply failed:`, e.message);
      }
    }

    console.log("\n🎯 Conclusion:");
    console.log("If simple math works but PRBMath fails, the issue is in the PRBMath library!");

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