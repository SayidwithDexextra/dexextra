#!/usr/bin/env node

/**
 * Database Order Check Script
 *
 * This script checks the existing database tables for any orders or trades
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDatabaseOrders() {
  console.log("🔍 CHECKING DATABASE FOR EXISTING ORDERS AND TRADES");
  console.log("=".repeat(80));

  try {
    // Check off_chain_orders
    console.log("\n📋 CHECKING OFF-CHAIN ORDERS:");
    const { data: offChainOrders, error: offChainError } = await supabase
      .from("off_chain_orders")
      .select(
        `
        *,
        orderbook_markets!inner (
          metric_id,
          description,
          market_status
        )
      `
      )
      .order("created_at", { ascending: false });

    if (offChainError) {
      console.error(
        `❌ Error querying off_chain_orders: ${offChainError.message}`
      );
    } else {
      console.log(`✅ Found ${offChainOrders.length} off-chain orders`);

      if (offChainOrders.length > 0) {
        console.log("\n📝 OFF-CHAIN ORDERS DETAILS:");
        offChainOrders.forEach((order, index) => {
          console.log(`\n   ${index + 1}. Order ID: ${order.order_id}`);
          console.log(`      Market: ${order.orderbook_markets.metric_id}`);
          console.log(`      Type: ${order.order_type} ${order.side}`);
          console.log(`      Quantity: ${order.quantity}`);
          console.log(`      Price: $${order.price || "Market"}`);
          console.log(`      Filled: ${order.filled_quantity || 0}`);
          console.log(
            `      Remaining: ${order.remaining_quantity || order.quantity}`
          );
          console.log(`      Status: ${order.order_status}`);
          console.log(
            `      Created: ${new Date(order.created_at).toLocaleString()}`
          );
        });
      }
    }

    // Check trade_matches
    console.log("\n📊 CHECKING TRADE MATCHES:");
    const { data: tradeMatches, error: tradesError } = await supabase
      .from("trade_matches")
      .select(
        `
        *,
        orderbook_markets!inner (
          metric_id,
          description
        )
      `
      )
      .order("matched_at", { ascending: false })
      .limit(20);

    if (tradesError) {
      console.error(`❌ Error querying trade_matches: ${tradesError.message}`);
    } else {
      console.log(`✅ Found ${tradeMatches.length} trade matches`);

      if (tradeMatches.length > 0) {
        console.log("\n📈 RECENT TRADES:");
        tradeMatches.slice(0, 10).forEach((trade, index) => {
          console.log(`\n   ${index + 1}. Match ID: ${trade.match_id}`);
          console.log(`      Market: ${trade.orderbook_markets.metric_id}`);
          console.log(`      Price: $${trade.trade_price}`);
          console.log(`      Quantity: ${trade.trade_quantity}`);
          console.log(`      Value: $${trade.total_value}`);
          console.log(`      Buyer: ${trade.buy_trader_wallet_address}`);
          console.log(`      Seller: ${trade.sell_trader_wallet_address}`);
          console.log(`      Status: ${trade.settlement_status}`);
          console.log(
            `      Matched: ${new Date(trade.matched_at).toLocaleString()}`
          );
        });
      }
    }

    // Check orderbook_markets for any with orders or trades
    console.log("\n🏪 CHECKING MARKET STATISTICS:");
    const { data: markets, error: marketsError } = await supabase
      .from("orderbook_markets")
      .select("*")
      .order("total_volume", { ascending: false });

    if (marketsError) {
      console.error(`❌ Error querying markets: ${marketsError.message}`);
    } else {
      console.log(`✅ Found ${markets.length} markets`);

      markets.forEach((market, index) => {
        console.log(`\n   ${index + 1}. ${market.metric_id}`);
        console.log(`      Status: ${market.market_status}`);
        console.log(`      Volume: ${market.total_volume || 0}`);
        console.log(`      Trades: ${market.total_trades || 0}`);
        console.log(`      Last Price: $${market.last_trade_price || "None"}`);
        console.log(
          `      Open Interest Long: ${market.open_interest_long || 0}`
        );
        console.log(
          `      Open Interest Short: ${market.open_interest_short || 0}`
        );
        if (market.market_address) {
          console.log(`      Contract: ${market.market_address}`);
        }
      });
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("✅ DATABASE CHECK COMPLETE");
    console.log(`${"=".repeat(80)}`);
  } catch (error) {
    console.error("❌ Database check failed:", error.message);
    console.error(error.stack);
  }
}

// Run the check
if (require.main === module) {
  checkDatabaseOrders().catch(console.error);
}

module.exports = { checkDatabaseOrders };
