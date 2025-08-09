const { ethers } = require("hardhat");

async function main() {
  console.log("🔧 Testing Positions on Existing Contracts...\n");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("📋 Using account:", await deployer.getAddress());

  // Connect to existing contracts from successful simple test
  // Use the addresses from the successful deployment
  const usdcAddress = "0xbD9E0b8e723434dCd41700e82cC4C8C539F66377";
  const oracleAddress = "0x9f7Aa3d247a338cb612B2F8B5042068d3aeAe711";
  const vaultAddress = "0x2C8d16222d4A1065285f28FA7fB7C6cF5cf7094e";
  const vammAddress = "0x487f1baE58CE513B39889152E96Eb18a346c75b1";

  const SimpleUSDC = await ethers.getContractFactory("SimpleUSDC");
  const usdc = SimpleUSDC.attach(usdcAddress);

  const SimplePriceOracle = await ethers.getContractFactory(
    "SimplePriceOracle"
  );
  const oracle = SimplePriceOracle.attach(oracleAddress);

  const SimpleVault = await ethers.getContractFactory("SimpleVault");
  const vault = SimpleVault.attach(vaultAddress);

  const SimpleVAMM = await ethers.getContractFactory("SimpleVAMM");
  const vamm = SimpleVAMM.attach(vammAddress);

  console.log("✅ Connected to existing contracts");

  // Check current state
  const currentPrice = await vamm.getMarkPrice();
  console.log("💰 Current price:", ethers.formatEther(currentPrice), "USD");

  const marketSummary = await vamm.getMarketSummary();
  console.log(
    "📈 Net Position:",
    ethers.formatUnits(marketSummary.netPositionSize, 6),
    "USD"
  );
  console.log(
    "🔢 Total Longs:",
    ethers.formatUnits(marketSummary.totalLongSizeUint, 6),
    "USD"
  );
  console.log(
    "🔻 Total Shorts:",
    ethers.formatUnits(marketSummary.totalShortSizeUint, 6),
    "USD"
  );

  // Check our current state
  const collateralBalance = await vault.getCollateralBalance(
    await deployer.getAddress()
  );
  const availableMargin = await vault.getAvailableMargin(
    await deployer.getAddress()
  );
  console.log(
    "💰 Our collateral:",
    ethers.formatUnits(collateralBalance, 6),
    "USDC"
  );
  console.log(
    "💰 Our available margin:",
    ethers.formatUnits(availableMargin, 6),
    "USDC"
  );

  // Test long position to drive price up 25% (from ~2.0 to ~2.5)
  console.log("\n🚀 Testing Long Position to Increase Price by 25%...");

  if (availableMargin > ethers.parseUnits("500", 6)) {
    const longCollateral = ethers.parseUnits("300", 6); // 300 USDC collateral
    const leverage = 3; // 3x leverage for 900 USD position
    const minPrice = 0;
    const maxPrice = ethers.parseEther("10");

    console.log(
      "📈 Opening long position with $300 collateral at 3x leverage..."
    );
    const tx1 = await vamm.openPosition(
      longCollateral,
      true,
      leverage,
      minPrice,
      maxPrice
    );
    await tx1.wait();

    const newPrice1 = await vamm.getMarkPrice();
    console.log(
      "💰 New price after long:",
      ethers.formatEther(newPrice1),
      "USD"
    );

    const priceIncrease =
      ((parseFloat(ethers.formatEther(newPrice1)) -
        parseFloat(ethers.formatEther(currentPrice))) /
        parseFloat(ethers.formatEther(currentPrice))) *
      100;
    console.log(`📊 Price increase: ${priceIncrease.toFixed(2)}%`);

    // Test short position to drive price down 50%
    console.log("\n🔻 Testing Short Position to Decrease Price by 50%...");

    const availableMargin2 = await vault.getAvailableMargin(
      await deployer.getAddress()
    );
    console.log(
      "💰 Available margin for short:",
      ethers.formatUnits(availableMargin2, 6),
      "USDC"
    );

    if (availableMargin2 > ethers.parseUnits("1000", 6)) {
      const shortCollateral = ethers.parseUnits("1000", 6); // 1000 USDC collateral
      const shortLeverage = 4; // 4x leverage for 4000 USD position

      console.log(
        "📉 Opening short position with $1000 collateral at 4x leverage..."
      );
      const tx2 = await vamm.openPosition(
        shortCollateral,
        false,
        shortLeverage,
        minPrice,
        maxPrice
      );
      await tx2.wait();

      const finalPrice = await vamm.getMarkPrice();
      console.log(
        "💰 Final price after short:",
        ethers.formatEther(finalPrice),
        "USD"
      );

      const priceDecrease =
        ((parseFloat(ethers.formatEther(newPrice1)) -
          parseFloat(ethers.formatEther(finalPrice))) /
          parseFloat(ethers.formatEther(newPrice1))) *
        100;
      console.log(`📊 Price decrease: ${priceDecrease.toFixed(2)}%`);

      // Final summary
      console.log("\n🎉 Test Results Summary:");
      console.log("=======================================");
      console.log(
        "💰 Starting Price:",
        ethers.formatEther(currentPrice),
        "USD"
      );
      console.log(
        "📈 After Long Position:",
        ethers.formatEther(newPrice1),
        "USD",
        `(+${priceIncrease.toFixed(2)}%)`
      );
      console.log(
        "📉 Final Price:",
        ethers.formatEther(finalPrice),
        "USD",
        `(-${priceDecrease.toFixed(2)}%)`
      );

      const finalMarketSummary = await vamm.getMarketSummary();
      console.log("\n📊 Final Market State:");
      console.log(
        "📈 Net Position:",
        ethers.formatUnits(finalMarketSummary.netPositionSize, 6),
        "USD"
      );
      console.log(
        "🔢 Total Longs:",
        ethers.formatUnits(finalMarketSummary.totalLongSizeUint, 6),
        "USD"
      );
      console.log(
        "🔻 Total Shorts:",
        ethers.formatUnits(finalMarketSummary.totalShortSizeUint, 6),
        "USD"
      );
    } else {
      console.log("⚠️ Insufficient margin for short position");
    }
  } else {
    console.log("⚠️ Insufficient margin for long position");
    console.log("💡 Need to deposit more collateral first");
  }
}

main()
  .then(() => {
    console.log("\n✅ Position testing completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Position testing failed:", error);
    process.exit(1);
  });
