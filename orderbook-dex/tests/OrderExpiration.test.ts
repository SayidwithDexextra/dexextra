import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("Order Expiration System", function () {
  // Deployment fixture
  async function deployOrderBookDEXFixture() {
    const [deployer, trader1, trader2, trader3] = await ethers.getSigners();

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
      25 // 0.25% trading fee
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
      ethers.parseEther("1"), // 1 ETH creation fee
      deployer.address // fee recipient
    );

    // Setup permissions
    await centralVault.grantRole(await centralVault.MARKET_ROLE(), factory.target);
    await orderRouter.grantRole(await orderRouter.MARKET_ROLE(), factory.target);

    // Mint and distribute USDC to traders
    await mockUSDC.mint(trader1.address, ethers.parseUnits("10000", 6));
    await mockUSDC.mint(trader2.address, ethers.parseUnits("10000", 6));
    await mockUSDC.mint(trader3.address, ethers.parseUnits("10000", 6));

    // Traders approve and deposit USDC
    for (const trader of [trader1, trader2, trader3]) {
      await mockUSDC.connect(trader).approve(centralVault.target, ethers.parseUnits("5000", 6));
      await centralVault.connect(trader).deposit(mockUSDC.target, ethers.parseUnits("5000", 6));
    }

    return {
      deployer,
      trader1,
      trader2,
      trader3,
      mockUSDC,
      centralVault,
      umaOracleManager,
      orderRouter,
      orderBookImpl,
      factory
    };
  }

  // Create a test market
  async function createTestMarket(factory: any, deployer: any) {
    const currentTime = await time.latest();
    const settlementDate = currentTime + 86400 * 30; // 30 days
    const tradingEndDate = currentTime + 86400 * 29; // 29 days

    const marketConfig = {
      metricId: "TEST_POPULATION_2024",
      description: "Test Population Market",
      oracleProvider: deployer.address,
      decimals: 0,
      minimumOrderSize: ethers.parseEther("0.01"),
      tickSize: ethers.parseEther("0.01"), // Fixed tick size
      creationFee: ethers.parseEther("1"),
      requiresKYC: false,
      settlementDate: settlementDate,
      tradingEndDate: tradingEndDate,
      dataRequestWindow: 86400, // 1 day
      autoSettle: true
    };

    const tx = await factory.createMarket(marketConfig, {
      value: marketConfig.creationFee
    });
    await tx.wait();

    const marketAddress = await factory.getMarket(marketConfig.metricId);
    const orderBook = await ethers.getContractAt("OrderBook", marketAddress);
    
    // Register market with router
    await factory.connect(deployer).grantRole(
      await factory.FACTORY_ADMIN_ROLE(),
      deployer.address
    );
    
    return { orderBook, marketConfig };
  }

  describe("Basic Order Expiration", function () {
    it("Should reject orders that are already expired", async function () {
      const { deployer, trader1, orderRouter, factory } = await loadFixture(deployOrderBookDEXFixture);
      const { orderBook, marketConfig } = await createTestMarket(factory, deployer);

      // Register market with router
      await orderRouter.registerMarket(marketConfig.metricId, orderBook.target);

      const currentTime = await time.latest();
      const expiredTime = currentTime - 3600; // 1 hour ago

      const expiredOrder = {
        orderId: 0,
        trader: trader1.address,
        metricId: marketConfig.metricId,
        orderType: 1, // LIMIT
        side: 0, // BUY
        quantity: ethers.parseEther("10"),
        price: ethers.parseEther("8100000000"),
        filledQuantity: 0,
        timestamp: 0,
        expiryTime: expiredTime,
        status: 0, // PENDING
        timeInForce: 3, // GTD
        stopPrice: 0,
        icebergQty: 0,
        postOnly: false,
        metadataHash: ethers.ZeroHash
      };

      // Order should be rejected because it's already expired
      await expect(
        orderRouter.connect(trader1).placeOrder(expiredOrder)
      ).to.be.revertedWith("OrderRouter: Order book rejected order");
    });

    it("Should accept orders with future expiry times", async function () {
      const { deployer, trader1, orderRouter, factory } = await loadFixture(deployOrderBookDEXFixture);
      const { orderBook, marketConfig } = await createTestMarket(factory, deployer);

      await orderRouter.registerMarket(marketConfig.metricId, orderBook.target);

      const currentTime = await time.latest();
      const futureTime = currentTime + 3600; // 1 hour from now

      const validOrder = {
        orderId: 0,
        trader: trader1.address,
        metricId: marketConfig.metricId,
        orderType: 1, // LIMIT
        side: 0, // BUY
        quantity: ethers.parseEther("10"),
        price: ethers.parseEther("8100000000"),
        filledQuantity: 0,
        timestamp: 0,
        expiryTime: futureTime,
        status: 0, // PENDING
        timeInForce: 3, // GTD
        stopPrice: 0,
        icebergQty: 0,
        postOnly: false,
        metadataHash: ethers.ZeroHash
      };

      const tx = await orderRouter.connect(trader1).placeOrder(validOrder);
      const receipt = await tx.wait();

      // Check that order was placed successfully
      expect(receipt.status).to.equal(1);
      
      // Get the order ID from events
      const orderPlacedEvent = receipt.logs.find(
        (log: any) => log.topics[0] === orderRouter.interface.getEvent("OrderPlaced").topicHash
      );
      expect(orderPlacedEvent).to.not.be.undefined;
    });

    it("Should detect orders eligible for expiration", async function () {
      const { deployer, trader1, orderRouter, factory } = await loadFixture(deployOrderBookDEXFixture);
      const { orderBook, marketConfig } = await createTestMarket(factory, deployer);

      await orderRouter.registerMarket(marketConfig.metricId, orderBook.target);

      const currentTime = await time.latest();
      const shortExpiryTime = currentTime + 10; // 10 seconds from now

      const shortExpiryOrder = {
        orderId: 0,
        trader: trader1.address,
        metricId: marketConfig.metricId,
        orderType: 1, // LIMIT
        side: 0, // BUY
        quantity: ethers.parseEther("10"),
        price: ethers.parseEther("8100000000"),
        filledQuantity: 0,
        timestamp: 0,
        expiryTime: shortExpiryTime,
        status: 0, // PENDING
        timeInForce: 3, // GTD
        stopPrice: 0,
        icebergQty: 0,
        postOnly: false,
        metadataHash: ethers.ZeroHash
      };

      // Place the order
      await orderRouter.connect(trader1).placeOrder(shortExpiryOrder);

      // Initially, order should not be eligible for expiration
      let eligibleOrders = await orderRouter.getOrdersEligibleForExpiration(trader1.address, 10);
      expect(eligibleOrders.length).to.equal(0);

      // Fast forward time past expiry
      await time.increase(15);

      // Now order should be eligible for expiration
      eligibleOrders = await orderRouter.getOrdersEligibleForExpiration(trader1.address, 10);
      expect(eligibleOrders.length).to.equal(1);
      expect(eligibleOrders[0].trader).to.equal(trader1.address);
      expect(eligibleOrders[0].expiryTime).to.equal(shortExpiryTime);
    });
  });

  describe("Order Expiration Execution", function () {
    it("Should expire individual orders", async function () {
      const { deployer, trader1, orderRouter, factory } = await loadFixture(deployOrderBookDEXFixture);
      const { orderBook, marketConfig } = await createTestMarket(factory, deployer);

      await orderRouter.registerMarket(marketConfig.metricId, orderBook.target);

      const currentTime = await time.latest();
      const expiryTime = currentTime + 5;

      const order = {
        orderId: 0,
        trader: trader1.address,
        metricId: marketConfig.metricId,
        orderType: 1, // LIMIT
        side: 0, // BUY
        quantity: ethers.parseEther("10"),
        price: ethers.parseEther("8100000000"),
        filledQuantity: 0,
        timestamp: 0,
        expiryTime: expiryTime,
        status: 0, // PENDING
        timeInForce: 3, // GTD
        stopPrice: 0,
        icebergQty: 0,
        postOnly: false,
        metadataHash: ethers.ZeroHash
      };

      // Place order
      const placeTx = await orderRouter.connect(trader1).placeOrder(order);
      const placeReceipt = await placeTx.wait();
      
      // Get order ID from event
      const orderPlacedEvent = placeReceipt.logs.find(
        (log: any) => log.topics[0] === orderRouter.interface.getEvent("OrderPlaced").topicHash
      );
      const decodedEvent = orderRouter.interface.parseLog(orderPlacedEvent);
      const orderId = decodedEvent.args.orderId;

      // Fast forward past expiry
      await time.increase(10);

      // Check that order is expired
      const isExpired = await orderRouter.isOrderExpired(orderId);
      expect(isExpired).to.be.true;

      // Expire the order
      const expireTx = await orderRouter.checkOrderExpiry(orderId);
      await expireTx.wait();

      // Verify order status changed to EXPIRED
      const orderDetails = await orderRouter.getOrder(orderId);
      expect(orderDetails.status).to.equal(4); // EXPIRED

      // Check that order is now in expired orders list
      const expiredOrders = await orderRouter.getUserExpiredOrders(trader1.address);
      expect(expiredOrders.length).to.equal(1);
      expect(expiredOrders[0].orderId).to.equal(orderId);
    });

    it("Should batch expire multiple orders", async function () {
      const { deployer, trader1, trader2, orderRouter, factory } = await loadFixture(deployOrderBookDEXFixture);
      const { orderBook, marketConfig } = await createTestMarket(factory, deployer);

      await orderRouter.registerMarket(marketConfig.metricId, orderBook.target);

      const currentTime = await time.latest();
      const expiryTime = currentTime + 5;
      const orderIds: bigint[] = [];

      // Place multiple orders with same expiry
      for (let i = 0; i < 3; i++) {
        const order = {
          orderId: 0,
          trader: i < 2 ? trader1.address : trader2.address,
          metricId: marketConfig.metricId,
          orderType: 1, // LIMIT
          side: 0, // BUY
          quantity: ethers.parseEther("10"),
          price: ethers.parseEther((8100000000 + i * 1000000).toString()),
          filledQuantity: 0,
          timestamp: 0,
          expiryTime: expiryTime,
          status: 0, // PENDING
          timeInForce: 3, // GTD
          stopPrice: 0,
          icebergQty: 0,
          postOnly: false,
          metadataHash: ethers.ZeroHash
        };

        const trader = i < 2 ? trader1 : trader2;
        const placeTx = await orderRouter.connect(trader).placeOrder(order);
        const placeReceipt = await placeTx.wait();
        
        const orderPlacedEvent = placeReceipt.logs.find(
          (log: any) => log.topics[0] === orderRouter.interface.getEvent("OrderPlaced").topicHash
        );
        const decodedEvent = orderRouter.interface.parseLog(orderPlacedEvent);
        orderIds.push(decodedEvent.args.orderId);
      }

      // Fast forward past expiry
      await time.increase(10);

      // Batch expire all orders
      const batchExpireTx = await orderRouter.batchExpireOrders(orderIds);
      const batchExpireReceipt = await batchExpireTx.wait();

      // Check for BatchOrdersExpired event
      const batchExpiredEvent = batchExpireReceipt.logs.find(
        (log: any) => log.topics[0] === orderRouter.interface.getEvent("BatchOrdersExpired").topicHash
      );
      expect(batchExpiredEvent).to.not.be.undefined;

      // Verify all orders are now expired
      for (const orderId of orderIds) {
        const orderDetails = await orderRouter.getOrder(orderId);
        expect(orderDetails.status).to.equal(4); // EXPIRED
      }

      // Check expired orders for each trader
      const trader1ExpiredOrders = await orderRouter.getUserExpiredOrders(trader1.address);
      const trader2ExpiredOrders = await orderRouter.getUserExpiredOrders(trader2.address);
      
      expect(trader1ExpiredOrders.length).to.equal(2);
      expect(trader2ExpiredOrders.length).to.equal(1);
    });

    it("Should cleanup user expired orders", async function () {
      const { deployer, trader1, orderRouter, factory } = await loadFixture(deployOrderBookDEXFixture);
      const { orderBook, marketConfig } = await createTestMarket(factory, deployer);

      await orderRouter.registerMarket(marketConfig.metricId, orderBook.target);

      const currentTime = await time.latest();
      const expiryTime = currentTime + 5;

      // Place multiple orders
      for (let i = 0; i < 2; i++) {
        const order = {
          orderId: 0,
          trader: trader1.address,
          metricId: marketConfig.metricId,
          orderType: 1, // LIMIT
          side: 0, // BUY
          quantity: ethers.parseEther("10"),
          price: ethers.parseEther((8100000000 + i * 1000000).toString()),
          filledQuantity: 0,
          timestamp: 0,
          expiryTime: expiryTime,
          status: 0, // PENDING
          timeInForce: 3, // GTD
          stopPrice: 0,
          icebergQty: 0,
          postOnly: false,
          metadataHash: ethers.ZeroHash
        };

        await orderRouter.connect(trader1).placeOrder(order);
      }

      // Fast forward past expiry
      await time.increase(10);

      // Cleanup user expired orders
      const cleanupTx = await orderRouter.cleanupUserExpiredOrders(trader1.address);
      const cleanupReceipt = await cleanupTx.wait();

      // Should have cleaned up 2 orders
      expect(cleanupReceipt.status).to.equal(1);

      // Verify orders are expired
      const expiredOrders = await orderRouter.getUserExpiredOrders(trader1.address);
      expect(expiredOrders.length).to.equal(2);
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("Should handle non-existent order IDs gracefully", async function () {
      const { orderRouter } = await loadFixture(deployOrderBookDEXFixture);

      await expect(
        orderRouter.checkOrderExpiry(999999)
      ).to.be.revertedWith("OrderRouter: Order not found");
    });

    it("Should not expire orders that are not GTD type", async function () {
      const { deployer, trader1, orderRouter, factory } = await loadFixture(deployOrderBookDEXFixture);
      const { orderBook, marketConfig } = await createTestMarket(factory, deployer);

      await orderRouter.registerMarket(marketConfig.metricId, orderBook.target);

      const gtcOrder = {
        orderId: 0,
        trader: trader1.address,
        metricId: marketConfig.metricId,
        orderType: 1, // LIMIT
        side: 0, // BUY
        quantity: ethers.parseEther("10"),
        price: ethers.parseEther("8100000000"),
        filledQuantity: 0,
        timestamp: 0,
        expiryTime: 0, // No expiry for GTC
        status: 0, // PENDING
        timeInForce: 0, // GTC
        stopPrice: 0,
        icebergQty: 0,
        postOnly: false,
        metadataHash: ethers.ZeroHash
      };

      const placeTx = await orderRouter.connect(trader1).placeOrder(gtcOrder);
      const placeReceipt = await placeTx.wait();
      
      const orderPlacedEvent = placeReceipt.logs.find(
        (log: any) => log.topics[0] === orderRouter.interface.getEvent("OrderPlaced").topicHash
      );
      const decodedEvent = orderRouter.interface.parseLog(orderPlacedEvent);
      const orderId = decodedEvent.args.orderId;

      // Try to expire GTC order (should not expire)
      const result = await orderRouter.checkOrderExpiry(orderId);
      // Result should be false (not expired)
      expect(result).to.be.false;
    });

    it("Should handle empty batch operations", async function () {
      const { orderRouter } = await loadFixture(deployOrderBookDEXFixture);

      await expect(
        orderRouter.batchExpireOrders([])
      ).to.be.revertedWith("OrderRouter: No orders provided");
    });

    it("Should limit batch size", async function () {
      const { orderRouter } = await loadFixture(deployOrderBookDEXFixture);

      // Create array with too many order IDs
      const tooManyOrderIds = Array.from({ length: 101 }, (_, i) => i + 1);

      await expect(
        orderRouter.batchExpireOrders(tooManyOrderIds)
      ).to.be.revertedWith("OrderRouter: Too many orders in batch");
    });
  });
});
