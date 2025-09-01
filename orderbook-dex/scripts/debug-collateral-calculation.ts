import { ethers } from "hardhat";

async function debugCollateralCalculation() {
  console.log('🔍 DEBUGGING COLLATERAL CALCULATION ISSUES');
  console.log('='.repeat(80));

  // Contract addresses from recent deployment
  const contracts = {
    mockUSDC: "0x3371ce5d3164ABf183C676e2FC987597e8191892",
    centralVault: "0xc94fb667207206eEe88C203B4dF56Be99a30c8Ea",
    orderRouter: "0xFBd6B734109567937d1d9F1a41Ce86f8d6632BF2",
    orderBook: "0x1FCccd6827eAc7cA1c18596A6ed52A8B1b51f195"
  };

  const [deployer, trader1] = await ethers.getSigners();

  // Get contract instances
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const CentralVault = await ethers.getContractFactory("CentralVault");
  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const OrderBook = await ethers.getContractFactory("OrderBook");

  const mockUSDC = MockUSDC.attach(contracts.mockUSDC);
  const centralVault = CentralVault.attach(contracts.centralVault);
  const orderRouter = OrderRouter.attach(contracts.orderRouter);
  const orderBook = OrderBook.attach(contracts.orderBook);

  // Check USDC decimals
  const usdcDecimals = await mockUSDC.decimals();
  console.log(`📊 USDC Decimals: ${usdcDecimals}`);

  // Setup test trader with sufficient balance
  const testAmount = ethers.parseUnits("1000000", 6); // 1M USDC
  await mockUSDC.mint(trader1.address, testAmount);
  await mockUSDC.connect(trader1).approve(contracts.centralVault, testAmount);
  await centralVault.connect(trader1).depositPrimaryCollateral(testAmount);

  const balance = await centralVault.getUserBalance(trader1.address, contracts.mockUSDC);
  console.log(`💰 Trader balance - Available: ${ethers.formatUnits(balance.available, 6)} USDC`);
  console.log(`💰 Trader balance - Allocated: ${ethers.formatUnits(balance.allocated, 6)} USDC`);

  // Test different order sizes to find the breaking point
  const testCases = [
    { name: "Tiny Order", quantity: "1", price: "100" },
    { name: "Small Order", quantity: "100", price: "100" },
    { name: "Medium Order", quantity: "1000", price: "100" },
    { name: "Large Order", quantity: "5000", price: "100" },
    { name: "Very Large Order", quantity: "10000", price: "100" }
  ];

  for (const testCase of testCases) {
    console.log(`\n🧪 Testing: ${testCase.name}`);
    console.log(`   Quantity: ${testCase.quantity} units @ $${testCase.price}`);
    
    const quantity = ethers.parseEther(testCase.quantity);
    const price = ethers.parseEther(testCase.price);
    const requiredCollateral = quantity * price / ethers.parseEther("1");
    
    console.log(`   📊 Required Collateral (18 decimals): ${ethers.formatEther(requiredCollateral)}`);
    console.log(`   📊 Required Collateral (6 decimals): ${ethers.formatUnits(requiredCollateral / BigInt(10**12), 6)}`);
    console.log(`   📊 Notional Value: $${Number(testCase.quantity) * Number(testCase.price)}`);

    const order = {
      orderId: 0,
      trader: trader1.address,
      metricId: "WORLD_POPULATION_2024",
      orderType: 1, // LIMIT
      side: 0, // BUY
      quantity: quantity,
      price: price,
      filledQuantity: 0,
      timestamp: 0,
      expiryTime: 0,
      status: 0,
      timeInForce: 0,
      stopPrice: 0,
      icebergQty: 0,
      postOnly: false,
      metadataHash: ethers.keccak256(ethers.toUtf8Bytes("DEBUG_ORDER"))
    };

    try {
      // Try to estimate gas first to see if it would work
      const gasEstimate = await orderRouter.connect(trader1).placeOrder.estimateGas(order);
      console.log(`   ✅ Gas estimate successful: ${gasEstimate.toLocaleString()}`);
      
      // Now try the actual transaction
      const tx = await orderRouter.connect(trader1).placeOrder(order);
      const receipt = await tx.wait();
      console.log(`   ✅ Order placed successfully! Gas used: ${receipt?.gasUsed?.toLocaleString()}`);
      
    } catch (error) {
      console.log(`   ❌ Order failed: ${(error as Error).message}`);
      
      // Try to debug further by calling the contract directly
      try {
        console.log(`   🔍 Debugging OrderBook validation...`);
        
        // Check if we can call hasSufficientBalance directly
        const adjustedCollateral = requiredCollateral / BigInt(10**12); // Convert to 6 decimals
        const hasBalance = await centralVault.hasSufficientBalance(
          trader1.address, 
          contracts.mockUSDC, 
          adjustedCollateral
        );
        console.log(`   📊 Has sufficient balance check: ${hasBalance}`);
        console.log(`   📊 Checking balance for ${ethers.formatUnits(adjustedCollateral, 6)} USDC`);
        
      } catch (debugError) {
        console.log(`   🔍 Debug call failed: ${(debugError as Error).message}`);
      }
    }
  }

  // Check the contract's collateral calculation logic
  console.log('\n🔍 INVESTIGATING CONTRACT CONFIGURATION');
  
  try {
    const primaryCollateral = await centralVault.primaryCollateral();
    console.log(`📊 Primary collateral token: ${primaryCollateral}`);
    
    const isRegistered = await centralVault.isRegisteredToken(contracts.mockUSDC);
    console.log(`📊 USDC is registered: ${isRegistered}`);
    
    // Check if OrderBook is authorized
    const orderBookAddress = await orderRouter.getMarketOrderBook("WORLD_POPULATION_2024");
    console.log(`📊 OrderBook address from router: ${orderBookAddress}`);
    
  } catch (error) {
    console.log(`❌ Configuration check failed: ${(error as Error).message}`);
  }
}

async function main() {
  await debugCollateralCalculation();
}

main()
  .then(() => {
    console.log('\n🎉 Debugging completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Debug failed:', error);
    process.exit(1);
  });







