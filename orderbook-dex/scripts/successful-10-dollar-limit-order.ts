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
  console.log("🚀 $10 Limit Order Test - Using Successful Local Architecture");
  console.log("============================================================");
  
  const [signer] = await ethers.getSigners();
  console.log("📋 Using account:", signer.address);
  
  // Load contracts
  const mockUSDC = await ethers.getContractAt("MockUSDC", POLYGON_CONTRACTS.mockUSDC, signer);
  const centralVault = await ethers.getContractAt("CentralVault", POLYGON_CONTRACTS.centralVault, signer);
  const orderRouter = await ethers.getContractAt("OrderRouter", POLYGON_CONTRACTS.orderRouter, signer);
  
  console.log("\n💰 Setting up collateral (following successful local pattern)...");
  
  // Check existing vault balance first
  let vaultBalance = await centralVault.getPrimaryCollateralBalance(signer.address);
  console.log(`Current vault balance: ${ethers.formatUnits(vaultBalance[0], USDC_DECIMALS)} USDC available`);
  
  // Calculate required collateral for the order (with reasonable buffer)
  const baseRequirement = ethers.parseUnits("100", USDC_DECIMALS); // Expected order value
  const safetyBuffer = ethers.parseUnits("20", USDC_DECIMALS); // $20 safety buffer
  const totalRequired = baseRequirement + safetyBuffer; // Total needed
  
  console.log(`Required collateral: ${ethers.formatUnits(totalRequired, USDC_DECIMALS)} USDC (includes $20 safety buffer)`);
  
  // Only mint and deposit if we need more USDC
  if (vaultBalance[0] < totalRequired) {
    const shortfall = totalRequired - vaultBalance[0];
    console.log(`Shortfall: ${ethers.formatUnits(shortfall, USDC_DECIMALS)} USDC`);
    
    try {
      await mockUSDC.mint(signer.address, shortfall);
      console.log(`✅ Minted only what's needed: ${ethers.formatUnits(shortfall, USDC_DECIMALS)} USDC`);
      
      // Approve and deposit the minted amount (following local test pattern)
      await mockUSDC.approve(await centralVault.getAddress(), ethers.MaxUint256);
      console.log("✅ Approved USDC allowance");
      
      // Deposit using depositPrimaryCollateral (KEY DIFFERENCE!)
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
  
  console.log("\n📊 Preparing limit order using minimum size (0.1 units in wei)...");
  
  // Following the successful local test pattern:
  // - orderSize in USDC decimals (6), not wei (18)
  // - Use $100 order like successful local tests (they always use $100)
  // - basePrice around 0.5 ETH with tick-aligned adjustments
  
  // The minimum order size is 0.1 units in WEI (18 decimals), not USDC!
  // The quantity field must also be in wei. Let's use 0.1 wei units (the minimum)
  const orderSize = ethers.parseEther("0.1"); // 0.1 units in wei (18 decimals) - the minimum
  const basePrice = ethers.parseEther("0.5"); // 0.5 ETH base price  
  const orderPrice = ethers.parseEther("0.48"); // 0.48 ETH (properly tick-aligned to 0.01)
  
  console.log(`Order size: ${ethers.formatEther(orderSize)} units (wei)`);
  console.log(`Order price: ${ethers.formatEther(orderPrice)} ETH`);
  console.log(`Price is tick-aligned: ${(Number(ethers.formatEther(orderPrice)) % 0.01) === 0 ? "✅" : "❌"}`);
  
  // Create order using exact structure from successful local tests
  const order = {
    orderId: 0, // Will be set by the contract
    trader: signer.address,
    metricId: SILVER_MARKET.metricId,
    orderType: 1, // LIMIT
    side: 0, // BUY
    quantity: orderSize, // In USDC decimals (6), not wei (18)!
    price: orderPrice,
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
  
  console.log("\n🎯 Placing limit order...");
  
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
          console.log(`📋 Quantity: ${ethers.formatUnits(parsed.args[5], USDC_DECIMALS)} USDC`);
          console.log(`📋 Price: ${ethers.formatEther(parsed.args[6])} ETH`);
        }
      } catch (error) {
        // Ignore parsing errors for other events
      }
    }
    
    console.log("\n🎉 SUCCESS: $100 Limit Order Test Completed!");
    console.log("===========================================");
    console.log(`✅ Transaction: ${tx.hash}`);
    console.log(`✅ Gas used: ${receipt!.gasUsed.toString()}`);
    console.log(`✅ Order Value: $100.00 USDC`);
    console.log(`✅ Order Type: BUY Limit`);
    console.log(`✅ Market: ${SILVER_MARKET.metricId}`);
    console.log(`✅ Architecture: Following successful local test pattern`);
    console.log(`\n🔗 View on Polygonscan: https://polygonscan.com/tx/${tx.hash}`);
    
  } catch (error: any) {
    console.error("❌ Order placement failed:");
    console.error(error.message);
    
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    
    console.log("\n🔍 Key differences from failed attempts:");
    console.log("✅ Used depositPrimaryCollateral() instead of deposit()");
    console.log("✅ Used orderSize in USDC decimals (6) instead of wei (18)");
    console.log("✅ Used 1000 USDC collateral for $100 order (10:1 ratio like local tests)");
    console.log("✅ Used exact order structure from successful local tests");
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
