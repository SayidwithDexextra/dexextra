import { ethers } from "hardhat";

async function createMatchingTrades() {
  console.log('⚖️ CREATING MATCHING TRADES');
  console.log('='.repeat(80));
  console.log('🎯 Placing buy orders to match existing sell orders and generate P&L');
  console.log('='.repeat(80));

  // Contract addresses
  const contracts = {
    mockUSDC: "0x3371ce5d3164ABf183C676e2FC987597e8191892",
    centralVault: "0xc94fb667207206eEe88C203B4dF56Be99a30c8Ea",
    orderRouter: "0xFBd6B734109567937d1d9F1a41Ce86f8d6632BF2",
    orderBook: "0x1FCccd6827eAc7cA1c18596A6ed52A8B1b51f195"
  };

  // Get signers - we'll use different traders for buy orders
  const signers = await ethers.getSigners();

  // Trader mapping for buy orders (different from sellers)
  const buyTraders = [
    { signer: signers[5], name: "⚡ Speed Trader", address: signers[5].address },
    { signer: signers[6], name: "🎢 Volatility Trader", address: signers[6].address },
    { signer: signers[8], name: "🎪 Stress Tester", address: signers[8].address },
    { signer: signers[9], name: "🔬 Edge Case Tester", address: signers[9].address }
  ];

  // Get contract instances
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const OrderRouter = await ethers.getContractFactory("OrderRouter");

  const mockUSDC = MockUSDC.attach(contracts.mockUSDC);
  const orderRouter = OrderRouter.attach(contracts.orderRouter);

  console.log('\n💰 FUNDING BUY TRADERS...');
  console.log('-'.repeat(50));

  // Fund buy traders with USDC and deposit to vault
  for (const trader of buyTraders) {
    try {
      console.log(`💰 Funding ${trader.name}...`);

      // Mint and deposit USDC
      const fundingAmount = ethers.parseUnits("50000000", 6); // 50M USDC each
      await mockUSDC.mint(trader.address, fundingAmount);
      await mockUSDC.connect(trader.signer).approve(contracts.centralVault, fundingAmount);

      // Import CentralVault to deposit
      const CentralVault = await ethers.getContractFactory("CentralVault");
      const centralVault = CentralVault.attach(contracts.centralVault);
      await centralVault.connect(trader.signer).depositPrimaryCollateral(fundingAmount);

      console.log(`   ✅ ${trader.name} funded with $50M USDC`);
    } catch (error) {
      console.log(`   ❌ Failed to fund ${trader.name}: ${(error as Error).message}`);
    }
  }

  console.log('\n📊 ANALYZING EXISTING SELL ORDERS...');
  console.log('-'.repeat(50));

  // Get existing sell orders by checking recent order history
  const sellOrders = [];

  for (let i = 0; i < 10; i++) {
    try {
      const trader = signers[i];
      const orderHistory = await orderRouter.getUserOrderHistory(trader.address, 20, 0);

      for (const order of orderHistory) {
        if (order.side === 1 && (order.status === 0 || order.status === 1)) { // SELL and PENDING/PARTIAL
          sellOrders.push({
            orderId: order.orderId,
            trader: trader.address,
            traderName: i === 0 ? "🐋 Whale Trader" :
                       i === 1 ? "🏦 Institution A" :
                       i === 2 ? "🏛️ Institution B" :
                       i === 3 ? "📈 High Volume Trader" :
                       i === 4 ? "💼 Market Maker" :
                       i === 5 ? "🎯 Arbitrageur" :
                       i === 6 ? "⚡ Speed Trader" :
                       i === 7 ? "🎢 Volatility Trader" :
                       i === 8 ? "🎪 Stress Tester" : "🔬 Edge Case Tester",
            quantity: order.quantity,
            price: order.price,
            filledQuantity: order.filledQuantity
          });
        }
      }
    } catch (error) {
      console.log(`   ❌ Failed to get orders for trader ${i}: ${(error as Error).message}`);
    }
  }

  console.log(`📋 Found ${sellOrders.length} active sell orders to match:`);

  for (const order of sellOrders) {
    const remainingQty = order.quantity - order.filledQuantity;
    console.log(`   • ${order.traderName}: ${ethers.formatEther(remainingQty)} units @ $${ethers.formatEther(order.price)}`);
  }

  console.log('\n🎯 PLACING MATCHING BUY ORDERS...');
  console.log('-'.repeat(50));

  let matchCount = 0;
  let totalVolume = BigInt(0);

  // Create matching buy orders for each sell order
  for (let i = 0; i < sellOrders.length && i < buyTraders.length; i++) {
    const sellOrder = sellOrders[i];
    const buyTrader = buyTraders[i % buyTraders.length];

    try {
      const remainingQty = sellOrder.quantity - sellOrder.filledQuantity;
      const matchPrice = sellOrder.price; // Buy at the sell price to match

      console.log(`\n📋 Creating match for ${sellOrder.traderName}'s sell order:`);
      console.log(`   📊 Quantity: ${ethers.formatEther(remainingQty)} units`);
      console.log(`   💰 Price: $${ethers.formatEther(matchPrice)}`);
      console.log(`   👤 Buyer: ${buyTrader.name}`);

      const buyOrder = {
        orderId: 0,
        trader: buyTrader.address,
        metricId: "WORLD_POPULATION_2024",
        orderType: 1, // LIMIT
        side: 0, // BUY
        quantity: remainingQty,
        price: matchPrice,
        filledQuantity: 0,
        timestamp: 0,
        expiryTime: 0,
        status: 0,
        timeInForce: 0,
        stopPrice: 0,
        icebergQty: 0,
        postOnly: false,
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes("MATCHING_BUY_ORDER"))
      };

      const startTime = performance.now();
      const tx = await orderRouter.connect(buyTrader.signer).placeOrder(buyOrder);
      const receipt = await tx.wait();
      const endTime = performance.now();

      const notional = (remainingQty * matchPrice) / ethers.parseEther("1");
      totalVolume += notional;

      console.log(`   ✅ Buy order placed successfully!`);
      console.log(`   ⛽ Gas used: ${receipt?.gasUsed?.toLocaleString()}`);
      console.log(`   ⚡ Processing time: ${(endTime - startTime).toFixed(2)}ms`);
      console.log(`   💰 Notional value: $${ethers.formatUnits(notional, 6)}`);

      matchCount++;

      // Wait a bit between orders to allow processing
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.log(`   ❌ Failed to place matching buy order: ${(error as Error).message}`);
    }
  }

  console.log('\n🎯 MATCHING COMPLETED!');
  console.log('='.repeat(80));

  console.log(`📊 MATCHING RESULTS:`);
  console.log(`   ✅ Matching orders created: ${matchCount}`);
  console.log(`   💰 Total matching volume: $${ethers.formatUnits(totalVolume, 6)}`);
  console.log(`   📈 Average match size: $${ethers.formatUnits(totalVolume / BigInt(matchCount || 1), 6)}`);

  // Now check if orders actually executed by waiting a moment
  console.log('\n⏳ WAITING FOR ORDER EXECUTION...');
  console.log('-'.repeat(50));

  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

  console.log('🔍 Checking execution status...');

  let executedTrades = 0;
  let totalExecutedVolume = BigInt(0);

  // Check execution status of some orders
  for (const sellOrder of sellOrders.slice(0, 3)) { // Check first 3
    try {
      const executions = await orderRouter.getOrderExecutions(sellOrder.orderId);
      if (executions.length > 0) {
        executedTrades++;
        for (const execution of executions) {
          totalExecutedVolume += execution.executedQuantity * execution.executedPrice / ethers.parseEther("1");
        }
        console.log(`   ✅ Order ${sellOrder.orderId} executed: ${executions.length} trade(s)`);
      } else {
        console.log(`   ⏳ Order ${sellOrder.orderId} still pending`);
      }
    } catch (error) {
      console.log(`   ❌ Failed to check order ${sellOrder.orderId}: ${(error as Error).message}`);
    }
  }

  console.log('\n📊 EXECUTION SUMMARY:');
  console.log(`   🔄 Orders with executions: ${executedTrades}`);
  console.log(`   💰 Executed volume: $${ethers.formatUnits(totalExecutedVolume, 6)}`);
  console.log(`   📊 Execution rate: ${((executedTrades / matchCount) * 100).toFixed(1)}%`);

  console.log('\n🎉 MATCHING PROCESS COMPLETE!');
  console.log('='.repeat(80));
  console.log('💡 Next: Run the P&L analysis to see profit/loss results!');

  return {
    matchesCreated: matchCount,
    totalVolume: ethers.formatUnits(totalVolume, 6),
    executedTrades: executedTrades,
    executedVolume: ethers.formatUnits(totalExecutedVolume, 6)
  };
}

async function main() {
  const results = await createMatchingTrades();

  console.log('\n📋 QUICK SUMMARY:');
  console.log(`🎯 Matching orders created: ${results.matchesCreated}`);
  console.log(`💰 Total matching volume: $${results.totalVolume}`);
  console.log(`✅ Executed trades: ${results.executedTrades}`);
  console.log(`💸 Executed volume: $${results.executedVolume}`);
}

main()
  .then(() => {
    console.log('\n🏁 Matching trades creation completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Matching failed:', error);
    process.exit(1);
  });







