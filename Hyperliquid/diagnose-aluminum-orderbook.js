/**
 * Diagnostic script for investigating "invalid buy order status" error
 * on Aluminum OrderBook (0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE)
 */

const { ethers } = require("hardhat");

// Contract configuration
const ALUMINUM_ORDERBOOK = "0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE";

const ORDERBOOK_ABI = [
  // Order retrieval functions
  "function orders(bytes32 orderId) external view returns (bytes32 orderId, address user, uint8 orderType, uint8 side, uint256 size, uint256 price, uint256 filled, uint256 timestamp, uint8 status, uint256 marginReserved, bytes32 nextOrder, bytes32 prevOrder)",

  // Price tree functions
  "function buyPriceTree(uint256 price) external view returns (uint256 price, uint8 color, bytes32 parent, bytes32 left, bytes32 right, bytes32 firstOrder, bytes32 lastOrder, uint256 totalSize, uint256 orderCount)",
  "function sellPriceTree(uint256 price) external view returns (uint256 price, uint8 color, bytes32 parent, bytes32 left, bytes32 right, bytes32 firstOrder, bytes32 lastOrder, uint256 totalSize, uint256 orderCount)",

  // Best price getters
  "function bestBid() external view returns (uint256)",
  "function bestAsk() external view returns (uint256)",

  // Market info
  "function market() external view returns (bytes32 marketId, string symbol, string metricId, bool isCustomMetric, bool isActive, uint256 createdAt, address creator, uint256 settlementDate, uint256 tradingEndDate)",

  // Statistics
  "function getMarketStats() external view returns (uint256 volume24h, uint256 openInterest, uint256 totalTrades, uint256 lastTradePrice, uint256 priceChange24h)",
];

async function main() {
  console.log("🔍 Diagnosing Aluminum OrderBook State...");
  console.log(`📋 Contract Address: ${ALUMINUM_ORDERBOOK}`);

  const [signer] = await ethers.getSigners();
  const orderBook = new ethers.Contract(
    ALUMINUM_ORDERBOOK,
    ORDERBOOK_ABI,
    signer
  );

  try {
    // 1. Check market info
    console.log("\n📊 Market Information:");
    const marketInfo = await orderBook.market();
    console.log(`  Market ID: ${marketInfo.marketId}`);
    console.log(`  Symbol: ${marketInfo.symbol}`);
    console.log(`  Metric ID: ${marketInfo.metricId}`);
    console.log(`  Is Active: ${marketInfo.isActive}`);
    console.log(
      `  Settlement Date: ${new Date(
        marketInfo.settlementDate * 1000
      ).toISOString()}`
    );
    console.log(
      `  Trading End Date: ${new Date(
        marketInfo.tradingEndDate * 1000
      ).toISOString()}`
    );

    // 2. Check best bid/ask
    console.log("\n💰 Current Best Prices:");
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    console.log(`  Best Bid: ${ethers.utils.formatEther(bestBid)} ETH`);
    console.log(`  Best Ask: ${ethers.utils.formatEther(bestAsk)} ETH`);

    // 3. Check market stats
    console.log("\n📈 Market Statistics:");
    const stats = await orderBook.getMarketStats();
    console.log(
      `  24h Volume: ${ethers.utils.formatEther(stats.volume24h)} ETH`
    );
    console.log(
      `  Open Interest: ${ethers.utils.formatEther(stats.openInterest)} ETH`
    );
    console.log(`  Total Trades: ${stats.totalTrades.toString()}`);
    console.log(
      `  Last Trade Price: ${ethers.utils.formatEther(
        stats.lastTradePrice
      )} ETH`
    );

    // 4. Investigate best bid orders (where the error occurs)
    if (bestBid.gt(0)) {
      console.log("\n🔍 Investigating Best Bid Price Level:");
      console.log(
        `  Checking price level: ${ethers.utils.formatEther(bestBid)} ETH`
      );

      const bidNode = await orderBook.buyPriceTree(bestBid);
      console.log(`  Order Count: ${bidNode.orderCount.toString()}`);
      console.log(
        `  Total Size: ${ethers.utils.formatEther(bidNode.totalSize)} ETH`
      );
      console.log(`  First Order ID: ${bidNode.firstOrder}`);
      console.log(`  Last Order ID: ${bidNode.lastOrder}`);

      // Check the first order in the linked list
      if (bidNode.firstOrder !== ethers.constants.HashZero) {
        console.log("\n🔍 Checking First Buy Order:");
        const firstOrder = await orderBook.orders(bidNode.firstOrder);
        console.log(`  Order ID: ${firstOrder.orderId}`);
        console.log(`  User: ${firstOrder.user}`);
        console.log(`  Side: ${firstOrder.side} (0=BUY, 1=SELL)`);
        console.log(
          `  Status: ${firstOrder.status} (0=PENDING, 1=FILLED, 2=CANCELLED, 3=PARTIAL)`
        );
        console.log(`  Size: ${ethers.utils.formatEther(firstOrder.size)} ETH`);
        console.log(
          `  Filled: ${ethers.utils.formatEther(firstOrder.filled)} ETH`
        );
        console.log(
          `  Price: ${ethers.utils.formatEther(firstOrder.price)} ETH`
        );
        console.log(`  Next Order: ${firstOrder.nextOrder}`);

        // 🚨 THIS IS THE KEY CHECK - Invalid status detection
        if (firstOrder.status !== 0 && firstOrder.status !== 3) {
          // Not PENDING (0) or PARTIAL (3)
          console.log(`\n❌ FOUND INVALID ORDER STATUS!`);
          console.log(
            `   Order ${firstOrder.orderId} has status ${firstOrder.status}`
          );
          console.log(
            `   This order should have been removed from the linked list!`
          );
          console.log(
            `   Valid statuses for matching: PENDING (0) or PARTIAL (3)`
          );
          console.log(
            `   Current status: ${
              firstOrder.status === 1
                ? "FILLED"
                : firstOrder.status === 2
                ? "CANCELLED"
                : "UNKNOWN"
            }`
          );

          // Check if there are more orders in the chain
          let nextOrderId = firstOrder.nextOrder;
          let orderCount = 1;
          while (nextOrderId !== ethers.constants.HashZero && orderCount < 10) {
            const nextOrder = await orderBook.orders(nextOrderId);
            orderCount++;
            console.log(`\n   Next Order ${orderCount}: ${nextOrder.orderId}`);
            console.log(
              `     Status: ${nextOrder.status} (${
                nextOrder.status === 1
                  ? "FILLED"
                  : nextOrder.status === 2
                  ? "CANCELLED"
                  : nextOrder.status === 0
                  ? "PENDING"
                  : nextOrder.status === 3
                  ? "PARTIAL"
                  : "UNKNOWN"
              })`
            );
            console.log(
              `     Size: ${ethers.utils.formatEther(
                nextOrder.size
              )} / Filled: ${ethers.utils.formatEther(nextOrder.filled)}`
            );

            if (nextOrder.status !== 0 && nextOrder.status !== 3) {
              console.log(`     ❌ This order also has invalid status!`);
            }

            nextOrderId = nextOrder.nextOrder;
          }
        } else {
          console.log(`\n✅ First order has valid status for matching`);
        }
      }
    }

    // 5. Check if there are any orders at common price levels that might be problematic
    console.log("\n🔍 Checking Common Price Levels for Invalid Orders:");
    const commonPrices = [
      ethers.utils.parseEther("6000"), // 6000
      ethers.utils.parseEther("7000"), // 7000 (your order price)
      ethers.utils.parseEther("8000"), // 8000
      ethers.utils.parseEther("0.001"), // Small values
      ethers.utils.parseEther("0.01"),
    ];

    for (const price of commonPrices) {
      try {
        const bidNode = await orderBook.buyPriceTree(price);
        if (bidNode.orderCount.gt(0)) {
          console.log(
            `\n  Price ${ethers.utils.formatEther(price)}: ${
              bidNode.orderCount
            } orders`
          );

          if (bidNode.firstOrder !== ethers.constants.HashZero) {
            const order = await orderBook.orders(bidNode.firstOrder);
            console.log(
              `    First order status: ${order.status} (${
                order.status === 1
                  ? "FILLED"
                  : order.status === 2
                  ? "CANCELLED"
                  : order.status === 0
                  ? "PENDING"
                  : order.status === 3
                  ? "PARTIAL"
                  : "UNKNOWN"
              })`
            );
            if (order.status !== 0 && order.status !== 3) {
              console.log(
                `    ❌ Invalid status found at price level ${ethers.utils.formatEther(
                  price
                )}`
              );
            }
          }
        }
      } catch (error) {
        // Price level doesn't exist, which is fine
      }
    }
  } catch (error) {
    console.error("❌ Error during diagnosis:", error.message);

    // If it's a contract call error, the market might be paused or have other issues
    if (error.message.includes("revert")) {
      console.log(
        "\n💡 The contract may be paused or have access restrictions"
      );
    }
  }

  console.log("\n🎯 Diagnosis Complete!");
  console.log("\n💡 Recommendations:");
  console.log(
    "1. If invalid status orders were found, the order book needs cleanup"
  );
  console.log("2. Consider calling a cleanup function if available");
  console.log("3. Check if the market is paused or has trading restrictions");
  console.log(
    "4. Verify that the matching logic properly removes filled/cancelled orders"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
