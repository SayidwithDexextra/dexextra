#!/usr/bin/env node

/**
 * Order Provider & Positions Investigation Script
 *
 * This script investigates current open orders and positions from smart contracts
 * and ensures alignment with Supabase backend database.
 *
 * Features:
 * - Queries all active orders from OrderRouter contract
 * - Fetches positions from OrderBook contracts
 * - Cross-references with Supabase database
 * - Identifies discrepancies and sync issues
 * - Provides detailed analysis and recommendations
 */

const { ethers } = require("ethers");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

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

// Supabase Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ============================================================================
// CONTRACT ABIS
// ============================================================================

const ORDER_ROUTER_ABI = [
  "function getOrder(uint256 orderId) external view returns (tuple(uint256 orderId, address trader, string metricId, uint8 orderType, uint8 side, uint256 quantity, uint256 price, uint256 filledQuantity, uint256 timestamp, uint256 expiryTime, uint8 status, uint8 timeInForce, uint256 stopPrice, uint256 icebergQty, bool postOnly, bytes32 metadataHash))",
  "function getUserActiveOrders(address trader) external view returns (tuple(uint256 orderId, address trader, string metricId, uint8 orderType, uint8 side, uint256 quantity, uint256 price, uint256 filledQuantity, uint256 timestamp, uint256 expiryTime, uint8 status, uint8 timeInForce, uint256 stopPrice, uint256 icebergQty, bool postOnly, bytes32 metadataHash)[])",
  "function getUserOrderHistory(address trader, uint256 limit, uint256 offset) external view returns (tuple(uint256 orderId, address trader, string metricId, uint8 orderType, uint8 side, uint256 quantity, uint256 price, uint256 filledQuantity, uint256 timestamp, uint256 expiryTime, uint8 status, uint8 timeInForce, uint256 stopPrice, uint256 icebergQty, bool postOnly, bytes32 metadataHash)[])",
  "function getUserPnL(address trader, string calldata metricId) external view returns (tuple(int256 realizedPnL, int256 unrealizedPnL, uint256 totalVolume, uint256 totalFees, uint256 totalTrades))",
  "function getOrderExecutions(uint256 orderId) external view returns (tuple(uint256 orderId, uint256 executedQuantity, uint256 executedPrice, uint256 timestamp, address counterparty, uint256 fees)[])",
  "function orders(uint256 orderId) external view returns (tuple(uint256 orderId, address trader, string metricId, uint8 orderType, uint8 side, uint256 quantity, uint256 price, uint256 filledQuantity, uint256 timestamp, uint256 expiryTime, uint8 status, uint8 timeInForce, uint256 stopPrice, uint256 icebergQty, bool postOnly, bytes32 metadataHash))",
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
    maximumFractionDigits: 2,
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
  return side === 0 ? "BUY" : "SELL";
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

function decodeTimeInForce(tif) {
  const forces = ["GTC", "IOC", "FOK", "GTD"];
  return forces[tif] || `UNKNOWN(${tif})`;
}

// ============================================================================
// MAIN INVESTIGATION FUNCTION
// ============================================================================

async function investigateOrdersAndPositions() {
  console.log("🔍 ORDER PROVIDER & POSITIONS INVESTIGATION");
  console.log("=".repeat(80));
  console.log(`🎯 Target Contracts:`);
  console.log(`   📋 Order Router: ${CONTRACTS.orderRouter}`);
  console.log(`   📊 Silver V4 OrderBook: ${CONTRACTS.silverV4OrderBook}`);
  console.log(`   🏦 Central Vault: ${CONTRACTS.centralVault}`);
  console.log(`   👤 Target Wallet: ${CONTRACTS.deployerAddress}`);
  console.log("=".repeat(80));

  // Initialize provider and contracts
  const provider = new ethers.JsonRpcProvider(POLYGON_RPC);

  const orderRouter = new ethers.Contract(
    CONTRACTS.orderRouter,
    ORDER_ROUTER_ABI,
    provider
  );
  const orderBook = new ethers.Contract(
    CONTRACTS.silverV4OrderBook,
    ORDER_BOOK_ABI,
    provider
  );
  const centralVault = new ethers.Contract(
    CONTRACTS.centralVault,
    CENTRAL_VAULT_ABI,
    provider
  );

  // Initialize Supabase client
  let supabase = null;
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    console.log("✅ Supabase client initialized");
  } else {
    console.log("⚠️  Supabase not configured - skipping database checks");
  }

  try {
    console.log("\n📊 STEP 1: SMART CONTRACT ORDER ANALYSIS");
    console.log("-".repeat(60));

    // Get your active orders
    const activeOrders = await orderRouter.getUserActiveOrders(
      CONTRACTS.deployerAddress
    );
    console.log(`📝 Your Active Orders: ${activeOrders.length}`);

    // Get your order history (last 10)
    const orderHistory = await orderRouter.getUserOrderHistory(
      CONTRACTS.deployerAddress,
      10,
      0
    );
    console.log(`📚 Your Order History (last 10): ${orderHistory.length}`);

    // Analyze each active order
    const orderAnalysis = [];
    for (let i = 0; i < activeOrders.length; i++) {
      const order = activeOrders[i];
      const analysis = {
        orderId: order.orderId.toString(),
        trader: order.trader,
        metricId: order.metricId,
        orderType: decodeOrderType(order.orderType),
        side: decodeOrderSide(order.side),
        quantity: formatPrice(order.quantity),
        price: formatPrice(order.price),
        filledQuantity: formatPrice(order.filledQuantity),
        timestamp: formatTimestamp(order.timestamp),
        status: decodeOrderStatus(order.status),
        timeInForce: decodeTimeInForce(order.timeInForce),
        postOnly: order.postOnly,
        rawData: {
          quantity: order.quantity.toString(),
          price: order.price.toString(),
          filledQuantity: order.filledQuantity.toString(),
          timestamp: order.timestamp.toString(),
        },
      };
      orderAnalysis.push(analysis);

      console.log(`\n   📋 Order #${i + 1} (ID: ${analysis.orderId}):`);
      console.log(`      🎯 Metric: ${analysis.metricId}`);
      console.log(`      📊 Type: ${analysis.orderType}`);
      console.log(`      ↔️  Side: ${analysis.side}`);
      console.log(`      📏 Quantity: ${analysis.quantity}`);
      console.log(`      💰 Price: $${analysis.price}`);
      console.log(`      ✅ Filled: ${analysis.filledQuantity}`);
      console.log(`      📅 Created: ${analysis.timestamp}`);
      console.log(`      🏷️  Status: ${analysis.status}`);
      console.log(`      ⏰ Time in Force: ${analysis.timeInForce}`);
    }

    console.log("\n📊 STEP 2: POSITION ANALYSIS");
    console.log("-".repeat(60));

    // Try to get positions from OrderBook (if method exists)
    let positions = [];
    try {
      positions = await orderBook.getUserPositions(CONTRACTS.deployerAddress);
      console.log(`📊 Your Positions: ${positions.length}`);

      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        console.log(`\n   📊 Position #${i + 1}:`);
        console.log(`      👤 Trader: ${pos.trader}`);
        console.log(`      📈 Direction: ${pos.isLong ? "LONG" : "SHORT"}`);
        console.log(`      📏 Quantity: ${formatPrice(pos.quantity)}`);
        console.log(`      💰 Entry Price: $${formatPrice(pos.entryPrice)}`);
        console.log(`      🔒 Collateral: ${formatUsdc(pos.collateral)}`);
        console.log(`      ✅ Settled: ${pos.isSettled}`);
        if (pos.isSettled) {
          console.log(`      💸 Payout: ${formatUsdc(pos.payout)}`);
        }
      }
    } catch (error) {
      console.log(`⚠️  Could not fetch positions: ${error.message}`);
      console.log(
        `ℹ️  This might be normal if no positions exist or method not available`
      );
    }

    console.log("\n📊 STEP 3: P&L ANALYSIS");
    console.log("-".repeat(60));

    try {
      // Get P&L for Silver V4 market
      const pnlData = await orderRouter.getUserPnL(
        CONTRACTS.deployerAddress,
        CONTRACTS.silverV4MetricId
      );

      console.log(`💰 P&L Summary for ${CONTRACTS.silverV4MetricId}:`);
      console.log(
        `   📊 Realized P&L: ${formatUsdc(pnlData.realizedPnL)} USDC`
      );
      console.log(
        `   📈 Unrealized P&L: ${formatUsdc(pnlData.unrealizedPnL)} USDC`
      );
      console.log(
        `   📊 Total Volume: ${formatUsdc(pnlData.totalVolume)} USDC`
      );
      console.log(`   💸 Total Fees: ${formatUsdc(pnlData.totalFees)} USDC`);
      console.log(`   🔄 Total Trades: ${pnlData.totalTrades.toString()}`);
    } catch (error) {
      console.log(`⚠️  Could not fetch P&L data: ${error.message}`);
    }

    console.log("\n📊 STEP 4: EXECUTION HISTORY");
    console.log("-".repeat(60));

    // Check executions for each order
    for (const order of orderAnalysis) {
      try {
        const executions = await orderRouter.getOrderExecutions(order.orderId);
        if (executions.length > 0) {
          console.log(`\n   🎯 Executions for Order ${order.orderId}:`);
          executions.forEach((exec, index) => {
            console.log(`      📋 Execution #${index + 1}:`);
            console.log(
              `         📏 Quantity: ${formatPrice(exec.executedQuantity)}`
            );
            console.log(
              `         💰 Price: $${formatPrice(exec.executedPrice)}`
            );
            console.log(`         📅 Time: ${formatTimestamp(exec.timestamp)}`);
            console.log(`         👤 Counterparty: ${exec.counterparty}`);
            console.log(`         💸 Fees: ${formatUsdc(exec.fees)} USDC`);
          });
        }
      } catch (error) {
        console.log(`   ⚠️  No executions found for Order ${order.orderId}`);
      }
    }

    if (supabase) {
      console.log("\n📊 STEP 5: SUPABASE DATABASE SYNC CHECK");
      console.log("-".repeat(60));

      // Check orderbook_markets table
      const { data: markets, error: marketsError } = await supabase
        .from("orderbook_markets")
        .select("*")
        .eq("metric_id", CONTRACTS.silverV4MetricId);

      if (marketsError) {
        console.log(`❌ Error fetching markets: ${marketsError.message}`);
      } else {
        console.log(`📊 Markets in Database: ${markets?.length || 0}`);
        if (markets && markets.length > 0) {
          const market = markets[0];
          console.log(`   🎯 Market ID: ${market.id}`);
          console.log(`   📝 Description: ${market.description}`);
          console.log(`   🏷️  Category: ${market.category}`);
          console.log(`   📊 Status: ${market.market_status}`);
          console.log(`   📍 Contract: ${market.market_address}`);
          console.log(`   ⚡ Chain ID: ${market.chain_id}`);
        }
      }

      // Check market_orders table
      const { data: dbOrders, error: ordersError } = await supabase
        .from("market_orders")
        .select("*")
        .eq("trader_wallet_address", CONTRACTS.deployerAddress.toLowerCase());

      if (ordersError) {
        console.log(`❌ Error fetching orders: ${ordersError.message}`);
      } else {
        console.log(`\n📝 Orders in Database: ${dbOrders?.length || 0}`);

        // Compare with smart contract orders
        const contractOrderIds = orderAnalysis.map((o) => parseInt(o.orderId));
        const dbOrderIds = dbOrders?.map((o) => o.order_id) || [];

        console.log(`📊 Contract Order IDs: [${contractOrderIds.join(", ")}]`);
        console.log(`📊 Database Order IDs: [${dbOrderIds.join(", ")}]`);

        // Find discrepancies
        const missingInDb = contractOrderIds.filter(
          (id) => !dbOrderIds.includes(id)
        );
        const extraInDb = dbOrderIds.filter(
          (id) => !contractOrderIds.includes(id)
        );

        if (missingInDb.length > 0) {
          console.log(
            `⚠️  Orders missing in database: [${missingInDb.join(", ")}]`
          );
        }
        if (extraInDb.length > 0) {
          console.log(
            `⚠️  Extra orders in database: [${extraInDb.join(", ")}]`
          );
        }
        if (missingInDb.length === 0 && extraInDb.length === 0) {
          console.log(`✅ Order sync is perfect!`);
        }

        // Show database order details
        if (dbOrders && dbOrders.length > 0) {
          console.log(`\n📋 Database Order Details:`);
          dbOrders.forEach((dbOrder, index) => {
            console.log(`   Order #${index + 1} (DB ID: ${dbOrder.id}):`);
            console.log(`      🆔 Order ID: ${dbOrder.order_id}`);
            console.log(`      📊 Type: ${dbOrder.order_type}`);
            console.log(`      ↔️  Side: ${dbOrder.side}`);
            console.log(`      📏 Quantity: ${dbOrder.quantity}`);
            console.log(`      💰 Price: $${dbOrder.price || "N/A"}`);
            console.log(`      ✅ Filled: ${dbOrder.filled_quantity}`);
            console.log(`      🏷️  Status: ${dbOrder.order_status}`);
            console.log(`      📅 Created: ${dbOrder.created_at}`);
            console.log(`      📅 Updated: ${dbOrder.updated_at}`);
          });
        }
      }

      // Check market_positions table
      const { data: dbPositions, error: positionsError } = await supabase
        .from("market_positions")
        .select("*")
        .eq("trader_wallet_address", CONTRACTS.deployerAddress.toLowerCase());

      if (positionsError) {
        console.log(`❌ Error fetching positions: ${positionsError.message}`);
      } else {
        console.log(`\n📊 Positions in Database: ${dbPositions?.length || 0}`);

        if (dbPositions && dbPositions.length > 0) {
          console.log(`📋 Database Position Details:`);
          dbPositions.forEach((dbPos, index) => {
            console.log(`   Position #${index + 1} (DB ID: ${dbPos.id}):`);
            console.log(`      🆔 Position ID: ${dbPos.position_id}`);
            console.log(
              `      📈 Direction: ${dbPos.is_long ? "LONG" : "SHORT"}`
            );
            console.log(`      📏 Quantity: ${dbPos.quantity}`);
            console.log(`      💰 Entry Price: $${dbPos.entry_price}`);
            console.log(`      🔒 Collateral: ${dbPos.collateral}`);
            console.log(`      ✅ Settled: ${dbPos.is_settled}`);
            console.log(`      📅 Created: ${dbPos.created_at}`);
            if (dbPos.is_settled) {
              console.log(`      💸 Payout: ${dbPos.settlement_payout}`);
              console.log(`      📊 P&L: ${dbPos.settlement_pnl}`);
              console.log(`      📅 Settled: ${dbPos.settled_at}`);
            }
          });
        }
      }
    }

    console.log("\n📊 STEP 6: VAULT BALANCE CHECK");
    console.log("-".repeat(60));

    const userBalance = await centralVault.getUserBalance(
      CONTRACTS.deployerAddress,
      CONTRACTS.mockUSDC
    );
    console.log(`💰 Your Vault Balance:`);
    console.log(`   💰 Available: $${formatUsdc(userBalance.available)} USDC`);
    console.log(`   🔒 Allocated: $${formatUsdc(userBalance.allocated)} USDC`);
    console.log(`   ⏳ Locked: $${formatUsdc(userBalance.locked)} USDC`);
    console.log(
      `   📊 Total: $${formatUsdc(
        userBalance.available + userBalance.allocated + userBalance.locked
      )} USDC`
    );

    console.log("\n💡 STEP 7: ANALYSIS & RECOMMENDATIONS");
    console.log("-".repeat(60));

    console.log(`📊 SUMMARY:`);
    console.log(`   📝 Active Orders: ${activeOrders.length}`);
    console.log(`   📚 Order History: ${orderHistory.length}`);
    console.log(`   📊 Positions: ${positions.length}`);
    console.log(
      `   🏦 Vault Balance: $${formatUsdc(
        userBalance.available + userBalance.allocated + userBalance.locked
      )} USDC`
    );

    if (supabase) {
      console.log(
        `   🗄️  Database Sync: ${
          missingInDb?.length === 0 && extraInDb?.length === 0
            ? "✅ Perfect"
            : "⚠️  Issues found"
        }`
      );
    }

    console.log(`\n🎯 RECOMMENDATIONS:`);
    if (activeOrders.length > 0) {
      console.log(
        `   1. ✅ You have ${activeOrders.length} active order(s) - monitor for execution`
      );
    } else {
      console.log(
        `   1. ℹ️  No active orders - consider placing test orders to verify system`
      );
    }

    if (positions.length > 0) {
      console.log(
        `   2. ✅ You have ${positions.length} position(s) - monitor P&L and settlement`
      );
    } else {
      console.log(`   2. ℹ️  No open positions - normal for pending orders`);
    }

    if (supabase && (missingInDb?.length > 0 || extraInDb?.length > 0)) {
      console.log(
        `   3. ⚠️  Database sync issues detected - consider running webhook processor`
      );
    } else if (supabase) {
      console.log(`   3. ✅ Database sync is perfect - all systems aligned`);
    }

    console.log(
      `   4. 🔧 For production: Ensure webhook endpoints are configured for real-time sync`
    );
    console.log(
      `   5. 📊 Monitor gas costs and transaction confirmations on Polygon`
    );

    console.log("\n📊 STEP 8: TECHNICAL DETAILS");
    console.log("-".repeat(60));
    console.log(`🔗 Network: Polygon Mainnet (Chain ID: 137)`);
    console.log(`⛽ RPC URL: ${POLYGON_RPC}`);
    console.log(
      `🗄️  Supabase: ${supabase ? "✅ Connected" : "❌ Not configured"}`
    );
    console.log(`📅 Investigation Time: ${new Date().toLocaleString()}`);
    console.log(`🔧 Script Version: 1.0.0`);
  } catch (error) {
    console.error(`❌ Investigation failed:`, error);
    console.error(`Stack trace:`, error.stack);
  }
}

// ============================================================================
// SCRIPT EXECUTION
// ============================================================================

if (require.main === module) {
  investigateOrdersAndPositions()
    .then(() => {
      console.log("\n✅ Investigation completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Investigation failed:", error);
      process.exit(1);
    });
}

module.exports = { investigateOrdersAndPositions };
