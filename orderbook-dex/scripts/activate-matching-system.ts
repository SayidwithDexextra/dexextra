import { ethers } from "hardhat";

async function activateMatchingSystem() {
  console.log('🚀 ACTIVATING EXISTING MATCHING SYSTEM');
  console.log('='.repeat(80));
  console.log('🎯 Integrating with your sophisticated order matching architecture');
  console.log('='.repeat(80));

  // Contract addresses from latest deployment
  const contracts = {
    mockUSDC: "0x3371ce5d3164ABf183C676e2FC987597e8191892",
    centralVault: "0xc94fb667207206eEe88C203B4dF56Be99a30c8Ea",
    orderRouter: "0xFBd6B734109567937d1d9F1a41Ce86f8d6632BF2",
    orderBook: "0x1FCccd6827eAc7cA1c18596A6ed52A8B1b51f195"
  };

  // Get signers
  const signers = await ethers.getSigners();

  // Setup traders with massive balances
  const traders = [
    { signer: signers[0], name: "🐋 Whale Trader", balance: 100000000 },
    { signer: signers[1], name: "🏦 Institution A", balance: 80000000 },
    { signer: signers[2], name: "🏛️ Institution B", balance: 60000000 },
    { signer: signers[3], name: "📈 High Volume Trader", balance: 50000000 },
    { signer: signers[4], name: "💼 Market Maker", balance: 70000000 },
    { signer: signers[5], name: "🎯 Arbitrageur", balance: 40000000 },
    { signer: signers[6], name: "⚡ Speed Trader", balance: 30000000 },
    { signer: signers[7], name: "🎢 Volatility Trader", balance: 35000000 },
    { signer: signers[8], name: "🎪 Stress Tester", balance: 55000000 },
    { signer: signers[9], name: "🔬 Edge Case Tester", balance: 25000000 }
  ];

  // Get contract instances
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const CentralVault = await ethers.getContractFactory("CentralVault");
  const OrderRouter = await ethers.getContractFactory("OrderRouter");

  const mockUSDC = MockUSDC.attach(contracts.mockUSDC);
  const centralVault = CentralVault.attach(contracts.centralVault);
  const orderRouter = OrderRouter.attach(contracts.orderRouter);

  console.log('\n💰 FUNDING TRADERS FOR MATCHING SYSTEM...');
  console.log('-'.repeat(60));

  // Fund all traders
  for (const trader of traders) {
    try {
      const fundingAmount = ethers.parseUnits(trader.balance.toString(), 6);
      await mockUSDC.mint(trader.signer.address, fundingAmount);
      await mockUSDC.connect(trader.signer).approve(contracts.centralVault, fundingAmount);
      await centralVault.connect(trader.signer).depositPrimaryCollateral(fundingAmount);

      console.log(`   ✅ ${trader.name}: $${ethers.formatUnits(fundingAmount, 6)} funded`);
    } catch (error) {
      console.log(`   ❌ Failed to fund ${trader.name}: ${(error as Error).message}`);
    }
  }

  console.log('\n📊 CREATING CROSSING ORDER BOOK FOR MATCHING');
  console.log('-'.repeat(60));

  // Create a sophisticated order book with guaranteed matches
  // We'll create both buy and sell orders that will cross

  const orderBookStrategy = [
    // SELL ORDERS (at various price levels)
    { trader: traders[0], side: 'SELL', quantity: 100000, price: 100, strategy: "Whale liquidation" },
    { trader: traders[1], side: 'SELL', quantity: 80000, price: 105, strategy: "Institution profit taking" },
    { trader: traders[2], side: 'SELL', quantity: 60000, price: 110, strategy: "Institution exit" },
    { trader: traders[3], side: 'SELL', quantity: 50000, price: 115, strategy: "High volume sell" },
    { trader: traders[4], side: 'SELL', quantity: 70000, price: 120, strategy: "Market maker inventory" },
    { trader: traders[5], side: 'SELL', quantity: 30000, price: 125, strategy: "Arbitrage position" },
    { trader: traders[6], side: 'SELL', quantity: 20000, price: 130, strategy: "Speed trader exit" },
    { trader: traders[7], side: 'SELL', quantity: 25000, price: 135, strategy: "Volatility play" },

    // BUY ORDERS (that will match the sells)
    { trader: traders[8], side: 'BUY', quantity: 90000, price: 140, strategy: "Stress test accumulation" },
    { trader: traders[9], side: 'BUY', quantity: 70000, price: 138, strategy: "Edge case testing" },
    { trader: traders[4], side: 'BUY', quantity: 60000, price: 136, strategy: "Market maker bid" },
    { trader: traders[1], side: 'BUY', quantity: 50000, price: 134, strategy: "Institution accumulation" },
    { trader: traders[3], side: 'BUY', quantity: 40000, price: 132, strategy: "High volume accumulation" },
    { trader: traders[6], side: 'BUY', quantity: 35000, price: 128, strategy: "Speed trader entry" },
    { trader: traders[0], side: 'BUY', quantity: 80000, price: 126, strategy: "Whale accumulation" },
    { trader: traders[7], side: 'BUY', quantity: 30000, price: 124, strategy: "Volatility entry" },
    { trader: traders[2], side: 'BUY', quantity: 55000, price: 122, strategy: "Institution bid" },
    { trader: traders[5], side: 'BUY', quantity: 45000, price: 118, strategy: "Arbitrage bid" }
  ];

  const orderResults = [];
  let totalSellVolume = BigInt(0);
  let totalBuyVolume = BigInt(0);

  console.log('\n🎯 SUBMITTING ORDERS TO MATCHING ENGINE');
  console.log('-'.repeat(60));

  // Submit all orders to the OrderRouter (which will forward to MatchingEngine)
  for (let i = 0; i < orderBookStrategy.length; i++) {
    const orderConfig = orderBookStrategy[i];

    try {
      const quantity = ethers.parseEther(orderConfig.quantity.toString());
      const price = ethers.parseEther(orderConfig.price.toString());
      const notional = (quantity * price) / ethers.parseEther("1");

      console.log(`\n📋 Submitting ${orderConfig.side} order ${i + 1}/${orderBookStrategy.length}:`);
      console.log(`   👤 ${orderConfig.trader.name}`);
      console.log(`   📊 Quantity: ${orderConfig.quantity.toLocaleString()} units`);
      console.log(`   💰 Price: $${orderConfig.price}`);
      console.log(`   💎 Notional: $${ethers.formatUnits(notional, 6)}`);
      console.log(`   🎲 Strategy: ${orderConfig.strategy}`);

      const order = {
        orderId: 0, // Will be assigned by contract
        trader: orderConfig.trader.signer.address,
        metricId: "WORLD_POPULATION_2024",
        orderType: 1, // LIMIT
        side: orderConfig.side === 'BUY' ? 0 : 1,
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
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes(`${orderConfig.side}_ORDER_${orderConfig.strategy}_${i}`))
      };

      const startTime = performance.now();
      const tx = await orderRouter.connect(orderConfig.trader.signer).placeOrder(order);
      const receipt = await tx.wait();
      const endTime = performance.now();

      const orderResult = {
        index: i + 1,
        trader: orderConfig.trader.name,
        side: orderConfig.side,
        quantity: orderConfig.quantity,
        price: orderConfig.price,
        notional: ethers.formatUnits(notional, 6),
        gasUsed: receipt?.gasUsed?.toString(),
        processingTime: `${(endTime - startTime).toFixed(2)}ms`,
        transactionHash: tx.hash
      };

      orderResults.push(orderResult);

      if (orderConfig.side === 'SELL') {
        totalSellVolume += notional;
      } else {
        totalBuyVolume += notional;
      }

      console.log(`   ✅ Order submitted successfully!`);
      console.log(`   ⛽ Gas: ${receipt?.gasUsed?.toLocaleString()}`);
      console.log(`   ⚡ Time: ${(endTime - startTime).toFixed(2)}ms`);
      console.log(`   🔗 Tx: ${tx.hash}`);

      // Small delay between orders to allow processing
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.log(`   ❌ Failed to submit order: ${(error as Error).message}`);
      orderResults.push({
        index: i + 1,
        trader: orderConfig.trader.name,
        side: orderConfig.side,
        quantity: orderConfig.quantity,
        price: orderConfig.price,
        error: (error as Error).message
      });
    }
  }

  console.log('\n📊 ORDER SUBMISSION COMPLETE');
  console.log('='.repeat(80));

  const successfulOrders = orderResults.filter(r => !r.error).length;
  const failedOrders = orderResults.filter(r => r.error).length;

  console.log(`📋 ORDERS SUBMITTED: ${orderResults.length}`);
  console.log(`✅ Successful: ${successfulOrders}`);
  console.log(`❌ Failed: ${failedOrders}`);
  console.log(`💰 Total Sell Volume: $${ethers.formatUnits(totalSellVolume, 6)}`);
  console.log(`💸 Total Buy Volume: $${ethers.formatUnits(totalBuyVolume, 6)}`);
  console.log(`⚖️  Buy/Sell Ratio: ${(Number(totalBuyVolume) / Number(totalSellVolume) * 100).toFixed(1)}%`);

  console.log('\n🎯 ORDER EXECUTION STATUS');
  console.log('-'.repeat(60));

  // Wait for matching to occur
  console.log('⏳ Waiting for MatchingEngine to process orders...');

  await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

  console.log('🔍 Checking for trade executions...');

  let totalMatches = 0;
  let totalMatchedVolume = BigInt(0);

  // Check execution status for orders
  for (const result of orderResults.filter(r => !r.error)) {
    try {
      // Get the trader's orders
      const trader = traders.find(t => t.name === result.trader);
      if (trader) {
        const orderHistory = await orderRouter.getUserOrderHistory(trader.signer.address, 20, 0);

        // Look for filled orders
        const filledOrders = orderHistory.filter(order =>
          order.status === 3 || order.status === 2 // FILLED or PARTIALLY_FILLED
        );

        if (filledOrders.length > 0) {
          totalMatches += filledOrders.length;
          console.log(`   ✅ ${result.trader}: ${filledOrders.length} matched order(s)`);

          // Calculate matched volume
          for (const filledOrder of filledOrders) {
            const matchedVolume = (filledOrder.quantity * filledOrder.price) / ethers.parseEther("1");
            totalMatchedVolume += matchedVolume;
          }
        }
      }
    } catch (error) {
      console.log(`   ❌ Failed to check ${result.trader}: ${(error as Error).message}`);
    }
  }

  console.log('\n🎉 MATCHING SYSTEM ACTIVATION COMPLETE!');
  console.log('='.repeat(80));

  console.log(`📊 MATCHING RESULTS:`);
  console.log(`   🔄 Orders with matches: ${totalMatches}`);
  console.log(`   💰 Matched volume: $${ethers.formatUnits(totalMatchedVolume, 6)}`);
  console.log(`   📊 Match rate: ${((totalMatches / successfulOrders) * 100).toFixed(1)}%`);

  console.log('\n🚀 NEXT STEPS:');
  console.log('   1. ✅ Orders submitted to your MatchingEngine');
  console.log('   2. 🔄 MatchingEngine processing matches in background');
  console.log('   3. 📊 SettlementQueueService will batch settle trades');
  console.log('   4. 💰 Run P&L analysis to see profit/loss results');

  console.log('\n💡 YOUR MATCHING SYSTEM ARCHITECTURE:');
  console.log('   • OrderRouter → MatchingEngine (price-time priority)');
  console.log('   • MatchingEngine → SettlementQueueService (batch settlement)');
  console.log('   • SettlementQueueService → CentralVault (on-chain settlement)');
  console.log('   • Real-time updates via WebSocketService');
  console.log('   • Event indexing via EventIndexerService');

  return {
    totalOrders: orderResults.length,
    successfulOrders,
    failedOrders,
    totalSellVolume: ethers.formatUnits(totalSellVolume, 6),
    totalBuyVolume: ethers.formatUnits(totalBuyVolume, 6),
    matchedOrders: totalMatches,
    matchedVolume: ethers.formatUnits(totalMatchedVolume, 6)
  };
}

async function main() {
  const results = await activateMatchingSystem();

  console.log('\n📋 FINAL SUMMARY:');
  console.log(`🎯 Total orders: ${results.totalOrders}`);
  console.log(`✅ Successful: ${results.successfulOrders}`);
  console.log(`❌ Failed: ${results.failedOrders}`);
  console.log(`💰 Sell volume: $${results.totalSellVolume}`);
  console.log(`💸 Buy volume: $${results.totalBuyVolume}`);
  console.log(`🔄 Matched orders: ${results.matchedOrders}`);
  console.log(`💰 Matched volume: $${results.matchedVolume}`);

  console.log('\n🎉 Ready for P&L analysis! Run: npm run pnl:analyze');
}

main()
  .then(() => {
    console.log('\n🏁 Matching system activation completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Activation failed:', error);
    process.exit(1);
  });







