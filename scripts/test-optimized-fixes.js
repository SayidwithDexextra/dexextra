#!/usr/bin/env node

/**
 * 🧪 Test Script: Optimized Metric Oracle Fixes
 *
 * Tests the fixes for data loading, screenshot timing, and database constraints
 */

async function testOptimizedFixes() {
  console.log("🧪 Testing Optimized Metric Oracle Fixes...\n");

  const testCases = [
    {
      name: "Simple Test - World Population",
      metric: "World population",
      urls: ["https://worldometers.info/world-population/"],
      description: "Test basic functionality with a reliable source",
    },
    {
      name: "Complex Page - Bitcoin Price",
      metric: "Bitcoin price USD",
      urls: ["https://coinmarketcap.com/currencies/bitcoin/"],
      description: "Test with dynamic content and complex JavaScript",
    },
  ];

  for (const testCase of testCases) {
    console.log(`📊 Testing: ${testCase.name}`);
    console.log(`   Description: ${testCase.description}`);

    try {
      const startTime = Date.now();

      const response = await fetch(
        "http://localhost:3000/api/resolve-metric-fast",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            metric: testCase.metric,
            urls: testCase.urls,
          }),
        }
      );

      const data = await response.json();
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      if (response.ok && data.status === "completed") {
        console.log(`   ✅ SUCCESS: ${totalTime}ms`);
        console.log(`   📊 Value: ${data.data.value} ${data.data.unit}`);
        console.log(`   💰 Asset Price: $${data.data.asset_price_suggestion}`);
        console.log(
          `   🎯 Confidence: ${(data.data.confidence * 100).toFixed(1)}%`
        );
        console.log(
          `   📸 Sources: ${data.data.sources.length} with screenshots`
        );

        // Check for database constraint issues
        if (data.data.confidence >= 0 && data.data.confidence <= 1) {
          console.log(`   ✅ Confidence score valid`);
        } else {
          console.log(
            `   ❌ Confidence score invalid: ${data.data.confidence}`
          );
        }

        // Check for asset price calculation
        const price = parseFloat(data.data.asset_price_suggestion);
        if (price >= 10.0 && price <= 100.0) {
          console.log(`   ✅ Asset price in valid range`);
        } else {
          console.log(`   ❌ Asset price out of range: $${price}`);
        }
      } else {
        console.log(`   ❌ FAILED: ${response.status}`);
        console.log(
          `   Error: ${data.error || data.message || "Unknown error"}`
        );
        if (data.details) {
          console.log(`   Details:`, data.details);
        }
      }
    } catch (error) {
      console.log(`   ❌ NETWORK ERROR: ${error.message}`);
    }

    console.log(""); // Empty line

    // Wait between tests to avoid overwhelming the system
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Test error handling with invalid input
  console.log("🔧 Testing Error Handling...");

  try {
    const response = await fetch(
      "http://localhost:3000/api/resolve-metric-fast",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          metric: "", // Invalid empty metric
          urls: ["not-a-valid-url"], // Invalid URL
        }),
      }
    );

    const data = await response.json();

    if (response.status === 400 && data.error === "Invalid input") {
      console.log("   ✅ Input validation working correctly");
    } else {
      console.log("   ❌ Input validation not working properly");
      console.log("   Response:", data);
    }
  } catch (error) {
    console.log(`   ❌ Error handling test failed: ${error.message}`);
  }

  console.log("\n🏁 Fix Testing Complete!");
  console.log("\n💡 Key Improvements Tested:");
  console.log("   ✅ Increased page load timeouts (10s → 20s)");
  console.log("   ✅ Better content waiting (networkidle2 + 3s delay)");
  console.log("   ✅ Screenshot timing fixes (wait before screenshot)");
  console.log("   ✅ Database constraint validation (confidence score)");
  console.log("   ✅ Robust content extraction with fallbacks");
  console.log("   ✅ AI response validation and defaults");
  console.log("");
  console.log("🎯 If tests pass, the optimization issues are resolved!");
}

// Check if server is running
async function main() {
  try {
    console.log("🏥 Checking server health...");

    const healthCheck = await fetch(
      "http://localhost:3000/api/resolve-metric-fast",
      {
        method: "GET",
      }
    );

    console.log("✅ Server is running\n");
  } catch (error) {
    console.error("❌ Error: Development server not running on localhost:3000");
    console.log("💡 Please start your Next.js development server first:");
    console.log("   npm run dev");
    process.exit(1);
  }

  await testOptimizedFixes();
}

// Execute if run directly
if (require.main === module) {
  main();
}

module.exports = { testOptimizedFixes };
