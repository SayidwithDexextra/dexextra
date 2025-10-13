const { ethers } = require("ethers");

/**
 * Check if the TradingRouter is properly integrated with the existing contracts
 * and has all necessary permissions
 */

const CONTRACTS = {
  tradingRouter: "0x58BC190eE9d66eE49Dc1eeeEd2aBc1284216c8e6",
  orderBookFactory: "0x0fB0A98DC0cA49B72A0BC972D78e8bda7ef2EABF",
  vaultRouter: "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5",
  aluminumOrderBook: "0xce64ddf0c08325a41E8e94D01967E0ff00E1C926",
};

const ALUMINUM_MARKET_ID =
  "0x41e77fd5318a7e3c379ff8fe985be494211c1b2a0a0fa1fa2f99ac7d5060892a";

// Comprehensive ABIs
const TRADING_ROUTER_ABI = [
  "function factory() external view returns (address)",
  "function vaultRouter() external view returns (address)",
  "function isPaused() external view returns (bool)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() external view returns (bytes32)",
];

const FACTORY_ABI = [
  "function getMarket(bytes32 marketId) external view returns (tuple(address orderBookAddress, string symbol, bool isActive, address creator))",
];

const VAULT_ROUTER_ABI = [
  "function isMarketAuthorized(bytes32 marketId) external view returns (bool)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function ORDERBOOK_ROLE() external view returns (bytes32)",
];

const ORDERBOOK_ABI = [
  "function vaultRouter() external view returns (address)",
  "function marketId() external view returns (bytes32)",
  "function symbol() external view returns (string)",
  "function isActive() external view returns (bool)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function TRADER_ROLE() external view returns (bytes32)",
];

async function main() {
  console.log("🔍 Checking TradingRouter Integration...\n");

  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");

  // 1. Check TradingRouter configuration
  console.log("📋 Step 1: Check TradingRouter Configuration");
  const tradingRouter = new ethers.Contract(
    CONTRACTS.tradingRouter,
    TRADING_ROUTER_ABI,
    provider
  );

  try {
    const factoryAddr = await tradingRouter.factory();
    console.log(`   factory(): ${factoryAddr}`);
    console.log(`   Expected:  ${CONTRACTS.orderBookFactory}`);
    console.log(
      `   Match: ${
        factoryAddr.toLowerCase() === CONTRACTS.orderBookFactory.toLowerCase()
          ? "✅"
          : "❌"
      }`
    );
  } catch (err) {
    console.log(`   ❌ factory() failed: ${err.message}`);
  }

  try {
    const vaultAddr = await tradingRouter.vaultRouter();
    console.log(`   vaultRouter(): ${vaultAddr}`);
    console.log(`   Expected:      ${CONTRACTS.vaultRouter}`);
    console.log(
      `   Match: ${
        vaultAddr.toLowerCase() === CONTRACTS.vaultRouter.toLowerCase()
          ? "✅"
          : "❌"
      }`
    );
  } catch (err) {
    console.log(`   ❌ vaultRouter() failed: ${err.message}`);
  }

  try {
    const isPaused = await tradingRouter.isPaused();
    console.log(`   isPaused(): ${isPaused}`);
  } catch (err) {
    console.log(`   ❌ isPaused() failed: ${err.message}`);
  }

  // 2. Check Factory's market info
  console.log("\n📋 Step 2: Check Factory Market Info");
  const factory = new ethers.Contract(
    CONTRACTS.orderBookFactory,
    FACTORY_ABI,
    provider
  );

  try {
    const marketInfo = await factory.getMarket(ALUMINUM_MARKET_ID);
    console.log(`   Market Info:`);
    console.log(`     OrderBook: ${marketInfo.orderBookAddress}`);
    console.log(`     Symbol: "${marketInfo.symbol}"`);
    console.log(`     Active: ${marketInfo.isActive}`);
    console.log(`     Creator: ${marketInfo.creator}`);

    if (
      marketInfo.orderBookAddress.toLowerCase() ===
      CONTRACTS.aluminumOrderBook.toLowerCase()
    ) {
      console.log(`   ✅ OrderBook address matches our known contract`);
    } else {
      console.log(`   ❌ OrderBook address mismatch!`);
    }
  } catch (err) {
    console.log(`   ❌ getMarket() failed: ${err.message}`);
  }

  // 3. Check VaultRouter permissions
  console.log("\n📋 Step 3: Check VaultRouter Permissions");
  const vaultRouter = new ethers.Contract(
    CONTRACTS.vaultRouter,
    VAULT_ROUTER_ABI,
    provider
  );

  try {
    const isAuthorized = await vaultRouter.isMarketAuthorized(
      ALUMINUM_MARKET_ID
    );
    console.log(
      `   isMarketAuthorized(${ALUMINUM_MARKET_ID}): ${isAuthorized}`
    );
  } catch (err) {
    console.log(`   ❌ isMarketAuthorized() failed: ${err.message}`);
  }

  try {
    const orderbookRole = await vaultRouter.ORDERBOOK_ROLE();
    console.log(`   ORDERBOOK_ROLE: ${orderbookRole}`);

    const hasRole = await vaultRouter.hasRole(
      orderbookRole,
      CONTRACTS.aluminumOrderBook
    );
    console.log(`   OrderBook has ORDERBOOK_ROLE: ${hasRole}`);
  } catch (err) {
    console.log(`   ❌ ORDERBOOK_ROLE check failed: ${err.message}`);
  }

  // 4. Check OrderBook configuration
  console.log("\n📋 Step 4: Check OrderBook Configuration");
  const orderBook = new ethers.Contract(
    CONTRACTS.aluminumOrderBook,
    ORDERBOOK_ABI,
    provider
  );

  try {
    const vaultAddr = await orderBook.vaultRouter();
    console.log(`   OrderBook.vaultRouter(): ${vaultAddr}`);
    console.log(`   Expected:                ${CONTRACTS.vaultRouter}`);
    console.log(
      `   Match: ${
        vaultAddr.toLowerCase() === CONTRACTS.vaultRouter.toLowerCase()
          ? "✅"
          : "❌"
      }`
    );
  } catch (err) {
    console.log(`   ❌ OrderBook.vaultRouter() failed: ${err.message}`);
  }

  // 5. Test the actual failing path
  console.log(
    "\n📋 Step 5: Test the Failing Path (TradingRouter._getOrderBook)"
  );

  // This simulates what TradingRouter._getOrderBook() does internally
  try {
    console.log(
      `   Simulating TradingRouter._getOrderBook(${ALUMINUM_MARKET_ID})`
    );

    // Step 1: Get market info from factory
    const marketInfo = await factory.getMarket(ALUMINUM_MARKET_ID);
    console.log(`   ✅ factory.getMarket() succeeded`);
    console.log(`      orderBookAddress: ${marketInfo.orderBookAddress}`);
    console.log(`      isActive: ${marketInfo.isActive}`);

    // Step 2: Check if orderBookAddress is not zero
    if (
      marketInfo.orderBookAddress ===
      "0x0000000000000000000000000000000000000000"
    ) {
      console.log(`   ❌ FAIL: orderBookAddress is zero`);
      return;
    }
    console.log(`   ✅ orderBookAddress is valid`);

    // Step 3: Check if market is active
    if (!marketInfo.isActive) {
      console.log(`   ❌ FAIL: market is not active`);
      return;
    }
    console.log(`   ✅ market is active`);

    // Step 4: Try to call getBestPrices on the OrderBook
    const orderBookForTest = new ethers.Contract(
      marketInfo.orderBookAddress,
      ["function getBestPrices() external view returns (uint256, uint256)"],
      provider
    );
    const prices = await orderBookForTest.getBestPrices();
    console.log(
      `   ✅ OrderBook.getBestPrices() succeeded: [${prices[0]}, ${prices[1]}]`
    );

    console.log(`\n   🎉 SUCCESS: The full _getOrderBook() path works!`);
    console.log(`   🤔 The issue might be elsewhere...`);
  } catch (err) {
    console.log(`   ❌ Simulation failed: ${err.message}`);
    console.log(`   💡 This is where the real issue is!`);
  }

  console.log("\n📋 Summary:");
  console.log(
    "   If all components check out but getMultiMarketPrices still fails,"
  );
  console.log("   the issue might be:");
  console.log("   1. A permission missing between contracts");
  console.log("   2. A modifier like 'whenNotPaused' that's failing");
  console.log("   3. A gas limit issue");
  console.log("   4. An ABI mismatch in the frontend");
}

main()
  .then(() => {
    console.log("\n✅ TradingRouter integration check completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script error:", error);
    process.exit(1);
  });
