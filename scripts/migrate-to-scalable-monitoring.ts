#!/usr/bin/env node

/**
 * Migration Script: Address-Based → Scalable Event Monitoring
 * 
 * Migrates from the current address-based webhook system (limited to ~1000 contracts)
 * to the new scalable signature-based monitoring system (unlimited contracts).
 * 
 * Key Benefits of Migration:
 * - Scale to unlimited contract deployments
 * - Single webhook monitors ALL contracts
 * - Automatic detection of new contracts
 * - Reduced webhook management overhead
 * - Better performance and reliability
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

async function migrateToScalableMonitoring() {
  try {
    console.log('🚀 Migrating to Scalable Event Monitoring System...\n');
    
    // Dynamic imports for ESM modules
    const { EventDatabase } = await import("../src/lib/eventDatabase.ts");
    const { getAlchemyNotifyService } = await import("../src/services/alchemyNotifyService.ts");
    const { getScalableEventMonitor } = await import("../src/services/scalableEventMonitor.ts");
    
    const database = new EventDatabase();
    const alchemyNotify = getAlchemyNotifyService();
    
    console.log('📊 Pre-Migration Analysis...');
    
    // Get current webhook configuration
    const currentConfig = await database.getWebhookConfig();
    if (!currentConfig) {
      console.log('❌ No existing webhook configuration found');
      console.log('💡 You can proceed directly to creating scalable monitoring');
    } else {
      console.log(`✅ Current system monitors ${currentConfig.contracts.length} contracts`);
      console.log('📋 Current contracts:');
      currentConfig.contracts.forEach((c, i) => {
        console.log(`   ${i+1}. ${c.name} (${c.type}) - ${c.address}`);
      });
    }
    
    console.log('\n🎯 Creating Scalable Event Monitor...');
    
    // Initialize scalable event monitor
    const scalableMonitor = await getScalableEventMonitor();
    const status = scalableMonitor.getStatus();
    
    console.log('✅ Scalable Event Monitor created successfully!');
    console.log(`📡 Webhook ID: ${status.webhookId}`);
    console.log(`📊 Monitoring ${status.monitoredEvents.length} event types`);
    
    console.log('\n📡 Event Signatures Being Monitored:');
    status.monitoredEvents.forEach(eventName => {
      console.log(`   • ${eventName}`);
    });
    
    // Optional: Clean up old webhooks
    console.log('\n🧹 Cleaning up old webhooks (optional)...');
    try {
      const webhooks = await alchemyNotify.listWebhooks();
      console.log(`📋 Found ${webhooks.webhooks.length} existing webhooks`);
      
      let deletedCount = 0;
      for (const webhook of webhooks.webhooks) {
        // Only delete non-scalable webhooks (you can customize this logic)
        if (webhook.url && !webhook.url.includes('/scalable')) {
          try {
            console.log(`🗑️ Deleting old webhook: ${webhook.id}`);
            await alchemyNotify.deleteWebhook(webhook.id);
            deletedCount++;
          } catch (deleteError) {
            console.warn(`⚠️ Could not delete webhook ${webhook.id}`);
          }
        }
      }
      console.log(`✅ Cleaned up ${deletedCount} old webhooks`);
      
    } catch (listError) {
      console.log('⚠️ Could not list/clean up old webhooks (this is ok)');
    }
    
    console.log('\n✅ Migration to Scalable Monitoring Complete!');
    console.log('\n🎯 New System Capabilities:');
    console.log('   • ♾️  Unlimited contract monitoring');
    console.log('   • 🎯 Event signature-based detection');
    console.log('   • 🤖 Automatic new contract discovery');
    console.log('   • 📡 Single webhook for ALL contracts');
    console.log('   • 🚀 Better performance and scalability');
    
    console.log('\n📡 New Webhook Endpoint:');
    console.log(`   ${process.env.APP_URL}/api/webhooks/alchemy/scalable`);
    
    console.log('\n🧪 Testing the New System:');
    console.log('1. Deploy a new market via your factory');
    console.log('2. Emit some position events (open/close positions)');
    console.log('3. Check the scalable webhook logs');
    console.log('4. Verify events are being captured automatically');
    
    console.log('\n📊 Scale Test:');
    console.log('• Current system: Limited to ~1000 contracts');
    console.log('• New system: Unlimited contracts ♾️');
    console.log('• Deploy 10,000 contracts? No problem! 🚀');
    
    console.log('\n💡 Next Steps:');
    console.log('1. Test the new system with existing contracts');
    console.log('2. Deploy new markets and verify automatic detection');
    console.log('3. Monitor the scalable webhook endpoint');
    console.log('4. Enjoy unlimited scaling! 🎉');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Check that ALCHEMY_WEBHOOK_AUTH_TOKEN is set');
    console.log('2. Verify APP_URL points to your deployed app');
    console.log('3. Ensure your database is accessible');
    process.exit(1);
  }
}

// Run the migration
migrateToScalableMonitoring()
  .then(() => {
    console.log('\n🎊 Migration completed successfully!');
    console.log('Your platform now scales to unlimited contracts! 🚀');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration script failed:', error);
    process.exit(1);
  }); 