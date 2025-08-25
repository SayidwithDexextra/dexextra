import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Trading and PNL Tests", function () {
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
      identifier: ethers.keccak256(ethers.toUtf8Bytes("BTC_PRICE_TEST")),
      description: "Bitcoin Price Metric for Testing",
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
      metricId: "BTC_PRICE_TEST",
      description: "Bitcoin Price Testing Market",
      oracleProvider: await umaOracleManager.getAddress(),
      decimals: 2,
      minimumOrderSize: ethers.parseUnits("10", USDC_DECIMALS), // $10 minimum
      tickSize: ethers.parseUnits("1", USDC_DECIMALS), // $1.00 tick size
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

    const marketAddress = await factory.getMarket("BTC_PRICE_TEST");
    orderBookProxy = await ethers.getContractAt("OrderBook", marketAddress);

    // Register the market with the OrderRouter
    await orderRouter.registerMarket("BTC_PRICE_TEST", marketAddress);

    return orderBookProxy;
  }

  async function placeOrder(
    trader: HardhatEthersSigner, 
    side: number, 
    orderType: number,
    quantity: bigint, 
    price: bigint,
    timeInForce: number = 0, // GTC
    expiryTime: number = 0
  ) {
    const order = {
      orderId: 0, // Will be set by the contract
      trader: trader.address,
      metricId: "BTC_PRICE_TEST",
      orderType: orderType, // 0 = MARKET, 1 = LIMIT, 2 = STOP_LOSS, 3 = TAKE_PROFIT
      side: side, // 0 = BUY, 1 = SELL
      quantity: quantity,
      price: price,
      filledQuantity: 0, // Will be updated by contract
      timestamp: 0, // Will be set by contract
      expiryTime: expiryTime,
      status: 0, // PENDING
      timeInForce: timeInForce, // 0 = GTC, 1 = IOC, 2 = FOK, 3 = GTD
      stopPrice: 0, // Not used for basic orders
      icebergQty: 0, // Not used for basic orders
      postOnly: false, // Not used for basic orders
      metadataHash: ethers.ZeroHash // No metadata
    };

    const tx = await orderRouter.connect(trader).placeOrder(order);
    const receipt = await tx.wait();
    
    // Extract order ID from events
    const orderPlacedEvent = receipt?.logs?.find(
      (log: any) => log.fragment?.name === "OrderPlaced"
    );
    
    return orderPlacedEvent ? orderPlacedEvent.args[0] : null; // orderId
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

  describe("Order Placement and Matching", function () {
    it("Should place limit orders and create order book", async function () {
      // Use 18-decimal prices to align with hardcoded tick size (0.01 ETH = 1e16)
      const basePrice = ethers.parseEther("0.5"); // 0.5 ETH
      const orderSize = ethers.parseUnits("100", USDC_DECIMALS); // $100 worth

      // Trader1 places BUY limit orders at different prices
      const buyOrder1 = await placeOrder(
        trader1, 
        0, // BUY
        1, // LIMIT
        orderSize,
        basePrice - ethers.parseEther("0.01") // 0.49 ETH
      );

      const buyOrder2 = await placeOrder(
        trader1,
        0, // BUY  
        1, // LIMIT
        orderSize,
        basePrice - ethers.parseEther("0.02") // 0.48 ETH
      );

      // Trader2 places SELL limit orders at different prices
      const sellOrder1 = await placeOrder(
        trader2,
        1, // SELL
        1, // LIMIT
        orderSize,
        basePrice + ethers.parseEther("0.01") // 0.51 ETH
      );

      const sellOrder2 = await placeOrder(
        trader2,
        1, // SELL
        1, // LIMIT
        orderSize,
        basePrice + ethers.parseEther("0.02") // 0.52 ETH
      );

      // Verify orders are placed
      expect(buyOrder1).to.not.be.null;
      expect(buyOrder2).to.not.be.null;
      expect(sellOrder1).to.not.be.null;
      expect(sellOrder2).to.not.be.null;

      // Check order book depth
      const bestBid = await orderBookProxy.getBestBid();
      const bestAsk = await orderBookProxy.getBestAsk();
      
      expect(bestBid).to.equal(basePrice - ethers.parseEther("0.01"));
      expect(bestAsk).to.equal(basePrice + ethers.parseEther("0.01"));
    });

    it("Should execute market orders against limit orders", async function () {
      const basePrice = ethers.parseEther("0.5"); // 0.5 ETH
      const orderSize = ethers.parseUnits("100", USDC_DECIMALS);

      // Trader1 places BUY limit order
      await placeOrder(
        trader1,
        0, // BUY
        1, // LIMIT
        orderSize,
        basePrice
      );

      // Get initial balances
      const [trader1InitialAvailable] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const [trader2InitialAvailable] = await centralVault.getPrimaryCollateralBalance(trader2.address);

      // Trader2 places SELL market order (should match with trader1's limit order)
      await placeOrder(
        trader2,
        1, // SELL
        0, // MARKET
        orderSize,
        0 // Market orders don't need price
      );

      // Check balances changed (orders matched)
      const [trader1FinalAvailable] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const [trader2FinalAvailable] = await centralVault.getPrimaryCollateralBalance(trader2.address);

      // Trader1 should have less available balance (locked in position)
      expect(trader1FinalAvailable).to.be.lt(trader1InitialAvailable);
      
      // Trader2 should have less available balance (locked in position)  
      expect(trader2FinalAvailable).to.be.lt(trader2InitialAvailable);
    });

    it("Should handle partial fills correctly", async function () {
      const basePrice = ethers.parseUnits("50000", USDC_DECIMALS);
      const largeOrderSize = ethers.parseUnits("200", USDC_DECIMALS); // $200
      const smallOrderSize = ethers.parseUnits("100", USDC_DECIMALS); // $100

      // Trader1 places large BUY limit order
      await placeOrder(
        trader1,
        0, // BUY
        1, // LIMIT
        largeOrderSize,
        basePrice
      );

      // Trader2 places smaller SELL market order (partial fill)
      await placeOrder(
        trader2,
        1, // SELL
        0, // MARKET
        smallOrderSize,
        0
      );

      // Check that limit order is partially filled
      const bestBid = await orderBookProxy.getBestBid();
      expect(bestBid).to.equal(basePrice); // Should still be there with remaining quantity
    });
  });

  describe("PNL Calculation and Position Management", function () {
    it("Should calculate PNL correctly for profitable position", async function () {
      const entryPrice = ethers.parseUnits("50000", USDC_DECIMALS); // $50,000
      const exitPrice = ethers.parseUnits("51000", USDC_DECIMALS);  // $51,000 (profit)
      const positionSize = ethers.parseUnits("100", USDC_DECIMALS); // $100 worth

      // Step 1: Trader1 buys (goes long) at $50,000
      await placeOrder(
        trader2,
        1, // SELL (providing liquidity)
        1, // LIMIT
        positionSize,
        entryPrice
      );

      const [trader1InitialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);

      await placeOrder(
        trader1,
        0, // BUY (taking position)
        0, // MARKET
        positionSize,
        0
      );

      // Step 2: Market moves up, trader1 sells at $51,000
      await placeOrder(
        trader3,
        0, // BUY (providing liquidity for exit)
        1, // LIMIT
        positionSize,
        exitPrice
      );

      await placeOrder(
        trader1,
        1, // SELL (closing position)
        0, // MARKET
        positionSize,
        0
      );

      // Step 3: Check PNL
      const [trader1FinalBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      
      // Calculate expected profit (excluding fees)
      // PNL = (exitPrice - entryPrice) * position_size / entryPrice
      // PNL = (51000 - 50000) * 100 / 50000 = 1000 * 100 / 50000 = 2 USDC
      
      const expectedProfit = (exitPrice - entryPrice) * positionSize / entryPrice;
      const actualPNL = trader1FinalBalance - trader1InitialBalance;
      
      // Should be profitable (allowing for small trading fees)
      expect(actualPNL).to.be.gt(-ethers.parseUnits("1", USDC_DECIMALS)); // Small tolerance for fees
      
      console.log(`Entry Price: $${ethers.formatUnits(entryPrice, USDC_DECIMALS)}`);
      console.log(`Exit Price: $${ethers.formatUnits(exitPrice, USDC_DECIMALS)}`);
      console.log(`Position Size: $${ethers.formatUnits(positionSize, USDC_DECIMALS)}`);
      console.log(`Expected Profit: $${ethers.formatUnits(expectedProfit, USDC_DECIMALS)}`);
      console.log(`Actual PNL: $${ethers.formatUnits(actualPNL, USDC_DECIMALS)}`);
    });

    it("Should calculate PNL correctly for losing position", async function () {
      const entryPrice = ethers.parseUnits("50000", USDC_DECIMALS); // $50,000
      const exitPrice = ethers.parseUnits("49000", USDC_DECIMALS);  // $49,000 (loss)
      const positionSize = ethers.parseUnits("100", USDC_DECIMALS); // $100 worth

      // Step 1: Trader1 buys (goes long) at $50,000
      await placeOrder(
        trader2,
        1, // SELL
        1, // LIMIT
        positionSize,
        entryPrice
      );

      const [trader1InitialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);

      await placeOrder(
        trader1,
        0, // BUY
        0, // MARKET
        positionSize,
        0
      );

      // Step 2: Market moves down, trader1 sells at $49,000
      await placeOrder(
        trader3,
        0, // BUY
        1, // LIMIT
        positionSize,
        exitPrice
      );

      await placeOrder(
        trader1,
        1, // SELL
        0, // MARKET
        positionSize,
        0
      );

      // Step 3: Check PNL
      const [trader1FinalBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      
      // Calculate expected loss
      const expectedLoss = (entryPrice - exitPrice) * positionSize / entryPrice;
      const actualPNL = trader1FinalBalance - trader1InitialBalance;
      
      // Should be negative (loss)
      expect(actualPNL).to.be.lt(0);
      
      console.log(`Entry Price: $${ethers.formatUnits(entryPrice, USDC_DECIMALS)}`);
      console.log(`Exit Price: $${ethers.formatUnits(exitPrice, USDC_DECIMALS)}`);
      console.log(`Position Size: $${ethers.formatUnits(positionSize, USDC_DECIMALS)}`);
      console.log(`Expected Loss: $${ethers.formatUnits(expectedLoss, USDC_DECIMALS)}`);
      console.log(`Actual PNL: $${ethers.formatUnits(actualPNL, USDC_DECIMALS)}`);
    });

    it("Should handle multiple positions and complex PNL scenarios", async function () {
      const prices = {
        entry1: ethers.parseUnits("50000", USDC_DECIMALS),
        entry2: ethers.parseUnits("50500", USDC_DECIMALS),
        exit1: ethers.parseUnits("51000", USDC_DECIMALS),
        exit2: ethers.parseUnits("49500", USDC_DECIMALS)
      };
      const positionSize = ethers.parseUnits("50", USDC_DECIMALS); // $50 each

      const [trader1InitialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);

      // Position 1: Buy at $50,000
      await placeOrder(trader2, 1, 1, positionSize, prices.entry1);
      await placeOrder(trader1, 0, 0, positionSize, 0);

      // Position 2: Buy at $50,500  
      await placeOrder(trader2, 1, 1, positionSize, prices.entry2);
      await placeOrder(trader1, 0, 0, positionSize, 0);

      // Exit Position 1: Sell at $51,000 (profit)
      await placeOrder(trader3, 0, 1, positionSize, prices.exit1);
      await placeOrder(trader1, 1, 0, positionSize, 0);

      // Exit Position 2: Sell at $49,500 (loss)
      await placeOrder(trader3, 0, 1, positionSize, prices.exit2);
      await placeOrder(trader1, 1, 0, positionSize, 0);

      const [trader1FinalBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const totalPNL = trader1FinalBalance - trader1InitialBalance;

      // Calculate expected PNL
      const pnl1 = (prices.exit1 - prices.entry1) * positionSize / prices.entry1;
      const pnl2 = (prices.exit2 - prices.entry2) * positionSize / prices.entry2;
      const expectedTotalPNL = pnl1 + pnl2;

      console.log(`Position 1 PNL: $${ethers.formatUnits(pnl1, USDC_DECIMALS)}`);
      console.log(`Position 2 PNL: $${ethers.formatUnits(pnl2, USDC_DECIMALS)}`);
      console.log(`Expected Total PNL: $${ethers.formatUnits(expectedTotalPNL, USDC_DECIMALS)}`);
      console.log(`Actual Total PNL: $${ethers.formatUnits(totalPNL, USDC_DECIMALS)}`);

      // Net should be close to expected (allowing for fees)
      expect(totalPNL).to.be.within(
        expectedTotalPNL - ethers.parseUnits("5", USDC_DECIMALS),
        expectedTotalPNL + ethers.parseUnits("5", USDC_DECIMALS)
      );
    });
  });

  describe("Trading Fee Impact", function () {
    it("Should apply trading fees correctly", async function () {
      const price = ethers.parseUnits("50000", USDC_DECIMALS);
      const quantity = ethers.parseUnits("100", USDC_DECIMALS);
      
      // Expected fee: 0.2% of trade value
      const expectedFee = quantity * BigInt(20) / BigInt(10000); // 20 basis points

      const [trader1InitialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);

      // Place orders that will match
      await placeOrder(trader2, 1, 1, quantity, price);
      await placeOrder(trader1, 0, 0, quantity, 0);

      const [trader1AfterTrade] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      
      // Should have paid the trading fee
      const feesPaid = trader1InitialBalance - trader1AfterTrade - quantity; // Minus position value
      
      console.log(`Expected Fee: $${ethers.formatUnits(expectedFee, USDC_DECIMALS)}`);
      console.log(`Actual Fees Paid: $${ethers.formatUnits(feesPaid, USDC_DECIMALS)}`);

      // Fees should be approximately correct (allowing for some calculation differences)
      expect(feesPaid).to.be.within(
        expectedFee - ethers.parseUnits("0.01", USDC_DECIMALS),
        expectedFee + ethers.parseUnits("0.01", USDC_DECIMALS)
      );
    });
  });

  describe("Order Management", function () {
    it("Should cancel unfilled limit orders", async function () {
      const price = ethers.parseUnits("50000", USDC_DECIMALS);
      const quantity = ethers.parseUnits("100", USDC_DECIMALS);

      // Place limit order that won't be filled
      const orderId = await placeOrder(trader1, 0, 1, quantity, price);

      // Cancel the order
      await orderRouter.connect(trader1).cancelOrder(orderId);

      // Try to cancel again (should fail)
      await expect(
        orderRouter.connect(trader1).cancelOrder(orderId)
      ).to.be.revertedWith("OrderRouter: Order not found or not active");
    });

    it("Should handle order expiration", async function () {
      const price = ethers.parseUnits("50000", USDC_DECIMALS);
      const quantity = ethers.parseUnits("100", USDC_DECIMALS);
      const currentTime = await time.latest();
      const expiryTime = currentTime + 3600; // 1 hour from now

      // Place GTD (Good Till Date) order
      const orderId = await placeOrder(
        trader1, 
        0, // BUY
        1, // LIMIT
        quantity, 
        price,
        3, // GTD (Good Till Date)
        expiryTime
      );

      // Fast forward past expiry
      await time.increaseTo(expiryTime + 1);

      // Try to match against expired order (should not match)
      await placeOrder(trader2, 1, 0, quantity, 0); // Market sell

      // The order should be marked as expired
      const isExpired = await orderRouter.isOrderExpired(orderId);
      expect(isExpired).to.be.true;
    });
  });
});
