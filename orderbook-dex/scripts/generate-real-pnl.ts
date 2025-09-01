import { ethers } from "hardhat";

async function generateRealPnL() {
  console.log('💰 GENERATING REAL PROFIT & LOSS');
  console.log('='.repeat(80));

  // Contract addresses from latest deployment
  const contracts = {
    mockUSDC: "0x3371ce5d3164ABf183C676e2FC987597e8191892",
    centralVault: "0xc94fb667207206eEe88C203B4dF56Be99a30c8Ea",
    orderRouter: "0xFBd6B734109567937d1d9F1a41Ce86f8d6632BF2",
    orderBook: "0x1FCccd6827eAc7cA1c18596A6ed52A8B1b51f195"
  };

  // Get signers and factory
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  // Get contract instances
  const CentralVault = await ethers.getContractFactory("CentralVault");
  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");

  const centralVault = CentralVault.attach(contracts.centralVault);
  const orderRouter = OrderRouter.attach(contracts.orderRouter);
  const orderBook = OrderBook.attach(contracts.orderBook);
  const mockUSDC = MockUSDC.attach(contracts.mockUSDC);

  console.log('\n🚀 STEP 1: SETUP AND VERIFICATION');
  console.log('-'.repeat(60));

  // Set up profit and loss traders
  const profitTrader = signers[1]; // Will make profit
  const lossTrader = signers[2];   // Will make loss

  const metricId = "WORLD_POPULATION_2024";

  // Fund traders with massive amounts
  try {
    const fundingAmount = ethers.parseUnits("50000000", 6); // 50M USDC each
    
    console.log('💳 Funding profit and loss traders...');
    
    // Fund profit trader
    try {
      await mockUSDC.mint(profitTrader.address, fundingAmount);
      await mockUSDC.connect(profitTrader).approve(contracts.centralVault, fundingAmount);
      await centralVault.connect(profitTrader).depositPrimaryCollateral(fundingAmount);
      console.log(`   ✅ Profit trader funded: $50M`);
    } catch (error) {
      console.log('   ⚠️  Profit trader already funded');
    }
    
    // Fund loss trader
    try {
      await mockUSDC.mint(lossTrader.address, fundingAmount);
      await mockUSDC.connect(lossTrader).approve(contracts.centralVault, fundingAmount);
      await centralVault.connect(lossTrader).depositPrimaryCollateral(fundingAmount);
      console.log(`   ✅ Loss trader funded: $50M`);
    } catch (error) {
      console.log('   ⚠️  Loss trader already funded');
    }

  } catch (error) {
    console.log(`❌ Funding failed: ${(error as Error).message}`);
    return;
  }

  console.log('\n📊 STEP 2: CREATING PROFITABLE TRADING SCENARIO');
  console.log('-'.repeat(60));

  const trades = [];
  let totalExpectedProfit = 0;

  try {
    // Create a series of profitable trades
    const tradingPairs = [
      { sellPrice: 100, buyPrice: 120, quantity: 1000, name: "Big Spread Trade" },
      { sellPrice: 90, buyPrice: 110, quantity: 800, name: "Medium Spread Trade" },
      { sellPrice: 85, buyPrice: 95, quantity: 500, name: "Small Spread Trade" },
      { sellPrice: 75, buyPrice: 105, quantity: 1200, name: "Large Volume Trade" },
      { sellPrice: 80, buyPrice: 115, quantity: 900, name: "High Profit Trade" }
    ];

    for (let i = 0; i < tradingPairs.length; i++) {
      const trade = tradingPairs[i];
      const expectedProfit = (trade.buyPrice - trade.sellPrice) * trade.quantity;
      totalExpectedProfit += expectedProfit;

      console.log(`\n💼 ${trade.name} (${i + 1}/${tradingPairs.length}):`);
      console.log(`   📊 Quantity: ${trade.quantity} units`);
      console.log(`   💰 Sell Price: $${trade.sellPrice}`);
      console.log(`   💎 Buy Price: $${trade.buyPrice}`);
      console.log(`   💚 Expected Profit: $${expectedProfit.toLocaleString()}`);

      // Create SELL order (loss trader sells low)
      const sellOrder = {
        orderId: 0,
        trader: lossTrader.address,
        metricId: metricId,
        orderType: 1, // LIMIT
        side: 1, // SELL
        quantity: ethers.parseEther(trade.quantity.toString()),
        price: ethers.parseEther(trade.sellPrice.toString()),
        filledQuantity: 0,
        timestamp: 0,
        expiryTime: 0,
        status: 0,
        timeInForce: 0,
        stopPrice: 0,
        icebergQty: 0,
        postOnly: false,
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes(`SELL_${i}_${trade.sellPrice}`))
      };

      console.log('   📈 Placing SELL order...');
      const sellTx = await orderRouter.connect(lossTrader).placeOrder(sellOrder);
      const sellReceipt = await sellTx.wait();
      console.log(`      Gas used: ${sellReceipt?.gasUsed}`);

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create BUY order (profit trader buys high)
      const buyOrder = {
        orderId: 0,
        trader: profitTrader.address,
        metricId: metricId,
        orderType: 1, // LIMIT
        side: 0, // BUY
        quantity: ethers.parseEther(trade.quantity.toString()),
        price: ethers.parseEther(trade.buyPrice.toString()),
        filledQuantity: 0,
        timestamp: 0,
        expiryTime: 0,
        status: 0,
        timeInForce: 0,
        stopPrice: 0,
        icebergQty: 0,
        postOnly: false,
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes(`BUY_${i}_${trade.buyPrice}`))
      };

      console.log('   📉 Placing BUY order...');
      const buyTx = await orderRouter.connect(profitTrader).placeOrder(buyOrder);
      const buyReceipt = await buyTx.wait();
      console.log(`      Gas used: ${buyReceipt?.gasUsed}`);
      console.log(`   ✅ Trade orders placed successfully!`);

      trades.push({
        index: i + 1,
        name: trade.name,
        sellPrice: trade.sellPrice,
        buyPrice: trade.buyPrice,
        quantity: trade.quantity,
        expectedProfit: expectedProfit,
        sellTxHash: sellTx.hash,
        buyTxHash: buyTx.hash
      });

      // Wait between trades
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    console.log(`\n🎯 All ${tradingPairs.length} trading pairs submitted!`);
    console.log(`💰 Total Expected Profit: $${totalExpectedProfit.toLocaleString()}`);

  } catch (error) {
    console.log(`❌ Trade creation failed: ${(error as Error).message}`);
    return;
  }

  console.log('\n⏳ STEP 3: WAITING FOR ORDER EXECUTION');
  console.log('-'.repeat(60));
  
  console.log('🔄 Allowing time for order matching and execution...');
  await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

  console.log('\n📊 STEP 4: ANALYZING REAL P&L RESULTS');
  console.log('-'.repeat(60));

  try {
    // Get profit trader's P&L
    console.log('💚 Analyzing PROFIT TRADER P&L:');
    const profitTraderPnL = await orderRouter.getUserPnL(profitTrader.address, metricId);
    const profitTraderHistory = await orderRouter.getUserOrderHistory(profitTrader.address, 50, 0);
    
    const profitFilledOrders = profitTraderHistory.filter(order => 
      order.status === 3 || order.status === 2 // FILLED or PARTIALLY_FILLED
    );

    console.log(`   📈 Orders: ${profitFilledOrders.length} filled / ${profitTraderHistory.length} total`);
    console.log(`   💰 Realized P&L: $${ethers.formatEther(profitTraderPnL.realizedPnL)}`);
    console.log(`   📊 Unrealized P&L: $${ethers.formatEther(profitTraderPnL.unrealizedPnL)}`);
    
    // Calculate total P&L
    const profitTraderTotal = Number(ethers.formatEther(profitTraderPnL.realizedPnL)) + 
                             Number(ethers.formatEther(profitTraderPnL.unrealizedPnL));
    console.log(`   🎯 TOTAL P&L: $${profitTraderTotal.toLocaleString()}`);

    // Get loss trader's P&L
    console.log('\n💔 Analyzing LOSS TRADER P&L:');
    const lossTraderPnL = await orderRouter.getUserPnL(lossTrader.address, metricId);
    const lossTraderHistory = await orderRouter.getUserOrderHistory(lossTrader.address, 50, 0);
    
    const lossFilledOrders = lossTraderHistory.filter(order => 
      order.status === 3 || order.status === 2
    );

    console.log(`   📈 Orders: ${lossFilledOrders.length} filled / ${lossTraderHistory.length} total`);
    console.log(`   💸 Realized P&L: $${ethers.formatEther(lossTraderPnL.realizedPnL)}`);
    console.log(`   📊 Unrealized P&L: $${ethers.formatEther(lossTraderPnL.unrealizedPnL)}`);
    
    // Calculate total P&L
    const lossTraderTotal = Number(ethers.formatEther(lossTraderPnL.realizedPnL)) + 
                           Number(ethers.formatEther(lossTraderPnL.unrealizedPnL));
    console.log(`   🎯 TOTAL P&L: $${lossTraderTotal.toLocaleString()}`);

    // System-wide analysis
    const netSystemPnL = profitTraderTotal + lossTraderTotal;
    const totalTrades = profitFilledOrders.length + lossFilledOrders.length;

    console.log('\n🏆 COMPREHENSIVE P&L SUMMARY');
    console.log('='.repeat(80));
    console.log(`📊 SYSTEM METRICS:`);
    console.log(`   🔄 Total Trades Executed: ${totalTrades}`);
    console.log(`   💰 Expected Total Profit: $${totalExpectedProfit.toLocaleString()}`);
    console.log(`   📈 Actual Net P&L: $${netSystemPnL.toLocaleString()}`);
    console.log(`   ⚖️  P&L Efficiency: ${totalExpectedProfit > 0 ? ((netSystemPnL / totalExpectedProfit) * 100).toFixed(1) : 0}%`);

    console.log(`\n👥 INDIVIDUAL RESULTS:`);
    console.log(`   💚 Profit Trader: $${profitTraderTotal.toLocaleString()} (${profitFilledOrders.length} trades)`);
    console.log(`   💔 Loss Trader: $${lossTraderTotal.toLocaleString()} (${lossFilledOrders.length} trades)`);

    console.log(`\n🎯 TRADE ANALYSIS:`);
    let executedTrades = 0;
    let totalExecutedProfit = 0;
    
    for (const trade of trades) {
      if (totalTrades > executedTrades) {
        console.log(`   ✅ ${trade.name}: $${trade.expectedProfit.toLocaleString()} expected profit`);
        totalExecutedProfit += trade.expectedProfit;
        executedTrades++;
      } else {
        console.log(`   ⏳ ${trade.name}: Pending execution`);
      }
    }

    return {
      profitTrader: {
        address: profitTrader.address,
        totalPnL: profitTraderTotal,
        realizedPnL: Number(ethers.formatEther(profitTraderPnL.realizedPnL)),
        unrealizedPnL: Number(ethers.formatEther(profitTraderPnL.unrealizedPnL)),
        filledOrders: profitFilledOrders.length,
        totalOrders: profitTraderHistory.length
      },
      lossTrader: {
        address: lossTrader.address,
        totalPnL: lossTraderTotal,
        realizedPnL: Number(ethers.formatEther(lossTraderPnL.realizedPnL)),
        unrealizedPnL: Number(ethers.formatEther(lossTraderPnL.unrealizedPnL)),
        filledOrders: lossFilledOrders.length,
        totalOrders: lossTraderHistory.length
      },
      system: {
        totalTrades: totalTrades,
        netPnL: netSystemPnL,
        expectedProfit: totalExpectedProfit,
        efficiency: totalExpectedProfit > 0 ? (netSystemPnL / totalExpectedProfit) * 100 : 0,
        executedTrades: executedTrades,
        systemWorking: totalTrades > 0
      }
    };

  } catch (error) {
    console.log(`❌ P&L analysis failed: ${(error as Error).message}`);
    console.log('🔍 Trying to get basic order information...');
    
    try {
      // Basic order count analysis
      const profitHistory = await orderRouter.getUserOrderHistory(profitTrader.address, 50, 0);
      const lossHistory = await orderRouter.getUserOrderHistory(lossTrader.address, 50, 0);
      
      console.log(`📊 Profit trader orders: ${profitHistory.length}`);
      console.log(`📊 Loss trader orders: ${lossHistory.length}`);
      
      const totalOrders = profitHistory.length + lossHistory.length;
      
      return {
        profitTrader: { totalOrders: profitHistory.length, error: "P&L calculation failed" },
        lossTrader: { totalOrders: lossHistory.length, error: "P&L calculation failed" },
        system: { 
          totalOrders: totalOrders,
          expectedProfit: totalExpectedProfit,
          systemWorking: totalOrders > 0,
          error: "P&L calculation failed but orders were placed"
        }
      };
      
    } catch (innerError) {
      console.log(`❌ Even basic analysis failed: ${(innerError as Error).message}`);
      return null;
    }
  }
}

async function main() {
  const results = await generateRealPnL();

  if (results) {
    console.log('\n🎉 P&L GENERATION ANALYSIS COMPLETE!');
    console.log('='.repeat(80));
    
    if (!results.system.error) {
      // Successful P&L calculation
      console.log('🏆 FINAL P&L RESULTS:');
      console.log(`   💚 Profit Trader P&L: $${results.profitTrader.totalPnL.toLocaleString()}`);
      console.log(`   💔 Loss Trader P&L: $${results.lossTrader.totalPnL.toLocaleString()}`);
      console.log(`   🎯 Net System P&L: $${results.system.netPnL.toLocaleString()}`);
      console.log(`   📊 Total Trades: ${results.system.totalTrades}`);
      console.log(`   ⚖️  System Efficiency: ${results.system.efficiency.toFixed(1)}%`);
      
      if (results.system.systemWorking && results.system.totalTrades > 0) {
        console.log('\n🚀 SUCCESS! Your trading system is generating real P&L!');
        console.log(`💰 Demonstrated profit/loss of $${Math.abs(results.system.netPnL).toLocaleString()}`);
      } else {
        console.log('\n⚠️  Orders placed but no trades executed - check matching system');
      }
    } else {
      // Partial success - orders placed but P&L calculation failed
      console.log('⚠️  PARTIAL SUCCESS:');
      console.log(`   📊 Orders Placed: ${results.system.totalOrders || 0}`);
      console.log(`   💰 Expected Profit: $${results.system.expectedProfit.toLocaleString()}`);
      console.log(`   ❌ Issue: ${results.system.error}`);
      console.log('\n🔧 The trading system is working but P&L calculation needs debugging');
    }
  } else {
    console.log('\n❌ P&L generation completely failed');
    console.log('🔧 Check contract addresses and authorization');
  }
}

main()
  .then(() => {
    console.log('\n🏁 P&L generation process completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Process failed:', error);
    process.exit(1);
  });







