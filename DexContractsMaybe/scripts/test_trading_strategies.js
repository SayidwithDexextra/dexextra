const { ethers } = require("hardhat");

async function main() {
  console.log("📊 TRADING STRATEGIES TEST SUITE");
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

  const SimpleVault = await ethers.getContractFactory("SimpleVault");
  const vault = SimpleVault.attach(deployedAddresses.vault);

  const SimpleVAMM = await ethers.getContractFactory("SimpleVAMM");
  const vamm = SimpleVAMM.attach(deployedAddresses.vamm);

  console.log("✅ Connected to deployed contracts\n");

  // Trading utilities
  class TradingBot {
    constructor(vamm, vault) {
      this.vamm = vamm;
      this.vault = vault;
      this.trades = [];
      this.totalPnL = 0;
    }

    async getMarketState() {
      const price = await this.vamm.getMarkPrice();
      const summary = await this.vamm.getMarketSummary();
      return {
        price: parseFloat(ethers.formatEther(price)),
        totalLongs: parseFloat(
          ethers.formatUnits(summary.totalLongSizeUint, 6)
        ),
        totalShorts: parseFloat(
          ethers.formatUnits(summary.totalShortSizeUint, 6)
        ),
        netPosition: parseFloat(ethers.formatUnits(summary.netPositionSize, 6)),
      };
    }

    async openTrade(collateral, isLong, leverage, strategy) {
      console.log(
        `🎯 ${strategy}: Opening ${
          isLong ? "LONG" : "SHORT"
        } - $${ethers.formatUnits(collateral, 6)} @ ${leverage}x`
      );

      const stateBefore = await this.getMarketState();

      const tx = await this.vamm.openPosition(
        collateral,
        isLong,
        leverage,
        0,
        ethers.parseEther("10000")
      );

      const receipt = await tx.wait();
      const events = receipt.logs.filter((log) => {
        try {
          return this.vamm.interface.parseLog(log)?.name === "PositionOpened";
        } catch {
          return false;
        }
      });

      if (events.length > 0) {
        const event = this.vamm.interface.parseLog(events[0]);
        const trade = {
          positionId: event.args.positionId,
          strategy,
          isLong,
          entryPrice: parseFloat(ethers.formatEther(event.args.price)),
          size: parseFloat(ethers.formatUnits(event.args.size, 6)),
          leverage: event.args.leverage,
          timestamp: Date.now(),
        };

        this.trades.push(trade);

        const stateAfter = await this.getMarketState();
        console.log(
          `  📈 Entry: $${trade.entryPrice.toFixed(
            4
          )} | Size: $${trade.size.toFixed(0)}`
        );
        console.log(
          `  📊 Price Impact: $${stateBefore.price.toFixed(
            4
          )} → $${stateAfter.price.toFixed(4)} (${(
            ((stateAfter.price - stateBefore.price) / stateBefore.price) *
            100
          ).toFixed(2)}%)`
        );

        return trade;
      }

      return null;
    }

    async closeTrade(trade, reason = "Strategy Exit") {
      console.log(
        `🎯 ${trade.strategy}: ${reason} - Closing Position ${trade.positionId}`
      );

      const stateBefore = await this.getMarketState();

      const tx = await this.vamm.closePosition(
        trade.positionId,
        ethers.parseUnits(trade.size.toString(), 6),
        0,
        ethers.parseEther("10000")
      );

      const receipt = await tx.wait();
      const events = receipt.logs.filter((log) => {
        try {
          return this.vamm.interface.parseLog(log)?.name === "PositionClosed";
        } catch {
          return false;
        }
      });

      if (events.length > 0) {
        const event = this.vamm.interface.parseLog(events[0]);
        const exitPrice = parseFloat(ethers.formatEther(event.args.price));
        const pnl = parseFloat(ethers.formatUnits(event.args.pnl, 6));

        trade.exitPrice = exitPrice;
        trade.pnl = pnl;
        trade.pnlPercentage = trade.isLong
          ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;

        this.totalPnL += pnl;

        const stateAfter = await this.getMarketState();
        console.log(
          `  📉 Exit: $${exitPrice.toFixed(4)} | PnL: $${pnl.toFixed(
            2
          )} (${trade.pnlPercentage.toFixed(2)}%)`
        );
        console.log(
          `  📊 Price Impact: $${stateBefore.price.toFixed(
            4
          )} → $${stateAfter.price.toFixed(4)} (${(
            ((stateAfter.price - stateBefore.price) / stateBefore.price) *
            100
          ).toFixed(2)}%)`
        );

        return trade;
      }

      return null;
    }

    async getUnrealizedPnL(trade) {
      const currentState = await this.getMarketState();
      const unrealizedPnLWei = await this.vamm.getUnrealizedPnL(
        trade.positionId
      );
      const unrealizedPnL = parseFloat(ethers.formatUnits(unrealizedPnLWei, 6));

      return {
        currentPrice: currentState.price,
        unrealizedPnL,
        unrealizedPnLPercentage: trade.isLong
          ? ((currentState.price - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - currentState.price) / trade.entryPrice) * 100,
      };
    }

    printSummary() {
      console.log("\n📊 TRADING SUMMARY");
      console.log("===================");
      console.log(`Total Trades: ${this.trades.length}`);
      console.log(`Total PnL: $${this.totalPnL.toFixed(2)}`);

      const winningTrades = this.trades.filter((t) => t.pnl && t.pnl > 0);
      const losingTrades = this.trades.filter((t) => t.pnl && t.pnl < 0);

      console.log(
        `Winning Trades: ${winningTrades.length} (${(
          (winningTrades.length /
            this.trades.filter((t) => t.pnl !== undefined).length) *
          100
        ).toFixed(1)}%)`
      );
      console.log(
        `Losing Trades: ${losingTrades.length} (${(
          (losingTrades.length /
            this.trades.filter((t) => t.pnl !== undefined).length) *
          100
        ).toFixed(1)}%)`
      );

      if (winningTrades.length > 0) {
        const avgWin =
          winningTrades.reduce((sum, t) => sum + t.pnl, 0) /
          winningTrades.length;
        console.log(`Average Win: $${avgWin.toFixed(2)}`);
      }

      if (losingTrades.length > 0) {
        const avgLoss =
          losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length;
        console.log(`Average Loss: $${avgLoss.toFixed(2)}`);
      }
    }
  }

  try {
    // Ensure sufficient collateral
    const currentBalance = await vault.getCollateralBalance(
      await deployer.getAddress()
    );
    if (currentBalance < ethers.parseUnits("20000", 6)) {
      console.log("💳 Depositing collateral for trading strategies...");
      await usdc.approve(
        await vault.getAddress(),
        ethers.parseUnits("30000", 6)
      );
      await vault.depositCollateral(
        await deployer.getAddress(),
        ethers.parseUnits("30000", 6)
      );
      console.log("✅ Deposited $30,000 USDC for trading");
    }

    const bot = new TradingBot(vamm, vault);

    // Initial market state
    const initialState = await bot.getMarketState();
    console.log(`📊 Initial Market State: $${initialState.price.toFixed(4)}`);
    console.log(`   Net Position: $${initialState.netPosition.toFixed(0)}\n`);

    console.log("🎯 STRATEGY 1: MOMENTUM SCALPING");
    console.log("================================");
    console.log("Creating momentum, then riding the wave for quick profits\n");

    // Create initial momentum with a medium position
    const momentumTrade1 = await bot.openTrade(
      ethers.parseUnits("800", 6), // $800 collateral
      true, // long
      4, // 4x leverage = $3200 position
      "Momentum Builder"
    );

    // Ride the momentum with a quick scalp
    const scalpTrade1 = await bot.openTrade(
      ethers.parseUnits("400", 6), // $400 collateral
      true, // same direction
      5, // 5x leverage = $2000 position
      "Momentum Scalp"
    );

    // Quick exit on the scalp for profit
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate time
    await bot.closeTrade(scalpTrade1, "Quick Scalp Exit");

    // Let momentum build more, then exit
    const bigMomentumTrade = await bot.openTrade(
      ethers.parseUnits("600", 6), // $600 collateral
      true, // same direction
      6, // 6x leverage = $3600 position
      "Big Momentum"
    );

    // Exit the momentum trades
    await bot.closeTrade(momentumTrade1, "Momentum Exit");
    await bot.closeTrade(bigMomentumTrade, "Big Momentum Exit");

    console.log("\n🎯 STRATEGY 2: CONTRARIAN REVERSAL");
    console.log("===================================");
    console.log("Betting against the current trend for reversal profits\n");

    // Open contrarian positions (short after the longs pushed price up)
    const contrarian1 = await bot.openTrade(
      ethers.parseUnits("1000", 6), // $1000 collateral
      false, // short (contrarian)
      5, // 5x leverage = $5000 position
      "Contrarian Reversal"
    );

    // Double down on reversal
    const contrarian2 = await bot.openTrade(
      ethers.parseUnits("800", 6), // $800 collateral
      false, // short
      4, // 4x leverage = $3200 position
      "Double Down Reversal"
    );

    // Force the reversal with a big position
    const contrarian3 = await bot.openTrade(
      ethers.parseUnits("1200", 6), // $1200 collateral
      false, // short
      6, // 6x leverage = $7200 position
      "Force Reversal"
    );

    // Exit contrarian trades for profit
    await bot.closeTrade(contrarian1, "Reversal Profit 1");
    await bot.closeTrade(contrarian2, "Reversal Profit 2");
    await bot.closeTrade(contrarian3, "Reversal Profit 3");

    console.log("\n🎯 STRATEGY 3: VOLATILITY ARBITRAGE");
    console.log("====================================");
    console.log("Creating volatility and profiting from price swings\n");

    // Create volatility by opening opposing positions
    const volLong = await bot.openTrade(
      ethers.parseUnits("1500", 6), // $1500 collateral
      true, // long
      4, // 4x leverage = $6000 position
      "Volatility Long"
    );

    // Immediately counter with short to create swing
    const volShort = await bot.openTrade(
      ethers.parseUnits("2000", 6), // $2000 collateral
      false, // short
      5, // 5x leverage = $10000 position
      "Volatility Short"
    );

    // Check unrealized PnL
    const longPnL = await bot.getUnrealizedPnL(volLong);
    const shortPnL = await bot.getUnrealizedPnL(volShort);

    console.log(`📊 Volatility Check:`);
    console.log(
      `   Long PnL: $${longPnL.unrealizedPnL.toFixed(
        2
      )} (${longPnL.unrealizedPnLPercentage.toFixed(2)}%)`
    );
    console.log(
      `   Short PnL: $${shortPnL.unrealizedPnL.toFixed(
        2
      )} (${shortPnL.unrealizedPnLPercentage.toFixed(2)}%)`
    );

    // Exit profitable position first
    if (longPnL.unrealizedPnL > shortPnL.unrealizedPnL) {
      await bot.closeTrade(volLong, "Volatility Profit - Long");
      await bot.closeTrade(volShort, "Volatility Exit - Short");
    } else {
      await bot.closeTrade(volShort, "Volatility Profit - Short");
      await bot.closeTrade(volLong, "Volatility Exit - Long");
    }

    console.log("\n🎯 STRATEGY 4: MEAN REVERSION");
    console.log("==============================");
    console.log("Betting on price returning to equilibrium\n");

    const currentState = await bot.getMarketState();
    console.log(`Current Price: $${currentState.price.toFixed(4)}`);
    console.log(`Net Position: $${currentState.netPosition.toFixed(0)}`);

    // If we're heavily skewed, bet on reversion
    let reversionDirection;
    if (currentState.netPosition > 1000) {
      reversionDirection = false; // short to bring it back
      console.log("📉 Market is overbought - going SHORT for mean reversion");
    } else if (currentState.netPosition < -1000) {
      reversionDirection = true; // long to bring it back
      console.log("📈 Market is oversold - going LONG for mean reversion");
    } else {
      // Force a skew, then revert
      await bot.openTrade(
        ethers.parseUnits("2000", 6), // $2000 collateral
        true, // long to create skew
        5, // 5x leverage = $10000 position
        "Create Skew"
      );
      reversionDirection = false; // then short to revert
      console.log("📊 Created skew, now reverting with SHORT");
    }

    const meanReversion1 = await bot.openTrade(
      ethers.parseUnits("1500", 6), // $1500 collateral
      reversionDirection,
      6, // 6x leverage
      "Mean Reversion 1"
    );

    const meanReversion2 = await bot.openTrade(
      ethers.parseUnits("1200", 6), // $1200 collateral
      reversionDirection,
      5, // 5x leverage
      "Mean Reversion 2"
    );

    // Exit mean reversion trades
    await bot.closeTrade(meanReversion1, "Mean Reversion Profit 1");
    await bot.closeTrade(meanReversion2, "Mean Reversion Profit 2");

    console.log("\n🎯 STRATEGY 5: LEVERAGE EFFICIENCY TEST");
    console.log("=======================================");
    console.log("Testing optimal leverage for maximum profit efficiency\n");

    // Test different leverage levels with same direction
    const leverage2x = await bot.openTrade(
      ethers.parseUnits("1000", 6), // $1000 collateral
      true, // long
      2, // 2x leverage = $2000 position
      "Low Leverage Test"
    );

    const leverage5x = await bot.openTrade(
      ethers.parseUnits("400", 6), // $400 collateral
      true, // long
      5, // 5x leverage = $2000 position (same size)
      "Medium Leverage Test"
    );

    const leverage10x = await bot.openTrade(
      ethers.parseUnits("200", 6), // $200 collateral
      true, // long
      10, // 10x leverage = $2000 position (same size)
      "High Leverage Test"
    );

    // Add one more position to drive price up
    await bot.openTrade(ethers.parseUnits("500", 6), true, 4, "Price Driver");

    // Exit in order and compare efficiency
    await bot.closeTrade(leverage2x, "Low Leverage Exit");
    await bot.closeTrade(leverage5x, "Medium Leverage Exit");
    await bot.closeTrade(leverage10x, "High Leverage Exit");

    // Final summary
    const finalState = await bot.getMarketState();
    console.log(`\n📊 Final Market State: $${finalState.price.toFixed(4)}`);
    console.log(
      `   Price Change: ${(
        ((finalState.price - initialState.price) / initialState.price) *
        100
      ).toFixed(2)}%`
    );
    console.log(`   Net Position: $${finalState.netPosition.toFixed(0)}`);

    bot.printSummary();

    console.log("\n🎊 ALL TRADING STRATEGIES COMPLETED! 🎊");
  } catch (error) {
    console.error("❌ Trading strategies test failed:", error);
    throw error;
  }
}

main()
  .then(() => {
    console.log("\n✅ Trading strategies test completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
