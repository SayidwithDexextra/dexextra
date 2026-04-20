const { expect } = require("chai");
const { ethers } = require("hardhat");

// Precision helpers
const ONE_E6 = 10n ** 6n;
const ONE_E18 = 10n ** 18n;

describe("Dynamic MMR - Liquidity-aware Maintenance Margin", function () {
  let deployer, user1, user2, user3;
  let mockUSDC, coreVault, factory, orderBook, viewFacet;
  let marketId;

  async function deployAll() {
    [deployer, user1, user2, user3] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy(deployer.address);
    await mockUSDC.waitForDeployment();

    // Deploy libraries
    const VaultAnalytics = await ethers.getContractFactory("VaultAnalytics");
    const vaultAnalytics = await VaultAnalytics.deploy();
    await vaultAnalytics.waitForDeployment();
    const vaultAnalyticsAddr = await vaultAnalytics.getAddress();

    const PositionManager = await ethers.getContractFactory("PositionManager");
    const positionManager = await PositionManager.deploy();
    await positionManager.waitForDeployment();
    const positionManagerAddr = await positionManager.getAddress();

    // Deploy CoreVault implementation (UUPS - only needs PositionManager)
    const CoreVaultImpl = await ethers.getContractFactory("CoreVault", {
      libraries: {
        PositionManager: positionManagerAddr,
      },
    });
    const coreVaultImpl = await CoreVaultImpl.deploy(await mockUSDC.getAddress());
    await coreVaultImpl.waitForDeployment();
    const implAddr = await coreVaultImpl.getAddress();

    // Deploy ERC1967Proxy
    const initData = CoreVaultImpl.interface.encodeFunctionData("initialize", [deployer.address]);
    const ERC1967Proxy = await ethers.getContractFactory(
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
    );
    const proxy = await ERC1967Proxy.deploy(implAddr, initData);
    await proxy.waitForDeployment();
    coreVault = CoreVaultImpl.attach(await proxy.getAddress());

    // Deploy VaultViewsManager (needs VaultAnalytics)
    const VaultViewsManager = await ethers.getContractFactory("VaultViewsManager", {
      libraries: { VaultAnalytics: vaultAnalyticsAddr },
    });
    const viewsManager = await VaultViewsManager.deploy();
    await viewsManager.waitForDeployment();

    // Deploy SettlementManager (needs PositionManager)
    const SettlementManager = await ethers.getContractFactory("SettlementManager", {
      libraries: { PositionManager: positionManagerAddr },
    });
    const settlementManager = await SettlementManager.deploy();
    await settlementManager.waitForDeployment();

    // Deploy LiquidationManager (needs both)
    const LiquidationManager = await ethers.getContractFactory("LiquidationManager", {
      libraries: {
        VaultAnalytics: vaultAnalyticsAddr,
        PositionManager: positionManagerAddr,
      },
    });
    const liquidationManager = await LiquidationManager.deploy(
      await mockUSDC.getAddress(),
      deployer.address
    );
    await liquidationManager.waitForDeployment();

    // Wire managers
    await coreVault.setLiquidationManager(await liquidationManager.getAddress());
    await coreVault.setViewsManager(await viewsManager.getAddress());
    await coreVault.setSettlementManager(await settlementManager.getAddress());

    // Deploy FuturesMarketFactory
    const FuturesMarketFactory = await ethers.getContractFactory("FuturesMarketFactory");
    factory = await FuturesMarketFactory.deploy(
      await coreVault.getAddress(),
      deployer.address,
      deployer.address
    );
    await factory.waitForDeployment();

    // Roles
    const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));
    await coreVault.grantRole(FACTORY_ROLE, await factory.getAddress());
    await coreVault.grantRole(SETTLEMENT_ROLE, deployer.address);
    await coreVault.grantRole(SETTLEMENT_ROLE, await factory.getAddress());

    // Deploy Diamond facets
    const OrderBookInitFacet = await ethers.getContractFactory("OrderBookInitFacet");
    const OBAdminFacet = await ethers.getContractFactory("OBAdminFacet");
    const OBPricingFacet = await ethers.getContractFactory("OBPricingFacet");
    const OBOrderPlacementFacet = await ethers.getContractFactory("OBOrderPlacementFacet");
    const OBTradeExecutionFacet = await ethers.getContractFactory("OBTradeExecutionFacet");
    const OBLiquidationFacet = await ethers.getContractFactory("OBLiquidationFacet");
    const OBViewFacet = await ethers.getContractFactory("OBViewFacet");
    const OBSettlementFacet = await ethers.getContractFactory("OBSettlementFacet");
    const MarketLifecycleFacet = await ethers.getContractFactory("MarketLifecycleFacet");

    const initFacet = await OrderBookInitFacet.deploy();
    const adminFacet = await OBAdminFacet.deploy();
    const pricingFacet = await OBPricingFacet.deploy();
    const placementFacet = await OBOrderPlacementFacet.deploy();
    const execFacet = await OBTradeExecutionFacet.deploy();
    const liqFacet = await OBLiquidationFacet.deploy();
    const obViewFacet = await OBViewFacet.deploy();
    const settlementFacet = await OBSettlementFacet.deploy();
    const lifecycleFacet = await MarketLifecycleFacet.deploy();

    await Promise.all([
      initFacet.waitForDeployment(),
      adminFacet.waitForDeployment(),
      pricingFacet.waitForDeployment(),
      placementFacet.waitForDeployment(),
      execFacet.waitForDeployment(),
      liqFacet.waitForDeployment(),
      obViewFacet.waitForDeployment(),
      settlementFacet.waitForDeployment(),
      lifecycleFacet.waitForDeployment(),
    ]);

    // Build diamond cut
    const FacetCutAction = { Add: 0 };
    function selectors(iface) {
      return iface.fragments
        .filter((f) => f.type === "function")
        .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
    }

    const cut = [
      { facetAddress: await adminFacet.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors(adminFacet.interface) },
      { facetAddress: await pricingFacet.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors(pricingFacet.interface) },
      { facetAddress: await placementFacet.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors(placementFacet.interface) },
      { facetAddress: await execFacet.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors(execFacet.interface) },
      { facetAddress: await liqFacet.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors(liqFacet.interface) },
      { facetAddress: await obViewFacet.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors(obViewFacet.interface) },
      { facetAddress: await settlementFacet.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors(settlementFacet.interface) },
      { facetAddress: await lifecycleFacet.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors(lifecycleFacet.interface) },
    ];

    // Create market using Diamond pattern
    const symbol = "ALU-USD";
    const startPrice = ethers.parseUnits("1", 6);
    const createTx = await factory.createFuturesMarketDiamond(
      symbol,
      "https://example.com",
      Math.floor(Date.now() / 1000) + 86400,
      startPrice,
      "oracle",
      ["TEST"],
      deployer.address,
      cut,
      await initFacet.getAddress(),
      "0x"
    );
    const receipt = await createTx.wait();

    let orderBookAddress;
    for (const log of receipt.logs) {
      try {
        const parsed = factory.interface.parseLog(log);
        if (parsed.name === "FuturesMarketCreated") {
          orderBookAddress = parsed.args.orderBook;
          marketId = parsed.args.marketId;
          break;
        }
      } catch {}
    }

    // Attach to facets
    orderBook = await ethers.getContractAt("OBOrderPlacementFacet", orderBookAddress);
    viewFacet = await ethers.getContractAt("OBViewFacet", orderBookAddress);

    // Grant ORDERBOOK_ROLE & SETTLEMENT_ROLE
    const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
    await coreVault.grantRole(ORDERBOOK_ROLE, orderBookAddress);
    await coreVault.grantRole(SETTLEMENT_ROLE, orderBookAddress);

    // Set initial mark price to $1
    await coreVault.updateMarkPrice(marketId, startPrice);

    // Fund users and deposit collateral
    for (const u of [deployer, user1, user2, user3]) {
      await mockUSDC.mint(u.address, ethers.parseUnits("100000", 6));
      await mockUSDC
        .connect(u)
        .approve(await coreVault.getAddress(), ethers.parseUnits("10000", 6));
      await coreVault
        .connect(u)
        .depositCollateral(ethers.parseUnits("10000", 6));
    }

    // Set default MMR params: base=10%, penalty=10%, max=20%, slope=0, depth=1 (fixed 20%)
    await coreVault.setMmrParams(1000, 1000, 2000, 0, 1);

    return {
      deployer,
      user1,
      user2,
      user3,
      mockUSDC,
      coreVault,
      factory,
      orderBook,
      viewFacet,
      marketId,
    };
  }

  async function placeLiquidity() {
    // Place several price levels on both sides with 18-decimal amounts
    // Buy side (bids): 1.00, 0.99, 0.98 with amounts 10, 8, 6 ALU
    const bidPrices = ["1.00", "0.99", "0.98"];
    const bidAmts = ["10", "8", "6"];
    for (let i = 0; i < bidPrices.length; i++) {
      await orderBook
        .connect(deployer)
        .placeMarginLimitOrder(
          ethers.parseUnits(bidPrices[i], 6),
          ethers.parseUnits(bidAmts[i], 18),
          true
        );
    }
    // Sell side (asks): 1.01, 1.02 with amounts 5, 5 ALU
    const askPrices = ["1.01", "1.02"];
    const askAmts = ["5", "5"];
    for (let i = 0; i < askPrices.length; i++) {
      await orderBook
        .connect(user1)
        .placeMarginLimitOrder(
          ethers.parseUnits(askPrices[i], 6),
          ethers.parseUnits(askAmts[i], 18),
          false
        );
    }
  }

  function calcExpectedMmrBps(
    baseBps,
    penaltyBps,
    slopeBps,
    maxBps,
    absSize18,
    liquidity18
  ) {
    let mmr = BigInt(baseBps + penaltyBps);
    let ratio =
      liquidity18 === 0n ? ONE_E18 : (absSize18 * ONE_E18) / liquidity18;
    if (ratio > ONE_E18) ratio = ONE_E18;
    const scaling = (BigInt(slopeBps) * ratio) / ONE_E18;
    mmr += scaling;
    if (mmr > BigInt(maxBps)) mmr = BigInt(maxBps);
    return Number(mmr);
  }

  async function getLiquidityProxy(depth = 5) {
    const [bidPrices, bidAmounts, askPrices, askAmounts] =
      await viewFacet.getOrderBookDepth(depth);
    let sumBids = 0n;
    for (const a of bidAmounts) sumBids += BigInt(a.toString());
    let sumAsks = 0n;
    for (const a of askAmounts) sumAsks += BigInt(a.toString());
    return sumBids > sumAsks ? sumBids : sumAsks;
  }

  beforeEach(async function () {
    this.timeout(180000); // 3 minutes for full deployment
    await deployAll();
  });

  it("computes MMR with fixed 20% (base 10% + penalty 10%)", async function () {
    await placeLiquidity();

    // Open a small short position: sell 1 ALU market (use existing bids)
    const tradeExec = await ethers.getContractAt("OBTradeExecutionFacet", await orderBook.getAddress());
    const amount = ethers.parseUnits("1", 18);
    await tradeExec.connect(user3).placeMarginMarketOrder(amount, false);

    const [size, entryPrice, marginLocked] = await coreVault.getPositionSummary(
      user3.address,
      marketId
    );
    expect(size).to.be.lt(0n);

    const [mmrBps, fillRatio, hasPos] =
      await coreVault.getEffectiveMaintenanceMarginBps(user3.address, marketId);
    expect(hasPos).to.equal(true);

    // With fixed MMR (slope=0), expect base + penalty = 2000 bps (20%)
    expect(mmrBps).to.equal(2000);
    // fillRatio monotone in [0, 1e18]
    expect(fillRatio).to.be.gte(0n);
    expect(fillRatio).to.be.lte(ONE_E18);
  });

  it("respects custom parameters via setMmrParams and recomputes", async function () {
    // Place balanced liquidity
    await placeLiquidity();
    
    // Update params: base=5%, penalty=5%, max=40%, slope=30%, depth=3
    // Note: setMmrParams(base, penalty, max, slope, depth)
    await coreVault.setMmrParams(500, 500, 4000, 3000, 3);

    // Open a moderate short (5 ALU)
    const tradeExec = await ethers.getContractAt("OBTradeExecutionFacet", await orderBook.getAddress());
    await tradeExec
      .connect(user3)
      .placeMarginMarketOrder(ethers.parseUnits("5", 18), false);
      
    const [size] = await coreVault.getPositionSummary(user3.address, marketId);
    const absSize = size < 0n ? -size : size;
    const liquidity18 = await getLiquidityProxy(3);

    const [mmrBps] = await coreVault.getEffectiveMaintenanceMarginBps(
      user3.address,
      marketId
    );
    
    const expected = calcExpectedMmrBps(
      500,
      500,
      3000,
      4000,
      absSize,
      liquidity18
    );
    expect(mmrBps).to.equal(expected);
  });

  it("uses dynamic MMR in isLiquidatable and getLiquidationPrice", async function () {
    await placeLiquidity();
    
    // Open short 10 ALU @ ~$1
    const tradeExec = await ethers.getContractAt("OBTradeExecutionFacet", await orderBook.getAddress());
    await tradeExec
      .connect(user3)
      .placeMarginMarketOrder(ethers.parseUnits("10", 18), false);
      
    const [size, entryPrice, marginLocked] = await coreVault.getPositionSummary(
      user3.address,
      marketId
    );
    expect(size).to.be.lt(0n);

    // Raise mark to make it liquidatable (with dynamic mmr involved)
    const highPrice = ethers.parseUnits("5", 6);
    await coreVault.updateMarkPrice(marketId, highPrice);

    const liq = await coreVault.isLiquidatable(
      user3.address,
      marketId,
      highPrice
    );
    expect(liq).to.equal(true);

    const [liqPrice, has] = await coreVault.getLiquidationPrice(
      user3.address,
      marketId
    );
    expect(has).to.equal(true);
    expect(liqPrice).to.be.gt(0n);
  });

  it("getPositionFreeMargin reflects dynamic mmr (decreases as mmr rises)", async function () {
    await placeLiquidity();
    
    // Open small short 2 ALU
    const tradeExec = await ethers.getContractAt("OBTradeExecutionFacet", await orderBook.getAddress());
    await tradeExec
      .connect(user3)
      .placeMarginMarketOrder(ethers.parseUnits("2", 18), false);
      
    const [eq1, notional1, hasPos1] = await coreVault.getPositionEquity(
      user3.address,
      marketId
    );
    const [free1] = await coreVault.getPositionFreeMargin(
      user3.address,
      marketId
    );
    expect(hasPos1).to.equal(true);
    expect(free1).to.be.gte(0n);

    // Reduce liquidity (cancel some orders) to increase fill_ratio → higher mmr → lower free margin
    // Easiest: set params with higher slope and lower depth to increase mmr strongly
    await coreVault.setMmrParams(1000, 1000, 5000, 3000, 1);
    const [free2] = await coreVault.getPositionFreeMargin(
      user3.address,
      marketId
    );
    expect(free2).to.be.lte(free1);
  });
});
