import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Profitable Trading Test - $10 Profit Target", function () {
  let mockUMAFinder: Contract;
  let mockUSDC: Contract;
  let umaOracleManager: Contract;
  let centralVault: Contract;
  let orderRouter: Contract;
  let orderBookImplementation: Contract;
  let factory: Contract;
  let orderBookProxy: Contract;
  let deployer: HardhatEthersSigner;
  let trader1: HardhatEthersSigner;
  let trader2: HardhatEthersSigner;
  let trader3: HardhatEthersSigner;

  const USDC_DECIMALS = 6;
  const INITIAL_USDC_BALANCE = ethers.parseUnits("10000", USDC_DECIMALS); // 10,000 USDC
  const MARKET_CREATION_FEE = ethers.parseEther("1");
  const TICK_SIZE = ethers.parseEther("0.01"); // 0.01 ETH (hardcoded in contract)

  async function deploySystem() {
    [deployer, trader1, trader2, trader3] = await ethers.getSigners();

    // Deploy Mock UMA Finder
    const MockUMAFinder = await ethers.getContractFactory("MockUMAFinder");
    mockUMAFinder = await MockUMAFinder.deploy();
    await mockUMAFinder.waitForDeployment();

    // Deploy Mock USDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();

    // Deploy UMA Oracle Manager
    const UMAOracleManager = await ethers.getContractFactory("UMAOracleManager");
    umaOracleManager = await UMAOracleManager.deploy(
      await mockUMAFinder.getAddress(),
      await mockUSDC.getAddress(),
      deployer.address
    );
    await umaOracleManager.waitForDeployment();

    // Deploy Central Vault
    const CentralVault = await ethers.getContractFactory("CentralVault");
    centralVault = await CentralVault.deploy(
      deployer.address,
      86400, // 24 hours pause duration
      await mockUSDC.getAddress() // Primary collateral
    );
    await centralVault.waitForDeployment();

    // Deploy Order Router
    const OrderRouter = await ethers.getContractFactory("OrderRouter");
    orderRouter = await OrderRouter.deploy(
      await centralVault.getAddress(),
      await umaOracleManager.getAddress(),
      deployer.address,
      20 // 0.2% trading fee
    );
    await orderRouter.waitForDeployment();

    // Deploy OrderBook Implementation
    const OrderBook = await ethers.getContractFactory("OrderBook");
    orderBookImplementation = await OrderBook.deploy();
    await orderBookImplementation.waitForDeployment();

    // Deploy Metrics Market Factory
    const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
    factory = await MetricsMarketFactory.deploy(
      await umaOracleManager.getAddress(),
      await orderBookImplementation.getAddress(),
      await centralVault.getAddress(),
      await orderRouter.getAddress(),
      deployer.address,
      MARKET_CREATION_FEE,
      deployer.address // fee recipient
    );
    await factory.waitForDeployment();

    // Configure contracts
    await umaOracleManager.grantRole(
      await umaOracleManager.METRIC_MANAGER_ROLE(),
      await factory.getAddress()
    );

    await centralVault.setMarketAuthorization(await orderRouter.getAddress(), true);
    await centralVault.setMarketAuthorization(await factory.getAddress(), true);

    await orderRouter.grantRole(
      await orderRouter.MARKET_ROLE(),
      await factory.getAddress()
    );

    // Mint USDC to traders
    await mockUSDC.mint(trader1.address, INITIAL_USDC_BALANCE);
    await mockUSDC.mint(trader2.address, INITIAL_USDC_BALANCE);
    await mockUSDC.mint(trader3.address, INITIAL_USDC_BALANCE);

    // Approve vault to spend USDC for all traders
    await mockUSDC.connect(trader1).approve(await centralVault.getAddress(), ethers.MaxUint256);
    await mockUSDC.connect(trader2).approve(await centralVault.getAddress(), ethers.MaxUint256);
    await mockUSDC.connect(trader3).approve(await centralVault.getAddress(), ethers.MaxUint256);

    // Deposit USDC to vault for all traders
    const depositAmount = ethers.parseUnits("5000", USDC_DECIMALS); // 5,000 USDC each
    await centralVault.connect(trader1).depositPrimaryCollateral(depositAmount);
    await centralVault.connect(trader2).depositPrimaryCollateral(depositAmount);
    await centralVault.connect(trader3).depositPrimaryCollateral(depositAmount);

    return {
      mockUMAFinder,
      mockUSDC,
      umaOracleManager,
      centralVault,
      orderRouter,
      orderBookImplementation,
      factory,
      deployer,
      trader1,
      trader2,
      trader3
    };
  }

  async function createTestMarket() {
    // Configure metric first
    const metricConfig = {
      identifier: ethers.keccak256(ethers.toUtf8Bytes("PROFIT_TEST_METRIC")),
      description: "Profit Test Metric",
      decimals: 2,
      minBond: ethers.parseEther("1000"),
      defaultReward: ethers.parseEther("10"),
      livenessPeriod: 3600,
      isActive: true,
      authorizedRequesters: []
    };

    await umaOracleManager.configureMetric(metricConfig);

    // Create market
    const currentTime = Math.floor(Date.now() / 1000);
    const marketConfig = {
      metricId: "PROFIT_TEST_METRIC",
      description: "Profit Test Market",
      oracleProvider: await umaOracleManager.getAddress(),
      decimals: 2,
      minimumOrderSize: ethers.parseUnits("1", USDC_DECIMALS), // $1 minimum
      tickSize: TICK_SIZE,
      creationFee: MARKET_CREATION_FEE,
      requiresKYC: false,
      settlementDate: currentTime + 7 * 24 * 3600, // 1 week
      tradingEndDate: currentTime + 6 * 24 * 3600,  // 6 days
      dataRequestWindow: 2 * 24 * 3600, // 2 days
      autoSettle: true,
      initialOrder: {
        enabled: false,
        side: 0,
        quantity: 0,
        price: 0,
        timeInForce: 0,
        expiryTime: 0
      }
    };

    const tx = await factory.createMarket(marketConfig, {
      value: MARKET_CREATION_FEE
    });
    await tx.wait();

    const marketAddress = await factory.getMarket("PROFIT_TEST_METRIC");
    orderBookProxy = await ethers.getContractAt("OrderBook", marketAddress);

    // Register the market with the OrderRouter
    await orderRouter.registerMarket("PROFIT_TEST_METRIC", marketAddress);

    // Authorize the OrderBook proxy in the CentralVault
    await centralVault.setMarketAuthorization(marketAddress, true);

    return orderBookProxy;
  }

  async function placeOrder(
    trader: HardhatEthersSigner, 
    side: number, 
    orderType: number,
    quantity: bigint, 
    price: bigint
  ) {
    const order = {
      orderId: 0,
      trader: trader.address,
      metricId: "PROFIT_TEST_METRIC",
      orderType: orderType, // 0 = MARKET, 1 = LIMIT
      side: side, // 0 = BUY, 1 = SELL
      quantity: quantity,
      price: price,
      filledQuantity: 0,
      timestamp: 0,
      expiryTime: 0,
      status: 0, // PENDING
      timeInForce: 0, // GTC
      stopPrice: 0,
      icebergQty: 0,
      postOnly: false,
      metadataHash: ethers.ZeroHash
    };

    const tx = await orderRouter.connect(trader).placeOrder(order);
    const receipt = await tx.wait();
    
    // Extract order ID from events
    const orderPlacedEvent = receipt?.logs?.find(
      (log: any) => log.fragment?.name === "OrderPlaced"
    );
    
    return orderPlacedEvent ? orderPlacedEvent.args[0] : null;
  }

  beforeEach(async function () {
    const deployment = await deploySystem();
    mockUMAFinder = deployment.mockUMAFinder;
    mockUSDC = deployment.mockUSDC;
    umaOracleManager = deployment.umaOracleManager;
    centralVault = deployment.centralVault;
    orderRouter = deployment.orderRouter;
    orderBookImplementation = deployment.orderBookImplementation;
    factory = deployment.factory;
    deployer = deployment.deployer;
    trader1 = deployment.trader1;
    trader2 = deployment.trader2;
    trader3 = deployment.trader3;

    await createTestMarket();
  });

  describe("Targeted $10 Profit Test", function () {
    it("Should allow Trader1 to gain exactly $10 profit", async function () {
      // Strategy: Trader1 will buy low and sell high to make exactly $10 profit
      
      // Test configuration for targeted profit
      const entryPrice = ethers.parseEther("1.00"); // Entry at 1.00 ETH
      const exitPrice = ethers.parseEther("1.10");  // Exit at 1.10 ETH (10% higher)
      
      // Calculate position size needed for $10 profit
      // If we buy at 1.00 ETH and sell at 1.10 ETH, we need a position size that yields $10
      // For simplicity, let's use $100 position size for a 10% gain = $10 profit (before fees)
      const positionSize = ethers.parseUnits("100", USDC_DECIMALS); // $100 position
      
      console.log(`\n🎯 TARGET: Trader1 should gain $10 profit`);
      console.log(`📊 Strategy: Buy at ${ethers.formatEther(entryPrice)} ETH, Sell at ${ethers.formatEther(exitPrice)} ETH`);
      console.log(`💰 Position Size: $${ethers.formatUnits(positionSize, USDC_DECIMALS)}`);
      
      // Get initial balance
      const [trader1InitialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      console.log(`💳 Trader1 Initial Balance: $${ethers.formatUnits(trader1InitialBalance, USDC_DECIMALS)}`);

      // Step 1: Entry Trade - Trader1 buys at 1.00 ETH
      console.log(`\n📈 STEP 1: Entry Trade`);
      
      // Trader2 provides sell liquidity at entry price
      const sellLiquidityOrderId = await placeOrder(
        trader2,
        1, // SELL
        1, // LIMIT
        positionSize,
        entryPrice
      );
      console.log(`🔄 Trader2 placed SELL limit order at ${ethers.formatEther(entryPrice)} ETH (Order ID: ${sellLiquidityOrderId})`);

      // Trader1 places buy market order to take the position
      const entryOrderId = await placeOrder(
        trader1,
        0, // BUY
        0, // MARKET
        positionSize,
        ethers.parseEther("10.0") // High price to ensure execution
      );
      console.log(`✅ Trader1 placed BUY market order (Order ID: ${entryOrderId})`);

      // Check balance after entry
      const [trader1BalanceAfterEntry] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const entryCost = trader1InitialBalance - trader1BalanceAfterEntry;
      console.log(`💸 Entry Cost: $${ethers.formatUnits(entryCost, USDC_DECIMALS)}`);
      console.log(`💳 Balance After Entry: $${ethers.formatUnits(trader1BalanceAfterEntry, USDC_DECIMALS)}`);

      // Step 2: Exit Trade - Trader1 sells at 1.10 ETH
      console.log(`\n📉 STEP 2: Exit Trade`);
      
      // Trader3 provides buy liquidity at exit price
      const buyLiquidityOrderId = await placeOrder(
        trader3,
        0, // BUY
        1, // LIMIT
        positionSize,
        exitPrice
      );
      console.log(`🔄 Trader3 placed BUY limit order at ${ethers.formatEther(exitPrice)} ETH (Order ID: ${buyLiquidityOrderId})`);

      // Trader1 places sell market order to exit the position
      const exitOrderId = await placeOrder(
        trader1,
        1, // SELL
        0, // MARKET
        positionSize,
        TICK_SIZE // Low price to ensure execution
      );
      console.log(`✅ Trader1 placed SELL market order (Order ID: ${exitOrderId})`);

      // Step 3: Calculate final PNL
      console.log(`\n💰 STEP 3: PNL Calculation`);
      
      const [trader1FinalBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const actualPNL = trader1FinalBalance - trader1InitialBalance;
      
      console.log(`💳 Initial Balance: $${ethers.formatUnits(trader1InitialBalance, USDC_DECIMALS)}`);
      console.log(`💳 Final Balance: $${ethers.formatUnits(trader1FinalBalance, USDC_DECIMALS)}`);
      console.log(`📊 Actual PNL: $${ethers.formatUnits(actualPNL, USDC_DECIMALS)}`);
      
      // Calculate expected profit (accounting for 0.2% trading fees on each trade)
      const tradingFeeRate = 20; // 20 basis points = 0.2%
      const expectedGrossProfit = ethers.parseUnits("10", USDC_DECIMALS); // $10
      const entryTradeFee = (entryCost * BigInt(tradingFeeRate)) / BigInt(10000);
      const exitTradeValue = positionSize; // Approximate
      const exitTradeFee = (exitTradeValue * BigInt(tradingFeeRate)) / BigInt(10000);
      const totalFees = entryTradeFee + exitTradeFee;
      const expectedNetProfit = expectedGrossProfit - totalFees;
      
      console.log(`📋 Expected Gross Profit: $${ethers.formatUnits(expectedGrossProfit, USDC_DECIMALS)}`);
      console.log(`💸 Expected Total Fees: $${ethers.formatUnits(totalFees, USDC_DECIMALS)}`);
      console.log(`🎯 Expected Net Profit: $${ethers.formatUnits(expectedNetProfit, USDC_DECIMALS)}`);
      
      // Test assertions
      console.log(`\n🧪 ASSERTIONS:`);
      
      // Should be profitable (at least close to $10 target, allowing for fees)
      const minExpectedProfit = ethers.parseUnits("8", USDC_DECIMALS); // $8 (allowing for fees)
      const maxExpectedProfit = ethers.parseUnits("12", USDC_DECIMALS); // $12 (some tolerance)
      
      console.log(`✅ Checking if PNL is between $${ethers.formatUnits(minExpectedProfit, USDC_DECIMALS)} and $${ethers.formatUnits(maxExpectedProfit, USDC_DECIMALS)}`);
      
      expect(actualPNL).to.be.within(minExpectedProfit, maxExpectedProfit, 
        `Expected PNL to be around $10, but got $${ethers.formatUnits(actualPNL, USDC_DECIMALS)}`);
      
      // Should be profitable
      expect(actualPNL).to.be.gt(0, "Trade should be profitable");
      
      console.log(`🎉 SUCCESS: Trader1 achieved target profit of ~$10!`);
    });

    it("Should demonstrate the impact of trading fees on profits", async function () {
      console.log(`\n🔍 ANALYZING TRADING FEE IMPACT`);
      
      const price = ethers.parseEther("1.00");
      const positionSize = ethers.parseUnits("1000", USDC_DECIMALS); // $1000 position for clearer fee impact
      
      const [initialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      console.log(`💳 Initial Balance: $${ethers.formatUnits(initialBalance, USDC_DECIMALS)}`);
      
      // Execute a round-trip trade at the same price (should only lose fees)
      await placeOrder(trader2, 1, 1, positionSize, price); // Sell liquidity
      await placeOrder(trader1, 0, 0, positionSize, ethers.parseEther("10.0")); // Buy
      
      await placeOrder(trader3, 0, 1, positionSize, price); // Buy liquidity  
      await placeOrder(trader1, 1, 0, positionSize, TICK_SIZE); // Sell back
      
      const [finalBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const totalCost = initialBalance - finalBalance;
      
      // Expected fee: 0.2% on each trade = 0.4% total on $1000 = $4
      const expectedFees = (positionSize * BigInt(40)) / BigInt(10000); // 40 basis points
      
      console.log(`💸 Total Cost (Fees): $${ethers.formatUnits(totalCost, USDC_DECIMALS)}`);
      console.log(`📊 Expected Fees: $${ethers.formatUnits(expectedFees, USDC_DECIMALS)}`);
      
      // Fees should be approximately 0.4% of position size
      expect(totalCost).to.be.within(
        expectedFees - ethers.parseUnits("0.5", USDC_DECIMALS),
        expectedFees + ethers.parseUnits("0.5", USDC_DECIMALS),
        "Trading fees should be approximately 0.4% of position"
      );
    });
  });
});
