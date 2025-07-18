const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Testing Massive Position for Dramatic Price Movement...\n");

  // Connect to deployed contracts (use latest deployment addresses)
  const usdcAddress = "0x59b670e9fA9D0A427751Af201D676719a970857b";
  const vaultAddress = "0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44";
  const vammAddress = "0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f";

  const [deployer, trader] = await ethers.getSigners();

  // Connect to contracts
  const usdc = await ethers.getContractAt("SimpleUSDC", usdcAddress);
  const vault = await ethers.getContractAt("SimpleVault", vaultAddress);
  const vamm = await ethers.getContractAt("SimpleVAMM", vammAddress);

  // Connect trader to contracts
  const traderUSDC = usdc.connect(trader);
  const traderVault = vault.connect(trader);
  const traderVAMM = vamm.connect(trader);

  console.log("📊 Initial State:");
  const initialPrice = await vamm.getMarkPrice();
  const initialSummary = await vamm.getMarketSummary();

  console.log("💰 Initial Price:", ethers.formatEther(initialPrice), "USD");
  console.log(
    "🏦 Initial Base Reserves:",
    ethers.formatEther(initialSummary.baseReserves)
  );
  console.log(
    "💵 Initial Quote Reserves:",
    ethers.formatEther(initialSummary.quoteReserves)
  );

  // Mint massive amount of USDC
  const massiveAmount = ethers.parseUnits("1000000", 6); // 1M USDC
  await usdc.mint(trader.address, massiveAmount);
  console.log("✅ Minted 1,000,000 USDC to trader");

  // Deposit massive collateral
  const collateralAmount = ethers.parseUnits("100000", 6); // 100K USDC
  await traderVault.depositCollateral(trader.address, collateralAmount);
  console.log("✅ Deposited 100,000 USDC as collateral");

  // Open MASSIVE position with moderate leverage but huge collateral
  console.log("\n🎯 Opening MASSIVE Position:");
  const leverage = 5; // Moderate leverage
  const positionSize = collateralAmount * BigInt(leverage);

  console.log(
    "💰 Collateral:",
    ethers.formatUnits(collateralAmount, 6),
    "USDC"
  );
  console.log("📊 Leverage:", leverage + "x");
  console.log("💵 Position Size:", ethers.formatUnits(positionSize, 6), "USD");
  console.log(
    "🎯 Expected: 500,000 USD position should cause MASSIVE price impact!"
  );

  try {
    const tx = await traderVAMM.openPosition(
      collateralAmount,
      true, // isLong - pushes price UP
      leverage,
      0, // minPrice
      ethers.parseEther("1000") // maxPrice - allow up to $1000
    );

    await tx.wait();
    console.log("✅ MASSIVE Position opened successfully!");

    // Check final state
    const finalPrice = await vamm.getMarkPrice();
    const finalSummary = await vamm.getMarketSummary();
    const priceChange = ((finalPrice - initialPrice) * 100n) / initialPrice;

    console.log("\n📊 Final State:");
    console.log("💰 Final Price:", ethers.formatEther(finalPrice), "USD");
    console.log("📈 Price Change:", priceChange.toString() + "%");
    console.log(
      "📊 Net Position:",
      ethers.formatUnits(finalSummary.netPositionSize, 6),
      "USD"
    );
    console.log(
      "🏦 Final Base Reserves:",
      ethers.formatEther(finalSummary.baseReserves)
    );
    console.log(
      "💵 Final Quote Reserves:",
      ethers.formatEther(finalSummary.quoteReserves)
    );

    if (priceChange >= 25n) {
      console.log("🎉 SUCCESS! Achieved 25%+ price movement!");
    } else {
      console.log("⚠️  Price change still smaller than expected");
      console.log("🔧 May need to adjust contract parameters further");

      // Try opening another position to push it further
      console.log("\n🎯 Opening SECOND MASSIVE Position:");
      const tx2 = await traderVAMM.openPosition(
        collateralAmount,
        true, // isLong - pushes price UP even more
        leverage,
        0, // minPrice
        ethers.parseEther("1000") // maxPrice
      );

      await tx2.wait();

      const finalPrice2 = await vamm.getMarkPrice();
      const priceChange2 = ((finalPrice2 - initialPrice) * 100n) / initialPrice;

      console.log("✅ SECOND Position opened!");
      console.log(
        "💰 Final Price After 2nd Position:",
        ethers.formatEther(finalPrice2),
        "USD"
      );
      console.log("📈 Total Price Change:", priceChange2.toString() + "%");

      if (priceChange2 >= 25n) {
        console.log(
          "🎉 SUCCESS! Achieved 25%+ price movement with 2 positions!"
        );
      }
    }
  } catch (error) {
    console.log("❌ Failed to open massive position:", error.message);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Test failed:", error);
      process.exit(1);
    });
}

module.exports = main;
