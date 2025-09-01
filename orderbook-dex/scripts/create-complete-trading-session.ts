import { ethers } from "hardhat";

interface TraderConfig {
  signer: any;
  address: string;
  name: string;
  initialBalance: number;
}

interface TradeOrder {
  trader: string;
  traderName: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  notional: string;
  orderId?: number;
  status?: string;
}

async function createCompleteTradingSession() {
  console.log('🚀 COMPLETE TRADING SESSION');
  console.log('='.repeat(80));
  console.log('🎯 Creating both sell and buy orders to generate real trading activity and P&L');
  console.log('='.repeat(80));

  // Contract addresses
  const contracts = {
    mockUSDC: "0x3371ce5d3164ABf183C676e2FC987597e8191892",
    centralVault: "0xc94fb667207206eEe88C203B4dF56Be99a30c8Ea",
    orderRouter: "0xFBd6B734109567937d1d9F1a41Ce86f8d6632BF2",
    orderBook: "0x1FCccd6827eAc7cA1c18596A6ed52A8B1b51f195"
  };

  // Get signers
  const signers = await ethers.getSigners();

  // Setup traders with different strategies
  const traders: TraderConfig[] = [
    { signer: signers[0], address: signers[0].address, name: "🐋 Whale Trader", initialBalance: 100000000 },
    { signer: signers[1], address: signers[1].address, name: "🏦 Institution A", initialBalance: 80000000 },
    { signer: signers[2], address: signers[2].address, name: "🏛️ Institution B", initialBalance: 60000000 },
    { signer: signers[3], address: signers[3].address, name: "📈 High Volume Trader", initialBalance: 50000000 },
    { signer: signers[4], address: signers[4].address, name: "💼 Market Maker", initialBalance: 70000000 },
    { signer: signers[5], address: signers[5].address, name: "🎯 Arbitrageur", initialBalance: 40000000 },
    { signer: signers[6], address: signers[6].address, name: "⚡ Speed Trader", initialBalance: 30000000 },
    { signer: signers[7], address: signers[7].address, name: "🎢 Volatility Trader", initialBalance: 35000000 },
    { signer: signers[8], address: signers[8].address, name: "🎪 Stress Tester", initialBalance: 55000000 },
    { signer: signers[9], address: signers[9].address, name: "🔬 Edge Case Tester", initialBalance: 25000000 }
  ];

  // Get contract instances
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const CentralVault = await ethers.getContractFactory("CentralVault");
  const OrderRouter = await ethers.getContractFactory("OrderRouter");

  const mockUSDC = MockUSDC.attach(contracts.mockUSDC);
  const centralVault = CentralVault.attach(contracts.centralVault);
  const orderRouter = OrderRouter.attach(contracts.orderRouter);

  console.log('\n💰 SETTING UP TRADER BALANCES...');
  console.log('-'.repeat(50));

  // Fund all traders
  for (const trader of traders) {
    try {
      const fundingAmount = ethers.parseUnits(trader.initialBalance.toString(), 6);
      await mockUSDC.mint(trader.address, fundingAmount);
      await mockUSDC.connect(trader.signer).approve(contracts.centralVault, fundingAmount);
      await centralVault.connect(trader.signer).depositPrimaryCollateral(fundingAmount);

      const balance = await centralVault.getUserBalance(trader.address, contracts.mockUSDC);
      console.log(`   ✅ ${trader.name}: $${ethers.formatUnits(balance.available, 6)} available`);
    } catch (error) {
      console.log(`   ❌ Failed to setup ${trader.name}: ${(error as Error).message}`);
    }
  }

  console.log('\n📊 CREATING TRADING STRATEGY...');
  console.log('-'.repeat(50));

  // Create a sophisticated order book with both buy and sell orders
  const tradingStrategy = [
    // SELL ORDERS (Supply Side)
    { trader: traders[0], side: 'SELL' as const, quantity: 500000, price: 100, strategy: "Whale liquidation" },
    { trader: traders[1], side: 'SELL' as const, quantity: 300000, price: 105, strategy: "Institution profit taking" },
    { trader: traders[2], side: 'SELL' as const, quantity: 200000, price: 110, strategy: "Institution exit" },
    { trader: traders[3], side: 'SELL' as const, quantity: 150000, price: 115, strategy: "High volume sell" },
    { trader: traders[4], side: 'SELL' as const, quantity: 250000, price: 120, strategy: "Market maker inventory" },
    { trader: traders[5], side: 'SELL' as const, quantity: 80000, price: 125, strategy: "Arbitrage position" },
    { trader: traders[6], side: 'SELL' as const, quantity: 50000, price: 130, strategy: "Speed trader exit" },
    { trader: traders[7], side: 'SELL' as const, quantity: 100000, price: 135, strategy: "Volatility play" },

    // BUY ORDERS (Demand Side)
    { trader: traders[8], side: 'BUY' as const, quantity: 400000, price: 95, strategy: "Stress test accumulation" },
    { trader: traders[9], side: 'BUY' as const, quantity: 100000, price: 98, strategy: "Edge case testing" },
    { trader: traders[4], side: 'BUY' as const, quantity: 200000, price: 102, strategy: "Market maker bid" },
    { trader: traders[1], side: 'BUY' as const, quantity: 150000, price: 108, strategy: "Institution accumulation" },
    { trader: traders[3], side: 'BUY' as const, quantity: 100000, price: 112, strategy: "High volume accumulation" },
    { trader: traders[6], side: 'BUY' as const, quantity: 75000, price: 118, strategy: "Speed trader entry" },
    { trader: traders[0], side: 'BUY' as const, quantity: 300000, price: 122, strategy: "Whale accumulation" },
    { trader: traders[7], side: 'BUY' as const, quantity: 80000, price: 128, strategy: "Volatility entry" }
  ];

  const allOrders: TradeOrder[] = [];
  let totalSellVolume = BigInt(0);
  let totalBuyVolume = BigInt(0);

  console.log('\n📋 PLACING ALL ORDERS...');
  console.log('-'.repeat(50));

  // Place all orders
  for (const trade of tradingStrategy) {
    try {
      const quantity = ethers.parseEther(trade.quantity.toString());
      const price = ethers.parseEther(trade.price.toString());
      const notional = (quantity * price) / ethers.parseEther("1");

      console.log(`\n🎯 Placing ${trade.side} order:`);
      console.log(`   👤 ${trade.trader.name}`);
      console.log(`   📊 Quantity: ${trade.quantity.toLocaleString()} units`);
      console.log(`   💰 Price: $${trade.price}`);
      console.log(`   💎 Notional: $${ethers.formatUnits(notional, 6)}`);
      console.log(`   🎲 Strategy: ${trade.strategy}`);

      const order = {
        orderId: 0,
        trader: trade.trader.address,
        metricId: "WORLD_POPULATION_2024",
        orderType: 1, // LIMIT
        side: trade.side === 'BUY' ? 0 : 1,
        quantity: quantity,
        price: price,
        filledQuantity: 0,
        timestamp: 0,
        expiryTime: 0,
        status: 0,
        timeInForce: 0,
        stopPrice: 0,
        icebergQty: 0,
        postOnly: false,
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes(`${trade.side}_ORDER_${trade.strategy}`))
      };

      const startTime = performance.now();
      const tx = await orderRouter.connect(trade.trader.signer).placeOrder(order);
      const receipt = await tx.wait();
      const endTime = performance.now();

      const orderRecord: TradeOrder = {
        trader: trade.trader.address,
        traderName: trade.trader.name,
        side: trade.side,
        quantity: ethers.formatEther(quantity),
        price: trade.price.toString(),
        notional: ethers.formatUnits(notional, 6),
        status: 'PLACED'
      };

      allOrders.push(orderRecord);

      if (trade.side === 'SELL') {
        totalSellVolume += notional;
      } else {
        totalBuyVolume += notional;
      }

      console.log(`   ✅ Order placed successfully!`);
      console.log(`   ⛽ Gas: ${receipt?.gasUsed?.toLocaleString()}`);
      console.log(`   ⚡ Time: ${(endTime - startTime).toFixed(2)}ms`);

      // Small delay between orders
      await new Promise(resolve => setTimeout(resolve, 300));

    } catch (error) {
      console.log(`   ❌ Failed to place order: ${(error as Error).message}`);
    }
  }

  console.log('\n📊 ORDER BOOK CREATED!');
  console.log('='.repeat(80));

  console.log(`📋 ORDERS PLACED: ${allOrders.length}`);
  console.log(`💰 Total Sell Volume: $${ethers.formatUnits(totalSellVolume, 6)}`);
  console.log(`💸 Total Buy Volume: $${ethers.formatUnits(totalBuyVolume, 6)}`);
  console.log(`⚖️  Buy/Sell Ratio: ${(Number(totalBuyVolume) / Number(totalSellVolume) * 100).toFixed(1)}%`);

  // Wait for potential matching
  console.log('\n⏳ WAITING FOR ORDER MATCHING...');
  console.log('-'.repeat(50));

  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('🔍 ANALYZING MATCHING RESULTS...');

  let matchedOrders = 0;
  let totalExecutedVolume = BigInt(0);
  let totalExecutedTrades = 0;

  // Check execution status for all orders
  for (let i = 0; i < allOrders.length; i++) {
    try {
      // Get the order ID by checking recent history (this is approximate)
      const trader = traders.find(t => t.address === allOrders[i].trader);
      if (trader) {
        const orderHistory = await orderRouter.getUserOrderHistory(trader.address, 10, 0);

        for (const order of orderHistory) {
          if (order.side === (allOrders[i].side === 'BUY' ? 0 : 1)) {
            const executions = await orderRouter.getOrderExecutions(order.orderId);

            if (executions.length > 0) {
              matchedOrders++;
              totalExecutedTrades += executions.length;

              for (const execution of executions) {
                totalExecutedVolume += execution.executedQuantity * execution.executedPrice / ethers.parseEther("1");
              }

              console.log(`   ✅ ${allOrders[i].traderName} ${allOrders[i].side}: ${executions.length} execution(s)`);
              break;
            }
          }
        }
      }
    } catch (error) {
      console.log(`   ❌ Failed to check ${allOrders[i].traderName}: ${(error as Error).message}`);
    }
  }

  console.log('\n🎯 TRADING SESSION RESULTS');
  console.log('='.repeat(80));

  console.log(`📊 EXECUTION SUMMARY:`);
  console.log(`   🔄 Orders with executions: ${matchedOrders}/${allOrders.length}`);
  console.log(`   💰 Executed volume: $${ethers.formatUnits(totalExecutedVolume, 6)}`);
  console.log(`   📊 Execution rate: ${((matchedOrders / allOrders.length) * 100).toFixed(1)}%`);
  console.log(`   🔢 Total trades executed: ${totalExecutedTrades}`);

  if (totalExecutedTrades > 0) {
    console.log(`   📈 Average trade size: $${ethers.formatUnits(totalExecutedVolume / BigInt(totalExecutedTrades), 6)}`);
  }

  console.log('\n🎉 TRADING SESSION COMPLETE!');
  console.log('='.repeat(80));
  console.log('💡 Next: Run P&L analysis to see detailed profit/loss breakdown!');

  return {
    totalOrders: allOrders.length,
    matchedOrders: matchedOrders,
    totalExecutedVolume: ethers.formatUnits(totalExecutedVolume, 6),
    totalTrades: totalExecutedTrades,
    sellVolume: ethers.formatUnits(totalSellVolume, 6),
    buyVolume: ethers.formatUnits(totalBuyVolume, 6)
  };
}

async function main() {
  const results = await createCompleteTradingSession();

  console.log('\n📋 SESSION SUMMARY:');
  console.log(`🎯 Total orders placed: ${results.totalOrders}`);
  console.log(`✅ Orders matched: ${results.matchedOrders}`);
  console.log(`💰 Executed volume: $${results.totalExecutedVolume}`);
  console.log(`🔢 Total trades: ${results.totalTrades}`);
  console.log(`💸 Sell volume: $${results.sellVolume}`);
  console.log(`💵 Buy volume: $${results.buyVolume}`);
}

main()
  .then(() => {
    console.log('\n🏁 Complete trading session finished!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Trading session failed:', error);
    process.exit(1);
  });







