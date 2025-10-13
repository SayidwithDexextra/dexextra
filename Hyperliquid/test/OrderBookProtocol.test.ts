import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";

describe("Hyperliquid OrderBook Protocol", function () {
  let mockUSDC: Contract;
  let vaultRouter: Contract;
  let factory: Contract;
  let ethOrderBook: Contract;
  let deployer: Signer;
  let user1: Signer;
  let user2: Signer;
  let deployerAddress: string;
  let user1Address: string;
  let user2Address: string;

  beforeEach(async function () {
    [deployer, user1, user2] = await ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    user1Address = await user1.getAddress();
    user2Address = await user2.getAddress();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy(deployerAddress);
    await mockUSDC.waitForDeployment();

    // Deploy VaultRouter
    const VaultRouter = await ethers.getContractFactory("VaultRouter");
    vaultRouter = await VaultRouter.deploy(await mockUSDC.getAddress(), deployerAddress);
    await vaultRouter.waitForDeployment();

    // Deploy Factory
    const OrderBookFactory = await ethers.getContractFactory("OrderBookFactory");
    factory = await OrderBookFactory.deploy(await vaultRouter.getAddress(), deployerAddress);
    await factory.waitForDeployment();

    // Grant roles
    const MARKET_CREATOR_ROLE = await factory.MARKET_CREATOR_ROLE();
    await factory.grantRole(MARKET_CREATOR_ROLE, deployerAddress);

    // Create ETH/USD market
    const marketCreationFee = await factory.marketCreationFee();
    const tx = await factory.createTraditionalMarket("ETH/USD", {
      value: marketCreationFee
    });
    const receipt = await tx.wait();
    
    // Get the OrderBook address from the event
    const marketCreatedEvent = receipt?.logs.find(
      (log: any) => log.fragment && log.fragment.name === 'MarketCreated'
    );
    const orderBookAddress = marketCreatedEvent?.args[1];
    
    ethOrderBook = await ethers.getContractAt("OrderBook", orderBookAddress);

    // Mint USDC to users
    const mintAmount = ethers.parseUnits("10000", 6);
    await mockUSDC.mint(user1Address, mintAmount);
    await mockUSDC.mint(user2Address, mintAmount);
  });

  describe("Deployment", function () {
    it("Should deploy all contracts successfully", async function () {
      expect(await mockUSDC.getAddress()).to.be.properAddress;
      expect(await vaultRouter.getAddress()).to.be.properAddress;
      expect(await factory.getAddress()).to.be.properAddress;
      expect(await ethOrderBook.getAddress()).to.be.properAddress;
    });

    it("Should set correct initial parameters", async function () {
      expect(await mockUSDC.name()).to.equal("Mock USDC");
      expect(await mockUSDC.symbol()).to.equal("mUSDC");
      expect(await mockUSDC.decimals()).to.equal(6);
    });
  });

  describe("VaultRouter", function () {
    it("Should allow collateral deposits", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      
      await mockUSDC.connect(user1).approve(await vaultRouter.getAddress(), depositAmount);
      await vaultRouter.connect(user1).depositCollateral(depositAmount);
      
      expect(await vaultRouter.userCollateral(user1Address)).to.equal(depositAmount);
    });

    it("Should calculate portfolio value correctly", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      
      await mockUSDC.connect(user1).approve(await vaultRouter.getAddress(), depositAmount);
      await vaultRouter.connect(user1).depositCollateral(depositAmount);
      
      const portfolioValue = await vaultRouter.getPortfolioValue(user1Address);
      expect(portfolioValue).to.equal(depositAmount);
    });

    it("Should return correct margin summary", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      
      await mockUSDC.connect(user1).approve(await vaultRouter.getAddress(), depositAmount);
      await vaultRouter.connect(user1).depositCollateral(depositAmount);
      
      const summary = await vaultRouter.getMarginSummary(user1Address);
      expect(summary.totalCollateral).to.equal(depositAmount);
      expect(summary.availableCollateral).to.equal(depositAmount);
      expect(summary.marginUsed).to.equal(0);
      expect(summary.marginReserved).to.equal(0);
    });
  });

  describe("OrderBook Factory", function () {
    it("Should create traditional markets", async function () {
      const marketCreationFee = await factory.marketCreationFee();
      
      const tx = await factory.createTraditionalMarket("BTC/USD", {
        value: marketCreationFee
      });
      
      await expect(tx).to.emit(factory, "MarketCreated");
      
      const btcMarketId = await factory.getMarketBySymbol("BTC/USD");
      expect(btcMarketId).to.not.equal(ethers.ZeroHash);
    });

    it("Should create custom metric markets", async function () {
      const marketCreationFee = await factory.marketCreationFee();
      
      const tx = await factory.createCustomMetricMarket("WORLD_POP", "world_population", {
        value: marketCreationFee
      });
      
      await expect(tx).to.emit(factory, "MarketCreated");
      
      const worldPopMarketId = await factory.getMarketByMetric("world_population");
      expect(worldPopMarketId).to.not.equal(ethers.ZeroHash);
    });

    it("Should track all markets correctly", async function () {
      const allMarkets = await factory.getAllMarkets();
      expect(allMarkets.length).to.equal(1); // ETH/USD created in beforeEach
      
      const traditionalMarkets = await factory.getTraditionalMarkets();
      expect(traditionalMarkets.length).to.equal(1);
      
      const customMarkets = await factory.getCustomMetricMarkets();
      expect(customMarkets.length).to.equal(0);
    });
  });

  describe("OrderBook Trading", function () {
    beforeEach(async function () {
      // Setup users with collateral
      const depositAmount = ethers.parseUnits("5000", 6);
      
      await mockUSDC.connect(user1).approve(await vaultRouter.getAddress(), depositAmount);
      await vaultRouter.connect(user1).depositCollateral(depositAmount);
      
      await mockUSDC.connect(user2).approve(await vaultRouter.getAddress(), depositAmount);
      await vaultRouter.connect(user2).depositCollateral(depositAmount);
    });

    it("Should place limit orders", async function () {
      const tx = await ethOrderBook.connect(user1).placeLimitOrder(
        0, // BUY
        ethers.parseUnits("1", 0), // 1 ETH
        ethers.parseUnits("2000", 0) // $2000
      );
      
      await expect(tx).to.emit(ethOrderBook, "OrderPlaced");
    });

    it("Should place market orders", async function () {
      // First place a limit order to provide liquidity
      await ethOrderBook.connect(user1).placeLimitOrder(
        1, // SELL
        ethers.parseUnits("1", 0), // 1 ETH
        ethers.parseUnits("2000", 0) // $2000
      );
      
      // Then place a market order to match against it
      const tx = await ethOrderBook.connect(user2).placeMarketOrder(
        0, // BUY
        ethers.parseUnits("0.5", 0) // 0.5 ETH
      );
      
      await expect(tx).to.emit(ethOrderBook, "OrderPlaced");
    });

    it("Should match orders and execute trades", async function () {
      // User1 places sell order
      await ethOrderBook.connect(user1).placeLimitOrder(
        1, // SELL
        ethers.parseUnits("1", 0), // 1 ETH
        ethers.parseUnits("2000", 0) // $2000
      );
      
      // User2 places matching buy order
      const tx = await ethOrderBook.connect(user2).placeLimitOrder(
        0, // BUY
        ethers.parseUnits("1", 0), // 1 ETH
        ethers.parseUnits("2000", 0) // $2000
      );
      
      await expect(tx).to.emit(ethOrderBook, "TradeExecuted");
    });

    it("Should update positions after trades", async function () {
      // User1 sells, User2 buys
      await ethOrderBook.connect(user1).placeLimitOrder(
        1, // SELL
        ethers.parseUnits("1", 0), // 1 ETH
        ethers.parseUnits("2000", 0) // $2000
      );
      
      await ethOrderBook.connect(user2).placeLimitOrder(
        0, // BUY
        ethers.parseUnits("1", 0), // 1 ETH
        ethers.parseUnits("2000", 0) // $2000
      );
      
      // Check positions
      const user1Positions = await vaultRouter.getUserPositions(user1Address);
      const user2Positions = await vaultRouter.getUserPositions(user2Address);
      
      expect(user1Positions.length).to.be.greaterThan(0);
      expect(user2Positions.length).to.be.greaterThan(0);
    });
  });

  describe("Portfolio Management", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseUnits("5000", 6);
      await mockUSDC.connect(user1).approve(await vaultRouter.getAddress(), depositAmount);
      await vaultRouter.connect(user1).depositCollateral(depositAmount);
    });

    it("Should track available collateral correctly", async function () {
      const initialAvailable = await vaultRouter.getAvailableCollateral(user1Address);
      
      // Place an order (reserves margin)
      await ethOrderBook.connect(user1).placeLimitOrder(
        0, // BUY
        ethers.parseUnits("1", 0), // 1 ETH
        ethers.parseUnits("2000", 0) // $2000
      );
      
      const afterOrderAvailable = await vaultRouter.getAvailableCollateral(user1Address);
      expect(afterOrderAvailable).to.be.lessThan(initialAvailable);
    });

    it("Should allow collateral withdrawal", async function () {
      const withdrawAmount = ethers.parseUnits("1000", 6);
      const initialBalance = await mockUSDC.balanceOf(user1Address);
      
      await vaultRouter.connect(user1).withdrawCollateral(withdrawAmount);
      
      const finalBalance = await mockUSDC.balanceOf(user1Address);
      expect(finalBalance).to.equal(initialBalance + withdrawAmount);
    });
  });
});

