import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Position Sizing Diagnostic", function () {
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
  const TICK_SIZE = ethers.parseEther("0.01"); // 0.01 ETH

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
      identifier: ethers.keccak256(ethers.toUtf8Bytes("DIAGNOSTIC_METRIC")),
      description: "Diagnostic Metric",
      decimals: 2,
      minBond: ethers.parseEther("1000"),
      defaultReward: ethers.parseEther("10"),
      livenessPeriod: 3600,
      isActive: true,
      authorizedRequesters: []
    };

    await umaOracleManager.configureMetric(metricConfig);

    const currentTime = Math.floor(Date.now() / 1000);
    const marketConfig = {
      metricId: "DIAGNOSTIC_METRIC",
      description: "Diagnostic Market",
      oracleProvider: await umaOracleManager.getAddress(),
      decimals: 2,
      minimumOrderSize: ethers.parseUnits("1", USDC_DECIMALS), // $1 minimum
      tickSize: TICK_SIZE,
      creationFee: MARKET_CREATION_FEE,
      requiresKYC: false,
      settlementDate: currentTime + 7 * 24 * 3600,
      tradingEndDate: currentTime + 6 * 24 * 3600,
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

    const marketAddress = await factory.getMarket("DIAGNOSTIC_METRIC");
    orderBookProxy = await ethers.getContractAt("OrderBook", marketAddress);

    await orderRouter.registerMarket("DIAGNOSTIC_METRIC", marketAddress);
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
      metricId: "DIAGNOSTIC_METRIC",
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

  describe("Position Sizing Analysis", function () {
    it("Should reveal how quantity and price relate to collateral", async function () {
      console.log(`\n🔍 DIAGNOSTIC: Understanding Position Sizing\n`);

      // Test different quantity values to understand the relationship
      const price = ethers.parseEther("1.0"); // 1.0 ETH
      
      const testCases = [
        { name: "Tiny", quantity: ethers.parseUnits("0.01", USDC_DECIMALS) }, // $0.01
        { name: "Small", quantity: ethers.parseUnits("1", USDC_DECIMALS) },   // $1.00
        { name: "Medium", quantity: ethers.parseUnits("10", USDC_DECIMALS) }, // $10.00
        { name: "Large", quantity: ethers.parseUnits("100", USDC_DECIMALS) }, // $100.00
      ];

      for (const testCase of testCases) {
        console.log(`\n📊 Test Case: ${testCase.name}`);
        console.log(`   Quantity: ${ethers.formatUnits(testCase.quantity, USDC_DECIMALS)} USDC`);
        console.log(`   Price: ${ethers.formatEther(price)} ETH`);
        
        // Calculate expected collateral using contract formula
        const PRICE_PRECISION = ethers.parseEther("1"); // 1e18
        const expectedCollateral = (testCase.quantity * price) / PRICE_PRECISION;
        
        console.log(`   Expected Collateral: ${ethers.formatUnits(expectedCollateral, USDC_DECIMALS)} USDC`);
        
        // Check if trader has sufficient balance
        const [availableBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
        console.log(`   Available Balance: ${ethers.formatUnits(availableBalance, USDC_DECIMALS)} USDC`);
        
        if (expectedCollateral <= availableBalance) {
          console.log(`   ✅ Can afford this trade`);
          
          try {
            // Get balance before
            const [balanceBefore] = await centralVault.getPrimaryCollateralBalance(trader1.address);
            
            // Place limit order
            await placeOrder(trader2, 1, 1, testCase.quantity, price); // Sell liquidity
            await placeOrder(trader1, 0, 0, testCase.quantity, ethers.parseEther("10.0")); // Market buy
            
            // Get balance after
            const [balanceAfter] = await centralVault.getPrimaryCollateralBalance(trader1.address);
            const actualCost = balanceBefore - balanceAfter;
            
            console.log(`   💸 Actual Cost: ${ethers.formatUnits(actualCost, USDC_DECIMALS)} USDC`);
            console.log(`   📊 Cost Ratio: ${actualCost}/${expectedCollateral} = ${Number(actualCost) / Number(expectedCollateral)}`);
            
          } catch (error: any) {
            console.log(`   ❌ Trade failed: ${error.message.split('reverted with reason string ')[1] || error.message}`);
          }
        } else {
          console.log(`   ❌ Cannot afford this trade`);
        }
      }
    });

    it("Should test different quantity interpretations", async function () {
      console.log(`\n🧪 TESTING: Different Quantity Interpretations\n`);

      const price = ethers.parseEther("1.0"); // 1.0 ETH
      
      // Test if quantity should be in wei units (18 decimals) instead of USDC units (6 decimals)
      const testCases = [
        { 
          name: "USDC Units (6 decimals)", 
          quantity: ethers.parseUnits("100", USDC_DECIMALS),
          description: "$100 in USDC units"
        },
        { 
          name: "Wei Units (18 decimals)", 
          quantity: ethers.parseUnits("100", 18),
          description: "100 in wei units"
        },
        { 
          name: "Scaled Wei", 
          quantity: ethers.parseUnits("0.0001", 18), // Much smaller
          description: "0.0001 in wei units"
        },
        { 
          name: "Price Units", 
          quantity: price / 100n, // Fraction of price
          description: "1/100th of price"
        }
      ];

      for (const testCase of testCases) {
        console.log(`\n📊 ${testCase.name}: ${testCase.description}`);
        console.log(`   Raw Quantity: ${testCase.quantity}`);
        console.log(`   Quantity (USDC): ${ethers.formatUnits(testCase.quantity, USDC_DECIMALS)}`);
        console.log(`   Quantity (18 dec): ${ethers.formatUnits(testCase.quantity, 18)}`);
        
        // Calculate collateral requirement
        const PRICE_PRECISION = ethers.parseEther("1");
        const expectedCollateral = (testCase.quantity * price) / PRICE_PRECISION;
        console.log(`   Expected Collateral: ${ethers.formatUnits(expectedCollateral, USDC_DECIMALS)} USDC`);
        
        // Check if affordable
        const [availableBalance] = await centralVault.getPrimaryCollateralBalance(trader1.address);
        if (expectedCollateral <= availableBalance && expectedCollateral > 0) {
          console.log(`   ✅ Affordable, testing...`);
          
          try {
            const [balanceBefore] = await centralVault.getPrimaryCollateralBalance(trader1.address);
            
            await placeOrder(trader2, 1, 1, testCase.quantity, price);
            await placeOrder(trader1, 0, 0, testCase.quantity, ethers.parseEther("10.0"));
            
            const [balanceAfter] = await centralVault.getPrimaryCollateralBalance(trader1.address);
            const actualCost = balanceBefore - balanceAfter;
            
            console.log(`   💸 Actual Cost: ${ethers.formatUnits(actualCost, USDC_DECIMALS)} USDC`);
            console.log(`   ✅ SUCCESS: Trade completed!`);
            
          } catch (error: any) {
            console.log(`   ❌ Failed: ${error.message.split('reverted with reason string ')[1] || error.message}`);
          }
        } else {
          console.log(`   ❌ Not affordable or zero collateral`);
        }
      }
    });

    it("Should find the correct quantity for $10 trade", async function () {
      console.log(`\n🎯 FINDING: Correct quantity for $10 trade\n`);
      
      // Work backwards from desired collateral to find correct quantity
      const price = ethers.parseEther("1.0"); // 1.0 ETH
      const desiredCollateralUSDC = ethers.parseUnits("10", USDC_DECIMALS); // $10
      
      console.log(`Target: $10 collateral requirement`);
      console.log(`Price: ${ethers.formatEther(price)} ETH`);
      
      // Formula: collateralRequired = (quantity * price) / PRICE_PRECISION
      // Rearranged: quantity = (collateralRequired * PRICE_PRECISION) / price
      const PRICE_PRECISION = ethers.parseEther("1");
      const calculatedQuantity = (desiredCollateralUSDC * PRICE_PRECISION) / price;
      
      console.log(`Calculated Quantity: ${calculatedQuantity}`);
      console.log(`Quantity (USDC format): ${ethers.formatUnits(calculatedQuantity, USDC_DECIMALS)}`);
      console.log(`Quantity (18 dec format): ${ethers.formatUnits(calculatedQuantity, 18)}`);
      
      // Verify this calculation
      const verifyCollateral = (calculatedQuantity * price) / PRICE_PRECISION;
      console.log(`Verification - Expected Collateral: ${ethers.formatUnits(verifyCollateral, USDC_DECIMALS)} USDC`);
      
      // Test this quantity
      try {
        const [balanceBefore] = await centralVault.getPrimaryCollateralBalance(trader1.address);
        console.log(`Balance Before: ${ethers.formatUnits(balanceBefore, USDC_DECIMALS)} USDC`);
        
        await placeOrder(trader2, 1, 1, calculatedQuantity, price);
        await placeOrder(trader1, 0, 0, calculatedQuantity, ethers.parseEther("10.0"));
        
        const [balanceAfter] = await centralVault.getPrimaryCollateralBalance(trader1.address);
        const actualCost = balanceBefore - balanceAfter;
        
        console.log(`Balance After: ${ethers.formatUnits(balanceAfter, USDC_DECIMALS)} USDC`);
        console.log(`Actual Cost: ${ethers.formatUnits(actualCost, USDC_DECIMALS)} USDC`);
        console.log(`🎯 TARGET ACHIEVED: $10 trade executed successfully!`);
        
        // This should be very close to $10
        expect(actualCost).to.be.within(
          ethers.parseUnits("9.8", USDC_DECIMALS),
          ethers.parseUnits("10.2", USDC_DECIMALS),
          "Cost should be approximately $10"
        );
        
      } catch (error: any) {
        console.log(`❌ Failed: ${error.message}`);
        throw error;
      }
    });
  });
});
