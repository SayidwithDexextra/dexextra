import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Settlement-Based $10 Profit Test", function () {
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
  const INITIAL_USDC_BALANCE = ethers.parseUnits("10000", USDC_DECIMALS);
  const MARKET_CREATION_FEE = ethers.parseEther("1");
  const TICK_SIZE = ethers.parseEther("0.01");

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

    // Mint USDC to traders
    await mockUSDC.mint(trader1.address, INITIAL_USDC_BALANCE);
    await mockUSDC.mint(trader2.address, INITIAL_USDC_BALANCE);

    // Approve vault to spend USDC
    await mockUSDC.connect(trader1).approve(await centralVault.getAddress(), ethers.MaxUint256);
    await mockUSDC.connect(trader2).approve(await centralVault.getAddress(), ethers.MaxUint256);

    // Deposit USDC to vault
    const depositAmount = ethers.parseUnits("5000", USDC_DECIMALS);
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
    const metricConfig = {
      identifier: ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_METRIC")),
      description: "Settlement-based Metric",
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
      metricId: "SETTLEMENT_METRIC",
      description: "Settlement Market",
      oracleProvider: await umaOracleManager.getAddress(),
      decimals: 2,
      minimumOrderSize: ethers.parseUnits("0.1", USDC_DECIMALS),
      tickSize: TICK_SIZE,
      creationFee: MARKET_CREATION_FEE,
      requiresKYC: false,
      settlementDate: currentTime + 7 * 24 * 3600,
      tradingEndDate: currentTime + 60,  // 1 minute for testing
      dataRequestWindow: 2 * 24 * 3600,
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

    const marketAddress = await factory.getMarket("SETTLEMENT_METRIC");
    orderBookProxy = await ethers.getContractAt("OrderBook", marketAddress);

    await orderRouter.registerMarket("SETTLEMENT_METRIC", marketAddress);
    await centralVault.setMarketAuthorization(marketAddress, true);
    
    // Grant SETTLEMENT_ROLE to deployer for testing
    // The factory is the admin of the OrderBook, so we use the factory to grant the role
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));
    const factoryAsSigner = await ethers.getImpersonatedSigner(await factory.getAddress());
    
    // Fund the factory signer for gas
    await deployer.sendTransaction({
      to: await factory.getAddress(),
      value: ethers.parseEther("1")
    });
    
    await orderBookProxy.connect(factoryAsSigner).grantRole(SETTLEMENT_ROLE, deployer.address);

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
      metricId: "SETTLEMENT_METRIC",
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
    const receipt = await tx.wait();
    
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

  describe("Settlement-Based Trading for $10 Profit", function () {
    it("Should create a LONG position that profits $10 when market settles higher", async function () {
      console.log(`\n🎯 SETTLEMENT-BASED STRATEGY: $10 Profit via Market Settlement\n`);
      
      // Strategy: Create a LONG position at 1.0 ETH, settle market at 1.1 ETH (10% higher)
      const entryPrice = ethers.parseEther("1.0"); // 1.0 ETH
      const settlementPrice = ethers.parseEther("1.1"); // 1.1 ETH (10% higher)
      
      // Target $10 collateral cost → actual cost will be $100 due to 10x factor
      // But we want $10 profit, so we need correct position sizing
      const targetCollateral = ethers.parseUnits("10", USDC_DECIMALS); // $10
      const PRICE_PRECISION = ethers.parseEther("1");
      
      // Calculate quantity for $10 collateral (which becomes $100 actual cost)
      const quantity = (targetCollateral * PRICE_PRECISION) / entryPrice;
      
      console.log(`📊 Entry Price: ${ethers.formatEther(entryPrice)} ETH`);
      console.log(`📊 Settlement Price: ${ethers.formatEther(settlementPrice)} ETH`);
      console.log(`📊 Position Quantity: ${ethers.formatUnits(quantity, USDC_DECIMALS)} USDC units`);
      console.log(`📊 Expected Collateral: $${ethers.formatUnits(targetCollateral, USDC_DECIMALS)}`);
      
      const [initialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      console.log(`💳 Initial Balance: $${ethers.formatUnits(initialBalance, USDC_DECIMALS)}`);
      
      // Create LONG position
      console.log(`\n📈 CREATING LONG POSITION:`);
      await placeOrder(trader2, 1, 1, quantity, entryPrice); // Sell liquidity
      await placeOrder(trader1, 0, 0, quantity, entryPrice + TICK_SIZE); // Market buy (LONG) - slightly above limit price
      
      const [balanceAfterTrade] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const collateralLocked = initialBalance - balanceAfterTrade;
      console.log(`💸 Collateral Locked: $${ethers.formatUnits(collateralLocked, USDC_DECIMALS)}`);
      
      // Check positions
      const userPositions = await orderBookProxy.getUserPositions(trader1.address);
      console.log(`📊 Positions Created: ${userPositions.length}`);
      
      if (userPositions.length > 0) {
        const position = userPositions[0];
        console.log(`   - Position Type: ${position.isLong ? 'LONG' : 'SHORT'}`);
        console.log(`   - Entry Price: ${ethers.formatEther(position.entryPrice)} ETH`);
        console.log(`   - Quantity: ${ethers.formatUnits(position.quantity, USDC_DECIMALS)}`);
        console.log(`   - Collateral: $${ethers.formatUnits(position.collateral, USDC_DECIMALS)}`);
      }
      
      // Simulate market settlement at higher price
      console.log(`\n🎯 SETTLING MARKET AT HIGHER PRICE:`);
      
      // Convert settlement price to correct format for settlementValue (int256)
      const settlementValue = BigInt(settlementPrice.toString());
      
      // Calculate expected payout using contract logic
      // For LONG position: if settlementValue > entryPrice, profit = (priceDiff * quantity) / PRICE_PRECISION
      const priceDiff = settlementValue - BigInt(entryPrice.toString());
      const expectedProfit = (priceDiff * quantity) / PRICE_PRECISION;
      const expectedPayout = targetCollateral + expectedProfit;
      
      console.log(`📊 Settlement Value: ${ethers.formatEther(settlementValue)} ETH`);
      console.log(`📊 Price Difference: ${ethers.formatEther(priceDiff)} ETH`);
      console.log(`📊 Expected Profit: $${ethers.formatUnits(expectedProfit, USDC_DECIMALS)}`);
      console.log(`📊 Expected Total Payout: $${ethers.formatUnits(expectedPayout, USDC_DECIMALS)}`);
      
      // Wait for trading period to end
      console.log(`⏰ Waiting for trading period to end...`);
      await time.increase(120); // Advance 2 minutes

      // Request settlement first (using deployer who has SETTLEMENT_ROLE)
      console.log(`📋 Requesting settlement...`);
      await orderBookProxy.connect(deployer).requestSettlement(ethers.toUtf8Bytes(""));
      
      // Settle the market
      console.log(`📋 Settling market...`);
      await orderBookProxy.connect(deployer).settleMarket(settlementValue);
      
      // Get position ID and settle positions
      const allPositions = await orderBookProxy.getAllPositions(0, 10);
      const positionIds: number[] = [];
      for (let i = 0; i < allPositions.length; i++) {
        if (allPositions[i].trader === trader1.address) {
          positionIds.push(i + 1); // Position IDs are 1-based
        }
      }
      
      console.log(`💰 SETTLING POSITIONS:`);
      console.log(`   Position IDs to settle: [${positionIds.join(', ')}]`);
      
      // Settle positions
      if (positionIds.length > 0) {
        await orderBookProxy.settlePositions(positionIds);
        
        // Check final balance
        const [finalBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
        const totalPNL = finalBalance - initialBalance;
        
        console.log(`💳 Final Balance: $${ethers.formatUnits(finalBalance, USDC_DECIMALS)}`);
        console.log(`📊 Total PNL: $${ethers.formatUnits(totalPNL, USDC_DECIMALS)}`);
        
        // Check if we achieved $10 profit (allowing for fees)
        const minTargetProfit = ethers.parseUnits("9", USDC_DECIMALS);   // $9
        const maxTargetProfit = ethers.parseUnits("11", USDC_DECIMALS);  // $11
        
        expect(totalPNL).to.be.within(minTargetProfit, maxTargetProfit,
          `Expected PNL between $9-$11, got $${ethers.formatUnits(totalPNL, USDC_DECIMALS)}`);
        
        expect(totalPNL).to.be.gt(0, "Trade should be profitable");
        
        console.log(`\n🎉 SUCCESS: $10 Profit Target Achieved via Settlement!`);
      } else {
        throw new Error("No positions found for trader1");
      }
    });

    it("Should demonstrate settlement-based PNL calculation exactly", async function () {
      console.log(`\n🔬 PRECISE SETTLEMENT ANALYSIS\n`);
      
      // Use exact calculations to hit $10 profit target
      const entryPrice = ethers.parseEther("1.0");
      const desiredProfit = ethers.parseUnits("10", USDC_DECIMALS); // $10 profit
      
      // Work backwards: if we want $10 profit with 10% price increase,
      // then we need collateral such that 10% of collateral = $10
      // So collateral = $100, actual cost = $1000 (due to 10x factor)
      
      const targetCollateral = ethers.parseUnits("100", USDC_DECIMALS); // $100
      const PRICE_PRECISION = ethers.parseEther("1");
      const quantity = (targetCollateral * PRICE_PRECISION) / entryPrice;
      
      // Settlement price for exactly 10% gain
      const settlementPrice = (entryPrice * 110n) / 100n; // 1.1 ETH
      
      console.log(`📊 Target Profit: $${ethers.formatUnits(desiredProfit, USDC_DECIMALS)}`);
      console.log(`📊 Target Collateral: $${ethers.formatUnits(targetCollateral, USDC_DECIMALS)}`);
      console.log(`📊 Entry Price: ${ethers.formatEther(entryPrice)} ETH`);
      console.log(`📊 Settlement Price: ${ethers.formatEther(settlementPrice)} ETH`);
      console.log(`📊 Quantity: ${ethers.formatUnits(quantity, USDC_DECIMALS)} USDC units`);
      
      const [initialBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      
      // Create position
      await placeOrder(trader2, 1, 1, quantity, entryPrice);
      await placeOrder(trader1, 0, 0, quantity, entryPrice + TICK_SIZE); // More reasonable market price
      
      const [balanceAfterTrade] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const actualCost = initialBalance - balanceAfterTrade;
      console.log(`💸 Actual Cost: $${ethers.formatUnits(actualCost, USDC_DECIMALS)}`);
      
      // Calculate exact expected profit
      const priceDiff = BigInt(settlementPrice.toString()) - BigInt(entryPrice.toString());
      const calculatedProfit = (priceDiff * quantity) / PRICE_PRECISION;
      console.log(`📊 Calculated Profit: $${ethers.formatUnits(calculatedProfit, USDC_DECIMALS)}`);
      
      // Wait for trading period to end
      console.log(`⏰ Waiting for trading period to end...`);
      await time.increase(120); // Advance 2 minutes

      // Request settlement first
      console.log(`📋 Requesting settlement...`);
      await orderBookProxy.connect(deployer).requestSettlement(ethers.toUtf8Bytes(""));
      
      // Settle market
      console.log(`📋 Settling market...`);
      await orderBookProxy.connect(deployer).settleMarket(BigInt(settlementPrice.toString()));
      
      // Settle positions
      const allPositions = await orderBookProxy.getAllPositions(0, 10);
      const positionIds: number[] = [];
      for (let i = 0; i < allPositions.length; i++) {
        if (allPositions[i].trader === trader1.address) {
          positionIds.push(i + 1);
        }
      }
      
      await orderBookProxy.settlePositions(positionIds);
      
      const [finalBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
      const actualPNL = finalBalance - initialBalance;
      
      console.log(`💳 Final Balance: $${ethers.formatUnits(finalBalance, USDC_DECIMALS)}`);
      console.log(`📊 Actual PNL: $${ethers.formatUnits(actualPNL, USDC_DECIMALS)}`);
      
      // The actual PNL should be the calculated profit
      expect(actualPNL).to.be.within(
        calculatedProfit - ethers.parseUnits("1", USDC_DECIMALS), // Allow $1 tolerance for fees
        calculatedProfit + ethers.parseUnits("1", USDC_DECIMALS),
        `Expected PNL to match calculated profit of $${ethers.formatUnits(calculatedProfit, USDC_DECIMALS)}`
      );
      
      console.log(`\n✅ PRECISE CALCULATION VERIFIED!`);
    });
  });
});
