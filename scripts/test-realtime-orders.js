#!/usr/bin/env node

/**
 * Test script to verify Supabase real-time orders functionality
 * This will help debug webhook transaction table updates
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing Supabase environment variables");
  console.error(
    "Please ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local"
  );
  process.exit(1);
}

console.log("🚀 Testing Supabase real-time orders functionality...");

const supabase = createClient(supabaseUrl, supabaseKey);

async function testRealtimeOrders() {
  console.log("📡 Setting up real-time subscription...");

  // Set up real-time subscription
  const channel = supabase
    .channel("test_orders_changes")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
      },
      (payload) => {
        console.log("🎉 Real-time event received:", {
          eventType: payload.eventType,
          orderId: payload.new?.order_id || payload.old?.order_id,
          marketId: payload.new?.market_id || payload.old?.market_id,
          trader: payload.new?.user_address || payload.old?.user_address,
          timestamp: new Date().toISOString(),
        });
      }
    )
    .subscribe((status) => {
      console.log(`📡 Subscription status: ${status}`);

      if (status === "SUBSCRIBED") {
        console.log("✅ Real-time subscription is working!");

        // Test inserting a mock order after a short delay
        setTimeout(insertTestOrder, 2000);
      } else if (status === "SUBSCRIPTION_ERROR") {
        console.error("❌ Real-time subscription failed");
      }
    });

  async function insertTestOrder() {
    console.log("🧪 Inserting test order to trigger real-time update...");

    const testOrder = {
      order_id: `test_${Date.now()}`,
      market_id: "SILVER_V1",
      user_address: "0x1234567890123456789012345678901234567890",
      trader_address: "0x1234567890123456789012345678901234567890",
      order_type: "LIMIT",
      side: "BUY",
      size: 10.5,
      quantity: 10.5,
      price: 25.5,
      filled: 0,
      status: "PENDING",
      margin_reserved: 267.75,
      tx_hash: "0xtest123",
      block_number: 12345,
      log_index: 1,
      contract_address: "0xtest_contract",
      event_type: "placed",
    };

    try {
      const { data, error } = await supabase
        .from("orders")
        .insert([testOrder])
        .select("*");

      if (error) {
        console.error("❌ Failed to insert test order:", error);
      } else {
        console.log("✅ Test order inserted successfully:", data[0]?.order_id);
        console.log(
          "💡 You should see a real-time event above if everything is working"
        );
      }
    } catch (err) {
      console.error("❌ Error inserting test order:", err);
    }

    // Clean up after 5 seconds
    setTimeout(cleanup, 5000);
  }

  async function cleanup() {
    console.log("🧹 Cleaning up test order...");

    try {
      await supabase.from("orders").delete().like("order_id", "test_%");

      console.log("✅ Test order cleaned up");
    } catch (err) {
      console.error("⚠️ Error cleaning up test order:", err);
    }

    // Remove subscription
    supabase.removeChannel(channel);
    console.log("✅ Test completed - real-time subscription removed");
    process.exit(0);
  }

  // Handle process termination
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

// Run the test
testRealtimeOrders().catch(console.error);

console.log("⏳ Waiting for real-time events... (Press Ctrl+C to exit)");
