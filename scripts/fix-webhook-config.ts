#!/usr/bin/env tsx

/**
 * Fix Webhook Configuration Script
 * 
 * This script fixes the webhook configuration in the database to ensure
 * the successfully created Address Activity webhook is properly loaded.
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

async function fixWebhookConfig() {
  try {
    console.log("🔧 Fixing webhook configuration...\n");

    // Dynamic imports for ESM modules
    const { EventDatabase } = await import("../src/lib/eventDatabase.ts");

    const database = new EventDatabase();

    // Get current contracts
    const contracts = await database.getDeployedVAMMContracts();
    console.log(`📋 Found ${contracts.length} contracts to configure`);

    // Create webhook configuration with the successfully created Address Activity webhook
    const webhookConfig = {
      addressActivityWebhookId: "wh_knzudxkfpvzbbj55", // From the successful migration
      minedTransactionWebhookId: "", // Empty since this failed
      contracts: contracts.map((c) => ({
        address: c.address,
        name: c.name,
        type: c.type,
      })),
      createdAt: new Date(),
      network: process.env.DEFAULT_NETWORK || "polygon",
      chainId: process.env.CHAIN_ID || "137",
    };

    // Store the webhook configuration
    await database.storeWebhookConfig(webhookConfig);
    console.log("✅ Webhook configuration fixed successfully");

    // Verify the configuration
    const storedConfig = await database.getWebhookConfig();
    if (storedConfig) {
      console.log("\n📋 Verification - Stored configuration:");
      console.log(`  - Address Activity Webhook: ${storedConfig.addressActivityWebhookId}`);
      console.log(`  - Mined Transaction Webhook: ${storedConfig.minedTransactionWebhookId || 'None'}`);
      console.log(`  - Contracts monitored: ${storedConfig.contracts.length}`);
      console.log(`  - Network: ${storedConfig.network}`);
      console.log(`  - Chain ID: ${storedConfig.chainId}`);
    } else {
      console.error("❌ Failed to verify stored configuration");
    }

  } catch (error) {
    console.error("❌ Failed to fix webhook configuration:", error);
    process.exit(1);
  }
}

fixWebhookConfig().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
}); 