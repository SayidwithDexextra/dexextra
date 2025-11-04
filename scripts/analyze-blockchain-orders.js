#!/usr/bin/env node

/**
 * Blockchain Order Analysis Script
 *
 * This script directly queries the blockchain contracts to get current orders
 * and analyzes what orders need to be placed for proper filling and price movement.
 */

const { ethers } = require("ethers");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONTRACTS = {
  // Core System Contracts
  orderRouter: "0x836AaF8c558F7390d59591248e02435fc9Ea66aD",
  centralVault: "0x602B4B1fe6BBC10096970D4693D94376527D04ab",
  factory: "0xec83CDAf6DE9A6C97363966E2Be1c7CfE680687d",
  umaOracleManager: "0x9Fc90Cd2E4345a51b55EC6ecEeDf31051Db20cD4",
  mockUSDC: "0x194b4517a61D569aC8DBC47a22ed6F665B77a331",

  // Silver V4 Specific
  silverV4OrderBook: "0x0900D4f3C7CF7d8f55709019330cCE110bC76DEf",
  silverV4MetricId: "SILVER_Relayed_Meridian_2025_85969",

  // Your wallet
  deployerAddress: "0x1Bc0a803de77a004086e6010cD3f72ca7684e444",
};

const POLYGON_RPC = process.env.RPC_URL || "https://polygon-rpc.com/";

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================================
// CONTRACT ABIS
// ============================================================================

const ORDER_ROUTER_ABI = [
  "function getOrder(uint256 orderId) external view returns (tuple(uint256 orderId, address trader, string metricId, uint8 orderType, uint8 side, uint256 quantity, uint256 price, uint256 filledQuantity, uint256 timestamp, uint256 expiryTime, uint8 status, uint8 timeInForce, uint256 stopPrice, uint256 icebergQty, bool postOnly, bytes32 metadataHash))",
  "function getUserActiveOrders(address trader) external view returns (tuple(uint256 orderId, address trader, string metricId, uint8 orderType, uint8 side, uint256 quantity, uint256 price, uint256 filledQuantity, uint256 timestamp, uint256 expiryTime, uint8 status, uint8 timeInForce, uint256 stopPrice, uint256 icebergQty, bool postOnly, bytes32 metadataHash)[])",
  "function getUserOrderHistory(address trader, uint256 limit, uint256 offset) external view returns (tuple(uint256 orderId, address trader, string metricId, uint8 orderType, uint8 side, uint256 quantity, uint256 price, uint256 filledQuantity, uint256 timestamp, uint256 expiryTime, uint8 status, uint8 timeInForce, uint256 stopPrice, uint256 icebergQty, bool postOnly, bytes32 metadataHash)[])",
  "function marketOrderBooks(string calldata metricId) external view returns (address)",
];

const ORDER_BOOK_ABI = [
  "function getMarketStats() external view returns (tuple(uint256 lastPrice, uint256 volume24h, uint256 high24h, uint256 low24h, uint256 totalVolume, uint256 openInterest))",
  "function getBestBid() external view returns (uint256)",
  "function getBestAsk() external view returns (uint256)",
  "function getSpread() external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function metricId() external view returns (string)",
  "function getAllPositions() external view returns (tuple(address trader, bool isLong, uint256 quantity, uint256 entryPrice, uint256 collateral, bool isSettled, uint256 payout)[])",
  "function getUserPositions(address trader) external view returns (tuple(address trader, bool isLong, uint256 quantity, uint256 entryPrice, uint256 collateral, bool isSettled, uint256 payout)[])",
  "function totalPositions() external view returns (uint256)",
];

const CENTRAL_VAULT_ABI = [
  "function getUserBalance(address user, address asset) external view returns (tuple(uint256 available, uint256 allocated, uint256 locked))",
  "function getTotalAssets(address asset) external view returns (uint256)",
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatUsdc(amount, decimals = 6) {
  return parseFloat(ethers.formatUnits(amount, decimals)).toLocaleString(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  );
}

function formatPrice(price, decimals = 18) {
  const formatted = parseFloat(ethers.formatUnits(price, decimals));
  return formatted.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function formatNumber(num, decimals = 8) {
  if (typeof num === "string") {
    num = parseFloat(num);
  }
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

function formatTimestamp(timestamp) {
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function decodeOrderType(type) {
  const types = [
    "MARKET",
    "LIMIT",
    "STOP_LOSS",
    "TAKE_PROFIT",
    "STOP_LIMIT",
    "ICEBERG",
    "FILL_OR_KILL",
    "IMMEDIATE_OR_CANCEL",
    "ALL_OR_NONE",
  ];
  return types[type] || `UNKNOWN(${type})`;
}

function decodeOrderSide(side) {
  const sides = ["BUY", "SELL"];
  return sides[side] || `UNKNOWN(${side})`;
}

function decodeOrderStatus(status) {
  const statuses = [
    "PENDING",
    "PARTIALLY_FILLED",
    "FILLED",
    "CANCELLED",
    "EXPIRED",
    "REJECTED",
  ];
  return statuses[status] || `UNKNOWN(${status})`;
}

function calculateRemainingQuantity(quantity, filledQuantity) {
  const remaining =
    parseFloat(ethers.formatEther(quantity)) -
    parseFloat(ethers.formatEther(filledQuantity));
  return Math.max(remaining, 0);
}

// ============================================================================
// DATABASE FUNCTIONS
// ============================================================================

async function checkDatabaseTables() {
  console.log("\n🔍 CHECKING DATABASE TABLES:");

  const tables = [
    "orderbook_markets_view",
    "market_orders",
    "market_positions",
    "off_chain_orders",
    "trade_matches",
  ];
  const existingTables = [];

  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select("*").limit(1);
      if (!error) {
        existingTables.push(table);
        console.log(`   ✅ ${table} - exists`);
      } else {
        console.log(`   ❌ ${table} - ${error.message}`);
      }
    } catch (err) {
      console.log(`   ❌ ${table} - ${err.message}`);
    }
  }

  return existingTables;
}

async function getActiveMarkets() {
  try {
    const { data: markets, error } = await supabase
      .from("orderbook_markets_view")
      .select(
        `
        id,
        metric_id,
        description,
        market_status,
        market_address,
        last_trade_price,
        total_volume,
        total_trades,
        open_interest_long,
        open_interest_short
      `
      )
      .in("market_status", ["ACTIVE", "TRADING_ENDED"])
      .order("total_volume", { ascending: false });

    if (error) {
      console.warn(`Database markets query failed: ${error.message}`);
      return [];
    }

    return markets || [];
  } catch (error) {
    console.warn(`Failed to fetch markets from database: ${error.message}`);
    return [];
  }
}

// ============================================================================
// BLOCKCHAIN QUERY FUNCTIONS
// ============================================================================

async function getAllActiveOrdersFromContract(provider, orderRouter) {
  try {
    console.log("📋 Fetching active orders from OrderRouter...");

    // Note: OrderRouter only provides getUserActiveOrders() for specific traders
    // There is no getAllActiveOrders() function in the contract
    console.log(
      "   🔄 Getting active orders for your wallet (OrderRouter only supports per-user queries)..."
    );
    const userOrders = await orderRouter.getUserActiveOrders(
      CONTRACTS.deployerAddress
    );
    console.log(
      `   ✅ Found ${userOrders.length} active orders for your wallet`
    );

    return userOrders;
  } catch (error) {
    console.error(`   ❌ Failed to fetch orders: ${error.message}`);
    return [];
  }
}

async function getOrderBookStats(provider, orderBookAddress) {
  try {
    const orderBook = new ethers.Contract(
      orderBookAddress,
      ORDER_BOOK_ABI,
      provider
    );

    const [marketStats, bestBid, bestAsk, spread, metricId] = await Promise.all(
      [
        orderBook.getMarketStats().catch(() => null),
        orderBook.getBestBid().catch(() => null),
        orderBook.getBestAsk().catch(() => null),
        orderBook.getSpread().catch(() => null),
        orderBook.metricId().catch(() => null),
      ]
    );

    return {
      marketStats,
      bestBid,
      bestAsk,
      spread,
      metricId,
      orderBookAddress,
    };
  } catch (error) {
    console.warn(`   ⚠️  Failed to get order book stats: ${error.message}`);
    return null;
  }
}

// ============================================================================
// ANALYSIS FUNCTIONS
// ============================================================================

function analyzeOrderBook(orders) {
  const buyOrders = orders
    .filter((order) => decodeOrderSide(order.side) === "BUY")
    .sort(
      (a, b) =>
        parseFloat(ethers.formatEther(b.price)) -
        parseFloat(ethers.formatEther(a.price))
    );
  const sellOrders = orders
    .filter((order) => decodeOrderSide(order.side) === "SELL")
    .sort(
      (a, b) =>
        parseFloat(ethers.formatEther(a.price)) -
        parseFloat(ethers.formatEther(b.price))
    );

  // Calculate order book depth
  const buyDepth = buyOrders.reduce(
    (sum, order) =>
      sum + calculateRemainingQuantity(order.quantity, order.filledQuantity),
    0
  );
  const sellDepth = sellOrders.reduce(
    (sum, order) =>
      sum + calculateRemainingQuantity(order.quantity, order.filledQuantity),
    0
  );

  // Find best bid and ask
  const bestBid =
    buyOrders.length > 0
      ? parseFloat(ethers.formatEther(buyOrders[0].price))
      : null;
  const bestAsk =
    sellOrders.length > 0
      ? parseFloat(ethers.formatEther(sellOrders[0].price))
      : null;

  // Calculate spread
  const spread = bestBid && bestAsk ? bestAsk - bestBid : null;
  const spreadPercent =
    bestBid && bestAsk && bestBid > 0 ? (spread / bestBid) * 100 : null;

  return {
    buyOrders,
    sellOrders,
    buyDepth,
    sellDepth,
    bestBid,
    bestAsk,
    spread,
    spreadPercent,
    totalOrders: orders.length,
    imbalance: buyDepth - sellDepth,
  };
}

function generateTradingRecommendations(analysis, orderBookStats) {
  const recommendations = [];
  const { buyOrders, sellOrders, bestBid, bestAsk, spread, imbalance } =
    analysis;

  console.log(`\n📊 TRADING ANALYSIS:`);
  console.log(
    `   💰 Best Bid: $${bestBid ? formatNumber(bestBid, 4) : "None"}`
  );
  console.log(
    `   💰 Best Ask: $${bestAsk ? formatNumber(bestAsk, 4) : "None"}`
  );
  console.log(
    `   📏 Spread: ${
      spread
        ? `$${formatNumber(spread, 4)} (${formatNumber(
            analysis.spreadPercent,
            2
          )}%)`
        : "N/A"
    }`
  );
  console.log(
    `   ⚖️  Order Imbalance: ${formatNumber(imbalance, 2)} (${
      imbalance > 0 ? "Buy Heavy" : "Sell Heavy"
    })`
  );

  if (orderBookStats) {
    if (orderBookStats.bestBid) {
      console.log(
        `   🏦 Contract Best Bid: $${formatPrice(orderBookStats.bestBid, 18)}`
      );
    }
    if (orderBookStats.bestAsk) {
      console.log(
        `   🏦 Contract Best Ask: $${formatPrice(orderBookStats.bestAsk, 18)}`
      );
    }
    if (orderBookStats.marketStats) {
      console.log(
        `   📈 Last Trade: $${formatPrice(
          orderBookStats.marketStats.lastPrice,
          18
        )}`
      );
      console.log(
        `   📊 24h Volume: ${formatPrice(
          orderBookStats.marketStats.volume24h,
          18
        )}`
      );
    }
  }

  // Recommendation 1: Fill existing orders
  if (buyOrders.length > 0) {
    const topBuyOrder = buyOrders[0];
    const remainingQty = calculateRemainingQuantity(
      topBuyOrder.quantity,
      topBuyOrder.filledQuantity
    );
    if (remainingQty > 0) {
      recommendations.push({
        type: "FILL_EXISTING",
        action: "SELL",
        orderType: "MARKET",
        quantity: remainingQty,
        targetPrice: parseFloat(ethers.formatEther(topBuyOrder.price)),
        reason: `Fill highest bid order (${formatNumber(
          remainingQty,
          4
        )} @ $${formatPrice(topBuyOrder.price, 18)})`,
        targetOrderId: topBuyOrder.orderId.toString(),
        priority: "HIGH",
      });
    }
  }

  if (sellOrders.length > 0) {
    const topSellOrder = sellOrders[0];
    const remainingQty = calculateRemainingQuantity(
      topSellOrder.quantity,
      topSellOrder.filledQuantity
    );
    if (remainingQty > 0) {
      recommendations.push({
        type: "FILL_EXISTING",
        action: "BUY",
        orderType: "MARKET",
        quantity: remainingQty,
        targetPrice: parseFloat(ethers.formatEther(topSellOrder.price)),
        reason: `Fill lowest ask order (${formatNumber(
          remainingQty,
          4
        )} @ $${formatPrice(topSellOrder.price, 18)})`,
        targetOrderId: topSellOrder.orderId.toString(),
        priority: "HIGH",
      });
    }
  }

  // Recommendation 2: Narrow the spread
  if (bestBid && bestAsk && spread > 0.01) {
    const midPrice = (bestBid + bestAsk) / 2;
    recommendations.push({
      type: "NARROW_SPREAD",
      action: "BUY",
      orderType: "LIMIT",
      quantity: 1.0,
      price: midPrice - spread * 0.1,
      reason: `Place competitive bid to narrow spread (current: ${formatNumber(
        spread,
        4
      )})`,
      priority: "MEDIUM",
    });
    recommendations.push({
      type: "NARROW_SPREAD",
      action: "SELL",
      orderType: "LIMIT",
      quantity: 1.0,
      price: midPrice + spread * 0.1,
      reason: `Place competitive ask to narrow spread (current: ${formatNumber(
        spread,
        4
      )})`,
      priority: "MEDIUM",
    });
  }

  // Recommendation 3: Balance order book
  if (Math.abs(imbalance) > 5.0) {
    const side = imbalance > 0 ? "SELL" : "BUY";
    const price = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 1.0;
    recommendations.push({
      type: "BALANCE_BOOK",
      action: side,
      orderType: "LIMIT",
      quantity: Math.abs(imbalance) * 0.5,
      price: price,
      reason: `Balance order book (current imbalance: ${formatNumber(
        imbalance,
        2
      )})`,
      priority: "LOW",
    });
  }

  // Recommendation 4: Create initial liquidity if no orders exist
  if (buyOrders.length === 0 && sellOrders.length === 0) {
    const basePrice = orderBookStats?.marketStats?.lastPrice
      ? parseFloat(ethers.formatEther(orderBookStats.marketStats.lastPrice))
      : 30.0; // Default silver price

    recommendations.push({
      type: "CREATE_LIQUIDITY",
      action: "BUY",
      orderType: "LIMIT",
      quantity: 10.0,
      price: basePrice * 0.95, // 5% below last price
      reason: "Create initial buy-side liquidity",
      priority: "HIGH",
    });
    recommendations.push({
      type: "CREATE_LIQUIDITY",
      action: "SELL",
      orderType: "LIMIT",
      quantity: 10.0,
      price: basePrice * 1.05, // 5% above last price
      reason: "Create initial sell-side liquidity",
      priority: "HIGH",
    });
  }

  return recommendations;
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

async function analyzeBlockchainOrders() {
  console.log("🔍 ANALYZING BLOCKCHAIN ORDERS AND MARKET CONDITIONS");
  console.log("=".repeat(80));

  try {
    // Step 1: Check database tables
    const existingTables = await checkDatabaseTables();

    // Step 2: Get markets from database if available
    const markets = existingTables.includes("orderbook_markets_view")
      ? await getActiveMarkets()
      : [];
    console.log(`\n📊 Found ${markets.length} markets in database`);

    // Step 3: Initialize blockchain provider and contracts
    console.log("\n🔗 CONNECTING TO BLOCKCHAIN:");
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const orderRouter = new ethers.Contract(
      CONTRACTS.orderRouter,
      ORDER_ROUTER_ABI,
      provider
    );

    console.log(`   📍 OrderRouter: ${CONTRACTS.orderRouter}`);
    console.log(`   🌐 RPC: ${POLYGON_RPC}`);

    // Step 4: Get all active orders from blockchain
    const allOrders = await getAllActiveOrdersFromContract(
      provider,
      orderRouter
    );

    if (allOrders.length === 0) {
      console.log("\n❌ No active orders found on blockchain");
      console.log("\n🎯 RECOMMENDATIONS FOR EMPTY ORDER BOOK:");
      console.log("   1. Place initial BUY limit order at $28.50 for 10 units");
      console.log(
        "   2. Place initial SELL limit order at $31.50 for 10 units"
      );
      console.log(
        "   3. This will create a 3.00 spread (~10%) for initial trading"
      );
      console.log("   4. Consider placing market orders to test the system");
      return;
    }

    // Step 5: Group orders by market/metricId
    const ordersByMetric = {};
    allOrders.forEach((order) => {
      const metricId = order.metricId;
      if (!ordersByMetric[metricId]) {
        ordersByMetric[metricId] = [];
      }
      ordersByMetric[metricId].push(order);
    });

    // Step 6: Analyze each market
    for (const [metricId, orders] of Object.entries(ordersByMetric)) {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`🎯 ANALYZING MARKET: ${metricId}`);
      console.log(`   📝 Active Orders: ${orders.length}`);
      console.log(`${"=".repeat(80)}`);

      // Get market info from database
      const market = markets.find((m) => m.metric_id === metricId);
      if (market) {
        console.log(`   📝 Description: ${market.description}`);
        console.log(`   📊 Status: ${market.market_status}`);
        console.log(
          `   💰 Last Price: $${
            market.last_trade_price
              ? formatNumber(market.last_trade_price, 4)
              : "None"
          }`
        );
        console.log(`   📈 Volume: ${formatNumber(market.total_volume || 0)}`);
      }

      // Get order book stats from contract
      let orderBookStats = null;
      if (market?.market_address) {
        orderBookStats = await getOrderBookStats(
          provider,
          market.market_address
        );
      }

      // Display order details
      console.log(`\n📋 ACTIVE ORDERS:`);
      orders.forEach((order, index) => {
        const remaining = calculateRemainingQuantity(
          order.quantity,
          order.filledQuantity
        );
        const status = decodeOrderStatus(order.status);
        const side = decodeOrderSide(order.side);
        const type = decodeOrderType(order.orderType);
        const price = formatPrice(order.price, 18);

        console.log(
          `   ${index + 1}. ${side} ${type} - ${formatNumber(
            remaining,
            4
          )} @ $${price} (${status})`
        );
        console.log(`      🆔 Order ID: ${order.orderId.toString()}`);
        console.log(`      👤 Trader: ${order.trader}`);
        console.log(`      📅 Created: ${formatTimestamp(order.timestamp)}`);
      });

      // Analyze order book
      const analysis = analyzeOrderBook(orders);

      // Generate recommendations
      const recommendations = generateTradingRecommendations(
        analysis,
        orderBookStats
      );

      if (recommendations.length > 0) {
        console.log(`\n🎯 TRADING RECOMMENDATIONS:`);
        recommendations.forEach((rec, index) => {
          console.log(
            `\n   ${index + 1}. ${rec.priority} PRIORITY - ${rec.type}`
          );
          console.log(`      📝 Action: ${rec.action} ${rec.orderType}`);
          console.log(`      📏 Quantity: ${formatNumber(rec.quantity, 4)}`);
          if (rec.price)
            console.log(`      💰 Price: $${formatNumber(rec.price, 4)}`);
          if (rec.targetPrice)
            console.log(
              `      🎯 Target: $${formatNumber(rec.targetPrice, 4)}`
            );
          console.log(`      💡 Reason: ${rec.reason}`);
          if (rec.targetOrderId)
            console.log(`      🆔 Target Order: ${rec.targetOrderId}`);
        });

        // Generate specific command examples
        console.log(`\n💻 EXAMPLE COMMANDS:`);
        recommendations.slice(0, 3).forEach((rec, index) => {
          if (rec.orderType === "MARKET") {
            console.log(`   ${index + 1}. Market ${rec.action}:`);
            console.log(
              `      node scripts/post-order.cjs ${metricId} ${rec.orderType} ${rec.action} ${rec.quantity}`
            );
          } else {
            console.log(`   ${index + 1}. Limit ${rec.action}:`);
            console.log(
              `      node scripts/post-order.cjs ${metricId} ${rec.orderType} ${rec.action} ${rec.quantity} ${rec.price}`
            );
          }
        });
      } else {
        console.log(`\n   ℹ️  No specific recommendations for this market`);
      }
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("✅ BLOCKCHAIN ANALYSIS COMPLETE");
    console.log(`${"=".repeat(80)}`);
  } catch (error) {
    console.error("❌ Analysis failed:", error.message);
    console.error(error.stack);
  }
}

// Run the analysis
if (require.main === module) {
  analyzeBlockchainOrders().catch(console.error);
}

module.exports = { analyzeBlockchainOrders };
