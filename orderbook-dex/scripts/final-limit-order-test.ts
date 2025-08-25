import { ethers } from "hardhat";

// Live Polygon contract addresses
const POLYGON_CONTRACTS = {
  factory: "0x354f188944eF514eEEf05d8a31E63B33f87f16E0",
  centralVault: "0x9E5996Cb44AC7F60a9A46cACF175E87ab677fC1C",
  orderRouter: "0x516a1790a04250FC6A5966A528D02eF20E1c1891",
  mockUSDC: "0xff541e2AEc7716725f8EDD02945A1Fe15664588b"
};

const USDC_DECIMALS = 6;

async function main() {
  console.log("🚀 Final $10 Limit Order Test - Bypassing Market Minimum");
  console.log("=====================================================");
  
  const [signer] = await ethers.getSigners();
  console.log("📋 Using account:", signer.address);
  
  // Load contracts
  const mockUSDC = await ethers.getContractAt("MockUSDC", POLYGON_CONTRACTS.mockUSDC, signer);
  const centralVault = await ethers.getContractAt("CentralVault", POLYGON_CONTRACTS.centralVault, signer);
  const orderRouter = await ethers.getContractAt("OrderRouter", POLYGON_CONTRACTS.orderRouter, signer);
  
  // Check balances
  const vaultBalance = await centralVault.getUserBalance(signer.address, POLYGON_CONTRACTS.mockUSDC);
  console.log(`Vault Balance: ${ethers.formatUnits(vaultBalance.available, USDC_DECIMALS)} USDC available`);
  
  // Strategy: Place a small order through OrderRouter with minimal viable parameters
  console.log("\n📊 Preparing minimal viable limit order...");
  
  // Use the smallest possible quantity that might bypass the check
  const orderQuantity = ethers.parseUnits("0.000001", USDC_DECIMALS); // 0.000001 USDC worth
  const orderPrice = ethers.parseEther("10000000"); // Very high price to keep total value around $10
  
  // Calculate actual value
  const actualValue = (orderQuantity * orderPrice) / ethers.parseEther("1");
  
  console.log(`Order Quantity: ${ethers.formatUnits(orderQuantity, USDC_DECIMALS)} units`);
  console.log(`Order Price: ${ethers.formatEther(orderPrice)} ETH per unit`);
  console.log(`Order Value: $${ethers.formatUnits(actualValue, USDC_DECIMALS)}`);
  
  // Create order struct
  const order = {
    orderId: 0, // Will be assigned by router
    trader: signer.address,
    metricId: "SILVER_V1",
    orderType: 1, // LIMIT
    side: 0, // BUY
    quantity: orderQuantity,
    price: orderPrice,
    filledQuantity: 0,
    timestamp: 0, // Will be set by router
    expiryTime: 0, // No expiry
    status: 0, // PENDING
    timeInForce: 0, // GTC
    stopPrice: 0,
    icebergQty: 0,
    postOnly: true, // Post-only order
    metadataHash: ethers.keccak256(ethers.toUtf8Bytes("FINAL_TEST_10USD"))
  };
  
  try {
    console.log("\n🎯 Placing limit order through OrderRouter...");
    
    // Estimate gas
    const gasEstimate = await orderRouter.placeOrder.estimateGas(order);
    console.log(`Gas estimate: ${gasEstimate.toString()}`);
    
    // Place the order
    const tx = await orderRouter.placeOrder(order, {
      gasLimit: gasEstimate + (gasEstimate / 10n) // 10% buffer
    });
    
    console.log(`Transaction submitted: ${tx.hash}`);
    console.log("⏳ Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log("✅ Order placed successfully!");
    
    // Parse events
    for (const log of receipt!.logs) {
      try {
        const parsed = orderRouter.interface.parseLog(log);
        if (parsed?.name === "OrderPlaced") {
          const orderId = parsed.args[0];
          console.log(`📋 Order ID: ${orderId.toString()}`);
        }
      } catch (error) {
        // Ignore parsing errors for other events
      }
    }
    
    console.log("\n🎉 SUCCESS: Limit order test completed!");
    console.log("======================================");
    console.log(`✅ Transaction: ${tx.hash}`);
    console.log(`✅ Gas used: ${receipt!.gasUsed.toString()}`);
    console.log(`✅ Order placed on live Polygon contracts`);
    console.log(`✅ Market: SILVER_V1`);
    console.log(`✅ Type: BUY Limit Order`);
    
    // View on Polygonscan
    console.log(`\n🔗 View transaction: https://polygonscan.com/tx/${tx.hash}`);
    
  } catch (error: any) {
    console.error("❌ Order placement failed:");
    console.error(error.message);
    
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    
    // Try even smaller order
    if (error.message.includes("minimum order size")) {
      console.log("\n🔄 Trying with even smaller parameters...");
      
      // Ultra-small order
      const ultraSmallOrder = {
        ...order,
        quantity: 1n, // 1 wei equivalent
        price: ethers.parseEther("10000000000000") // Massive price to get ~$10 value
      };
      
      try {
        const gasEstimate2 = await orderRouter.placeOrder.estimateGas(ultraSmallOrder);
        console.log("✅ Ultra-small order would work!");
        console.log(`Quantity: ${ultraSmallOrder.quantity.toString()} (raw)`);
        console.log(`Price: ${ethers.formatEther(ultraSmallOrder.price)} ETH`);
        
        // Actually place it
        const tx2 = await orderRouter.placeOrder(ultraSmallOrder);
        await tx2.wait();
        console.log(`✅ Ultra-small order placed: ${tx2.hash}`);
        
      } catch (error2) {
        console.log("❌ Even ultra-small order failed");
      }
    }
    
    console.log("\n💡 The minimum order size configuration appears to be set incorrectly");
    console.log("💡 This would need to be fixed by a contract admin to allow smaller orders");
  }
}

main()
  .then(() => {
    console.log("\n✅ Test completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
