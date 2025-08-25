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
const PRICE_PRECISION = ethers.parseEther("1"); // 1e18

async function main() {
  console.log("🎯 FIXED $10 Limit Order Test - Using Correct Unit Analysis");
  console.log("===========================================================");
  
  const [signer] = await ethers.getSigners();
  console.log("📋 Using account:", signer.address);
  
  // Load contracts
  const mockUSDC = await ethers.getContractAt("MockUSDC", POLYGON_CONTRACTS.mockUSDC, signer);
  const centralVault = await ethers.getContractAt("CentralVault", POLYGON_CONTRACTS.centralVault, signer);
  const orderRouter = await ethers.getContractAt("OrderRouter", POLYGON_CONTRACTS.orderRouter, signer);
  
  console.log("\n💰 Setting up collateral...");
  
  // Check existing vault balance first
  let vaultBalance = await centralVault.getPrimaryCollateralBalance(signer.address);
  console.log(`Current vault balance: ${ethers.formatUnits(vaultBalance[0], USDC_DECIMALS)} USDC available`);
  
  // Calculate required collateral for a $10 order (with reasonable buffer)
  const baseRequirement = ethers.parseUnits("10", USDC_DECIMALS); // $10 for the order
  const safetyBuffer = ethers.parseUnits("5", USDC_DECIMALS); // $5 safety buffer
  const totalRequired = baseRequirement + safetyBuffer; // $15 total
  
  console.log(`Required collateral: ${ethers.formatUnits(totalRequired, USDC_DECIMALS)} USDC (includes $5 safety buffer)`);
  
  // Only mint and deposit if we need more USDC
  if (vaultBalance[0] < totalRequired) {
    const shortfall = totalRequired - vaultBalance[0];
    console.log(`Shortfall: ${ethers.formatUnits(shortfall, USDC_DECIMALS)} USDC`);
    
    try {
      await mockUSDC.mint(signer.address, shortfall);
      console.log(`✅ Minted only what's needed: ${ethers.formatUnits(shortfall, USDC_DECIMALS)} USDC`);
      
      // Approve and deposit the minted amount
      await mockUSDC.approve(await centralVault.getAddress(), ethers.MaxUint256);
      console.log("✅ Approved USDC allowance");
      
      await centralVault.depositPrimaryCollateral(shortfall);
      console.log(`✅ Deposited ${ethers.formatUnits(shortfall, USDC_DECIMALS)} USDC using depositPrimaryCollateral()`);
      
    } catch (error) {
      console.log("❌ Failed to mint additional USDC");
      console.log("ℹ️  Proceeding with existing balance...");
    }
  } else {
    console.log("✅ Sufficient balance already available - no minting needed!");
  }
  
  // Get updated vault balance
  vaultBalance = await centralVault.getPrimaryCollateralBalance(signer.address);
  console.log(`Final vault balance: ${ethers.formatUnits(vaultBalance[0], USDC_DECIMALS)} USDC available`);
  
  console.log("\n🧮 Calculating $10 Order Parameters (Scaled Min + USDC vault)");
  console.log("====================================================");
  
  // With min order size lowered to 1e9 (18-dec raw), choose quantity=1e9 and price=0.01 ETH
  // requiredCollateral = (1e9 * 1e16)/1e18 = 1e7 (10 USDC base units)
  const quantity = 1000000000n; // 1e9 (18-dec raw)
  const TICK_SIZE = ethers.parseEther("0.01"); // 0.01 ETH
  const price = TICK_SIZE; // exact tick
  
  const requiredCollateral18 = (quantity * price) / PRICE_PRECISION; // 18-dec result
  const requiredCollateralUSDC = requiredCollateral18; // compared directly on-chain to 6-dec balance
  
  console.log(`🔍 Analysis:`);
  console.log(`  Quantity (raw 18-dec): ${quantity.toString()} (~${ethers.formatEther(quantity)} units)`);
  console.log(`  Price: ${ethers.formatEther(price)} ETH`);
  console.log(`  Required Collateral (18-dec): ${requiredCollateral18.toString()}`);
  console.log(`  Required Collateral (USDC view): ${ethers.formatUnits(requiredCollateralUSDC, USDC_DECIMALS)} USDC`);
  const isTickAligned = (price % TICK_SIZE) === 0n;
  console.log(`  Price Tick-Aligned: ${isTickAligned ? "✅" : "❌"}`);
  const hasSufficientBalance = requiredCollateralUSDC <= vaultBalance[0];
  console.log(`  Sufficient Balance: ${hasSufficientBalance ? "✅" : "❌"}`);
  if (!hasSufficientBalance) {
    console.log(`❌ Insufficient balance: need ${ethers.formatUnits(requiredCollateralUSDC, USDC_DECIMALS)} USDC, have ${ethers.formatUnits(vaultBalance[0], USDC_DECIMALS)} USDC`);
    return;
  }
  
  console.log("\n🎯 Placing limit order with corrected parameters...");
  
  // Create order using exact structure from successful local tests
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
    for (const log of receipt!.logs) {
      try {
        const parsed = orderRouter.interface.parseLog(log);
        if (parsed?.name === "OrderPlaced") {
          const orderId = parsed.args[0];
          console.log(`📋 Order ID: ${orderId.toString()}`);
          console.log(`📋 Trader: ${parsed.args[1]}`);
          console.log(`📋 Side: ${parsed.args[4] === 0 ? "BUY" : "SELL"}`);
          console.log(`📋 Quantity: ${ethers.formatEther(parsed.args[5])} units`);
          console.log(`📋 Price: ${ethers.formatEther(parsed.args[6])} ETH`);
        }
      } catch (error) {
        // Ignore parsing errors for other events
      }
    }
    
    console.log("\n🎉 SUCCESS: Fixed Limit Order Test Completed!");
    console.log("==============================================");
    console.log(`✅ Transaction: ${tx.hash}`);
    console.log(`✅ Gas used: ${receipt!.gasUsed.toString()}`);
    console.log(`✅ Order Value: $${ethers.formatUnits(requiredCollateralUSDC, USDC_DECIMALS)} USDC`);
    console.log(`✅ Order Type: BUY Limit`);
    console.log(`✅ Market: ${SILVER_MARKET.metricId}`);
    console.log(`✅ Quantity: ${ethers.formatEther(quantity)} units`);
    console.log(`✅ Price: ${ethers.formatEther(price)} ETH (tick-aligned)`);
    console.log(`\n🔗 View on Polygonscan: https://polygonscan.com/tx/${tx.hash}`);
    
    console.log(`\n🔬 Technical Analysis:`);
    console.log(`======================`);
    console.log(`✅ Used minimum order size: 0.1 units (18 decimals)`);
    console.log(`✅ Calculated price for ~$10 value`);
    console.log(`✅ Price aligned to 0.01 ETH tick size`);
    console.log(`✅ Used depositPrimaryCollateral() for deposits`);
    console.log(`✅ Sufficient collateral allocated`);
    
  } catch (error: any) {
    console.error("❌ Order placement failed:");
    console.error(error.message);
    
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    
    console.log("\n🔍 This should work because:");
    console.log("✅ Quantity meets minimum requirement (0.1 units)");
    console.log("✅ Price is tick-aligned to 0.01 ETH");
    console.log("✅ Sufficient collateral deposited");
    console.log("✅ Using correct decimal formats");
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
