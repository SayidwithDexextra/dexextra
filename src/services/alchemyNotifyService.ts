import { Alchemy, Network, AlchemySettings } from 'alchemy-sdk';
import { createHmac } from 'crypto';
import { env } from '@/lib/env';

export interface AlchemyWebhookConfig {
  id?: string;
  network: Network;
  webhookType: string;
  addresses: string[];
  webhookUrl: string;
}

export interface WebhookRegistrationResult {
  addressActivityWebhookId: string;
  minedTransactionWebhookId: string;
  orderBookWebhookId?: string;
}

export class AlchemyNotifyService {
  private alchemy: Alchemy;
  private webhookUrl: string;
  private network: Network;
  private alchemyToken: string;
  private apiBaseUrl = 'https://dashboard.alchemy.com/api';

  constructor() {
    if (!env.ALCHEMY_API_KEY) {
      throw new Error('ALCHEMY_API_KEY is required for Notify API');
    }

    if (!env.ALCHEMY_WEBHOOK_AUTH_TOKEN) {
      throw new Error('ALCHEMY_WEBHOOK_AUTH_TOKEN is required for webhook management API');
    }

    // Determine network based on chain ID
    this.network = this.getNetworkFromChainId();
    this.alchemyToken = env.ALCHEMY_WEBHOOK_AUTH_TOKEN;

    const settings: AlchemySettings = {
      apiKey: env.ALCHEMY_API_KEY,
      network: this.network,
    };

    this.alchemy = new Alchemy(settings);
    this.webhookUrl = `${env.APP_URL}/api/webhooks/alchemy`;

     console.log(`🔗 AlchemyNotifyService initialized for ${this.network} with webhook URL: ${this.webhookUrl}`);
  }

  /**
   * Get Alchemy network from chain ID
   */
  private getNetworkFromChainId(): Network {
    const chainId = typeof env.CHAIN_ID === 'number' ? env.CHAIN_ID : parseInt(env.CHAIN_ID || '137');
    
    switch (chainId) {
      case 1:
        return Network.ETH_MAINNET;
      case 5:
        return Network.ETH_GOERLI;
      case 11155111:
        return Network.ETH_SEPOLIA;
      case 137:
        return Network.MATIC_MAINNET;
      case 80001:
        return Network.MATIC_MUMBAI;
      case 42161:
        return Network.ARB_MAINNET;
      case 421613:
        return Network.ARB_GOERLI;
      case 10:
        return Network.OPT_MAINNET;
      case 420:
        return Network.OPT_GOERLI;
      default:
        console.warn(`⚠️ Unsupported chain ID ${chainId}, defaulting to Polygon Mainnet`);
        return Network.MATIC_MAINNET;
    }
  }

  /**
   * Convert Network enum to API string format
   */
  private getNetworkApiString(): string {
    switch (this.network) {
      case Network.ETH_MAINNET:
        return 'ETH_MAINNET';
      case Network.ETH_GOERLI:
        return 'ETH_GOERLI';
      case Network.ETH_SEPOLIA:
        return 'ETH_SEPOLIA';
      case Network.MATIC_MAINNET:
        return 'MATIC_MAINNET';
      case Network.MATIC_MUMBAI:
        return 'MATIC_MUMBAI';
      case Network.ARB_MAINNET:
        return 'ARB_MAINNET';
      case Network.ARB_GOERLI:
        return 'ARB_GOERLI';
      case Network.OPT_MAINNET:
        return 'OPT_MAINNET';
      case Network.OPT_GOERLI:
        return 'OPT_GOERLI';
      default:
        return 'MATIC_MAINNET';
    }
  }

  /**
   * Make authenticated request to Alchemy API
   */
  private async makeAlchemyApiRequest(endpoint: string, method: string = 'GET', body?: any) {
    const url = `${this.apiBaseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'X-Alchemy-Token': this.alchemyToken,
      'Content-Type': 'application/json',
    };

     console.log('🔑 Making Alchemy API request to:', url);
     console.log('🔑 Headers:', headers);
     console.log('🔑 Body:', body);

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Alchemy API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Create address activity webhook for contract monitoring
   */
  async createAddressActivityWebhook(contractAddresses: string[]): Promise<string> {
    try {
       console.log('📡 Creating Alchemy address activity webhook for:', contractAddresses);

      const payload = {
        network: this.getNetworkApiString(),
        webhook_type: 'ADDRESS_ACTIVITY',
        webhook_url: this.webhookUrl,
        addresses: contractAddresses,
      };

      const response = await this.makeAlchemyApiRequest('/create-webhook', 'POST', payload);

       console.log('✅ Address activity webhook created:', response.data.id);
      return response.data.id;
    } catch (error) {
      console.error('❌ Failed to create address activity webhook:', error);
      throw new Error(`Failed to create address activity webhook: ${(error as Error).message}`);
    }
  }

  /**
   * Create mined transaction webhook for transaction monitoring
   */
  async createMinedTransactionWebhook(
    contractAddresses: string[]
  ): Promise<string> {
    try {
       console.log('⛏️ Creating Alchemy mined transaction webhook for:', contractAddresses);

      const payload = {
        network: this.getNetworkApiString(),
        webhook_type: 'MINED_TRANSACTION',
        webhook_url: this.webhookUrl,
        addresses: contractAddresses,
        app_id: env.ALCHEMY_API_KEY, // Use API key as app identifier
      };

      const response = await this.makeAlchemyApiRequest('/create-webhook', 'POST', payload);

       console.log('✅ Mined transaction webhook created:', response.data.id);
      return response.data.id;
    } catch (error) {
      console.error('❌ Failed to create mined transaction webhook:', error);
      throw new Error(`Failed to create mined transaction webhook: ${(error as Error).message}`);
    }
  }

  /**
   * Create dropped transaction webhook for monitoring failed transactions
   */
  async createDroppedTransactionWebhook(
    contractAddresses: string[]
  ): Promise<string> {
    try {
       console.log('🗑️ Creating Alchemy dropped transaction webhook for:', contractAddresses);

      const payload = {
        network: this.getNetworkApiString(),
        webhook_type: 'DROPPED_TRANSACTION',
        webhook_url: this.webhookUrl,
        addresses: contractAddresses,
        app_id: env.ALCHEMY_API_KEY, // Use API key as app identifier
      };

      const response = await this.makeAlchemyApiRequest('/create-webhook', 'POST', payload);

       console.log('✅ Dropped transaction webhook created:', response.data.id);
      return response.data.id;
    } catch (error) {
      console.error('❌ Failed to create dropped transaction webhook:', error);
      throw new Error(`Failed to create dropped transaction webhook: ${(error as Error).message}`);
    }
  }

  /**
   * Create OrderBook webhook for order contract events
   */
  async createOrderBookWebhook(): Promise<string> {
    try {
      console.log('🎯 Creating OrderBook webhook for contract events');

      // OrderBook contract addresses and event signatures
      const orderBookContracts = [
        '0x516a1790a04250FC6A5966A528D02eF20E1c1891', // OrderRouter
        '0x07d317C87E6d8AF322463aCF024f1e28D38F6117'  // OrderBook (SILVER_V1)
      ];

      const orderEventSignatures = [
        '0x5b954fa335c624976b5c2dba7c7a172770d02d8b36e6da6cfcc1b79baa62bfc8', // OrderPlaced
        '0xc4058ebc534b64ecb27b2d4eaa1904f98997ec18ebe6ada4117593dde89478cc', // OrderCancelled
        '0x1cd65e6e4f6a6bfcff65064f4e22d514f481a38dcbe4c2ad13ccde1b22e06941', // OrderExecuted
        '0x184a980efa61c0acfeff92c0613bf2d3aceedadec9002d919c6bde9218b56c68', // OrderAdded
        '0xe5426fa5d075d3a0a2ce3373a3df298c78eec0ded097810b0e69a92c21b4b0b3'  // OrderMatched
      ];

      // GraphQL query for OrderBook events
      const graphqlQuery = `
        {
          block {
            logs(filter: {
              addresses: [${orderBookContracts.map(addr => `"${addr}"`).join(', ')}]
              topics: [${orderEventSignatures.map(sig => `"${sig}"`).join(', ')}]
            }) {
              account {
                address
              }
              topics
              data
              index
              transaction {
                hash
                index
                blockNumber
                blockHash
                from {
                  address
                }
                to {
                  address
                }
              }
            }
          }
        }
      `;

      const payload = {
        network: this.getNetworkApiString(),
        webhook_type: 'GRAPHQL',
        webhook_url: `${this.webhookUrl.replace('/alchemy', '/orderbook')}`, // Use dedicated orderbook endpoint
        graphql_query: graphqlQuery.replace(/\s+/g, ' ').trim()
      };

      console.log('📡 OrderBook webhook payload:', JSON.stringify(payload, null, 2));

      const response = await this.makeAlchemyApiRequest('/create-webhook', 'POST', payload);

      console.log('✅ OrderBook webhook created:', response.data.id);
      return response.data.id;
    } catch (error) {
      console.error('❌ Failed to create OrderBook webhook:', error);
      throw new Error(`Failed to create OrderBook webhook: ${(error as Error).message}`);
    }
  }

  /**
   * Create custom webhook for specific smart contract events
   * Better suited for custom events like PositionOpened that aren't transfers
   */
  async createCustomWebhook(
    contractAddresses: string[],
    eventSignatures: string[] = []
  ): Promise<string> {
    try {
       console.log('🎯 Creating Alchemy custom webhook for contract events:', {
        contracts: contractAddresses,
        events: eventSignatures
      });

      // GraphQL query for custom webhook to capture specific events
      const graphqlQuery = `
        {
          block {
            logs(filter: {
              addresses: [${contractAddresses.map(addr => `"${addr}"`).join(', ')}]
              ${eventSignatures.length > 0 ? 
                `topics: [${eventSignatures.map(sig => `"${sig}"`).join(', ')}]` 
                : ''
              }
            }) {
              account {
                address
              }
              topics
              data
              index
              transaction {
                hash
                index
                blockNumber
                blockHash
                from {
                  address
                }
                to {
                  address
                }
              }
            }
          }
        }
      `;

      const payload = {
        network: this.getNetworkApiString(),
        webhook_type: 'GRAPHQL',
        webhook_url: this.webhookUrl,
        graphql_query: graphqlQuery.replace(/\s+/g, ' ').trim()
      };

       console.log('📡 Custom webhook payload:', JSON.stringify(payload, null, 2));

      const response = await this.makeAlchemyApiRequest('/create-webhook', 'POST', payload);

       console.log('✅ Custom webhook created:', response.data.id);
      return response.data.id;
    } catch (error) {
      console.error('❌ Failed to create custom webhook:', error);
      throw new Error(`Failed to create custom webhook: ${(error as Error).message}`);
    }
  }

  /**
   * List all webhooks
   */
  async listWebhooks() {
    try {
      const response = await this.makeAlchemyApiRequest('/team-webhooks', 'GET');
       console.log(`📋 Found ${response.data ? response.data.length : 0} existing webhooks`);
      return { webhooks: response.data || [] };
    } catch (error) {
      console.error('❌ Failed to list webhooks:', error);
      throw new Error(`Failed to list webhooks: ${(error as Error).message}`);
    }
  }

  /**
   * Update webhook addresses
   */
  async updateWebhookAddresses(webhookId: string, addresses: string[]) {
    try {
       console.log(`🔄 Updating webhook ${webhookId} with ${addresses.length} addresses`);

      const payload = {
        webhook_id: webhookId,
        addresses_to_add: addresses,
        addresses_to_remove: [],
      };

      await this.makeAlchemyApiRequest('/update-webhook-addresses', 'PATCH', payload);

       console.log(`✅ Updated webhook ${webhookId} with addresses:`, addresses);
    } catch (error) {
      console.error(`❌ Failed to update webhook ${webhookId}:`, error);
      throw new Error(`Failed to update webhook ${webhookId}: ${(error as Error).message}`);
    }
  }

  /**
   * Remove addresses from webhook
   */
  async removeWebhookAddresses(webhookId: string, addresses: string[]) {
    try {
       console.log(`🗑️ Removing addresses from webhook ${webhookId}:`, addresses);

      const payload = {
        webhook_id: webhookId,
        addresses_to_add: [],
        addresses_to_remove: addresses,
      };

      await this.makeAlchemyApiRequest('/update-webhook-addresses', 'PATCH', payload);

       console.log(`✅ Removed addresses from webhook ${webhookId}`);
    } catch (error) {
      console.error(`❌ Failed to remove addresses from webhook ${webhookId}:`, error);
      throw new Error(`Failed to remove addresses from webhook: ${(error as Error).message}`);
    }
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(webhookId: string) {
    try {
       console.log(`🗑️ Deleting webhook ${webhookId}`);

      await this.makeAlchemyApiRequest(`/delete-webhook`, 'DELETE', { webhook_id: webhookId });

       console.log(`✅ Webhook ${webhookId} deleted successfully`);
    } catch (error) {
      console.error(`❌ Failed to delete webhook ${webhookId}:`, error);
      throw new Error(`Failed to delete webhook: ${(error as Error).message}`);
    }
  }

  /**
   * Get webhook details
   */
  async getWebhookDetails(webhookId: string) {
    try {
      const response = await this.makeAlchemyApiRequest(`/webhook-details?webhook_id=${webhookId}`, 'GET');
      return response.data;
    } catch (error) {
      console.error(`❌ Failed to get webhook details for ${webhookId}:`, error);
      throw new Error(`Failed to get webhook details: ${(error as Error).message}`);
    }
  }

  /**
   * Health check - test API connectivity
   */
  async healthCheck() {
    try {
      await this.listWebhooks();
      return { status: 'healthy', message: 'Alchemy Notify API is accessible' };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        message: `Alchemy Notify API is not accessible: ${(error as Error).message}` 
      };
    }
  }

  /**
   * Verify webhook signature for security
   */
  static verifyWebhookSignature(
    body: string,
    signature: string,
    signingKey: string
  ): boolean {
    try {
      const hmac = createHmac('sha256', signingKey);
      hmac.update(body, 'utf8');
      const digest = hmac.digest('hex');
      return signature === digest;
    } catch (error) {
      console.error('❌ Failed to verify webhook signature:', error);
      return false;
    }
  }

  /**
   * Get network from current configuration
   */
  getNetwork(): Network {
    return this.network;
  }

  /**
   * Get webhook URL
   */
  getWebhookUrl(): string {
    return this.webhookUrl;
  }

  /**
   * Test webhook endpoint accessibility
   */
  async testWebhookEndpoint() {
    try {
      const response = await fetch(this.webhookUrl, { method: 'GET' });
      return {
        accessible: response.ok,
        status: response.status,
        statusText: response.statusText,
      };
    } catch (error) {
      return {
        accessible: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Register contracts for webhook monitoring
   */
  async registerContractsForWebhooks(
    contracts: Array<{ address: string; name: string }>
  ): Promise<WebhookRegistrationResult> {
    try {
       console.log(`🚀 Registering ${contracts.length} contracts for webhook monitoring`);
      
      const addresses = contracts.map(c => c.address.toLowerCase());
      
       console.log('📋 Contract addresses to register:', addresses);

      // Create address activity webhook (monitors all contract interactions)
      const addressActivityWebhookId = await this.createAddressActivityWebhook(addresses);
      
       console.log('✅ Webhook registered successfully');

      return {
        addressActivityWebhookId,
        minedTransactionWebhookId: '', // Not used in simplified approach
      };
    } catch (error) {
      console.error('❌ Failed to register contracts for webhooks:', error);
      throw new Error(`Failed to register contracts for webhooks: ${(error as Error).message}`);
    }
  }

  /**
   * Update existing Address Activity webhook with new contract addresses
   */
  async updateAddressActivityWebhook(
    webhookId: string,
    contractAddresses: string[]
  ): Promise<void> {
    try {
       console.log('🔄 Updating Address Activity webhook:', {
        webhookId,
        contractCount: contractAddresses.length
      });

      const requestBody = {
        webhook_id: webhookId,
        addresses: contractAddresses.map(addr => addr.toLowerCase()),
        network: this.getNetworkApiString()
      };

      await this.makeAlchemyApiRequest('PUT', '/v2/webhook/update-webhook', requestBody);
      
       console.log('✅ Address Activity webhook updated successfully');
    } catch (error) {
      console.error('❌ Failed to update Address Activity webhook:', error);
      throw new Error(`Failed to update Address Activity webhook: ${error}`);
    }
  }
}

// Singleton instance
let alchemyNotifyServiceInstance: AlchemyNotifyService | null = null;

export function getAlchemyNotifyService(): AlchemyNotifyService {
  if (!alchemyNotifyServiceInstance) {
    alchemyNotifyServiceInstance = new AlchemyNotifyService();
  }
  return alchemyNotifyServiceInstance;
}

export default AlchemyNotifyService; 