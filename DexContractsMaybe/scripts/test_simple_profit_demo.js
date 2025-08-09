const { ethers } = require("hardhat");

async function main() {
  console.log("💰 SIMPLE PROFIT DEMONSTRATION");
  console.log("===============================\n");

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

  const SimpleVault = await ethers.getContractFactory("SimpleVault");
  const vault = SimpleVault.attach(deployedAddresses.vault);

  const SimpleVAMM = await ethers.getContractFactory("SimpleVAMM");
  const vamm = SimpleVAMM.attach(deployedAddresses.vamm);

  console.log("✅ Connected to deployed contracts\n");

  // Helper functions
  function formatUSD(value, decimals = 6) {
    return parseFloat(ethers.formatUnits(value, decimals));
  }

  function formatPrice(value) {
    return parseFloat(ethers.formatEther(value));
  }

  async function showMarketState(title) {
    console.log(`\n📊 ${title}`);
    console.log("─".repeat(title.length + 4));

    const price = await vamm.getMarkPrice();
    const summary = await vamm.getMarketSummary();
    const collateral = await vault.getCollateralBalance(
      await deployer.getAddress()
    );
    const available = await vault.getAvailableMargin(
      await deployer.getAddress()
    );

    console.log(`💰 Price: $${formatPrice(price).toFixed(4)}`);
    console.log(
      `📈 Net Position: $${formatUSD(summary.netPositionSize).toFixed(0)}`
    );
    console.log(`💳 Available Margin: $${formatUSD(available).toFixed(2)}`);

    return {
      price: formatPrice(price),
      netPosition: formatUSD(summary.netPositionSize),
      available: formatUSD(available),
    };
  }

  try {
    const initialState = await showMarketState("Initial Market State");

    // Use conservative amounts based on available margin
    const availableMargin = initialState.available;
    const tradeCollateral = Math.min(50, availableMargin * 0.8); // Use 80% of available, max $50
    const leverage = 3; // Conservative leverage

    console.log(
      `\n🎯 PROFIT STRATEGY: Using $${tradeCollateral.toFixed(
        0
      )} collateral @ ${leverage}x leverage`
    );
    console.log(
      `📊 Position Size: $${(tradeCollateral * leverage).toFixed(0)}`
    );

    if (tradeCollateral < 10) {
      console.log("❌ Insufficient margin for meaningful trades");
      console.log("💡 Need more collateral to demonstrate profits");
      return;
    }

    console.log("\n🚀 TRADE 1: Opening LONG position for momentum");

    // Trade 1: Open long position
    const longTx = await vamm.openPosition(
      ethers.parseUnits(tradeCollateral.toString(), 6),
      true, // long
      leverage,
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

    let longPositionId, longEntryPrice;
    if (longEvents.length > 0) {
      const longEvent = vamm.interface.parseLog(longEvents[0]);
      longPositionId = longEvent.args.positionId;
      longEntryPrice = formatPrice(longEvent.args.price);

      console.log(`✅ Long position opened - ID: ${longPositionId}`);
      console.log(`📈 Entry Price: $${longEntryPrice.toFixed(4)}`);
    }

    const stateAfterLong = await showMarketState("After Long Position");

    console.log("\n🚀 TRADE 2: Opening ANOTHER long to drive price higher");

    // Trade 2: Open another long to drive price up more
    const secondLongTx = await vamm.openPosition(
      ethers.parseUnits((tradeCollateral * 0.7).toString(), 6), // Smaller second position
      true, // long
      leverage,
      0, // minPrice
      ethers.parseEther("1000") // maxPrice
    );

    const secondLongReceipt = await secondLongTx.wait();
    const secondLongEvents = secondLongReceipt.logs.filter((log) => {
      try {
        return vamm.interface.parseLog(log)?.name === "PositionOpened";
      } catch {
        return false;
      }
    });

    let secondLongPositionId;
    if (secondLongEvents.length > 0) {
      const secondLongEvent = vamm.interface.parseLog(secondLongEvents[0]);
      secondLongPositionId = secondLongEvent.args.positionId;

      console.log(
        `✅ Second long position opened - ID: ${secondLongPositionId}`
      );
      console.log(
        `📈 Entry Price: $${formatPrice(secondLongEvent.args.price).toFixed(4)}`
      );
    }

    const stateAfterSecondLong = await showMarketState(
      "After Second Long Position"
    );

    // Calculate price movement
    const priceIncrease =
      ((stateAfterSecondLong.price - initialState.price) / initialState.price) *
      100;
    console.log(`🚀 Price moved up by ${priceIncrease.toFixed(2)}%!`);

    // Check unrealized P&L
    if (longPositionId) {
      const unrealizedPnL = await vamm.getUnrealizedPnL(longPositionId);
      console.log(
        `💰 Unrealized P&L on first position: $${formatUSD(
          unrealizedPnL
        ).toFixed(2)}`
      );
    }

    console.log("\n💰 PROFIT TAKING: Closing first long position");

    // Close first position for profit
    if (longPositionId) {
      const closeTx = await vamm.closePosition(
        longPositionId,
        ethers.parseUnits((tradeCollateral * leverage).toString(), 6), // Close full position
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
        const exitPrice = formatPrice(closeEvent.args.price);
        const realizedPnL = formatUSD(closeEvent.args.pnl);

        console.log(`✅ Position closed at: $${exitPrice.toFixed(4)}`);
        console.log(`💰 Realized P&L: $${realizedPnL.toFixed(2)}`);

        const pnlPercentage =
          ((exitPrice - longEntryPrice) / longEntryPrice) * 100;
        console.log(`📊 Return: ${pnlPercentage.toFixed(2)}%`);

        if (realizedPnL > 0) {
          console.log("🎉 PROFITABLE TRADE! ✅");
          console.log(
            `💎 Profit of $${realizedPnL.toFixed(
              2
            )} on $${tradeCollateral.toFixed(0)} investment`
          );
          console.log(
            `🚀 ROI: ${((realizedPnL / tradeCollateral) * 100).toFixed(2)}%`
          );
        } else {
          console.log("📊 Trade didn't make profit this time");
        }
      }
    }

    console.log("\n🔄 REVERSAL STRATEGY: Now going SHORT for another profit");

    // Trade 3: Go short to profit from reversal
    const shortTx = await vamm.openPosition(
      ethers.parseUnits((tradeCollateral * 0.8).toString(), 6),
      false, // short
      leverage,
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

    let shortPositionId, shortEntryPrice;
    if (shortEvents.length > 0) {
      const shortEvent = vamm.interface.parseLog(shortEvents[0]);
      shortPositionId = shortEvent.args.positionId;
      shortEntryPrice = formatPrice(shortEvent.args.price);

      console.log(`✅ Short position opened - ID: ${shortPositionId}`);
      console.log(`📉 Entry Price: $${shortEntryPrice.toFixed(4)}`);
    }

    const stateAfterShort = await showMarketState("After Short Position");

    console.log("\n🔄 ADDING MORE SHORT PRESSURE to drive price down");

    // Trade 4: Add more short pressure
    const secondShortTx = await vamm.openPosition(
      ethers.parseUnits((tradeCollateral * 0.6).toString(), 6),
      false, // short
      leverage,
      0, // minPrice
      ethers.parseEther("1000") // maxPrice
    );

    await secondShortTx.wait();

    const finalState = await showMarketState("After Additional Short Pressure");

    console.log("\n💰 CLOSING SHORT POSITION for profit");

    // Close short position
    if (shortPositionId) {
      const closeShortTx = await vamm.closePosition(
        shortPositionId,
        ethers.parseUnits((tradeCollateral * 0.8 * leverage).toString(), 6), // Close full position
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
        const shortExitPrice = formatPrice(closeShortEvent.args.price);
        const shortRealizedPnL = formatUSD(closeShortEvent.args.pnl);

        console.log(
          `✅ Short position closed at: $${shortExitPrice.toFixed(4)}`
        );
        console.log(`💰 Realized P&L: $${shortRealizedPnL.toFixed(2)}`);

        const shortPnlPercentage =
          ((shortEntryPrice - shortExitPrice) / shortEntryPrice) * 100;
        console.log(`📊 Return: ${shortPnlPercentage.toFixed(2)}%`);

        if (shortRealizedPnL > 0) {
          console.log("🎉 ANOTHER PROFITABLE TRADE! ✅");
          console.log(
            `💎 Profit of $${shortRealizedPnL.toFixed(2)} on $${(
              tradeCollateral * 0.8
            ).toFixed(0)} investment`
          );
        } else {
          console.log("📊 Short trade didn't make profit this time");
        }
      }
    }

    // Final summary
    const endState = await showMarketState("Final Market State");

    console.log("\n🎊 PROFIT DEMONSTRATION COMPLETE! 🎊");
    console.log("====================================");
    console.log(
      `🚀 Total Price Movement: ${(
        ((endState.price - initialState.price) / initialState.price) *
        100
      ).toFixed(2)}%`
    );
    console.log(
      `⚖️  Market Impact: $${(
        endState.netPosition - initialState.netPosition
      ).toFixed(0)}`
    );
    console.log(
      `💰 Available Margin Change: $${(
        endState.available - initialState.available
      ).toFixed(2)}`
    );

    console.log("\n✅ Successfully demonstrated:");
    console.log("• Opening profitable long positions");
    console.log("• Price impact from trades");
    console.log("• Profit realization and P&L calculation");
    console.log("• Reversal strategy with short positions");
    console.log("• Risk management with appropriate position sizing");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    throw error;
  }
}

main()
  .then(() => {
    console.log("\n✅ Simple profit demonstration completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
