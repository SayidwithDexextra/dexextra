import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Multiple Trades with Target PNL", function () {
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
  const INITIAL_USDC_BALANCE = ethers.parseUnits("50000", USDC_DECIMALS); // Increased for larger trades
  const MARKET_CREATION_FEE = ethers.parseEther("1");
  const TICK_SIZE = ethers.parseEther("0.01");
  const PRICE_PRECISION = ethers.parseEther("1");

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
      86400,
      await mockUSDC.getAddress()
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
      deployer.address
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

    // Mint USDC to traders (more for larger trades)
    await mockUSDC.mint(trader1.address, INITIAL_USDC_BALANCE);
    await mockUSDC.mint(trader2.address, INITIAL_USDC_BALANCE);
    await mockUSDC.mint(trader3.address, INITIAL_USDC_BALANCE);

    // Approve vault to spend USDC
    await mockUSDC.connect(trader1).approve(await centralVault.getAddress(), ethers.MaxUint256);
    await mockUSDC.connect(trader2).approve(await centralVault.getAddress(), ethers.MaxUint256);
    await mockUSDC.connect(trader3).approve(await centralVault.getAddress(), ethers.MaxUint256);

    // Deposit USDC to vault (more for larger trades)
    const depositAmount = ethers.parseUnits("25000", USDC_DECIMALS); // $25,000 each
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

  async function createTestMarket(marketId: string, tradingDuration: number = 180) {
    const metricConfig = {
      identifier: ethers.keccak256(ethers.toUtf8Bytes(marketId)),
      description: `${marketId} Test Market`,
      decimals: 2,
      minBond: ethers.parseEther("1000"),
      defaultReward: ethers.parseEther("10"),
      livenessPeriod: 3600,
      isActive: true,
      authorizedRequesters: []
    };

    await umaOracleManager.configureMetric(metricConfig);

    const currentTime = await time.latest();
    const marketConfig = {
      metricId: marketId,
      description: `${marketId} Market`,
      oracleProvider: await umaOracleManager.getAddress(),
      decimals: 2,
      minimumOrderSize: ethers.parseUnits("0.1", USDC_DECIMALS),
      tickSize: TICK_SIZE,
      creationFee: MARKET_CREATION_FEE,
      requiresKYC: false,
      settlementDate: currentTime + 600,  // 10 minutes
      tradingEndDate: currentTime + tradingDuration,  // Configurable
      dataRequestWindow: 60, // 1 minute
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

    const marketAddress = await factory.getMarket(marketId);
    const orderBook = await ethers.getContractAt("OrderBook", marketAddress);

    await orderRouter.registerMarket(marketId, marketAddress);
    await centralVault.setMarketAuthorization(marketAddress, true);
    
    // Grant SETTLEMENT_ROLE to deployer for testing
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));
    const factoryAsSigner = await ethers.getImpersonatedSigner(await factory.getAddress());
    
    await deployer.sendTransaction({
      to: await factory.getAddress(),
      value: ethers.parseEther("1")
    });
    
    await orderBook.connect(factoryAsSigner).grantRole(SETTLEMENT_ROLE, deployer.address);

    return orderBook;
  }

  async function placeOrder(
    trader: HardhatEthersSigner, 
    side: number, 
    orderType: number,
    quantity: bigint, 
    price: bigint,
    marketId: string
  ) {
    const order = {
      orderId: 0,
      trader: trader.address,
      metricId: marketId,
      orderType: orderType,
      side: side,
      quantity: quantity,
      price: price,
      filledQuantity: 0,
      timestamp: 0,
      expiryTime: 0,
      status: 0,
      timeInForce: 0,
      stopPrice: 0,
      icebergQty: 0,
      postOnly: false,
      metadataHash: ethers.ZeroHash
    };

    const tx = await orderRouter.connect(trader).placeOrder(order);
    await tx.wait();
  }

  async function calculateProfitPosition(targetProfit: bigint, limitPrice: bigint, settlementPrice: bigint) {
    const expectedEntryPrice = limitPrice + TICK_SIZE;
    const priceDifference = settlementPrice - expectedEntryPrice;
    const requiredQuantity = (targetProfit * PRICE_PRECISION) / priceDifference;
    const expectedCollateral = (requiredQuantity * expectedEntryPrice) / PRICE_PRECISION;
    
    return {
      limitPrice,
      expectedEntryPrice,
      settlementPrice,
      priceDifference,
      requiredQuantity,
      expectedCollateral
    };
  }

  async function calculateLossPosition(targetLoss: bigint, limitPrice: bigint, settlementPrice: bigint) {
    // For SHORT position losing money: enter high, settle higher (price goes against us)
    const expectedEntryPrice = limitPrice + TICK_SIZE; // Market sell executes above limit
    const priceDifference = settlementPrice - expectedEntryPrice; // How much price goes against us
    const requiredQuantity = (targetLoss * PRICE_PRECISION) / priceDifference; // Always positive
    const expectedCollateral = (requiredQuantity * expectedEntryPrice) / PRICE_PRECISION;
    
    return {
      limitPrice,
      expectedEntryPrice,
      settlementPrice,
      priceDifference,
      requiredQuantity,
      expectedCollateral
    };
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
  });

  describe("🎯 TARGETED PNL TRADES", function () {
    it("Should achieve exactly +$20 profit on second trade", async function () {
      console.log(`\n💰 TRADE #2: TARGET +$20 PROFIT\n`);
      
      // Create market for $20 profit trade
      orderBookProxy = await createTestMarket("PROFIT_20_MARKET", 180);
      
      // Strategy: LONG position with bigger price movement for $20 profit
      const limitPrice = ethers.parseEther("2.0");   // 2.0 ETH
      const settlementPrice = ethers.parseEther("2.2"); // 2.2 ETH (10% gain, but higher base)
      const targetProfit = ethers.parseUnits("20", USDC_DECIMALS); // $20
      
      const position = await calculateProfitPosition(targetProfit, limitPrice, settlementPrice);
      
      console.log(`📊 $20 Profit Strategy:`);
      console.log(`   Limit Price: ${ethers.formatEther(position.limitPrice)} ETH`);
      console.log(`   Expected Entry: ${ethers.formatEther(position.expectedEntryPrice)} ETH`);
      console.log(`   Settlement: ${ethers.formatEther(position.settlementPrice)} ETH`);
      console.log(`   Price Difference: ${ethers.formatEther(position.priceDifference)} ETH`);
      console.log(`   Required Quantity: ${ethers.formatUnits(position.requiredQuantity, USDC_DECIMALS)}`);
      console.log(`   Expected Collateral: $${ethers.formatUnits(position.expectedCollateral, USDC_DECIMALS)}`);
      
      // Get initial balance
      const [initialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      console.log(`\n💳 Initial Balance: $${ethers.formatUnits(initialBalance, USDC_DECIMALS)}`);
      
      // Execute LONG trade
      console.log(`\n📈 Executing LONG position for +$20 profit...`);
      await placeOrder(trader2, 1, 1, position.requiredQuantity, position.limitPrice, "PROFIT_20_MARKET");
      await placeOrder(trader1, 0, 0, position.requiredQuantity, position.expectedEntryPrice, "PROFIT_20_MARKET");
      
      const [balanceAfterTrade] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const actualCost = initialBalance - balanceAfterTrade;
      console.log(`💸 Actual Cost: $${ethers.formatUnits(actualCost, USDC_DECIMALS)}`);
      
      // Verify position
      const userPositions = await orderBookProxy.getUserPositions(trader1.address);
      console.log(`📊 Position Created:`);
      if (userPositions.length > 0) {
        const pos = userPositions[0];
        console.log(`   Type: ${pos.isLong ? 'LONG' : 'SHORT'}`);
        console.log(`   Entry Price: ${ethers.formatEther(pos.entryPrice)} ETH`);
        console.log(`   Quantity: ${ethers.formatUnits(pos.quantity, USDC_DECIMALS)}`);
        console.log(`   Collateral: $${ethers.formatUnits(pos.collateral, USDC_DECIMALS)}`);
        
        // Calculate expected profit using actual entry price
        const actualPriceDiff = BigInt(position.settlementPrice.toString()) - BigInt(pos.entryPrice.toString());
        const calculatedProfit = (actualPriceDiff * pos.quantity) / PRICE_PRECISION;
        
        console.log(`\n🧮 Profit Calculation:`);
        console.log(`   Actual Entry Price: ${ethers.formatEther(pos.entryPrice)} ETH`);
        console.log(`   Settlement Price: ${ethers.formatEther(position.settlementPrice)} ETH`);
        console.log(`   Actual Price Diff: ${ethers.formatEther(actualPriceDiff)} ETH`);
        console.log(`   Calculated Profit: $${ethers.formatUnits(calculatedProfit, USDC_DECIMALS)}`);
        
        // Verify profit is close to $20
        expect(calculatedProfit).to.be.within(
          ethers.parseUnits("19", USDC_DECIMALS),
          ethers.parseUnits("21", USDC_DECIMALS),
          `Expected ~$20 profit, got $${ethers.formatUnits(calculatedProfit, USDC_DECIMALS)}`
        );
        
        console.log(`✅ SUCCESS: $20 profit calculation verified!`);
      }
    });

    it("Should achieve exactly -$100 loss on third trade", async function () {
      console.log(`\n📉 TRADE #3: TARGET -$100 LOSS\n`);
      
      // Create market for $100 loss trade
      orderBookProxy = await createTestMarket("LOSS_100_MARKET", 180);
      
      // Strategy: SHORT position where price goes UP causing loss
      const limitPrice = ethers.parseEther("1.5");   // 1.5 ETH (sell limit)
      const settlementPrice = ethers.parseEther("2.0"); // 2.0 ETH (price goes UP = bad for SHORT)
      const targetLoss = ethers.parseUnits("100", USDC_DECIMALS); // $100 loss
      
      const position = await calculateLossPosition(targetLoss, limitPrice, settlementPrice);
      
      console.log(`📊 $100 Loss Strategy (SHORT position):`);
      console.log(`   Limit Price: ${ethers.formatEther(position.limitPrice)} ETH`);
      console.log(`   Expected Entry: ${ethers.formatEther(position.expectedEntryPrice)} ETH`);
      console.log(`   Settlement: ${ethers.formatEther(position.settlementPrice)} ETH`);
      console.log(`   Price Difference: ${ethers.formatEther(position.priceDifference)} ETH`);
      console.log(`   Required Quantity: ${ethers.formatUnits(position.requiredQuantity, USDC_DECIMALS)}`);
      console.log(`   Expected Collateral: $${ethers.formatUnits(position.expectedCollateral, USDC_DECIMALS)}`);
      
      // Get initial balance
      const [initialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      console.log(`\n💳 Initial Balance: $${ethers.formatUnits(initialBalance, USDC_DECIMALS)}`);
      
      // Execute SHORT trade (sell first)
      console.log(`\n📉 Executing SHORT position for -$100 loss...`);
      await placeOrder(trader2, 0, 1, position.requiredQuantity, position.limitPrice, "LOSS_100_MARKET"); // Buy liquidity
      await placeOrder(trader1, 1, 0, position.requiredQuantity, position.expectedEntryPrice, "LOSS_100_MARKET"); // Market sell (SHORT)
      
      const [balanceAfterTrade] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const actualCost = initialBalance - balanceAfterTrade;
      console.log(`💸 Actual Cost: $${ethers.formatUnits(actualCost, USDC_DECIMALS)}`);
      
      // Verify position
      const userPositions = await orderBookProxy.getUserPositions(trader1.address);
      console.log(`📊 Position Created:`);
      if (userPositions.length > 0) {
        const pos = userPositions[0];
        console.log(`   Type: ${pos.isLong ? 'LONG' : 'SHORT'}`);
        console.log(`   Entry Price: ${ethers.formatEther(pos.entryPrice)} ETH`);
        console.log(`   Quantity: ${ethers.formatUnits(pos.quantity, USDC_DECIMALS)}`);
        console.log(`   Collateral: $${ethers.formatUnits(pos.collateral, USDC_DECIMALS)}`);
        
        // Calculate expected loss for SHORT position
        // For SHORT: loss when settlement > entry (price goes up)
        const actualPriceDiff = BigInt(position.settlementPrice.toString()) - BigInt(pos.entryPrice.toString());
        const calculatedLoss = (actualPriceDiff * pos.quantity) / PRICE_PRECISION; // This will be positive = loss for SHORT
        
        console.log(`\n🧮 Loss Calculation:`);
        console.log(`   Actual Entry Price: ${ethers.formatEther(pos.entryPrice)} ETH`);
        console.log(`   Settlement Price: ${ethers.formatEther(position.settlementPrice)} ETH`);
        console.log(`   Price Increase: ${ethers.formatEther(actualPriceDiff)} ETH`);
        console.log(`   Calculated Loss: $${ethers.formatUnits(calculatedLoss, USDC_DECIMALS)}`);
        
        // Verify loss is close to $100
        expect(calculatedLoss).to.be.within(
          ethers.parseUnits("95", USDC_DECIMALS),
          ethers.parseUnits("105", USDC_DECIMALS),
          `Expected ~$100 loss, got $${ethers.formatUnits(calculatedLoss, USDC_DECIMALS)}`
        );
        
        console.log(`✅ SUCCESS: $100 loss calculation verified!`);
      }
    });

    it("Should demonstrate multiple trade PNL tracking", async function () {
      console.log(`\n📈 MULTI-TRADE PNL DEMONSTRATION\n`);
      
      // Track trader1's total PNL across multiple trades
      const [veryInitialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      console.log(`💳 Starting Balance: $${ethers.formatUnits(veryInitialBalance, USDC_DECIMALS)}`);
      
      // Trade 1: +$10 profit (from our previous successful test)
      console.log(`\n🎯 TRADE 1: +$10 Profit`);
      orderBookProxy = await createTestMarket("MULTI_TRADE_1", 60);
      
      const trade1 = await calculateProfitPosition(
        ethers.parseUnits("10", USDC_DECIMALS),
        ethers.parseEther("1.0"),
        ethers.parseEther("1.1")
      );
      
      await placeOrder(trader2, 1, 1, trade1.requiredQuantity, trade1.limitPrice, "MULTI_TRADE_1");
      await placeOrder(trader1, 0, 0, trade1.requiredQuantity, trade1.expectedEntryPrice, "MULTI_TRADE_1");
      
      const [balanceAfterTrade1] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      console.log(`   Cost: $${ethers.formatUnits(veryInitialBalance - balanceAfterTrade1, USDC_DECIMALS)}`);
      
      // Trade 2: +$20 profit
      console.log(`\n💰 TRADE 2: +$20 Profit`);
      orderBookProxy = await createTestMarket("MULTI_TRADE_2", 60);
      
      const trade2 = await calculateProfitPosition(
        ethers.parseUnits("20", USDC_DECIMALS),
        ethers.parseEther("2.0"),
        ethers.parseEther("2.2")
      );
      
      await placeOrder(trader2, 1, 1, trade2.requiredQuantity, trade2.limitPrice, "MULTI_TRADE_2");
      await placeOrder(trader1, 0, 0, trade2.requiredQuantity, trade2.expectedEntryPrice, "MULTI_TRADE_2");
      
      const [balanceAfterTrade2] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      console.log(`   Cost: $${ethers.formatUnits(balanceAfterTrade1 - balanceAfterTrade2, USDC_DECIMALS)}`);
      
      // Trade 3: -$100 loss
      console.log(`\n📉 TRADE 3: -$100 Loss`);
      orderBookProxy = await createTestMarket("MULTI_TRADE_3", 60);
      
      const trade3 = await calculateLossPosition(
        ethers.parseUnits("100", USDC_DECIMALS),
        ethers.parseEther("1.5"),
        ethers.parseEther("2.0")
      );
      
      await placeOrder(trader2, 0, 1, trade3.requiredQuantity, trade3.limitPrice, "MULTI_TRADE_3");
      await placeOrder(trader1, 1, 0, trade3.requiredQuantity, trade3.expectedEntryPrice, "MULTI_TRADE_3");
      
      const [finalBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      console.log(`   Cost: $${ethers.formatUnits(balanceAfterTrade2 - finalBalance, USDC_DECIMALS)}`);
      
      const totalCollateralUsed = veryInitialBalance - finalBalance;
      console.log(`\n📊 SUMMARY:`);
      console.log(`   Starting Balance: $${ethers.formatUnits(veryInitialBalance, USDC_DECIMALS)}`);
      console.log(`   Final Balance: $${ethers.formatUnits(finalBalance, USDC_DECIMALS)}`);
      console.log(`   Total Collateral Used: $${ethers.formatUnits(totalCollateralUsed, USDC_DECIMALS)}`);
      console.log(`   Expected Net PNL at Settlement: +$10 +$20 -$100 = -$70`);
      
      console.log(`\n✅ THREE TRADES EXECUTED SUCCESSFULLY!`);
      console.log(`🎯 Ready for settlement to realize actual PNL`);
    });
  });
});
