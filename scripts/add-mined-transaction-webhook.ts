#!/usr/bin/env node

/**
 * Add MINED_TRANSACTION webhook for capturing smart contract event logs
 * 
 * This webhook type includes the 'log' field with topics and data that
 * your current ADDRESS_ACTIVITY webhook is missing.
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

async function addMinedTransactionWebhook() {
  try {
    console.log('🔗 Adding MINED_TRANSACTION webhook for smart contract events...')
    
    // Dynamic import for ESM module
    const { getAlchemyNotifyService } = await import("../src/services/alchemyNotifyService.ts");
    const alchemyNotify = getAlchemyNotifyService()
    
    // Your VAMM contracts
    const contractAddresses = [
      '0xc6220f6bdce01e85088b7e7b64e9425b86e3ab04', // GOLDV4 vAMM (your main contract)
      '0xdab242cd90b95a4ed68644347b80e0b3cead48c0', // GoldV1 vAMM
      '0x4eae52fe16bfd10bda0f6d7d354ec4a23188fce8', // GOLDV2 vAMM
      '0x49325a53dfbf0ce08e6e2d12653533c6fc3f9673', // GOLDV3 vAMM
      '0x3f0cf8a2b6a30dacd0cdcbb3cf0080753139b50e'  // vAMM-GOLDV3
    ]
    
    console.log('📋 Contracts to monitor:', contractAddresses)
    
    // Create MINED_TRANSACTION webhook (this captures event logs)
    const minedTransactionWebhookId = await alchemyNotify.createMinedTransactionWebhook(contractAddresses)
    
    console.log('✅ MINED_TRANSACTION webhook created successfully!')
    console.log(`📡 Webhook ID: ${minedTransactionWebhookId}`)
    console.log('')
    console.log('🎯 This webhook will now capture:')
    console.log('  - PositionOpened events')
    console.log('  - PositionClosed events') 
    console.log('  - All other smart contract events')
    console.log('  - Complete transaction logs with topics and data')
    console.log('')
    console.log('🧪 Test by calling your emit function again and check the webhook payload!')
    
  } catch (error) {
    console.error('❌ Failed to add MINED_TRANSACTION webhook:', error)
    process.exit(1)
  }
}

// Run the script
addMinedTransactionWebhook()
  .then(() => {
    console.log('✅ Script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Script failed:', error)
    process.exit(1)
  }) 