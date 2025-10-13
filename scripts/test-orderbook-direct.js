const { ethers } = require("ethers");

/**
 * Test the OrderBook contract directly to see if it's properly initialized
 */

const ORDERBOOK_ADDRESS = "0xce64ddf0c08325a41E8e94D01967E0ff00E1C926";
const ALUMINUM_MARKET_ID =
  "0x41e77fd5318a7e3c379ff8fe985be494211c1b2a0a0fa1fa2f99ac7d5060892a";

// Simple OrderBook ABI with just the essential functions
const ORDERBOOK_ABI = [
  "function getBestPrices() external view returns (uint256 bestBidPrice, uint256 bestAskPrice)",
  "function marketId() external view returns (bytes32)",
  "function symbol() external view returns (string)",
  "function isActive() external view returns (bool)",
  "function vaultRouter() external view returns (address)",
  "function admin() external view returns (address)",
  "function bestBid() external view returns (uint256)",
  "function bestAsk() external view returns (uint256)",
  // Try different function signatures
  "function getBestBid() external view returns (uint256)",
  "function getBestAsk() external view returns (uint256)",
];

async function main() {
  console.log("🔍 Testing OrderBook Contract Directly...\n");

  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");
  const orderBook = new ethers.Contract(
    ORDERBOOK_ADDRESS,
    ORDERBOOK_ABI,
    provider
  );

  // Test basic getters first
  console.log("📋 Step 1: Test Basic Contract State");

  const tests = [
    { name: "marketId()", fn: () => orderBook.marketId() },
    { name: "symbol()", fn: () => orderBook.symbol() },
    { name: "isActive()", fn: () => orderBook.isActive() },
    { name: "vaultRouter()", fn: () => orderBook.vaultRouter() },
    { name: "admin()", fn: () => orderBook.admin() },
    { name: "bestBid()", fn: () => orderBook.bestBid() },
    { name: "bestAsk()", fn: () => orderBook.bestAsk() },
    { name: "getBestBid()", fn: () => orderBook.getBestBid() },
    { name: "getBestAsk()", fn: () => orderBook.getBestAsk() },
    { name: "getBestPrices()", fn: () => orderBook.getBestPrices() },
  ];

  for (const test of tests) {
    try {
      const result = await test.fn();
      console.log(`   ✅ ${test.name} = ${result}`);
    } catch (err) {
      console.log(`   ❌ ${test.name} failed: ${err.message}`);
    }
  }

  // If getBestPrices fails, try to understand why
  console.log("\n📋 Step 2: Detailed Analysis");

  // Check if marketId matches what we expect
  try {
    const contractMarketId = await orderBook.marketId();
    console.log(`   Contract marketId: ${contractMarketId}`);
    console.log(`   Expected marketId: ${ALUMINUM_MARKET_ID}`);
    console.log(
      `   Match: ${contractMarketId === ALUMINUM_MARKET_ID ? "✅" : "❌"}`
    );
  } catch (err) {
    console.log(`   ❌ Could not get marketId: ${err.message}`);
  }

  // Try to call getBestPrices with explicit gas limit
  console.log("\n📋 Step 3: Try getBestPrices with Different Approaches");

  try {
    const result = await orderBook.getBestPrices({
      gasLimit: 100000, // Explicit gas limit
    });
    console.log(
      `   ✅ getBestPrices() with gas limit: [${result[0]}, ${result[1]}]`
    );
  } catch (err) {
    console.log(`   ❌ getBestPrices() with gas limit failed: ${err.message}`);
  }

  // Try static call
  try {
    const result = await orderBook.getBestPrices.staticCall();
    console.log(
      `   ✅ getBestPrices() static call: [${result[0]}, ${result[1]}]`
    );
  } catch (err) {
    console.log(`   ❌ getBestPrices() static call failed: ${err.message}`);
  }

  // Try to debug by calling the raw contract
  console.log("\n📋 Step 4: Raw Contract Call");
  try {
    // getBestPrices() function selector
    const selector = "0x60d29a85"; // first 4 bytes of keccak256("getBestPrices()")
    const result = await provider.call({
      to: ORDERBOOK_ADDRESS,
      data: selector,
    });
    console.log(`   ✅ Raw call successful: ${result}`);

    // Try to decode the result
    if (result !== "0x") {
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256", "uint256"],
        result
      );
      console.log(
        `   📊 Decoded prices: bestBid=${decoded[0]}, bestAsk=${decoded[1]}`
      );
    }
  } catch (err) {
    console.log(`   ❌ Raw call failed: ${err.message}`);
  }
}

main()
  .then(() => {
    console.log("\n✅ OrderBook direct test completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script error:", error);
    process.exit(1);
  });
