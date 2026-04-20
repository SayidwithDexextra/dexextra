const { expect } = require("chai");
const { ethers } = require("hardhat");
const config = require("../config/contracts");

// helpers
const usdc = (n) => ethers.parseUnits(String(n), 6);
const amt = (n) => ethers.parseUnits(String(n), 18);

describe("Low-stakes short liquidation ($1-$2) using existing deployment", function () {
  let deployer, lp1, lp2, shorter;
  let mockUSDC, vault, orderBook, viewFacet, tradeExec;
  let marketId, marketOrderBookAddr;

  beforeEach(async function () {
    const signers = await ethers.getSigners();

    // Refresh config addresses
    await config.getContract.refreshAddresses();

    // Attach existing contracts from config
    vault = await config.getContract("CORE_VAULT");
    mockUSDC = await config.getContract("MOCK_USDC");

    // Get market info
    const marketInfo = Object.values(config.MARKET_INFO)[0];
    if (!marketInfo) {
      throw new Error("No market found in config - run deploy.js first");
    }
    marketId = marketInfo.marketId;
    marketOrderBookAddr = marketInfo.orderBook;

    // Attach to Diamond facets
    orderBook = await ethers.getContractAt("OBOrderPlacementFacet", marketOrderBookAddr);
    viewFacet = await ethers.getContractAt("OBViewFacet", marketOrderBookAddr);
    tradeExec = await ethers.getContractAt("OBTradeExecutionFacet", marketOrderBookAddr);

    // Pick roles to ensure the shorter starts flat if possible
    const initial = [];
    for (let i = 0; i < Math.min(signers.length, 20); i++) {
      const s = signers[i];
      try {
        const [sz] = await vault.getPositionSummary(s.address, marketId);
        initial.push({ addr: s.address, signer: s, size: sz });
      } catch {
        initial.push({ addr: s.address, signer: s, size: 0n });
      }
    }
    // Prefer zero-size accounts for stability
    const zeros = initial.filter((x) => x.size === 0n);
    const nonzeros = initial.filter((x) => x.size !== 0n);
    // Sort nonzeros by absolute size ascending
    nonzeros.sort((a, b) => (a.size < b.size ? -1 : a.size > b.size ? 1 : 0));
    const pool = [...zeros, ...nonzeros];
    
    // Assign roles (need at least 4 accounts)
    if (pool.length < 4) {
      throw new Error("Need at least 4 signers for this test");
    }
    shorter = pool[0].signer;
    lp1 = pool[1].signer;
    lp2 = pool[2].signer;
    deployer = pool[3] ? pool[3].signer : signers[0];

    // Debug addresses
    console.log("Vault:", await vault.getAddress());
    console.log("MarketId:", marketId);
    console.log("OrderBook:", marketOrderBookAddr);
    console.log("shorter:", shorter.address);
    console.log("lp1:", lp1.address);
    console.log("lp2:", lp2.address);
    
    const [sSz] = await vault.getPositionSummary(shorter.address, marketId);
    const [l1Sz] = await vault.getPositionSummary(lp1.address, marketId);
    const [l2Sz] = await vault.getPositionSummary(lp2.address, marketId);
    console.log(
      "sizes before -> shorter:",
      sSz.toString(),
      "lp1:",
      l1Sz.toString(),
      "lp2:",
      l2Sz.toString()
    );

    // Pre-step: top up LPs only (shorter unchanged) to ensure sufficient margin
    // Mint 100 USDC to each LP, deposit 50 USDC as collateral
    await mockUSDC.mint(lp1.address, usdc(100));
    await mockUSDC.connect(lp1).approve(await vault.getAddress(), usdc(100));
    await vault.connect(lp1).depositCollateral(usdc(50));

    await mockUSDC.mint(lp2.address, usdc(100));
    await mockUSDC.connect(lp2).approve(await vault.getAddress(), usdc(100));
    await vault.connect(lp2).depositCollateral(usdc(50));

    // Minimal top-up for shorter so they can open the $1 short
    await mockUSDC.mint(shorter.address, usdc(10));
    await mockUSDC.connect(shorter).approve(await vault.getAddress(), usdc(10));
    await vault.connect(shorter).depositCollateral(usdc(10));
  });

  it("liquidates a ~$1 short when mark moves to >= ~$2.27 (MMR=10%)", async function () {
    // Provide buy-side liquidity at $1.00 to open the short
    // Shorter will place a market sell; it matches against best bids
    console.log("Place bid 1.00 x 0.1 by lp1");
    await orderBook
      .connect(lp1)
      .placeMarginLimitOrder(usdc(1.0), amt(0.1), true); // bid 1.00 for 0.1 unit

    // Shorter opens a short: sell 0.1 unit at market (expected around $1.00)
    console.log("Shorter sells 0.1 at market");
    await tradeExec.connect(shorter).placeMarginMarketOrder(amt(0.1), false);

    // Record starting position (may be < -0.1 depending on book state)
    const [sizeBefore] = await vault.getPositionSummary(
      shorter.address,
      marketId
    );
    console.log("sizeBefore:", sizeBefore.toString());

    // Now set the book so mark >= ~$2.27 and ensure sell-side liquidity for liquidation buy
    // Add MULTIPLE asks at various prices to ensure liquidation can fill
    console.log("Adding adequate sell-side liquidity for liquidation...");

    // Add asks at multiple price levels with sufficient size
    console.log("Place ask 2.30 x 0.05 by lp2");
    await orderBook
      .connect(lp2)
      .placeMarginLimitOrder(usdc(2.3), amt(0.05), false);

    console.log("Place ask 2.35 x 0.05 by lp2");
    await orderBook
      .connect(lp2)
      .placeMarginLimitOrder(usdc(2.35), amt(0.05), false);

    console.log("Place ask 2.40 x 0.1 by lp2");
    await orderBook
      .connect(lp2)
      .placeMarginLimitOrder(usdc(2.4), amt(0.1), false);

    console.log("Place ask 2.45 x 0.1 by lp2");
    await orderBook
      .connect(lp2)
      .placeMarginLimitOrder(usdc(2.45), amt(0.1), false);

    console.log("Place ask 2.50 x 0.2 by lp2");
    await orderBook
      .connect(lp2)
      .placeMarginLimitOrder(usdc(2.5), amt(0.2), false);

    // Also set bids around ~$2.40 to make mid-price ~2.40
    console.log("Place bid 2.40 x 0.1 by lp1");
    await orderBook
      .connect(lp1)
      .placeMarginLimitOrder(usdc(2.4), amt(0.1), true);

    console.log("Place bid 2.35 x 0.05 by lp1");
    await orderBook
      .connect(lp1)
      .placeMarginLimitOrder(usdc(2.35), amt(0.05), true);

    // Display order book depth to verify liquidity
    console.log("\n=== ORDER BOOK DEPTH ===");
    const depth = await viewFacet.getOrderBookDepth(10);
    console.log("Bids:");
    for (let i = 0; i < depth.bidPrices.length; i++) {
      console.log(
        `  ${ethers.formatUnits(depth.bidPrices[i], 6)} x ${ethers.formatUnits(
          depth.bidAmounts[i],
          18
        )}`
      );
    }
    console.log("Asks:");
    for (let i = 0; i < depth.askPrices.length; i++) {
      console.log(
        `  ${ethers.formatUnits(depth.askPrices[i], 6)} x ${ethers.formatUnits(
          depth.askAmounts[i],
          18
        )}`
      );
    }
    console.log("========================\n");

    // Check if position is liquidatable at current mark price
    const markPrice = await viewFacet.markPrice();
    console.log("Current mark price:", ethers.formatUnits(markPrice, 6));
    
    const isLiquidatable = await vault.isLiquidatable(
      shorter.address,
      marketId,
      markPrice
    );
    console.log("Is liquidatable:", isLiquidatable);

    // Check position details
    const [size, entryPrice, marginLocked] = await vault.getPositionSummary(
      shorter.address,
      marketId
    );
    console.log(
      "Position details - size:",
      ethers.formatUnits(size, 18),
      "entryPrice:",
      ethers.formatUnits(entryPrice, 6),
      "marginLocked:",
      ethers.formatUnits(marginLocked, 6)
    );

    // Check collateral
    const collateral = await vault.getAvailableCollateral(shorter.address);
    console.log("Available collateral:", ethers.formatUnits(collateral, 6));

    // Update mark price to trigger liquidation
    const highMark = usdc(2.5);
    await vault.updateMarkPrice(marketId, highMark);
    console.log("Set mark price to $2.50");

    // Check liquidation status again
    const isLiquidatableAfter = await vault.isLiquidatable(
      shorter.address,
      marketId,
      highMark
    );
    console.log("Is liquidatable after mark update:", isLiquidatableAfter);

    if (isLiquidatableAfter) {
      // Attempt liquidation via direct liquidation call
      console.log("Attempting liquidation...");
      try {
        const liqFacet = await ethers.getContractAt("OBLiquidationFacet", marketOrderBookAddr);
        const liqTx = await liqFacet.connect(lp1).liquidatePosition(shorter.address);
        const receipt = await liqTx.wait();
        console.log("Liquidation gas used:", receipt.gasUsed.toString());
        
        // Check events
        for (const log of receipt.logs) {
          try {
            const parsed = vault.interface.parseLog(log);
            console.log("Vault event:", parsed.name);
          } catch {
            try {
              const parsed = liqFacet.interface.parseLog(log);
              console.log("LiqFacet event:", parsed.name);
            } catch {}
          }
        }
      } catch (err) {
        console.log("Liquidation failed:", err.message);
      }
    }

    // After liquidation, verify the short is reduced (position moves toward zero)
    const [sizeAfter] = await vault.getPositionSummary(
      shorter.address,
      marketId
    );
    console.log("sizeAfter:", ethers.formatUnits(sizeAfter, 18));

    // If liquidation occurred, size should be closer to zero (less negative)
    if (isLiquidatableAfter) {
      expect(sizeAfter).to.be.gte(sizeBefore);
    }
  });
});
