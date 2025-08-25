import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Deployment Verification", function () {
  let mockUMAFinder: Contract;
  let mockUSDC: Contract;
  let umaOracleManager: Contract;
  let centralVault: Contract;
  let orderRouter: Contract;
  let orderBookImplementation: Contract;
  let factory: Contract;
  let deployer: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  async function deploySystem() {
    [deployer, user1, user2] = await ethers.getSigners();

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
      ethers.parseEther("1"), // 1 ETH creation fee
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

    return {
      mockUMAFinder,
      mockUSDC,
      umaOracleManager,
      centralVault,
      orderRouter,
      orderBookImplementation,
      factory,
      deployer,
      user1,
      user2
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
    user1 = deployment.user1;
    user2 = deployment.user2;
  });

  describe("Contract Deployment", function () {
    it("Should deploy all contracts successfully", async function () {
      expect(await mockUMAFinder.getAddress()).to.not.equal(ethers.ZeroAddress);
      expect(await mockUSDC.getAddress()).to.not.equal(ethers.ZeroAddress);
      expect(await umaOracleManager.getAddress()).to.not.equal(ethers.ZeroAddress);
      expect(await centralVault.getAddress()).to.not.equal(ethers.ZeroAddress);
      expect(await orderRouter.getAddress()).to.not.equal(ethers.ZeroAddress);
      expect(await orderBookImplementation.getAddress()).to.not.equal(ethers.ZeroAddress);
      expect(await factory.getAddress()).to.not.equal(ethers.ZeroAddress);
    });

    it("Should have correct contract configurations", async function () {
      // Check MockUSDC
      expect(await mockUSDC.name()).to.equal("Mock USD Coin");
      expect(await mockUSDC.symbol()).to.equal("USDC");
      expect(await mockUSDC.decimals()).to.equal(6);

      // Check Central Vault primary collateral
      const [token, isERC20, name, symbol] = await centralVault.getPrimaryCollateralToken();
      expect(token).to.equal(await mockUSDC.getAddress());
      expect(isERC20).to.be.true;
      expect(name).to.equal("Mock USD Coin");
      expect(symbol).to.equal("USDC");
    });

    it("Should have correct role configurations", async function () {
      // Check UMA Oracle Manager roles
      const metricManagerRole = await umaOracleManager.METRIC_MANAGER_ROLE();
      expect(await umaOracleManager.hasRole(metricManagerRole, await factory.getAddress())).to.be.true;

      // Check Order Router roles
      const marketRole = await orderRouter.MARKET_ROLE();
      expect(await orderRouter.hasRole(marketRole, await factory.getAddress())).to.be.true;

      // Check Central Vault authorizations
      expect(await centralVault.isAuthorizedMarket(await orderRouter.getAddress())).to.be.true;
      expect(await centralVault.isAuthorizedMarket(await factory.getAddress())).to.be.true;
    });
  });

  describe("Market Creation", function () {
    it("Should create a new market successfully", async function () {
      // Configure a test metric first
      const metricConfig = {
        identifier: ethers.keccak256(ethers.toUtf8Bytes("METRIC_TEST")),
        description: "Test Metric",
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
        description: "Test Market",
        oracleProvider: await umaOracleManager.getAddress(),
        decimals: 2,
        minimumOrderSize: ethers.parseEther("0.01"),
        tickSize: ethers.parseEther("0.01"),
        creationFee: ethers.parseEther("1"),
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
        value: ethers.parseEther("1")
      });

      await tx.wait();

      // Verify market was created
      const marketAddress = await factory.getMarket("TEST_METRIC");
      expect(marketAddress).to.not.equal(ethers.ZeroAddress);

      // Verify market exists
      expect(await factory.marketExists("TEST_METRIC")).to.be.true;
    });
  });

  describe("Vault Operations", function () {
    beforeEach(async function () {
      // Mint some USDC to users for testing
      await mockUSDC.mint(user1.address, ethers.parseUnits("1000", 6)); // 1000 USDC
      await mockUSDC.mint(user2.address, ethers.parseUnits("1000", 6)); // 1000 USDC
    });

    it("Should allow users to deposit USDC", async function () {
      const depositAmount = ethers.parseUnits("100", 6); // 100 USDC

      // Approve vault to spend USDC
      await mockUSDC.connect(user1).approve(await centralVault.getAddress(), depositAmount);

      // Deposit
      await centralVault.connect(user1).depositPrimaryCollateral(depositAmount);

      // Check balance
      const [available] = await centralVault.getPrimaryCollateralBalance(user1.address);
      expect(available).to.equal(depositAmount);
    });

    it("Should allow users to withdraw USDC", async function () {
      const depositAmount = ethers.parseUnits("100", 6); // 100 USDC
      const withdrawAmount = ethers.parseUnits("50", 6);  // 50 USDC

      // Deposit first
      await mockUSDC.connect(user1).approve(await centralVault.getAddress(), depositAmount);
      await centralVault.connect(user1).depositPrimaryCollateral(depositAmount);

      // Withdraw
      await centralVault.connect(user1).withdrawPrimaryCollateral(withdrawAmount);

      // Check balance
      const [available] = await centralVault.getPrimaryCollateralBalance(user1.address);
      expect(available).to.equal(depositAmount - withdrawAmount);
    });
  });

  describe("Order Router Functions", function () {
    it("Should register and retrieve market order books", async function () {
      const testMetricId = "TEST_METRIC_ROUTER";
      const mockOrderBookAddress = user1.address; // Use a dummy address

      // Register market
      await orderRouter.registerMarket(testMetricId, mockOrderBookAddress);

      // Retrieve market
      const retrievedAddress = await orderRouter.getMarketOrderBook(testMetricId);
      expect(retrievedAddress).to.equal(mockOrderBookAddress);
    });

    it("Should track user order counts correctly", async function () {
      // Initially should have 0 orders
      expect(await orderRouter.getUserActiveOrderCount(user1.address)).to.equal(0);
      expect(await orderRouter.getUserTotalOrderCount(user1.address)).to.equal(0);
      expect(await orderRouter.getRemainingOrderSlots(user1.address)).to.equal(1000); // MAX_ORDERS_PER_USER
    });
  });

  describe("UMA Oracle Manager Functions", function () {
    it("Should configure metrics correctly", async function () {
      const metricConfig = {
        identifier: ethers.keccak256(ethers.toUtf8Bytes("METRIC_TEST_UMA")),
        description: "Test UMA Metric",
        decimals: 0,
        minBond: ethers.parseEther("1000"),
        defaultReward: ethers.parseEther("10"),
        livenessPeriod: 7200,
        isActive: true,
        authorizedRequesters: []
      };

      await umaOracleManager.configureMetric(metricConfig);

      // Retrieve and verify configuration
      const retrievedConfig = await umaOracleManager.getMetricConfig(metricConfig.identifier);
      expect(retrievedConfig.description).to.equal("Test UMA Metric");
      expect(retrievedConfig.isActive).to.be.true;
      expect(retrievedConfig.minBond).to.equal(ethers.parseEther("1000"));
    });

    it("Should add and check authorized requesters", async function () {
      const metricIdentifier = ethers.keccak256(ethers.toUtf8Bytes("METRIC_TEST_AUTH"));

      // Configure metric first
      const metricConfig = {
        identifier: metricIdentifier,
        description: "Test Auth Metric",
        decimals: 0,
        minBond: ethers.parseEther("1000"),
        defaultReward: ethers.parseEther("10"),
        livenessPeriod: 7200,
        isActive: true,
        authorizedRequesters: []
      };

      await umaOracleManager.configureMetric(metricConfig);

      // Add authorized requester
      await umaOracleManager.addAuthorizedRequester(metricIdentifier, user1.address);

      // Check authorization
      expect(await umaOracleManager.isAuthorizedRequester(metricIdentifier, user1.address)).to.be.true;
      expect(await umaOracleManager.isAuthorizedRequester(metricIdentifier, user2.address)).to.be.false;
    });
  });
});
