import { ethers } from "hardhat";

/**
 * Script to place a $10 buy order with quantity 100 on SILVER_V1 market
 * 
 * Now that minimum order size has been set to effectively 0 (1 wei),
 * we can place an order with quantity 100 at the appropriate price to total $10.
 * 
 * Calculation:
 * - Desired total value: $10
 * - Desired quantity: 100 units
 * - Required price per unit: $10 / 100 = $0.10 per unit
 * - In ETH terms (assuming 1 ETH = $100): $0.10 = 0.001 ETH per unit
 * - BUT: prices must be tick-aligned to 0.01 ETH, so we'll use 0.01 ETH per unit
 * - This makes total value: 100 * 0.01 ETH = 1 ETH (about $100 in this system)
 * 
 * Since the pricing seems to treat ETH amounts as dollar amounts in the mock system,
 * we'll calculate for the mock system where 0.01 ETH represents $0.10.
 */

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
const PRICE_PRECISION = ethers.parseEther("1"); // 1e18

async function main() {
  console.log("🎯 Placing $10 Buy Order with Quantity 100 on SILVER_V1");
  console.log("======================================================");
  
  const [signer] = await ethers.getSigners();
  console.log("📋 Account:", signer.address);
  
  // Load contracts
  const mockUSDC = await ethers.getContractAt("MockUSDC", POLYGON_CONTRACTS.mockUSDC, signer);
  const centralVault = await ethers.getContractAt("CentralVault", POLYGON_CONTRACTS.centralVault, signer);
  const orderRouter = await ethers.getContractAt("OrderRouter", POLYGON_CONTRACTS.orderRouter, signer);
  
  console.log("\n💰 Checking existing collateral...");
  
  // Check vault balance (using existing USDC)
  const vaultBalance = await centralVault.getPrimaryCollateralBalance(signer.address);
  console.log(`Vault balance: ${ethers.formatUnits(vaultBalance[0], USDC_DECIMALS)} USDC available`);
  
  console.log("\n🧮 Calculating Order Parameters for $10 with Quantity 100");
  console.log("=========================================================");
  
  // Target: $10 total value with quantity 100
  // In the system's pricing model, we need to work backwards:
  // If we want $10 total with 100 units, price per unit should be $0.10
  // In the ETH-based pricing: $0.10 translates to a small ETH amount
  // But prices must be tick-aligned to 0.01 ETH minimum
  
  const quantity = ethers.parseEther("100"); // 100 units (18 decimals)
  const TICK_SIZE = ethers.parseEther("0.01"); // 0.01 ETH (minimum tick size)
  
  // For $10 total with 100 units: $0.10 per unit
  // In this system, 0.01 ETH seems to represent approximately $1
  // So for $0.10 per unit, we need 0.001 ETH, but minimum tick is 0.01 ETH
  // Let's use the minimum tick and calculate actual value
  const price = TICK_SIZE; // 0.01 ETH per unit (minimum allowed)
  
  // Calculate required collateral
  const requiredCollateral18 = (quantity * price) / PRICE_PRECISION;
  const requiredCollateralUSDC = requiredCollateral18;
  
  // Calculate actual order value in the system
  const actualOrderValue = ethers.formatUnits(requiredCollateralUSDC, USDC_DECIMALS);
  
  console.log(`🔍 Order Analysis:`);
  console.log(`  Target Quantity: 100 units`);
  console.log(`  Quantity (raw 18-dec): ${quantity.toString()}`);
  console.log(`  Quantity (formatted): ${ethers.formatEther(quantity)} units`);
  console.log(`  Price per unit: ${ethers.formatEther(price)} ETH`);
  console.log(`  Required Collateral (18-dec): ${requiredCollateral18.toString()}`);
  console.log(`  Required Collateral (USDC): ${actualOrderValue} USDC`);
  console.log(`  Actual Order Value: $${actualOrderValue} USD`);
  
  const isTickAligned = (price % TICK_SIZE) === 0n;
  console.log(`  Price Tick-Aligned: ${isTickAligned ? "✅" : "❌"}`);
  
  const hasSufficientBalance = requiredCollateralUSDC <= vaultBalance[0];
  console.log(`  Sufficient Balance: ${hasSufficientBalance ? "✅" : "❌"}`);
  
  if (!hasSufficientBalance) {
    console.log(`❌ Insufficient balance: need ${actualOrderValue} USDC, have ${ethers.formatUnits(vaultBalance[0], USDC_DECIMALS)} USDC`);
    return;
  }
  
  // Check if quantity meets minimum order size (should be 1 wei now)
  console.log(`  Minimum order size check: ${quantity >= 1n ? "✅" : "❌"} (quantity: ${quantity.toString()}, min: 1)`);
  
  console.log("\n📝 Order Summary:");
  console.log(`  • Order Type: BUY Limit`);
  console.log(`  • Market: ${SILVER_MARKET.metricId}`);
  console.log(`  • Quantity: 100 units`);
  console.log(`  • Price: ${ethers.formatEther(price)} ETH per unit`);
  console.log(`  • Total Value: $${actualOrderValue} USD`);
  console.log(`  • Collateral Required: ${actualOrderValue} USDC`);
  
  console.log("\n🎯 Placing the buy order...");
  
  // Create order struct with direct values as requested
  const order = {
    orderId: 0, // Will be assigned by router
    trader: signer.address,
    metricId: SILVER_MARKET.metricId,
    orderType: 1, // LIMIT
    side: 0, // BUY
    quantity: 100, // Direct value: 100
    price: 10, // Direct value: 10
    filledQuantity: 0,
    timestamp: 0, // Will be set by router
    expiryTime: 0, // No expiry (GTC)
    status: 0, // PENDING
    timeInForce: 0, // GTC (Good Till Cancelled)
    stopPrice: 0,
    icebergQty: 0,
    postOnly: false, // Allow matching
    metadataHash: ethers.keccak256(ethers.toUtf8Bytes("TEN_DOLLAR_100_UNITS_ORDER"))
  };
  
  try {
    console.log("\n⚡ Estimating gas...");
    const gasEstimate = await orderRouter.placeOrder.estimateGas(order);
    console.log(`✅ Gas estimate: ${gasEstimate.toString()}`);
    
    // Calculate transaction cost
    const gasPrice = await ethers.provider.getFeeData();
    const estimatedCost = gasEstimate * (gasPrice.gasPrice || 0n);
    console.log(`💰 Estimated transaction cost: ${ethers.formatEther(estimatedCost)} MATIC`);
    
    console.log("\n📤 Submitting order...");
    const tx = await orderRouter.placeOrder(order, {
      gasLimit: gasEstimate + (gasEstimate / 10n) // 10% buffer
    });
    
    console.log(`Transaction submitted: ${tx.hash}`);
    console.log("⏳ Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log("🎉 ORDER PLACED SUCCESSFULLY!");
    
    // Parse events to get order details
    let orderPlacedDetails = null;
    for (const log of receipt!.logs) {
      try {
        const parsed = orderRouter.interface.parseLog(log);
        if (parsed?.name === "OrderPlaced") {
          orderPlacedDetails = {
            orderId: parsed.args[0].toString(),
            trader: parsed.args[1],
            metricId: parsed.args[2],
            orderType: parsed.args[3],
            side: parsed.args[4],
            quantity: parsed.args[5],
            price: parsed.args[6]
          };
          break;
        }
      } catch (error) {
        // Ignore parsing errors for other events
      }
    }
    
    console.log("\n📋 Order Details:");
    if (orderPlacedDetails) {
      console.log(`  Order ID: ${orderPlacedDetails.orderId}`);
      console.log(`  Trader: ${orderPlacedDetails.trader}`);
      console.log(`  Market: ${orderPlacedDetails.metricId}`);
      console.log(`  Side: ${orderPlacedDetails.side === 0 ? "BUY" : "SELL"}`);
      console.log(`  Quantity: ${ethers.formatEther(orderPlacedDetails.quantity)} units`);
      console.log(`  Price: ${ethers.formatEther(orderPlacedDetails.price)} ETH per unit`);
      
      // Calculate final order value
      const finalOrderValue = (orderPlacedDetails.quantity * orderPlacedDetails.price) / PRICE_PRECISION;
      console.log(`  Total Value: $${ethers.formatUnits(finalOrderValue, USDC_DECIMALS)} USD`);
    }
    
    console.log("\n🎉 SUCCESS: Buy Order Placed!");
    console.log("==============================");
    console.log(`✅ Transaction: ${tx.hash}`);
    console.log(`✅ Gas used: ${receipt!.gasUsed.toString()}`);
    console.log(`✅ Block: ${receipt!.blockNumber}`);
    console.log(`✅ Market: ${SILVER_MARKET.metricId}`);
    console.log(`✅ Order Type: BUY Limit`);
    console.log(`✅ Quantity: 100 units`);
    console.log(`✅ Successfully leveraged minimum order size removal`);
    
    console.log(`\n🔗 View on Polygonscan: https://polygonscan.com/tx/${tx.hash}`);
    
    console.log(`\n💡 Technical Notes:`);
    console.log(`   • Used minimum order size of 1 wei (effectively 0)`);
    console.log(`   • Price tick-aligned to 0.01 ETH`);
    console.log(`   • Order value: $${actualOrderValue} USD`);
    console.log(`   • Quantity: exactly 100 units as requested`);
    
  } catch (error: any) {
    console.error("\n❌ Order placement failed:");
    console.error("Error:", error.message);
    
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    
    if (error.code === 'CALL_EXCEPTION') {
      console.error("\n🔍 Possible causes:");
      console.error("- Insufficient collateral balance");
      console.error("- Order validation failed");
      console.error("- Market is paused or inactive");
      console.error("- Price not properly tick-aligned");
    }
    
    console.log("\n📊 Order Parameters Used:");
    console.log(`  Quantity: ${ethers.formatEther(quantity)} units`);
    console.log(`  Price: ${ethers.formatEther(price)} ETH`);
    console.log(`  Required Collateral: ${actualOrderValue} USDC`);
    console.log(`  Available Balance: ${ethers.formatUnits(vaultBalance[0], USDC_DECIMALS)} USDC`);
  }
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("\n✨ Script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Script failed:", error);
      process.exit(1);
    });
}

export { main };
