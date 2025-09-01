#!/usr/bin/env node

/**
 * Test to verify if submitToBlockchain function is being triggered
 * This will trace the entire settlement flow step by step
 */

require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSettlementBlockchainFlow() {
  console.log("🧪 TESTING SETTLEMENT BLOCKCHAIN SUBMISSION FLOW");
  console.log("=".repeat(60));

  try {
    // Step 1: Check if there are any pending trades to settle
    console.log("📊 Step 1: Checking for pending trade matches...");

    const { data: pendingTrades, error: pendingError } = await supabase
      .from("trade_matches")
      .select("*")
      .eq("settlement_status", "PENDING")
      .limit(5);

    if (pendingError) {
      console.log("❌ Error fetching pending trades:", pendingError.message);
      return;
    }

    console.log(`   Found ${pendingTrades?.length || 0} pending trade matches`);

    if (!pendingTrades || pendingTrades.length === 0) {
      console.log(
        "⚠️ No pending trades found. Let's check existing settlement queue items..."
      );
    }

    // Step 2: Check settlement queue before processing
    console.log("\n📊 Step 2: Checking settlement queue before processing...");

    const { data: queueBefore, error: queueBeforeError } = await supabase
      .from("settlement_queue")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(3);

    console.log(`   Settlement queue items: ${queueBefore?.length || 0}`);
    queueBefore?.forEach((item, i) => {
      console.log(
        `     ${i + 1}. ${item.id}: ${item.status} (${item.settlement_type})`
      );
    });

    // Step 3: Trigger settlement processing
    console.log("\n📊 Step 3: Triggering settlement processing...");

    const response = await fetch(
      "http://localhost:3000/api/admin/settlement/process",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true, dryRun: false }),
      }
    );

    if (!response.ok) {
      console.log("❌ Settlement API call failed:", response.status);
      const errorText = await response.text();
      console.log("   Error:", errorText);
      return;
    }

    const result = await response.json();
    console.log("✅ Settlement API response:", result);

    // Step 4: Check settlement queue after processing
    console.log("\n📊 Step 4: Checking settlement queue after processing...");

    // Wait a moment for processing
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const { data: queueAfter, error: queueAfterError } = await supabase
      .from("settlement_queue")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    console.log(`   Settlement queue items: ${queueAfter?.length || 0}`);
    queueAfter?.forEach((item, i) => {
      console.log(`     ${i + 1}. ${item.id}:`);
      console.log(`        Status: ${item.status}`);
      console.log(`        Attempts: ${item.attempts}/${item.max_attempts}`);
      console.log(`        TX Hash: ${item.transaction_hash || "None"}`);
      console.log(`        Last Error: ${item.last_error || "None"}`);
      console.log("");
    });

    // Step 5: Check if any trades were settled
    console.log("📊 Step 5: Checking settled trades...");

    const { data: settledTrades, error: settledError } = await supabase
      .from("trade_matches")
      .select("*")
      .eq("settlement_status", "SETTLED")
      .order("settled_at", { ascending: false })
      .limit(3);

    console.log(`   Recently settled trades: ${settledTrades?.length || 0}`);
    settledTrades?.forEach((trade, i) => {
      console.log(
        `     ${i + 1}. ${trade.trade_quantity} @ $${trade.trade_price}`
      );
      console.log(
        `        TX Hash: ${trade.settlement_transaction_hash || "None"}`
      );
      console.log(
        `        Settled: ${
          trade.settled_at
            ? new Date(trade.settled_at).toLocaleString()
            : "Not settled"
        }`
      );
    });

    // Step 6: Analysis
    console.log("\n🎯 ANALYSIS:");

    const hasNewSettlements =
      queueAfter?.some(
        (item) => item.status === "SUBMITTED" && item.transaction_hash
      ) || false;

    const hasBlockchainTxs =
      settledTrades?.some((trade) => trade.settlement_transaction_hash) ||
      false;

    if (hasNewSettlements || hasBlockchainTxs) {
      console.log("✅ SUCCESS: submitToBlockchain function IS being triggered");
      console.log(
        "   - Settlement queue shows SUBMITTED status with TX hashes"
      );
      console.log("   - Trades show settlement_transaction_hash");
      console.log("   - Blockchain transactions are being sent");
    } else {
      console.log("❌ ISSUE: submitToBlockchain function may NOT be triggered");
      console.log("   - No settlement queue items with TX hashes");
      console.log("   - No trades with settlement_transaction_hash");
      console.log("   - Check server logs for errors");
    }

    // Check for common issues
    const failedItems =
      queueAfter?.filter(
        (item) => item.status === "FAILED" || item.status === "RETRY_PENDING"
      ) || [];

    if (failedItems.length > 0) {
      console.log(`\n⚠️ Found ${failedItems.length} failed settlement items:`);
      failedItems.forEach((item, i) => {
        console.log(`   ${i + 1}. ${item.id}: ${item.status}`);
        console.log(`      Error: ${item.last_error || "Unknown"}`);
      });
    }

    // Step 7: Check server logs for debug messages
    console.log("\n📊 Step 7: Debug message verification:");
    console.log("   Check your server terminal for these debug messages:");
    console.log("   🚨 DEBUG: submitToBlockchain function HAS BEEN CALLED!");
    console.log("   🚨 DEBUG: processSettlementItem function HAS BEEN CALLED!");
    console.log(
      "   🔗 Recording trade execution on OrderRouter to update contract state..."
    );

    if (pendingTrades?.length === 0) {
      console.log("\n💡 TIP: To test with new trades:");
      console.log("   1. Place a new order through your UI");
      console.log("   2. Let it match with existing orders");
      console.log("   3. Run this test again to see settlement flow");
    }
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

// Run the test
testSettlementBlockchainFlow().catch(console.error);
