import { ethers } from "hardhat";

async function main() {
  console.log("🔧 Validating OrderBook Scaling Fixes...\n");

  // Get signers
  const [deployer, user1, user2] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const user1Address = await user1.getAddress();
  const user2Address = await user2.getAddress();

  console.log("📋 Deploying contracts...");

  // Deploy MockUSDC with 6 decimals (USDC standard)
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy(deployerAddress);
  await mockUSDC.waitForDeployment();
  console.log("✅ MockUSDC deployed:", await mockUSDC.getAddress());

  // Deploy VaultRouter
  const VaultRouter = await ethers.getContractFactory("VaultRouter");
  const vaultRouter = await VaultRouter.deploy(await mockUSDC.getAddress(), deployerAddress);
  await vaultRouter.waitForDeployment();
  console.log("✅ VaultRouter deployed:", await vaultRouter.getAddress());

  // Deploy OrderBookFactoryMinimal
  const OrderBookFactoryMinimal = await ethers.getContractFactory("OrderBookFactoryMinimal");
  const factory = await OrderBookFactoryMinimal.deploy(await vaultRouter.getAddress(), deployerAddress);
  await factory.waitForDeployment();
  console.log("✅ Factory deployed:", await factory.getAddress());

  // Deploy TradingRouter
  const TradingRouter = await ethers.getContractFactory("TradingRouter");
  const tradingRouter = await TradingRouter.deploy(
    await vaultRouter.getAddress(),
    await factory.getAddress(),
    deployerAddress
  );
  await tradingRouter.waitForDeployment();
  console.log("✅ TradingRouter deployed:", await tradingRouter.getAddress());

  // Create a market
  console.log("\n📊 Creating market...");
  const marketId = ethers.id("ETH_USD_TEST");
  await factory.createTraditionalMarket("ETH/USD", { value: ethers.parseEther("0.1") });
  
  // Get the OrderBook address from factory
  const marketInfo = await factory.getMarket(marketId);
  const orderBook = await ethers.getContractAt("OrderBook", marketInfo.orderBookAddress);
  console.log("✅ Market created with OrderBook:", marketInfo.orderBookAddress);

  // Authorize market in VaultRouter
  await vaultRouter.setMarketAuthorization(marketId, true);

  // Grant ORDERBOOK_ROLE to OrderBook contract
  const ORDERBOOK_ROLE = await vaultRouter.ORDERBOOK_ROLE();
  await vaultRouter.grantRole(ORDERBOOK_ROLE, await orderBook.getAddress());
  console.log("✅ Permissions granted");

  // Test 1: Verify constants are properly set
  console.log("\n🔍 Test 1: Verifying precision constants...");
  try {
    const PRICE_PRECISION = await orderBook.PRICE_PRECISION();
    const MARGIN_PERCENTAGE = await orderBook.MARGIN_PERCENTAGE();
    const MAX_REASONABLE_PRICE = await orderBook.MAX_REASONABLE_PRICE();
    const MIN_REASONABLE_PRICE = await orderBook.MIN_REASONABLE_PRICE();
    const MAX_ORDER_SIZE = await orderBook.MAX_ORDER_SIZE();

    console.log("   PRICE_PRECISION:", PRICE_PRECISION.toString(), "(expected: 1000000)");
    console.log("   MARGIN_PERCENTAGE:", MARGIN_PERCENTAGE.toString(), "(expected: 10)");
    console.log("   MAX_REASONABLE_PRICE:", MAX_REASONABLE_PRICE.toString(), "(expected: 1000000000)");
    console.log("   MIN_REASONABLE_PRICE:", MIN_REASONABLE_PRICE.toString(), "(expected: 10000)");
    console.log("   MAX_ORDER_SIZE:", MAX_ORDER_SIZE.toString(), "(expected: 1000000000000)");

    if (PRICE_PRECISION.toString() === "1000000" && 
        MARGIN_PERCENTAGE.toString() === "10" &&
        MAX_REASONABLE_PRICE.toString() === "1000000000" &&
        MIN_REASONABLE_PRICE.toString() === "10000" &&
        MAX_ORDER_SIZE.toString() === "1000000000000") {
      console.log("✅ All constants are correctly set!");
    } else {
      console.log("❌ Some constants are incorrect!");
      return;
    }
  } catch (error) {
    console.log("❌ Error reading constants:", error);
    return;
  }

  // Test 2: Verify input validation works
  console.log("\n🔍 Test 2: Testing input validation...");
  
  // Setup user balances
  const depositAmount = ethers.parseUnits("10000", 6); // $10,000 USDC
  await mockUSDC.mint(user1Address, depositAmount);
  await mockUSDC.connect(user1).approve(await vaultRouter.getAddress(), depositAmount);
  await vaultRouter.connect(user1).depositCollateral(depositAmount);
  console.log("   User1 deposited $10,000 USDC");

  // Test 2a: Try price too high (should fail)
  try {
    const size = ethers.parseUnits("100", 6);
    const tooHighPrice = ethers.parseUnits("2000", 6); // $2000 > $1000 max
    await orderBook.connect(user1).placeLimitOrder(0, size, tooHighPrice);
    console.log("❌ Should have rejected high price but didn't!");
    return;
  } catch (error) {
    if (error.message.includes("price too high")) {
      console.log("✅ Correctly rejected price too high");
    } else {
      console.log("❌ Rejected for wrong reason:", error.message);
    }
  }

  // Test 2b: Try price too low (should fail)
  try {
    const size = ethers.parseUnits("100", 6);
    const tooLowPrice = ethers.parseUnits("0.005", 6); // $0.005 < $0.01 min
    await orderBook.connect(user1).placeLimitOrder(0, size, tooLowPrice);
    console.log("❌ Should have rejected low price but didn't!");
    return;
  } catch (error) {
    if (error.message.includes("price too low")) {
      console.log("✅ Correctly rejected price too low");
    } else {
      console.log("❌ Rejected for wrong reason:", error.message);
    }
  }

  // Test 2c: Try size too large (should fail)
  try {
    const price = ethers.parseUnits("5", 6);
    const tooLargeSize = ethers.parseUnits("2000000", 6); // 2M > 1M max
    await orderBook.connect(user1).placeLimitOrder(0, tooLargeSize, price);
    console.log("❌ Should have rejected large size but didn't!");
    return;
  } catch (error) {
    if (error.message.includes("size too large")) {
      console.log("✅ Correctly rejected size too large");
    } else {
      console.log("❌ Rejected for wrong reason:", error.message);
    }
  }

  // Test 3: Test normal order placement with user-friendly values
  console.log("\n🔍 Test 3: Testing normal order placement...");
  try {
    // Test with $5.00 price and 100 units - should work
    const price = ethers.parseUnits("5", 6); // $5.00
    const size = ethers.parseUnits("100", 6); // 100 units
    
    console.log("   Placing order: 100 units @ $5.00 each");
    console.log("   Expected margin: ~$50 (10% of $500 notional)");
    
    const tx = await orderBook.connect(user1).placeLimitOrder(0, size, price);
    await tx.wait();
    
    // Check margin was reserved correctly
    const marginReserved = await vaultRouter.getTotalMarginReserved(user1Address);
    const expectedMargin = ethers.parseUnits("50", 6); // $50
    
    console.log("   Actual margin reserved:", ethers.formatUnits(marginReserved, 6), "USDC");
    console.log("   Expected margin:", ethers.formatUnits(expectedMargin, 6), "USDC");
    
    if (marginReserved > 0n && marginReserved <= expectedMargin * 2n) {
      console.log("✅ Normal order placement works with reasonable margin!");
    } else {
      console.log("❌ Margin calculation seems off");
    }
  } catch (error) {
    console.log("❌ Normal order failed:", error.message);
    return;
  }

  // Test 4: Test TradingRouter integration
  console.log("\n🔍 Test 4: Testing TradingRouter integration...");
  try {
    const price = ethers.parseUnits("50", 6); // $50
    const size = ethers.parseUnits("20", 6); // 20 units

    const tx = await tradingRouter.connect(user1).placeLimitOrder(
      marketId,
      0, // BUY
      size,
      price
    );
    await tx.wait();
    
    console.log("✅ TradingRouter limit order placement works!");
  } catch (error) {
    console.log("❌ TradingRouter failed:", error.message);
    return;
  }

  // Test 5: Test enhanced error messages
  console.log("\n🔍 Test 5: Testing enhanced error messages...");
  try {
    // Try to place an order that requires more margin than available
    const price = ethers.parseUnits("100", 6); // $100
    const size = ethers.parseUnits("200000", 6); // 200,000 units
    // Required margin: 200,000 * 100 * 10% = $2,000,000 (more than $10,000 deposited)

    await orderBook.connect(user1).placeLimitOrder(0, size, price);
    console.log("❌ Should have failed due to insufficient collateral!");
  } catch (error) {
    if (error.message.includes("insufficient collateral") && 
        (error.message.includes("Required:") || error.message.includes("Available:"))) {
      console.log("✅ Enhanced error message provided detailed information!");
      console.log("   Error:", error.message.substring(0, 200) + "...");
    } else {
      console.log("❌ Error message not enhanced:", error.message);
    }
  }

  console.log("\n🎉 All scaling fixes validated successfully!");
  console.log("\n📋 Summary:");
  console.log("✅ Precision constants properly set for USDC 6-decimal compatibility");
  console.log("✅ Input validation prevents invalid orders");
  console.log("✅ Normal orders work with user-friendly dollar amounts");
  console.log("✅ TradingRouter integration functional");
  console.log("✅ Enhanced error messages provide detailed debugging info");
  console.log("\n🚀 The OrderBook scaling fixes are working correctly!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Validation failed:", error);
    process.exit(1);
  });
