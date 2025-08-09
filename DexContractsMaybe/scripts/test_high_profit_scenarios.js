const { ethers } = require("hardhat");

async function main() {
  console.log("💰 HIGH PROFIT SCENARIOS TEST");
  console.log("==============================\n");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("📋 Using account:", await deployer.getAddress());

  // Connect to deployed contracts
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

  // Utility functions
  function formatUSD(value, decimals = 6) {
    return parseFloat(ethers.formatUnits(value, decimals));
  }

  function formatPrice(value) {
    return parseFloat(ethers.formatEther(value));
  }

  async function getMarketState() {
    const price = await vamm.getMarkPrice();
    const summary = await vamm.getMarketSummary();
    return {
      price: formatPrice(price),
      totalLongs: formatUSD(summary.totalLongSizeUint),
      totalShorts: formatUSD(summary.totalShortSizeUint),
      netPosition: formatUSD(summary.netPositionSize),
    };
  }

  async function printMarketState(title) {
    const state = await getMarketState();
    console.log(`\n📊 ${title}`);
    console.log(`💰 Price: $${state.price.toFixed(4)}`);
    console.log(`📈 Net Position: $${state.netPosition.toFixed(0)}`);
    console.log(
      `⚖️  Longs: $${state.totalLongs.toFixed(
        0
      )} | Shorts: $${state.totalShorts.toFixed(0)}`
    );
    return state;
  }

  // Track all profits
  let totalProfit = 0;
  let tradeCount = 0;

  async function executeTradeSequence(name, trades) {
    console.log(`\n🎯 ${name}`);
    console.log("=".repeat(name.length + 4));

    const sequenceProfit = [];

    for (const trade of trades) {
      console.log(`\n📈 ${trade.description}`);

      // Open position
      const openTx = await vamm.openPosition(
        ethers.parseUnits(trade.collateral.toString(), 6),
        trade.isLong,
        trade.leverage,
        0,
        ethers.parseEther("10000")
      );

      const openReceipt = await openTx.wait();
      const openEvents = openReceipt.logs.filter((log) => {
        try {
          return vamm.interface.parseLog(log)?.name === "PositionOpened";
        } catch {
          return false;
        }
      });

      if (openEvents.length > 0) {
        const openEvent = vamm.interface.parseLog(openEvents[0]);
        const positionId = openEvent.args.positionId;
        const entryPrice = formatPrice(openEvent.args.price);
        const size = formatUSD(openEvent.args.size);

        console.log(
          `  ✅ Opened: Position ${positionId} | Size: $${size.toFixed(
            0
          )} | Entry: $${entryPrice.toFixed(4)}`
        );

        // Wait if specified
        if (trade.waitBeforeClose) {
          await new Promise((resolve) =>
            setTimeout(resolve, trade.waitBeforeClose)
          );
        }

        // Close position
        const closeTx = await vamm.closePosition(
          positionId,
          ethers.parseUnits(size.toString(), 6),
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
          const pnl = formatUSD(closeEvent.args.pnl);

          const pnlPercentage = trade.isLong
            ? ((exitPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - exitPrice) / entryPrice) * 100;

          console.log(
            `  💰 Closed: Exit: $${exitPrice.toFixed(4)} | PnL: $${pnl.toFixed(
              2
            )} (${pnlPercentage.toFixed(2)}%)`
          );

          sequenceProfit.push(pnl);
          totalProfit += pnl;
          tradeCount++;

          if (pnl > 0) {
            console.log(`  🎉 PROFIT! +$${pnl.toFixed(2)}`);
          } else {
            console.log(`  ❌ Loss: -$${Math.abs(pnl).toFixed(2)}`);
          }
        }
      }
    }

    const totalSequenceProfit = sequenceProfit.reduce((sum, p) => sum + p, 0);
    console.log(`\n📊 ${name} Total: $${totalSequenceProfit.toFixed(2)}`);

    return totalSequenceProfit;
  }

  try {
    // Ensure sufficient collateral
    const currentBalance = await vault.getCollateralBalance(
      await deployer.getAddress()
    );
    if (currentBalance < ethers.parseUnits("50000", 6)) {
      console.log(
        "💳 Depositing substantial collateral for high-profit tests..."
      );
      await usdc.approve(
        await vault.getAddress(),
        ethers.parseUnits("100000", 6)
      );
      await vault.depositCollateral(
        await deployer.getAddress(),
        ethers.parseUnits("100000", 6)
      );
      console.log("✅ Deposited $100,000 USDC for high-profit trading");
    }

    const initialState = await printMarketState("Initial Market State");

    // SCENARIO 1: Progressive Momentum Building
    await executeTradeSequence("PROGRESSIVE MOMENTUM BUILDING", [
      {
        description: "Small position to test waters",
        collateral: 500,
        isLong: true,
        leverage: 4,
        waitBeforeClose: 500,
      },
      {
        description: "Medium position to build momentum",
        collateral: 1000,
        isLong: true,
        leverage: 5,
        waitBeforeClose: 500,
      },
      {
        description: "Large position to capitalize on momentum",
        collateral: 2000,
        isLong: true,
        leverage: 6,
        waitBeforeClose: 500,
      },
      {
        description: "Huge position for maximum profit",
        collateral: 3000,
        isLong: true,
        leverage: 8,
        waitBeforeClose: 500,
      },
    ]);

    await printMarketState("After Momentum Building");

    // SCENARIO 2: Contrarian Reversal for Maximum Profits
    await executeTradeSequence("CONTRARIAN REVERSAL STRATEGY", [
      {
        description: "Large short to initiate reversal",
        collateral: 2500,
        isLong: false,
        leverage: 6,
        waitBeforeClose: 500,
      },
      {
        description: "Follow-up short to accelerate reversal",
        collateral: 2000,
        isLong: false,
        leverage: 7,
        waitBeforeClose: 500,
      },
      {
        description: "Massive short for maximum reversal profit",
        collateral: 4000,
        isLong: false,
        leverage: 10,
        waitBeforeClose: 500,
      },
      {
        description: "Final short squeeze for ultimate profit",
        collateral: 3000,
        isLong: false,
        leverage: 8,
        waitBeforeClose: 500,
      },
    ]);

    await printMarketState("After Contrarian Reversal");

    // SCENARIO 3: Volatility Exploitation
    console.log("\n🎯 VOLATILITY EXPLOITATION");
    console.log("===========================");

    // Create extreme volatility with large opposing positions
    console.log("\n📈 Creating EXTREME volatility with opposing forces...");

    const volatilityTrades = [];

    // Open large long
    const bigLongTx = await vamm.openPosition(
      ethers.parseUnits("5000", 6), // $5000 collateral
      true, // long
      10, // 10x leverage = $50000 position
      0,
      ethers.parseEther("10000")
    );
    let receipt = await bigLongTx.wait();
    let events = receipt.logs.filter((log) => {
      try {
        return vamm.interface.parseLog(log)?.name === "PositionOpened";
      } catch {
        return false;
      }
    });
    if (events.length > 0) {
      const event = vamm.interface.parseLog(events[0]);
      volatilityTrades.push({
        positionId: event.args.positionId,
        isLong: true,
        entryPrice: formatPrice(event.args.price),
        size: formatUSD(event.args.size),
      });
      console.log(
        `  ✅ MASSIVE LONG: $${formatUSD(event.args.size).toFixed(
          0
        )} at $${formatPrice(event.args.price).toFixed(4)}`
      );
    }

    await printMarketState("After Massive Long");

    // Counter with even larger short
    const bigShortTx = await vamm.openPosition(
      ethers.parseUnits("6000", 6), // $6000 collateral
      false, // short
      12, // 12x leverage = $72000 position
      0,
      ethers.parseEther("10000")
    );
    receipt = await bigShortTx.wait();
    events = receipt.logs.filter((log) => {
      try {
        return vamm.interface.parseLog(log)?.name === "PositionOpened";
      } catch {
        return false;
      }
    });
    if (events.length > 0) {
      const event = vamm.interface.parseLog(events[0]);
      volatilityTrades.push({
        positionId: event.args.positionId,
        isLong: false,
        entryPrice: formatPrice(event.args.price),
        size: formatUSD(event.args.size),
      });
      console.log(
        `  ✅ MASSIVE SHORT: $${formatUSD(event.args.size).toFixed(
          0
        )} at $${formatPrice(event.args.price).toFixed(4)}`
      );
    }

    await printMarketState("After Massive Short");

    // Close positions for maximum volatility profit
    console.log("\n💰 Closing volatility positions for profit...");
    for (const trade of volatilityTrades) {
      const closeTx = await vamm.closePosition(
        trade.positionId,
        ethers.parseUnits(trade.size.toString(), 6),
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
        const pnl = formatUSD(closeEvent.args.pnl);

        console.log(
          `  💰 ${trade.isLong ? "LONG" : "SHORT"} Exit: $${exitPrice.toFixed(
            4
          )} | PnL: $${pnl.toFixed(2)}`
        );
        totalProfit += pnl;
        tradeCount++;
      }
    }

    // SCENARIO 4: Maximum Leverage Exploitation
    await executeTradeSequence("MAXIMUM LEVERAGE EXPLOITATION", [
      {
        description: "Ultra-high leverage long for extreme profits",
        collateral: 2000,
        isLong: true,
        leverage: 15,
        waitBeforeClose: 500,
      },
      {
        description: "Follow-up ultra-leverage for compounding",
        collateral: 2500,
        isLong: true,
        leverage: 18,
        waitBeforeClose: 500,
      },
      {
        description: "Maximum leverage position for ultimate profit",
        collateral: 3000,
        isLong: true,
        leverage: 20,
        waitBeforeClose: 500,
      },
    ]);

    // SCENARIO 5: Systematic Profit Extraction
    console.log("\n🎯 SYSTEMATIC PROFIT EXTRACTION");
    console.log("================================");
    console.log("Multiple smaller trades to systematically extract profit\n");

    let extractionProfit = 0;
    const extractionTrades = 8;

    for (let i = 1; i <= extractionTrades; i++) {
      console.log(`📈 Extraction Trade ${i}/${extractionTrades}`);

      const direction = i % 2 === 1; // Alternate long/short
      const collateral = 1000 + i * 200; // Increasing size
      const leverage = 5 + i; // Increasing leverage

      const openTx = await vamm.openPosition(
        ethers.parseUnits(collateral.toString(), 6),
        direction,
        leverage,
        0,
        ethers.parseEther("10000")
      );

      const openReceipt = await openTx.wait();
      const openEvents = openReceipt.logs.filter((log) => {
        try {
          return vamm.interface.parseLog(log)?.name === "PositionOpened";
        } catch {
          return false;
        }
      });

      if (openEvents.length > 0) {
        const openEvent = vamm.interface.parseLog(openEvents[0]);
        const positionId = openEvent.args.positionId;

        // Immediate close for quick profit
        const closeTx = await vamm.closePosition(
          positionId,
          openEvent.args.size,
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
          const pnl = formatUSD(closeEvent.args.pnl);

          console.log(
            `  💰 ${direction ? "LONG" : "SHORT"} Trade ${i}: $${pnl.toFixed(
              2
            )}`
          );
          extractionProfit += pnl;
          totalProfit += pnl;
          tradeCount++;
        }
      }
    }

    console.log(
      `\n📊 Systematic Extraction Total: $${extractionProfit.toFixed(2)}`
    );

    // Final Results
    const finalState = await printMarketState("Final Market State");

    console.log("\n🎊 HIGH PROFIT SCENARIOS RESULTS 🎊");
    console.log("=====================================");
    console.log(`💰 Total Profit: $${totalProfit.toFixed(2)}`);
    console.log(`📊 Total Trades: ${tradeCount}`);
    console.log(
      `📈 Average Profit per Trade: $${(totalProfit / tradeCount).toFixed(2)}`
    );
    console.log(
      `🚀 Price Change: ${(
        ((finalState.price - initialState.price) / initialState.price) *
        100
      ).toFixed(2)}%`
    );
    console.log(
      `⚡ Market Impact: $${(
        finalState.netPosition - initialState.netPosition
      ).toFixed(0)}`
    );

    if (totalProfit > 0) {
      console.log("\n🎉 HIGHLY PROFITABLE TEST SUITE! ✅");
      console.log(
        `💎 Profit Efficiency: ${((totalProfit / 50000) * 100).toFixed(
          2
        )}% of initial capital`
      );
    } else {
      console.log("\n📊 Mixed results - normal for high-risk trading");
    }
  } catch (error) {
    console.error("❌ High profit scenarios test failed:", error);
    throw error;
  }
}

main()
  .then(() => {
    console.log("\n✅ High profit scenarios test completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
