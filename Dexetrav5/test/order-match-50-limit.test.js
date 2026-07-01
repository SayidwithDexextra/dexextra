const { expect } = require("chai");
const { ethers } = require("hardhat");

// ────────────────────────────────────────────────────────────────────────────
// Repro: MAX_MATCHES_PER_ORDER = 50 cap in OBOrderPlacementFacet.
//
// We spin up a fresh in-process deployment, fund a large set of users, have 60
// distinct makers each rest a 1-unit ask at $1.00, then send a single taker buy
// for 60 units at $1.00. Even though 60 units of liquidity sit on the book at
// the taker's limit price, the engine matches only the first 50 resting orders
// in one transaction. The remaining 10 units rest as a crossed bid at $1.00.
//
// A second taker buy then sweeps the leftover 10 asks, proving the liquidity was
// always there and the shortfall is purely the per-tx 50-order matching cap.
// ────────────────────────────────────────────────────────────────────────────

const usdc = (n) => ethers.parseUnits(String(n), 6);
const amt = (n) => ethers.parseUnits(String(n), 18);

const NUM_MAKERS = 60; // > 50 so the cap is provably hit
const ASK_PRICE = usdc(1); // $1.00
const UNIT = amt(1); // 1 ALU each maker
const MAX_MATCHES_PER_ORDER = 50; // mirror of the on-chain constant

describe("OrderBook: 50-match-per-order limitation", function () {
  let deployer, taker, taker2;
  let makers;
  let mockUSDC, coreVault, orderBook, viewFacet, pricingView, tradeExec;
  let marketId, orderBookAddress;
  let execIface;

  async function deployAll() {
    const signers = await ethers.getSigners();
    // We need: deployer + 2 takers + NUM_MAKERS distinct accounts.
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

    // MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy(deployer.address);
    await mockUSDC.waitForDeployment();

    // Libraries
    const VaultAnalytics = await ethers.getContractFactory("VaultAnalytics");
    const vaultAnalytics = await VaultAnalytics.deploy();
    await vaultAnalytics.waitForDeployment();
    const vaultAnalyticsAddr = await vaultAnalytics.getAddress();

    const PositionManager = await ethers.getContractFactory("PositionManager");
    const positionManager = await PositionManager.deploy();
    await positionManager.waitForDeployment();
    const positionManagerAddr = await positionManager.getAddress();

    // CoreVault impl + ERC1967 proxy
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

    // Vault managers
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

    // Factory
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
    // Local-only: lets the deployer credit simulated cross-chain collateral
    // (the current CoreVault has no depositCollateral; deploy.js uses this path).
    await coreVault.grantRole(EXTERNAL_CREDITOR_ROLE, deployer.address);

    // MarketBondManager — the factory now requires a bond manager (reverts
    // InvalidInput otherwise). Mirror scripts/deploy.js wiring.
    const bondDefault = 100_000000n; // 100 USDC (6 decimals)
    const bondMin = 1_000000n; // 1 USDC
    const bondMax = 0n; // no max
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

    // Pre-fund the market creator (deployer) so the bond can be charged from
    // CoreVault available collateral during createFuturesMarketDiamond.
    await coreVault.creditExternal(deployer.address, bondDefault);

    // Factory defaults: 100% margin (10000 bps), 0 bps fee — mirrors deploy.js.
    await factory.updateDefaultParameters(10000, 0);

    // Diamond facets
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
    execIface = tradeExec.interface;

    const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
    await coreVault.grantRole(ORDERBOOK_ROLE, orderBookAddress);
    await coreVault.grantRole(SETTLEMENT_ROLE, orderBookAddress);

    // Configure the Diamond OB: 100% margin, 0% fee, 1:1 (no leverage).
    // Mirrors scripts/deploy.js so the test market behaves like a deployed one.
    const obAdmin = await ethers.getContractAt("OBAdminFacet", orderBookAddress);
    await obAdmin.connect(deployer).updateTradingParameters(10000, 0, deployer.address);
    try {
      await obAdmin.connect(deployer).disableLeverage();
    } catch (_) {
      /* leverage already disabled */
    }

    await coreVault.updateMarkPrice(marketId, startPrice);
    await coreVault.setMmrParams(1000, 1000, 2000, 0, 1);
  }

  // Credit simulated cross-chain collateral for a single account. The current
  // CoreVault exposes no depositCollateral; creditExternal (EXTERNAL_CREDITOR_ROLE)
  // is the local funding path used by scripts/deploy.js.
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

  before(async function () {
    this.timeout(600000); // generous: deploys stack + funds 60+ users
    await deployAll();

    // ── Fund every participant ──────────────────────────────────────────────
    // Makers post 1-unit shorts ($1 notional → $1.50 margin at 150%); $100 is plenty.
    console.log(`\n💰 Funding ${NUM_MAKERS} makers + 2 takers...`);
    for (const m of makers) {
      await fund(m, 100);
    }
    // Takers go long up to 60 units ($60 notional → $60 margin at 100%); fund big.
    await fund(taker, 10000);
    await fund(taker2, 10000);
    console.log("   ✅ Funding complete");
  });

  it(`matches only ${MAX_MATCHES_PER_ORDER} of ${NUM_MAKERS} resting asks in a single taker order`, async function () {
    this.timeout(600000);

    // ── Step 1: load the book with NUM_MAKERS distinct 1-unit asks at $1.00 ──
    console.log(`\n📚 Placing ${NUM_MAKERS} resting limit sells (1 ALU @ $1.00 each)...`);
    for (const m of makers) {
      await orderBook.connect(m).placeMarginLimitOrder(ASK_PRICE, UNIT, false);
    }

    const [, , askPrices0, askAmounts0] = await pricingView.getOrderBookDepth(5);
    const restingAsk0 = askAmounts0.reduce((a, b) => a + BigInt(b), 0n);
    console.log(
      `   ✅ Resting ask liquidity at $${ethers.formatUnits(askPrices0[0], 6)}: ` +
        `${ethers.formatUnits(restingAsk0, 18)} ALU across ${NUM_MAKERS} orders`
    );
    expect(restingAsk0).to.equal(UNIT * BigInt(NUM_MAKERS));

    // ── Step 2: single taker buy for the full NUM_MAKERS units at the ask ────
    console.log(
      `\n🛒 Taker places ONE limit buy for ${NUM_MAKERS} ALU @ $1.00 (wants to sweep all ${NUM_MAKERS})...`
    );
    const buyTx = await orderBook
      .connect(taker)
      .placeMarginLimitOrder(ASK_PRICE, UNIT * BigInt(NUM_MAKERS), true);
    const buyReceipt = await buyTx.wait();

    const tradesInTx = countTradesInReceipt(buyReceipt);
    console.log(`   📊 TradeRecorded events in that single tx: ${tradesInTx}`);

    const [takerSize] = await coreVault.getPositionSummary.staticCall(taker.address, marketId);
    console.log(`   📊 Taker long position after tx: ${ethers.formatUnits(takerSize, 18)} ALU`);

    // ── Core assertion: exactly the cap matched, not the full request ───────
    expect(tradesInTx).to.equal(MAX_MATCHES_PER_ORDER);
    expect(takerSize).to.equal(UNIT * BigInt(MAX_MATCHES_PER_ORDER));

    // ── Step 3: show the crossed/locked book left behind ────────────────────
    const [bidPrices1, bidAmounts1, askPrices1, askAmounts1] =
      await pricingView.getOrderBookDepth(5);
    const restingAsk1 = askAmounts1.reduce((a, b) => a + BigInt(b), 0n);
    const restingBid1 = bidAmounts1.reduce((a, b) => a + BigInt(b), 0n);
    const leftover = BigInt(NUM_MAKERS - MAX_MATCHES_PER_ORDER);
    console.log(
      `   ⚠️  After the cap: ${ethers.formatUnits(restingAsk1, 18)} ALU still resting as ASKS @ $1.00, ` +
        `and the taker's unfilled ${ethers.formatUnits(restingBid1, 18)} ALU now rests as a BID @ $1.00 (crossed book).`
    );
    expect(restingAsk1).to.equal(UNIT * leftover);
    // Best bid and best ask are both $1.00 → book is crossed.
    const bestBid = await viewFacet.bestBid();
    const bestAsk = await viewFacet.bestAsk();
    console.log(
      `   ⚠️  bestBid=$${ethers.formatUnits(bestBid, 6)} bestAsk=$${ethers.formatUnits(bestAsk, 6)} (crossed)`
    );
    expect(bestBid).to.equal(ASK_PRICE);
    expect(bestAsk).to.equal(ASK_PRICE);

    // ── Step 4: a SECOND taker order sweeps the leftover, proving liquidity ──
    console.log(
      `\n🔁 Second taker buys the leftover ${Number(leftover)} ALU @ $1.00 (liquidity was always there)...`
    );
    const buyTx2 = await orderBook
      .connect(taker2)
      .placeMarginLimitOrder(ASK_PRICE, UNIT * leftover, true);
    const buyReceipt2 = await buyTx2.wait();
    const tradesInTx2 = countTradesInReceipt(buyReceipt2);
    console.log(`   📊 TradeRecorded events in second tx: ${tradesInTx2}`);
    expect(tradesInTx2).to.equal(Number(leftover));

    const [, , , askAmounts2] = await pricingView.getOrderBookDepth(5);
    const restingAsk2 = askAmounts2.reduce((a, b) => a + BigInt(b), 0n);
    console.log(
      `   ✅ Remaining ask liquidity now: ${ethers.formatUnits(restingAsk2, 18)} ALU`
    );

    console.log(
      `\n🧾 SUMMARY: ${NUM_MAKERS} ALU of liquidity existed at the taker's price, but a single ` +
        `order filled only ${MAX_MATCHES_PER_ORDER} (the MAX_MATCHES_PER_ORDER cap). ` +
        `It took a second transaction to consume the rest.`
    );
  });
});
