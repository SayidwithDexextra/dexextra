/**
 * Repair Order Book Linked Lists
 * 
 * Scans for all price levels with orders and rebuilds the linked list structure
 * so that getActiveOrdersCount() works correctly.
 */

const { ethers } = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });

async function main() {
  const marketAddress = process.argv[2] || "0xade7a2029881a22479a188Ba24F38686454aA069";
  
  console.log("Repairing order book linked lists for:", marketAddress);
  console.log("");
  
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  
  const view = await ethers.getContractAt("OBViewFacet", marketAddress);
  const maintenance = await ethers.getContractAt("OBMaintenanceFacet", marketAddress);
  
  // Get current state
  const bestBid = await view.bestBid();
  const bestAsk = await view.bestAsk();
  
  console.log("Current state:");
  console.log("  Best Bid:", ethers.formatUnits(bestBid, 6));
  console.log("  Best Ask:", ethers.formatUnits(bestAsk, 6));
  
  const [buyCount, sellCount] = await view.getActiveOrdersCount();
  console.log("  getActiveOrdersCount: buy=" + buyCount + ", sell=" + sellCount);
  console.log("");
  
  // Scan for buy price levels that have orders
  console.log("Scanning for buy price levels with orders...");
  const buyPricesWithOrders = [];
  
  // Start from bestBid and check nearby prices (within 50% range)
  const minPrice = bestBid * 50n / 100n;
  const maxPrice = bestBid * 150n / 100n;
  
  // Also check the price we placed test order at
  const testPrices = [bestBid, 23849n, 47698n];
  
  // Check bestBid first
  const level = await view.buyLevels(bestBid);
  if (level.exists && level.firstOrderId > 0n) {
    buyPricesWithOrders.push(bestBid);
    console.log("  Found orders at", ethers.formatUnits(bestBid, 6), "- orders:", level.firstOrderId.toString(), "to", level.lastOrderId.toString());
  }
  
  // Check test price
  for (const price of [23849n]) {
    if (price !== bestBid) {
      const testLevel = await view.buyLevels(price);
      if (testLevel.exists && testLevel.firstOrderId > 0n) {
        buyPricesWithOrders.push(price);
        console.log("  Found orders at", ethers.formatUnits(price, 6), "- orders:", testLevel.firstOrderId.toString(), "to", testLevel.lastOrderId.toString());
      }
    }
  }
  
  if (buyPricesWithOrders.length === 0) {
    console.log("  No buy price levels with orders found");
  } else {
    // Sort descending (highest price first for buy side)
    buyPricesWithOrders.sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));
    
    console.log("");
    console.log("Buy prices with orders (descending):", buyPricesWithOrders.map(p => ethers.formatUnits(p, 6)).join(", "));
    
    // Call adminSetBuyPriceList to fix the linked list
    console.log("");
    console.log("Calling adminSetBuyPriceList to repair linked list...");
    
    try {
      const tx = await maintenance.adminSetBuyPriceList(buyPricesWithOrders);
      console.log("  Tx:", tx.hash);
      await tx.wait();
      console.log("  Confirmed!");
      
      // Verify fix
      const [newBuyCount, newSellCount] = await view.getActiveOrdersCount();
      console.log("");
      console.log("After repair:");
      console.log("  getActiveOrdersCount: buy=" + newBuyCount + ", sell=" + newSellCount);
    } catch (e) {
      console.log("  Error:", e.reason || e.message?.substring(0, 100));
    }
  }
  
  // Similarly for sell side
  console.log("");
  console.log("Checking sell side...");
  const sellLevel = await view.sellLevels(bestAsk);
  if (sellLevel.exists && sellLevel.firstOrderId > 0n) {
    console.log("  Found orders at", ethers.formatUnits(bestAsk, 6));
    
    // Fix sell side linked list
    try {
      const tx = await maintenance.adminSetSellPriceList([bestAsk]);
      console.log("  Repairing sell linked list... Tx:", tx.hash);
      await tx.wait();
      console.log("  Confirmed!");
    } catch (e) {
      console.log("  Error:", e.reason || e.message?.substring(0, 100));
    }
  }
  
  // Final verification
  console.log("");
  console.log("Final state:");
  const [finalBuy, finalSell] = await view.getActiveOrdersCount();
  console.log("  getActiveOrdersCount: buy=" + finalBuy + ", sell=" + finalSell);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
