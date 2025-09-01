#!/usr/bin/env node

/**
 * Trigger Test Market Order
 * This script will trigger a market order to test the complete placeOrder flow
 */

// Load environment variables
require("dotenv").config({ path: ".env.local" });

async function triggerTestOrder() {
  console.log("🚀 Triggering Test Market Order");
  console.log("=".repeat(50));

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  // Create a market BUY order that will match our $10 SELL limit order
  const testOrder = {
    metricId: "SILVER_V2",
    orderType: "MARKET",
    side: "BUY",
    quantity: "50", // Buy 50 units (will match against our 100 unit SELL order)
    timeInForce: "IOC", // Immediate or Cancel
    walletAddress: "0x9876543210987654321098765432109876543210", // Test buyer wallet
    signature: "0x" + "0".repeat(130), // Placeholder signature for testing
    nonce: 2001,
    timestamp: Date.now(),
  };

  console.log("📋 Test Market Order Details:");
  console.log("  - Market: SILVER_V2");
  console.log("  - Type: MARKET BUY");
  console.log("  - Quantity: 50 units");
  console.log("  - Expected Match: Against SELL 100 @ $10.00");
  console.log("  - Expected Result: BUY 50 @ $10.00");

  console.log("\n🔗 Submitting order to API...");

  try {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testOrder),
    });

    console.log(`📥 API Response Status: ${response.status}`);

    const result = await response.json();

    if (response.ok) {
      console.log("\n✅ ORDER PROCESSING SUCCESS!");
      console.log("📊 Result Details:");
      console.log(`  - Order ID: ${result.orderId}`);
      console.log(`  - Status: ${result.status}`);
      console.log(`  - Filled Quantity: ${result.filledQuantity}`);
      console.log(`  - Processing Time: ${result.processingTime}`);

      if (result.blockchainTxHash) {
        console.log(`\n🔗 BLOCKCHAIN TRANSACTION:`);
        console.log(`  - TX Hash: ${result.blockchainTxHash}`);
        console.log(
          `  - PolyScan: https://polygonscan.com/tx/${result.blockchainTxHash}`
        );
        console.log(`  - 🎯 SUCCESS: placeOrder() function was called!`);
      } else {
        console.log(`\n⚠️  No blockchain transaction hash returned`);
      }

      if (result.matches && result.matches.length > 0) {
        console.log(`\n📈 MATCHES FOUND:`);
        result.matches.forEach((match, i) => {
          console.log(`  ${i + 1}. Match ID: ${match.matchId}`);
          console.log(`     Price: $${match.price}`);
          console.log(`     Quantity: ${match.quantity}`);
          console.log(
            `     Timestamp: ${new Date(
              parseInt(match.timestamp)
            ).toISOString()}`
          );
        });
      }

      console.log("\n🎯 TEST RESULTS:");
      console.log("✅ Off-chain matching: WORKING");
      console.log(
        `${result.blockchainTxHash ? "✅" : "❌"} Blockchain submission: ${
          result.blockchainTxHash ? "WORKING" : "FAILED"
        }`
      );
      console.log(
        `${result.matches?.length > 0 ? "✅" : "❌"} Order matching: ${
          result.matches?.length > 0 ? "WORKING" : "FAILED"
        }`
      );
    } else {
      console.log("\n❌ ORDER PROCESSING FAILED!");
      console.log("📊 Error Details:");
      console.log(`  - Error: ${result.error}`);
      console.log(`  - Details: ${result.details}`);
      console.log(`  - Processing Time: ${result.processingTime}`);
    }
  } catch (error) {
    console.error("\n💥 Test failed with error:", error.message);

    if (error.message.includes("ECONNREFUSED")) {
      console.log("\n💡 Solution: Start the development server first:");
      console.log("   npm run dev");
      console.log("   Then run this test again.");
    }
  }
}

// Run the test
triggerTestOrder().catch((error) => {
  console.error("\n💥 Test script failed:", error);
  process.exit(1);
});





