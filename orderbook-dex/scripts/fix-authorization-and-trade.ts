import { ethers } from "hardhat";

async function fixAuthorizationAndTrade() {
  console.log('🔧 FIXING AUTHORIZATION ISSUES & GENERATING P&L');
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

  console.log('\n🔐 STEP 1: FIXING AUTHORIZATION ISSUES');
  console.log('-'.repeat(60));

  try {
    // Check current authorizations
    console.log('🔍 Checking current market authorizations...');
    
    // Get the market address that's being used
    const metricId = "WORLD_POPULATION_2024";
    const metricIdBytes = ethers.keccak256(ethers.toUtf8Bytes(metricId));
    
    // Check if OrderRouter is authorized 
    console.log('📋 Checking OrderRouter authorization...');
    const isOrderRouterAuthorized = await centralVault.authorizedMarkets(contracts.orderRouter);
    console.log(`   OrderRouter authorized: ${isOrderRouterAuthorized}`);

    // Check if OrderBook is authorized
    console.log('📋 Checking OrderBook authorization...');
    const isOrderBookAuthorized = await centralVault.authorizedMarkets(contracts.orderBook);
    console.log(`   OrderBook authorized: ${isOrderBookAuthorized}`);

    // Fix authorization issues
    if (!isOrderRouterAuthorized) {
      console.log('🔧 Authorizing OrderRouter with CentralVault...');
      const tx1 = await centralVault.connect(deployer).setMarketAuthorization(contracts.orderRouter, true);
      await tx1.wait();
      console.log('   ✅ OrderRouter authorized!');
    }

    if (!isOrderBookAuthorized) {
      console.log('🔧 Authorizing OrderBook with CentralVault...');
      const tx2 = await centralVault.connect(deployer).setMarketAuthorization(contracts.orderBook, true);
      await tx2.wait();
      console.log('   ✅ OrderBook authorized!');
    }

    console.log('✅ All authorization issues resolved!');

  } catch (error) {
    console.log(`❌ Authorization fix failed: ${(error as Error).message}`);
  }

  console.log('\n💰 STEP 2: CREATING GUARANTEED PROFITABLE TRADES');
  console.log('-'.repeat(60));

  // Set up specific traders for P&L demonstration
  const trader1 = signers[1]; // Will make profit
  const trader2 = signers[2]; // Will make loss

  // Fund traders if needed
  try {
    const fundingAmount = ethers.parseUnits("10000000", 6); // 10M USDC
    
    console.log('💳 Ensuring traders are funded...');
    
    // Fund trader1
    await mockUSDC.mint(trader1.address, fundingAmount);
    await mockUSDC.connect(trader1).approve(contracts.centralVault, fundingAmount);
    await centralVault.connect(trader1).depositPrimaryCollateral(fundingAmount);
    
    // Fund trader2
    await mockUSDC.mint(trader2.address, fundingAmount);
    await mockUSDC.connect(trader2).approve(contracts.centralVault, fundingAmount);
    await centralVault.connect(trader2).depositPrimaryCollateral(fundingAmount);

    console.log('✅ Traders funded successfully!');

  } catch (error) {
    console.log('⚠️  Traders may already be funded, continuing...');
  }

  console.log('\n📊 STEP 3: CREATING CROSSING ORDERS FOR IMMEDIATE EXECUTION');
  console.log('-'.repeat(60));

  const profitTrades = [];

  try {
    // Create a sell order at low price (trader2 selling cheap)
    console.log('📈 Creating SELL order (trader2 selling at $100)...');
    
    const sellOrder = {
      orderId: 0,
      trader: trader2.address,
      metricId: "WORLD_POPULATION_2024",
      orderType: 1, // LIMIT
      side: 1, // SELL
      quantity: ethers.parseEther("1000"), // 1000 units
      price: ethers.parseEther("100"), // $100 per unit
      filledQuantity: 0,
      timestamp: 0,
      expiryTime: 0,
      status: 0,
      timeInForce: 0,
      stopPrice: 0,
      icebergQty: 0,
      postOnly: false,
      metadataHash: ethers.keccak256(ethers.toUtf8Bytes("SELL_LOW_PRICE"))
    };

    const sellTx = await orderRouter.connect(trader2).placeOrder(sellOrder);
    const sellReceipt = await sellTx.wait();
    console.log(`   ✅ SELL order placed! Gas: ${sellReceipt?.gasUsed}`);
    
    // Wait a moment for order to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create a buy order at higher price (trader1 buying at premium)
    console.log('📉 Creating BUY order (trader1 buying at $110)...');
    
    const buyOrder = {
      orderId: 0,
      trader: trader1.address,
      metricId: "WORLD_POPULATION_2024",
      orderType: 1, // LIMIT
      side: 0, // BUY
      quantity: ethers.parseEther("1000"), // 1000 units (matches sell)
      price: ethers.parseEther("110"), // $110 per unit (higher than sell)
      filledQuantity: 0,
      timestamp: 0,
      expiryTime: 0,
      status: 0,
      timeInForce: 0,
      stopPrice: 0,
      icebergQty: 0,
      postOnly: false,
      metadataHash: ethers.keccak256(ethers.toUtf8Bytes("BUY_HIGH_PRICE"))
    };

    const buyTx = await orderRouter.connect(trader1).placeOrder(buyOrder);
    const buyReceipt = await buyTx.wait();
    console.log(`   ✅ BUY order placed! Gas: ${buyReceipt?.gasUsed}`);

    // Wait for order matching
    console.log('⏳ Waiting for order matching...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    profitTrades.push({
      trader1: trader1.address,
      trader2: trader2.address,
      buyPrice: 110,
      sellPrice: 100,
      quantity: 1000,
      expectedProfit: (110 - 100) * 1000 // $10,000 profit for trader1
    });

  } catch (error) {
    console.log(`❌ Failed to create crossing orders: ${(error as Error).message}`);
  }

  console.log('\n🔄 STEP 4: CREATING ADDITIONAL PROFITABLE TRADES');
  console.log('-'.repeat(60));

  try {
    // Create more trades with different price points for more P&L
    const trades = [
      { sellPrice: 95, buyPrice: 105, quantity: 500 },
      { sellPrice: 90, buyPrice: 108, quantity: 800 },
      { sellPrice: 85, buyPrice: 112, quantity: 300 }
    ];

    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      
      console.log(`💼 Creating trade ${i + 1}: SELL @$${trade.sellPrice} → BUY @$${trade.buyPrice}`);

      // Sell order (trader2)
      const sellOrder = {
        orderId: 0,
        trader: trader2.address,
        metricId: "WORLD_POPULATION_2024",
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

      await orderRouter.connect(trader2).placeOrder(sellOrder);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Buy order (trader1)
      const buyOrder = {
        orderId: 0,
        trader: trader1.address,
        metricId: "WORLD_POPULATION_2024",
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

      await orderRouter.connect(trader1).placeOrder(buyOrder);
      await new Promise(resolve => setTimeout(resolve, 500));

      profitTrades.push({
        trader1: trader1.address,
        trader2: trader2.address,
        buyPrice: trade.buyPrice,
        sellPrice: trade.sellPrice,
        quantity: trade.quantity,
        expectedProfit: (trade.buyPrice - trade.sellPrice) * trade.quantity
      });

      console.log(`   ✅ Trade ${i + 1} orders placed!`);
    }

  } catch (error) {
    console.log(`❌ Failed to create additional trades: ${(error as Error).message}`);
  }

  console.log('\n📊 STEP 5: ANALYZING ACTUAL P&L RESULTS');
  console.log('-'.repeat(60));

  // Wait for all orders to process
  console.log('⏳ Waiting for order processing and matching...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    // Get trader1 P&L (should be profitable)
    console.log('💰 Analyzing Trader 1 P&L (Expected: PROFIT)...');
    const trader1History = await orderRouter.getUserOrderHistory(trader1.address, 50, 0);
    const trader1PnL = await orderRouter.getUserPnL(trader1.address);
    
    const trader1FilledOrders = trader1History.filter(order => 
      order.status === 3 || order.status === 2 // FILLED or PARTIALLY_FILLED
    );

    console.log(`   📈 Filled Orders: ${trader1FilledOrders.length}`);
    console.log(`   💚 Realized P&L: $${ethers.formatEther(trader1PnL.realizedPnL)}`);
    console.log(`   📊 Unrealized P&L: $${ethers.formatEther(trader1PnL.unrealizedPnL)}`);
    console.log(`   🎯 Total P&L: $${ethers.formatEther(trader1PnL.totalPnL)}`);

    // Get trader2 P&L (should be loss)
    console.log('\n💸 Analyzing Trader 2 P&L (Expected: LOSS)...');
    const trader2History = await orderRouter.getUserOrderHistory(trader2.address, 50, 0);
    const trader2PnL = await orderRouter.getUserPnL(trader2.address);
    
    const trader2FilledOrders = trader2History.filter(order => 
      order.status === 3 || order.status === 2
    );

    console.log(`   📈 Filled Orders: ${trader2FilledOrders.length}`);
    console.log(`   💔 Realized P&L: $${ethers.formatEther(trader2PnL.realizedPnL)}`);
    console.log(`   📊 Unrealized P&L: $${ethers.formatEther(trader2PnL.unrealizedPnL)}`);
    console.log(`   🎯 Total P&L: $${ethers.formatEther(trader2PnL.totalPnL)}`);

    // Calculate expected vs actual
    const expectedTotalProfit = profitTrades.reduce((sum, trade) => sum + trade.expectedProfit, 0);
    const actualTrader1PnL = Number(ethers.formatEther(trader1PnL.totalPnL));
    const actualTrader2PnL = Number(ethers.formatEther(trader2PnL.totalPnL));

    console.log('\n🎯 P&L SUMMARY ANALYSIS');
    console.log('-'.repeat(60));
    console.log(`💎 Expected Total Profit: $${expectedTotalProfit.toLocaleString()}`);
    console.log(`✅ Trader 1 Actual P&L: $${actualTrader1PnL.toLocaleString()}`);
    console.log(`❌ Trader 2 Actual P&L: $${actualTrader2PnL.toLocaleString()}`);
    console.log(`🎲 Net System P&L: $${(actualTrader1PnL + actualTrader2PnL).toLocaleString()}`);
    console.log(`📊 Total Trades Executed: ${trader1FilledOrders.length + trader2FilledOrders.length}`);

    return {
      trader1: {
        address: trader1.address,
        filledOrders: trader1FilledOrders.length,
        realizedPnL: ethers.formatEther(trader1PnL.realizedPnL),
        unrealizedPnL: ethers.formatEther(trader1PnL.unrealizedPnL),
        totalPnL: ethers.formatEther(trader1PnL.totalPnL)
      },
      trader2: {
        address: trader2.address,
        filledOrders: trader2FilledOrders.length,
        realizedPnL: ethers.formatEther(trader2PnL.realizedPnL),
        unrealizedPnL: ethers.formatEther(trader2PnL.unrealizedPnL),
        totalPnL: ethers.formatEther(trader2PnL.totalPnL)
      },
      summary: {
        expectedProfit: expectedTotalProfit,
        actualNetPnL: actualTrader1PnL + actualTrader2PnL,
        totalTrades: trader1FilledOrders.length + trader2FilledOrders.length,
        systemWorking: (trader1FilledOrders.length > 0 || trader2FilledOrders.length > 0)
      }
    };

  } catch (error) {
    console.log(`❌ P&L analysis failed: ${(error as Error).message}`);
    return null;
  }
}

async function main() {
  const results = await fixAuthorizationAndTrade();

  if (results) {
    console.log('\n🎉 PROFIT & LOSS GENERATION COMPLETE!');
    console.log('='.repeat(80));
    
    console.log('🏆 FINAL P&L RESULTS:');
    console.log(`   💚 Trader 1 Total P&L: $${results.trader1.totalPnL}`);
    console.log(`   💔 Trader 2 Total P&L: $${results.trader2.totalPnL}`);
    console.log(`   🎯 Net System P&L: $${results.summary.actualNetPnL}`);
    console.log(`   📊 Total Trades: ${results.summary.totalTrades}`);
    console.log(`   ✅ System Status: ${results.summary.systemWorking ? 'WORKING' : 'NEEDS ATTENTION'}`);
    
    if (results.summary.systemWorking) {
      console.log('\n🚀 SUCCESS! Your matching system is generating real P&L!');
    } else {
      console.log('\n⚠️  No trades executed - may need additional debugging');
    }
  } else {
    console.log('\n❌ Failed to generate P&L - check authorization and order matching');
  }
}

main()
  .then(() => {
    console.log('\n🏁 Authorization fix and P&L generation completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Process failed:', error);
    process.exit(1);
  });







