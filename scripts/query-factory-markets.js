const { ethers } = require("ethers");

/**
 * Script to query the HyperLiquid OrderBookFactoryMinimal contract
 * and find exactly what markets are registered and their symbols
 */

// Contract addresses from our deployment
const CONTRACTS = {
  tradingRouter: "0x58BC190eE9d66eE49Dc1eeeEd2aBc1284216c8e6",
  orderBookFactory: "0x0fB0A98DC0cA49B72A0BC972D78e8bda7ef2EABF",
  aluminumOrderBook: "0xce64ddf0c08325a41E8e94D01967E0ff00E1C926",
};

// ABIs
const TRADING_ROUTER_ABI = [
  "function factory() external view returns (address)",
];

const FACTORY_ABI = [
  "function getAllMarkets() external view returns (bytes32[])",
  "function getMarket(bytes32 marketId) external view returns (tuple(address orderBookAddress, string symbol, bool isActive, address creator))",
  "function getMarketBySymbol(string symbol) external view returns (bytes32)",
  "function symbolToMarketId(string symbol) external view returns (bytes32)",
  "function markets(bytes32 marketId) external view returns (tuple(address orderBookAddress, string symbol, bool isActive, address creator))",
  "function allMarketIds(uint256 index) external view returns (bytes32)",
  "function getTotalMarkets() external view returns (uint256)",
];

async function main() {
  console.log("🔍 Querying HyperLiquid Factory Contract...\n");

  // Setup provider for Polygon
  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");

  try {
    // 1. Verify TradingRouter's factory address
    console.log("📋 Step 1: Verify TradingRouter factory address");
    const tradingRouter = new ethers.Contract(
      CONTRACTS.tradingRouter,
      TRADING_ROUTER_ABI,
      provider
    );

    let factoryFromRouter;
    try {
      factoryFromRouter = await tradingRouter.factory();
      console.log(`   TradingRouter.factory(): ${factoryFromRouter}`);
      console.log(`   Expected factory:        ${CONTRACTS.orderBookFactory}`);
      console.log(
        `   Match: ${
          factoryFromRouter.toLowerCase() ===
          CONTRACTS.orderBookFactory.toLowerCase()
            ? "✅"
            : "❌"
        }`
      );
    } catch (err) {
      console.log(
        `   ❌ Error calling TradingRouter.factory(): ${err.message}`
      );
    }

    // 2. Query factory directly
    console.log("\n📋 Step 2: Query Factory Contract Directly");
    const factory = new ethers.Contract(
      CONTRACTS.orderBookFactory,
      FACTORY_ABI,
      provider
    );

    // Get total markets
    let totalMarkets;
    try {
      totalMarkets = await factory.getTotalMarkets();
      console.log(`   Total markets: ${totalMarkets}`);
    } catch (err) {
      console.log(`   ❌ Error getting total markets: ${err.message}`);
    }

    // Get all market IDs
    let allMarketIds = [];
    try {
      allMarketIds = await factory.getAllMarkets();
      console.log(`   Market IDs found: ${allMarketIds.length}`);

      for (let i = 0; i < allMarketIds.length; i++) {
        console.log(`   [${i}] ${allMarketIds[i]}`);
      }
    } catch (err) {
      console.log(`   ❌ Error getting all markets: ${err.message}`);
    }

    // 3. Query each market's details
    console.log("\n📋 Step 3: Query Market Details");
    for (let i = 0; i < allMarketIds.length; i++) {
      const marketId = allMarketIds[i];
      try {
        const marketInfo = await factory.getMarket(marketId);
        console.log(`\n   Market ${i + 1}:`);
        console.log(`     Market ID: ${marketId}`);
        console.log(`     OrderBook: ${marketInfo.orderBookAddress}`);
        console.log(`     Symbol: "${marketInfo.symbol}"`);
        console.log(`     Active: ${marketInfo.isActive}`);
        console.log(`     Creator: ${marketInfo.creator}`);

        // Check if this matches our known OrderBook
        if (
          marketInfo.orderBookAddress.toLowerCase() ===
          CONTRACTS.aluminumOrderBook.toLowerCase()
        ) {
          console.log(`     🎯 THIS IS THE ALUMINUM ORDERBOOK!`);
          console.log(`     🔑 Use symbol: "${marketInfo.symbol}"`);
        }
      } catch (err) {
        console.log(`     ❌ Error getting market ${i + 1}: ${err.message}`);
      }
    }

    // 4. Test specific symbol lookups
    console.log("\n📋 Step 4: Test Symbol Lookups");
    const testSymbols = [
      "Aluminum V1",
      "ALUMINUM_V1_HYPERLIQUID",
      "Aluminum V1_MARKET",
      "ALUMINUM_V1",
      "AluminumV1",
    ];

    for (const symbol of testSymbols) {
      try {
        const marketId = await factory.getMarketBySymbol(symbol);
        if (
          marketId !==
          "0x0000000000000000000000000000000000000000000000000000000000000000"
        ) {
          console.log(`   ✅ Symbol "${symbol}" → Market ID: ${marketId}`);
        } else {
          console.log(`   ❌ Symbol "${symbol}" → Not found`);
        }
      } catch (err) {
        console.log(`   ❌ Symbol "${symbol}" → Error: ${err.message}`);
      }
    }

    // 5. Direct mapping check
    console.log("\n📋 Step 5: Check Direct Symbol Mappings");
    for (const symbol of testSymbols) {
      try {
        const marketId = await factory.symbolToMarketId(symbol);
        if (
          marketId !==
          "0x0000000000000000000000000000000000000000000000000000000000000000"
        ) {
          console.log(`   ✅ symbolToMarketId["${symbol}"] = ${marketId}`);
        } else {
          console.log(`   ❌ symbolToMarketId["${symbol}"] = null/zero`);
        }
      } catch (err) {
        console.log(
          `   ❌ symbolToMarketId["${symbol}"] → Error: ${err.message}`
        );
      }
    }

    // 6. Calculate expected market ID for Aluminum V1
    console.log("\n📋 Step 6: Calculate Expected Market IDs");
    for (const symbol of testSymbols) {
      const expectedMarketId = ethers.keccak256(
        ethers.toUtf8Bytes(symbol + "_MARKET")
      );
      console.log(`   "${symbol}" + "_MARKET" → ${expectedMarketId}`);

      // Check if this exists in our found market IDs
      if (allMarketIds.includes(expectedMarketId)) {
        console.log(`     🎯 FOUND IN REGISTRY!`);
      }
    }
  } catch (error) {
    console.error("❌ Script failed:", error.message);
    console.error(error);
  }
}

main()
  .then(() => {
    console.log("\n✅ Factory query completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script error:", error);
    process.exit(1);
  });
