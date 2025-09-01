import { ethers } from "hardhat";

async function simplePnLDemo() {
  console.log('💰 SIMPLE P&L DEMONSTRATION');
  console.log('='.repeat(80));
  console.log('🎯 Creating one SELL order and one BUY order that WILL match');
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
  const seller = signers[1];  // Will sell at $90
  const buyer = signers[2];   // Will buy at $110

  // Get contract instances
  const CentralVault = await ethers.getContractFactory("CentralVault");
  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");

  const centralVault = CentralVault.attach(contracts.centralVault);
  const orderRouter = OrderRouter.attach(contracts.orderRouter);
  const mockUSDC = MockUSDC.attach(contracts.mockUSDC);

  const metricId = "WORLD_POPULATION_2024";

  console.log('\n💳 STEP 1: ENSURE FRESH FUNDING');
  console.log('-'.repeat(60));

  // Fund both traders with fresh money
  const fundingAmount = ethers.parseUnits("5000000", 6); // 5M USDC each

  try {
    console.log('💰 Funding seller and buyer...');
    
    // Fund seller
    await mockUSDC.mint(seller.address, fundingAmount);
    await mockUSDC.connect(seller).approve(contracts.centralVault, fundingAmount);
    await centralVault.connect(seller).depositPrimaryCollateral(fundingAmount);
    console.log(`   ✅ Seller funded: $5M`);
    
    // Fund buyer
    await mockUSDC.mint(buyer.address, fundingAmount);
    await mockUSDC.connect(buyer).approve(contracts.centralVault, fundingAmount);
    await centralVault.connect(buyer).depositPrimaryCollateral(fundingAmount);
    console.log(`   ✅ Buyer funded: $5M`);

  } catch (error) {
    console.log('⚠️  Traders may already be funded, continuing...');
  }

  console.log('\n📊 STEP 2: CREATE CROSSING ORDERS');
  console.log('-'.repeat(60));

  const quantity = 1000; // 1000 units
  const sellPrice = 90;  // Seller will sell at $90
  const buyPrice = 110;  // Buyer will buy at $110 (higher price = guaranteed match)
  const expectedProfit = (buyPrice - sellPrice) * quantity; // $20,000 total profit

  console.log(`💡 Trade Setup:`);
  console.log(`   📊 Quantity: ${quantity} units`);
  console.log(`   💸 Sell Price: $${sellPrice} (seller gets this)`);
  console.log(`   💰 Buy Price: $${buyPrice} (buyer pays this)`);
  console.log(`   🎯 Expected Match Price: $${sellPrice} (seller's price)`);
  console.log(`   💚 Expected Buyer P&L: -$${sellPrice * quantity} (pays for assets)`);
  console.log(`   💔 Expected Seller P&L: +$${sellPrice * quantity} (receives payment)`);

  try {
    // Create SELL order first (at $90)
    console.log('\n📈 Creating SELL order...');
    
    const sellOrder = {
      orderId: 0,
      trader: seller.address,
      metricId: metricId,
      orderType: 1, // LIMIT
      side: 1, // SELL
      quantity: ethers.parseEther(quantity.toString()),
      price: ethers.parseEther(sellPrice.toString()),
      filledQuantity: 0,
      timestamp: 0,
      expiryTime: 0,
      status: 0,
      timeInForce: 0,
      stopPrice: 0,
      icebergQty: 0,
      postOnly: false,
      metadataHash: ethers.keccak256(ethers.toUtf8Bytes(`SELL_SIMPLE_${sellPrice}`))
    };

    const sellTx = await orderRouter.connect(seller).placeOrder(sellOrder);
    const sellReceipt = await sellTx.wait();
    console.log(`   ✅ SELL order placed! Gas: ${sellReceipt?.gasUsed}`);
    console.log(`   🔗 Tx: ${sellTx.hash}`);

    // Wait a moment for the order to be processed
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Create BUY order (at $110 - higher than sell, so should match immediately)
    console.log('\n📉 Creating BUY order (should match immediately)...');
    
    const buyOrder = {
      orderId: 0,
      trader: buyer.address,
      metricId: metricId,
      orderType: 1, // LIMIT
      side: 0, // BUY
      quantity: ethers.parseEther(quantity.toString()),
      price: ethers.parseEther(buyPrice.toString()),
      filledQuantity: 0,
      timestamp: 0,
      expiryTime: 0,
      status: 0,
      timeInForce: 0,
      stopPrice: 0,
      icebergQty: 0,
      postOnly: false,
      metadataHash: ethers.keccak256(ethers.toUtf8Bytes(`BUY_SIMPLE_${buyPrice}`))
    };

    const buyTx = await orderRouter.connect(buyer).placeOrder(buyOrder);
    const buyReceipt = await buyTx.wait();
    console.log(`   ✅ BUY order placed! Gas: ${buyReceipt?.gasUsed}`);
    console.log(`   🔗 Tx: ${buyTx.hash}`);

  } catch (error) {
    console.log(`❌ Order creation failed: ${(error as Error).message}`);
    return;
  }

  console.log('\n⏳ STEP 3: WAITING FOR AUTOMATIC MATCHING');
  console.log('-'.repeat(60));

  console.log('🔄 Allowing time for automatic order matching...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('\n📊 STEP 4: ANALYZING P&L RESULTS');
  console.log('-'.repeat(60));

  try {
    // Check seller's position
    console.log('💸 SELLER P&L ANALYSIS:');
    
    const sellerHistory = await orderRouter.getUserOrderHistory(seller.address, 10, 0);
    const sellerFilledOrders = sellerHistory.filter(order => order.status >= 2);
    
    console.log(`   📈 Recent orders: ${sellerHistory.length} total, ${sellerFilledOrders.length} filled`);
    
    try {
      const sellerPnL = await orderRouter.getUserPnL(seller.address, metricId);
      const sellerRealizedPnL = Number(ethers.formatEther(sellerPnL.realizedPnL));
      const sellerUnrealizedPnL = Number(ethers.formatEther(sellerPnL.unrealizedPnL));
      const sellerTotalPnL = sellerRealizedPnL + sellerUnrealizedPnL;

      console.log(`   💰 Realized P&L: $${sellerRealizedPnL.toLocaleString()}`);
      console.log(`   📊 Unrealized P&L: $${sellerUnrealizedPnL.toLocaleString()}`);
      console.log(`   🎯 TOTAL P&L: $${sellerTotalPnL.toLocaleString()}`);
    } catch (error) {
      console.log(`   ❌ P&L calculation failed: ${(error as Error).message}`);
    }

    // Check buyer's position
    console.log('\n💰 BUYER P&L ANALYSIS:');
    
    const buyerHistory = await orderRouter.getUserOrderHistory(buyer.address, 10, 0);
    const buyerFilledOrders = buyerHistory.filter(order => order.status >= 2);
    
    console.log(`   📈 Recent orders: ${buyerHistory.length} total, ${buyerFilledOrders.length} filled`);
    
    try {
      const buyerPnL = await orderRouter.getUserPnL(buyer.address, metricId);
      const buyerRealizedPnL = Number(ethers.formatEther(buyerPnL.realizedPnL));
      const buyerUnrealizedPnL = Number(ethers.formatEther(buyerPnL.unrealizedPnL));
      const buyerTotalPnL = buyerRealizedPnL + buyerUnrealizedPnL;

      console.log(`   💰 Realized P&L: $${buyerRealizedPnL.toLocaleString()}`);
      console.log(`   📊 Unrealized P&L: $${buyerUnrealizedPnL.toLocaleString()}`);
      console.log(`   🎯 TOTAL P&L: $${buyerTotalPnL.toLocaleString()}`);
    } catch (error) {
      console.log(`   ❌ P&L calculation failed: ${(error as Error).message}`);
    }

    // Summary
    const totalFilledOrders = sellerFilledOrders.length + buyerFilledOrders.length;
    
    console.log('\n🏆 TRADE EXECUTION SUMMARY');
    console.log('='.repeat(80));
    console.log(`📊 Orders Placed: 2 (1 SELL + 1 BUY)`);
    console.log(`✅ Orders Filled: ${totalFilledOrders}`);
    console.log(`💰 Expected Trade Value: $${(sellPrice * quantity).toLocaleString()}`);
    
    if (totalFilledOrders > 0) {
      console.log('\n🎉 SUCCESS! Orders matched and P&L generated!');
      console.log('💰 The system is working and creating real profit/loss!');
      
      // Show order details
      if (sellerFilledOrders.length > 0) {
        const order = sellerFilledOrders[0];
        console.log(`📈 Seller filled: ${ethers.formatEther(order.quantity)} units @ $${ethers.formatEther(order.price)}`);
      }
      
      if (buyerFilledOrders.length > 0) {
        const order = buyerFilledOrders[0];
        console.log(`📉 Buyer filled: ${ethers.formatEther(order.quantity)} units @ $${ethers.formatEther(order.price)}`);
      }
      
    } else {
      console.log('\n⚠️  Orders placed but not filled - checking why...');
      
      // Check most recent orders
      if (sellerHistory.length > 0) {
        const lastSellOrder = sellerHistory[0];
        const sellStatus = ['PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'][lastSellOrder.status] || 'UNKNOWN';
        console.log(`📈 Last SELL order status: ${sellStatus}`);
      }
      
      if (buyerHistory.length > 0) {
        const lastBuyOrder = buyerHistory[0];
        const buyStatus = ['PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'][lastBuyOrder.status] || 'UNKNOWN';
        console.log(`📉 Last BUY order status: ${buyStatus}`);
      }
    }

    return {
      sellerFilledOrders: sellerFilledOrders.length,
      buyerFilledOrders: buyerFilledOrders.length,
      totalFilledOrders: totalFilledOrders,
      expectedTradeValue: sellPrice * quantity,
      systemWorking: totalFilledOrders > 0
    };

  } catch (error) {
    console.log(`❌ P&L analysis failed: ${(error as Error).message}`);
    return null;
  }
}

async function main() {
  const results = await simplePnLDemo();

  console.log('\n🎉 SIMPLE P&L DEMONSTRATION COMPLETE!');
  console.log('='.repeat(80));

  if (results) {
    console.log('🏆 FINAL RESULTS:');
    console.log(`   📊 Seller filled orders: ${results.sellerFilledOrders}`);
    console.log(`   📊 Buyer filled orders: ${results.buyerFilledOrders}`);
    console.log(`   🎯 Total filled: ${results.totalFilledOrders}`);
    console.log(`   💰 Trade value: $${results.expectedTradeValue.toLocaleString()}`);
    
    if (results.systemWorking) {
      console.log('\n🚀 SUCCESS! Your DEX system is working perfectly!');
      console.log('💰 Real P&L has been generated through actual trading!');
    } else {
      console.log('\n🔧 DIAGNOSIS: Orders placed but not executing');
      console.log('💡 The system may need additional configuration for automatic matching');
    }
  } else {
    console.log('❌ Demo failed - check system configuration');
  }
}

main()
  .then(() => {
    console.log('\n🏁 Simple P&L demonstration completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Demo failed:', error);
    process.exit(1);
  });







