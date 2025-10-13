#!/usr/bin/env node

/**
 * Query Aluminum V1 Order Book Market Variable Script
 *
 * This script directly interacts with the Aluminum V1 order book smart contract
 * to query the market variable and analyze the price differences between:
 * - currentPrice (mark/reference price)
 * - lastPrice (last executed trade price)
 *
 * Usage: node scripts/query-aluminum-market-variable.js
 */

const { ethers } = require("ethers");

// Contract configuration (from contractConfig.ts)
const CONTRACT_ADDRESSES = {
  aluminumOrderBook: "0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE",
};

const ALUMINUM_V1_MARKET = {
  marketId:
    "0x41e77fd5318a7e3c379ff8fe985be494211c1b2a0a0fa1fa2f99ac7d5060892a",
  symbol: "Aluminum V1",
  orderBookAddress: "0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE",
};

// OrderBook ABI - focused on market data functions
const ORDERBOOK_ABI = [
  // Market info function that returns the full Market struct
  {
    inputs: [],
    name: "getMarketInfo",
    outputs: [
      {
        components: [
          { internalType: "bytes32", name: "marketId", type: "bytes32" },
          { internalType: "string", name: "symbol", type: "string" },
          { internalType: "string", name: "metricId", type: "string" },
          { internalType: "uint256", name: "currentPrice", type: "uint256" },
          { internalType: "uint256", name: "lastPrice", type: "uint256" },
          { internalType: "uint256", name: "openInterest", type: "uint256" },
          { internalType: "uint256", name: "volume24h", type: "uint256" },
          { internalType: "uint256", name: "funding", type: "uint256" },
          { internalType: "uint256", name: "lastFundingTime", type: "uint256" },
          { internalType: "bool", name: "isActive", type: "bool" },
          { internalType: "bool", name: "isCustomMetric", type: "bool" },
        ],
        internalType: "struct OrderBook.Market",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },

  // Direct access to the public market variable
  {
    inputs: [],
    name: "market",
    outputs: [
      { internalType: "bytes32", name: "marketId", type: "bytes32" },
      { internalType: "string", name: "symbol", type: "string" },
      { internalType: "string", name: "metricId", type: "string" },
      { internalType: "uint256", name: "currentPrice", type: "uint256" },
      { internalType: "uint256", name: "lastPrice", type: "uint256" },
      { internalType: "uint256", name: "openInterest", type: "uint256" },
      { internalType: "uint256", name: "volume24h", type: "uint256" },
      { internalType: "uint256", name: "funding", type: "uint256" },
      { internalType: "uint256", name: "lastFundingTime", type: "uint256" },
      { internalType: "bool", name: "isActive", type: "bool" },
      { internalType: "bool", name: "isCustomMetric", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // Best prices from order book
  {
    inputs: [],
    name: "getBestPrices",
    outputs: [
      { internalType: "uint256", name: "bestBidPrice", type: "uint256" },
      { internalType: "uint256", name: "bestAskPrice", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // Individual price getters
  {
    inputs: [],
    name: "bestBid",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "bestAsk",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

// Polygon RPC endpoint
const RPC_URL = process.env.RPC_URL || "https://polygon-rpc.com/";

// Price scaling constants from the contract
const PRICE_PRECISION = 1e6; // 6 decimals (from contract: PRICE_PRECISION = 1e6)

async function formatPrice(priceWei, label) {
  // Contract uses 6-decimal precision for USDC compatibility
  const priceFormatted = parseFloat(priceWei.toString()) / PRICE_PRECISION;

  console.log(`  ${label}:`);
  console.log(`    Raw value: ${priceWei.toString()}`);
  console.log(`    Formatted: $${priceFormatted.toFixed(6)}`);
  console.log(`    In USDC units: ${priceFormatted} USDC`);

  return priceFormatted;
}

async function queryMarketVariable() {
  console.log("🔍 Querying Aluminum V1 Order Book Market Variable\n");
  console.log("Contract Details:");
  console.log(`  Address: ${ALUMINUM_V1_MARKET.orderBookAddress}`);
  console.log(`  Symbol: ${ALUMINUM_V1_MARKET.symbol}`);
  console.log(`  Market ID: ${ALUMINUM_V1_MARKET.marketId}`);
  console.log(`  RPC URL: ${RPC_URL}\n`);

  try {
    // Initialize provider and contract
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(
      ALUMINUM_V1_MARKET.orderBookAddress,
      ORDERBOOK_ABI,
      provider
    );

    console.log("📊 Fetching market data...\n");

    // Method 1: Query via getMarketInfo() function
    console.log("=== METHOD 1: getMarketInfo() Function ===");
    try {
      const marketInfo = await contract.getMarketInfo();

      console.log("Market Info Structure:");
      console.log(`  Market ID: ${marketInfo.marketId}`);
      console.log(`  Symbol: ${marketInfo.symbol}`);
      console.log(`  Metric ID: ${marketInfo.metricId}`);
      console.log(`  Open Interest: ${marketInfo.openInterest.toString()}`);
      console.log(`  Volume 24h: ${marketInfo.volume24h.toString()}`);
      console.log(`  Funding Rate: ${marketInfo.funding.toString()}`);
      console.log(`  Is Active: ${marketInfo.isActive}`);
      console.log(`  Is Custom Metric: ${marketInfo.isCustomMetric}\n`);

      const currentPriceFormatted = await formatPrice(
        marketInfo.currentPrice,
        "Current Price"
      );
      const lastPriceFormatted = await formatPrice(
        marketInfo.lastPrice,
        "Last Price"
      );

      console.log(`\n📈 PRICE ANALYSIS:`);
      console.log(
        `  Current Price: $${currentPriceFormatted.toFixed(
          6
        )} (Mark/Reference price)`
      );
      console.log(
        `  Last Price: $${lastPriceFormatted.toFixed(6)} (Last executed trade)`
      );
      console.log(
        `  Difference: $${(lastPriceFormatted - currentPriceFormatted).toFixed(
          6
        )}\n`
      );
    } catch (error) {
      console.error("❌ getMarketInfo() failed:", error.message);
    }

    // Method 2: Query via direct market variable access
    console.log("=== METHOD 2: Direct market Variable Access ===");
    try {
      const marketData = await contract.market();

      console.log("Direct Market Variable:");
      const currentPriceFormatted = await formatPrice(
        marketData.currentPrice,
        "Current Price (Direct)"
      );
      const lastPriceFormatted = await formatPrice(
        marketData.lastPrice,
        "Last Price (Direct)"
      );
    } catch (error) {
      console.error("❌ Direct market access failed:", error.message);
    }

    // Method 3: Query order book prices
    console.log("\n=== METHOD 3: Order Book Prices ===");
    try {
      const [bestBid, bestAsk] = await contract.getBestPrices();

      const bestBidFormatted = await formatPrice(bestBid, "Best Bid");
      const bestAskFormatted = await formatPrice(bestAsk, "Best Ask");

      if (bestBidFormatted > 0 && bestAskFormatted > 0) {
        const midPrice = (bestBidFormatted + bestAskFormatted) / 2;
        const spread = bestAskFormatted - bestBidFormatted;
        console.log(`\n  Mid Price: $${midPrice.toFixed(6)}`);
        console.log(`  Spread: $${spread.toFixed(6)}`);
      }
    } catch (error) {
      console.error("❌ getBestPrices() failed:", error.message);
    }

    // Method 4: Individual price queries
    console.log("\n=== METHOD 4: Individual Price Queries ===");
    try {
      const bestBidIndividual = await contract.bestBid();
      const bestAskIndividual = await contract.bestAsk();

      await formatPrice(bestBidIndividual, "Best Bid (Individual)");
      await formatPrice(bestAskIndividual, "Best Ask (Individual)");
    } catch (error) {
      console.error("❌ Individual price queries failed:", error.message);
    }
  } catch (error) {
    console.error("❌ Failed to connect to contract:", error);
    process.exit(1);
  }
}

async function explainPriceDifferences() {
  console.log("\n" + "=".repeat(80));
  console.log("💡 UNDERSTANDING PRICE DIFFERENCES");
  console.log("=".repeat(80));

  console.log(`
📚 EXPLANATION OF PRICE FIELDS:

1. **currentPrice (0)** - Mark/Reference Price:
   • This is the "mark price" or reference price for the market
   • Used for margin calculations and position valuation  
   • Set by oracle feeds, price discovery algorithms, or market makers
   • Currently 0 because: No oracle feed is active OR no mark price has been set

2. **lastPrice (5,000,000 = $5.00)** - Last Trade Price:
   • This is the price of the most recent executed trade
   • Updated only when actual trades occur (buy meets sell)
   • Shows $5.00 because there was a trade executed at that price
   • This reflects real market activity and liquidity

3. **bestBid/bestAsk** - Order Book Prices:
   • Current highest buy order (bid) and lowest sell order (ask)
   • Shows immediate liquidity and where next trades could happen
   • Updates in real-time as orders are placed/cancelled

🎯 WHICH PRICE TO DISPLAY IN YOUR FRONTEND?

**RECOMMENDATION: Use lastPrice ($5.00) as the primary displayed price**

**Reasoning:**
✅ lastPrice shows actual market activity and real transaction prices
✅ More meaningful to users than a potentially stale mark price
✅ Reflects true price discovery from trading activity
✅ Standard practice in most trading interfaces

**Fallback Strategy:**
1. Primary: lastPrice (if > 0)
2. Secondary: midPrice = (bestBid + bestAsk) / 2 (if both > 0)  
3. Tertiary: currentPrice (if > 0)
4. Fallback: Static reference price or "Price Unavailable"

**Implementation Example:**
\`\`\`javascript
function getDisplayPrice(marketData) {
  if (marketData.lastPrice > 0) {
    return marketData.lastPrice; // ✅ Best - shows real trading activity
  }
  
  if (marketData.bestBid > 0 && marketData.bestAsk > 0) {
    return (marketData.bestBid + marketData.bestAsk) / 2; // ✅ Good - current market
  }
  
  if (marketData.currentPrice > 0) {
    return marketData.currentPrice; // ⚠️ Fallback - may be stale
  }
  
  return null; // ❌ No price available
}
\`\`\`

💡 Additional Display Tips:
• Show both lastPrice and current bid/ask for transparency
• Indicate data freshness (e.g., "Last trade: 2 hours ago")  
• Display spread percentage to show market liquidity
• Use color coding for price movements (green=up, red=down)
`);
}

// Main execution
async function main() {
  try {
    await queryMarketVariable();
    await explainPriceDifferences();

    console.log("\n✅ Market analysis complete!");
    console.log(
      "\n💡 Key Takeaway: Use lastPrice ($5.00) as your primary display price in the frontend."
    );
  } catch (error) {
    console.error("❌ Script execution failed:", error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

module.exports = {
  queryMarketVariable,
  explainPriceDifferences,
  CONTRACT_ADDRESSES,
  ALUMINUM_V1_MARKET,
  ORDERBOOK_ABI,
};
