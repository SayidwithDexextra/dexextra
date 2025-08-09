const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 DRAMATIC PROFIT DEMONSTRATION");
  console.log("=================================\n");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("📋 Using account:", await deployer.getAddress());

  // Connect to deployed contracts
  //   const deployedAddresses = {
  //     usdc: "0x59d8f917b25f26633d173262A59136Eb326a76c1",
  //     oracle: "0x7c63Ac8d8489a21cB12c7088b377732CC1208beC",
  //     vault: "0x3e2928b4123AF4e42F9373b57fb1DD68Fd056bc9",
  //     vamm: "0xfEAA2a60449E11935C636b9E42866Fd0cBbdF2ed",
  //   };

  const deployedAddresses = {
    usdc: "0xbD9E0b8e723434dCd41700e82cC4C8C539F66377",
    oracle: "0x9f7Aa3d247a338cb612B2F8B5042068d3aeAe711",
    vault: "0x2C8d16222d4A1065285f28FA7fB7C6cF5cf7094e",
    vamm: "0x487f1baE58CE513B39889152E96Eb18a346c75b1",
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

  async function showDetailedState(title) {
    console.log(`\n📊 ${title}`);
    console.log("=".repeat(title.length + 4));

    const price = await vamm.getMarkPrice();
    const summary = await vamm.getMarketSummary();
    const collateral = await vault.getCollateralBalance(
      await deployer.getAddress()
    );
    const available = await vault.getAvailableMargin(
      await deployer.getAddress()
    );
    const reserved = await vault.getReservedMargin(await deployer.getAddress());

    console.log(`💰 Price: $${formatPrice(price).toFixed(4)}`);
    console.log(
      `📈 Total Longs: $${formatUSD(summary.totalLongSizeUint).toFixed(0)}`
    );
    console.log(
      `📉 Total Shorts: $${formatUSD(summary.totalShortSizeUint).toFixed(0)}`
    );
    console.log(
      `⚖️  Net Position: $${formatUSD(summary.netPositionSize).toFixed(0)}`
    );
    console.log(`💳 Available Margin: $${formatUSD(available).toFixed(2)}`);
    console.log(`🔒 Reserved Margin: $${formatUSD(reserved).toFixed(2)}`);
    console.log(`💎 Total Collateral: $${formatUSD(collateral).toFixed(2)}`);

    return {
      price: formatPrice(price),
      totalLongs: formatUSD(summary.totalLongSizeUint),
      totalShorts: formatUSD(summary.totalShortSizeUint),
      netPosition: formatUSD(summary.netPositionSize),
      available: formatUSD(available),
      reserved: formatUSD(reserved),
      collateral: formatUSD(collateral),
    };
  }

  try {
    const initialState = await showDetailedState("INITIAL MARKET STATE");

    // Use substantial positions to create dramatic price movements
    const baseCollateral = 1000; // $1000 base collateral
    const maxLeverage = 10; // High leverage for dramatic effect

    console.log(`\n🎯 DRAMATIC PROFIT STRATEGY:`);
    console.log(`• Base Collateral: $${baseCollateral}`);
    console.log(`• Maximum Leverage: ${maxLeverage}x`);
    console.log(`• Target: Generate significant price movements and profits`);

    if (initialState.available < baseCollateral) {
      console.log("\n💡 Need more margin for dramatic demonstrations");
      console.log(
        `Available: $${initialState.available.toFixed(
          2
        )} | Needed: $${baseCollateral}`
      );
      return;
    }

    let totalProfit = 0;
    let tradeCount = 0;

    console.log("\n🚀 PHASE 1: MASSIVE LONG MOMENTUM");
    console.log("==================================");

    // Trade 1: Big long position
    console.log("📈 Opening MASSIVE long position...");
    const bigLongTx = await vamm.openPosition(
      ethers.parseUnits(baseCollateral.toString(), 6),
      true, // long
      maxLeverage,
      0,
      ethers.parseEther("10000")
    );

    const bigLongReceipt = await bigLongTx.wait();
    const bigLongEvents = bigLongReceipt.logs.filter((log) => {
      try {
        return vamm.interface.parseLog(log)?.name === "PositionOpened";
      } catch {
        return false;
      }
    });

    let bigLongId, bigLongEntry;
    if (bigLongEvents.length > 0) {
      const event = vamm.interface.parseLog(bigLongEvents[0]);
      bigLongId = event.args.positionId;
      bigLongEntry = formatPrice(event.args.price);

      console.log(`✅ MASSIVE LONG opened - ID: ${bigLongId}`);
      console.log(`💰 Entry Price: $${bigLongEntry.toFixed(4)}`);
      console.log(
        `📊 Position Size: $${formatUSD(event.args.size).toFixed(0)}`
      );
    }

    const afterBigLong = await showDetailedState("After MASSIVE Long Position");

    if (bigLongEntry) {
      const priceIncrease1 =
        ((afterBigLong.price - initialState.price) / initialState.price) * 100;
      console.log(`🚀 PRICE EXPLOSION: +${priceIncrease1.toFixed(2)}%!`);
    }

    // Trade 2: Stack another massive long
    console.log("\n📈 STACKING another MASSIVE long...");
    const stackLongTx = await vamm.openPosition(
      ethers.parseUnits((baseCollateral * 0.8).toString(), 6),
      true, // long
      maxLeverage,
      0,
      ethers.parseEther("10000")
    );

    const stackLongReceipt = await stackLongTx.wait();
    const stackLongEvents = stackLongReceipt.logs.filter((log) => {
      try {
        return vamm.interface.parseLog(log)?.name === "PositionOpened";
      } catch {
        return false;
      }
    });

    let stackLongId;
    if (stackLongEvents.length > 0) {
      const event = vamm.interface.parseLog(stackLongEvents[0]);
      stackLongId = event.args.positionId;
      console.log(`✅ STACKED LONG opened - ID: ${stackLongId}`);
      console.log(
        `💰 Entry Price: $${formatPrice(event.args.price).toFixed(4)}`
      );
    }

    const afterStack = await showDetailedState("After STACKED Long Position");

    const totalIncrease =
      ((afterStack.price - initialState.price) / initialState.price) * 100;
    console.log(`🚀 TOTAL PRICE SURGE: +${totalIncrease.toFixed(2)}%!`);

    // Check unrealized profits
    if (bigLongId) {
      const unrealizedPnL = await vamm.getUnrealizedPnL(bigLongId);
      console.log(
        `💰 Unrealized P&L on MASSIVE position: $${formatUSD(
          unrealizedPnL
        ).toFixed(2)}`
      );
    }

    console.log("\n💰 PHASE 2: PROFIT REALIZATION");
    console.log("===============================");

    // Close the first massive position for profit
    if (bigLongId) {
      console.log("💎 Closing MASSIVE long position for PROFIT...");
      const closeTx = await vamm.closePosition(
        bigLongId,
        ethers.parseUnits((baseCollateral * maxLeverage).toString(), 6),
        0,
        ethers.parseEther("10000")
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

        console.log(`✅ MASSIVE position closed at: $${exitPrice.toFixed(4)}`);
        console.log(`💰 REALIZED PROFIT: $${realizedPnL.toFixed(2)}`);

        const pnlPercentage = ((exitPrice - bigLongEntry) / bigLongEntry) * 100;
        console.log(`📊 Return: ${pnlPercentage.toFixed(2)}%`);
        console.log(
          `🚀 ROI on Collateral: ${(
            (realizedPnL / baseCollateral) *
            100
          ).toFixed(2)}%`
        );

        totalProfit += realizedPnL;
        tradeCount++;

        if (realizedPnL > 0) {
          console.log(`🎉 HUGE PROFIT! $${realizedPnL.toFixed(2)} GAINED! 🎉`);
        }
      }
    }

    const afterProfit = await showDetailedState("After PROFIT Realization");

    console.log("\n📉 PHASE 3: REVERSAL ATTACK");
    console.log("============================");

    // Now go for massive shorts to reverse the trend
    console.log("📉 Launching MASSIVE short attack...");
    const massiveShortTx = await vamm.openPosition(
      ethers.parseUnits((baseCollateral * 1.2).toString(), 6), // Even bigger short
      false, // short
      maxLeverage,
      0,
      ethers.parseEther("10000")
    );

    const massiveShortReceipt = await massiveShortTx.wait();
    const massiveShortEvents = massiveShortReceipt.logs.filter((log) => {
      try {
        return vamm.interface.parseLog(log)?.name === "PositionOpened";
      } catch {
        return false;
      }
    });

    let massiveShortId, massiveShortEntry;
    if (massiveShortEvents.length > 0) {
      const event = vamm.interface.parseLog(massiveShortEvents[0]);
      massiveShortId = event.args.positionId;
      massiveShortEntry = formatPrice(event.args.price);

      console.log(`✅ MASSIVE SHORT launched - ID: ${massiveShortId}`);
      console.log(`💰 Entry Price: $${massiveShortEntry.toFixed(4)}`);
      console.log(
        `📊 Position Size: $${formatUSD(event.args.size).toFixed(0)}`
      );
    }

    const afterMassiveShort = await showDetailedState(
      "After MASSIVE Short Attack"
    );

    // Add another short for maximum reversal
    console.log("\n📉 DOUBLING DOWN with another massive short...");
    const doubleShortTx = await vamm.openPosition(
      ethers.parseUnits(baseCollateral.toString(), 6),
      false, // short
      maxLeverage,
      0,
      ethers.parseEther("10000")
    );

    const doubleShortReceipt = await doubleShortTx.wait();
    const doubleShortEvents = doubleShortReceipt.logs.filter((log) => {
      try {
        return vamm.interface.parseLog(log)?.name === "PositionOpened";
      } catch {
        return false;
      }
    });

    let doubleShortId;
    if (doubleShortEvents.length > 0) {
      const event = vamm.interface.parseLog(doubleShortEvents[0]);
      doubleShortId = event.args.positionId;
      console.log(`✅ DOUBLE SHORT launched - ID: ${doubleShortId}`);
      console.log(
        `💰 Entry Price: $${formatPrice(event.args.price).toFixed(4)}`
      );
    }

    const afterDoubleShort = await showDetailedState(
      "After DOUBLE Short Attack"
    );

    const reversalMove =
      ((afterDoubleShort.price - afterProfit.price) / afterProfit.price) * 100;
    console.log(`📉 REVERSAL CRASH: ${reversalMove.toFixed(2)}%!`);

    console.log("\n💰 PHASE 4: REVERSAL PROFITS");
    console.log("=============================");

    // Close massive short for profit
    if (massiveShortId) {
      console.log("💎 Closing MASSIVE short for REVERSAL PROFIT...");
      const closeShortTx = await vamm.closePosition(
        massiveShortId,
        ethers.parseUnits((baseCollateral * 1.2 * maxLeverage).toString(), 6),
        0,
        ethers.parseEther("10000")
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
          `✅ MASSIVE short closed at: $${shortExitPrice.toFixed(4)}`
        );
        console.log(`💰 REALIZED PROFIT: $${shortRealizedPnL.toFixed(2)}`);

        const shortPnlPercentage =
          ((massiveShortEntry - shortExitPrice) / massiveShortEntry) * 100;
        console.log(`📊 Return: ${shortPnlPercentage.toFixed(2)}%`);
        console.log(
          `🚀 ROI on Collateral: ${(
            (shortRealizedPnL / (baseCollateral * 1.2)) *
            100
          ).toFixed(2)}%`
        );

        totalProfit += shortRealizedPnL;
        tradeCount++;

        if (shortRealizedPnL > 0) {
          console.log(
            `🎉 MASSIVE REVERSAL PROFIT! $${shortRealizedPnL.toFixed(
              2
            )} GAINED! 🎉`
          );
        }
      }
    }

    const finalState = await showDetailedState("FINAL MARKET STATE");

    console.log("\n🎊 DRAMATIC PROFIT RESULTS 🎊");
    console.log("==============================");
    console.log(`💰 Total Realized Profit: $${totalProfit.toFixed(2)}`);
    console.log(`📊 Number of Profitable Trades: ${tradeCount}`);
    console.log(
      `🚀 Price Volatility Created: ${Math.abs(
        ((finalState.price - initialState.price) / initialState.price) * 100
      ).toFixed(2)}%`
    );
    console.log(
      `⚖️  Market Impact: $${Math.abs(
        finalState.netPosition - initialState.netPosition
      ).toFixed(0)}`
    );
    console.log(
      `💎 Margin Increase: $${(
        finalState.available - initialState.available
      ).toFixed(2)}`
    );

    if (totalProfit > 0) {
      console.log(`\n🎉 DRAMATICALLY PROFITABLE! 🎉`);
      console.log(
        `💎 Generated $${totalProfit.toFixed(
          2
        )} in profits through strategic trading!`
      );
      console.log(`🚀 This demonstrates the power of:`);
      console.log(`   • Momentum trading with high leverage`);
      console.log(`   • Strategic position sizing`);
      console.log(`   • Contrarian reversal strategies`);
      console.log(`   • Market impact and price discovery`);
    }

    console.log(
      `\n✅ DEMONSTRATION COMPLETE - Price movements and profits successfully generated!`
    );
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    throw error;
  }
}

main()
  .then(() => {
    console.log("\n✅ Dramatic profit demonstration completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
