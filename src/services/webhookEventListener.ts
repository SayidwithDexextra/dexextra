import { AlchemyNotifyService, WebhookRegistrationResult } from './alchemyNotifyService';
import { EventDatabase } from '@/lib/eventDatabase';
import { env } from '@/lib/env';
import { 
  SmartContractEvent, 
  ContractConfig, 
  EventListenerConfig,
  RealtimeEventData 
} from '@/types/events';

/**
 * WebhookEventListener - Vercel-compatible event monitoring using Alchemy Notify API
 * 
 * This service replaces the polling-based event monitoring system with a webhook-driven
 * approach that's fully compatible with serverless deployment on Vercel.
 * 
 * Key benefits:
 * - No long-running processes (Vercel compatible)
 * - Real-time event delivery via webhooks
 * - Automatic reliability and retries handled by Alchemy
 * - Reduced RPC calls and infrastructure costs
 */
export class WebhookEventListener {
  private alchemyNotify: AlchemyNotifyService;
  private database: EventDatabase;
  private config: EventListenerConfig;
  public webhookIds: Map<string, string> = new Map();
  public isInitialized = false;
  private startupErrors: Array<{ timestamp: Date; error: string }> = [];

  constructor(config: EventListenerConfig) {
    this.config = config;
    this.database = new EventDatabase();
    this.alchemyNotify = new AlchemyNotifyService();
    
    console.log('🔗 WebhookEventListener initialized for Vercel deployment');
  }

  /**
   * Initialize webhook monitoring for contracts
   * This replaces the old start() method that used polling
   */
  async initialize(): Promise<void> {
    const startTime = Date.now();
    
    try {
      console.log('🚀 Initializing Webhook Event Monitoring...');
      console.log(`📋 Configuration:
        - Webhook URL: ${env.APP_URL}/api/webhooks/alchemy
        - Contracts to monitor: ${this.config.contracts.length}
        - Network: ${env.DEFAULT_NETWORK}
        - Chain ID: ${env.CHAIN_ID}`);

      if (this.isInitialized) {
        console.log('⚠️ Webhook event listener is already initialized');
        return;
      }

      // Step 1: Validate environment
      await this.validateEnvironment();

      // Step 2: Register contracts with Alchemy webhooks
      if (this.config.contracts.length > 0) {
        await this.registerWebhooks();
      } else {
        console.log('⚠️ No contracts configured for monitoring');
      }

      // Step 3: Verify webhook registration
      await this.verifyWebhookSetup();

      this.isInitialized = true;
      
      const duration = Date.now() - startTime;
      console.log(`✅ Webhook Event Listener initialized successfully in ${duration}ms`);

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.startupErrors.push({
        timestamp: new Date(),
        error: errorMessage
      });

      console.error(`❌ Webhook Event Listener initialization failed after ${duration}ms:`, errorMessage);
      throw new Error(`Webhook initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Validate environment for webhook setup
   */
  private async validateEnvironment(): Promise<void> {
    console.log('🔍 Validating environment...');

    // Check required environment variables
    if (!env.ALCHEMY_API_KEY) {
      throw new Error('ALCHEMY_API_KEY is required for webhook monitoring');
    }

    if (!env.APP_URL) {
      throw new Error('APP_URL is required for webhook endpoint');
    }

    // Verify Alchemy connection
    const healthCheck = await this.alchemyNotify.healthCheck();
    if (healthCheck.status !== 'healthy') {
      throw new Error(`Alchemy connection failed: ${healthCheck.details.error}`);
    }

    // Verify database connection
    try {
      await this.database.healthCheck();
    } catch (error) {
      throw new Error(`Database connection failed: ${(error as Error).message}`);
    }

    console.log('✅ Environment validation completed');
  }

  /**
   * Register contracts with Alchemy webhooks
   */
  private async registerWebhooks(): Promise<void> {
    console.log('🔗 Registering contracts with Alchemy webhooks...');

    try {
      const contracts = this.config.contracts.map(c => ({
        address: c.address,
        name: c.name
      }));

      const webhookResult = await this.alchemyNotify.registerContractsForWebhooks(contracts);
      
      // Store webhook IDs for management
      this.webhookIds.set('address_activity', webhookResult.addressActivityWebhookId);
      this.webhookIds.set('mined_transaction', webhookResult.minedTransactionWebhookId);

      // Store webhook configuration in database for persistence
      await this.storeWebhookConfiguration(webhookResult);

      console.log('✅ Contracts registered with Alchemy webhooks successfully');
      console.log(`📋 Webhook IDs:
        - Address Activity: ${webhookResult.addressActivityWebhookId}
        - Mined Transaction: ${webhookResult.minedTransactionWebhookId}`);

    } catch (error) {
      throw new Error(`Failed to register webhooks: ${(error as Error).message}`);
    }
  }

  /**
   * Verify webhook setup
   */
  private async verifyWebhookSetup(): Promise<void> {
    console.log('🔍 Verifying webhook setup...');

    try {
      const webhooks = await this.alchemyNotify.listWebhooks();
      const activeWebhooks = webhooks.webhooks.filter(w => w.isActive);

      console.log(`📊 Webhook verification results:
        - Total webhooks: ${webhooks.webhooks.length}
        - Active webhooks: ${activeWebhooks.length}
        - Registered webhook IDs: ${Array.from(this.webhookIds.values()).join(', ')}`);

      if (activeWebhooks.length === 0) {
        throw new Error('No active webhooks found after registration');
      }

      console.log('✅ Webhook setup verified successfully');
    } catch (error) {
      throw new Error(`Webhook verification failed: ${(error as Error).message}`);
    }
  }

  /**
   * Store webhook configuration in database
   */
  private async storeWebhookConfiguration(webhookResult: WebhookRegistrationResult): Promise<void> {
    try {
      // Store webhook IDs and configuration for future reference
      // This allows the system to manage webhooks across deployments
      const config = {
        addressActivityWebhookId: webhookResult.addressActivityWebhookId,
        minedTransactionWebhookId: webhookResult.minedTransactionWebhookId,
        contracts: this.config.contracts.map(c => ({
          address: c.address,
          name: c.name,
          type: c.type
        })),
        createdAt: new Date(),
        network: env.DEFAULT_NETWORK,
        chainId: env.CHAIN_ID
      };

      await this.database.storeWebhookConfig(config);
      console.log('✅ Webhook configuration stored in database');
    } catch (error) {
      console.warn('⚠️ Failed to store webhook configuration:', error);
      // Don't fail initialization for this
    }
  }

  /**
   * Add new contract to webhook monitoring
   */
  async addContract(contractConfig: ContractConfig): Promise<void> {
    console.log(`🔗 Adding contract to webhook monitoring: ${contractConfig.name}`);

    try {
      if (!this.isInitialized) {
        throw new Error('Webhook listener not initialized. Call initialize() first.');
      }

      // Add to existing webhooks
      const addressWebhookId = this.webhookIds.get('address_activity');
      const minedWebhookId = this.webhookIds.get('mined_transaction');

      if (addressWebhookId) {
        await this.alchemyNotify.updateWebhookAddresses(addressWebhookId, [contractConfig.address]);
      }

      if (minedWebhookId) {
        await this.alchemyNotify.updateWebhookAddresses(minedWebhookId, [contractConfig.address]);
      }

      // Add to configuration
      this.config.contracts.push(contractConfig);

      console.log(`✅ Contract ${contractConfig.name} added to webhook monitoring`);
    } catch (error) {
      console.error(`❌ Failed to add contract to webhook monitoring:`, error);
      throw error;
    }
  }

  /**
   * Remove contract from webhook monitoring
   */
  async removeContract(contractAddress: string): Promise<void> {
    console.log(`🗑️ Removing contract from webhook monitoring: ${contractAddress}`);

    try {
      if (!this.isInitialized) {
        throw new Error('Webhook listener not initialized.');
      }

      // Remove from existing webhooks
      const addressWebhookId = this.webhookIds.get('address_activity');
      const minedWebhookId = this.webhookIds.get('mined_transaction');

      if (addressWebhookId) {
        await this.alchemyNotify.removeWebhookAddresses(addressWebhookId, [contractAddress]);
      }

      if (minedWebhookId) {
        await this.alchemyNotify.removeWebhookAddresses(minedWebhookId, [contractAddress]);
      }

      // Remove from configuration
      this.config.contracts = this.config.contracts.filter(c => c.address !== contractAddress);

      console.log(`✅ Contract ${contractAddress} removed from webhook monitoring`);
    } catch (error) {
      console.error(`❌ Failed to remove contract from webhook monitoring:`, error);
      throw error;
    }
  }

  /**
   * Get webhook monitoring status
   */
  async getStatus(): Promise<{
    isInitialized: boolean;
    webhooksActive: number;
    contractsMonitored: number;
    lastCheck: Date;
    startupErrors: Array<{ timestamp: Date; error: string }>;
    webhookIds: Record<string, string>;
  }> {
    try {
      const webhooks = await this.alchemyNotify.listWebhooks();
      const activeWebhooks = webhooks.webhooks.filter(w => w.isActive);

      return {
        isInitialized: this.isInitialized,
        webhooksActive: activeWebhooks.length,
        contractsMonitored: this.config.contracts.length,
        lastCheck: new Date(),
        startupErrors: this.startupErrors,
        webhookIds: Object.fromEntries(this.webhookIds)
      };
    } catch (error) {
      return {
        isInitialized: this.isInitialized,
        webhooksActive: 0,
        contractsMonitored: this.config.contracts.length,
        lastCheck: new Date(),
        startupErrors: [
          ...this.startupErrors,
          { timestamp: new Date(), error: `Status check failed: ${(error as Error).message}` }
        ],
        webhookIds: Object.fromEntries(this.webhookIds)
      };
    }
  }

  /**
   * Cleanup webhooks (for development/testing)
   */
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up webhooks...');

    try {
      for (const [type, webhookId] of this.webhookIds) {
        await this.alchemyNotify.deleteWebhook(webhookId);
        console.log(`✅ Cleaned up ${type} webhook: ${webhookId}`);
      }

      this.webhookIds.clear();
      this.isInitialized = false;

      console.log('✅ Webhook cleanup completed');
    } catch (error) {
      console.error('❌ Failed to cleanup webhooks:', error);
      throw error;
    }
  }

  /**
   * Health check for webhook system
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
    try {
      // Check Alchemy connection
      const alchemyHealth = await this.alchemyNotify.healthCheck();
      
      // Check database connection
      await this.database.healthCheck();
      
      // Check webhook status
      const status = await this.getStatus();

      if (alchemyHealth.status === 'healthy' && status.isInitialized && status.webhooksActive > 0) {
        return {
          status: 'healthy',
          details: {
            alchemyHealth: alchemyHealth.details,
            webhookStatus: status,
            timestamp: new Date().toISOString()
          }
        };
      } else {
        return {
          status: 'unhealthy',
          details: {
            alchemyHealth: alchemyHealth.details,
            webhookStatus: status,
            issues: [
              !status.isInitialized && 'Not initialized',
              status.webhooksActive === 0 && 'No active webhooks',
              alchemyHealth.status !== 'healthy' && 'Alchemy connection issues'
            ].filter(Boolean),
            timestamp: new Date().toISOString()
          }
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: (error as Error).message,
          timestamp: new Date().toISOString()
        }
      };
    }
  }
}

// Configuration for the webhook event listener
const DEFAULT_WEBHOOK_CONFIG: EventListenerConfig = {
  rpcUrl: env.RPC_URL, // Still needed for some operations
  wsRpcUrl: undefined, // Not needed for webhook-based system
  contracts: [], // Will be populated dynamically from database
  batchSize: 0, // Not applicable for webhooks
  confirmations: 1,
  retryAttempts: 3,
  retryDelay: 5000
};

// Singleton instance
let webhookEventListener: WebhookEventListener | null = null;

export async function getWebhookEventListener(): Promise<WebhookEventListener> {
  if (!webhookEventListener) {
    try {
      // Dynamically load contracts from database
      const database = new EventDatabase();
      const contracts = await database.getDeployedVAMMContracts();
      
      const config = {
        ...DEFAULT_WEBHOOK_CONFIG,
        contracts: contracts
      };
      
      console.log('🔧 Initializing webhook event listener with contracts:', contracts.map(c => c.name));
      
      if (contracts.length === 0) {
        console.log('⚠️ No contracts found in database for webhook monitoring.');
        console.log('💡 Deploy contracts via the create-market wizard to enable monitoring.');
      }
      
      webhookEventListener = new WebhookEventListener(config);
      
      // Load existing webhook configuration from database
      try {
        const existingConfig = await database.getWebhookConfig();
        if (existingConfig) {
          console.log('📋 Loading existing webhook configuration from database');
          
          // Set the webhook IDs if they exist
          if (existingConfig.addressActivityWebhookId) {
            webhookEventListener.webhookIds.set('address_activity', existingConfig.addressActivityWebhookId);
            console.log(`✅ Loaded Address Activity webhook: ${existingConfig.addressActivityWebhookId}`);
          }
          
          if (existingConfig.minedTransactionWebhookId) {
            webhookEventListener.webhookIds.set('mined_transaction', existingConfig.minedTransactionWebhookId);
            console.log(`✅ Loaded Mined Transaction webhook: ${existingConfig.minedTransactionWebhookId}`);
          }
          
          // Mark as initialized if we have webhook config
          if (existingConfig.addressActivityWebhookId || existingConfig.minedTransactionWebhookId) {
            webhookEventListener.isInitialized = true;
            console.log('✅ Webhook listener marked as initialized with existing configuration');
          }
        } else {
          console.log('💡 No existing webhook configuration found. Run migration script to create webhooks.');
        }
      } catch (error) {
        console.warn('⚠️ Failed to load webhook configuration from database:', error);
      }
      
    } catch (error) {
      console.error('❌ Failed to initialize webhook event listener:', error);
      // Fallback to default configuration
      console.log('🔄 Falling back to default configuration');
      webhookEventListener = new WebhookEventListener(DEFAULT_WEBHOOK_CONFIG);
    }
  }
  return webhookEventListener;
}

/**
 * Initialize webhook monitoring for the application
 * This should be called once during application startup or deployment
 */
export async function initializeWebhookMonitoring(): Promise<void> {
  try {
    console.log('🚀 Initializing webhook monitoring for application...');
    
    const listener = await getWebhookEventListener();
    await listener.initialize();
    
    console.log('✅ Webhook monitoring initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize webhook monitoring:', error);
    throw error;
  }
} 