const { ethers } = require("hardhat");
const config = require("../config/contracts.js");

async function main() {
  console.log("\n🔍 MARGIN VERIFICATION TEST\n");
  
  await config.getContract.refreshAddresses();

  const positionManagerAddr = config.getAddress("POSITION_MANAGER");
  const CoreVault = await ethers.getContractFactory("CoreVault", {
    libraries: { PositionManager: positionManagerAddr }
  });
  const vault = CoreVault.attach(config.getAddress("CORE_VAULT"));
  
  const orderBook = await ethers.getContractAt("OBOrderPlacementFacet", config.getAddress("ALUMINUM_ORDERBOOK"));
  const viewFacet = await ethers.getContractAt("OBViewFacet", config.getAddress("ALUMINUM_ORDERBOOK"));
  const mockUSDC = await ethers.getContractAt("MockUSDC", config.getAddress("MOCK_USDC"));

  const signers = await ethers.getSigners();
  const testUser = signers[10]; // Use a fresh account

  console.log("Test user:", testUser.address);

  // Fund test user
  await mockUSDC.mint(testUser.address, ethers.parseUnits("10000", 6));
  await mockUSDC.connect(testUser).approve(await vault.getAddress(), ethers.parseUnits("10000", 6));
  await vault.connect(testUser).depositCollateral(ethers.parseUnits("5000", 6));
  console.log("✅ Funded test user with 5000 USDC collateral\n");

  // Check order book state
  const bestBid = await viewFacet.bestBid();
  const bestAsk = await viewFacet.bestAsk();
  console.log("Order book state (fresh deployment - should be empty):");
  console.log("  Best bid:", bestBid > 0 ? ethers.formatUnits(bestBid, 6) : "none");
  console.log("  Best ask:", bestAsk > 0 ? ethers.formatUnits(bestAsk, 6) : "none");

  // Check initial state
  const reservedBefore = await vault.userTotalMarginReserved(testUser.address);
  const lockedBefore = await vault.userTotalMarginLocked(testUser.address);
  console.log("\nInitial state:");
  console.log("  Margin reserved:", ethers.formatUnits(reservedBefore, 6), "USDC");
  console.log("  Margin locked:", ethers.formatUnits(lockedBefore, 6), "USDC");

  // ============ TEST 1: LONG ORDER ============
  // Place a LONG order: 1 unit @ $100 = $100 notional
  // Expected margin = 100% of notional = $100
  const longPrice = ethers.parseUnits("100", 6);
  const amount = ethers.parseUnits("1", 18);
  
  console.log("\n📈 TEST 1: LONG Limit Order");
  console.log("   Order: 1 unit @ $100 = $100 notional");
  console.log("   Expected margin: $100 (100% of notional)");
  
  await orderBook.connect(testUser).placeMarginLimitOrder(longPrice, amount, true);

  const reservedAfterLong = await vault.userTotalMarginReserved(testUser.address);
  const longMargin = reservedAfterLong - reservedBefore;
  console.log("   Actual margin reserved:", ethers.formatUnits(longMargin, 6), "USDC");
  const longCorrect = longMargin === ethers.parseUnits("100", 6);
  console.log("   Result:", longCorrect ? "✅ CORRECT" : `⚠️ DIFFERENT (expected 100, got ${ethers.formatUnits(longMargin, 6)})`);

  // ============ TEST 2: SHORT ORDER ============
  // Place a SHORT order: 1 unit @ $200 = $200 notional
  // Expected margin = 150% of notional = $300
  const shortPrice = ethers.parseUnits("200", 6);
  
  console.log("\n📉 TEST 2: SHORT Limit Order");
  console.log("   Order: 1 unit @ $200 = $200 notional");
  console.log("   Expected margin: $300 (150% of notional)");
  
  await orderBook.connect(testUser).placeMarginLimitOrder(shortPrice, amount, false);

  const reservedAfterShort = await vault.userTotalMarginReserved(testUser.address);
  const shortMargin = reservedAfterShort - reservedAfterLong;
  console.log("   Actual margin reserved:", ethers.formatUnits(shortMargin, 6), "USDC");
  const shortCorrect = shortMargin === ethers.parseUnits("300", 6);
  console.log("   Result:", shortCorrect ? "✅ CORRECT" : `⚠️ DIFFERENT (expected 300, got ${ethers.formatUnits(shortMargin, 6)})`);

  // ============ SUMMARY ============
  console.log("\n════════════════════════════════════════");
  console.log("            MARGIN VERIFICATION          ");
  console.log("════════════════════════════════════════");
  console.log("Long order (100% margin):", longCorrect ? "✅ PASS" : "❌ FAIL");
  console.log("Short order (150% margin):", shortCorrect ? "✅ PASS" : "❌ FAIL");
  console.log("────────────────────────────────────────");
  console.log("Total reserved:", ethers.formatUnits(reservedAfterShort, 6), "USDC");
  console.log("Expected total: 400.0 USDC ($100 + $300)");
  console.log("────────────────────────────────────────");
  
  // Verify O(1) cache is correct
  console.log("\nO(1) Cache Verification:");
  console.log("  userTotalMarginReserved:", ethers.formatUnits(reservedAfterShort, 6), "USDC");
  
  if (longCorrect && shortCorrect) {
    console.log("\n✅ ALL MARGIN CALCULATIONS ARE CORRECT");
    console.log("   - Long orders reserve 100% of notional value");
    console.log("   - Short orders reserve 150% of notional value");
    console.log("   - O(1) cache (userTotalMarginReserved) is correctly updated");
  } else {
    console.log("\n⚠️ SOME MARGIN CALCULATIONS DIFFER");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
