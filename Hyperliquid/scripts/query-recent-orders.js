#!/usr/bin/env node

/**
 * Query Recent Orders with Smaller Block Range
 */

const hre = require("hardhat");

async function main() {
  console.log("📊 Querying Recent Orders (Limited Range)\n");

  const ORDERBOOK_ADDRESS = "0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE";
  const USER_ADDRESS = "0x1Bc0a803de77a004086e6010cD3f72ca7684e444";

  try {
    const orderBook = await hre.ethers.getContractAt("OrderBook", ORDERBOOK_ADDRESS);
    const currentBlock = await hre.ethers.provider.getBlockNumber();
    
    console.log(`Current Block: ${currentBlock}`);
    
    // Check last 100 blocks only
    const fromBlock = Math.max(currentBlock - 100, 0);
    console.log(`Checking blocks ${fromBlock} to ${currentBlock}\n`);

    // Get all recent orders
    const orderPlacedFilter = orderBook.filters.OrderPlaced();
    const orderEvents = await orderBook.queryFilter(orderPlacedFilter, fromBlock, currentBlock);
    
    console.log(`📋 Found ${orderEvents.length} total orders in last 100 blocks:`);
    
    orderEvents.forEach((event, index) => {
      const args = event.args;
      const isYourOrder = args.user.toLowerCase() === USER_ADDRESS.toLowerCase();
      
      console.log(`${isYourOrder ? '👤 YOUR ORDER' : '   Order'} ${index + 1}:`);
      console.log(`     Order ID: ${args.orderId}`);
      console.log(`     User: ${args.user}`);
      console.log(`     Side: ${args.side === 0 ? 'BUY' : 'SELL'}`);
      console.log(`     Size: ${hre.ethers.formatUnits(args.size, 6)} units (raw: ${args.size})`);
      console.log(`     Price: ${hre.ethers.formatUnits(args.price, 6)} USDC (raw: ${args.price})`);
      console.log(`     Block: ${event.blockNumber}`);
      console.log(`     Tx Hash: ${event.transactionHash}`);
      console.log("");
    });

    // Show current orderbook state
    console.log("💰 Current OrderBook State:");
    try {
      const bestPrices = await orderBook.getBestPrices();
      const bestBidPrice = bestPrices[0];
      const bestAskPrice = bestPrices[1];
      
      console.log(`   Best Bid: ${hre.ethers.formatUnits(bestBidPrice, 6)} USDC`);
      console.log(`   Best Ask: ${hre.ethers.formatUnits(bestAskPrice, 6)} USDC`);
      
      if (bestBidPrice > 0 && bestAskPrice > 0) {
        const spread = bestAskPrice - bestBidPrice;
        console.log(`   Spread: ${hre.ethers.formatUnits(spread, 6)} USDC`);
      }
    } catch (error) {
      console.log("❌ Could not get best prices:", error.message);
    }

  } catch (error) {
    console.error("❌ Query failed:", error.message);
  }
}

main().catch(console.error);
