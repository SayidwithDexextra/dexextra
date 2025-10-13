import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import { PusherServerService } from '@/lib/pusher-server';

// Hyperliquid Event Topic Hashes (Updated September 2, 2025)
// Source: contract-summary.md + ACTUAL deployed contract event signatures
export const HYPERLIQUID_EVENT_TOPICS = {
  // 🟢 HIGHEST PRIORITY - Essential for order book UI
  // ACTUAL DEPLOYED CONTRACT HASHES (from Polygonscan transaction analysis)
  ORDER_PLACED_ACTUAL: '0x348379522536ddee6c265b4008f5063ca68d4ee1e27925ba2a01236bab3c59e6', // REAL hash from Aluminum V1 OrderBook
  ORDER_PLACED: '0xb18a04414e157e27a7bd658d83da50aeed90007f362102747b7d7f34b8b75ce1', // Calculated (may not match deployed)
  ORDER_FILLED: '0xec7abeea99156aa60ed39992d78c95b0082f64d3469447a70c7fd11981912b9f',
  TRADE_EXECUTED: '0xb0100c4a25ad7c8bfaa42766f529176b9340f45755da88189bd092353fe50f0b',
  
  // 🟡 HIGH PRIORITY - Important for transaction tables
  ORDER_CANCELLED: '0xdc408a4b23cfe0edfa69e1ccca52c3f9e60bc441b3b25c09ec6defb38896a4f3',
  ORDER_CANCELLED_ACTUAL: '0xb2705df32ac67fc3101f496cd7036bf59074a603544d97d73650b6f09744986a', // REAL hash from deployed contract
  POSITION_CHANGED: '0x0c8435a0f8411018cf19a0463e3df6a28eaf6be12047606d6a194d4eef7941e5',
  COLLATERAL_DEPOSITED: '0x56bf5f326bb68ef9ee892959743daa870afd33ec3251e5136317ae3cb1c6ccc6',
  COLLATERAL_WITHDRAWN: '0x781581308889fe2553086d915caa15566aa19d071c47a980e90b71a7a45113d2',
  POSITION_UPDATED: '0x98186e5bd1f3f83b0feafb1ba9482dc65f678d929b705c7d7714cec6bee0ab5c',
  PNL_REALIZED: '0x908b4f47c9e48e3e3235843a31b7b41edf3cb7ed92150bd411b134f5c4f61f8a',
  
  // 🔵 MEDIUM PRIORITY - Advanced features  
  MULTI_MARKET_ORDER_EXECUTED: '0xe713fe8d6e47a5cf53ff5369b736d221611ea9e7df22f147e0d460bce80ee062',
  PORTFOLIO_REBALANCED: '0xdba6ecf824e543f91f2d9fce7c656c9eab3ed8706327214db08cf062e24b1e4b',
  MARKET_CREATED: '0x355c14b2f991e42aebf9be15844bf25fa28d4d47a02cd508a5141353c6bfeaef',
  
  // Legacy compatibility (deprecated)
  ORDER_ADDED: '0x184a980efa61c0acfeff92c0613bf2d3aceedadec9002d919c6bde9218b56c68',
  ORDER_MATCHED: '0xe5426fa5d075d3a0a2ce3373a3df298c78eec0ded097810b0e69a92c21b4b0b3',
} as const;

export interface AlchemyWebhookLog {
  account: { address: string };
  topics: string[];
  data: string;
  index: number;
  transaction: {
    hash: string;
    index: number;
    blockNumber: string;
    blockHash: string;
    from: { address: string };
    to: { address: string };
  };
}

export interface AlchemyWebhookEvent {
  type: string;
  block?: {
    logs?: AlchemyWebhookLog[];
  };
  event?: {
    data?: {
      block?: {
        logs?: AlchemyWebhookLog[];
      };
    };
  };
}

export interface ProcessedOrderEvent {
  orderId: string;
  trader: string;
  metricId: string;
  orderType: number;
  side: number;
  quantity: string;
  price: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  eventType: 'placed' | 'cancelled' | 'executed' | 'added' | 'matched';
  contractAddress: string;
}

export class OrderBookWebhookProcessor {
  private supabase;
  private pusherService: PusherServerService;
  private contractAddresses: Map<string, { metricId: string; contractType: string }> = new Map();
  private contractsLoaded = false;

  constructor() {
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase configuration is required');
    }

    this.supabase = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Initialize Pusher service for real-time broadcasting
    this.pusherService = new PusherServerService();
  }

  /**
   * Refresh contract addresses from Supabase (useful when markets are added/updated)
   */
  async refreshContractAddresses(): Promise<void> {
    console.log('🔄 [DYNAMIC] Refreshing contract addresses...');
    this.contractsLoaded = false;
    await this.loadContractAddresses();
  }

  /**
   * Ensure that a market exists in the markets table for foreign key constraint
   */
  private async ensureMarketExists(marketId: string, contractAddress: string): Promise<void> {
    try {
      console.log(`🔍 [MARKET_CHECK] Checking if market ${marketId} exists in markets table...`);
      
      // Check if market already exists
      const { data: existingMarket, error: checkError } = await this.supabase
        .from('markets')
        .select('market_id')
        .eq('market_id', marketId)
        .single();
      
      if (checkError && checkError.code !== 'PGRST116') {
        console.error(`❌ [MARKET_CHECK] Error checking market existence:`, checkError);
        return;
      }
      
      if (existingMarket) {
        console.log(`✅ [MARKET_CHECK] Market ${marketId} already exists`);
        return;
      }
      
      // Market doesn't exist, create it
      console.log(`🆕 [MARKET_CHECK] Creating missing market entry for ${marketId}`);
      
      const { error: insertError } = await this.supabase
        .from('markets')
        .insert({
          market_id: marketId,
          symbol: `${marketId.toUpperCase()}_HYPERLIQUID`,
          order_book_address: contractAddress,
          is_active: true,
          created_at: new Date().toISOString()
        });
      
      if (insertError) {
        console.error(`❌ [MARKET_CHECK] Failed to create market ${marketId}:`, insertError);
      } else {
        console.log(`✅ [MARKET_CHECK] Successfully created market ${marketId}`);
      }
      
    } catch (error) {
      console.error(`❌ [MARKET_CHECK] Error ensuring market exists:`, error);
    }
  }

  /**
   * Load contract addresses dynamically from Supabase orderbook_markets table
   */
  private async loadContractAddresses(): Promise<void> {
    try {
      console.log('🔄 [DYNAMIC] Loading contract addresses from Supabase...');
      
      const { data: markets, error } = await this.supabase
        .from('orderbook_markets')
        .select(`
          metric_id,
          market_address,
          factory_address,
          central_vault_address,
          order_router_address,
          market_status,
          is_active
        `)
        .eq('market_status', 'ACTIVE')
        .eq('is_active', true);

      if (error) {
        console.error('❌ [DYNAMIC] Failed to load contract addresses:', error);
        throw new Error(`Failed to load contract addresses: ${error.message}`);
      }

      // Clear existing addresses
      this.contractAddresses.clear();

      // Process each market and add its contracts to the map
      for (const market of markets || []) {
        const metricId = market.metric_id;
        
        // Add OrderBook contract (market_address)
        if (market.market_address) {
          const address = market.market_address.toLowerCase();
          this.contractAddresses.set(address, { 
            metricId, 
            contractType: 'OrderBook' 
          });
          console.log(`✅ [DYNAMIC] Added OrderBook: ${address} → ${metricId}`);
        }

        // Add Factory contract
        if (market.factory_address) {
          const address = market.factory_address.toLowerCase();
          this.contractAddresses.set(address, { 
            metricId, 
            contractType: 'Factory' 
          });
          console.log(`✅ [DYNAMIC] Added Factory: ${address} → ${metricId}`);
        }

        // Add VaultRouter contract (central_vault_address)
        if (market.central_vault_address) {
          const address = market.central_vault_address.toLowerCase();
          this.contractAddresses.set(address, { 
            metricId, 
            contractType: 'VaultRouter' 
          });
          console.log(`✅ [DYNAMIC] Added VaultRouter: ${address} → ${metricId}`);
        }

        // Add TradingRouter contract (order_router_address)
        if (market.order_router_address) {
          const address = market.order_router_address.toLowerCase();
          this.contractAddresses.set(address, { 
            metricId, 
            contractType: 'TradingRouter' 
          });
          console.log(`✅ [DYNAMIC] Added TradingRouter: ${address} → ${metricId}`);
        }
      }

      this.contractsLoaded = true;
      console.log(`✅ [DYNAMIC] Loaded ${this.contractAddresses.size} contract addresses from ${markets?.length || 0} active markets`);
      
      // Log summary of loaded contracts
      const contractSummary = Array.from(this.contractAddresses.entries()).reduce((acc, [address, info]) => {
        if (!acc[info.contractType]) acc[info.contractType] = 0;
        acc[info.contractType]++;
        return acc;
      }, {} as Record<string, number>);
      
      console.log('📊 [DYNAMIC] Contract summary:', contractSummary);

    } catch (error) {
      console.error('❌ [DYNAMIC] Error loading contract addresses:', error);
      this.contractsLoaded = false;
      throw error;
    }
  }

  /**
   * Process Alchemy webhook event and extract order events
   */
  async processWebhookEvent(webhookData: AlchemyWebhookEvent): Promise<{
    processed: number;
    orders: ProcessedOrderEvent[];
    errors: string[];
  }> {
    const result = {
      processed: 0,
      orders: [] as ProcessedOrderEvent[],
      errors: [] as string[]
    };

    try {
      console.log(`🔍 [DEBUG] Starting webhook processing for event type: ${webhookData.type}`);
      
      // Load contract addresses dynamically if not already loaded
      if (!this.contractsLoaded) {
        await this.loadContractAddresses();
      }
      
      // Extract logs from different webhook formats
      const logs = this.extractLogsFromWebhook(webhookData);
      
      console.log(`📋 Processing ${logs.length} logs for order events`);
      
      // If no logs found, dump the webhook data for debugging
      if (logs.length === 0) {
        console.log(`⚠️ [DEBUG] No logs found in webhook. Webhook structure:`, {
          type: webhookData.type,
          hasBlock: !!webhookData.block,
          hasEvent: !!webhookData.event,
          hasEventData: !!webhookData.event?.data,
          hasEventDataBlock: !!webhookData.event?.data?.block,
          blockLogsCount: webhookData.block?.logs?.length || 0,
          eventDataBlockLogsCount: webhookData.event?.data?.block?.logs?.length || 0
        });
      }

      for (const log of logs) {
        try {
          console.log(`🔍 [DEBUG] Processing log ${log.index} from ${log.account.address}:`, {
            topics: log.topics.map((t, i) => `${i}: ${t}`),
            dataLength: log.data?.length,
            txHash: log.transaction.hash,
            blockNumber: log.transaction.blockNumber
          });
          
          const orderEvent = await this.processOrderLog(log);
          if (orderEvent) {
            result.orders.push(orderEvent);
            
            // Save to Supabase
            const saved = await this.saveOrderToSupabase(orderEvent);
            if (saved) {
              result.processed++;
              console.log(`✅ Saved order ${orderEvent.orderId} to Supabase`);
              
              // 🚀 Real-time broadcast after successful save
              await this.broadcastOrderUpdate(orderEvent);
            } else {
              result.errors.push(`Failed to save order ${orderEvent.orderId} to Supabase`);
            }
          }
        } catch (error) {
          const errorMsg = `Failed to process log: ${(error as Error).message}`;
          result.errors.push(errorMsg);
          console.error(`❌ ${errorMsg}`);
        }
      }

    } catch (error) {
      const errorMsg = `Failed to process webhook event: ${(error as Error).message}`;
      result.errors.push(errorMsg);
      console.error(`❌ ${errorMsg}`);
    }

    return result;
  }

  /**
   * Extract logs from different Alchemy webhook formats
   */
  private extractLogsFromWebhook(webhookData: AlchemyWebhookEvent): AlchemyWebhookLog[] {
    const logs: AlchemyWebhookLog[] = [];

    // GraphQL webhook format
    if (webhookData.event?.data?.block?.logs) {
      logs.push(...webhookData.event.data.block.logs);
    }

    // Direct block format
    if (webhookData.block?.logs) {
      logs.push(...webhookData.block.logs);
    }

    console.log(`🔍 [DEBUG] Total logs extracted: ${logs.length}`);
    
    // Debug: Log all contract addresses to see what we're working with
    if (logs.length > 0) {
      console.log(`🔍 [DEBUG] Contract addresses in logs:`, logs.map((log, i) => ({
        index: i,
        address: log.account.address,
        normalized: log.account.address.toLowerCase(),
        topics: log.topics.length,
        firstTopic: log.topics[0]
      })));
    }

    // Dynamic filtering based on loaded contract addresses
    console.log(`🔍 [DYNAMIC] Filtering logs using dynamic contract addresses`);
    
    const relevantLogs = logs.filter(log => {
      const address = log.account.address.toLowerCase();
      const contractInfo = this.contractAddresses.get(address);
      
      if (contractInfo) {
        console.log(`✅ [DYNAMIC] Found relevant log from ${contractInfo.contractType}: ${address} → ${contractInfo.metricId}`);
        return true;
      } else {
        console.log(`🔍 [DYNAMIC] Filtering out log from unknown contract: ${address}`);
        console.log(`🔍 [DYNAMIC] Known contracts:`, Array.from(this.contractAddresses.keys()).slice(0, 10));
        return false;
      }
    });

    console.log(`🔍 [DYNAMIC] Found ${relevantLogs.length} relevant logs from ${logs.length} total logs using dynamic contract list`);
    return relevantLogs;
  }

  /**
   * Process individual order log and extract order data
   */
  private async processOrderLog(log: AlchemyWebhookLog): Promise<ProcessedOrderEvent | null> {
    const contractAddress = log.account.address.toLowerCase();
    const topics = log.topics;
    
    if (topics.length === 0) {
      return null;
    }

    const eventSignature = topics[0];
    const contractInfo = this.contractAddresses.get(contractAddress);

    if (!contractInfo) {
      console.log(`⚠️ [DYNAMIC] Unknown contract address: ${contractAddress}`);
      return null;
    }

    console.log(`🔍 [DYNAMIC] Processing ${contractInfo.contractType} event from ${contractInfo.metricId}: ${eventSignature}`);

    // Route to appropriate processor based on dynamic contract type
    switch (contractInfo.contractType) {
      case 'TradingRouter':
        return this.processTradingRouterEvent(log, eventSignature);
      
      case 'VaultRouter':
        return this.processVaultRouterEvent(log, eventSignature);
      
      case 'OrderBook':
        return this.processOrderBookEvent(log, eventSignature, contractInfo.metricId);
      
      case 'Factory':
        return this.processFactoryEvent(log, eventSignature);
      
      default:
        console.log(`⚠️ [DYNAMIC] Unknown contract type: ${contractInfo.contractType}`);
        return null;
    }
  }

  /**
   * Process OrderRouter events (OrderPlaced, OrderCancelled, OrderExecuted)
   */
  private processOrderRouterEvent(log: AlchemyWebhookLog, eventSignature: string): ProcessedOrderEvent | null {
    try {
      const topics = log.topics;
      const data = log.data;

      switch (eventSignature) {
        case HYPERLIQUID_EVENT_TOPICS.ORDER_PLACED:
          // OrderPlaced(uint256 indexed orderId, address indexed trader, string indexed metricId, uint8 orderType, uint8 side, uint256 quantity, uint256 price)
          console.log(`🔍 [DEBUG] Processing OrderPlaced event from OrderRouter`);
          console.log(`🔍 [DEBUG] Topics length: ${topics.length}, Data: ${data}`);
          
          if (topics.length >= 4) {
            const orderId = ethers.getBigInt(topics[1]).toString();
            const trader = ethers.getAddress('0x' + topics[2].slice(26));
            const metricIdHash = topics[3];
            
            console.log(`🔍 [DEBUG] OrderPlaced decoded:`, {
              orderId,
              trader,
              metricIdHashRaw: metricIdHash,
              metricIdHashLength: metricIdHash?.length
            });
            
            // Decode data for orderType, side, quantity, price
            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(
              ['uint8', 'uint8', 'uint256', 'uint256'],
              data
            );

            return {
              orderId,
              trader,
              metricId: this.getMetricIdFromHash(metricIdHash),
              orderType: Number(decodedData[0]),
              side: Number(decodedData[1]),
              quantity: decodedData[2].toString(),
              price: decodedData[3].toString(),
              txHash: log.transaction.hash,
              blockNumber: parseInt(log.transaction.blockNumber),
              logIndex: log.index,
              eventType: 'placed',
              contractAddress: log.account.address
            };
          }
          break;

        case HYPERLIQUID_EVENT_TOPICS.ORDER_CANCELLED:
          // OrderCancelled(uint256 indexed orderId, address indexed trader, uint256 timestamp)
          if (topics.length >= 3) {
            const orderId = ethers.getBigInt(topics[1]).toString();
            const trader = ethers.getAddress('0x' + topics[2].slice(26));

            return {
              orderId,
              trader,
              metricId: '', // Will be filled from database lookup
              orderType: 0,
              side: 0,
              quantity: '0',
              price: '0',
              txHash: log.transaction.hash,
              blockNumber: parseInt(log.transaction.blockNumber),
              logIndex: log.index,
              eventType: 'cancelled',
              contractAddress: log.account.address
            };
          }
          break;

        case HYPERLIQUID_EVENT_TOPICS.ORDER_FILLED:
          // OrderExecuted(uint256 indexed orderId, address indexed trader, uint256 executedQuantity, uint256 executedPrice, uint256 timestamp)
          if (topics.length >= 3) {
            const orderId = ethers.getBigInt(topics[1]).toString();
            const trader = ethers.getAddress('0x' + topics[2].slice(26));
            
            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(
              ['uint256', 'uint256', 'uint256'],
              data
            );

            return {
              orderId,
              trader,
              metricId: '', // Will be filled from database lookup
              orderType: 0,
              side: 0,
              quantity: decodedData[0].toString(), // executedQuantity
              price: decodedData[1].toString(), // executedPrice
              txHash: log.transaction.hash,
              blockNumber: parseInt(log.transaction.blockNumber),
              logIndex: log.index,
              eventType: 'executed',
              contractAddress: log.account.address
            };
          }
          break;
      }
    } catch (error) {
      console.error(`❌ Failed to process OrderRouter event: ${(error as Error).message}`);
    }

    return null;
  }

  /**
   * Process OrderBook events (OrderAdded, OrderMatched, OrderPlaced, etc.)
   */
  private processOrderBookEvent(log: AlchemyWebhookLog, eventSignature: string, metricId?: string): ProcessedOrderEvent | null {
    try {
      const topics = log.topics;
      const data = log.data;

      switch (eventSignature) {
        case HYPERLIQUID_EVENT_TOPICS.ORDER_PLACED_ACTUAL:
        case HYPERLIQUID_EVENT_TOPICS.ORDER_PLACED:
          // OrderPlaced(bytes32 indexed orderId, address indexed user, uint8 side, uint256 size, uint256 price, uint256 timestamp)
          // NOTE: Both market and limit orders emit OrderPlaced events
          console.log(`🔍 [DYNAMIC] Processing OrderPlaced event`);
          if (topics.length >= 3) {
            const orderId = topics[1]; // bytes32 orderId
            const user = ethers.getAddress('0x' + topics[2].slice(26));
            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(['uint8', 'uint256', 'uint256', 'uint256'], data);

            // Determine order type from price: market orders have price = 0, limit orders have price > 0
            const rawPrice = decodedData[2];
            const isMarketOrder = rawPrice === 0n;
            const orderType = isMarketOrder ? 0 : 1; // 0 = MARKET, 1 = LIMIT

            console.log(`📊 [ORDER_TYPE] Determining order type:`, {
              rawPrice: rawPrice.toString(),
              isMarketOrder,
              orderType: isMarketOrder ? 'MARKET' : 'LIMIT'
            });

            return {
              orderId: orderId,
              trader: user,
              metricId: metricId || 'UNKNOWN',
              orderType: orderType, // Now correctly determined from price field
              side: Number(decodedData[0]),
              quantity: decodedData[1].toString(),
              price: decodedData[2].toString(),
              txHash: log.transaction.hash,
              blockNumber: parseInt(log.transaction.blockNumber),
              logIndex: log.index,
              eventType: 'placed',
              contractAddress: log.account.address
            };
          }
          break;

        case HYPERLIQUID_EVENT_TOPICS.ORDER_FILLED:
          // OrderFilled(bytes32 indexed orderId, address indexed taker, address indexed maker, uint256 size, uint256 price, uint256 timestamp)
          console.log(`🔍 [DYNAMIC] Processing OrderFilled event`);
          if (topics.length >= 4) {
            const orderId = topics[1];
            const taker = ethers.getAddress('0x' + topics[2].slice(26));
            const maker = ethers.getAddress('0x' + topics[3].slice(26));
            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256', 'uint256'], data);

            return {
              orderId: orderId,
              trader: taker, // Use taker as primary trader
              metricId: metricId || 'UNKNOWN',
              orderType: 1, // LIMIT
              side: 0, // Will be determined from order data
              quantity: decodedData[0].toString(),
              price: decodedData[1].toString(),
              txHash: log.transaction.hash,
              blockNumber: parseInt(log.transaction.blockNumber),
              logIndex: log.index,
              eventType: 'executed',
              contractAddress: log.account.address
            };
          }
          break;

        case HYPERLIQUID_EVENT_TOPICS.ORDER_CANCELLED:
        case HYPERLIQUID_EVENT_TOPICS.ORDER_CANCELLED_ACTUAL:
          // OrderCancelled(bytes32 indexed orderId, address indexed user, uint256 timestamp)
          console.log(`🔍 [DYNAMIC] Processing OrderCancelled event (signature: ${eventSignature})`);
          if (topics.length >= 3) {
            const orderId = topics[1];
            const user = ethers.getAddress('0x' + topics[2].slice(26));

            console.log(`📋 [CANCELLATION] Parsed cancellation event:`, {
              orderId,
              user,
              txHash: log.transaction.hash,
              blockNumber: log.transaction.blockNumber
            });

            return {
              orderId: orderId,
              trader: user,
              metricId: metricId || 'UNKNOWN',
              orderType: 1,
              side: 0,
              quantity: '0',
              price: '0',
              txHash: log.transaction.hash,
              blockNumber: parseInt(log.transaction.blockNumber),
              logIndex: log.index,
              eventType: 'cancelled',
              contractAddress: log.account.address
            };
          }
          break;

        case HYPERLIQUID_EVENT_TOPICS.TRADE_EXECUTED:
          // TradeExecuted(address indexed buyer, address indexed seller, uint256 size, uint256 price, uint256 timestamp)
          console.log(`🔍 [DYNAMIC] Processing TradeExecuted event`);
          if (topics.length >= 3) {
            const buyer = ethers.getAddress('0x' + topics[1].slice(26));
            const seller = ethers.getAddress('0x' + topics[2].slice(26));
            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256', 'uint256'], data);

            // Create a trade event (not tied to specific order)
            return {
              orderId: `trade_${log.transaction.hash}_${log.index}`,
              trader: buyer, // Primary trader (could create another for seller)
              metricId: metricId || 'UNKNOWN',
              orderType: 0, // MARKET (executed immediately)
              side: 0, // BUY
              quantity: decodedData[0].toString(),
              price: decodedData[1].toString(),
              txHash: log.transaction.hash,
              blockNumber: parseInt(log.transaction.blockNumber),
              logIndex: log.index,
              eventType: 'executed',
              contractAddress: log.account.address
            };
          }
          break;

        case HYPERLIQUID_EVENT_TOPICS.ORDER_ADDED:
          // Legacy: OrderAdded(uint256 indexed orderId, address indexed trader, uint8 side, uint256 quantity, uint256 price)
          console.log(`🔍 [DYNAMIC] Processing legacy OrderAdded event`);
          if (topics.length >= 3) {
            const orderId = ethers.getBigInt(topics[1]).toString();
            const trader = ethers.getAddress('0x' + topics[2].slice(26));
            
            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(
              ['uint8', 'uint256', 'uint256'],
              data
            );

            return {
              orderId,
              trader,
              metricId: metricId || 'UNKNOWN',
              orderType: 1, // Assume LIMIT for OrderBook
              side: Number(decodedData[0]),
              quantity: decodedData[1].toString(),
              price: decodedData[2].toString(),
              txHash: log.transaction.hash,
              blockNumber: parseInt(log.transaction.blockNumber),
              logIndex: log.index,
              eventType: 'added',
              contractAddress: log.account.address
            };
          }
          break;

        case HYPERLIQUID_EVENT_TOPICS.ORDER_MATCHED:
          // OrderMatched events can be processed for execution tracking
          console.log(`📊 [DYNAMIC] OrderMatched event detected in log ${log.index} for ${metricId}`);
          // Implementation depends on specific matching requirements
          break;

        default:
          console.warn(`⚠️ [DYNAMIC] Unknown OrderBook event signature: ${eventSignature}`);
          console.log(`🔍 [DEBUG] Event details:`, {
            contractAddress: log.account.address,
            metricId,
            topicsCount: topics.length,
            dataLength: data?.length || 0,
            txHash: log.transaction.hash,
            blockNumber: log.transaction.blockNumber
          });
          
          // Log topics for manual analysis
          topics.forEach((topic, index) => {
            console.log(`🔍 [DEBUG] Topic[${index}]: ${topic}`);
          });
          break;
      }
    } catch (error) {
      console.error(`❌ Failed to process OrderBook event: ${(error as Error).message}`);
    }

    return null;
  }


  /**
   * Process TradingRouter events (new Hyperliquid unified interface)
   */
  private processTradingRouterEvent(log: AlchemyWebhookLog, eventSignature: string): ProcessedOrderEvent | null {
    try {
      const topics = log.topics;
      const data = log.data;

      switch (eventSignature) {
        case HYPERLIQUID_EVENT_TOPICS.MULTI_MARKET_ORDER_EXECUTED:
          // MultiMarketOrderExecuted(address indexed user, uint256 orderCount, uint256 timestamp)
          console.log(`📊 Multi-market order executed by ${topics[1]}`);
          // This could trigger updates to multiple positions
          return null; // Composite event, handled separately
          
        case HYPERLIQUID_EVENT_TOPICS.PORTFOLIO_REBALANCED:
          // PortfolioRebalanced(address indexed user, uint256 marketCount, uint256 timestamp)
          console.log(`⚖️ Portfolio rebalanced for user ${topics[1]}`);
          return null; // Portfolio event, not a direct order
      }
    } catch (error) {
      console.error(`❌ Failed to process TradingRouter event: ${(error as Error).message}`);
    }

    return null;
  }

  /**
   * Process VaultRouter events (collateral and margin management)
   */
  private processVaultRouterEvent(log: AlchemyWebhookLog, eventSignature: string): ProcessedOrderEvent | null {
    try {
      const topics = log.topics;
      const data = log.data;

      switch (eventSignature) {
        case HYPERLIQUID_EVENT_TOPICS.COLLATERAL_DEPOSITED:
          // CollateralDeposited(address indexed user, uint256 amount, uint256 newBalance)
          if (topics.length >= 2) {
            const user = ethers.getAddress('0x' + topics[1].slice(26));
            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256'], data);
            
            console.log(`💰 Collateral deposited: ${user}, amount: ${decodedData[0]}, new balance: ${decodedData[1]}`);
            
            return {
              orderId: `deposit_${log.transaction.hash}_${log.index}`,
              trader: user,
              metricId: 'COLLATERAL_DEPOSIT',
              orderType: 0,
              side: 0, // Deposit is like a "buy" of collateral
              quantity: decodedData[0].toString(),
              price: '1000000', // 1 USDC = 1 USD (6 decimals)
              txHash: log.transaction.hash,
              blockNumber: parseInt(log.transaction.blockNumber),
              logIndex: log.index,
              eventType: 'executed', // Deposits are immediately executed
              contractAddress: log.account.address
            };
          }
          break;

        case HYPERLIQUID_EVENT_TOPICS.COLLATERAL_WITHDRAWN:
          // CollateralWithdrawn(address indexed user, uint256 amount, uint256 newBalance)
          if (topics.length >= 2) {
            const user = ethers.getAddress('0x' + topics[1].slice(26));
            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256'], data);
            
            console.log(`💸 Collateral withdrawn: ${user}, amount: ${decodedData[0]}, new balance: ${decodedData[1]}`);
            
            return {
              orderId: `withdraw_${log.transaction.hash}_${log.index}`,
              trader: user,
              metricId: 'COLLATERAL_WITHDRAWAL',
              orderType: 0,
              side: 1, // Withdrawal is like a "sell" of collateral
              quantity: decodedData[0].toString(),
              price: '1000000', // 1 USDC = 1 USD (6 decimals)
              txHash: log.transaction.hash,
              blockNumber: parseInt(log.transaction.blockNumber),
              logIndex: log.index,
              eventType: 'executed', // Withdrawals are immediately executed
              contractAddress: log.account.address
            };
          }
          break;

        case HYPERLIQUID_EVENT_TOPICS.POSITION_UPDATED:
          // PositionUpdated(address indexed user, bytes32 indexed marketId, int256 size, uint256 entryPrice)
          if (topics.length >= 3) {
            const user = ethers.getAddress('0x' + topics[1].slice(26));
            const marketId = topics[2];
            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(['int256', 'uint256'], data);
            
            console.log(`📊 Position updated: ${user}, market: ${marketId}, size: ${decodedData[0]}, price: ${decodedData[1]}`);
            // Position updates are handled separately, not as orders
            return null;
          }
          break;

        case HYPERLIQUID_EVENT_TOPICS.PNL_REALIZED:
          // PnLRealized(address indexed user, bytes32 indexed marketId, int256 pnl)
          if (topics.length >= 3) {
            const user = ethers.getAddress('0x' + topics[1].slice(26));
            const marketId = topics[2];
            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(['int256'], data);
            
            console.log(`💹 PnL realized: ${user}, market: ${marketId}, pnl: ${decodedData[0]}`);
            // PnL events are tracked separately, not as orders
            return null;
          }
          break;
      }
    } catch (error) {
      console.error(`❌ Failed to process VaultRouter event: ${(error as Error).message}`);
    }

    return null;
  }


  /**
   * Process Factory events (market creation and management)
   */
  private processFactoryEvent(log: AlchemyWebhookLog, eventSignature: string): ProcessedOrderEvent | null {
    try {
      const topics = log.topics;
      const data = log.data;

      switch (eventSignature) {
        case HYPERLIQUID_EVENT_TOPICS.MARKET_CREATED:
          // MarketCreated(bytes32 indexed marketId, address indexed orderBookAddress, string symbol, address indexed creator)
          if (topics.length >= 4) {
            const marketId = topics[1];
            const orderBookAddress = ethers.getAddress('0x' + topics[2].slice(26));
            const creator = ethers.getAddress('0x' + topics[3].slice(26));
            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(['string'], data);
            
            console.log(`🏭 Market created: ${marketId}, orderbook: ${orderBookAddress}, symbol: ${decodedData[0]}, creator: ${creator}`);
            // Market creation events are handled separately
            return null;
          }
          break;
      }
    } catch (error) {
      console.error(`❌ Failed to process Factory event: ${(error as Error).message}`);
    }

    return null;
  }

  /**
   * Save processed order event to Supabase
   */
  private async saveOrderToSupabase(orderEvent: ProcessedOrderEvent): Promise<boolean> {
    try {
      console.log(`🔍 [DEBUG] Starting saveOrderToSupabase for order:`, {
        orderId: orderEvent.orderId,
        eventType: orderEvent.eventType,
        trader: orderEvent.trader,
        contractAddress: orderEvent.contractAddress,
        txHash: orderEvent.txHash,
        blockNumber: orderEvent.blockNumber,
        rawMetricId: orderEvent.metricId
      });

      // Strategy: Use the dynamic metricId that was resolved during log processing
      let metricId = orderEvent.metricId;
      let marketId: string | null = null;

      console.log(`🔍 [DYNAMIC] Using metricId from dynamic contract lookup: "${metricId}"`);
      console.log(`🔍 [DYNAMIC] Contract address: "${orderEvent.contractAddress}"`);

      // PRIMARY STRATEGY: Use the metricId directly as marketId (since it's from our dynamic lookup)
      if (metricId && metricId !== 'UNKNOWN') {
        marketId = metricId;
        console.log(`✅ [DYNAMIC] Using dynamic metricId as marketId: ${marketId}`);
        
        // Ensure this marketId exists in the markets table (for foreign key constraint)
        if (marketId) {
          await this.ensureMarketExists(marketId, orderEvent.contractAddress?.toLowerCase() || '');
        }
      } else {
        // FALLBACK: Try lookup in orderbook_markets table by contract address
        const normalizedAddress = orderEvent.contractAddress?.toLowerCase() || '';
        console.log(`🔍 [DYNAMIC] Fallback: Looking up marketId by contract address: ${normalizedAddress}`);
        
        const { data: market, error: contractLookupError } = await this.supabase
          .from('orderbook_markets')
          .select('metric_id')
          .ilike('market_address', normalizedAddress)
          .single();
        
        if (!contractLookupError && market && market.metric_id) {
          marketId = market.metric_id;
          console.log(`✅ [DYNAMIC] Found marketId via contract address lookup: ${marketId}`);
          
          // Ensure this marketId exists in the markets table (for foreign key constraint)
          if (marketId) {
            await this.ensureMarketExists(marketId, normalizedAddress);
          }
        } else {
          console.log(`⚠️ [DYNAMIC] No market found for contract address: ${normalizedAddress}`);
        }
      }

      // FALLBACK STRATEGY: For non-placed events, lookup market from existing order
      if (!marketId && orderEvent.orderId) {
        console.log(`🔍 [DYNAMIC] Fallback: Attempting to lookup market from existing order ${orderEvent.orderId}`);
        const { data: existingOrder, error: lookupError } = await this.supabase
          .from('orders')
          .select('market_id')
          .eq('order_id', orderEvent.orderId)
          .single();
        
        if (lookupError) {
          console.error(`❌ [DYNAMIC] Error looking up existing order:`, lookupError);
        }
        
        if (existingOrder) {
          marketId = existingOrder.market_id;
          console.log(`✅ [DYNAMIC] Found marketId from existing order: "${marketId}"`);
        } else {
          console.warn(`⚠️ [DYNAMIC] No existing order found for orderId: ${orderEvent.orderId}`);
        }
      }

      // Final validation
      if (!marketId) {
        console.error(`❌ [DYNAMIC] No market found for metricId: "${metricId}" or contract: "${orderEvent.contractAddress}"`);
        
        // Additional debugging: Let's see what markets exist
        console.log(`🔍 [DYNAMIC] Fetching all available markets for debugging...`);
        const { data: allMarkets, error: allMarketsError } = await this.supabase
          .from('orderbook_markets')
          .select('metric_id, market_status, market_address')
          .eq('market_status', 'ACTIVE')
          .eq('is_active', true)
          .limit(10);
        
        if (allMarketsError) {
          console.error(`❌ [DYNAMIC] Error fetching all markets:`, allMarketsError);
        } else {
          console.log(`🔍 [DYNAMIC] Available active markets:`, allMarkets?.map(m => ({
            metric_id: m.metric_id,
            market_address: m.market_address
          })));
        }
        
        return false;
      }

      console.log(`✅ [DEBUG] Final marketId: "${marketId}"`);
      console.log(`✅ [DEBUG] Final metricId: "${metricId}"`);

      // Handle different event types
      switch (orderEvent.eventType) {
        case 'placed':
          console.log(`💾 [DEBUG] Saving placed order (limit order) to database...`);
          return await this.saveNewOrder(orderEvent, marketId);
        
        case 'added':
          console.log(`💾 [DEBUG] Saving added order (market order) to database...`);
          return await this.saveNewOrder(orderEvent, marketId);
        
        case 'cancelled':
          console.log(`💾 [DEBUG] Updating order status to cancelled...`);
          const cancellationResult = await this.updateOrderStatus(orderEvent.orderId, 'cancelled');
          
          // Broadcast cancellation event for real-time UI updates
          if (cancellationResult) {
            await this.broadcastOrderCancellation(orderEvent);
          }
          
          return cancellationResult;
        
        case 'executed':
          console.log(`💾 [DEBUG] Updating order execution details...`);
          return await this.updateOrderExecution(orderEvent);
        
        case 'matched':
          console.log(`💾 [DEBUG] Processing order match...`);
          // For now, treat matched events as executions
          return await this.updateOrderExecution(orderEvent);
        
        default:
          console.warn(`⚠️ [DEBUG] Unknown event type ${orderEvent.eventType} - not saved to DB`);
          return true;
      }

    } catch (error) {
      console.error(`❌ Failed to save order to Supabase: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Save new order to Supabase (simplified orders table)
   */
  private async saveNewOrder(orderEvent: ProcessedOrderEvent, marketId: string): Promise<boolean> {
    try {
      // Convert order data to Supabase format
      // CORRECT DECIMAL HANDLING - OrderBook uses 6 decimals (USDC precision), NOT 18!
      // Contract constant: PRICE_PRECISION = 1e6 (6 decimals for USDC compatibility)
      const PRICE_PRECISION = 1000000; // 1e6
      
      const quantityConverted = parseFloat(orderEvent.quantity) / PRICE_PRECISION;
      const priceConverted = parseFloat(orderEvent.price) / PRICE_PRECISION;
      
      // Additional validation: For market orders, ensure size represents UNITS, not USDC value
      let actualUnits = quantityConverted;
      if (orderEvent.orderType === 0 && priceConverted > 0) { // Market order with price data
        // If this is a market order and we have price, verify if quantity represents units or USDC
        const estimatedUSDCValue = quantityConverted * priceConverted;
        console.log(`🔍 [SIZE_VALIDATION] Market order size analysis:`, {
          rawQuantity: orderEvent.quantity,
          convertedQuantity: quantityConverted,
          priceConverted,
          estimatedUSDCValue,
          likelyInterpretation: estimatedUSDCValue > 1000 ? 'quantity_is_units' : 'quantity_might_be_usdc_value'
        });
      }
      
      console.log(`🔢 [DEBUG] Decimal conversion (6 decimals):`, {
        rawQuantity: orderEvent.quantity,
        rawPrice: orderEvent.price,
        quantityConverted: actualUnits,
        priceConverted,
        precision: PRICE_PRECISION,
        orderType: orderEvent.orderType,
        interpretation: 'quantity_represents_token_units'
      });
      
      // Validate raw values first to prevent constraint violations
      if (orderEvent.quantity === '0' || orderEvent.quantity === '0x0') {
        console.error(`❌ [ERROR] Invalid quantity: ${orderEvent.quantity} - violates positive_values constraint`);
        return false;
      }
      
      // Use converted values with proper precision
      const quantity = actualUnits > 0 ? actualUnits : 0.000001; // Minimum fallback
      const price = priceConverted > 0 ? priceConverted : null; // NULL allowed for market orders
      
      console.log(`✅ [DEBUG] Final values for database:`, {
        quantity,
        price,
        meetsConstraints: quantity > 0 && (price === null || price > 0)
      });
      
      // Additional validation to prevent constraint violation
      if (quantity <= 0) {
        console.error(`❌ [ERROR] Quantity ${quantity} violates size > 0 constraint`);
        return false;
      }
      if (price !== null && price <= 0) {
        console.error(`❌ [ERROR] Price ${price} violates price > 0 constraint`);
        return false;
      }
      
      // Determine order type and status based on contract orderType field, NOT eventType
      // Both market and limit orders emit OrderPlaced events in the smart contract
      let orderType: string;
      let orderStatus: string;
      
      // Use the actual orderType from the contract event
      orderType = this.getOrderTypeString(orderEvent.orderType);
      
      // Determine status based on actual order type
      if (orderEvent.orderType === 0) { // OrderType.MARKET = 0
        orderStatus = 'FILLED'; // Market orders are immediately executed
        console.log(`📊 [DEBUG] Processing MARKET order (orderType=0, eventType=${orderEvent.eventType})`);
      } else {
        orderStatus = 'PENDING'; // Limit orders start as pending
        console.log(`📊 [DEBUG] Processing LIMIT order (orderType=${orderEvent.orderType}, eventType=${orderEvent.eventType})`);
      }
      
      // Additional handling for execution events
      if (orderEvent.eventType === 'executed' || orderEvent.eventType === 'added') {
        orderStatus = 'FILLED';
        console.log(`📊 [DEBUG] Order execution detected, setting status to FILLED`);
      }
      
      // Calculate USDC value for user understanding
      const usdcValue = price ? quantity * price : null;
      
      // 🚨 Use upsert to avoid duplicate key violations
      // Map to exact database schema - orders table
      const orderData = {
        order_id: orderEvent.orderId.toString(), // Ensure string type for database
        market_id: marketId,
        user_address: orderEvent.trader,
        order_type: orderType,
        side: orderEvent.side === 0 ? 'BUY' : 'SELL',
        size: quantity, // This correctly shows units purchased (e.g., 20.0 units)
        price: price,
        filled: 0,
        status: orderStatus,
        margin_reserved: quantity * (price ?? 1) * 0.1,
        // Additional columns we added
        tx_hash: orderEvent.txHash || null,
        block_number: orderEvent.blockNumber || null,
        log_index: orderEvent.logIndex || null,
        contract_address: orderEvent.contractAddress || null,
        event_type: orderEvent.eventType || 'placed',
        quantity: quantity, // Alias column - shows units purchased
        trader_address: orderEvent.trader, // Alias column
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      console.log(`💰 [ORDER_SUMMARY] Order value breakdown:`, {
        units_purchased: quantity,
        price_per_unit: price,
        total_usdc_value: usdcValue,
        order_type: orderType,
        explanation: price ? `${quantity} units × $${price}/unit = $${usdcValue} USDC` : 'Market order - price determined at execution'
      });

      console.log(`📝 [DEBUG] Inserting order data:`, orderData);

      const { data: upsertedRow, error } = await this.supabase
        .from('orders')
        .upsert([orderData], { onConflict: 'order_id' })
        .select('order_id')
        .single();

      if (error) {
        console.error(`❌ Supabase upsert error: ${error.message}`);
        return false;
      }

      console.log(`✅ Successfully saved order ${orderEvent.orderId} to Supabase orders table`);
      
      // For executed orders (market orders or filled limit orders), update positions
      if (orderStatus === 'FILLED' || orderEvent.eventType === 'executed') {
        console.log(`📊 [DEBUG] Order is filled, updating position...`);
        await this.updatePosition(orderEvent, marketId, quantity, price ?? 1);
        
        // CRITICAL: For market orders, trigger unit decrementing in order book
        if (orderType === 'MARKET') {
          console.log(`🔄 [MARKET_ORDER] Triggering unit decrement for market order execution...`);
          await this.processMarketOrderUnitDecrement({
            orderId: orderEvent.orderId,
            marketId: marketId,
            side: orderEvent.side === 0 ? 'BUY' : 'SELL',
            size: quantity,
            orderType: 'MARKET'
          });
        }
      }
      
      return true;

    } catch (error) {
      console.error(`❌ Failed to save new order: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Update or create position when an order is filled
   */
  private async updatePosition(
    orderEvent: ProcessedOrderEvent, 
    marketId: string, 
    quantity: number, 
    price: number
  ): Promise<boolean> {
    try {
      console.log(`🏦 [DEBUG] Starting position update for trader: ${orderEvent.trader}`);
      
      const isLong = orderEvent.side === 0; // 0 = BUY (long), 1 = SELL (short)
      const trader = orderEvent.trader;
      
      console.log(`📊 [DEBUG] Position details:`, {
        trader,
        marketId,
        isLong,
        quantity,
        price,
        orderId: orderEvent.orderId
      });

      // Check if trader already has a position in this market
      const { data: existingPosition, error: positionLookupError } = await this.supabase
        .from('market_positions')
        .select('*')
        .eq('market_id', marketId)
        .eq('trader_wallet_address', trader)
        .eq('is_settled', false)
        .single();

      if (positionLookupError && positionLookupError.code !== 'PGRST116') {
        console.error(`❌ [DEBUG] Error looking up existing position:`, positionLookupError);
        return false;
      }

      if (existingPosition) {
        console.log(`📊 [DEBUG] Found existing position:`, {
          positionId: existingPosition.position_id,
          currentQuantity: existingPosition.quantity,
          currentPrice: existingPosition.entry_price,
          isLong: existingPosition.is_long
        });

        // Update existing position
        return await this.updateExistingPosition(existingPosition, isLong, quantity, price, orderEvent);
      } else {
        console.log(`📊 [DEBUG] No existing position found, creating new position`);

        // Create new position
        return await this.createNewPosition(orderEvent, marketId, isLong, quantity, price);
      }

    } catch (error) {
      console.error(`❌ Failed to update position: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Create a new position
   */
  private async createNewPosition(
    orderEvent: ProcessedOrderEvent,
    marketId: string,
    isLong: boolean,
    quantity: number,
    price: number
  ): Promise<boolean> {
    try {
      // Generate a unique position ID (could be based on order ID or timestamp)
      const positionId = parseInt(orderEvent.orderId); // Use order ID as position ID for simplicity
      
      // Calculate collateral (for now, assume 1:1 with quantity * price)
      // In a real system, this would depend on leverage and margin requirements
      const rawCollateral = quantity * price;
      
      // Ensure minimum collateral to satisfy database constraints
      // The database requires collateral > 0, so ensure meaningful minimum
      const collateral = Math.max(rawCollateral, 0.01); // Minimum 0.01 collateral
      
      console.log(`💰 [DEBUG] Collateral calculation:`, {
        quantity,
        price,
        rawCollateral,
        finalCollateral: collateral,
        adjustedForMinimum: rawCollateral < 0.01
      });

      const positionData = {
        position_id: positionId,
        market_id: marketId,
        trader_wallet_address: orderEvent.trader,
        is_long: isLong,
        quantity: quantity,
        entry_price: price,
        collateral: collateral,
        is_settled: false,
        creation_transaction_hash: orderEvent.txHash,
        creation_block_number: orderEvent.blockNumber,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      console.log(`💾 [DEBUG] Creating new position:`, {
        positionId,
        trader: orderEvent.trader,
        isLong,
        quantity,
        entryPrice: price,
        collateral
      });

      const { error } = await this.supabase
        .from('market_positions')
        .insert(positionData);

      if (error) {
        console.error(`❌ Failed to create new position: ${error.message}`);
        return false;
      }

      console.log(`✅ Successfully created new position ${positionId}`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to create new position: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Update existing position (consolidate with new trade)
   */
  private async updateExistingPosition(
    existingPosition: any,
    newIsLong: boolean,
    newQuantity: number,
    newPrice: number,
    orderEvent: ProcessedOrderEvent
  ): Promise<boolean> {
    try {
      const existingIsLong = existingPosition.is_long;
      const existingQuantity = parseFloat(existingPosition.quantity);
      const existingPrice = parseFloat(existingPosition.entry_price);

      console.log(`🔄 [DEBUG] Updating existing position:`, {
        existing: { isLong: existingIsLong, quantity: existingQuantity, price: existingPrice },
        new: { isLong: newIsLong, quantity: newQuantity, price: newPrice }
      });

      if (existingIsLong === newIsLong) {
        // Same direction - add to position (average price)
        const totalQuantity = existingQuantity + newQuantity;
        const weightedPrice = (existingQuantity * existingPrice + newQuantity * newPrice) / totalQuantity;
        const rawNewCollateral = totalQuantity * weightedPrice;
        const newCollateral = Math.max(rawNewCollateral, 0.01); // Ensure minimum collateral

        console.log(`📈 [DEBUG] Adding to position:`, {
          newQuantity: totalQuantity,
          newAveragePrice: weightedPrice,
          newCollateral
        });

        const { error } = await this.supabase
          .from('market_positions')
          .update({
            quantity: totalQuantity,
            entry_price: weightedPrice,
            collateral: newCollateral,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingPosition.id);

        if (error) {
          console.error(`❌ Failed to update position: ${error.message}`);
          return false;
        }

        console.log(`✅ Successfully updated position ${existingPosition.position_id}`);
        return true;

      } else {
        // Opposite direction - reduce position or flip
        if (newQuantity < existingQuantity) {
          // Partial close
          const remainingQuantity = existingQuantity - newQuantity;
          const rawNewCollateral = remainingQuantity * existingPrice;
          const newCollateral = Math.max(rawNewCollateral, 0.01); // Ensure minimum collateral

          console.log(`📉 [DEBUG] Reducing position:`, {
            originalQuantity: existingQuantity,
            reduceBy: newQuantity,
            remainingQuantity,
            newCollateral
          });

          const { error } = await this.supabase
            .from('market_positions')
            .update({
              quantity: remainingQuantity,
              collateral: newCollateral,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingPosition.id);

          if (error) {
            console.error(`❌ Failed to reduce position: ${error.message}`);
            return false;
          }

          console.log(`✅ Successfully reduced position ${existingPosition.position_id}`);
          return true;

        } else if (newQuantity === existingQuantity) {
          // Full close - settle position
          console.log(`🏁 [DEBUG] Closing position completely`);

          const pnl = existingIsLong 
            ? (newPrice - existingPrice) * existingQuantity
            : (existingPrice - newPrice) * existingQuantity;

          const { error } = await this.supabase
            .from('market_positions')
            .update({
              is_settled: true,
              settlement_pnl: pnl,
              settlement_payout: existingPosition.collateral + pnl,
              settlement_transaction_hash: orderEvent.txHash,
              settlement_block_number: orderEvent.blockNumber,
              settled_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', existingPosition.id);

          if (error) {
            console.error(`❌ Failed to settle position: ${error.message}`);
            return false;
          }

          console.log(`✅ Successfully settled position ${existingPosition.position_id} with PnL: ${pnl}`);
          return true;

        } else {
          // Flip position (close existing and create new opposite position)
          const excessQuantity = newQuantity - existingQuantity;
          
          console.log(`🔄 [DEBUG] Flipping position:`, {
            closeQuantity: existingQuantity,
            newPositionQuantity: excessQuantity,
            newDirection: newIsLong ? 'LONG' : 'SHORT'
          });

          // First, settle the existing position
          const pnl = existingIsLong 
            ? (newPrice - existingPrice) * existingQuantity
            : (existingPrice - newPrice) * existingQuantity;

          const { error: settleError } = await this.supabase
            .from('market_positions')
            .update({
              is_settled: true,
              settlement_pnl: pnl,
              settlement_payout: existingPosition.collateral + pnl,
              settlement_transaction_hash: orderEvent.txHash,
              settlement_block_number: orderEvent.blockNumber,
              settled_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', existingPosition.id);

          if (settleError) {
            console.error(`❌ Failed to settle position during flip: ${settleError.message}`);
            return false;
          }

          // Then create new position with excess quantity
          return await this.createNewPosition(orderEvent, existingPosition.market_id, newIsLong, excessQuantity, newPrice);
        }
      }

    } catch (error) {
      console.error(`❌ Failed to update existing position: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Update order status (cancelled, filled, etc.)
   */
  private async updateOrderStatus(orderId: string, status: string): Promise<boolean> {
    try {
      // For cancelled orders, use the comprehensive cancellation handler
      if (status.toLowerCase() === 'cancelled') {
        return await this.updateOrderCancellation(orderId);
      }

      // For other status updates, use simple status update
      const { error } = await this.supabase
        .from('orders')
        .update({ 
          status: status,
          updated_at: new Date().toISOString()
        })
        .eq('order_id', orderId);

      if (error) {
        console.error(`❌ Failed to update order status: ${error.message}`);
        return false;
      }

      console.log(`✅ Updated order ${orderId} status to ${status}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to update order status: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Handle order cancellation with proper margin release and unit availability
   */
  private async updateOrderCancellation(orderId: string): Promise<boolean> {
    try {
      console.log(`🔄 [CANCELLATION] Processing order cancellation for order: ${orderId}`);

      // First, get the current order details
      const { data: order, error: orderLookupError } = await this.supabase
        .from('orders')
        .select('*')
        .eq('order_id', orderId)
        .single();

      if (orderLookupError) {
        console.error(`❌ [CANCELLATION] Failed to lookup order ${orderId}:`, orderLookupError);
        return false;
      }

      if (!order) {
        console.error(`❌ [CANCELLATION] Order ${orderId} not found`);
        return false;
      }

      console.log(`📋 [CANCELLATION] Found order:`, {
        orderId: order.order_id,
        status: order.status,
        size: order.size,
        filled: order.filled,
        marginReserved: order.margin_reserved,
        userAddress: order.user_address
      });

      // Check if order is already cancelled or filled
      if (order.status === 'CANCELLED') {
        console.log(`⚠️ [CANCELLATION] Order ${orderId} is already cancelled`);
        return true;
      }

      if (order.status === 'FILLED') {
        console.log(`⚠️ [CANCELLATION] Cannot cancel filled order ${orderId}`);
        return false;
      }

      // Calculate the remaining (unfilled) quantity that will be released
      const totalSize = parseFloat(order.size || '0');
      const filledSize = parseFloat(order.filled || '0');
      const remainingSize = totalSize - filledSize;
      const marginToRelease = parseFloat(order.margin_reserved || '0');

      console.log(`📊 [CANCELLATION] Order quantities:`, {
        totalSize,
        filledSize,
        remainingSize,
        marginToRelease
      });

      // Update the order status to CANCELLED
      const { error: updateError } = await this.supabase
        .from('orders')
        .update({
          status: 'CANCELLED',
          updated_at: new Date().toISOString(),
          // Keep the filled amount as-is, but mark the remaining as cancelled
          margin_reserved: 0 // Release all reserved margin
        })
        .eq('order_id', orderId);

      if (updateError) {
        console.error(`❌ [CANCELLATION] Failed to update order status:`, updateError);
        return false;
      }

      console.log(`✅ [CANCELLATION] Successfully cancelled order ${orderId}`);
      console.log(`💰 [CANCELLATION] Released ${remainingSize} units and ${marginToRelease} margin`);

      // Update user portfolio to release margin
      if (marginToRelease > 0) {
        await this.releaseUserMargin(order.user_address, marginToRelease);
      }

      return true;

    } catch (error) {
      console.error(`❌ [CANCELLATION] Failed to process order cancellation: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Release margin from user portfolio when order is cancelled
   */
  private async releaseUserMargin(userAddress: string, marginAmount: number): Promise<boolean> {
    try {
      console.log(`💰 [MARGIN] Releasing ${marginAmount} margin for user: ${userAddress}`);

      // Get current user portfolio
      const { data: portfolio, error: portfolioError } = await this.supabase
        .from('user_portfolios')
        .select('*')
        .eq('user_address', userAddress)
        .single();

      if (portfolioError && portfolioError.code !== 'PGRST116') {
        console.error(`❌ [MARGIN] Error fetching user portfolio:`, portfolioError);
        return false;
      }

      if (!portfolio) {
        console.log(`⚠️ [MARGIN] No portfolio found for user ${userAddress}, creating one`);
        
        // Create portfolio if it doesn't exist
        const { error: createError } = await this.supabase
          .from('user_portfolios')
          .insert({
            user_address: userAddress,
            total_collateral: 0,
            margin_used: 0,
            margin_reserved: 0,
            realized_pnl: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (createError) {
          console.error(`❌ [MARGIN] Failed to create user portfolio:`, createError);
          return false;
        }

        console.log(`✅ [MARGIN] Created portfolio for user ${userAddress}`);
        return true; // No margin to release if portfolio was just created
      }

      // Update portfolio to release margin
      const currentMarginReserved = parseFloat(portfolio.margin_reserved || '0');
      const newMarginReserved = Math.max(0, currentMarginReserved - marginAmount);

      console.log(`💰 [MARGIN] Margin update:`, {
        currentReserved: currentMarginReserved,
        releasing: marginAmount,
        newReserved: newMarginReserved
      });

      const { error: updateError } = await this.supabase
        .from('user_portfolios')
        .update({
          margin_reserved: newMarginReserved,
          updated_at: new Date().toISOString()
        })
        .eq('user_address', userAddress);

      if (updateError) {
        console.error(`❌ [MARGIN] Failed to update user portfolio:`, updateError);
        return false;
      }

      console.log(`✅ [MARGIN] Successfully released ${marginAmount} margin for user ${userAddress}`);
      return true;

    } catch (error) {
      console.error(`❌ [MARGIN] Failed to release margin: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Update order execution data and handle position tracking
   */
  private async updateOrderExecution(orderEvent: ProcessedOrderEvent): Promise<boolean> {
    try {
      const filledQuantity = Math.max(parseFloat(ethers.formatEther(orderEvent.quantity)), 1e-8);
      const avgPrice = Math.max(parseFloat(ethers.formatEther(orderEvent.price)), 1e-8);
      
      console.log(`📊 [DEBUG] Updating order execution:`, {
        orderId: orderEvent.orderId,
        filledQuantity,
        avgPrice,
        eventType: orderEvent.eventType
      });

      // First, get the order's market_id for position tracking
      const { data: orderData, error: orderLookupError } = await this.supabase
        .from('market_orders')
        .select('market_id')
        .eq('order_id', orderEvent.orderId)
        .single();

      if (orderLookupError) {
        console.error(`❌ Failed to lookup order for execution: ${orderLookupError.message}`);
        return false;
      }

      // Update the order
      const { error } = await this.supabase
        .from('market_orders')
        .update({
          filled_quantity: filledQuantity,
          price: avgPrice, // Update price field
          order_status: 'FILLED',
          updated_at: new Date().toISOString()
        })
        .eq('order_id', orderEvent.orderId);

      if (error) {
        console.error(`❌ Failed to update order execution: ${error.message}`);
        return false;
      }

      console.log(`✅ Updated order ${orderEvent.orderId} execution data`);

      // Update position for the executed order
      if (orderData?.market_id) {
        console.log(`📊 [DEBUG] Order executed, updating position...`);
        await this.updatePosition(orderEvent, orderData.market_id, filledQuantity, avgPrice);
      }

      return true;
    } catch (error) {
      console.error(`❌ Failed to update order execution: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Helper: Normalize contract address for consistent database lookups
   */
  private normalizeContractAddress(address: string): string {
    if (!address) return '';
    // Ensure address is lowercase for consistent database lookups
    // First validate it's a proper address, then convert to lowercase
    try {
      return ethers.getAddress(address).toLowerCase();
    } catch (error) {
      console.warn(`⚠️ [DEBUG] Invalid address format: ${address}`);
      return address.toLowerCase();
    }
  }

  /**
   * Helper: Get metric ID from hash (simplified mapping)
   */
  private getMetricIdFromHash(hash: string): string {
    console.log(`🔍 [DEBUG] getMetricIdFromHash called with:`, {
      hash,
      hashType: typeof hash,
      hashLength: hash?.length,
      isValidHex: hash?.startsWith('0x')
    });

    // In a real implementation, you'd maintain a mapping of hashes to metric IDs
    // For now, return a default
    const knownHashes: { [key: string]: string } = {
      '0x864a895aed81431ba14df14feec24e3ac90a6dcb724fedd473ddfd2042c765d6': 'SILVER_V1'
    };
    
    console.log(`🔍 [DEBUG] Known hashes available:`, Object.keys(knownHashes));
    
    const result = knownHashes[hash] || `HASH_${hash.slice(0, 8)}`;
    console.log(`🔍 [DEBUG] getMetricIdFromHash result: "${result}"`);
    
    // If no known mapping found, log a warning and try to debug
    if (!knownHashes[hash]) {
      console.warn(`⚠️ [DEBUG] Unknown hash encountered: ${hash}`);
      console.warn(`⚠️ [DEBUG] Consider adding this hash to the knownHashes mapping`);
      
      // Try to reverse lookup this hash against known markets
      this.debugMetricIdHash(hash).catch(err => 
        console.error(`❌ [DEBUG] Error in debugMetricIdHash:`, err)
      );
    }
    
    return result;
  }

  /**
   * Helper: Convert order type number to string
   */
  private getOrderTypeString(orderType: number): string {
    const types = ['MARKET', 'LIMIT', 'STOP', 'LIMIT', 'STOP', 'LIMIT', 'MARKET', 'MARKET', 'LIMIT'];
    return types[orderType] || 'LIMIT'; // Default to LIMIT if unknown
  }

  /**
   * Debug helper: Try to reverse lookup metricId hash against known markets
   */
  private async debugMetricIdHash(hash: string): Promise<void> {
    try {
      console.log(`🔍 [DEBUG] Attempting to reverse lookup hash: ${hash}`);
      
      // Fetch all markets to see if we can find a pattern
      const { data: markets, error } = await this.supabase
        .from('orderbook_markets')
        .select('metric_id')
        .limit(50);
      
      if (error) {
        console.error(`❌ [DEBUG] Error fetching markets for hash debugging:`, error);
        return;
      }
      
      console.log(`🔍 [DEBUG] Available metricIds in database:`, markets?.map(m => m.metric_id));
      
      // Try to compute keccak256 of each metricId to see if it matches our hash
      for (const market of markets || []) {
        if (market.metric_id) {
          try {
            const computedHash = ethers.keccak256(ethers.toUtf8Bytes(market.metric_id));
            console.log(`🔍 [DEBUG] metricId "${market.metric_id}" → hash "${computedHash}"`);
            
            if (computedHash.toLowerCase() === hash.toLowerCase()) {
              console.log(`✅ [DEBUG] MATCH FOUND! Hash ${hash} corresponds to metricId: ${market.metric_id}`);
              console.warn(`💡 [DEBUG] Consider adding this mapping to knownHashes: '${hash}': '${market.metric_id}'`);
            }
          } catch (err) {
            console.log(`🔍 [DEBUG] Error computing hash for ${market.metric_id}:`, err);
          }
        }
      }
    } catch (error) {
      console.error(`❌ [DEBUG] Error in debugMetricIdHash:`, error);
    }
  }

  /**
   * Helper: Map internal event types to Pusher action types
   */
  private mapEventTypeToAction(eventType: 'placed' | 'cancelled' | 'executed' | 'added' | 'matched'): 'open' | 'close' | 'liquidate' {
    switch (eventType) {
      case 'placed':
      case 'added':
        return 'open';
      case 'executed':
      case 'matched':
      case 'cancelled':
        return 'close';
      default:
        return 'open'; // Default fallback
    }
  }

  /**
   * 🚀 Real-time broadcast order cancellation to connected clients
   */
  private async broadcastOrderCancellation(orderEvent: ProcessedOrderEvent): Promise<void> {
    try {
      console.log(`📡 [CANCELLATION] Broadcasting order cancellation for ${orderEvent.orderId}`);
      
      // Get market details to resolve metricId for broadcasting
      let metricId = orderEvent.metricId;
      
      // If we don't have metricId, try to resolve it
      if (!metricId || metricId === 'UNKNOWN' || metricId.startsWith('HASH_')) {
        const normalizedAddress = this.normalizeContractAddress(orderEvent.contractAddress);
        const { data: market } = await this.supabase
          .from('orderbook_markets')
          .select('metric_id')
          .eq('market_address', normalizedAddress)
          .single();
        
        if (market) {
          metricId = market.metric_id;
        }
      }
      
      // Prepare cancellation broadcast data
      const cancellationData = {
        orderId: orderEvent.orderId,
        trader: orderEvent.trader,
        metricId: metricId,
        eventType: 'cancelled',
        timestamp: Date.now(),
        txHash: orderEvent.txHash,
        blockNumber: orderEvent.blockNumber,
        action: 'order_cancelled'
      };

      console.log(`📡 [CANCELLATION] Broadcast data:`, cancellationData);

      // Broadcast to multiple channels for comprehensive coverage
      
      // 1. Market-specific channel for this token symbol
      if (metricId && metricId !== 'UNKNOWN') {
        await this.pusherService['pusher'].trigger(`market-${metricId}`, 'order-cancelled', cancellationData);
        console.log(`📡 [CANCELLATION] Sent to market-${metricId} channel`);
      }

      // 2. Global recent transactions channel
      await this.pusherService['pusher'].trigger('recent-transactions', 'order-cancelled', cancellationData);
      console.log(`📡 [CANCELLATION] Sent to recent-transactions channel`);

      // 3. User-specific channel for authenticated updates
      await this.pusherService['pusher'].trigger(`user-${orderEvent.trader}`, 'order-cancelled', cancellationData);
      console.log(`📡 [CANCELLATION] Sent to user-${orderEvent.trader} channel`);

      console.log(`✅ [CANCELLATION] Successfully broadcasted order cancellation for ${orderEvent.orderId}`);

    } catch (error) {
      console.error(`❌ [CANCELLATION] Failed to broadcast order cancellation:`, error);
      // Don't throw error as this is a non-critical enhancement
    }
  }

  /**
   * 🔄 Process market order unit decrementing via edge function
   */
  private async processMarketOrderUnitDecrement(orderData: {
    orderId: string;
    marketId: string;
    side: string;
    size: number;
    orderType: string;
  }): Promise<void> {
    try {
      console.log(`🔄 [MARKET_ORDER] Processing unit decrement for order ${orderData.orderId}`);
      
      // Call the market-order-processor edge function
      const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/market-order-processor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          action: 'process',
          orderData: {
            orderId: orderData.orderId,
            marketId: orderData.marketId,
            side: orderData.side,
            size: orderData.size.toString(),
            orderType: orderData.orderType
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json() as any;
      
      if (result.success) {
        console.log(`✅ [MARKET_ORDER] Unit decrement completed:`, {
          orderId: orderData.orderId,
          unitsMatched: result.execution?.unitsMatched,
          averagePrice: result.execution?.averagePrice,
          priceImpact: result.execution?.priceImpact
        });
        
        // Log order book impact for monitoring
        if (result.orderBook) {
          console.log(`📊 [ORDER_BOOK] Updated availability:`, {
            marketId: orderData.marketId,
            bestBidBefore: result.orderBook.before?.bestBid,
            bestAskBefore: result.orderBook.before?.bestAsk,
            bestBidAfter: result.orderBook.after?.bestBid,
            bestAskAfter: result.orderBook.after?.bestAsk,
            totalBidsAfter: result.orderBook.after?.totalBidVolume,
            totalAsksAfter: result.orderBook.after?.totalAskVolume
          });
        }
      } else {
        console.error(`❌ [MARKET_ORDER] Unit decrement failed:`, result.error);
      }

    } catch (error) {
      console.error(`❌ [MARKET_ORDER] Error processing unit decrement:`, error);
      // Don't throw - this is a supplementary process that shouldn't break the main workflow
    }
  }

  /**
   * 🚀 Real-time broadcast order update to connected clients
   */
  private async broadcastOrderUpdate(orderEvent: ProcessedOrderEvent): Promise<void> {
    try {
      console.log(`📡 [BROADCAST] Broadcasting order update for ${orderEvent.orderId}`);
      
      // Get market details to resolve metricId for broadcasting
      let metricId = orderEvent.metricId;
      
      // If we don't have metricId, try to resolve it
      if (!metricId || metricId === 'UNKNOWN' || metricId.startsWith('HASH_')) {
        const normalizedAddress = this.normalizeContractAddress(orderEvent.contractAddress);
        const { data: market } = await this.supabase
          .from('orderbook_markets')
          .select('metric_id')
          .eq('market_address', normalizedAddress)
          .single();
        
        if (market) {
          metricId = market.metric_id;
        }
      }
      
      // Prepare broadcast data
      const broadcastData = {
        orderId: orderEvent.orderId,
        trader: orderEvent.trader,
        metricId: metricId,
        orderType: orderEvent.orderType === 0 ? 'MARKET' : 'LIMIT',
        side: orderEvent.side === 0 ? 'BUY' : 'SELL',
        quantity: parseFloat(ethers.formatEther(orderEvent.quantity)),
        price: parseFloat(ethers.formatEther(orderEvent.price)),
        eventType: orderEvent.eventType,
        timestamp: Date.now(),
        txHash: orderEvent.txHash,
        blockNumber: orderEvent.blockNumber
      };

      console.log(`📡 [BROADCAST] Broadcast data:`, broadcastData);

      // Broadcast to multiple channels for comprehensive coverage
      
      // 1. Market-specific channel for this token symbol
      if (metricId && metricId !== 'UNKNOWN') {
        await this.pusherService['pusher'].trigger(`market-${metricId}`, 'order-update', broadcastData);
        console.log(`📡 [BROADCAST] Sent to market-${metricId} channel`);
      }

      // 2. Global recent transactions channel
      await this.pusherService['pusher'].trigger('recent-transactions', 'new-order', broadcastData);
      console.log(`📡 [BROADCAST] Sent to recent-transactions channel`);

      // 3. User-specific channel for authenticated updates
      await this.pusherService['pusher'].trigger(`user-${orderEvent.trader}`, 'order-update', broadcastData);
      console.log(`📡 [BROADCAST] Sent to user-${orderEvent.trader} channel`);

      // 4. Trading events channel
      const mappedAction = this.mapEventTypeToAction(orderEvent.eventType);
      await this.pusherService.broadcastTradingEvent({
        symbol: metricId || 'UNKNOWN',
        action: mappedAction,
        userAddress: orderEvent.trader,
        positionSize: broadcastData.quantity.toString(),
        markPrice: broadcastData.price,
        isLong: broadcastData.side === 'BUY',
        timestamp: broadcastData.timestamp
      });

      console.log(`✅ [BROADCAST] Successfully broadcasted order update for ${orderEvent.orderId}`);

    } catch (error) {
      console.error(`❌ [BROADCAST] Failed to broadcast order update:`, error);
      // Don't throw error as this is a non-critical enhancement
    }
  }
}

export default OrderBookWebhookProcessor;
