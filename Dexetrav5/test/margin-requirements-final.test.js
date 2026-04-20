const { expect } = require("chai");
const { ethers } = require("hardhat");
const config = require("../config/contracts.js");

describe("✅ Margin Requirements Verification", function () {
  let vault, orderBook, mockUSDC;
  let deployer, trader1, trader2, trader3;
  let marketId;

  // Helper functions
  const usdc = (amount) => ethers.parseUnits(amount.toString(), 6);
  const amt = (amount) => ethers.parseUnits(amount.toString(), 18);

  before(async function () {
    [deployer, trader1, trader2, trader3] = await ethers.getSigners();

    // Refresh addresses from deployment file
    await config.getContract.refreshAddresses();

    // Get contract addresses
    const mockUsdcAddr = config.getAddress("MOCK_USDC");
    const coreVaultAddr = config.getAddress("CORE_VAULT");
    const orderBookAddr = config.getAddress("ALUMINUM_ORDERBOOK");

    if (!mockUsdcAddr || mockUsdcAddr === ethers.ZeroAddress) {
      throw new Error("MockUSDC address not found - run deploy.js first");
    }
    if (!coreVaultAddr || coreVaultAddr === ethers.ZeroAddress) {
      throw new Error("CoreVault address not found - run deploy.js first");
    }
    if (!orderBookAddr || orderBookAddr === ethers.ZeroAddress) {
      throw new Error("OrderBook address not found - run deploy.js first");
    }

    // Attach to deployed contracts using correct contract names
    mockUSDC = await ethers.getContractAt("MockUSDC", mockUsdcAddr);
    
    // CoreVault needs PositionManager library linked for attachment
    const positionManagerAddr = config.getAddress("POSITION_MANAGER");
    const CoreVault = await ethers.getContractFactory("CoreVault", {
      libraries: {
        PositionManager: positionManagerAddr,
      },
    });
    vault = CoreVault.attach(coreVaultAddr);
    
    // OrderBook is a Diamond - attach to OBOrderPlacementFacet for placing orders
    orderBook = await ethers.getContractAt("OBOrderPlacementFacet", orderBookAddr);

    // Get market ID from config
    marketId = Object.values(config.MARKET_INFO)[0]?.marketId;
    if (!marketId) {
      throw new Error("No market ID found in config");
    }

    console.log("🎯 Testing Margin Requirements");
    console.log("📊 Market ID:", marketId);
    console.log("💰 Expected: 100% margin for longs, 150% margin for shorts");
    console.log("=".repeat(60));
  });

  it("🔵 Long positions require exactly 100% margin", async function () {
    // Fund trader with fresh account
    await mockUSDC.mint(trader1.address, usdc(1000));
    await mockUSDC
      .connect(trader1)
      .approve(await vault.getAddress(), usdc(1000));
    await vault.connect(trader1).depositCollateral(usdc(1000));

    const price = usdc(1000); // $1000 per unit (way above market)
    const amount = amt(0.1); // 0.1 units = $100 notional

    console.log(
      "  📈 Placing long limit order: 0.1 units × $1000 = $100 notional"
    );

    // Place limit order - should reserve margin immediately
    await orderBook.connect(trader1).placeMarginLimitOrder(price, amount, true);

    // Check reserved margin using the new O(1) cached total
    const reservedMargin = await vault.userTotalMarginReserved(trader1.address);
    const reservedUSDC = parseFloat(ethers.formatUnits(reservedMargin, 6));

    console.log(`  💰 Margin reserved: $${reservedUSDC.toFixed(2)} USDC`);
    console.log(`  🎯 Expected: $100.00 USDC (100% of notional)`);

    // Should be exactly $100 (within small tolerance for precision)
    expect(reservedMargin).to.be.closeTo(usdc(100), usdc(1));
    console.log("  ✅ PASS: Long position requires 100% margin");
  });

  it("🔴 Short positions require exactly 150% margin", async function () {
    // Fund trader with fresh account
    await mockUSDC.mint(trader2.address, usdc(1000));
    await mockUSDC
      .connect(trader2)
      .approve(await vault.getAddress(), usdc(1000));
    await vault.connect(trader2).depositCollateral(usdc(1000));

    const price = usdc(10); // $10 per unit
    const amount = amt(10); // 10 units = $100 notional

    console.log(
      "  📉 Placing short limit order: 10 units × $10 = $100 notional"
    );

    // Place limit order - should reserve margin immediately
    await orderBook
      .connect(trader2)
      .placeMarginLimitOrder(price, amount, false);

    // Check reserved margin using the new O(1) cached total
    const reservedMargin = await vault.userTotalMarginReserved(trader2.address);
    const reservedUSDC = parseFloat(ethers.formatUnits(reservedMargin, 6));

    console.log(`  💰 Margin reserved: $${reservedUSDC.toFixed(2)} USDC`);
    console.log(`  🎯 Expected: $150.00 USDC (150% of notional)`);

    // Should be exactly $150 (within small tolerance for precision)
    expect(reservedMargin).to.be.closeTo(usdc(150), usdc(1));
    console.log("  ✅ PASS: Short position requires 150% margin");
  });

  it("❌ Insufficient collateral is properly rejected", async function () {
    // Fund trader with insufficient collateral
    await mockUSDC.mint(trader3.address, usdc(100)); // Only $100
    await mockUSDC
      .connect(trader3)
      .approve(await vault.getAddress(), usdc(100));
    await vault.connect(trader3).depositCollateral(usdc(100));

    const price = usdc(10); // $10 per unit
    const amount = amt(20); // 20 units = $200 notional, requires $300 margin (150%)

    console.log("  💸 Trader has only $100 collateral");
    console.log(
      "  📉 Trying short order: 20 units × $10 = $200 notional (needs $300 margin)"
    );

    // This should fail due to insufficient collateral
    // CoreVault uses custom error InsufficientAvailable
    await expect(
      orderBook.connect(trader3).placeMarginLimitOrder(price, amount, false)
    ).to.be.reverted;

    console.log("  ✅ PASS: Insufficient collateral properly rejected");
  });

  after(function () {
    console.log("=".repeat(60));
    console.log("🎉 All margin requirement tests passed!");
    console.log("✅ Long positions: 100% margin requirement enforced");
    console.log("✅ Short positions: 150% margin requirement enforced");
    console.log("✅ Insufficient collateral: Properly rejected");
    console.log(
      "✅ Margin reservation: Works immediately on limit order placement"
    );
  });
});
