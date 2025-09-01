import { ethers } from "hardhat";

// Enhanced logging utility
class TradeLogger {
  private static colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
  };

  static step(step: number, message: string) {
    console.log(`\n${TradeLogger.colors.cyan}${step}️⃣ ${message}${TradeLogger.colors.reset}`);
    console.log("━".repeat(60));
  }

  static info(message: string, data?: any) {
    console.log(`${TradeLogger.colors.blue}📊 INFO:${TradeLogger.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static success(message: string, data?: any) {
    console.log(`${TradeLogger.colors.green}✅ SUCCESS:${TradeLogger.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static action(message: string, data?: any) {
    console.log(`${TradeLogger.colors.magenta}🎯 ACTION:${TradeLogger.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }
}

async function createProfitableTrade() {
  TradeLogger.step(0, "Creating New Trades to Increase Market Price");
  
  try {
    // Redeploy and create fresh positions
    TradeLogger.info("Starting fresh deployment to ensure clean state...");
    
    const [trader1, trader2, trader3] = await ethers.getSigners();
    
    // Deploy contracts fresh
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
    
    const MockUMAFinder = await ethers.getContractFactory("MockUMAFinder");
    const mockUMAFinder = await MockUMAFinder.deploy();
    await mockUMAFinder.waitForDeployment();
    
    const UMAOracleManager = await ethers.getContractFactory("UMAOracleManager");
    const umaOracleManager = await UMAOracleManager.deploy(
      await mockUMAFinder.getAddress(),
      await mockUSDC.getAddress(),
      trader1.address
    );
    await umaOracleManager.waitForDeployment();
    
    const CentralVault = await ethers.getContractFactory("CentralVault");
    const centralVault = await CentralVault.deploy(
      trader1.address,
      3600,
      await mockUSDC.getAddress()
    );
    await centralVault.waitForDeployment();
    
    const OrderRouter = await ethers.getContractFactory("OrderRouter");
    const orderRouter = await OrderRouter.deploy(
      await centralVault.getAddress(),
      await umaOracleManager.getAddress(),
      trader1.address,
      10
    );
    await orderRouter.waitForDeployment();
    
    const OrderBook = await ethers.getContractFactory("OrderBook");
    const orderBookImplementation = await OrderBook.deploy();
    await orderBookImplementation.waitForDeployment();
    
    const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
    const factory = await MetricsMarketFactory.deploy(
      await umaOracleManager.getAddress(),
      await orderBookImplementation.getAddress(),
      await centralVault.getAddress(),
      await orderRouter.getAddress(),
      trader1.address,
      ethers.parseEther("0.01"),
      trader1.address
    );
    await factory.waitForDeployment();
    
    // Setup permissions
    await umaOracleManager.grantRole(await umaOracleManager.METRIC_MANAGER_ROLE(), await factory.getAddress());
    await centralVault.setMarketAuthorization(await orderRouter.getAddress(), true);
    await orderRouter.grantRole(await orderRouter.MARKET_ROLE(), await factory.getAddress());
    await orderRouter.grantRole(await orderRouter.ROUTER_ADMIN_ROLE(), await factory.getAddress());
    await centralVault.setMarketAuthorization(await factory.getAddress(), true);
    
    // Create test market
    const currentTime = Math.floor(Date.now() / 1000);
    const testMarket = {
      metricId: "PNL_TEST_" + Date.now(),
      description: "PNL Test Market",
      oracleProvider: await umaOracleManager.getAddress(),
      decimals: 2,
      minimumOrderSize: ethers.parseEther("0.1"),
      tickSize: ethers.parseEther("0.01"),
      creationFee: ethers.parseEther("0.01"),
      requiresKYC: false,
      settlementDate: currentTime + 3600,
      tradingEndDate: currentTime + 3300,
      dataRequestWindow: 300,
      autoSettle: true,
      initialOrder: { enabled: false, side: 0, quantity: 0, price: 0, timeInForce: 0, expiryTime: 0 }
    };
    
    const testMetricConfig = {
      identifier: ethers.keccak256(ethers.toUtf8Bytes(testMarket.metricId)),
      description: testMarket.description,
      decimals: testMarket.decimals,
      minBond: ethers.parseEther("1000"),
      defaultReward: ethers.parseEther("100"),
      livenessPeriod: 3600,
      isActive: true,
      authorizedRequesters: []
    };
    
    await umaOracleManager.configureMetric(testMetricConfig);
    await factory.createMarket(testMarket, { value: testMarket.creationFee });
    
    const marketAddress = await factory.getMarket(testMarket.metricId);
    await orderRouter.registerMarket(testMarket.metricId, marketAddress);
    await centralVault.setMarketAuthorization(marketAddress, true);
    
    const orderBook = await ethers.getContractAt("OrderBook", marketAddress);
    
    // Fund traders
    await mockUSDC.mintLarge(trader1.address);
    await mockUSDC.mint(trader2.address, ethers.parseUnits("5000", 6));
    await mockUSDC.mint(trader3.address, ethers.parseUnits("5000", 6));
    
    const approvalAmount = ethers.parseUnits("10000", 6);
    await mockUSDC.connect(trader1).approve(await centralVault.getAddress(), approvalAmount);
    await mockUSDC.connect(trader2).approve(await centralVault.getAddress(), approvalAmount);
    await mockUSDC.connect(trader3).approve(await centralVault.getAddress(), approvalAmount);
    
    const depositAmount = ethers.parseUnits("5000", 6);
    await centralVault.connect(trader1).deposit(await mockUSDC.getAddress(), depositAmount);
    await centralVault.connect(trader2).deposit(await mockUSDC.getAddress(), depositAmount);
    await centralVault.connect(trader3).deposit(await mockUSDC.getAddress(), depositAmount);
    
    TradeLogger.success("Fresh deployment completed", {
      mockUSDC: await mockUSDC.getAddress(),
      centralVault: await centralVault.getAddress(),
      orderRouter: await orderRouter.getAddress(),
      orderBook: marketAddress,
      metricId: testMarket.metricId
    });
    
    TradeLogger.step(1, "Creating Trader 1's Initial Position (Entry at $2.00)");
    
    // Create Trader 1's initial LONG position at $2.00
    const trader1Order = {
      orderId: 0,
      trader: trader1.address,
      metricId: testMarket.metricId,
      orderType: 1, // LIMIT
      side: 0, // BUY (LONG)
      quantity: ethers.parseEther("0.5"), // 0.5 units
      price: ethers.parseEther("2.0"), // Entry at $2.00
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
    
    // First, trader2 places a SELL order at $2.00
    const trader2SellOrder = {
      ...trader1Order,
      trader: trader2.address,
      side: 1 // SELL
    };
    
    await orderRouter.connect(trader2).placeOrder(trader2SellOrder);
    TradeLogger.info("Trader 2 placed SELL order at $2.00");
    
    // Then trader1 places BUY order at $2.00 to execute the trade
    const tx1 = await orderRouter.connect(trader1).placeOrder(trader1Order);
    await tx1.wait();
    
    TradeLogger.success("Trader 1's initial LONG position created", {
      quantity: "0.5 units",
      entryPrice: "$2.00",
      expectedCollateral: "1.0 USDC"
    });
    
    TradeLogger.step(2, "Creating Higher Price Trade to Generate $10 Profit");
    
    // For Trader 1's LONG 0.5 units at $2.00 to make $10 profit:
    // PNL = 0.5 × (newPrice - 2.0)
    // $10 = 0.5 × (newPrice - 2.0)
    // newPrice = $22.00
    
    const profitablePrice = ethers.parseEther("22.0"); // This will give ~$10 profit
    
    TradeLogger.action("Creating trade at $22.00 to establish new market price", {
      newPrice: "$22.00",
      expectedProfit: "~$10.00 USDC for Trader 1's LONG position"
    });
    
    // Trader 2 places SELL order at $22.00
    const trader2HighSell = {
      orderId: 0,
      trader: trader2.address,
      metricId: testMarket.metricId,
      orderType: 1, // LIMIT
      side: 1, // SELL
      quantity: ethers.parseEther("0.1"), // Small quantity
      price: profitablePrice,
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
    
    await orderRouter.connect(trader2).placeOrder(trader2HighSell);
    TradeLogger.info("Trader 2 placed SELL order at $22.00");
    
    // Trader 3 places BUY order at $22.00 to execute the trade
    const trader3HighBuy = {
      ...trader2HighSell,
      trader: trader3.address,
      side: 0 // BUY
    };
    
    const tx2 = await orderRouter.connect(trader3).placeOrder(trader3HighBuy);
    const receipt = await tx2.wait();
    
    TradeLogger.success("High-price trade executed!", {
      executionPrice: "$22.00",
      gasUsed: receipt.gasUsed.toString(),
      newMarketPrice: "$22.00"
    });
    
    TradeLogger.step(3, "Verifying New Market State");
    
    const marketStats = await orderBook.getMarketStats();
    const newPrice = marketStats.lastTradePrice;
    
    TradeLogger.success("Market verification", {
      lastTradePrice: ethers.formatEther(newPrice),
      totalTrades: marketStats.totalTrades.toString(),
      volume24h: ethers.formatEther(marketStats.volume24h)
    });
    
    console.log("\n" + "=".repeat(80));
    console.log("🎯 PROFIT GENERATION COMPLETED!");
    console.log("📈 Trader 1's LONG 0.5 units @ $2.00 with market now @ $22.00");
    console.log("💰 Expected Profit: 0.5 × ($22.00 - $2.00) = $10.00 USDC");
    console.log("🔄 Run 'npm run pnl' with the new contract addresses to see the profit!");
    console.log("=".repeat(80));
    console.log("");
    console.log("📝 NEW CONTRACT ADDRESSES:");
    console.log(`   mockUSDC: ${await mockUSDC.getAddress()}`);
    console.log(`   centralVault: ${await centralVault.getAddress()}`);
    console.log(`   orderRouter: ${await orderRouter.getAddress()}`);
    console.log(`   orderBook: ${marketAddress}`);
    console.log("");
    console.log("💡 Update the PNL script with these addresses to see the $10 profit!");
    
  } catch (error) {
    console.error("❌ Error creating profitable trade:", error);
  }
}

// Allow script to be run directly
if (require.main === module) {
  createProfitableTrade()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}

export { createProfitableTrade };







