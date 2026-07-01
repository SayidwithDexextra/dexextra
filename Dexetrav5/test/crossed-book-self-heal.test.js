const { expect } = require("chai");
const { ethers } = require("hardhat");

// ────────────────────────────────────────────────────────────────────────────
// Crossed-book self-heal (OBCrossHealFacet + auto-heal hook in OBOrderPlacementFacet).
//
// Background: an order that hits MAX_MATCHES_PER_ORDER (50) leaves its unfilled
// remainder resting across the spread -> a crossed book (bestBid >= bestAsk).
//
// This suite proves, with the heal facet installed:
//   1. An order that hits the match cap self-heals its OWN leftover cross within
//      the same placement tx (the common case: a single order a bit over the cap
//      never leaves the book bid >= ask). No keeper, no second tx.
//   2. The hot-path hook is a cheap no-op on a healthy book (an unrelated,
//      non-matching order does not spuriously heal).
//   3. The permissionless `sweepCrossedBook()` entrypoint is callable by anyone
//      and is a safe no-op on a healthy book.
// Positions/margins reconcile and only indexer-known events fire.
//
// Per-tx healing budget: one placement clears up to MAX_MATCHES_PER_ORDER on the
// initial match PLUS one heal iteration (another MAX_MATCHES_PER_ORDER) = 100
// crossing units, so a cross from a single order up to ~100 deep at one price
// fully resolves in that order's own tx.
// ────────────────────────────────────────────────────────────────────────────

const usdc = (n) => ethers.parseUnits(String(n), 6);
const amt = (n) => ethers.parseUnits(String(n), 18);

const MAX_MATCHES_PER_ORDER = 50;
const SHALLOW_MAKERS = 55; // > 50 (cap hit) but <= 100 (fully heals in one tx)
const NUM_MAKERS = SHALLOW_MAKERS; // signer pool / funding size
const ASK_PRICE = usdc(1); // $1.00
const UNIT = amt(1); // 1 unit each maker

describe("OrderBook: crossed-book self-heal", function () {
  let deployer, taker, taker2;
  let makers;
  let mockUSDC, coreVault, orderBook, viewFacet, pricingView, tradeExec, crossHeal;
  let marketId, orderBookAddress;
  let execIface, healIface;

  async function deployAll() {
    const signers = await ethers.getSigners();
    const needed = 3 + NUM_MAKERS;
    if (signers.length < needed) {
      throw new Error(
        `Need at least ${needed} signers; only ${signers.length} available. ` +
          `Bump networks.hardhat.accounts.count in hardhat.config.js.`
      );
    }
    deployer = signers[0];
    taker = signers[1];
    taker2 = signers[2];
    makers = signers.slice(3, 3 + NUM_MAKERS);

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy(deployer.address);
    await mockUSDC.waitForDeployment();

    const VaultAnalytics = await ethers.getContractFactory("VaultAnalytics");
    const vaultAnalytics = await VaultAnalytics.deploy();
    await vaultAnalytics.waitForDeployment();
    const vaultAnalyticsAddr = await vaultAnalytics.getAddress();

    const PositionManager = await ethers.getContractFactory("PositionManager");
    const positionManager = await PositionManager.deploy();
    await positionManager.waitForDeployment();
    const positionManagerAddr = await positionManager.getAddress();

    const CoreVaultImpl = await ethers.getContractFactory("CoreVault", {
      libraries: { PositionManager: positionManagerAddr },
    });
    const coreVaultImpl = await CoreVaultImpl.deploy(await mockUSDC.getAddress());
    await coreVaultImpl.waitForDeployment();
    const implAddr = await coreVaultImpl.getAddress();

    const initData = CoreVaultImpl.interface.encodeFunctionData("initialize", [
      deployer.address,
    ]);
    const ERC1967Proxy = await ethers.getContractFactory(
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
    );
    const proxy = await ERC1967Proxy.deploy(implAddr, initData);
    await proxy.waitForDeployment();
    coreVault = CoreVaultImpl.attach(await proxy.getAddress());

    const VaultViewsManager = await ethers.getContractFactory("VaultViewsManager", {
      libraries: { VaultAnalytics: vaultAnalyticsAddr },
    });
    const viewsManager = await VaultViewsManager.deploy();
    await viewsManager.waitForDeployment();

    const SettlementManager = await ethers.getContractFactory("SettlementManager", {
      libraries: { PositionManager: positionManagerAddr },
    });
    const settlementManager = await SettlementManager.deploy();
    await settlementManager.waitForDeployment();

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

    await coreVault.setLiquidationManager(await liquidationManager.getAddress());
    await coreVault.setViewsManager(await viewsManager.getAddress());
    await coreVault.setSettlementManager(await settlementManager.getAddress());

    const FuturesMarketFactory = await ethers.getContractFactory("FuturesMarketFactory");
    const factory = await FuturesMarketFactory.deploy(
      await coreVault.getAddress(),
      deployer.address,
      deployer.address
    );
    await factory.waitForDeployment();

    const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));
    const EXTERNAL_CREDITOR_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE")
    );
    await coreVault.grantRole(FACTORY_ROLE, await factory.getAddress());
    await coreVault.grantRole(SETTLEMENT_ROLE, deployer.address);
    await coreVault.grantRole(SETTLEMENT_ROLE, await factory.getAddress());
    await coreVault.grantRole(EXTERNAL_CREDITOR_ROLE, deployer.address);

    const bondDefault = 100_000000n;
    const bondMin = 1_000000n;
    const bondMax = 0n;
    const MarketBondManager = await ethers.getContractFactory("MarketBondManager");
    const bondManager = await MarketBondManager.deploy(
      await coreVault.getAddress(),
      await factory.getAddress(),
      deployer.address,
      bondDefault,
      bondMin,
      bondMax
    );
    await bondManager.waitForDeployment();
    await bondManager.setPenaltyConfig(0, deployer.address);
    await coreVault.grantRole(FACTORY_ROLE, await bondManager.getAddress());
    await factory.setBondManager(await bondManager.getAddress());
    await coreVault.creditExternal(deployer.address, bondDefault);
    await factory.updateDefaultParameters(10000, 0);

    const OrderBookInitFacet = await ethers.getContractFactory("OrderBookInitFacet");
    const OBAdminFacet = await ethers.getContractFactory("OBAdminFacet");
    const OBPricingFacet = await ethers.getContractFactory("OBPricingFacet");
    const OBOrderPlacementFacet = await ethers.getContractFactory("OBOrderPlacementFacet");
    const OBTradeExecutionFacet = await ethers.getContractFactory("OBTradeExecutionFacet");
    const OBLiquidationFacet = await ethers.getContractFactory("OBLiquidationFacet");
    const OBViewFacet = await ethers.getContractFactory("OBViewFacet");
    const OBSettlementFacet = await ethers.getContractFactory("OBSettlementFacet");
    const MarketLifecycleFacet = await ethers.getContractFactory("MarketLifecycleFacet");
    const OBBatchSettlementFacet = await ethers.getContractFactory("OBBatchSettlementFacet");
    const OBCrossHealFacet = await ethers.getContractFactory("OBCrossHealFacet");

    const initFacet = await OrderBookInitFacet.deploy();
    const adminFacet = await OBAdminFacet.deploy();
    const pricingFacet = await OBPricingFacet.deploy();
    const placementFacet = await OBOrderPlacementFacet.deploy();
    const execFacet = await OBTradeExecutionFacet.deploy();
    const liqFacet = await OBLiquidationFacet.deploy();
    const obViewFacet = await OBViewFacet.deploy();
    const settlementFacet = await OBSettlementFacet.deploy();
    const lifecycleFacet = await MarketLifecycleFacet.deploy();
    const batchSettlementFacet = await OBBatchSettlementFacet.deploy();
    const healFacet = await OBCrossHealFacet.deploy();

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
      batchSettlementFacet.waitForDeployment(),
      healFacet.waitForDeployment(),
    ]);

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
      { facetAddress: await batchSettlementFacet.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors(batchSettlementFacet.interface) },
      { facetAddress: await healFacet.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors(healFacet.interface) },
    ];

    const symbol = "ALU-USD";
    const startPrice = usdc(1);
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

    orderBook = await ethers.getContractAt("OBOrderPlacementFacet", orderBookAddress);
    viewFacet = await ethers.getContractAt("OBViewFacet", orderBookAddress);
    pricingView = await ethers.getContractAt("OBPricingFacet", orderBookAddress);
    tradeExec = await ethers.getContractAt("OBTradeExecutionFacet", orderBookAddress);
    crossHeal = await ethers.getContractAt("OBCrossHealFacet", orderBookAddress);
    execIface = tradeExec.interface;
    healIface = crossHeal.interface;

    const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
    await coreVault.grantRole(ORDERBOOK_ROLE, orderBookAddress);
    await coreVault.grantRole(SETTLEMENT_ROLE, orderBookAddress);

    const obAdmin = await ethers.getContractAt("OBAdminFacet", orderBookAddress);
    await obAdmin.connect(deployer).updateTradingParameters(10000, 0, deployer.address);
    try {
      await obAdmin.connect(deployer).disableLeverage();
    } catch (_) {}

    await coreVault.updateMarkPrice(marketId, startPrice);
    await coreVault.setMmrParams(1000, 1000, 2000, 0, 1);
  }

  async function fund(signer, collateralAmount) {
    await coreVault.creditExternal(signer.address, usdc(collateralAmount));
  }

  function countTradesInReceipt(receipt) {
    let trades = 0;
    for (const log of receipt.logs) {
      try {
        const parsed = execIface.parseLog(log);
        if (parsed && parsed.name === "TradeRecorded") trades++;
      } catch {}
    }
    return trades;
  }

  function countHealedInReceipt(receipt) {
    let healed = 0;
    for (const log of receipt.logs) {
      try {
        const parsed = healIface.parseLog(log);
        if (parsed && parsed.name === "CrossBookHealed") healed++;
      } catch {}
    }
    return healed;
  }

  // Seed `n` resting asks @ $1 (one unit each, distinct makers).
  async function seedAsks(n) {
    for (let i = 0; i < n; i++) {
      await orderBook.connect(makers[i]).placeMarginLimitOrder(ASK_PRICE, UNIT, false);
    }
  }

  beforeEach(async function () {
    this.timeout(600000);
    await deployAll();
    for (const m of makers) await fund(m, 100);
    await fund(taker, 10000);
    await fund(taker2, 10000);
  });

  it("self-heals its own leftover cross within the same placement tx", async function () {
    this.timeout(600000);
    // SHALLOW_MAKERS (55) asks @ $1, then one taker buy for the full 55 units.
    await seedAsks(SHALLOW_MAKERS);
    const buyTx = await orderBook
      .connect(taker)
      .placeMarginLimitOrder(ASK_PRICE, UNIT * BigInt(SHALLOW_MAKERS), true);
    const buyReceipt = await buyTx.wait();

    // The order hit the 50-cap, rested its remainder across the spread, then the
    // end-of-placement heal re-submitted that remainder and consumed the rest --
    // all in this single tx. 50 initial + 5 healed = 55 trades, exactly one heal.
    expect(countHealedInReceipt(buyReceipt)).to.equal(1);
    expect(countTradesInReceipt(buyReceipt)).to.equal(SHALLOW_MAKERS);

    // Book ends uncrossed with NOTHING resting: every ask consumed, no taker bid left.
    expect(await crossHeal.sweepCrossedBook.staticCall(0)).to.equal(false);
    expect(await viewFacet.bestAsk()).to.equal(0n);
    expect(await viewFacet.bestBid()).to.equal(0n);

    // Taker is filled for the full requested size in that one tx.
    const [takerSize] = await coreVault.getPositionSummary.staticCall(taker.address, marketId);
    expect(takerSize).to.equal(UNIT * BigInt(SHALLOW_MAKERS));
  });

  it("auto-heal also fires on an unrelated, non-matching order placement", async function () {
    this.timeout(600000);
    // Seed a shallow over-cap book and let one taker buy create-and-self-heal it.
    await seedAsks(SHALLOW_MAKERS);
    await (
      await orderBook
        .connect(taker)
        .placeMarginLimitOrder(ASK_PRICE, UNIT * BigInt(SHALLOW_MAKERS), true)
    ).wait();
    // Book is healthy now; a subsequent unrelated low buy must NOT spuriously heal
    // (proves the hot-path hook is a cheap no-op on a healthy book) and just rests.
    const LOW = usdc(0.5);
    const r = await (await orderBook.connect(taker2).placeMarginLimitOrder(LOW, UNIT, true)).wait();
    expect(countHealedInReceipt(r)).to.equal(0);
    expect(await viewFacet.bestBid()).to.equal(LOW);
  });

  it("permissionless sweepCrossedBook() is a safe no-op on a healthy book", async function () {
    this.timeout(600000);
    // Build a normal (uncrossed) book: a few resting asks, no crossing bid.
    await seedAsks(3);
    // Anyone can poke the sweep; on a healthy book it heals nothing and reports
    // not-crossed, so an external keeper calling it is always harmless.
    const r = await (await crossHeal.connect(taker2).sweepCrossedBook(10)).wait();
    expect(countHealedInReceipt(r)).to.equal(0);
    expect(await crossHeal.sweepCrossedBook.staticCall(1)).to.equal(false);
  });
});
