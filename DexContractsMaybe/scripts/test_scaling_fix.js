const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Testing Scaling Fix for 25% Price Movement...\n");

  // Connect to deployed contracts
  const usdcAddress = "0x59b670e9fA9D0A427751Af201D676719a970857b";
  const vaultAddress = "0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44";
  const vammAddress = "0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f";

  const [deployer, trader] = await ethers.getSigners();

  const usdc = await ethers.getContractAt("SimpleUSDC", usdcAddress);
  const vault = await ethers.getContractAt("SimpleVault", vaultAddress);
  const vamm = await ethers.getContractAt("SimpleVAMM", vammAddress);

  const traderVault = vault.connect(trader);
  const traderVAMM = vamm.connect(trader);

  console.log("📊 Current State:");
  const currentPrice = await vamm.getMarkPrice();
  const currentSummary = await vamm.getMarketSummary();

  console.log("💰 Current Price:", ethers.formatEther(currentPrice), "USD");
  console.log(
    "📊 Current Net Position:",
    ethers.formatUnits(currentSummary.netPositionSize, 6),
    "USD"
  );
  console.log(
    "🏦 Current Base Reserves:",
    ethers.formatEther(currentSummary.baseReserves)
  );

  // Calculate what we need for 25% price increase
  // If current price is 100, target is 125
  // Price = quoteReserves / baseReserves
  // So if quote = 1000 and current base = ~10, then price = 1000/10 = 100
  // For price = 125, we need base = 1000/125 = 8
  // So we need to reduce base reserves by 2 (from 10 to 8)

  const targetPrice = ethers.parseEther("125"); // $125
  const priceChange = ((targetPrice - currentPrice) * 100n) / currentPrice;

  console.log("🎯 Target price:", ethers.formatEther(targetPrice), "USD");
  console.log("🎯 Required change:", priceChange.toString() + "%");

  // Current base reserves are about 10 ETH, quote reserves 1000 ETH
  // We need to reduce base reserves to 8 ETH for 25% increase
  // That means we need an impact of 2 ETH
  // Since impact = netPosition (and no divisor), we need netPosition = 2 ETH = 2e18

  const requiredNetPosition = ethers.parseEther("2"); // 2 ETH worth of impact needed
  console.log(
    "🔧 Required net position for 25% increase:",
    ethers.formatEther(requiredNetPosition)
  );

  // But our net positions are in USDC units, not ETH
  // Current net position is 1M USDC = 1e12 in USDC units (6 decimals)
  // But contract expects ETH units = 1e18
  // So we have a 1e6 scaling issue!

  console.log("🔍 Scaling Analysis:");
  console.log(
    "   Current net position (USDC units):",
    currentSummary.netPositionSize.toString()
  );
  console.log(
    "   Required impact (ETH units):",
    requiredNetPosition.toString()
  );
  console.log(
    "   Scaling factor needed:",
    (requiredNetPosition / currentSummary.netPositionSize).toString()
  );

  // The solution: we need position sizes 1e12 times larger!
  // Let's deposit more collateral and open a massive position

  console.log("\n🎯 Opening ULTRA-MASSIVE Position:");

  // Mint even more USDC
  const ultraAmount = ethers.parseUnits("10000000", 6); // 10M USDC
  await usdc.mint(trader.address, ultraAmount);
  console.log("✅ Minted 10,000,000 USDC to trader");

  // Deposit huge collateral
  const hugeCollateral = ethers.parseUnits("1000000", 6); // 1M USDC
  await traderVault.depositCollateral(trader.address, hugeCollateral);
  console.log("✅ Deposited 1,000,000 USDC as collateral");

  // Open position with 2x leverage = 2M USD position
  const leverage = 2;
  const expectedImpact = hugeCollateral * BigInt(leverage);

  console.log("💰 Collateral:", ethers.formatUnits(hugeCollateral, 6), "USDC");
  console.log("📊 Leverage:", leverage + "x");
  console.log(
    "💵 Position Size:",
    ethers.formatUnits(expectedImpact, 6),
    "USD"
  );

  try {
    const tx = await traderVAMM.openPosition(
      hugeCollateral,
      true, // isLong
      leverage,
      0, // minPrice
      ethers.parseEther("200") // maxPrice - allow up to $200
    );

    await tx.wait();
    console.log("✅ ULTRA-MASSIVE Position opened!");

    // Check final state
    const finalPrice = await vamm.getMarkPrice();
    const finalSummary = await vamm.getMarketSummary();
    const actualPriceChange =
      ((finalPrice - currentPrice) * 100n) / currentPrice;

    console.log("\n📊 Final Results:");
    console.log("💰 Final Price:", ethers.formatEther(finalPrice), "USD");
    console.log("📈 Actual Price Change:", actualPriceChange.toString() + "%");
    console.log(
      "📊 Final Net Position:",
      ethers.formatUnits(finalSummary.netPositionSize, 6),
      "USD"
    );
    console.log(
      "🏦 Final Base Reserves:",
      ethers.formatEther(finalSummary.baseReserves)
    );

    if (actualPriceChange >= 25n) {
      console.log("🎉🎉🎉 SUCCESS! ACHIEVED 25%+ PRICE MOVEMENT! 🎉🎉🎉");
    } else if (actualPriceChange >= 10n) {
      console.log("🎯 Good progress! Achieved 10%+ movement, getting closer!");
    } else {
      console.log("⚠️  Still need more sensitivity");
    }
  } catch (error) {
    console.log("❌ Failed:", error.message);
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
