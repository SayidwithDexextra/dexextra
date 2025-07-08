const MockUSDC = artifacts.require("MockUSDC");
const MockPriceOracle = artifacts.require("MockPriceOracle");
const vAMMFactory = artifacts.require("vAMMFactory");
const vAMM = artifacts.require("vAMM");
const Vault = artifacts.require("Vault");

contract("vAMM System", (accounts) => {
  let usdc, oracle, factory, vamm, vault;
  const [owner, trader1, trader2, liquidator] = accounts;
  const initialPrice = web3.utils.toWei("50000", "ether"); // $50,000
  const deploymentFee = web3.utils.toWei("0.1", "ether");

  beforeEach(async () => {
    // Deploy contracts
    usdc = await MockUSDC.new(1000000, { from: owner });
    oracle = await MockPriceOracle.new(initialPrice, { from: owner });
    factory = await vAMMFactory.new({ from: owner });

    // Create market
    const result = await factory.createMarket(
      "BTC/USDC",
      oracle.address,
      usdc.address,
      initialPrice,
      { value: deploymentFee, from: owner }
    );

    // Get deployed contract addresses
    const marketCreatedEvent = result.logs.find(log => log.event === 'MarketCreated');
    vamm = await vAMM.at(marketCreatedEvent.args.vamm);
    vault = await Vault.at(marketCreatedEvent.args.vault);

    // Mint USDC to traders
    await usdc.mint(trader1, web3.utils.toWei("100000", "mwei")); // 100k USDC
    await usdc.mint(trader2, web3.utils.toWei("100000", "mwei")); // 100k USDC
  });

  describe("Factory Deployment", () => {
    it("should deploy factory correctly", async () => {
      assert.equal(await factory.owner(), owner);
      assert.equal(await factory.marketCount(), 1);
    });

    it("should create market correctly", async () => {
      const markets = await factory.getAllMarketIds();
      assert.equal(markets.length, 1);
      
      const marketInfo = await factory.getMarket(markets[0]);
      assert.equal(marketInfo.symbol, "BTC/USDC");
      assert.equal(marketInfo.oracle, oracle.address);
      assert.equal(marketInfo.collateralToken, usdc.address);
      assert.equal(marketInfo.isActive, true);
    });
  });

  describe("Collateral Management", () => {
    it("should allow collateral deposits", async () => {
      const depositAmount = web3.utils.toWei("10000", "mwei"); // 10k USDC
      
      await usdc.approve(vault.address, depositAmount, { from: trader1 });
      await vault.depositCollateral(trader1, depositAmount, { from: trader1 });
      
      const account = await vault.getMarginAccount(trader1);
      assert.equal(account.collateral.toString(), depositAmount);
    });

    it("should allow collateral withdrawals", async () => {
      const depositAmount = web3.utils.toWei("10000", "mwei");
      const withdrawAmount = web3.utils.toWei("5000", "mwei");
      
      // Deposit
      await usdc.approve(vault.address, depositAmount, { from: trader1 });
      await vault.depositCollateral(trader1, depositAmount, { from: trader1 });
      
      // Withdraw
      await vault.withdrawCollateral(trader1, withdrawAmount, { from: trader1 });
      
      const account = await vault.getMarginAccount(trader1);
      assert.equal(account.collateral.toString(), withdrawAmount);
    });
  });

  describe("Position Management", () => {
    beforeEach(async () => {
      // Setup collateral for both traders
      const depositAmount = web3.utils.toWei("10000", "mwei");
      
      await usdc.approve(vault.address, depositAmount, { from: trader1 });
      await vault.depositCollateral(trader1, depositAmount, { from: trader1 });
      
      await usdc.approve(vault.address, depositAmount, { from: trader2 });
      await vault.depositCollateral(trader2, depositAmount, { from: trader2 });
    });

    it("should open long position", async () => {
      const collateralAmount = web3.utils.toWei("1000", "mwei"); // 1000 USDC
      const leverage = 10;
      
      await vamm.openPosition(
        collateralAmount,
        true, // isLong
        leverage,
        0, // minPrice
        web3.utils.toWei("100000", "ether"), // maxPrice
        { from: trader1 }
      );
      
      const position = await vamm.getPosition(trader1);
      assert.equal(position.size > 0, true);
      assert.equal(position.entryPrice.toString(), initialPrice);
    });

    it("should open short position", async () => {
      const collateralAmount = web3.utils.toWei("1000", "mwei");
      const leverage = 5;
      
      await vamm.openPosition(
        collateralAmount,
        false, // isShort
        leverage,
        0,
        web3.utils.toWei("100000", "ether"),
        { from: trader2 }
      );
      
      const position = await vamm.getPosition(trader2);
      assert.equal(position.size < 0, true);
    });

    it("should close position", async () => {
      const collateralAmount = web3.utils.toWei("1000", "mwei");
      const leverage = 10;
      
      // Open position
      await vamm.openPosition(
        collateralAmount,
        true,
        leverage,
        0,
        web3.utils.toWei("100000", "ether"),
        { from: trader1 }
      );
      
      const position = await vamm.getPosition(trader1);
      const sizeToClose = position.size;
      
      // Close position
      await vamm.closePosition(
        sizeToClose,
        0,
        web3.utils.toWei("100000", "ether"),
        { from: trader1 }
      );
      
      const closedPosition = await vamm.getPosition(trader1);
      assert.equal(closedPosition.size.toString(), "0");
    });
  });

  describe("Funding Rate Mechanism", () => {
    it("should update funding rate", async () => {
      const initialFundingRate = await vamm.getFundingRate();
      
      // Simulate price movement to create premium
      await oracle.simulatePriceMovement(500, { from: owner }); // 5% increase
      
      await vamm.updateFunding();
      
      const newFundingRate = await vamm.getFundingRate();
      // Funding rate should change due to premium
      assert.notEqual(initialFundingRate.toString(), newFundingRate.toString());
    });

    it("should apply funding to positions", async () => {
      const collateralAmount = web3.utils.toWei("1000", "mwei");
      
      // Open position
      await vamm.openPosition(
        collateralAmount,
        true,
        10,
        0,
        web3.utils.toWei("100000", "ether"),
        { from: trader1 }
      );
      
      // Simulate time passage and price movement
      await oracle.simulatePriceMovement(1000, { from: owner }); // 10% increase
      await vamm.updateFunding();
      
      // Opening another position should apply funding
      await vamm.openPosition(
        collateralAmount,
        true,
        5,
        0,
        web3.utils.toWei("100000", "ether"),
        { from: trader1 }
      );
      
      const account = await vault.getMarginAccount(trader1);
      // Account should reflect funding payments
      assert.notEqual(account.unrealizedPnL.toString(), "0");
    });
  });

  describe("Price Impact", () => {
    it("should calculate price impact correctly", async () => {
      const tradeSize = web3.utils.toWei("10000", "ether");
      const priceImpact = await vamm.getPriceImpact(tradeSize, true);
      
      assert.equal(priceImpact > 0, true);
    });

    it("should affect mark price after large trades", async () => {
      const initialMarkPrice = await vamm.getMarkPrice();
      
      const largeCollateral = web3.utils.toWei("5000", "mwei");
      await vamm.openPosition(
        largeCollateral,
        true,
        20,
        0,
        web3.utils.toWei("100000", "ether"),
        { from: trader1 }
      );
      
      const newMarkPrice = await vamm.getMarkPrice();
      assert.equal(newMarkPrice > initialMarkPrice, true);
    });
  });

  describe("Liquidation", () => {
    it("should detect liquidatable positions", async () => {
      const collateralAmount = web3.utils.toWei("1000", "mwei");
      
      // Open high leverage position
      await vamm.openPosition(
        collateralAmount,
        true,
        50, // High leverage
        0,
        web3.utils.toWei("100000", "ether"),
        { from: trader1 }
      );
      
      // Simulate adverse price movement
      await oracle.simulatePriceMovement(-1000, { from: owner }); // 10% decrease
      
      // Update unrealized PnL
      const unrealizedPnL = await vamm.getUnrealizedPnL(trader1);
      await vault.updatePnL(trader1, unrealizedPnL);
      
      const canLiquidate = await vault.canLiquidate(trader1, 500); // 5% maintenance margin
      assert.equal(canLiquidate, true);
    });
  });

  describe("Emergency Controls", () => {
    it("should pause and unpause trading", async () => {
      await vamm.pause({ from: owner });
      assert.equal(await vamm.paused(), true);
      
      // Should revert when paused
      try {
        await vamm.openPosition(
          web3.utils.toWei("1000", "mwei"),
          true,
          10,
          0,
          web3.utils.toWei("100000", "ether"),
          { from: trader1 }
        );
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "paused");
      }
      
      await vamm.unpause({ from: owner });
      assert.equal(await vamm.paused(), false);
    });
  });

  describe("Fee Collection", () => {
    it("should collect trading fees", async () => {
      const initialFees = await vamm.totalTradingFees();
      
      await vamm.openPosition(
        web3.utils.toWei("1000", "mwei"),
        true,
        10,
        0,
        web3.utils.toWei("100000", "ether"),
        { from: trader1 }
      );
      
      const finalFees = await vamm.totalTradingFees();
      assert.equal(finalFees > initialFees, true);
    });
  });
}); 