#!/usr/bin/env node

/**
 * Query OrderBook Pricing Data Directly
 * 
 * This script queries the OrderBook contract directly to get:
 * - Best bid/ask prices
 * - Current mark price
 * - Recent orders and their prices
 * - Order book state
 */

const hre = require("hardhat");

async function main() {
  console.log("📊 Querying OrderBook Pricing Data\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Using account:", deployer.address);

  // Contract addresses
  const ORDERBOOK_ADDRESS = "0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE";
  
  console.log(`📋 OrderBook Address: ${ORDERBOOK_ADDRESS}\n`);

  try {
    // Get OrderBook contract
    const orderBook = await hre.ethers.getContractAt("OrderBook", ORDERBOOK_ADDRESS);

    console.log("🔍 QUERYING ORDERBOOK PRICING DATA:");
    console.log("=" * 50);

    // 1. Get best prices (bid/ask)
    try {
      const bestPrices = await orderBook.getBestPrices();
      const bestBidPrice = bestPrices[0];
      const bestAskPrice = bestPrices[1];
      
      console.log("💰 Best Prices:");
      console.log(`   Best Bid: ${hre.ethers.formatUnits(bestBidPrice, 6)} USDC (raw: ${bestBidPrice})`);
      console.log(`   Best Ask: ${hre.ethers.formatUnits(bestAskPrice, 6)} USDC (raw: ${bestAskPrice})`);
      
      if (bestBidPrice > 0 && bestAskPrice > 0) {
        const midPrice = (bestBidPrice + bestAskPrice) / 2n;
        console.log(`   Mid Price: ${hre.ethers.formatUnits(midPrice, 6)} USDC (raw: ${midPrice})`);
      }
    } catch (error) {
      console.log("❌ Could not get best prices:", error.message);
    }

    console.log("");

    // 2. Get order book statistics
    try {
      const totalOrders = await orderBook.getOrderCount();
      console.log(`📊 Total Orders: ${totalOrders}`);
    } catch (error) {
      console.log("❌ Could not get order count:", error.message);
    }

    // 3. Check recent order events
    console.log("\n🔍 CHECKING RECENT ORDER EVENTS:");
    try {
      const currentBlock = await hre.ethers.provider.getBlockNumber();
      const fromBlock = Math.max(currentBlock - 1000, 0); // Last 1000 blocks
      
      const orderPlacedFilter = orderBook.filters.OrderPlaced();
      const orderEvents = await orderBook.queryFilter(orderPlacedFilter, fromBlock, currentBlock);
      
      console.log(`📋 Found ${orderEvents.length} OrderPlaced events in last 1000 blocks:`);
      
      orderEvents.slice(-5).forEach((event, index) => {
        const args = event.args;
        console.log(`   Order ${index + 1}:`);
        console.log(`     Order ID: ${args.orderId}`);
        console.log(`     User: ${args.user}`);
        console.log(`     Side: ${args.side === 0 ? 'BUY' : 'SELL'}`);
        console.log(`     Size: ${hre.ethers.formatUnits(args.size, 6)} units`);
        console.log(`     Price: ${hre.ethers.formatUnits(args.price, 6)} USDC`);
        console.log(`     Block: ${event.blockNumber}`);
        console.log("");
      });
      
    } catch (error) {
      console.log("❌ Could not get recent orders:", error.message);
    }

    // 4. Check if there's a mark price function
    console.log("🎯 CHECKING FOR MARK PRICE FUNCTION:");
    try {
      // Try different possible mark price function names
      const possibleFunctions = ['getMarkPrice', 'markPrice', 'getCurrentPrice', 'getPrice'];
      
      for (const funcName of possibleFunctions) {
        try {
          const markPrice = await orderBook[funcName]();
          console.log(`✅ ${funcName}(): ${hre.ethers.formatUnits(markPrice, 6)} USDC (raw: ${markPrice})`);
        } catch (err) {
          console.log(`❌ ${funcName}(): Not available`);
        }
      }
    } catch (error) {
      console.log("❌ Error checking mark price functions:", error.message);
    }

    // 5. Check user's specific orders
    console.log("\n👤 CHECKING USER'S ORDERS:");
    try {
      const userOrdersFilter = orderBook.filters.OrderPlaced(null, deployer.address);
      const userEvents = await orderBook.queryFilter(userOrdersFilter);
      
      console.log(`📋 Found ${userEvents.length} orders from ${deployer.address}:`);
      
      userEvents.slice(-3).forEach((event, index) => {
        const args = event.args;
        console.log(`   Your Order ${index + 1}:`);
        console.log(`     Order ID: ${args.orderId}`);
        console.log(`     Side: ${args.side === 0 ? 'BUY' : 'SELL'}`);
        console.log(`     Size: ${hre.ethers.formatUnits(args.size, 6)} units`);
        console.log(`     Price: ${hre.ethers.formatUnits(args.price, 6)} USDC`);
        console.log(`     Block: ${event.blockNumber}`);
        console.log("");
      });
      
    } catch (error) {
      console.log("❌ Could not get user orders:", error.message);
    }

    console.log("✅ OrderBook pricing query completed!");

  } catch (error) {
    console.error("❌ OrderBook query failed:", error.message);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
