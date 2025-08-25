import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("Initial Order Market Creation", function () {
  // Deployment fixture
  async function deployOrderBookDEXWithInitialOrderFixture() {
    const [deployer, creator, trader1, trader2] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();

    // Deploy CentralVault
    const CentralVault = await ethers.getContractFactory("CentralVault");
    const centralVault = await CentralVault.deploy(
      deployer.address, // admin
      86400, // 1 day emergency pause duration
      mockUSDC.target // primary collateral
    );

    // Deploy UMAOracleManager (mock version)
    const UMAOracleManager = await ethers.getContractFactory("UMAOracleManager");
    const umaOracleManager = await UMAOracleManager.deploy(
      deployer.address, // finder (mock)
      mockUSDC.target, // bond currency
      deployer.address // admin
    );

    // Deploy OrderRouter
    const OrderRouter = await ethers.getContractFactory("OrderRouter");
    const orderRouter = await OrderRouter.deploy(
      centralVault.target,
      umaOracleManager.target,
      deployer.address, // admin
      50 // 0.5% trading fee
    );

    // Deploy OrderBook implementation
    const OrderBook = await ethers.getContractFactory("OrderBook");
    const orderBookImpl = await OrderBook.deploy();

    // Deploy MetricsMarketFactory
    const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
    const factory = await MetricsMarketFactory.deploy(
      umaOracleManager.target,
      orderBookImpl.target,
      centralVault.target,
      orderRouter.target,
      deployer.address, // admin
      ethers.parseEther("0.1"), // default creation fee
      deployer.address // fee recipient
    );

    // Setup permissions
    await centralVault.setMarketAuthorization(orderRouter.target, true);
    await orderRouter.grantRole(await orderRouter.ROUTER_ADMIN_ROLE(), deployer.address);

    // Mint tokens to users and approve
    await mockUSDC.mint(creator.address, ethers.parseEther("10000"));
    await mockUSDC.mint(trader1.address, ethers.parseEther("10000"));
    await mockUSDC.mint(trader2.address, ethers.parseEther("10000"));

    // Approve vault for token transfers
    await mockUSDC.connect(creator).approve(centralVault.target, ethers.parseEther("10000"));
    await mockUSDC.connect(trader1).approve(centralVault.target, ethers.parseEther("10000"));
    await mockUSDC.connect(trader2).approve(centralVault.target, ethers.parseEther("10000"));

    // Deposit collateral
    await centralVault.connect(creator).deposit(mockUSDC.target, ethers.parseEther("5000"));
    await centralVault.connect(trader1).deposit(mockUSDC.target, ethers.parseEther("3000"));
    await centralVault.connect(trader2).deposit(mockUSDC.target, ethers.parseEther("2000"));

    return {
      deployer,
      creator,
      trader1,
      trader2,
      mockUSDC,
      centralVault,
      umaOracleManager,
      orderRouter,
      orderBookImpl,
      factory
    };
  }

  describe("Market Creation with Initial Orders", function () {
    it("Should create market with initial BUY order", async function () {
      const { factory, creator, orderRouter } = await loadFixture(deployOrderBookDEXWithInitialOrderFixture);

      const futureTime = (await time.latest()) + (365 * 24 * 60 * 60); // 1 year
      const tradingEndTime = futureTime - (5 * 24 * 60 * 60); // 5 days before settlement

      const marketConfig = {
        metricId: "WORLD_POPULATION_2025",
        description: "Global population by end of 2025",
        oracleProvider: creator.address,
        decimals: 0,
        minimumOrderSize: ethers.parseEther("1"),
        tickSize: ethers.parseEther("0.01"), // Fixed tick size
        creationFee: ethers.parseEther("0.1"),
        requiresKYC: false,
        settlementDate: futureTime,
        tradingEndDate: tradingEndTime,
        dataRequestWindow: 7 * 24 * 60 * 60, // 7 days
        autoSettle: true,
        initialOrder: {
          enabled: true,
          side: 0, // BUY
          quantity: ethers.parseEther("100"),
          price: ethers.parseEther("8.1"), // 8.1 billion
          timeInForce: 0, // GTC
          expiryTime: 0
        }
      };

      // Create market with initial order
      const tx = await factory.connect(creator).createMarket(marketConfig, {
        value: ethers.parseEther("0.1")
      });

      const receipt = await tx.wait();
      
      // Check for MarketCreated event
      const marketCreatedEvent = receipt.logs.find(
        log => log.fragment?.name === "MarketCreated"
      );
      expect(marketCreatedEvent).to.not.be.undefined;

      // Check for InitialOrderPlaced event
      const initialOrderEvent = receipt.logs.find(
        log => log.fragment?.name === "InitialOrderPlaced"
      );
      expect(initialOrderEvent).to.not.be.undefined;

      // Get market address
      const marketAddress = await factory.getMarket("WORLD_POPULATION_2025");
      expect(marketAddress).to.not.equal(ethers.ZeroAddress);

      // Check order book state
      const orderBook = await ethers.getContractAt("OrderBook", marketAddress);
      const bestBid = await orderBook.getBestBid();
      const bestAsk = await orderBook.getBestAsk();

      expect(bestBid).to.equal(ethers.parseEther("8.1"));
      expect(bestAsk).to.equal(0); // No asks yet
    });

    it("Should create market with initial SELL order", async function () {
      const { factory, creator } = await loadFixture(deployOrderBookDEXWithInitialOrderFixture);

      const futureTime = (await time.latest()) + (365 * 24 * 60 * 60);
      const tradingEndTime = futureTime - (5 * 24 * 60 * 60);

      const marketConfig = {
        metricId: "US_GDP_2025",
        description: "US GDP in trillions for 2025",
        oracleProvider: creator.address,
        decimals: 1,
        minimumOrderSize: ethers.parseEther("10"),
        tickSize: ethers.parseEther("0.01"), // Fixed tick size
        creationFee: ethers.parseEther("0.1"),
        requiresKYC: false,
        settlementDate: futureTime,
        tradingEndDate: tradingEndTime,
        dataRequestWindow: 7 * 24 * 60 * 60,
        autoSettle: true,
        initialOrder: {
          enabled: true,
          side: 1, // SELL
          quantity: ethers.parseEther("50"),
          price: ethers.parseEther("26.5"), // $26.5T
          timeInForce: 0, // GTC
          expiryTime: 0
        }
      };

      await factory.connect(creator).createMarket(marketConfig, {
        value: ethers.parseEther("0.1")
      });

      const marketAddress = await factory.getMarket("US_GDP_2025");
      const orderBook = await ethers.getContractAt("OrderBook", marketAddress);
      
      const bestBid = await orderBook.getBestBid();
      const bestAsk = await orderBook.getBestAsk();

      expect(bestBid).to.equal(0); // No bids yet
      expect(bestAsk).to.equal(ethers.parseEther("26.5"));
    });

    it("Should create market with GTD initial order", async function () {
      const { factory, creator } = await loadFixture(deployOrderBookDEXWithInitialOrderFixture);

      const futureTime = (await time.latest()) + (365 * 24 * 60 * 60);
      const tradingEndTime = futureTime - (5 * 24 * 60 * 60);
      const orderExpiryTime = (await time.latest()) + (30 * 24 * 60 * 60); // 30 days

      const marketConfig = {
        metricId: "TEMP_ANOMALY_2025",
        description: "Global temperature anomaly 2025",
        oracleProvider: creator.address,
        decimals: 2,
        minimumOrderSize: ethers.parseEther("5"),
        tickSize: ethers.parseEther("0.01"),
        creationFee: ethers.parseEther("0.1"),
        requiresKYC: false,
        settlementDate: futureTime,
        tradingEndDate: tradingEndTime,
        dataRequestWindow: 7 * 24 * 60 * 60,
        autoSettle: true,
        initialOrder: {
          enabled: true,
          side: 0, // BUY
          quantity: ethers.parseEther("20"),
          price: ethers.parseEther("1.25"), // +1.25°C
          timeInForce: 3, // GTD
          expiryTime: orderExpiryTime
        }
      };

      const tx = await factory.connect(creator).createMarket(marketConfig, {
        value: ethers.parseEther("0.1")
      });

      const receipt = await tx.wait();
      
      // Check that order was placed with correct expiry
      const initialOrderEvent = receipt.logs.find(
        log => log.fragment?.name === "InitialOrderPlaced"
      );
      
      expect(initialOrderEvent).to.not.be.undefined;
      
      // Get the order ID from the event and check its details
      const orderId = initialOrderEvent.args.orderId;
      const orderDetails = await orderRouter.getOrder(orderId);
      
      expect(orderDetails.expiryTime).to.equal(orderExpiryTime);
      expect(orderDetails.timeInForce).to.equal(3); // GTD
    });

    it("Should create market without initial order", async function () {
      const { factory, creator } = await loadFixture(deployOrderBookDEXWithInitialOrderFixture);

      const futureTime = (await time.latest()) + (365 * 24 * 60 * 60);
      const tradingEndTime = futureTime - (5 * 24 * 60 * 60);

      const marketConfig = {
        metricId: "NO_INITIAL_ORDER",
        description: "Market without initial order",
        oracleProvider: creator.address,
        decimals: 0,
        minimumOrderSize: ethers.parseEther("1"),
        tickSize: ethers.parseEther("0.01"), // Fixed tick size
        creationFee: ethers.parseEther("0.1"),
        requiresKYC: false,
        settlementDate: futureTime,
        tradingEndDate: tradingEndTime,
        dataRequestWindow: 7 * 24 * 60 * 60,
        autoSettle: true,
        initialOrder: {
          enabled: false, // No initial order
          side: 0,
          quantity: 0,
          price: 0,
          timeInForce: 0,
          expiryTime: 0
        }
      };

      const tx = await factory.connect(creator).createMarket(marketConfig, {
        value: ethers.parseEther("0.1")
      });

      const receipt = await tx.wait();

      // Should have MarketCreated but no InitialOrderPlaced event
      const marketCreatedEvent = receipt.logs.find(
        log => log.fragment?.name === "MarketCreated"
      );
      const initialOrderEvent = receipt.logs.find(
        log => log.fragment?.name === "InitialOrderPlaced"
      );

      expect(marketCreatedEvent).to.not.be.undefined;
      expect(initialOrderEvent).to.be.undefined;

      // Order book should be empty
      const marketAddress = await factory.getMarket("NO_INITIAL_ORDER");
      const orderBook = await ethers.getContractAt("OrderBook", marketAddress);
      
      const bestBid = await orderBook.getBestBid();
      const bestAsk = await orderBook.getBestAsk();

      expect(bestBid).to.equal(0);
      expect(bestAsk).to.equal(0);
    });
  });

  describe("Validation Tests", function () {
    it("Should revert if initial order price not aligned to tick size", async function () {
      const { factory, creator } = await loadFixture(deployOrderBookDEXWithInitialOrderFixture);

      const futureTime = (await time.latest()) + (365 * 24 * 60 * 60);
      const tradingEndTime = futureTime - (5 * 24 * 60 * 60);

      const marketConfig = {
        metricId: "INVALID_PRICE",
        description: "Invalid price test",
        oracleProvider: creator.address,
        decimals: 0,
        minimumOrderSize: ethers.parseEther("1"),
        tickSize: ethers.parseEther("0.01"), // Fixed tick size
        creationFee: ethers.parseEther("0.1"),
        requiresKYC: false,
        settlementDate: futureTime,
        tradingEndDate: tradingEndTime,
        dataRequestWindow: 7 * 24 * 60 * 60,
        autoSettle: true,
        initialOrder: {
          enabled: true,
          side: 0,
          quantity: ethers.parseEther("10"),
          price: ethers.parseEther("1.155"), // Not aligned to 0.01 tick size
          timeInForce: 0,
          expiryTime: 0
        }
      };

      await expect(
        factory.connect(creator).createMarket(marketConfig, {
          value: ethers.parseEther("0.1")
        })
      ).to.be.revertedWith("MetricsMarketFactory: Initial order price not aligned to 0.01 tick size");
    });

    it("Should revert if initial order quantity below minimum", async function () {
      const { factory, creator } = await loadFixture(deployOrderBookDEXWithInitialOrderFixture);

      const futureTime = (await time.latest()) + (365 * 24 * 60 * 60);
      const tradingEndTime = futureTime - (5 * 24 * 60 * 60);

      const marketConfig = {
        metricId: "INVALID_QUANTITY",
        description: "Invalid quantity test",
        oracleProvider: creator.address,
        decimals: 0,
        minimumOrderSize: ethers.parseEther("10"), // Minimum 10
        tickSize: ethers.parseEther("0.01"), // Fixed tick size
        creationFee: ethers.parseEther("0.1"),
        requiresKYC: false,
        settlementDate: futureTime,
        tradingEndDate: tradingEndTime,
        dataRequestWindow: 7 * 24 * 60 * 60,
        autoSettle: true,
        initialOrder: {
          enabled: true,
          side: 0,
          quantity: ethers.parseEther("5"), // Below minimum
          price: ethers.parseEther("1.0"),
          timeInForce: 0,
          expiryTime: 0
        }
      };

      await expect(
        factory.connect(creator).createMarket(marketConfig, {
          value: ethers.parseEther("0.1")
        })
      ).to.be.revertedWith("MetricsMarketFactory: Initial order below minimum size");
    });

    it("Should revert if GTD order expiry time is invalid", async function () {
      const { factory, creator } = await loadFixture(deployOrderBookDEXWithInitialOrderFixture);

      const futureTime = (await time.latest()) + (365 * 24 * 60 * 60);
      const tradingEndTime = futureTime - (5 * 24 * 60 * 60);
      const pastTime = (await time.latest()) - (24 * 60 * 60); // Past time

      const marketConfig = {
        metricId: "INVALID_EXPIRY",
        description: "Invalid expiry test",
        oracleProvider: creator.address,
        decimals: 0,
        minimumOrderSize: ethers.parseEther("1"),
        tickSize: ethers.parseEther("0.01"), // Fixed tick size
        creationFee: ethers.parseEther("0.1"),
        requiresKYC: false,
        settlementDate: futureTime,
        tradingEndDate: tradingEndTime,
        dataRequestWindow: 7 * 24 * 60 * 60,
        autoSettle: true,
        initialOrder: {
          enabled: true,
          side: 0,
          quantity: ethers.parseEther("10"),
          price: ethers.parseEther("1.0"),
          timeInForce: 3, // GTD
          expiryTime: pastTime // Past time
        }
      };

      await expect(
        factory.connect(creator).createMarket(marketConfig, {
          value: ethers.parseEther("0.1")
        })
      ).to.be.revertedWith("MetricsMarketFactory: Initial order expiry time must be in future");
    });
  });

  describe("Integration Tests", function () {
    it("Should allow trading against initial order", async function () {
      const { factory, creator, trader1, orderRouter } = await loadFixture(deployOrderBookDEXWithInitialOrderFixture);

      const futureTime = (await time.latest()) + (365 * 24 * 60 * 60);
      const tradingEndTime = futureTime - (5 * 24 * 60 * 60);

      // Create market with initial BUY order
      const marketConfig = {
        metricId: "TRADEABLE_MARKET",
        description: "Market for trading test",
        oracleProvider: creator.address,
        decimals: 0,
        minimumOrderSize: ethers.parseEther("1"),
        tickSize: ethers.parseEther("0.01"), // Fixed tick size
        creationFee: ethers.parseEther("0.1"),
        requiresKYC: false,
        settlementDate: futureTime,
        tradingEndDate: tradingEndTime,
        dataRequestWindow: 7 * 24 * 60 * 60,
        autoSettle: true,
        initialOrder: {
          enabled: true,
          side: 0, // BUY
          quantity: ethers.parseEther("50"),
          price: ethers.parseEther("10.0"),
          timeInForce: 0, // GTC
          expiryTime: 0
        }
      };

      await factory.connect(creator).createMarket(marketConfig, {
        value: ethers.parseEther("0.1")
      });

      // Now trader1 places a SELL order to match
      const sellOrder = {
        orderId: 0,
        trader: trader1.address,
        metricId: "TRADEABLE_MARKET",
        orderType: 1, // LIMIT
        side: 1, // SELL
        quantity: ethers.parseEther("25"), // Partial fill
        price: ethers.parseEther("10.0"), // Same price
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

      const tx = await orderRouter.connect(trader1).placeOrder(sellOrder);
      await tx.wait();

      // Check if trade occurred
      const marketAddress = await factory.getMarket("TRADEABLE_MARKET");
      const orderBook = await ethers.getContractAt("OrderBook", marketAddress);
      const stats = await orderBook.getMarketStats();

      expect(stats.lastPrice).to.equal(ethers.parseEther("10.0"));
      expect(stats.totalTrades).to.equal(1);
    });
  });
});
