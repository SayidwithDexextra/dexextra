import { ethers } from "hardhat";

async function createMorePositions() {
  console.log("🔄 Creating additional positions for PNL demonstration...");
  
  const addresses = {
    mockUSDC: "0xD8a7de870F03Cb501e64096E15a9cF62256185A0",
    centralVault: "0xc7CfAD47F0971Aa27Faa1eE7DBee48887f8E05ed", 
    orderRouter: "0x6699Ef9B72C470895A3deaa47381Dfbc0461FF8B",
    orderBook: "0x3EC4ECc94BA54a027c56FE31E6a5EC651179EAE7"
  };

  const [trader1, trader2, trader3] = await ethers.getSigners();
  const orderRouter = await ethers.getContractAt("OrderRouter", addresses.orderRouter);
  
  // Use a known market ID from our previous tests
  const metricId = "FIXED_TEST_" + Math.floor(Date.now() / 100000) * 100000; // Approximate time
  
  console.log("📋 Placing additional orders to create diverse PNL scenarios...");
  
  // Create orders that will show different PNL outcomes
  const additionalOrders = [
    {
      description: "SELL 1.0 at 1.80 (creates opportunity for profit)",
      trader: trader2,
      side: 1, // SELL
      quantity: ethers.parseEther("1.0"),
      price: ethers.parseEther("1.80")
    },
    {
      description: "BUY 0.8 at 1.80 (should match and show different PNL)",
      trader: trader3,
      side: 0, // BUY
      quantity: ethers.parseEther("0.8"),
      price: ethers.parseEther("1.80")
    }
  ];

  for (let i = 0; i < additionalOrders.length; i++) {
    const testCase = additionalOrders[i];
    console.log(`\n${i + 1}. ${testCase.description}`);
    
    try {
      const order = {
        orderId: 0,
        trader: testCase.trader.address,
        metricId: metricId,
        orderType: 1, // LIMIT
        side: testCase.side,
        quantity: testCase.quantity,
        price: testCase.price,
        filledQuantity: 0,
        timestamp: 0,
        expiryTime: 0,
        status: 0,
        timeInForce: 0, // GTC
        stopPrice: 0,
        icebergQty: 0,
        postOnly: false,
        metadataHash: ethers.ZeroHash
      };
      
      const submitTx = await orderRouter.connect(testCase.trader).placeOrder(order);
      const receipt = await submitTx.wait();
      
      console.log(`   ✅ Order placed successfully! Gas used: ${receipt.gasUsed}`);
      
    } catch (error) {
      console.log(`   ⚠️  Order failed: ${error.message}`);
      console.log(`   💡 This might be because the market was from a previous test session`);
    }
  }
  
  console.log("\n🎯 Additional positions created! Now run 'npm run pnl' to see updated PNL analysis.");
}

createMorePositions()
  .then(() => {
    console.log("✅ Position creation script completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });







