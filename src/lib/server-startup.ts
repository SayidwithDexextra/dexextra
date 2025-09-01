/**
 * Server Startup Services
 * 
 * Automatically starts background services when the server initializes.
 * This runs on the first API request to ensure services are available.
 */

import { settlementProcessor } from '@/lib/settlement-processor';

let isInitialized = false;
let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * Initialize all background services on server startup
 */
export async function initializeServerServices(): Promise<void> {
  console.log('🚀 Initializing server startup services...');

  try {
    // Always check and start Settlement Processor to ensure it's running
    console.log('⚡ Checking Settlement Processor status...');
    const settlementStatus = settlementProcessor.getStatus();
    
    console.log(`📊 Settlement Processor status: running=${settlementStatus.isRunning}, processing=${settlementStatus.isProcessing}`);
    
    if (!settlementStatus.isRunning) {
      console.log('🔄 Starting Settlement Processor...');
      settlementProcessor.start(30000); // 30 second intervals
      
      // Verify it started
      const newStatus = settlementProcessor.getStatus();
      console.log(`✅ Settlement Processor started: running=${newStatus.isRunning}`);
    } else {
      console.log('✅ Settlement Processor already running');
    }

    // TODO: Add other background services here as needed
    // Example:
    // await startRealtimePriceService();
    // await startWebhookProcessors();

    // Mark as initialized only after successful startup
    const finalStatus = settlementProcessor.getStatus();
    if (finalStatus.isRunning) {
      isInitialized = true;
      console.log('🎉 All server startup services initialized successfully');
      
      // Start heartbeat monitor to ensure services stay running
      startHeartbeatMonitor();
    } else {
      console.warn('⚠️ Settlement processor failed to start properly');
    }

  } catch (error) {
    console.error('❌ Failed to initialize server services:', error);
    // Don't throw - let the API request continue even if background services fail
  }
}

/**
 * Start heartbeat monitor to ensure services stay running
 */
function startHeartbeatMonitor(): void {
  if (heartbeatInterval) {
    return; // Already running
  }

  console.log('💓 Starting service heartbeat monitor...');
  
  heartbeatInterval = setInterval(() => {
    try {
      const settlementStatus = settlementProcessor.getStatus();
      
      if (!settlementStatus.isRunning) {
        console.log('🔄 Settlement processor stopped, restarting...');
        settlementProcessor.start(30000);
        console.log('✅ Settlement processor restarted by heartbeat monitor');
      }
    } catch (error) {
      console.error('❌ Heartbeat monitor error:', error);
    }
  }, 60000); // Check every minute
}

/**
 * Get initialization status
 */
export function getInitializationStatus(): { 
  isInitialized: boolean;
  services: {
    settlementProcessor: boolean;
  }
} {
  return {
    isInitialized,
    services: {
      settlementProcessor: settlementProcessor.getStatus().isRunning
    }
  };
}

/**
 * Force re-initialization (useful for development)
 */
export function forceReinitialize(): void {
  isInitialized = false;
  console.log('🔄 Forcing service re-initialization...');
}
