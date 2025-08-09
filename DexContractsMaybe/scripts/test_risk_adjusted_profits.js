const { ethers } = require("hardhat");

async function main() {
  console.log("⚖️ RISK-ADJUSTED PROFIT STRATEGIES");
  console.log("===================================\n");

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

  // Risk-adjusted trading framework
  class RiskManagedTrader {
    constructor(vamm, vault) {
      this.vamm = vamm;
      this.vault = vault;
      this.positions = [];
      this.totalPnL = 0;
      this.totalRisk = 0;
      this.winRate = 0;
      this.trades = 0;
      this.wins = 0;
    }

    formatUSD(value, decimals = 6) {
      return parseFloat(ethers.formatUnits(value, decimals));
    }

    formatPrice(value) {
      return parseFloat(ethers.formatEther(value));
    }

    async getMarketMetrics() {
      const price = await this.vamm.getMarkPrice();
      const summary = await this.vamm.getMarketSummary();

      return {
        price: this.formatPrice(price),
        netPosition: this.formatUSD(summary.netPositionSize),
        totalLongs: this.formatUSD(summary.totalLongSizeUint),
        totalShorts: this.formatUSD(summary.totalShortSizeUint),
        imbalance: Math.abs(this.formatUSD(summary.netPositionSize)),
      };
    }

    calculateRiskScore(collateral, leverage, marketMetrics) {
      // Risk factors:
      // 1. Position size relative to market
      // 2. Leverage used
      // 3. Market imbalance
      // 4. Current volatility (implied by recent movements)

      const positionSize = collateral * leverage;
      const marketSize = marketMetrics.totalLongs + marketMetrics.totalShorts;
      const sizeRisk = marketSize > 0 ? (positionSize / marketSize) * 100 : 0;
      const leverageRisk = (leverage / 20) * 100; // Normalized to max leverage
      const imbalanceRisk = (marketMetrics.imbalance / 10000) * 100; // Normalized to $10k

      const totalRisk =
        sizeRisk * 0.3 + leverageRisk * 0.4 + imbalanceRisk * 0.3;
      return Math.min(totalRisk, 100); // Cap at 100%
    }

    async calculateOptimalPosition(direction, maxRisk = 15) {
      const marketMetrics = await this.getMarketMetrics();

      // Start with base parameters
      let collateral = 500;
      let leverage = 3;
      let riskScore = this.calculateRiskScore(
        collateral,
        leverage,
        marketMetrics
      );

      // Optimize for maximum size within risk tolerance
      while (riskScore < maxRisk && leverage < 15) {
        if (riskScore < maxRisk * 0.7) {
          collateral += 200;
        } else {
          leverage += 1;
        }
        riskScore = this.calculateRiskScore(
          collateral,
          leverage,
          marketMetrics
        );
      }

      return { collateral, leverage, riskScore };
    }

    async executeManagedTrade(strategy, direction, riskLevel = "medium") {
      const marketMetrics = await this.getMarketMetrics();

      // Risk levels
      const riskLimits = {
        conservative: 10,
        medium: 15,
        aggressive: 25,
      };

      const maxRisk = riskLimits[riskLevel] || 15;
      const optimal = await this.calculateOptimalPosition(direction, maxRisk);

      console.log(`\n🎯 ${strategy} (${riskLevel.toUpperCase()} risk)`);
      console.log(
        `📊 Market Price: $${marketMetrics.price.toFixed(
          4
        )} | Imbalance: $${marketMetrics.imbalance.toFixed(0)}`
      );
      console.log(
        `⚖️  Risk Score: ${optimal.riskScore.toFixed(1)}% | Collateral: $${
          optimal.collateral
        } | Leverage: ${optimal.leverage}x`
      );

      try {
        // Open position
        const openTx = await this.vamm.openPosition(
          ethers.parseUnits(optimal.collateral.toString(), 6),
          direction,
          optimal.leverage,
          0,
          ethers.parseEther("10000")
        );

        const openReceipt = await openTx.wait();
        const openEvents = openReceipt.logs.filter((log) => {
          try {
            return this.vamm.interface.parseLog(log)?.name === "PositionOpened";
          } catch {
            return false;
          }
        });

        if (openEvents.length > 0) {
          const openEvent = this.vamm.interface.parseLog(openEvents[0]);
          const position = {
            id: openEvent.args.positionId,
            strategy,
            isLong: direction,
            entryPrice: this.formatPrice(openEvent.args.price),
            size: this.formatUSD(openEvent.args.size),
            collateral: optimal.collateral,
            leverage: optimal.leverage,
            riskScore: optimal.riskScore,
            entryTime: Date.now(),
          };

          this.positions.push(position);
          console.log(
            `✅ Opened Position ${position.id}: $${position.size.toFixed(
              0
            )} at $${position.entryPrice.toFixed(4)}`
          );

          return position;
        }
      } catch (error) {
        console.log(`❌ Failed to open position: ${error.message}`);
        return null;
      }
    }

    async closePositionWithStops(
      position,
      profitTarget = 0.05,
      stopLoss = 0.03
    ) {
      try {
        const currentMarket = await this.getMarketMetrics();
        const currentPrice = currentMarket.price;

        // Calculate current PnL percentage
        let pnlPercentage;
        if (position.isLong) {
          pnlPercentage =
            (currentPrice - position.entryPrice) / position.entryPrice;
        } else {
          pnlPercentage =
            (position.entryPrice - currentPrice) / position.entryPrice;
        }

        let reason = "Manual Close";
        if (pnlPercentage >= profitTarget) {
          reason = "Profit Target Hit";
        } else if (pnlPercentage <= -stopLoss) {
          reason = "Stop Loss Hit";
        }

        console.log(`\n💰 Closing Position ${position.id}: ${reason}`);
        console.log(`📊 Current PnL: ${(pnlPercentage * 100).toFixed(2)}%`);

        const closeTx = await this.vamm.closePosition(
          position.id,
          ethers.parseUnits(position.size.toString(), 6),
          0,
          ethers.parseEther("10000")
        );

        const closeReceipt = await closeTx.wait();
        const closeEvents = closeReceipt.logs.filter((log) => {
          try {
            return this.vamm.interface.parseLog(log)?.name === "PositionClosed";
          } catch {
            return false;
          }
        });

        if (closeEvents.length > 0) {
          const closeEvent = this.vamm.interface.parseLog(closeEvents[0]);
          const exitPrice = this.formatPrice(closeEvent.args.price);
          const realizedPnL = this.formatUSD(closeEvent.args.pnl);

          position.exitPrice = exitPrice;
          position.realizedPnL = realizedPnL;
          position.closeReason = reason;

          this.totalPnL += realizedPnL;
          this.totalRisk += position.riskScore;
          this.trades++;

          if (realizedPnL > 0) {
            this.wins++;
          }

          this.winRate = (this.wins / this.trades) * 100;

          console.log(
            `✅ Closed at $${exitPrice.toFixed(
              4
            )} | PnL: $${realizedPnL.toFixed(2)} | Risk-Adjusted Return: ${(
              (realizedPnL / position.riskScore) *
              100
            ).toFixed(2)}%`
          );

          return position;
        }
      } catch (error) {
        console.log(`❌ Failed to close position: ${error.message}`);
        return null;
      }
    }

    printRiskMetrics() {
      console.log("\n📊 RISK-ADJUSTED PERFORMANCE METRICS");
      console.log("======================================");
      console.log(`💰 Total PnL: $${this.totalPnL.toFixed(2)}`);
      console.log(`📈 Win Rate: ${this.winRate.toFixed(1)}%`);
      console.log(
        `⚖️  Average Risk per Trade: ${(this.totalRisk / this.trades).toFixed(
          1
        )}%`
      );
      console.log(
        `🎯 Risk-Adjusted Return: ${(
          (this.totalPnL / this.totalRisk) *
          100
        ).toFixed(2)}%`
      );
      console.log(
        `📊 Sharpe-like Ratio: ${(
          this.totalPnL /
          (this.totalRisk / 100)
        ).toFixed(2)}`
      );

      const profitableTrades = this.positions.filter((p) => p.realizedPnL > 0);
      const losingTrades = this.positions.filter((p) => p.realizedPnL < 0);

      if (profitableTrades.length > 0) {
        const avgWin =
          profitableTrades.reduce((sum, p) => sum + p.realizedPnL, 0) /
          profitableTrades.length;
        console.log(`📈 Average Win: $${avgWin.toFixed(2)}`);
      }

      if (losingTrades.length > 0) {
        const avgLoss =
          Math.abs(losingTrades.reduce((sum, p) => sum + p.realizedPnL, 0)) /
          losingTrades.length;
        console.log(`📉 Average Loss: $${avgLoss.toFixed(2)}`);

        if (profitableTrades.length > 0) {
          const avgWin =
            profitableTrades.reduce((sum, p) => sum + p.realizedPnL, 0) /
            profitableTrades.length;
          console.log(
            `🎯 Risk/Reward Ratio: ${(avgWin / avgLoss).toFixed(2)}:1`
          );
        }
      }
    }
  }

  try {
    // Ensure sufficient collateral
    const currentBalance = await vault.getCollateralBalance(
      await deployer.getAddress()
    );
    if (currentBalance < ethers.parseUnits("25000", 6)) {
      console.log("💳 Depositing collateral for risk-managed trading...");
      await usdc.approve(
        await vault.getAddress(),
        ethers.parseUnits("50000", 6)
      );
      await vault.depositCollateral(
        await deployer.getAddress(),
        ethers.parseUnits("50000", 6)
      );
      console.log("✅ Deposited $50,000 USDC for risk-managed trading");
    }

    const trader = new RiskManagedTrader(vamm, vault);
    const initialMetrics = await trader.getMarketMetrics();

    console.log("📊 Initial Market State:");
    console.log(`💰 Price: $${initialMetrics.price.toFixed(4)}`);
    console.log(`📈 Net Position: $${initialMetrics.netPosition.toFixed(0)}`);
    console.log(
      `⚖️  Market Imbalance: $${initialMetrics.imbalance.toFixed(0)}\n`
    );

    console.log("🎯 STRATEGY 1: CONSERVATIVE MOMENTUM");
    console.log("====================================");

    // Conservative momentum trades with strict risk management
    const momentum1 = await trader.executeManagedTrade(
      "Conservative Momentum 1",
      true,
      "conservative"
    );
    if (momentum1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const momentum2 = await trader.executeManagedTrade(
        "Conservative Momentum 2",
        true,
        "conservative"
      );
      if (momentum2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Close with tight profit targets
        await trader.closePositionWithStops(momentum1, 0.03, 0.015); // 3% profit, 1.5% stop
        await trader.closePositionWithStops(momentum2, 0.03, 0.015);
      }
    }

    console.log("\n🎯 STRATEGY 2: MEDIUM-RISK REVERSAL");
    console.log("====================================");

    // Medium risk reversal trades
    const reversal1 = await trader.executeManagedTrade(
      "Medium Risk Reversal 1",
      false,
      "medium"
    );
    if (reversal1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const reversal2 = await trader.executeManagedTrade(
        "Medium Risk Reversal 2",
        false,
        "medium"
      );
      if (reversal2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Close with medium profit targets
        await trader.closePositionWithStops(reversal1, 0.05, 0.025); // 5% profit, 2.5% stop
        await trader.closePositionWithStops(reversal2, 0.05, 0.025);
      }
    }

    console.log("\n🎯 STRATEGY 3: AGGRESSIVE SCALPING");
    console.log("===================================");

    // Aggressive but quick scalping trades
    for (let i = 1; i <= 5; i++) {
      const direction = i % 2 === 1; // Alternate directions
      const scalp = await trader.executeManagedTrade(
        `Aggressive Scalp ${i}`,
        direction,
        "aggressive"
      );

      if (scalp) {
        await new Promise((resolve) => setTimeout(resolve, 500)); // Quick close
        await trader.closePositionWithStops(scalp, 0.02, 0.01); // 2% profit, 1% stop - quick scalp
      }
    }

    console.log("\n🎯 STRATEGY 4: RISK-PARITY HEDGING");
    console.log("===================================");

    // Open hedged positions with equal risk
    const hedge1 = await trader.executeManagedTrade(
      "Risk Parity Long",
      true,
      "medium"
    );
    if (hedge1) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const hedge2 = await trader.executeManagedTrade(
        "Risk Parity Short",
        false,
        "medium"
      );
      if (hedge2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Close the profitable leg first
        const market = await trader.getMarketMetrics();
        const longPnL = hedge1.isLong
          ? (market.price - hedge1.entryPrice) / hedge1.entryPrice
          : (hedge1.entryPrice - market.price) / hedge1.entryPrice;
        const shortPnL = hedge2.isLong
          ? (market.price - hedge2.entryPrice) / hedge2.entryPrice
          : (hedge2.entryPrice - market.price) / hedge2.entryPrice;

        if (longPnL > shortPnL) {
          await trader.closePositionWithStops(hedge1, 0.03, 0.02);
          await trader.closePositionWithStops(hedge2, 0.03, 0.02);
        } else {
          await trader.closePositionWithStops(hedge2, 0.03, 0.02);
          await trader.closePositionWithStops(hedge1, 0.03, 0.02);
        }
      }
    }

    console.log("\n🎯 STRATEGY 5: DYNAMIC RISK ADJUSTMENT");
    console.log("=======================================");

    // Adjust risk based on current market conditions
    const finalMetrics = await trader.getMarketMetrics();
    let riskLevel = "medium";

    if (finalMetrics.imbalance > 5000) {
      riskLevel = "conservative";
      console.log(
        "📊 High market imbalance detected - using CONSERVATIVE risk"
      );
    } else if (finalMetrics.imbalance < 1000) {
      riskLevel = "aggressive";
      console.log("📊 Low market imbalance detected - using AGGRESSIVE risk");
    } else {
      console.log("📊 Normal market conditions - using MEDIUM risk");
    }

    const dynamic1 = await trader.executeManagedTrade(
      "Dynamic Risk 1",
      true,
      riskLevel
    );
    if (dynamic1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const dynamic2 = await trader.executeManagedTrade(
        "Dynamic Risk 2",
        false,
        riskLevel
      );
      if (dynamic2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Use dynamic profit targets based on risk level
        const profitTarget =
          riskLevel === "conservative"
            ? 0.025
            : riskLevel === "medium"
            ? 0.04
            : 0.06;
        const stopLoss = profitTarget * 0.5;

        await trader.closePositionWithStops(dynamic1, profitTarget, stopLoss);
        await trader.closePositionWithStops(dynamic2, profitTarget, stopLoss);
      }
    }

    // Final analysis
    const endMetrics = await trader.getMarketMetrics();

    console.log("\n📊 FINAL MARKET ANALYSIS");
    console.log("=========================");
    console.log(
      `🚀 Price Change: ${(
        ((endMetrics.price - initialMetrics.price) / initialMetrics.price) *
        100
      ).toFixed(2)}%`
    );
    console.log(
      `⚖️  Net Position Change: $${(
        endMetrics.netPosition - initialMetrics.netPosition
      ).toFixed(0)}`
    );
    console.log(
      `📊 Market Efficiency: ${(
        (endMetrics.imbalance /
          Math.max(endMetrics.totalLongs, endMetrics.totalShorts)) *
        100
      ).toFixed(1)}%`
    );

    trader.printRiskMetrics();

    console.log("\n🎊 RISK-ADJUSTED TRADING COMPLETE! 🎊");

    if (trader.totalPnL > 0 && trader.winRate > 60) {
      console.log("✅ EXCELLENT RISK-MANAGED PERFORMANCE!");
      console.log(
        `💎 Achieved positive returns with ${trader.winRate.toFixed(
          1
        )}% win rate`
      );
    } else if (trader.totalPnL > 0) {
      console.log("✅ PROFITABLE RISK-MANAGED TRADING!");
    } else {
      console.log("📊 Mixed results - risk management prevented major losses");
    }
  } catch (error) {
    console.error("❌ Risk-adjusted trading test failed:", error);
    throw error;
  }
}

main()
  .then(() => {
    console.log("\n✅ Risk-adjusted profit strategies test completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
