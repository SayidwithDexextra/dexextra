import { ethers } from "hardhat";

async function forceOrderMatching() {
  console.log('🔥 FORCING ORDER EXECUTION & MATCHING');
  console.log('='.repeat(80));
  console.log('🎯 Manually triggering order matching to generate P&L');
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
  const deployer = signers[0];
  const profitTrader = signers[1];
  const lossTrader = signers[2];

  // Get contract instances
  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const OrderBook = await ethers.getContractFactory("OrderBook");

  const orderRouter = OrderRouter.attach(contracts.orderRouter);
  const orderBook = OrderBook.attach(contracts.orderBook);

  console.log('\n📊 STEP 1: ANALYZING CURRENT ORDER BOOK STATE');
  console.log('-'.repeat(60));

  try {
    // Get current orders for both traders
    console.log('🔍 Checking current orders...');
    
    const profitTraderOrders = await orderRouter.getUserOrderHistory(profitTrader.address, 50, 0);
    const lossTraderOrders = await orderRouter.getUserOrderHistory(lossTrader.address, 50, 0);

    console.log(`   📈 Profit trader orders: ${profitTraderOrders.length}`);
    console.log(`   📉 Loss trader orders: ${lossTraderOrders.length}`);

    // Get the most recent orders
    const recentProfitOrders = profitTraderOrders.slice(0, 5);
    const recentLossOrders = lossTraderOrders.slice(0, 5);

    console.log('\n📋 Recent Profit Trader Orders:');
    for (let i = 0; i < Math.min(5, recentProfitOrders.length); i++) {
      const order = recentProfitOrders[i];
      const side = order.side === 0 ? 'BUY' : 'SELL';
      const status = ['PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'][order.status] || 'UNKNOWN';
      console.log(`   ${i + 1}. Order ${order.orderId}: ${side} ${ethers.formatEther(order.quantity)} @ $${ethers.formatEther(order.price)} [${status}]`);
    }

    console.log('\n📋 Recent Loss Trader Orders:');
    for (let i = 0; i < Math.min(5, recentLossOrders.length); i++) {
      const order = recentLossOrders[i];
      const side = order.side === 0 ? 'BUY' : 'SELL';
      const status = ['PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'][order.status] || 'UNKNOWN';
      console.log(`   ${i + 1}. Order ${order.orderId}: ${side} ${ethers.formatEther(order.quantity)} @ $${ethers.formatEther(order.price)} [${status}]`);
    }

  } catch (error) {
    console.log(`❌ Error analyzing orders: ${(error as Error).message}`);
  }

  console.log('\n🔄 STEP 2: MANUALLY EXECUTING ORDER MATCHING');
  console.log('-'.repeat(60));

  try {
    // Get all pending/open orders
    const allProfitOrders = await orderRouter.getUserOrderHistory(profitTrader.address, 100, 0);
    const allLossOrders = await orderRouter.getUserOrderHistory(lossTrader.address, 100, 0);

    const openProfitOrders = allProfitOrders.filter(order => order.status <= 1); // PENDING or OPEN
    const openLossOrders = allLossOrders.filter(order => order.status <= 1);

    console.log(`📊 Open profit trader orders: ${openProfitOrders.length}`);
    console.log(`📊 Open loss trader orders: ${openLossOrders.length}`);

    // Try to manually match orders by calling matchOrder on the OrderBook
    const matchAttempts = [];

    console.log('\n🎯 Attempting to match orders...');

    // First, try to match some profit trader orders (BUY orders)
    for (let i = 0; i < Math.min(5, openProfitOrders.length); i++) {
      const order = openProfitOrders[i];
      
      if (order.side === 0) { // BUY order
        try {
          console.log(`🔄 Attempting to match BUY order ${order.orderId}...`);
          
          // Call matchOrder through OrderRouter (which will call OrderBook)
          const tx = await orderRouter.connect(deployer).matchOrder(order.orderId);
          const receipt = await tx.wait();
          
          console.log(`   ✅ Match attempt completed! Gas: ${receipt?.gasUsed}`);
          console.log(`   🔗 Transaction: ${tx.hash}`);
          
          matchAttempts.push({
            orderId: order.orderId,
            side: 'BUY',
            success: true,
            gasUsed: receipt?.gasUsed?.toString(),
            txHash: tx.hash
          });

          // Wait between attempts
          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
          console.log(`   ❌ Match failed: ${(error as Error).message}`);
          matchAttempts.push({
            orderId: order.orderId,
            side: 'BUY',
            success: false,
            error: (error as Error).message
          });
        }
      }
    }

    // Try to match some loss trader orders (SELL orders)
    for (let i = 0; i < Math.min(5, openLossOrders.length); i++) {
      const order = openLossOrders[i];
      
      if (order.side === 1) { // SELL order
        try {
          console.log(`🔄 Attempting to match SELL order ${order.orderId}...`);
          
          const tx = await orderRouter.connect(deployer).matchOrder(order.orderId);
          const receipt = await tx.wait();
          
          console.log(`   ✅ Match attempt completed! Gas: ${receipt?.gasUsed}`);
          console.log(`   🔗 Transaction: ${tx.hash}`);
          
          matchAttempts.push({
            orderId: order.orderId,
            side: 'SELL',
            success: true,
            gasUsed: receipt?.gasUsed?.toString(),
            txHash: tx.hash
          });

          // Wait between attempts
          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
          console.log(`   ❌ Match failed: ${(error as Error).message}`);
          matchAttempts.push({
            orderId: order.orderId,
            side: 'SELL',
            success: false,
            error: (error as Error).message
          });
        }
      }
    }

    console.log(`\n📊 Match attempts completed: ${matchAttempts.length}`);
    const successfulMatches = matchAttempts.filter(attempt => attempt.success).length;
    const failedMatches = matchAttempts.filter(attempt => !attempt.success).length;
    
    console.log(`   ✅ Successful: ${successfulMatches}`);
    console.log(`   ❌ Failed: ${failedMatches}`);

  } catch (error) {
    console.log(`❌ Manual matching failed: ${(error as Error).message}`);
  }

  console.log('\n💰 STEP 3: CHECKING P&L AFTER FORCED MATCHING');
  console.log('-'.repeat(60));

  // Wait for potential state changes
  await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    const metricId = "WORLD_POPULATION_2024";

    // Check profit trader P&L
    console.log('💚 Profit Trader P&L:');
    try {
      const profitPnL = await orderRouter.getUserPnL(profitTrader.address, metricId);
      const profitRealizedPnL = Number(ethers.formatEther(profitPnL.realizedPnL));
      const profitUnrealizedPnL = Number(ethers.formatEther(profitPnL.unrealizedPnL));
      const profitTotalPnL = profitRealizedPnL + profitUnrealizedPnL;

      console.log(`   💰 Realized P&L: $${profitRealizedPnL.toLocaleString()}`);
      console.log(`   📊 Unrealized P&L: $${profitUnrealizedPnL.toLocaleString()}`);
      console.log(`   🎯 TOTAL P&L: $${profitTotalPnL.toLocaleString()}`);
    } catch (error) {
      console.log(`   ❌ P&L check failed: ${(error as Error).message}`);
    }

    // Check loss trader P&L
    console.log('\n💔 Loss Trader P&L:');
    try {
      const lossPnL = await orderRouter.getUserPnL(lossTrader.address, metricId);
      const lossRealizedPnL = Number(ethers.formatEther(lossPnL.realizedPnL));
      const lossUnrealizedPnL = Number(ethers.formatEther(lossPnL.unrealizedPnL));
      const lossTotalPnL = lossRealizedPnL + lossUnrealizedPnL;

      console.log(`   💸 Realized P&L: $${lossRealizedPnL.toLocaleString()}`);
      console.log(`   📊 Unrealized P&L: $${lossUnrealizedPnL.toLocaleString()}`);
      console.log(`   🎯 TOTAL P&L: $${lossTotalPnL.toLocaleString()}`);
    } catch (error) {
      console.log(`   ❌ P&L check failed: ${(error as Error).message}`);
    }

    // Check updated order statuses
    console.log('\n📊 Updated Order Status:');
    const updatedProfitOrders = await orderRouter.getUserOrderHistory(profitTrader.address, 20, 0);
    const updatedLossOrders = await orderRouter.getUserOrderHistory(lossTrader.address, 20, 0);

    const filledProfitOrders = updatedProfitOrders.filter(order => order.status >= 2); // PARTIALLY_FILLED or FILLED
    const filledLossOrders = updatedLossOrders.filter(order => order.status >= 2);

    console.log(`   ✅ Profit trader filled orders: ${filledProfitOrders.length}/${updatedProfitOrders.length}`);
    console.log(`   ✅ Loss trader filled orders: ${filledLossOrders.length}/${updatedLossOrders.length}`);

    const totalFilledOrders = filledProfitOrders.length + filledLossOrders.length;
    
    if (totalFilledOrders > 0) {
      console.log('\n🎉 SUCCESS! Orders have been executed and filled!');
      console.log(`📊 Total filled orders: ${totalFilledOrders}`);
      
      // Show some filled order details
      if (filledProfitOrders.length > 0) {
        console.log('\n💚 Sample Filled Profit Orders:');
        for (let i = 0; i < Math.min(3, filledProfitOrders.length); i++) {
          const order = filledProfitOrders[i];
          const side = order.side === 0 ? 'BUY' : 'SELL';
          const status = ['PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'][order.status] || 'UNKNOWN';
          console.log(`   ${i + 1}. ${side} ${ethers.formatEther(order.quantity)} @ $${ethers.formatEther(order.price)} [${status}]`);
        }
      }

      if (filledLossOrders.length > 0) {
        console.log('\n💔 Sample Filled Loss Orders:');
        for (let i = 0; i < Math.min(3, filledLossOrders.length); i++) {
          const order = filledLossOrders[i];
          const side = order.side === 0 ? 'BUY' : 'SELL';
          const status = ['PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'][order.status] || 'UNKNOWN';
          console.log(`   ${i + 1}. ${side} ${ethers.formatEther(order.quantity)} @ $${ethers.formatEther(order.price)} [${status}]`);
        }
      }
    } else {
      console.log('\n⚠️  No orders were filled despite match attempts');
      console.log('🔧 This suggests the matching algorithm requires specific conditions');
    }

    return {
      totalFilledOrders,
      profitTraderFilled: filledProfitOrders.length,
      lossTraderFilled: filledLossOrders.length,
      matchAttempts: matchAttempts?.length || 0,
      successfulMatches: matchAttempts?.filter(a => a.success).length || 0
    };

  } catch (error) {
    console.log(`❌ Final analysis failed: ${(error as Error).message}`);
    return null;
  }
}

async function main() {
  const results = await forceOrderMatching();

  console.log('\n🎉 FORCED ORDER MATCHING COMPLETE!');
  console.log('='.repeat(80));

  if (results) {
    console.log('🏆 RESULTS SUMMARY:');
    console.log(`   🔄 Match attempts: ${results.matchAttempts}`);
    console.log(`   ✅ Successful matches: ${results.successfulMatches}`);
    console.log(`   📊 Total filled orders: ${results.totalFilledOrders}`);
    console.log(`   💚 Profit trader filled: ${results.profitTraderFilled}`);
    console.log(`   💔 Loss trader filled: ${results.lossTraderFilled}`);

    if (results.totalFilledOrders > 0) {
      console.log('\n🚀 SUCCESS! Your order matching system is working!');
      console.log('💰 P&L should now be visible in the system!');
    } else {
      console.log('\n🔧 DIAGNOSTIC: Orders placed but not executing');
      console.log('💡 This indicates the matching algorithm may need:');
      console.log('   • Crossing prices (buy price ≥ sell price)');
      console.log('   • Sufficient liquidity');
      console.log('   • Proper order book management');
    }
  } else {
    console.log('❌ Unable to analyze results - check system logs');
  }
}

main()
  .then(() => {
    console.log('\n🏁 Order matching analysis completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Process failed:', error);
    process.exit(1);
  });







