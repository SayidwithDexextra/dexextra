const { ethers } = require("hardhat");

// MEMECORE-COINGECKO market address from the console logs
const MARKET_ADDRESS = "0x110646b3CDDdb0d7cB7FAd92A5d5f166BfB2a6ef";

// ABI for querying ALL market trades (not user-specific)
const OB_VIEW_ABI = [
  "function getTradeCount() external view returns (uint256)",
  "function getTrades(uint256 offset, uint256 limit) external view returns (tuple(uint256 tradeId, address buyer, address seller, uint256 price, uint256 amount, uint256 tradeValue, uint256 buyerFee, uint256 sellerFee, uint256 timestamp, uint256 buyOrderId, uint256 sellOrderId, bool buyerIsMargin, bool sellerIsMargin)[] trades, bool hasMore)",
  "function getRecentTrades(uint256 count) external view returns (tuple(uint256 tradeId, address buyer, address seller, uint256 price, uint256 amount, uint256 tradeValue, uint256 buyerFee, uint256 sellerFee, uint256 timestamp, uint256 buyOrderId, uint256 sellOrderId, bool buyerIsMargin, bool sellerIsMargin)[] trades)"
];

async function main() {
  const [signer] = await ethers.getSigners();
  
  console.log("=".repeat(100));
  console.log("ALL MARKET TRADES FOR MEMECORE-COINGECKO");
  console.log("=".repeat(100));
  console.log(`Market Address: ${MARKET_ADDRESS}`);
  console.log("");

  const contract = new ethers.Contract(MARKET_ADDRESS, OB_VIEW_ABI, signer);
  const marketLower = MARKET_ADDRESS.toLowerCase();

  // Get total trade count
  let tradeCount;
  try {
    tradeCount = await contract.getTradeCount();
    console.log(`Total trades on market: ${tradeCount}`);
  } catch (e) {
    console.log("getTradeCount not available, trying getRecentTrades...");
    try {
      const recentTrades = await contract.getRecentTrades(50);
      console.log(`Got ${recentTrades.length} recent trades`);
      tradeCount = recentTrades.length;
    } catch (e2) {
      console.error("Error:", e2.message);
      return;
    }
  }

  if (tradeCount == 0) {
    console.log("No trades found on this market.");
    return;
  }

  // Fetch all trades using getRecentTrades
  console.log("\n" + "=".repeat(100));
  console.log("FETCHING ALL TRADES...");
  console.log("=".repeat(100));

  const allTrades = [];
  
  try {
    const recentTrades = await contract.getRecentTrades(100); // Get up to 100 trades
    console.log(`getRecentTrades returned ${recentTrades.length} trades`);
    
    for (const trade of recentTrades) {
      allTrades.push({
        tradeId: trade.tradeId.toString(),
        buyer: trade.buyer,
        seller: trade.seller,
        price: Number(ethers.formatUnits(trade.price, 6)),
        amount: Number(ethers.formatUnits(trade.amount, 18)),
        tradeValue: Number(ethers.formatUnits(trade.tradeValue, 6)),
        buyerFee: Number(ethers.formatUnits(trade.buyerFee, 6)),
        sellerFee: Number(ethers.formatUnits(trade.sellerFee, 6)),
        timestamp: new Date(Number(trade.timestamp) * 1000),
        buyOrderId: trade.buyOrderId.toString(),
        sellOrderId: trade.sellOrderId.toString(),
        buyerIsMargin: trade.buyerIsMargin,
        sellerIsMargin: trade.sellerIsMargin,
      });
    }
  } catch (e) {
    console.error("Error fetching trades:", e.message);
  }

  console.log(`\nFetched ${allTrades.length} trades total.\n`);

  // Sort by timestamp (oldest first)
  allTrades.sort((a, b) => a.timestamp - b.timestamp);

  // Print detailed trade history
  console.log("=".repeat(100));
  console.log("DETAILED TRADE HISTORY (Chronological Order - Oldest First)");
  console.log("=".repeat(100));
  console.log("");

  // Collect unique addresses
  const addresses = new Set();

  for (let i = 0; i < allTrades.length; i++) {
    const trade = allTrades[i];
    addresses.add(trade.buyer.toLowerCase());
    addresses.add(trade.seller.toLowerCase());
    
    // Check if buyer or seller is the contract itself (liquidation indicator)
    const buyerIsContract = trade.buyer.toLowerCase() === marketLower;
    const sellerIsContract = trade.seller.toLowerCase() === marketLower;
    const isLiquidation = buyerIsContract || sellerIsContract;

    const timeStr = trade.timestamp.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = trade.timestamp.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });

    console.log(`TRADE #${trade.tradeId} | ${dateStr} ${timeStr}`);
    console.log(`  Size: ${trade.amount.toFixed(4)} | Price: $${trade.price.toFixed(4)} | Value: $${trade.tradeValue.toFixed(2)}`);
    console.log(`  BUYER:  ${trade.buyer} ${buyerIsContract ? "[CONTRACT]" : ""} ${trade.buyerIsMargin ? "[MARGIN]" : ""}`);
    console.log(`  SELLER: ${trade.seller} ${sellerIsContract ? "[CONTRACT]" : ""} ${trade.sellerIsMargin ? "[MARGIN]" : ""}`);
    if (isLiquidation) {
      console.log(`  *** LIQUIDATION TRADE ***`);
    }
    console.log("");
  }

  // Summary
  console.log("=".repeat(100));
  console.log("UNIQUE ADDRESSES INVOLVED");
  console.log("=".repeat(100));
  let addrIdx = 1;
  for (const addr of addresses) {
    const isContract = addr === marketLower;
    console.log(`${addrIdx}. ${addr} ${isContract ? "[MARKET CONTRACT]" : ""}`);
    addrIdx++;
  }

  // Per-address analysis
  console.log("\n" + "=".repeat(100));
  console.log("PER-ADDRESS TRADE SUMMARY");
  console.log("=".repeat(100));

  for (const addr of addresses) {
    if (addr === marketLower) continue; // Skip contract address
    
    let buyQty = 0, sellQty = 0, buyValue = 0, sellValue = 0;
    
    for (const trade of allTrades) {
      if (trade.buyer.toLowerCase() === addr) {
        buyQty += trade.amount;
        buyValue += trade.tradeValue;
      }
      if (trade.seller.toLowerCase() === addr) {
        sellQty += trade.amount;
        sellValue += trade.tradeValue;
      }
    }
    
    const netQty = buyQty - sellQty;
    const position = netQty > 0.001 ? "LONG" : netQty < -0.001 ? "SHORT" : "FLAT";
    
    console.log(`\nAddress: ${addr}`);
    console.log(`  Bought: ${buyQty.toFixed(4)} units ($${buyValue.toFixed(2)})`);
    console.log(`  Sold:   ${sellQty.toFixed(4)} units ($${sellValue.toFixed(2)})`);
    console.log(`  Net:    ${netQty.toFixed(4)} units (${position})`);
    if (buyQty > 0) console.log(`  Avg Buy Price:  $${(buyValue/buyQty).toFixed(4)}`);
    if (sellQty > 0) console.log(`  Avg Sell Price: $${(sellValue/sellQty).toFixed(4)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
