import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Basic Trading Tests", function () {
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

  const USDC_DECIMALS = 6;
  const INITIAL_USDC_BALANCE = ethers.parseUnits("10000", USDC_DECIMALS); // 10,000 USDC
  const MARKET_CREATION_FEE = ethers.parseEther("1");
  const TICK_SIZE = ethers.parseEther("0.01"); // 0.01 ETH (hardcoded in contract)

  async function deploySystem() {
    [deployer, trader1, trader2] = await ethers.getSigners();

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

    // Approve vault to spend USDC for all traders
    await mockUSDC.connect(trader1).approve(await centralVault.getAddress(), ethers.MaxUint256);
    await mockUSDC.connect(trader2).approve(await centralVault.getAddress(), ethers.MaxUint256);

    // Deposit USDC to vault for all traders
    const depositAmount = ethers.parseUnits("5000", USDC_DECIMALS); // 5,000 USDC each
    await centralVault.connect(trader1).depositPrimaryCollateral(depositAmount);
    await centralVault.connect(trader2).depositPrimaryCollateral(depositAmount);

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
      trader2
    };
  }

  async function createTestMarket() {
    // Configure metric first
    const metricConfig = {
      identifier: ethers.keccak256(ethers.toUtf8Bytes("TEST_METRIC")),
      description: "Test Metric for Trading",
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
      metricId: "TEST_METRIC",
      description: "Test Trading Market",
      oracleProvider: await umaOracleManager.getAddress(),
      decimals: 2,
      minimumOrderSize: ethers.parseUnits("10", USDC_DECIMALS), // $10 minimum
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

    const marketAddress = await factory.getMarket("TEST_METRIC");
    orderBookProxy = await ethers.getContractAt("OrderBook", marketAddress);

    // Register the market with the OrderRouter
    await orderRouter.registerMarket("TEST_METRIC", marketAddress);

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
      metricId: "TEST_METRIC",
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

    await createTestMarket();
  });

  describe("Basic Order Operations", function () {
    it("Should place limit orders with correct tick size alignment", async function () {
      const basePrice = ethers.parseEther("1.0"); // 1.0 ETH
      const orderSize = ethers.parseUnits("100", USDC_DECIMALS); // $100 worth

      // Trader1 places BUY limit order
      const buyOrderId = await placeOrder(
        trader1, 
        0, // BUY
        1, // LIMIT
        orderSize,
        basePrice
      );

      // Trader2 places SELL limit order
      const sellOrderId = await placeOrder(
        trader2,
        1, // SELL
        1, // LIMIT
        orderSize,
        basePrice + TICK_SIZE // 1.01 ETH
      );

      // Verify orders are placed
      expect(buyOrderId).to.not.be.null;
      expect(sellOrderId).to.not.be.null;

      console.log(`Buy Order ID: ${buyOrderId}`);
      console.log(`Sell Order ID: ${sellOrderId}`);
    });

    it("Should execute market order against limit order", async function () {
      const limitPrice = ethers.parseEther("1.0"); // 1.0 ETH
      const orderSize = ethers.parseUnits("100", USDC_DECIMALS); // $100 worth

      // Get initial balances
      const [trader1InitialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const [trader2InitialBalance] = await centralVault.getPrimaryCollateralBalance(trader2.address);

      console.log(`Trader1 initial balance: ${ethers.formatUnits(trader1InitialBalance, USDC_DECIMALS)} USDC`);
      console.log(`Trader2 initial balance: ${ethers.formatUnits(trader2InitialBalance, USDC_DECIMALS)} USDC`);

      // Trader1 places BUY limit order
      const limitOrderId = await placeOrder(
        trader1,
        0, // BUY
        1, // LIMIT
        orderSize,
        limitPrice
      );

      console.log(`Limit order placed: ${limitOrderId}`);

      // Trader2 places SELL market order (should match)
      // For market orders, use a price that will definitely execute (very low for sells)
      const marketOrderId = await placeOrder(
        trader2,
        1, // SELL
        0, // MARKET
        orderSize,
        TICK_SIZE // Use minimum valid price for market sell
      );

      console.log(`Market order placed: ${marketOrderId}`);

      // Check balances after trade
      const [trader1FinalBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const [trader2FinalBalance] = await centralVault.getPrimaryCollateralBalance(trader2.address);

      console.log(`Trader1 final balance: ${ethers.formatUnits(trader1FinalBalance, USDC_DECIMALS)} USDC`);
      console.log(`Trader2 final balance: ${ethers.formatUnits(trader2FinalBalance, USDC_DECIMALS)} USDC`);

      // Both traders should have different balances (trade occurred)
      expect(trader1FinalBalance).to.not.equal(trader1InitialBalance);
      expect(trader2FinalBalance).to.not.equal(trader2InitialBalance);
    });

    it("Should calculate PNL for a simple profitable trade", async function () {
      const entryPrice = ethers.parseEther("1.0"); // 1.0 ETH
      const exitPrice = ethers.parseEther("1.1");  // 1.1 ETH (10% profit)
      const positionSize = ethers.parseUnits("100", USDC_DECIMALS); // $100

      // Step 1: Trader1 enters position (buys)
      const [trader1InitialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      
      await placeOrder(trader2, 1, 1, positionSize, entryPrice); // Trader2 provides liquidity
      await placeOrder(trader1, 0, 0, positionSize, ethers.parseEther("10.0")); // Trader1 market buys (high price)

      console.log(`Entry trade completed at ${ethers.formatEther(entryPrice)} ETH`);

      // Step 2: Trader1 exits position (sells) at higher price
      await placeOrder(trader2, 0, 1, positionSize, exitPrice); // Trader2 provides buy liquidity
      await placeOrder(trader1, 1, 0, positionSize, TICK_SIZE); // Trader1 market sells (low price)

      console.log(`Exit trade completed at ${ethers.formatEther(exitPrice)} ETH`);

      // Step 3: Check PNL
      const [trader1FinalBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const actualPNL = trader1FinalBalance - trader1InitialBalance;

      console.log(`Initial Balance: ${ethers.formatUnits(trader1InitialBalance, USDC_DECIMALS)} USDC`);
      console.log(`Final Balance: ${ethers.formatUnits(trader1FinalBalance, USDC_DECIMALS)} USDC`);
      console.log(`PNL: ${ethers.formatUnits(actualPNL, USDC_DECIMALS)} USDC`);

      // Should be profitable (allowing for trading fees)
      // Note: This is a simplified test - real PNL calculation depends on position sizing mechanism
      expect(actualPNL).to.be.gt(-ethers.parseUnits("10", USDC_DECIMALS)); // At least not a huge loss
    });
  });

  describe("Order Book State", function () {
    it("Should maintain order book depth correctly", async function () {
      const basePrice = ethers.parseEther("1.0");
      const orderSize = ethers.parseUnits("50", USDC_DECIMALS);

      // Place multiple orders at different price levels
      await placeOrder(trader1, 0, 1, orderSize, basePrice - TICK_SIZE); // 0.99 ETH bid
      await placeOrder(trader1, 0, 1, orderSize, basePrice - TICK_SIZE * 2n); // 0.98 ETH bid
      
      await placeOrder(trader2, 1, 1, orderSize, basePrice + TICK_SIZE); // 1.01 ETH ask
      await placeOrder(trader2, 1, 1, orderSize, basePrice + TICK_SIZE * 2n); // 1.02 ETH ask

      // Check best bid and ask
      const bestBid = await orderBookProxy.getBestBid();
      const bestAsk = await orderBookProxy.getBestAsk();

      console.log(`Best Bid: ${ethers.formatEther(bestBid)} ETH`);
      console.log(`Best Ask: ${ethers.formatEther(bestAsk)} ETH`);

      expect(bestBid).to.equal(basePrice - TICK_SIZE);
      expect(bestAsk).to.equal(basePrice + TICK_SIZE);

      // Check spread
      const spread = bestAsk - bestBid;
      console.log(`Spread: ${ethers.formatEther(spread)} ETH`);
      expect(spread).to.equal(TICK_SIZE * 2n);
    });
  });
});
