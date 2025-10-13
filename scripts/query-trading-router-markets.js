const { ethers } = require("ethers");

/**
 * Script to query the TradingRouter contract and see what markets it knows about
 * and diagnose why getMultiMarketPrices is failing
 */

// Contract addresses
const CONTRACTS = {
  tradingRouter: "0x58BC190eE9d66eE49Dc1eeeEd2aBc1284216c8e6",
  orderBookFactory: "0x0fB0A98DC0cA49B72A0BC972D78e8bda7ef2EABF",
  aluminumOrderBook: "0xce64ddf0c08325a41E8e94D01967E0ff00E1C926",
};

// Known market ID from our factory query
const ALUMINUM_MARKET_ID =
  "0x41e77fd5318a7e3c379ff8fe985be494211c1b2a0a0fa1fa2f99ac7d5060892a";

// TradingRouter ABI - focusing on market-related functions
const TRADING_ROUTER_ABI = [
  "function factory() external view returns (address)",
  "function getMultiMarketPrices(bytes32[] marketIds) external view returns (uint256[] bestBids, uint256[] bestAsks)",
  "function markets(bytes32 marketId) external view returns (address)",
  "function isMarketActive(bytes32 marketId) external view returns (bool)",
  "function getAllActiveMarkets() external view returns (bytes32[])",
  "function getMarketOrderBook(bytes32 marketId) external view returns (address)",
  // Add some common functions that might exist
  "function isPaused() external view returns (bool)",
  "function owner() external view returns (address)",
];

// OrderBook ABI to test the OrderBook directly
const ORDERBOOK_ABI = [
  "function symbol() external view returns (string)",
  "function isActive() external view returns (bool)",
  "function getBestBid() external view returns (uint256)",
  "function getBestAsk() external view returns (uint256)",
  "function getOrderBookDepth() external view returns (uint256[] bidPrices, uint256[] bidSizes, uint256[] askPrices, uint256[] askSizes)",
];

async function main() {
  console.log("🔍 Diagnosing TradingRouter Market Registration...\n");

  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");

  try {
    // 1. Test TradingRouter basic functions
    console.log("📋 Step 1: Test TradingRouter Basic Functions");
    const tradingRouter = new ethers.Contract(
      CONTRACTS.tradingRouter,
      TRADING_ROUTER_ABI,
      provider
    );

    // Check if paused
    try {
      const isPaused = await tradingRouter.isPaused();
      console.log(`   isPaused(): ${isPaused}`);
    } catch (err) {
      console.log(`   ❌ isPaused() failed: ${err.message}`);
    }

    // Check factory
    try {
      const factory = await tradingRouter.factory();
      console.log(`   factory(): ${factory}`);
    } catch (err) {
      console.log(`   ❌ factory() failed: ${err.message}`);
    }

    // 2. Test market lookup functions
    console.log("\n📋 Step 2: Test Market Lookup Functions");

    // Try markets mapping
    try {
      const marketAddress = await tradingRouter.markets(ALUMINUM_MARKET_ID);
      console.log(`   markets[${ALUMINUM_MARKET_ID}] = ${marketAddress}`);
      if (marketAddress === "0x0000000000000000000000000000000000000000") {
        console.log("   ❌ Market not found in TradingRouter.markets mapping!");
      } else {
        console.log("   ✅ Market found in TradingRouter.markets mapping");
      }
    } catch (err) {
      console.log(`   ❌ markets() failed: ${err.message}`);
    }

    // Try isMarketActive
    try {
      const isActive = await tradingRouter.isMarketActive(ALUMINUM_MARKET_ID);
      console.log(`   isMarketActive(${ALUMINUM_MARKET_ID}) = ${isActive}`);
    } catch (err) {
      console.log(`   ❌ isMarketActive() failed: ${err.message}`);
    }

    // Try getMarketOrderBook
    try {
      const orderBookAddr = await tradingRouter.getMarketOrderBook(
        ALUMINUM_MARKET_ID
      );
      console.log(
        `   getMarketOrderBook(${ALUMINUM_MARKET_ID}) = ${orderBookAddr}`
      );
    } catch (err) {
      console.log(`   ❌ getMarketOrderBook() failed: ${err.message}`);
    }

    // Try getAllActiveMarkets
    try {
      const activeMarkets = await tradingRouter.getAllActiveMarkets();
      console.log(
        `   getAllActiveMarkets() = [${activeMarkets.length} markets]`
      );
      activeMarkets.forEach((marketId, i) => {
        console.log(`     [${i}] ${marketId}`);
      });

      if (activeMarkets.includes(ALUMINUM_MARKET_ID)) {
        console.log("   ✅ Aluminum market found in active markets!");
      } else {
        console.log("   ❌ Aluminum market NOT in active markets list");
      }
    } catch (err) {
      console.log(`   ❌ getAllActiveMarkets() failed: ${err.message}`);
    }

    // 3. Test the failing function directly
    console.log("\n📋 Step 3: Test getMultiMarketPrices Directly");
    try {
      console.log(
        `   Calling getMultiMarketPrices([${ALUMINUM_MARKET_ID}])...`
      );
      const result = await tradingRouter.getMultiMarketPrices([
        ALUMINUM_MARKET_ID,
      ]);
      console.log("   ✅ getMultiMarketPrices succeeded!");
      console.log(`   bestBids: [${result[0]}]`);
      console.log(`   bestAsks: [${result[1]}]`);
    } catch (err) {
      console.log(`   ❌ getMultiMarketPrices failed: ${err.message}`);
      console.log(`   ❌ Error code: ${err.code}`);
      console.log(`   ❌ This confirms the issue!`);
    }

    // 4. Test OrderBook directly
    console.log("\n📋 Step 4: Test OrderBook Contract Directly");
    const orderBook = new ethers.Contract(
      CONTRACTS.aluminumOrderBook,
      ORDERBOOK_ABI,
      provider
    );

    try {
      const symbol = await orderBook.symbol();
      console.log(`   OrderBook.symbol(): "${symbol}"`);
    } catch (err) {
      console.log(`   ❌ OrderBook.symbol() failed: ${err.message}`);
    }

    try {
      const isActive = await orderBook.isActive();
      console.log(`   OrderBook.isActive(): ${isActive}`);
    } catch (err) {
      console.log(`   ❌ OrderBook.isActive() failed: ${err.message}`);
    }

    try {
      const bestBid = await orderBook.getBestBid();
      console.log(`   OrderBook.getBestBid(): ${bestBid}`);
    } catch (err) {
      console.log(`   ❌ OrderBook.getBestBid() failed: ${err.message}`);
    }

    try {
      const bestAsk = await orderBook.getBestAsk();
      console.log(`   OrderBook.getBestAsk(): ${bestAsk}`);
    } catch (err) {
      console.log(`   ❌ OrderBook.getBestAsk() failed: ${err.message}`);
    }

    // 5. Check if we need to register the market with TradingRouter
    console.log("\n📋 Step 5: Diagnosis Summary");
    console.log("   Based on the test results:");
    console.log(
      "   1. If markets() returns 0x0000... → Market not registered in TradingRouter"
    );
    console.log(
      "   2. If OrderBook functions work → OrderBook is deployed correctly"
    );
    console.log(
      "   3. If getMultiMarketPrices fails → TradingRouter doesn't know about this market"
    );
    console.log(
      "\n   🔧 LIKELY SOLUTION: Register the market with TradingRouter"
    );
  } catch (error) {
    console.error("❌ Script failed:", error.message);
    console.error(error);
  }
}

main()
  .then(() => {
    console.log("\n✅ TradingRouter diagnosis completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script error:", error);
    process.exit(1);
  });
