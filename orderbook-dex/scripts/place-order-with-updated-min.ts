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
  console.log("🚀 Placing $10 USD Order on SILVER_V1");
  console.log("=====================================");
  
  const [signer] = await ethers.getSigners();
  console.log("📋 Using account:", signer.address);
  
  // Load contracts
  const centralVault = await ethers.getContractAt("CentralVault", POLYGON_CONTRACTS.centralVault, signer);
  const orderRouter = await ethers.getContractAt("OrderRouter", POLYGON_CONTRACTS.orderRouter, signer);
  
  // Check vault balance
  const vaultBalance = await centralVault.getUserBalance(signer.address, POLYGON_CONTRACTS.mockUSDC);
  console.log(`Vault Balance: ${ethers.formatUnits(vaultBalance.available, USDC_DECIMALS)} USDC available`);
  
  console.log("\n📊 Setting up $10 USD order...");
  
  // Use the EXACT minimum order size that was set: 1e9
  const quantity = ethers.toBigInt("1000000000"); // 1e9 (EXACT from update script)
  const TICK_SIZE = ethers.parseEther("0.01"); // 0.01 ETH = $1.00 in this system
  const price = ethers.parseEther("0.1"); // 0.1 ETH = $10.00 (10 * tick size)
  
  const PRICE_PRECISION = ethers.parseEther("1"); // 1e18
  const requiredCollateral18 = (quantity * price) / PRICE_PRECISION; // 18-dec result
  const requiredCollateralUSDC = requiredCollateral18; // compared directly on-chain to 6-dec balance
  
  console.log(`🔍 Analysis:`);
  console.log(`  Quantity (raw 18-dec): ${quantity.toString()} (~${ethers.formatEther(quantity)} units)`);
  console.log(`  Price: ${ethers.formatEther(price)} ETH ($10.00 USD equivalent)`);
  console.log(`  Required Collateral (18-dec): ${requiredCollateral18.toString()}`);
  console.log(`  Required Collateral (USDC view): ${ethers.formatUnits(requiredCollateralUSDC, USDC_DECIMALS)} USDC`);
  const isTickAligned = (price % TICK_SIZE) === 0n;
  console.log(`  Price Tick-Aligned: ${isTickAligned ? "✅" : "❌"}`);
  const hasSufficientBalance = requiredCollateralUSDC <= vaultBalance.available;
  console.log(`  Sufficient Balance: ${hasSufficientBalance ? "✅" : "❌"}`);
  
  if (!hasSufficientBalance) {
    console.log(`❌ Insufficient balance: need ${ethers.formatUnits(requiredCollateralUSDC, USDC_DECIMALS)} USDC, have ${ethers.formatUnits(vaultBalance.available, USDC_DECIMALS)} USDC`);
    return;
  }
  
  console.log("\n🎯 Placing limit order with corrected parameters...");
  
  // Create order using exact structure from successful fixed script
  const order = {
    orderId: 0, // Will be set by the contract
    trader: signer.address,
    metricId: SILVER_MARKET.metricId,
    orderType: 1, // LIMIT
    side: 0, // BUY
    quantity: quantity,
    price: price,
    filledQuantity: 0, // Will be updated by contract
    timestamp: 0, // Will be set by contract
    expiryTime: 0,
    status: 0, // PENDING
    timeInForce: 0, // GTC
    stopPrice: 0, // Not used for basic orders
    icebergQty: 0, // Not used for basic orders
    postOnly: false, // Not used for basic orders
    metadataHash: ethers.ZeroHash // No metadata
  };
  
  try {
    // Test gas estimation first
    const gasEstimate = await orderRouter.placeOrder.estimateGas(order);
    console.log(`Gas estimate: ${gasEstimate.toString()}`);
    
    // Place the order
    const tx = await orderRouter.placeOrder(order);
    console.log(`Transaction submitted: ${tx.hash}`);
    console.log("⏳ Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log("🎉 ORDER PLACED SUCCESSFULLY!");
    
    // Parse events to get order ID
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
        // Ignore parsing errors for other events
      }
    }
    
    console.log("\n🎉 SUCCESS: $10 USD Order Completed!");
    console.log("=====================================");
    console.log(`✅ Transaction: ${tx.hash}`);
    console.log(`✅ Gas used: ${receipt!.gasUsed.toString()}`);
    console.log(`✅ Quantity: ${ethers.formatEther(quantity)} units`);
    console.log(`✅ Price: ${ethers.formatEther(price)} ETH ($10.00 USD)`);
    console.log(`✅ Order Type: BUY Limit`);
    console.log(`✅ Market: ${SILVER_MARKET.metricId}`);
    console.log(`✅ USD Value: $10.00 per unit`);
    console.log(`\n🔗 View on Polygonscan: https://polygonscan.com/tx/${tx.hash}`);
    
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
