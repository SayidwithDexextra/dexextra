#!/usr/bin/env node

/**
 * Update Webhooks with New Contracts
 * 
 * Recreates Alchemy webhooks to include all contracts from database.
 * Run this after new markets are deployed to ensure full monitoring.
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

async function updateWebhooksWithNewContracts() {
  try {
    console.log('🔄 Updating webhooks with all current contracts...\n');
    
    // Dynamic imports for ESM modules
    const { EventDatabase } = await import("../src/lib/eventDatabase");
    const { getAlchemyNotifyService } = await import("../src/services/alchemyNotifyService");
    
    const database = new EventDatabase();
    const alchemyNotify = getAlchemyNotifyService();
    
    // Get all contracts from database
    console.log('📋 Getting all contracts from database...');
    const config = await database.getWebhookConfig();
    
    if (!config || !config.contracts || config.contracts.length === 0) {
      console.log('❌ No contracts found in database configuration');
      return;
    }
    
    const allContracts = config.contracts;
    console.log(`✅ Found ${allContracts.length} contracts in database:`);
    allContracts.forEach((c, i) => {
      console.log(`   ${i+1}. ${c.name} (${c.type}) - ${c.address}`);
    });
    
    console.log('\n🗑️ Deleting existing webhooks...');
    try {
      // List current webhooks
      const webhooks = await alchemyNotify.listWebhooks();
      console.log(`Found ${webhooks.webhooks.length} existing webhooks`);
      
      // Delete existing webhooks
      for (const webhook of webhooks.webhooks) {
        try {
          await alchemyNotify.deleteWebhook(webhook.id);
          console.log(`✅ Deleted webhook: ${webhook.id}`);
        } catch (deleteError) {
          console.warn(`⚠️ Could not delete webhook ${webhook.id}:`, (deleteError as Error).message);
        }
      }
    } catch (listError) {
      console.warn('⚠️ Could not list/delete existing webhooks:', (listError as Error).message);
      console.log('Continuing with webhook creation...');
    }
    
    console.log('\n📡 Creating new webhooks with all contracts...');
    
    // Extract just the addresses
    const contractAddresses = allContracts.map(c => c.address);
    
    // Create ADDRESS_ACTIVITY webhook
    console.log('Creating ADDRESS_ACTIVITY webhook...');
    const addressActivityWebhookId = await alchemyNotify.createAddressActivityWebhook(contractAddresses);
    
    // Create MINED_TRANSACTION webhook  
    console.log('Creating MINED_TRANSACTION webhook...');
    const minedTransactionWebhookId = await alchemyNotify.createMinedTransactionWebhook(contractAddresses);
    
    // Update database with new webhook IDs
    console.log('\n💾 Updating database with new webhook IDs...');
    await database.updateWebhookConfig({
      addressActivityWebhookId: addressActivityWebhookId,
      minedTransactionWebhookId: minedTransactionWebhookId,
      contracts: allContracts,
      updatedAt: new Date()
    });
    
    console.log('\n✅ Webhook update completed successfully!');
    console.log(`📡 New Webhook IDs:`);
    console.log(`   • Address Activity: ${addressActivityWebhookId}`);
    console.log(`   • Mined Transaction: ${minedTransactionWebhookId}`);
    console.log(`📊 Monitoring ${contractAddresses.length} contracts total`);
    
    console.log('\n🎯 All contracts are now being monitored in real-time!');
    console.log('💡 Run this script again after deploying new markets to keep webhooks updated.');
    
  } catch (error) {
    console.error('❌ Failed to update webhooks:', (error as Error).message);
    process.exit(1);
  }
}

// Run the script
updateWebhooksWithNewContracts()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }); 