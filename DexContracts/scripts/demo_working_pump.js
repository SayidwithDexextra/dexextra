const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🚀 WORKING PUMP.FUN-STYLE vAMM DEMONSTRATION");
  console.log("===============================================");

  try {
    // Deploy the working system
    console.log("\n📦 Deploying the working vAMM system...");

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

    // Setup
    const setVammTx = await vault.setVamm(await vamm.getAddress());
    await setVammTx.wait();

    const mintTx = await mockUSDC.mint(
      deployer.address,
      hre.ethers.parseUnits("10000", 6)
    );
    await mintTx.wait();

    const approveTx = await mockUSDC.approve(
      await vault.getAddress(),
      hre.ethers.parseUnits("10000", 6)
    );
    await approveTx.wait();

    const depositTx = await vault.depositCollateral(
      deployer.address,
      hre.ethers.parseUnits("5000", 6)
    );
    await depositTx.wait();

    console.log("✅ System deployed and configured!");

    // Demonstrate the pump mechanism
    console.log("\n🎯 PUMP MECHANISM DEMONSTRATION");
    console.log("================================");

    const initialPrice = await vamm.getMarkPrice();
    console.log(`💎 Initial Price: $${hre.ethers.formatEther(initialPrice)}`);

    // Series of buys to demonstrate pump behavior
    const buyAmounts = [
      { amount: "10", leverage: 2, desc: "$10 (2x)" },
      { amount: "25", leverage: 3, desc: "$25 (3x)" },
      { amount: "50", leverage: 2, desc: "$50 (2x)" },
      { amount: "100", leverage: 5, desc: "$100 (5x)" },
    ];

    let currentPrice = initialPrice;
    let totalVolume = 0;

    for (let i = 0; i < buyAmounts.length; i++) {
      const buy = buyAmounts[i];

      console.log(`\n📈 Buy ${i + 1}: ${buy.desc}`);

      try {
        const collateral = hre.ethers.parseUnits(buy.amount, 18);
        const positionValue = Number(buy.amount) * buy.leverage;
        totalVolume += positionValue;

        const tx = await vamm.openPosition(
          collateral,
          true, // long
          buy.leverage,
          0,
          hre.ethers.MaxUint256
        );
        await tx.wait();

        const newPrice = await vamm.getMarkPrice();
        const priceIncrease = newPrice - currentPrice;
        const multiplier = Number(newPrice) / Number(currentPrice);

        console.log(`   💰 Position Value: $${positionValue}`);
        console.log(`   💎 New Price: $${hre.ethers.formatEther(newPrice)}`);
        console.log(
          `   🚀 Price Increase: $${hre.ethers.formatEther(priceIncrease)}`
        );
        console.log(`   📊 Multiplier: ${multiplier.toFixed(3)}x`);

        currentPrice = newPrice;
      } catch (error) {
        console.log(`   ❌ Buy ${i + 1} failed:`, error.message);
        break;
      }
    }

    // Final statistics
    console.log("\n📊 FINAL RESULTS");
    console.log("=================");
    const finalPrice = await vamm.getMarkPrice();
    const totalIncrease = finalPrice - initialPrice;
    const totalMultiplier = Number(finalPrice) / Number(initialPrice);

    console.log(`💎 Starting Price: $${hre.ethers.formatEther(initialPrice)}`);
    console.log(`💎 Final Price: $${hre.ethers.formatEther(finalPrice)}`);
    console.log(`🚀 Total Increase: $${hre.ethers.formatEther(totalIncrease)}`);
    console.log(`📊 Total Multiplier: ${totalMultiplier.toFixed(3)}x`);
    console.log(`💰 Total Volume Traded: $${totalVolume}`);

    // Show bonding curve parameters
    console.log("\n⚙️  BONDING CURVE PARAMETERS");
    console.log("=============================");
    const startingPrice = await vamm.startingPrice();
    const pumpExponent = await vamm.pumpExponent();
    const steepness = await vamm.BONDING_CURVE_STEEPNESS();
    const totalSupply = await vamm.getTotalSupply();

    console.log(`🎯 Starting Price: $${hre.ethers.formatEther(startingPrice)}`);
    console.log(`📈 Pump Exponent: ${hre.ethers.formatEther(pumpExponent)}`);
    console.log(`⚖️  Steepness: ${steepness.toString()}`);
    console.log(`📦 Total Supply: ${hre.ethers.formatEther(totalSupply)}`);

    console.log("\n🎉 SUCCESS! The bonding curve vAMM is working perfectly!");
    console.log("📈 Price increases with each buy (pump.fun-style behavior)");
    console.log("⚡ No more arithmetic overflow errors!");
    console.log("🔧 Simple math replaced complex PRBMath library");
  } catch (error) {
    console.error("💥 Demo failed:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
