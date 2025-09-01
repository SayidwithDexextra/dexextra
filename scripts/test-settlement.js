#!/usr/bin/env node

/**
 * Settlement System Test Script
 * Tests the complete settlement flow from pending trades to blockchain submission
 */

const { createClient } = require("@supabase/supabase-js");

// Load environment variables from .env.local
require("dotenv").config({ path: ".env.local" });

// Also try to load from .env as fallback
require("dotenv").config({ path: ".env" });

console.log("🔄 Environment loading debug:");
console.log(`  - .env.local exists: ${require("fs").existsSync(".env.local")}`);
console.log(`  - Current working directory: ${process.cwd()}`);
console.log(`  - NODE_ENV: ${process.env.NODE_ENV || "not set"}`);

// Environment variables check
function checkEnvironment() {
  console.log("🔍 Checking environment variables...");

  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SETTLEMENT_PRIVATE_KEY",
    "RPC_URL",
    "CHAIN_ID",
  ];

  const missing = [];
  const present = [];

  for (const key of required) {
    if (process.env[key]) {
      present.push(key);
      console.log(
        `✅ ${key}: ${
          key === "SETTLEMENT_PRIVATE_KEY" ? "[REDACTED]" : process.env[key]
        }`
      );
    } else {
      missing.push(key);
      console.log(`❌ ${key}: MISSING`);
    }
  }

  if (missing.length > 0) {
    console.log(
      `\n⚠️  Missing ${missing.length} required environment variables:`
    );
    missing.forEach((key) => console.log(`   - ${key}`));
    return false;
  }

  console.log(`\n✅ All ${present.length} environment variables are present`);
  return true;
}

// Test database connection
async function testDatabase() {
  console.log("\n🔍 Testing database connection...");

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Test connection with a simple query
    const { data, error } = await supabase
      .from("trade_matches")
      .select("id, settlement_status")
      .limit(1);

    if (error) {
      console.log("❌ Database connection failed:", error.message);
      return false;
    }

    console.log("✅ Database connection successful");
    return true;
  } catch (error) {
    console.log("❌ Database connection error:", error.message);
    return false;
  }
}

// Check trade matches status
async function checkTradeMatches() {
  console.log("\n📊 Checking trade matches status...");

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from("trade_matches")
      .select("settlement_status");

    if (error) {
      console.log("❌ Failed to fetch trade matches:", error.message);
      return false;
    }

    // Count by status
    const statusCounts = {};
    data.forEach((trade) => {
      statusCounts[trade.settlement_status] =
        (statusCounts[trade.settlement_status] || 0) + 1;
    });

    console.log("📈 Trade matches by status:");
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`);
    });

    const totalTrades = data.length;
    const pendingTrades = statusCounts["PENDING"] || 0;

    console.log(`\n📊 Total trades: ${totalTrades}`);
    console.log(`🔄 Pending trades: ${pendingTrades}`);

    return { totalTrades, pendingTrades, statusCounts };
  } catch (error) {
    console.log("❌ Error checking trade matches:", error.message);
    return false;
  }
}

// Test settlement endpoints
async function testEndpoints() {
  console.log("\n🌐 Testing settlement endpoints...");

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const endpoints = [
    "/api/admin/settlement/process",
    "/api/admin/settlement/force-pending",
    "/api/admin/settlement/start",
    "/api/admin/settlement/stop",
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: "GET",
      });

      if (response.ok) {
        console.log(`✅ ${endpoint}: Available`);
      } else {
        console.log(`⚠️  ${endpoint}: HTTP ${response.status}`);
      }
    } catch (error) {
      console.log(`❌ ${endpoint}: ${error.message}`);
    }
  }
}

// Main test function
async function main() {
  console.log("🚀 Settlement System Test\n");
  console.log("=".repeat(50));

  // Check environment
  const envOk = checkEnvironment();
  if (!envOk) {
    console.log("\n❌ Environment check failed. Please set missing variables.");
    process.exit(1);
  }

  // Test database
  const dbOk = await testDatabase();
  if (!dbOk) {
    console.log("\n❌ Database test failed.");
    process.exit(1);
  }

  // Check trade matches
  const tradesInfo = await checkTradeMatches();
  if (!tradesInfo) {
    console.log("\n❌ Trade matches check failed.");
    process.exit(1);
  }

  // Test endpoints (optional, might fail if server not running)
  await testEndpoints();

  console.log("\n" + "=".repeat(50));
  console.log("✅ Settlement system test completed");

  if (tradesInfo.pendingTrades > 0) {
    console.log(`\n🎯 Next steps:`);
    console.log(`   1. Start the development server: npm run dev`);
    console.log(`   2. Visit: http://localhost:3000/admin/settlement`);
    console.log(
      `   3. Click "🔗 Push to Blockchain" to process ${tradesInfo.pendingTrades} pending trades`
    );
  } else {
    console.log(`\n📝 No pending trades found. You can:`);
    console.log(`   1. Create some test trades through the orderbook`);
    console.log(
      `   2. Or use the admin panel to force trades to pending status`
    );
  }
}

// Run the test
main().catch((error) => {
  console.error("\n💥 Test script failed:", error);
  process.exit(1);
});
