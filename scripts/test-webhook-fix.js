#!/usr/bin/env node

// Load environment variables
require("dotenv").config({ path: ".env.local" });

console.log("🧪 TESTING WEBHOOK NULL BLOCK NUMBER FIX");
console.log("=========================================\n");

async function testWebhookFix() {
  const APP_URL = process.env.APP_URL;

  if (!APP_URL) {
    console.log("❌ APP_URL not set in environment");
    return;
  }

  console.log("📡 Testing webhook endpoint health...");

  try {
    // Test scalable webhook endpoint
    const scalableResponse = await fetch(
      `${APP_URL}/api/webhooks/alchemy/scalable`
    );
    const scalableData = await scalableResponse.json();

    if (scalableResponse.ok) {
      console.log("✅ Scalable webhook endpoint: HEALTHY");
      console.log(`   Status: ${scalableData.status}`);
      console.log(`   Message: ${scalableData.message}`);
    } else {
      console.log("❌ Scalable webhook endpoint: UNHEALTHY");
      console.log(`   Error: ${scalableData.error}`);
    }

    // Check recent events to see if the issue is resolved
    console.log("\n📊 Checking recent events...");
    const eventsResponse = await fetch(`${APP_URL}/api/events?limit=5`);
    const eventsData = await eventsResponse.json();

    if (eventsData.success) {
      console.log(`✅ Events API: WORKING`);
      console.log(`📈 Recent events: ${eventsData.events.length}`);

      if (eventsData.events.length > 0) {
        const latestEvent = eventsData.events[0];
        console.log(
          `   Latest: ${latestEvent.eventType} at block ${latestEvent.blockNumber}`
        );
        console.log(`   Transaction: ${latestEvent.transactionHash}`);

        // Check if block number is valid (not null/0)
        if (latestEvent.blockNumber && latestEvent.blockNumber > 0) {
          console.log("✅ Block number validation: PASSED");
        } else {
          console.log("⚠️ Block number validation: FAILED (still null/0)");
        }
      }
    } else {
      console.log("❌ Events API: FAILED");
    }
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
  }

  console.log("\n💡 NEXT STEPS:");
  console.log("1. Make a transaction in your Remix contract");
  console.log("2. Wait 30-60 seconds for webhook processing");
  console.log('3. Check: curl "' + APP_URL + '/api/events?limit=1"');
  console.log("4. Verify the event has a valid block_number > 0");

  console.log("\n🔧 If you still see issues:");
  console.log("- Check webhook logs in console/Vercel logs");
  console.log("- Ensure Remix is connected to Polygon Mainnet");
  console.log("- Verify transaction appears on Polygonscan");
}

// Run the test
testWebhookFix().catch(console.error);
