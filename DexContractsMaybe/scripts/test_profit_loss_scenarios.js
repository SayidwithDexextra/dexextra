const { ethers } = require("hardhat");

async function main() {
  console.log("🎯 PROFIT & LOSS TEST SCENARIOS");
  console.log("=================================\n");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("📋 Using account:", await deployer.getAddress());

  // Connect to deployed contracts
  const deployedAddresses = {
    usdc: "0x59d8f917b25f26633d173262A59136Eb326a76c1",
    oracle: "0x7c63Ac8d8489a21cB12c7088b377732CC1208beC",
    vault: "0x3e2928b4123AF4e42F9373b57fb1DD68Fd056bc9",
    vamm: "0xfEAA2a60449E11935C636b9E42866Fd0cBbdF2ed",
  };

  const SimpleUSDC = await ethers.getContractFactory("SimpleUSDC");
  const usdc = SimpleUSDC.attach(deployedAddresses.usdc);

  const SimplePriceOracle = await ethers.getContractFactory(
    "SimplePriceOracle"
  );
  const oracle = SimplePriceOracle.attach(deployedAddresses.oracle);

  const SimpleVault = await ethers.getContractFactory("SimpleVault");
  const vault = SimpleVault.attach(deployedAddresses.vault);

  const SimpleVAMM = await ethers.getContractFactory("SimpleVAMM");
  const vamm = SimpleVAMM.attach(deployedAddresses.vamm);

  console.log("✅ Connected to deployed contracts\n");

  // Helper function to format numbers
  function formatUSD(value, decimals = 6) {
    return ethers.formatUnits(value, decimals);
  }

  function formatPrice(value) {
    return ethers.formatEther(value);
  }

  // Helper function to display market state
  async function displayMarketState(title) {
    console.log(`\n📊 ${title}`);
    console.log("─".repeat(40));
    const price = await vamm.getMarkPrice();
    const summary = await vamm.getMarketSummary();

    console.log(`💰 Current Price: $${formatPrice(price)}`);
    console.log(`📈 Total Longs: $${formatUSD(summary.totalLongSizeUint, 6)}`);
    console.log(
      `📉 Total Shorts: $${formatUSD(summary.totalShortSizeUint, 6)}`
    );
    console.log(`⚖️  Net Position: $${formatUSD(summary.netPositionSize, 6)}`);

    return price;
  }

  // Helper function to display user state
  async function displayUserState(title) {
    console.log(`\n👤 ${title}`);
    console.log("─".repeat(30));
    const collateral = await vault.getCollateralBalance(
      await deployer.getAddress()
    );
    const available = await vault.getAvailableMargin(
      await deployer.getAddress()
    );
    const reserved = await vault.getReservedMargin(await deployer.getAddress());

    console.log(`💰 Collateral: $${formatUSD(collateral, 6)}`);
    console.log(`💳 Available: $${formatUSD(available, 6)}`);
    console.log(`🔒 Reserved: $${formatUSD(reserved, 6)}`);
  }

  // Helper function to calculate PnL percentage
  function calculatePnLPercentage(entryPrice, exitPrice, isLong) {
    const entry = parseFloat(formatPrice(entryPrice));
    const exit = parseFloat(formatPrice(exitPrice));

    if (isLong) {
      return ((exit - entry) / entry) * 100;
    } else {
      return ((entry - exit) / entry) * 100;
    }
  }

  try {
    // Display initial state
    const initialPrice = await displayMarketState("Initial Market State");
    await displayUserState("Initial User State");

    // Ensure we have enough collateral
    const currentBalance = await vault.getCollateralBalance(
      await deployer.getAddress()
    );
    if (currentBalance < ethers.parseUnits("5000", 6)) {
      console.log("\n💳 Depositing additional collateral...");
      await usdc.approve(
        await vault.getAddress(),
        ethers.parseUnits("10000", 6)
      );
      await vault.depositCollateral(
        await deployer.getAddress(),
        ethers.parseUnits("10000", 6)
      );
      console.log("✅ Deposited $10,000 USDC");
    }

    console.log("\n🎯 SCENARIO 1: PROFITABLE LONG TRADE");
    console.log("=====================================");

    // Open long position to drive price up
    const longCollateral = ethers.parseUnits("1000", 6); // $1000 collateral
    const longLeverage = 5; // 5x leverage = $5000 position

    console.log(
      "📈 Opening LONG position: $1000 collateral @ 5x leverage = $5000 position"
    );

    const longTx = await vamm.openPosition(
      longCollateral,
      true, // isLong
      longLeverage,
      0, // minPrice
      ethers.parseEther("1000") // maxPrice
    );

    const longReceipt = await longTx.wait();
    const longEvents = longReceipt.logs.filter((log) => {
      try {
        return vamm.interface.parseLog(log)?.name === "PositionOpened";
      } catch {
        return false;
      }
    });

    if (longEvents.length > 0) {
      const longEvent = vamm.interface.parseLog(longEvents[0]);
      const longPositionId = longEvent.args.positionId;
      const longEntryPrice = longEvent.args.price;

      console.log(`✅ Long position opened - ID: ${longPositionId}`);
      console.log(`💰 Entry Price: $${formatPrice(longEntryPrice)}`);

      await displayMarketState("After Long Position");

      // Wait a moment and check unrealized PnL
      const unrealizedPnL = await vamm.getUnrealizedPnL(longPositionId);
      console.log(`📊 Unrealized PnL: $${formatUSD(unrealizedPnL, 6)}`);

      // Open another long to push price higher
      console.log("\n📈 Opening ANOTHER long to push price higher...");
      const longTx2 = await vamm.openPosition(
        ethers.parseUnits("500", 6), // $500 collateral
        true, // isLong
        4, // 4x leverage = $2000 position
        0, // minPrice
        ethers.parseEther("1000") // maxPrice
      );
      await longTx2.wait();

      const priceAfterSecondLong = await displayMarketState(
        "After Second Long Position"
      );

      // Check updated unrealized PnL
      const updatedUnrealizedPnL = await vamm.getUnrealizedPnL(longPositionId);
      console.log(
        `📊 Updated Unrealized PnL: $${formatUSD(updatedUnrealizedPnL, 6)}`
      );

      // Close the first long position for profit
      console.log("\n💰 Closing first long position for PROFIT...");
      const closeTx = await vamm.closePosition(
        longPositionId,
        ethers.parseUnits("5000", 6), // Close full position
        0, // minPrice
        ethers.parseEther("1000") // maxPrice
      );

      const closeReceipt = await closeTx.wait();
      const closeEvents = closeReceipt.logs.filter((log) => {
        try {
          return vamm.interface.parseLog(log)?.name === "PositionClosed";
        } catch {
          return false;
        }
      });

      if (closeEvents.length > 0) {
        const closeEvent = vamm.interface.parseLog(closeEvents[0]);
        const exitPrice = closeEvent.args.price;
        const realizedPnL = closeEvent.args.pnl;

        console.log(`✅ Position closed at: $${formatPrice(exitPrice)}`);
        console.log(`💰 Realized PnL: $${formatUSD(realizedPnL, 6)}`);

        const pnlPercentage = calculatePnLPercentage(
          longEntryPrice,
          exitPrice,
          true
        );
        console.log(`📊 PnL Percentage: ${pnlPercentage.toFixed(2)}%`);

        if (realizedPnL > 0) {
          console.log("🎉 PROFITABLE TRADE! ✅");
        } else {
          console.log("❌ Loss on trade");
        }
      }
    }

    console.log("\n🎯 SCENARIO 2: PROFITABLE SHORT TRADE");
    console.log("======================================");

    // Open short position to drive price down
    const shortCollateral = ethers.parseUnits("800", 6); // $800 collateral
    const shortLeverage = 6; // 6x leverage = $4800 position

    console.log(
      "📉 Opening SHORT position: $800 collateral @ 6x leverage = $4800 position"
    );

    const shortTx = await vamm.openPosition(
      shortCollateral,
      false, // isShort
      shortLeverage,
      0, // minPrice
      ethers.parseEther("1000") // maxPrice
    );

    const shortReceipt = await shortTx.wait();
    const shortEvents = shortReceipt.logs.filter((log) => {
      try {
        return vamm.interface.parseLog(log)?.name === "PositionOpened";
      } catch {
        return false;
      }
    });

    if (shortEvents.length > 0) {
      const shortEvent = vamm.interface.parseLog(shortEvents[0]);
      const shortPositionId = shortEvent.args.positionId;
      const shortEntryPrice = shortEvent.args.price;

      console.log(`✅ Short position opened - ID: ${shortPositionId}`);
      console.log(`💰 Entry Price: $${formatPrice(shortEntryPrice)}`);

      await displayMarketState("After Short Position");

      // Open another short to push price lower
      console.log("\n📉 Opening ANOTHER short to push price lower...");
      const shortTx2 = await vamm.openPosition(
        ethers.parseUnits("600", 6), // $600 collateral
        false, // isShort
        5, // 5x leverage = $3000 position
        0, // minPrice
        ethers.parseEther("1000") // maxPrice
      );
      await shortTx2.wait();

      const priceAfterSecondShort = await displayMarketState(
        "After Second Short Position"
      );

      // Check unrealized PnL
      const shortUnrealizedPnL = await vamm.getUnrealizedPnL(shortPositionId);
      console.log(`📊 Unrealized PnL: $${formatUSD(shortUnrealizedPnL, 6)}`);

      // Close the short position for profit
      console.log("\n💰 Closing short position for PROFIT...");
      const closeShortTx = await vamm.closePosition(
        shortPositionId,
        ethers.parseUnits("4800", 6), // Close full position
        0, // minPrice
        ethers.parseEther("1000") // maxPrice
      );

      const closeShortReceipt = await closeShortTx.wait();
      const closeShortEvents = closeShortReceipt.logs.filter((log) => {
        try {
          return vamm.interface.parseLog(log)?.name === "PositionClosed";
        } catch {
          return false;
        }
      });

      if (closeShortEvents.length > 0) {
        const closeShortEvent = vamm.interface.parseLog(closeShortEvents[0]);
        const shortExitPrice = closeShortEvent.args.price;
        const shortRealizedPnL = closeShortEvent.args.pnl;

        console.log(`✅ Position closed at: $${formatPrice(shortExitPrice)}`);
        console.log(`💰 Realized PnL: $${formatUSD(shortRealizedPnL, 6)}`);

        const shortPnlPercentage = calculatePnLPercentage(
          shortEntryPrice,
          shortExitPrice,
          false
        );
        console.log(`📊 PnL Percentage: ${shortPnlPercentage.toFixed(2)}%`);

        if (shortRealizedPnL > 0) {
          console.log("🎉 PROFITABLE TRADE! ✅");
        } else {
          console.log("❌ Loss on trade");
        }
      }
    }

    console.log("\n🎯 SCENARIO 3: LOSING TRADE DEMONSTRATION");
    console.log("==========================================");

    // Open a position in the wrong direction
    console.log("📈 Opening LONG position that will lose money...");

    const losingLongTx = await vamm.openPosition(
      ethers.parseUnits("500", 6), // $500 collateral
      true, // isLong (but market will go down due to existing shorts)
      3, // 3x leverage = $1500 position
      0, // minPrice
      ethers.parseEther("1000") // maxPrice
    );

    const losingLongReceipt = await losingLongTx.wait();
    const losingLongEvents = losingLongReceipt.logs.filter((log) => {
      try {
        return vamm.interface.parseLog(log)?.name === "PositionOpened";
      } catch {
        return false;
      }
    });

    if (losingLongEvents.length > 0) {
      const losingLongEvent = vamm.interface.parseLog(losingLongEvents[0]);
      const losingPositionId = losingLongEvent.args.positionId;
      const losingEntryPrice = losingLongEvent.args.price;

      console.log(`✅ Losing long position opened - ID: ${losingPositionId}`);
      console.log(`💰 Entry Price: $${formatPrice(losingEntryPrice)}`);

      // Open more shorts to drive price down against our long
      console.log(
        "\n📉 Opening shorts to drive price DOWN against our long..."
      );
      await vamm.openPosition(
        ethers.parseUnits("1000", 6), // $1000 collateral
        false, // isShort
        4, // 4x leverage = $4000 position
        0, // minPrice
        ethers.parseEther("1000") // maxPrice
      );

      await displayMarketState("After Price Driven Down");

      // Check the losing position's PnL
      const losingUnrealizedPnL = await vamm.getUnrealizedPnL(losingPositionId);
      console.log(`📊 Unrealized PnL: $${formatUSD(losingUnrealizedPnL, 6)}`);

      // Close the losing position
      console.log("\n💸 Closing losing position...");
      const closeLosingTx = await vamm.closePosition(
        losingPositionId,
        ethers.parseUnits("1500", 6), // Close full position
        0, // minPrice
        ethers.parseEther("1000") // maxPrice
      );

      const closeLosingReceipt = await closeLosingTx.wait();
      const closeLosingEvents = closeLosingReceipt.logs.filter((log) => {
        try {
          return vamm.interface.parseLog(log)?.name === "PositionClosed";
        } catch {
          return false;
        }
      });

      if (closeLosingEvents.length > 0) {
        const closeLosingEvent = vamm.interface.parseLog(closeLosingEvents[0]);
        const losingExitPrice = closeLosingEvent.args.price;
        const losingRealizedPnL = closeLosingEvent.args.pnl;

        console.log(`✅ Position closed at: $${formatPrice(losingExitPrice)}`);
        console.log(`💰 Realized PnL: $${formatUSD(losingRealizedPnL, 6)}`);

        const losingPnlPercentage = calculatePnLPercentage(
          losingEntryPrice,
          losingExitPrice,
          true
        );
        console.log(`📊 PnL Percentage: ${losingPnlPercentage.toFixed(2)}%`);

        if (losingRealizedPnL < 0) {
          console.log("❌ LOSING TRADE as expected! ✅");
        } else {
          console.log("🎉 Unexpectedly profitable!");
        }
      }
    }

    // Final state
    await displayMarketState("Final Market State");
    await displayUserState("Final User State");

    console.log("\n🎊 PROFIT & LOSS TEST SCENARIOS COMPLETE! 🎊");
  } catch (error) {
    console.error("❌ Test failed:", error);
    throw error;
  }
}

main()
  .then(() => {
    console.log("\n✅ All profit & loss scenarios completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
