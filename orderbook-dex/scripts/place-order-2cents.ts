import { ethers } from "hardhat";

// Live Polygon contract addresses
const POLYGON_CONTRACTS = {
  centralVault: "0x9E5996Cb44AC7F60a9A46cACF175E87ab677fC1C",
  orderRouter: "0x516a1790a04250FC6A5966A528D02eF20E1c1891",
  mockUSDC: "0xff541e2AEc7716725f8EDD02945A1Fe15664588b"
};

const SILVER_MARKET = {
  metricId: "SILVER_V1"
};

const USDC_DECIMALS = 6;

async function main() {
  console.log("🚀 Placing 0.02 ETH Limit Order - Using EXACT Successful Pattern");
  console.log("================================================================");
  
  const [signer] = await ethers.getSigners();
  console.log("📋 Using account:", signer.address);
  
  // Load contracts
  const centralVault = await ethers.getContractAt("CentralVault", POLYGON_CONTRACTS.centralVault, signer);
  const orderRouter = await ethers.getContractAt("OrderRouter", POLYGON_CONTRACTS.orderRouter, signer);
  
  // Check vault balance (no minting, use existing collateral)
  const vaultBalance = await centralVault.getUserBalance(signer.address, POLYGON_CONTRACTS.mockUSDC);
  console.log(`Vault Balance: ${ethers.formatUnits(vaultBalance.available, USDC_DECIMALS)} USDC available`);
  
  console.log("\n📊 Using EXACT parameters from successful test-with-more-collateral.ts...");
  
  // EXACT same parameters as the successful script, but price 0.02 instead of 0.01
  const orderQuantity = ethers.parseEther("0.1"); // 0.1 units (EXACT from successful test)
  const orderPrice = ethers.parseEther("0.02"); // 0.02 ETH per unit (tick-aligned)
  
  console.log(`Order: ${ethers.formatEther(orderQuantity)} units at ${ethers.formatEther(orderPrice)} ETH/unit`);
  console.log(`Total value: ${ethers.formatEther((orderQuantity * orderPrice) / ethers.parseEther("1"))} ETH`);
  console.log(`Price is tick-aligned: ${(Number(ethers.formatEther(orderPrice)) % 0.01) === 0 ? "✅" : "❌"}`);
  
  // EXACT same order structure as the successful test
  const order = {
    orderId: 0,
    trader: signer.address,
    metricId: SILVER_MARKET.metricId,
    orderType: 1, // LIMIT
    side: 0, // BUY
    quantity: orderQuantity,
    price: orderPrice,
    filledQuantity: 0,
    timestamp: 0,
    expiryTime: 0,
    status: 0, // PENDING
    timeInForce: 0, // GTC
    stopPrice: 0,
    icebergQty: 0,
    postOnly: true, // CRITICAL: same as successful test
    metadataHash: ethers.keccak256(ethers.toUtf8Bytes("ORDER_2_CENTS"))
  };
  
  try {
    console.log("\n🎯 Placing 0.02 ETH limit order...");
    
    const gasEstimate = await orderRouter.placeOrder.estimateGas(order);
    console.log("✅ Order would succeed! Gas estimate:", gasEstimate.toString());
    
    // Actually place the order
    const tx = await orderRouter.placeOrder(order);
    console.log("Transaction submitted:", tx.hash);
    
    const receipt = await tx.wait();
    console.log("🎉 ORDER PLACED SUCCESSFULLY!");
    console.log("Gas used:", receipt!.gasUsed.toString());
    
    // Find the order ID
    let newOrderId: string | null = null;
    for (const log of receipt!.logs) {
      try {
        const parsed = orderRouter.interface.parseLog(log);
        if (parsed?.name === "OrderPlaced") {
          newOrderId = parsed.args[0].toString();
          console.log(`📋 Order ID: ${newOrderId}`);
          console.log(`📋 Trader: ${parsed.args[1]}`);
          console.log(`📋 Side: ${parsed.args[4] === 0 ? "BUY" : "SELL"}`);
          console.log(`📋 Quantity: ${ethers.formatEther(parsed.args[5])} units`);
          console.log(`📋 Price: ${ethers.formatEther(parsed.args[6])} ETH`);
        }
      } catch (error) {
        // Ignore parsing errors
      }
    }
    
    console.log(`\n🔗 View transaction: https://polygonscan.com/tx/${tx.hash}`);
    
    console.log("\n🎉 SUCCESS: 0.02 ETH Limit Order Completed!");
    console.log("============================================");
    console.log(`✅ Transaction: ${tx.hash}`);
    console.log(`✅ Order Price: 0.02 ETH per unit`);
    console.log(`✅ Order Type: BUY Limit`);
    console.log(`✅ Market: ${SILVER_MARKET.metricId}`);
    console.log(`✅ Pattern: Exact copy of successful test`);
    
    // Return order ID for backfill
    if (newOrderId) {
      console.log(`\n🔄 Order ID for Supabase backfill: ${newOrderId}`);
      return { orderId: newOrderId, txHash: tx.hash };
    }
    
    return { orderId: null, txHash: tx.hash };
    
  } catch (error: any) {
    console.error("❌ Order placement failed:");
    console.error(error.message);
    
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    
    throw error;
  }
}

// Run the script
if (require.main === module) {
  main()
    .then((result) => {
      console.log("\n✅ Script completed successfully");
      if (result?.orderId) {
        console.log(`🎯 Ready to backfill Order ID: ${result.orderId}`);
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Script failed:", error);
      process.exit(1);
    });
}

export { main };
