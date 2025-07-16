#!/usr/bin/env tsx

/**
 * Add Factory Contract to Webhook Script
 * 
 * Manually adds the vAMM Factory contract to the existing webhook
 * configuration in the database for dynamic contract monitoring.
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

async function addFactoryToWebhook() {
  try {
    console.log("🏭 Adding Factory Contract to Webhook Configuration...\n");

    // Dynamic imports for ESM modules
    const { EventDatabase } = await import("../src/lib/eventDatabase.ts");
    
    const database = new EventDatabase();
    
    // Factory contract details
    const factoryContract = {
      name: 'vAMM Factory',
      type: 'Factory',
      address: '0x70Cbc2F399A9E8d1fD4905dBA82b9C7653dfFc74'
    };
    
    console.log("📋 Factory Contract Details:");
    console.log(`   • Name: ${factoryContract.name}`);
    console.log(`   • Type: ${factoryContract.type}`);
    console.log(`   • Address: ${factoryContract.address}`);
    
    // Get current webhook configuration
    console.log("\n🔍 Getting current webhook configuration...");
    const webhookConfig = await database.getWebhookConfig();
    
    if (!webhookConfig) {
      console.error("❌ No webhook configuration found!");
      console.log("💡 Run 'npm run migrate-to-webhooks' first to create the webhook system");
      process.exit(1);
    }
    
    console.log(`✅ Found webhook config with ${(webhookConfig.contracts || []).length} existing contracts`);
    
    // Check if factory is already included
    const existingContracts = webhookConfig.contracts || [];
    const factoryExists = existingContracts.some(
      (contract: any) => contract.address.toLowerCase() === factoryContract.address.toLowerCase()
    );
    
    if (factoryExists) {
      console.log("✅ Factory contract is already in webhook configuration!");
      return;
    }
    
    // Add factory to contracts list
    const updatedContracts = [
      ...existingContracts,
      factoryContract
    ];
    
    console.log("\n➕ Adding factory contract to webhook configuration...");
    
    // Update webhook configuration in database
    await database.updateWebhookConfig({
      contracts: updatedContracts
    });
    
    console.log("✅ Factory contract added to webhook configuration!");
    console.log(`📊 Total contracts now monitored: ${updatedContracts.length}`);
    
    console.log("\n🎯 What this enables:");
    console.log("   • Factory contract events will now be processed by your webhook");
    console.log("   • MarketCreated events will trigger automatic new contract addition");
    console.log("   • Dynamic monitoring of newly deployed vAMM/Vault contracts");
    
    console.log("\n⚠️ Important Notes:");
    console.log("   • The webhook still monitors the original 14 contracts");
    console.log("   • Factory events will be detected in webhook logs");
    console.log("   • New contracts from factory will be added automatically");
    console.log("   • Alchemy webhook has not been updated (API limitation)");
    
    console.log("\n🧪 To test:");
    console.log("   1. Deploy a new market via your vAMM Factory");
    console.log("   2. Watch webhook logs for 'Factory contract activity detected'");
    console.log("   3. Look for 'MarketCreated event detected!' message");
    console.log("   4. New contracts will be processed and stored in database");

  } catch (error) {
    console.error("❌ Failed to add factory to webhook:", error);
    process.exit(1);
  }
}

// Run the script
addFactoryToWebhook(); 