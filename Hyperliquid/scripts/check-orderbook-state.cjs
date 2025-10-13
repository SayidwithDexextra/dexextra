const { ethers } = require("hardhat");

/**
 * Check the state of the ALUMINUM_V2 (ALUM_V2) OrderBook contract
 * to see why it might have a price of $5
 */

async function main() {
  console.log("🔍 Checking ALUMINUM_V2 OrderBook state...\n");

  const orderBookAddress = "0xaA5662ab1bF7BA1055B8C63281b764aF65553fec";
  const factoryAddress = "0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75";

  console.log("📊 OrderBook Address:", orderBookAddress);

  try {
    // Connect to the OrderBook contract
    const orderBook = await ethers.getContractAt("OrderBook", orderBookAddress);
    console.log("✅ Connected to OrderBook contract");

    // Check basic contract info
    console.log("\n📋 Basic Contract Information:");

    try {
      const symbol = await orderBook.symbol();
      console.log("   Symbol:", symbol);
    } catch (e) {
      console.log("   Symbol: N/A (method not available)");
    }

    try {
      const paused = await orderBook.paused();
      console.log("   Paused:", paused);
    } catch (e) {
      console.log("   Paused: N/A (method not available)");
    }

    // Check order book state
    console.log("\n📈 Order Book State:");

    try {
      // Check if there are any orders
      const totalOrders = await orderBook.getOrderCount();
      console.log("   Total Orders:", totalOrders.toString());
    } catch (e) {
      console.log("   Total Orders: N/A (method not available)");
    }

    try {
      // Check current price or last trade price
      const currentPrice = await orderBook.getCurrentPrice();
      console.log(
        "   Current Price:",
        ethers.formatEther(currentPrice),
        "USDC"
      );
    } catch (e) {
      console.log("   Current Price: N/A (method not available)");
    }

    try {
      // Check last trade price
      const lastTradePrice = await orderBook.getLastTradePrice();
      console.log(
        "   Last Trade Price:",
        ethers.formatEther(lastTradePrice),
        "USDC"
      );
    } catch (e) {
      console.log("   Last Trade Price: N/A (method not available)");
    }

    try {
      // Check best bid and ask
      const bestBid = await orderBook.getBestBid();
      const bestAsk = await orderBook.getBestAsk();
      console.log("   Best Bid:", ethers.formatEther(bestBid), "USDC");
      console.log("   Best Ask:", ethers.formatEther(bestAsk), "USDC");
    } catch (e) {
      console.log("   Best Bid/Ask: N/A (methods not available)");
    }

    // Check recent orders
    console.log("\n📜 Recent Orders:");
    try {
      // Try to get recent orders (this might vary based on contract implementation)
      const orderCount = await orderBook.getOrderCount();
      if (orderCount > 0) {
        console.log(`   Found ${orderCount} orders. Checking latest...`);

        // Try to get the latest orders
        const latestOrderIndex = orderCount - 1;
        const latestOrder = await orderBook.getOrder(latestOrderIndex);
        console.log("   Latest Order:");
        console.log(
          "     Price:",
          ethers.formatEther(latestOrder.price),
          "USDC"
        );
        console.log("     Size:", ethers.formatEther(latestOrder.size));
        console.log("     Is Buy:", latestOrder.isBuy);
      } else {
        console.log("   No orders found");
      }
    } catch (e) {
      console.log("   Unable to retrieve orders:", e.message);
    }

    // Check for any events that might indicate trades or orders
    console.log("\n🔍 Checking Recent Events:");
    try {
      const currentBlock = await ethers.provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 1000); // Last 1000 blocks

      console.log(`   Scanning blocks ${fromBlock} to ${currentBlock}...`);

      // Get all events from the contract
      const filter = {
        address: orderBookAddress,
        fromBlock: fromBlock,
        toBlock: currentBlock,
      };

      const logs = await ethers.provider.getLogs(filter);
      console.log(`   Found ${logs.length} events`);

      if (logs.length > 0) {
        console.log("   Recent events:");
        logs.slice(-5).forEach((log, index) => {
          console.log(
            `     ${index + 1}. Block: ${log.blockNumber}, Topics: ${
              log.topics.length
            }`
          );
        });
      }
    } catch (e) {
      console.log("   Unable to retrieve events:", e.message);
    }

    // Check if there's an initial price set
    console.log("\n💰 Price Investigation:");
    try {
      // Check if there's a reference price or initial price mechanism
      const referencePrice = await orderBook.referencePrice();
      console.log(
        "   Reference Price:",
        ethers.formatEther(referencePrice),
        "USDC"
      );
    } catch (e) {
      console.log("   Reference Price: N/A (method not available)");
    }

    try {
      // Check market maker settings
      const marketMaker = await orderBook.marketMaker();
      console.log("   Market Maker:", marketMaker);
    } catch (e) {
      console.log("   Market Maker: N/A (method not available)");
    }
  } catch (error) {
    console.error("❌ Error connecting to OrderBook:", error.message);

    // Try to check from the factory instead
    console.log("\n🔄 Trying alternative approach via Factory...");
    try {
      const factory = await ethers.getContractAt(
        "OrderBookFactoryMinimal",
        factoryAddress
      );
      const marketId =
        "0x88f2de2739bd614453f56cfec79f0456ef2829a0a56b36a410723613bcf2415b";
      const marketInfo = await factory.getMarket(marketId);

      console.log("📊 Market Info from Factory:");
      console.log("   Symbol:", marketInfo.symbol);
      console.log("   OrderBook:", marketInfo.orderBookAddress);
      console.log("   Active:", marketInfo.isActive);
      console.log("   Creator:", marketInfo.creator);
    } catch (factoryError) {
      console.error("❌ Factory check also failed:", factoryError.message);
    }
  }

  // Suggest possible reasons for the $5 price
  console.log("\n🤔 Possible Reasons for $5 Price:");
  console.log("   1. Initial price set during market creation");
  console.log("   2. Market maker providing initial liquidity");
  console.log("   3. Reference price from external oracle");
  console.log("   4. Previous test trades or orders");
  console.log("   5. Default price mechanism in the contract");
  console.log("   6. Price inherited from a template or similar market");
}

main()
  .then(() => {
    console.log("\n✅ OrderBook state check completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Script failed:", error);
    process.exit(1);
  });
