#!/usr/bin/env node

/**
 * Debug Blockchain Submission
 * Check why submitOrderToBlockchain is failing
 */

// Load environment variables
require("dotenv").config({ path: ".env.local" });

async function debugBlockchainSubmission() {
  console.log("🔍 Debugging Blockchain Submission");
  console.log("=".repeat(50));

  // Check environment
  console.log("📋 Environment Check:");
  console.log(
    `  - SETTLEMENT_PRIVATE_KEY: ${
      process.env.SETTLEMENT_PRIVATE_KEY ? "[SET]" : "[MISSING]"
    }`
  );
  console.log(`  - RPC_URL: ${process.env.RPC_URL || "[MISSING]"}`);
  console.log(`  - CHAIN_ID: ${process.env.CHAIN_ID || "[MISSING]"}`);

  // Test blockchain connection
  console.log("\n🔗 Testing Blockchain Connection:");

  try {
    const { createPublicClient, http } = require("viem");
    const { polygon } = require("viem/chains");

    const publicClient = createPublicClient({
      chain: polygon,
      transport: http(process.env.RPC_URL),
    });

    console.log("📡 Testing RPC connection...");
    const blockNumber = await publicClient.getBlockNumber();
    console.log(`✅ Connected to Polygon! Latest block: ${blockNumber}`);

    const gasPrice = await publicClient.getGasPrice();
    console.log(`⛽ Current gas price: ${gasPrice.toString()} wei`);

    // Test wallet if private key is available
    if (process.env.SETTLEMENT_PRIVATE_KEY) {
      const { privateKeyToAccount } = require("viem/accounts");
      const account = privateKeyToAccount(process.env.SETTLEMENT_PRIVATE_KEY);
      console.log(`💼 Settlement wallet: ${account.address}`);

      const balance = await publicClient.getBalance({
        address: account.address,
      });
      console.log(`💰 Wallet balance: ${Number(balance) / 1e18} MATIC`);

      if (balance < BigInt(1e15)) {
        console.log("⚠️  LOW BALANCE: Wallet needs more MATIC for gas fees");
      } else {
        console.log("✅ Sufficient balance for transactions");
      }
    }
  } catch (error) {
    console.error("❌ Blockchain connection failed:", error.message);
  }

  // Check market configuration
  console.log("\n📊 Market Configuration:");

  try {
    const { createClient } = require("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: market, error } = await supabase
      .from("orderbook_markets")
      .select(
        "metric_id, order_router_address, central_vault_address, market_status"
      )
      .eq("metric_id", "SILVER_V2")
      .single();

    if (error) {
      console.error("❌ Failed to fetch market:", error.message);
    } else {
      console.log("✅ Market found:");
      console.log(`  - Metric ID: ${market.metric_id}`);
      console.log(`  - Status: ${market.market_status}`);
      console.log(`  - OrderRouter: ${market.order_router_address}`);
      console.log(`  - CentralVault: ${market.central_vault_address}`);

      if (!market.order_router_address) {
        console.log("❌ CRITICAL: OrderRouter address is missing!");
      }
      if (!market.central_vault_address) {
        console.log("❌ CRITICAL: CentralVault address is missing!");
      }
    }
  } catch (error) {
    console.error("❌ Database check failed:", error.message);
  }

  console.log("\n🎯 Diagnosis Complete");
}

debugBlockchainSubmission().catch((error) => {
  console.error("💥 Debug script failed:", error);
  process.exit(1);
});





