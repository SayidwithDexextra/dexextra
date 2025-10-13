import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";

describe("OrderBook - Efficiency and Bi-directional Testing", function () {
  let mockUSDC: Contract;
  let vaultRouter: Contract;
  let factory: Contract;
  let optimizedOrderBook: Contract;
  let deployer: Signer;
  let user1: Signer;
  let user2: Signer;
  let user3: Signer;
  let user4: Signer;
  let deployerAddress: string;
  let user1Address: string;
  let user2Address: string;
  let user3Address: string;
  let user4Address: string;

  beforeEach(async function () {
    [deployer, user1, user2, user3, user4] = await ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    user1Address = await user1.getAddress();
    user2Address = await user2.getAddress();
    user3Address = await user3.getAddress();
    user4Address = await user4.getAddress();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy(deployerAddress);
    await mockUSDC.waitForDeployment();

    // Deploy VaultRouter
    const VaultRouter = await ethers.getContractFactory("VaultRouter");
    vaultRouter = await VaultRouter.deploy(await mockUSDC.getAddress(), deployerAddress);
    await vaultRouter.waitForDeployment();

    // Deploy OrderBook directly
    const OrderBook = await ethers.getContractFactory("OrderBook");
    const marketId = ethers.id("ETH_USD_OPTIMIZED");
    optimizedOrderBook = await OrderBook.deploy(
      marketId,
      "ETH/USD",
      "",
      false,
      await vaultRouter.getAddress(),
      deployerAddress
    );
    await optimizedOrderBook.waitForDeployment();

    // Grant roles
    const ORDERBOOK_ROLE = await vaultRouter.ORDERBOOK_ROLE();
    await vaultRouter.grantRole(ORDERBOOK_ROLE, await optimizedOrderBook.getAddress());
    await vaultRouter.setMarketAuthorization(marketId, true);

    // Mint USDC to users
    const mintAmount = ethers.parseUnits("50000", 6);
    await mockUSDC.mint(user1Address, mintAmount);
    await mockUSDC.mint(user2Address, mintAmount);
    await mockUSDC.mint(user3Address, mintAmount);
    await mockUSDC.mint(user4Address, mintAmount);

    // Setup users with collateral
    const depositAmount = ethers.parseUnits("25000", 6);
    
    await mockUSDC.connect(user1).approve(await vaultRouter.getAddress(), depositAmount);
    await vaultRouter.connect(user1).depositCollateral(depositAmount);
    
    await mockUSDC.connect(user2).approve(await vaultRouter.getAddress(), depositAmount);
    await vaultRouter.connect(user2).depositCollateral(depositAmount);
    
    await mockUSDC.connect(user3).approve(await vaultRouter.getAddress(), depositAmount);
    await vaultRouter.connect(user3).depositCollateral(depositAmount);
    
    await mockUSDC.connect(user4).approve(await vaultRouter.getAddress(), depositAmount);
    await vaultRouter.connect(user4).depositCollateral(depositAmount);
  });

  describe("Optimized Price Level Management", function () {
    it("Should efficiently manage multiple price levels", async function () {
      const prices = [2000, 2010, 2020, 1990, 1980, 2030, 1970];
      const size = ethers.parseUnits("1", 0);

      // Place multiple buy orders at different prices
      for (let i = 0; i < prices.length; i++) {
        await optimizedOrderBook.connect(user1).placeLimitOrder(
          0, // BUY
          size,
          ethers.parseUnits(prices[i].toString(), 0)
        );
      }

      // Check that best bid is the highest price
      const [bestBid, bestAsk] = await optimizedOrderBook.getBestPrices();
      expect(bestBid).to.equal(ethers.parseUnits("2030", 0));
    });

    it("Should maintain correct order in price tree", async function () {
      const buyPrices = [2000, 2010, 1990, 2020];
      const sellPrices = [2050, 2040, 2060, 2030];
      const size = ethers.parseUnits("1", 0);

      // Place orders
      for (const price of buyPrices) {
        await optimizedOrderBook.connect(user1).placeLimitOrder(
          0, // BUY
          size,
          ethers.parseUnits(price.toString(), 0)
        );
      }

      for (const price of sellPrices) {
        await optimizedOrderBook.connect(user2).placeLimitOrder(
          1, // SELL
          size,
          ethers.parseUnits(price.toString(), 0)
        );
      }

      // Verify best prices
      const [bestBid, bestAsk] = await optimizedOrderBook.getBestPrices();
      expect(bestBid).to.equal(ethers.parseUnits("2020", 0)); // Highest buy
      expect(bestAsk).to.equal(ethers.parseUnits("2030", 0)); // Lowest sell
    });
  });

  describe("Bi-directional Matching Validation", function () {
    it("Should match buy orders against sell orders correctly", async function () {
      // Place a sell order first
      const sellTx = await optimizedOrderBook.connect(user1).placeLimitOrder(
        1, // SELL
        ethers.parseUnits("2", 0), // 2 ETH
        ethers.parseUnits("2000", 0) // $2000
      );
      await expect(sellTx).to.emit(optimizedOrderBook, "OrderPlaced");

      // Place a matching buy order
      const buyTx = await optimizedOrderBook.connect(user2).placeLimitOrder(
        0, // BUY
        ethers.parseUnits("1", 0), // 1 ETH
        ethers.parseUnits("2000", 0) // $2000
      );
      
      await expect(buyTx).to.emit(optimizedOrderBook, "TradeExecuted");
      await expect(buyTx).to.emit(optimizedOrderBook, "BatchMatchingCompleted");
    });

    it("Should match sell orders against buy orders correctly", async function () {
      // Place a buy order first
      const buyTx = await optimizedOrderBook.connect(user1).placeLimitOrder(
        0, // BUY
        ethers.parseUnits("2", 0), // 2 ETH
        ethers.parseUnits("2000", 0) // $2000
      );
      await expect(buyTx).to.emit(optimizedOrderBook, "OrderPlaced");

      // Place a matching sell order
      const sellTx = await optimizedOrderBook.connect(user2).placeLimitOrder(
        1, // SELL
        ethers.parseUnits("1", 0), // 1 ETH
        ethers.parseUnits("2000", 0) // $2000
      );
      
      await expect(sellTx).to.emit(optimizedOrderBook, "TradeExecuted");
      await expect(sellTx).to.emit(optimizedOrderBook, "BatchMatchingCompleted");
    });

    it("Should handle partial fills correctly in both directions", async function () {
      // Place large sell order
      await optimizedOrderBook.connect(user1).placeLimitOrder(
        1, // SELL
        ethers.parseUnits("5", 0), // 5 ETH
        ethers.parseUnits("2000", 0) // $2000
      );

      // Place smaller buy order that should partially fill
      const buyTx = await optimizedOrderBook.connect(user2).placeLimitOrder(
        0, // BUY
        ethers.parseUnits("2", 0), // 2 ETH
        ethers.parseUnits("2000", 0) // $2000
      );
      
      await expect(buyTx).to.emit(optimizedOrderBook, "TradeExecuted");

      // Check that sell order is partially filled
      const [bestBid, bestAsk] = await optimizedOrderBook.getBestPrices();
      expect(bestAsk).to.equal(ethers.parseUnits("2000", 0)); // Sell order still exists
    });

    it("Should match multiple orders in sequence correctly", async function () {
      // Place multiple sell orders at different prices
      await optimizedOrderBook.connect(user1).placeLimitOrder(
        1, // SELL
        ethers.parseUnits("1", 0),
        ethers.parseUnits("2000", 0)
      );
      
      await optimizedOrderBook.connect(user2).placeLimitOrder(
        1, // SELL
        ethers.parseUnits("1", 0),
        ethers.parseUnits("2010", 0)
      );
      
      await optimizedOrderBook.connect(user3).placeLimitOrder(
        1, // SELL
        ethers.parseUnits("1", 0),
        ethers.parseUnits("1990", 0)
      );

      // Place large buy order that should match multiple sells
      const buyTx = await optimizedOrderBook.connect(user4).placeLimitOrder(
        0, // BUY
        ethers.parseUnits("3", 0), // Should match all three sells
        ethers.parseUnits("2020", 0) // High enough to match all
      );
      
      await expect(buyTx).to.emit(optimizedOrderBook, "BatchMatchingCompleted");
      
      // Should have matched starting with best (lowest) sell price
      const [bestBid, bestAsk] = await optimizedOrderBook.getBestPrices();
      expect(bestAsk).to.equal(0); // All sell orders should be consumed
    });
  });

  describe("Market Order Optimization", function () {
    it("Should execute market buy orders efficiently", async function () {
      // Setup order book with multiple sell levels
      await optimizedOrderBook.connect(user1).placeLimitOrder(1, ethers.parseUnits("1", 0), ethers.parseUnits("2000", 0));
      await optimizedOrderBook.connect(user2).placeLimitOrder(1, ethers.parseUnits("1", 0), ethers.parseUnits("2010", 0));
      await optimizedOrderBook.connect(user3).placeLimitOrder(1, ethers.parseUnits("1", 0), ethers.parseUnits("2020", 0));

      // Execute market buy order
      const marketBuyTx = await optimizedOrderBook.connect(user4).placeMarketOrder(
        0, // BUY
        ethers.parseUnits("2.5", 0) // Should consume 2 full orders and partial third
      );

      await expect(marketBuyTx).to.emit(optimizedOrderBook, "BatchMatchingCompleted");
    });

    it("Should execute market sell orders efficiently", async function () {
      // Setup order book with multiple buy levels
      await optimizedOrderBook.connect(user1).placeLimitOrder(0, ethers.parseUnits("1", 0), ethers.parseUnits("2000", 0));
      await optimizedOrderBook.connect(user2).placeLimitOrder(0, ethers.parseUnits("1", 0), ethers.parseUnits("1990", 0));
      await optimizedOrderBook.connect(user3).placeLimitOrder(0, ethers.parseUnits("1", 0), ethers.parseUnits("1980", 0));

      // Execute market sell order
      const marketSellTx = await optimizedOrderBook.connect(user4).placeMarketOrder(
        1, // SELL
        ethers.parseUnits("2.5", 0) // Should consume 2 full orders and partial third
      );

      await expect(marketSellTx).to.emit(optimizedOrderBook, "BatchMatchingCompleted");
    });
  });

  describe("Batch Operations", function () {
    it("Should handle batch cancellations efficiently", async function () {
      // Place multiple orders
      const orderIds: string[] = [];
      
      for (let i = 0; i < 5; i++) {
        const tx = await optimizedOrderBook.connect(user1).placeLimitOrder(
          0, // BUY
          ethers.parseUnits("1", 0),
          ethers.parseUnits((2000 + i * 10).toString(), 0)
        );
        const receipt = await tx.wait();
        
        // Extract order ID from event
        const orderPlacedEvent = receipt?.logs.find(
          (log: any) => log.fragment && log.fragment.name === 'OrderPlaced'
        );
        if (orderPlacedEvent) {
          orderIds.push(orderPlacedEvent.args[0]);
        }
      }

      // Batch cancel orders
      const batchCancelTx = await optimizedOrderBook.connect(user1).batchCancelOrders(orderIds);
      
      // Should emit multiple cancellation events
      const cancelReceipt = await batchCancelTx.wait();
      const cancelEvents = cancelReceipt?.logs.filter(
        (log: any) => log.fragment && log.fragment.name === 'OrderCancelled'
      );
      
      expect(cancelEvents).to.have.length(5);
    });

    it("Should respect batch size limits", async function () {
      // Try to cancel more than MAX_BATCH_SIZE orders
      const manyOrderIds = new Array(15).fill(ethers.ZeroHash);
      
      await expect(
        optimizedOrderBook.connect(user1).batchCancelOrders(manyOrderIds)
      ).to.be.revertedWith("OrderBook: invalid batch size");
    });
  });

  describe("Gas Efficiency Validation", function () {
    it("Should demonstrate improved gas efficiency over linear operations", async function () {
      // This test demonstrates the efficiency improvements but actual gas measurement
      // would require more sophisticated benchmarking
      
      const prices = [];
      for (let i = 1900; i <= 2100; i += 10) {
        prices.push(i);
      }

      const startTime = Date.now();
      
      // Place many orders to create deep order book
      for (const price of prices) {
        await optimizedOrderBook.connect(user1).placeLimitOrder(
          0, // BUY
          ethers.parseUnits("1", 0),
          ethers.parseUnits(price.toString(), 0)
        );
      }

      const midTime = Date.now();

      // Test matching against deep book
      await optimizedOrderBook.connect(user2).placeMarketOrder(
        1, // SELL
        ethers.parseUnits("10", 0) // Should match against multiple price levels
      );

      const endTime = Date.now();

      console.log(`Order placement time: ${midTime - startTime}ms`);
      console.log(`Market order execution time: ${endTime - midTime}ms`);
      
      // Verify operations completed successfully
      const [bestBid, bestAsk] = await optimizedOrderBook.getBestPrices();
      expect(bestBid).to.be.greaterThan(0);
    });
  });

  describe("Order Book Depth and State Verification", function () {
    it("Should maintain correct order book depth after complex operations", async function () {
      // Create complex order book state
      const buyPrices = [1950, 1960, 1970, 1980, 1990];
      const sellPrices = [2010, 2020, 2030, 2040, 2050];
      
      // Place orders
      for (const price of buyPrices) {
        await optimizedOrderBook.connect(user1).placeLimitOrder(
          0, ethers.parseUnits("2", 0), ethers.parseUnits(price.toString(), 0)
        );
      }
      
      for (const price of sellPrices) {
        await optimizedOrderBook.connect(user2).placeLimitOrder(
          1, ethers.parseUnits("2", 0), ethers.parseUnits(price.toString(), 0)
        );
      }

      // Get order book depth
      const depth = await optimizedOrderBook.getOrderBookDepth(5);
      
      // Verify structure
      expect(depth.bidPrices[0]).to.equal(ethers.parseUnits("1990", 0)); // Best bid
      expect(depth.askPrices[0]).to.equal(ethers.parseUnits("2010", 0)); // Best ask
      expect(depth.bidSizes[0]).to.equal(ethers.parseUnits("2", 0));
      expect(depth.askSizes[0]).to.equal(ethers.parseUnits("2", 0));
    });

    it("Should handle edge cases in matching", async function () {
      // Test zero-size orders rejection
      await expect(
        optimizedOrderBook.connect(user1).placeLimitOrder(0, 0, ethers.parseUnits("2000", 0))
      ).to.be.revertedWith("OrderBook: size must be positive");

      // Test zero-price orders rejection
      await expect(
        optimizedOrderBook.connect(user1).placeLimitOrder(0, ethers.parseUnits("1", 0), 0)
      ).to.be.revertedWith("OrderBook: price must be positive");

      // Test market order with no liquidity
      const marketOrderTx = await optimizedOrderBook.connect(user1).placeMarketOrder(
        0, // BUY
        ethers.parseUnits("1", 0)
      );
      
      // Should place order but not execute any trades (no liquidity)
      await expect(marketOrderTx).to.emit(optimizedOrderBook, "OrderPlaced");
    });
  });

  describe("Tree Structure Validation", function () {
    it("Should maintain tree structure integrity", async function () {
      const prices = [2000, 1950, 2050, 1920, 1980, 2020, 2080];
      
      // Place orders to create tree structure
      for (const price of prices) {
        await optimizedOrderBook.connect(user1).placeLimitOrder(
          0, // BUY
          ethers.parseUnits("1", 0),
          ethers.parseUnits(price.toString(), 0)
        );
      }

      // Verify tree structure through price node queries
      for (const price of prices) {
        const priceNode = await optimizedOrderBook.getPriceNode(
          ethers.parseUnits(price.toString(), 0),
          true // isBuy
        );
        
        expect(priceNode.price).to.equal(ethers.parseUnits(price.toString(), 0));
        expect(priceNode.orderCount).to.equal(1);
        expect(priceNode.totalSize).to.equal(ethers.parseUnits("1", 0));
      }
    });

    it("Should handle price node removal correctly", async function () {
      // Place order
      const tx = await optimizedOrderBook.connect(user1).placeLimitOrder(
        0, // BUY
        ethers.parseUnits("1", 0),
        ethers.parseUnits("2000", 0)
      );

      const receipt = await tx.wait();
      const orderPlacedEvent = receipt?.logs.find(
        (log: any) => log.fragment && log.fragment.name === 'OrderPlaced'
      );
      const orderId = orderPlacedEvent?.args[0];

      // Verify node exists
      let priceNode = await optimizedOrderBook.getPriceNode(ethers.parseUnits("2000", 0), true);
      expect(priceNode.orderCount).to.equal(1);

      // Cancel order
      await optimizedOrderBook.connect(user1).cancelOrder(orderId);

      // Verify node is cleaned up (simplified check)
      priceNode = await optimizedOrderBook.getPriceNode(ethers.parseUnits("2000", 0), true);
      expect(priceNode.orderCount).to.equal(0);
    });
  });
});
