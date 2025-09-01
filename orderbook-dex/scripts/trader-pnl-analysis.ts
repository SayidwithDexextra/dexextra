import { ethers } from "hardhat";

interface TraderPnLData {
  address: string;
  name: string;
  realizedPnL: string;
  unrealizedPnL: string;
  totalPnL: string;
  totalVolume: string;
  totalFees: string;
  totalTrades: number;
  activeOrders: number;
  averageTradeSize: string;
  winRate: string;
  largestWin: string;
  largestLoss: string;
  roi: string;
}

interface OrderSummary {
  orderId: number;
  side: string;
  quantity: string;
  price: string;
  filledQuantity: string;
  status: string;
  timestamp: string;
}

interface TradingSummary {
  totalTraders: number;
  totalVolume: string;
  totalPnL: string;
  totalFees: string;
  mostProfitable: { name: string; pnl: string };
  leastProfitable: { name: string; pnl: string };
  highestVolume: { name: string; volume: string };
  systemHealth: string;
}

async function analyzeAllTradersPnL() {
  console.log('📊 COMPREHENSIVE TRADER P&L ANALYSIS');
  console.log('='.repeat(80));
  console.log('💰 Analyzing profit/loss for all 10 traders from total trades');
  console.log('='.repeat(80));

  // Contract addresses
  const contracts = {
    mockUSDC: "0x3371ce5d3164ABf183C676e2FC987597e8191892",
    centralVault: "0xc94fb667207206eEe88C203B4dF56Be99a30c8Ea",
    orderRouter: "0xFBd6B734109567937d1d9F1a41Ce86f8d6632BF2",
    orderBook: "0x1FCccd6827eAc7cA1c18596A6ed52A8B1b51f195"
  };

  const signers = await ethers.getSigners();
  const traderNames = [
    "🐋 Whale Trader",
    "🏦 Institution A", 
    "🏛️ Institution B",
    "📈 High Volume Trader",
    "💼 Market Maker",
    "🎯 Arbitrageur",
    "⚡ Speed Trader",
    "🎢 Volatility Trader", 
    "🎪 Stress Tester",
    "🔬 Edge Case Tester"
  ];

  // Get contract instances
  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const CentralVault = await ethers.getContractFactory("CentralVault");
  
  const orderRouter = OrderRouter.attach(contracts.orderRouter);
  const centralVault = CentralVault.attach(contracts.centralVault);

  console.log('\n🔍 RETRIEVING TRADING DATA FROM ORDERROUTER...');
  console.log('-'.repeat(60));

  const traderPnLData: TraderPnLData[] = [];
  let systemTotalVolume = BigInt(0);
  let systemTotalPnL = BigInt(0);
  let systemTotalFees = BigInt(0);

  for (let i = 0; i < Math.min(signers.length, traderNames.length); i++) {
    const signer = signers[i];
    const traderName = traderNames[i];

    console.log(`\n📋 Analyzing ${traderName}...`);
    console.log(`   Address: ${signer.address}`);

    try {
      // Get P&L summary for all metrics (empty string means all)
      const pnlSummary = await orderRouter.getUserPnL(signer.address, "");
      
      // Get P&L for specific metric
      const worldPopPnL = await orderRouter.getUserPnL(signer.address, "WORLD_POPULATION_2024");
      
      // Get active orders
      const activeOrders = await orderRouter.getUserActiveOrders(signer.address);
      
      // Get order history (limit to 100 for performance)
      const orderHistory = await orderRouter.getUserOrderHistory(signer.address, 100, 0);

      // Calculate derived metrics
      const totalVolume = pnlSummary.totalVolume || BigInt(0);
      const totalFees = pnlSummary.totalFees || BigInt(0);
      const realizedPnL = worldPopPnL.realizedPnL || BigInt(0);
      const unrealizedPnL = worldPopPnL.unrealizedPnL || BigInt(0);
      const totalPnL = realizedPnL + unrealizedPnL;

      // Count completed trades
      const completedTrades = orderHistory.filter(order => 
        order.status === 2 || order.status === 1 // FILLED or PARTIALLY_FILLED
      ).length;

      // Calculate average trade size
      const averageTradeSize = completedTrades > 0 ? totalVolume / BigInt(completedTrades) : BigInt(0);

      // Calculate ROI (simplified)
      const currentBalance = await centralVault.getUserBalance(signer.address, contracts.mockUSDC);
      const totalBalance = currentBalance.available + currentBalance.allocated;
      const roi = totalBalance > 0 ? (totalPnL * BigInt(10000) / totalBalance) : BigInt(0);

      const traderData: TraderPnLData = {
        address: signer.address,
        name: traderName,
        realizedPnL: ethers.formatUnits(realizedPnL, 6),
        unrealizedPnL: ethers.formatUnits(unrealizedPnL, 6),
        totalPnL: ethers.formatUnits(totalPnL, 6),
        totalVolume: ethers.formatUnits(totalVolume, 6),
        totalFees: ethers.formatUnits(totalFees, 6),
        totalTrades: completedTrades,
        activeOrders: activeOrders.length,
        averageTradeSize: ethers.formatUnits(averageTradeSize, 6),
        winRate: "0%", // Would need trade-by-trade analysis
        largestWin: "0",
        largestLoss: "0", 
        roi: `${Number(roi) / 100}%`
      };

      traderPnLData.push(traderData);

      // Update system totals
      systemTotalVolume += totalVolume;
      systemTotalPnL += totalPnL;
      systemTotalFees += totalFees;

      // Display individual results
      console.log(`   💰 Realized P&L: $${Number(traderData.realizedPnL).toLocaleString()}`);
      console.log(`   📊 Unrealized P&L: $${Number(traderData.unrealizedPnL).toLocaleString()}`);
      console.log(`   🎯 Total P&L: $${Number(traderData.totalPnL).toLocaleString()}`);
      console.log(`   📈 Total Volume: $${Number(traderData.totalVolume).toLocaleString()}`);
      console.log(`   💸 Total Fees: $${Number(traderData.totalFees).toLocaleString()}`);
      console.log(`   🔢 Completed Trades: ${traderData.totalTrades}`);
      console.log(`   📋 Active Orders: ${traderData.activeOrders}`);
      console.log(`   📊 ROI: ${traderData.roi}`);

      // Show recent orders if any
      if (orderHistory.length > 0) {
        console.log(`   📜 Recent Orders: ${orderHistory.length} total`);
        
        // Show details of most recent orders
        const recentOrders = orderHistory.slice(0, 3);
        for (const order of recentOrders) {
          const sideText = order.side === 0 ? "BUY" : "SELL";
          const statusText = ["PENDING", "PARTIAL", "FILLED", "CANCELLED", "EXPIRED", "REJECTED"][order.status] || "UNKNOWN";
          console.log(`     • Order ${order.orderId}: ${sideText} ${ethers.formatEther(order.quantity)} @ $${ethers.formatEther(order.price)} [${statusText}]`);
        }
      }

    } catch (error) {
      console.log(`   ❌ Failed to get data: ${(error as Error).message}`);
      
      // Add default data for failed queries
      traderPnLData.push({
        address: signer.address,
        name: traderName,
        realizedPnL: "0",
        unrealizedPnL: "0", 
        totalPnL: "0",
        totalVolume: "0",
        totalFees: "0",
        totalTrades: 0,
        activeOrders: 0,
        averageTradeSize: "0",
        winRate: "0%",
        largestWin: "0",
        largestLoss: "0",
        roi: "0%"
      });
    }
  }

  console.log('\n📊 SYSTEM-WIDE TRADING SUMMARY');
  console.log('='.repeat(80));

  // Find top performers
  const sortedByPnL = [...traderPnLData].sort((a, b) => Number(b.totalPnL) - Number(a.totalPnL));
  const sortedByVolume = [...traderPnLData].sort((a, b) => Number(b.totalVolume) - Number(a.totalVolume));

  const tradingSummary: TradingSummary = {
    totalTraders: traderPnLData.filter(t => Number(t.totalVolume) > 0).length,
    totalVolume: ethers.formatUnits(systemTotalVolume, 6),
    totalPnL: ethers.formatUnits(systemTotalPnL, 6),
    totalFees: ethers.formatUnits(systemTotalFees, 6),
    mostProfitable: {
      name: sortedByPnL[0].name,
      pnl: sortedByPnL[0].totalPnL
    },
    leastProfitable: {
      name: sortedByPnL[sortedByPnL.length - 1].name,
      pnl: sortedByPnL[sortedByPnL.length - 1].totalPnL
    },
    highestVolume: {
      name: sortedByVolume[0].name,
      pnl: sortedByVolume[0].totalVolume
    },
    systemHealth: "CALCULATING"
  };

  console.log(`💎 Active Traders: ${tradingSummary.totalTraders}/10`);
  console.log(`📊 Total System Volume: $${Number(tradingSummary.totalVolume).toLocaleString()}`);
  console.log(`💰 Total System P&L: $${Number(tradingSummary.totalPnL).toLocaleString()}`);
  console.log(`💸 Total Fees Paid: $${Number(tradingSummary.totalFees).toLocaleString()}`);
  console.log(`🏆 Most Profitable: ${tradingSummary.mostProfitable.name} ($${Number(tradingSummary.mostProfitable.pnl).toLocaleString()})`);
  console.log(`📉 Least Profitable: ${tradingSummary.leastProfitable.name} ($${Number(tradingSummary.leastProfitable.pnl).toLocaleString()})`);
  console.log(`📈 Highest Volume: ${tradingSummary.highestVolume.name} ($${Number(tradingSummary.highestVolume.pnl).toLocaleString()})`);

  console.log('\n🏆 TRADER LEADERBOARD (BY P&L)');
  console.log('-'.repeat(60));

  sortedByPnL.forEach((trader, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    const pnlColor = Number(trader.totalPnL) >= 0 ? '💚' : '❤️';
    console.log(`${medal} ${trader.name}`);
    console.log(`    ${pnlColor} P&L: $${Number(trader.totalPnL).toLocaleString()}`);
    console.log(`    📊 Volume: $${Number(trader.totalVolume).toLocaleString()}`);
    console.log(`    🔢 Trades: ${trader.totalTrades}`);
    console.log(`    📈 ROI: ${trader.roi}`);
  });

  console.log('\n📈 VOLUME LEADERBOARD');
  console.log('-'.repeat(60));

  sortedByVolume.slice(0, 5).forEach((trader, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    if (Number(trader.totalVolume) > 0) {
      console.log(`${medal} ${trader.name}: $${Number(trader.totalVolume).toLocaleString()}`);
    }
  });

  console.log('\n🎯 KEY INSIGHTS & RECOMMENDATIONS');
  console.log('-'.repeat(60));

  const totalTrades = traderPnLData.reduce((sum, t) => sum + t.totalTrades, 0);
  const averageTradeSize = Number(tradingSummary.totalVolume) / Math.max(totalTrades, 1);
  const profitableTraders = traderPnLData.filter(t => Number(t.totalPnL) > 0).length;

  console.log(`💡 System Insights:`);
  console.log(`   • Total Trades Executed: ${totalTrades.toLocaleString()}`);
  console.log(`   • Average Trade Size: $${averageTradeSize.toLocaleString()}`);
  console.log(`   • Profitable Traders: ${profitableTraders}/10 (${(profitableTraders/10*100).toFixed(0)}%)`);
  console.log(`   • Fee Revenue: $${Number(tradingSummary.totalFees).toLocaleString()}`);

  // Update system health after calculation
  tradingSummary.systemHealth = Number(tradingSummary.totalPnL) >= 0 ? "PROFITABLE" : "LOSS";
  
  if (Number(tradingSummary.totalPnL) >= 0) {
    console.log(`✅ System Status: HEALTHY - Net positive P&L across all traders`);
  } else {
    console.log(`⚠️  System Status: MONITOR - Net negative P&L, check risk management`);
  }

  console.log('\n🎉 P&L ANALYSIS COMPLETE!');
  console.log('='.repeat(80));

  return { traderPnLData, tradingSummary };
}

async function main() {
  const { traderPnLData, tradingSummary } = await analyzeAllTradersPnL();
  
  console.log('\n📋 QUICK SUMMARY:');
  console.log(`🎯 Total System P&L: $${Number(tradingSummary.totalPnL).toLocaleString()}`);
  console.log(`📊 Total Volume: $${Number(tradingSummary.totalVolume).toLocaleString()}`);
  console.log(`👥 Active Traders: ${tradingSummary.totalTraders}/10`);
}

main()
  .then(() => {
    console.log('\n🏁 Trader P&L analysis completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Analysis failed:', error);
    process.exit(1);
  });
