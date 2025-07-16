#!/usr/bin/env tsx

/**
 * Test Custom Webhook for VAMM Position Events
 * 
 * This script creates a Custom Webhook specifically designed to capture
 * VAMM position events that might be missed by Address Activity webhooks.
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

import { ethers } from 'ethers';

async function testCustomWebhook() {
  try {
    console.log("🎯 Testing Custom Webhook for VAMM Position Events...\n");

    // Dynamic imports for ESM modules
    const { getAlchemyNotifyService } = await import("../src/services/alchemyNotifyService.ts");
    const { EventDatabase } = await import("../src/lib/eventDatabase.ts");

    const alchemyNotify = await getAlchemyNotifyService();
    const database = new EventDatabase();

    // Get VAMM contracts
    const contracts = await database.getDeployedVAMMContracts();
    const vammContracts = contracts.filter(c => c.type === 'vAMM');
    
    console.log(`📋 Found ${vammContracts.length} VAMM contracts:`);
    vammContracts.forEach(c => console.log(`  - ${c.name}: ${c.address}`));

    if (vammContracts.length === 0) {
      console.error("❌ No VAMM contracts found");
      process.exit(1);
    }

    // Generate event signatures for VAMM position events
    console.log("\n🔍 Generating event signatures for VAMM position events...");
    
    const positionEvents = [
      'PositionOpened(address,uint256,bool,uint256,uint256,uint256,uint256)',
      'PositionClosed(address,uint256,uint256,uint256,int256,uint256)',
      'PositionIncreased(address,uint256,uint256,uint256,uint256,uint256)',
      'PositionLiquidated(address,uint256,address,uint256,uint256,uint256)',
      'FundingUpdated(int256,uint256,int256)',
      'FundingPaid(address,uint256,int256,uint256)',
      'TradingFeeCollected(address,uint256)',
      'BondingCurveUpdated(uint256,uint256,uint256)'
    ];

    const eventSignatures = positionEvents.map(event => {
      const hash = ethers.id(event);
      console.log(`  ${event} → ${hash}`);
      return hash;
    });

    // Create Custom Webhook for position events
    console.log("\n🔗 Creating Custom Webhook for VAMM position events...");
    
    const contractAddresses = vammContracts.map(c => c.address);
    const customWebhookId = await alchemyNotify.createCustomWebhook(
      contractAddresses,
      eventSignatures
    );

    console.log(`✅ Custom Webhook created: ${customWebhookId}`);

    // Test the webhook endpoint
    console.log("\n🧪 Testing webhook endpoint...");
    try {
      const response = await fetch(`${process.env.APP_URL}/api/webhooks/alchemy`, {
        method: "GET",
      });

      if (response.ok) {
        const data = await response.json();
        console.log("✅ Webhook endpoint is healthy:", data.message);
      } else {
        console.warn("⚠️ Webhook endpoint returned non-200 status:", response.status);
      }
    } catch (error) {
      console.warn("⚠️ Could not test webhook endpoint:", error);
    }

    console.log("\n🎉 Custom Webhook test completed!");
    console.log(`
📊 Summary:
  ✅ Created Custom Webhook: ${customWebhookId}
  ✅ Monitoring ${vammContracts.length} VAMM contracts
  ✅ Watching ${positionEvents.length} position event types
  ✅ Webhook endpoint: ${process.env.APP_URL}/api/webhooks/alchemy

🔍 Next Steps:
  1. Trigger a position event on one of your VAMM contracts
  2. Check the console logs for "🎯 Processing custom webhook (GRAPHQL)"
  3. Compare with Address Activity webhook logs
  4. Monitor the database for new position events

📝 Event Signatures:
${eventSignatures.map((sig, i) => `  ${positionEvents[i]}: ${sig}`).join('\n')}
`);

  } catch (error) {
    console.error("❌ Custom webhook test failed:", error);
    process.exit(1);
  }
}

testCustomWebhook().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
}); 