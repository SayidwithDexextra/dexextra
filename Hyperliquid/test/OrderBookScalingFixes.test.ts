import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";

describe("OrderBook Scaling Fixes", function () {
  let mockUSDC: Contract;
  let vaultRouter: Contract;
  let orderBook: Contract;
  let tradingRouter: Contract;
  let factory: Contract;
  let deployer: Signer;
  let user1: Signer;
  let user2: Signer;
  let deployerAddress: string;
  let user1Address: string;
  let user2Address: string;
  let marketId: string;

  beforeEach(async function () {
    [deployer, user1, user2] = await ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    user1Address = await user1.getAddress();
    user2Address = await user2.getAddress();

    // Deploy MockUSDC with 6 decimals (USDC standard)
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy(deployerAddress);
    await mockUSDC.waitForDeployment();

    // Deploy VaultRouter
    const VaultRouter = await ethers.getContractFactory("VaultRouter");
    vaultRouter = await VaultRouter.deploy(await mockUSDC.getAddress(), deployerAddress);
    await vaultRouter.waitForDeployment();

    // Deploy OrderBookFactoryMinimal
    const OrderBookFactoryMinimal = await ethers.getContractFactory("OrderBookFactoryMinimal");
    factory = await OrderBookFactoryMinimal.deploy(await vaultRouter.getAddress(), deployerAddress);
    await factory.waitForDeployment();

    // Deploy TradingRouter
    const TradingRouter = await ethers.getContractFactory("TradingRouter");
    tradingRouter = await TradingRouter.deploy(
      await vaultRouter.getAddress(),
      await factory.getAddress(),
      deployerAddress
    );
    await tradingRouter.waitForDeployment();

    // Create a market
    marketId = ethers.id("ETH_USD_TEST");
    await factory.createTraditionalMarket("ETH/USD", { value: ethers.parseEther("0.1") });
    
    // Get the OrderBook address from factory
    const marketInfo = await factory.getMarket(marketId);
    orderBook = await ethers.getContractAt("OrderBook", marketInfo.orderBookAddress);

    // Authorize market in VaultRouter
    await vaultRouter.setMarketAuthorization(marketId, true);

    // Grant ORDERBOOK_ROLE to OrderBook contract
    const ORDERBOOK_ROLE = await vaultRouter.ORDERBOOK_ROLE();
    await vaultRouter.grantRole(ORDERBOOK_ROLE, await orderBook.getAddress());

    // Mint tokens and setup approvals
    const depositAmount = ethers.parseUnits("10000", 6); // $10,000 USDC
    await mockUSDC.mint(user1Address, depositAmount);
    await mockUSDC.mint(user2Address, depositAmount);
    
    await mockUSDC.connect(user1).approve(await vaultRouter.getAddress(), depositAmount);
    await mockUSDC.connect(user2).approve(await vaultRouter.getAddress(), depositAmount);

    // Deposit collateral
    await vaultRouter.connect(user1).depositCollateral(depositAmount);
    await vaultRouter.connect(user2).depositCollateral(depositAmount);
  });

  describe("Precision and Scaling Fixes", function () {
    it("should use proper USDC 6-decimal precision constants", async function () {
      const PRICE_PRECISION = await orderBook.PRICE_PRECISION();
      const MARGIN_PERCENTAGE = await orderBook.MARGIN_PERCENTAGE();
      const MAX_REASONABLE_PRICE = await orderBook.MAX_REASONABLE_PRICE();
      const MIN_REASONABLE_PRICE = await orderBook.MIN_REASONABLE_PRICE();
      const MAX_ORDER_SIZE = await orderBook.MAX_ORDER_SIZE();

      expect(PRICE_PRECISION).to.equal(ethers.parseUnits("1", 6)); // 1e6
      expect(MARGIN_PERCENTAGE).to.equal(10);
      expect(MAX_REASONABLE_PRICE).to.equal(ethers.parseUnits("1000", 6)); // $1000
      expect(MIN_REASONABLE_PRICE).to.equal(ethers.parseUnits("0.01", 6)); // $0.01
      expect(MAX_ORDER_SIZE).to.equal(ethers.parseUnits("1000000", 6)); // 1M units
    });

    it("should work with user-friendly dollar amounts without scaling", async function () {
      // Test with $5.00 price and 100 units
      const price = ethers.parseUnits("5", 6); // $5.00
      const size = ethers.parseUnits("100", 6); // 100 units
      
      // Expected margin: 100 * 5 * 10% = $50
      const expectedMargin = ethers.parseUnits("50", 6);

      const tx = await orderBook.connect(user1).placeLimitOrder(
        0, // BUY
        size,
        price
      );

      await expect(tx).to.not.be.reverted;
      
      // Check that margin was calculated correctly
      const marginUsed = await vaultRouter.getTotalMarginReserved(user1Address);
      expect(marginUsed).to.be.closeTo(expectedMargin, ethers.parseUnits("1", 6)); // Within $1 tolerance
    });

    it("should reject orders with prices that are too high", async function () {
      const size = ethers.parseUnits("100", 6);
      const tooHighPrice = ethers.parseUnits("2000", 6); // $2000 > $1000 max

      await expect(
        orderBook.connect(user1).placeLimitOrder(0, size, tooHighPrice)
      ).to.be.revertedWith("OrderBook: price too high");
    });

    it("should reject orders with prices that are too low", async function () {
      const size = ethers.parseUnits("100", 6);
      const tooLowPrice = ethers.parseUnits("0.005", 6); // $0.005 < $0.01 min

      await expect(
        orderBook.connect(user1).placeLimitOrder(0, size, tooLowPrice)
      ).to.be.revertedWith("OrderBook: price too low");
    });

    it("should reject orders with size that is too large", async function () {
      const price = ethers.parseUnits("5", 6);
      const tooLargeSize = ethers.parseUnits("2000000", 6); // 2M > 1M max

      await expect(
        orderBook.connect(user1).placeLimitOrder(0, tooLargeSize, price)
      ).to.be.revertedWith("OrderBook: size too large");
    });
  });

  describe("Market Order Pricing Fixes", function () {
    it("should provide reasonable estimated execution prices for market orders", async function () {
      // First place a limit sell order to create liquidity
      const askPrice = ethers.parseUnits("100", 6); // $100
      const askSize = ethers.parseUnits("10", 6); // 10 units
      
      await orderBook.connect(user2).placeLimitOrder(
        1, // SELL
        askSize,
        askPrice
      );

      // Now place a market buy order
      const buySize = ethers.parseUnits("5", 6); // 5 units
      
      const tx = await orderBook.connect(user1).placeMarketOrder(
        0, // BUY
        buySize
      );

      await expect(tx).to.not.be.reverted;
    });

    it("should validate estimated prices are within bounds", async function () {
      // Set an extremely high market price to test bounds
      await orderBook.connect(deployer).updateMetricValue(ethers.parseUnits("50000", 6)); // $50,000
      
      const buySize = ethers.parseUnits("1", 6);
      
      // Should be rejected due to price being too high
      await expect(
        orderBook.connect(user1).placeMarketOrder(0, buySize)
      ).to.be.revertedWith("OrderBook: price too high");
    });
  });

  describe("Enhanced Error Messages", function () {
    it("should provide detailed error messages for insufficient collateral", async function () {
      // Try to place an order that requires more margin than available
      const price = ethers.parseUnits("100", 6); // $100
      const size = ethers.parseUnits("200000", 6); // 200,000 units
      // Required margin: 200,000 * 100 * 10% = $2,000,000 (more than $10,000 deposited)

      await expect(
        orderBook.connect(user1).placeLimitOrder(0, size, price)
      ).to.be.revertedWithCustomError(vaultRouter, "Error")
        .withArgs("VaultRouter: insufficient collateral for margin reservation");
    });

    it("should provide detailed error messages for withdrawal failures", async function () {
      // Place an order to lock some margin
      const price = ethers.parseUnits("100", 6);
      const size = ethers.parseUnits("50", 6);
      await orderBook.connect(user1).placeLimitOrder(0, size, price);

      // Try to withdraw more than available
      const withdrawAmount = ethers.parseUnits("9999", 6); // More than available after margin reservation

      await expect(
        vaultRouter.connect(user1).withdrawCollateral(withdrawAmount)
      ).to.be.revertedWith("VaultRouter: insufficient collateral for withdrawal");
    });
  });

  describe("TradingRouter Integration", function () {
    it("should successfully place limit orders through TradingRouter", async function () {
      const price = ethers.parseUnits("50", 6); // $50
      const size = ethers.parseUnits("20", 6); // 20 units

      const tx = await tradingRouter.connect(user1).placeLimitOrder(
        marketId,
        0, // BUY
        size,
        price
      );

      await expect(tx).to.not.be.reverted;
    });

    it("should successfully place market orders through TradingRouter", async function () {
      // First create some liquidity
      const askPrice = ethers.parseUnits("55", 6);
      const askSize = ethers.parseUnits("30", 6);
      await tradingRouter.connect(user2).placeLimitOrder(
        marketId,
        1, // SELL
        askSize,
        askPrice
      );

      // Now place a market buy order
      const buySize = ethers.parseUnits("10", 6);
      
      const tx = await tradingRouter.connect(user1).placeMarketOrder(
        marketId,
        0, // BUY
        buySize
      );

      await expect(tx).to.not.be.reverted;
    });
  });

  describe("Real-world Scenarios", function () {
    it("should handle normal trading scenario ($1-$1000 range)", async function () {
      // Scenario: User wants to buy 50 units at $25 each
      // Expected margin: 50 * 25 * 10% = $125
      const price = ethers.parseUnits("25", 6); // $25
      const size = ethers.parseUnits("50", 6); // 50 units
      
      const tx = await orderBook.connect(user1).placeLimitOrder(0, size, price);
      await expect(tx).to.not.be.reverted;

      // Verify reasonable margin calculation
      const marginReserved = await vaultRouter.getTotalMarginReserved(user1Address);
      const expectedMargin = ethers.parseUnits("125", 6); // $125
      expect(marginReserved).to.be.closeTo(expectedMargin, ethers.parseUnits("10", 6)); // Within $10 tolerance
    });

    it("should handle large orders (up to $1000)", async function () {
      // Scenario: User wants to buy 100 units at $100 each
      // Expected margin: 100 * 100 * 10% = $1000
      const price = ethers.parseUnits("100", 6); // $100
      const size = ethers.parseUnits("100", 6); // 100 units
      
      const tx = await orderBook.connect(user1).placeLimitOrder(0, size, price);
      await expect(tx).to.not.be.reverted;

      // Verify reasonable margin calculation
      const marginReserved = await vaultRouter.getTotalMarginReserved(user1Address);
      const expectedMargin = ethers.parseUnits("1000", 6); // $1000
      expect(marginReserved).to.be.closeTo(expectedMargin, ethers.parseUnits("50", 6)); // Within $50 tolerance
    });

    it("should prevent orders that would require excessive collateral", async function () {
      // Scenario: User tries to place order requiring more collateral than they have
      const price = ethers.parseUnits("500", 6); // $500
      const size = ethers.parseUnits("500", 6); // 500 units
      // Required margin: 500 * 500 * 10% = $25,000 (more than $10,000 available)
      
      await expect(
        orderBook.connect(user1).placeLimitOrder(0, size, price)
      ).to.be.reverted; // Should fail with detailed error message
    });
  });

  describe("Edge Cases and Validation", function () {
    it("should reject zero-sized orders", async function () {
      const price = ethers.parseUnits("50", 6);
      const zeroSize = 0;

      await expect(
        orderBook.connect(user1).placeLimitOrder(0, zeroSize, price)
      ).to.be.revertedWith("OrderBook: size must be positive");
    });

    it("should reject zero-priced limit orders", async function () {
      const size = ethers.parseUnits("10", 6);
      const zeroPrice = 0;

      await expect(
        orderBook.connect(user1).placeLimitOrder(0, size, zeroPrice)
      ).to.be.revertedWith("OrderBook: price too low");
    });

    it("should handle partial fills correctly", async function () {
      // Place a large sell order
      const sellPrice = ethers.parseUnits("60", 6);
      const sellSize = ethers.parseUnits("100", 6);
      await orderBook.connect(user2).placeLimitOrder(1, sellSize, sellPrice);

      // Place a smaller buy order that will partially fill
      const buyPrice = ethers.parseUnits("60", 6);
      const buySize = ethers.parseUnits("30", 6);
      const tx = await orderBook.connect(user1).placeLimitOrder(0, buySize, buyPrice);

      await expect(tx).to.not.be.reverted;
      
      // The orders should have matched
      // Verify positions were updated correctly
      const user1Positions = await vaultRouter.getUserPositions(user1Address);
      const user2Positions = await vaultRouter.getUserPositions(user2Address);
      
      expect(user1Positions.length).to.be.greaterThan(0);
      expect(user2Positions.length).to.be.greaterThan(0);
    });
  });
});

