import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import { PusherServerService } from '@/lib/pusher-server';

// Order Book Event Topic Hashes (from our analysis)
export const ORDER_EVENT_TOPICS = {
  // OrderRouter events
  ORDER_PLACED: '0x5b954fa335c624976b5c2dba7c7a172770d02d8b36e6da6cfcc1b79baa62bfc8',
  ORDER_CANCELLED: '0xc4058ebc534b64ecb27b2d4eaa1904f98997ec18ebe6ada4117593dde89478cc',
  ORDER_EXECUTED: '0x1cd65e6e4f6a6bfcff65064f4e22d514f481a38dcbe4c2ad13ccde1b22e06941',
  
  // OrderBook events  
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

    // Filter for our contracts only
    const relevantLogs = logs.filter(log => {
      const address = log.account.address.toLowerCase();
      return (
        address === CONTRACT_ADDRESSES.orderRouter.toLowerCase() ||
        address.startsWith('0x07d317c87e6d8af322463acf024f1e28d38f6117') // OrderBook pattern
      );
    });

    console.log(`🔍 Found ${relevantLogs.length} relevant logs from ${logs.length} total logs`);
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

    // Process OrderRouter events
    if (contractAddress === CONTRACT_ADDRESSES.orderRouter.toLowerCase()) {
      return this.processOrderRouterEvent(log, eventSignature);
    }

    // Process OrderBook events (dynamic addresses)
    if (contractAddress.startsWith('0x07d317c87e6d8af322463acf024f1e28d38f6117')) {
      return this.processOrderBookEvent(log, eventSignature);
    }

    return null;
  }

  /**
   * Process OrderRouter events (OrderPlaced, OrderCancelled, OrderExecuted)
   */
  private processOrderRouterEvent(log: AlchemyWebhookLog, eventSignature: string): ProcessedOrderEvent | null {
    try {
      const topics = log.topics;
      const data = log.data;

      switch (eventSignature) {
        case ORDER_EVENT_TOPICS.ORDER_PLACED:
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

        case ORDER_EVENT_TOPICS.ORDER_CANCELLED:
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

        case ORDER_EVENT_TOPICS.ORDER_EXECUTED:
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
   * Process OrderBook events (OrderAdded, OrderMatched)
   */
  private processOrderBookEvent(log: AlchemyWebhookLog, eventSignature: string): ProcessedOrderEvent | null {
    try {
      const topics = log.topics;
      const data = log.data;

      switch (eventSignature) {
        case ORDER_EVENT_TOPICS.ORDER_ADDED:
          // OrderAdded(uint256 indexed orderId, address indexed trader, uint8 side, uint256 quantity, uint256 price)
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
              metricId: '', // Will be derived from contract address
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

        case ORDER_EVENT_TOPICS.ORDER_MATCHED:
          // OrderMatched events can be processed for execution tracking
          console.log(`📊 OrderMatched event detected in log ${log.index}`);
          // Implementation depends on specific matching requirements
          break;
      }
    } catch (error) {
      console.error(`❌ Failed to process OrderBook event: ${(error as Error).message}`);
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

      // Strategy: Resolve metricId using contract address lookup
      let metricId = orderEvent.metricId;
      let marketId: string | null = null;
      let normalizedAddress = '';

      console.log(`🔍 [DEBUG] Initial metricId: "${metricId}" (type: ${typeof metricId})`);
      console.log(`🔍 [DEBUG] Contract address: "${orderEvent.contractAddress}"`);

      // PRIMARY STRATEGY: Lookup by contract address
      if (orderEvent.contractAddress) {
        normalizedAddress = this.normalizeContractAddress(orderEvent.contractAddress);
        console.log(`🔍 [DEBUG] Attempting contract address lookup for: ${orderEvent.contractAddress} (normalized: ${normalizedAddress})`);
        
        // First try exact match with normalized (lowercase) address
        let { data: market, error: contractLookupError } = await this.supabase
          .from('orderbook_markets')
          .select('id, metric_id, market_status, market_address')
          .eq('market_address', normalizedAddress)
          .single();

        // If not found, try case-insensitive lookup
        if (contractLookupError?.code === 'PGRST116') {
          console.log(`🔍 [DEBUG] Exact match failed, trying case-insensitive lookup...`);
          const { data: marketCaseInsensitive, error: caseInsensitiveError } = await this.supabase
            .from('orderbook_markets')
            .select('id, metric_id, market_status, market_address')
            .ilike('market_address', normalizedAddress)
            .single();
          
          if (!caseInsensitiveError && marketCaseInsensitive) {
            market = marketCaseInsensitive;
            contractLookupError = null;
            console.log(`✅ [DEBUG] Found market using case-insensitive lookup!`);
          } else {
            contractLookupError = caseInsensitiveError;
          }
        }

        if (contractLookupError) {
          console.error(`❌ [DEBUG] Error in contract address lookup:`, contractLookupError);
        }

        if (market) {
          metricId = market.metric_id;
          marketId = market.id;
          console.log(`✅ [DEBUG] Found market via contract address! metricId: "${metricId}", marketId: "${marketId}"`);
        } else {
          console.warn(`⚠️ [DEBUG] No market found for contract address: ${orderEvent.contractAddress}`);
          
          // Debug: Show available contract addresses
          const { data: allMarkets } = await this.supabase
            .from('orderbook_markets')
            .select('market_address, metric_id')
            .not('market_address', 'is', null)
            .limit(10);
          
          console.log(`🔍 [DEBUG] Available contract addresses in database:`, 
            allMarkets?.map(m => ({ 
              address: m.market_address, 
              metricId: m.metric_id,
              normalizedAddress: m.market_address ? this.normalizeContractAddress(m.market_address) : null,
              matchesWebhook: m.market_address ? this.normalizeContractAddress(m.market_address) === normalizedAddress : false
            }))
          );
        }
      }

      // FALLBACK STRATEGY 1: For non-placed events, lookup metricId from existing order
      if (!metricId && orderEvent.orderId) {
        console.log(`🔍 [DEBUG] Fallback: Attempting to lookup metricId from existing order ${orderEvent.orderId}`);
        const { data: existingOrder, error: lookupError } = await this.supabase
          .from('market_orders')
          .select(`
            market_id,
            orderbook_markets!inner(
              metric_id
            )
          `)
          .eq('order_id', orderEvent.orderId)
          .single();
        
        if (lookupError) {
          console.error(`❌ [DEBUG] Error looking up existing order:`, lookupError);
        }
        
        if (existingOrder && (existingOrder as any).orderbook_markets) {
          metricId = (existingOrder as any).orderbook_markets.metric_id;
          marketId = existingOrder.market_id;
          console.log(`✅ [DEBUG] Found metricId from existing order: "${metricId}"`);
        } else {
          console.warn(`⚠️ [DEBUG] No existing order found for orderId: ${orderEvent.orderId}`);
        }
      }

      // FALLBACK STRATEGY 2: Hash-based lookup (for OrderRouter events)
      if (!metricId && orderEvent.metricId) {
        console.log(`🔍 [DEBUG] Fallback: Using hash-based metricId: "${orderEvent.metricId}"`);
        metricId = orderEvent.metricId;
      }

      // FALLBACK STRATEGY 3: Use UNKNOWN for placed events
      if (!metricId && orderEvent.eventType === 'placed') {
        console.warn(`⚠️ [DEBUG] All strategies failed, using UNKNOWN for placed order`);
        metricId = 'UNKNOWN';
      }

      console.log(`🔍 [DEBUG] Final metricId for market lookup: "${metricId}" (type: ${typeof metricId})`);

      // If we don't have marketId yet, get it from metricId
      if (!marketId && metricId) {
        console.log(`🔍 [DEBUG] Querying orderbook_markets table for metricId: "${metricId}"`);
        const { data: market, error: marketError } = await this.supabase
        .from('orderbook_markets')
          .select('id, metric_id, market_status')
        .eq('metric_id', metricId)
        .single();

        if (marketError) {
          console.error(`❌ [DEBUG] Error querying orderbook_markets:`, marketError);
        }

        console.log(`🔍 [DEBUG] Market query result:`, market);

        if (market) {
          marketId = market.id;
          console.log(`✅ [DEBUG] Found marketId via metricId lookup: "${marketId}"`);
        }
      }

      // Final validation
      if (!marketId) {
        console.error(`❌ [DEBUG] No market found for metricId: "${metricId}" or contract: "${orderEvent.contractAddress}"`);
        
        // Additional debugging: Let's see what markets exist
        console.log(`🔍 [DEBUG] Fetching all available markets for debugging...`);
        const { data: allMarkets, error: allMarketsError } = await this.supabase
          .from('orderbook_markets')
          .select('id, metric_id, market_status, market_address')
          .limit(20);
        
        if (allMarketsError) {
          console.error(`❌ [DEBUG] Error fetching all markets:`, allMarketsError);
        } else {
          console.log(`🔍 [DEBUG] Available markets (first 20):`, allMarkets?.map(m => ({
            id: m.id,
            metric_id: m.metric_id,
            market_status: m.market_status,
            market_address: m.market_address
          })));
          
          // Try to find similar metricIds or contract addresses
          const similarMarkets = allMarkets?.filter(m => {
            const metricMatch = m.metric_id && metricId && (
              m.metric_id.toLowerCase().includes(metricId.toLowerCase()) ||
              metricId.toLowerCase().includes(m.metric_id.toLowerCase())
            );
            const contractMatch = m.market_address && orderEvent.contractAddress && 
              m.market_address.toLowerCase() === this.normalizeContractAddress(orderEvent.contractAddress);
            return metricMatch || contractMatch;
          });
          
          if (similarMarkets && similarMarkets.length > 0) {
            console.log(`🔍 [DEBUG] Similar markets found:`, similarMarkets);
          } else {
            console.log(`🔍 [DEBUG] No similar markets found for metricId: "${metricId}" or contract: "${orderEvent.contractAddress}"`);
          }
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
          return await this.updateOrderStatus(orderEvent.orderId, 'cancelled');
        
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
   * Save new order to Supabase
   */
  private async saveNewOrder(orderEvent: ProcessedOrderEvent, marketId: string): Promise<boolean> {
    try {
      // Convert order data to Supabase format
      // Use precise decimal handling for very small quantities
      const quantityInEther = ethers.formatEther(orderEvent.quantity);
      const priceInEther = ethers.formatEther(orderEvent.price);
      
      console.log(`🔢 [DEBUG] Wei to Ether conversion:`, {
        rawQuantityWei: orderEvent.quantity,
        rawPriceWei: orderEvent.price,
        quantityInEther,
        priceInEther,
        quantityAsFloat: parseFloat(quantityInEther),
        priceAsFloat: parseFloat(priceInEther)
      });
      
      // For very small values, consider if this is the correct conversion
      // The minimum precision might need adjustment based on your token decimals
      const quantity = Math.max(parseFloat(quantityInEther), 1e-8);
      const price = Math.max(parseFloat(priceInEther), 1e-8);
      
      // Warn if quantities are suspiciously small
      if (quantity < 1e-6) {
        console.warn(`⚠️ [DEBUG] Very small quantity detected: ${quantity}. Consider checking token decimals or conversion logic.`);
      }
      
      // Determine order type and status based on event type
      let orderType: string;
      let orderStatus: string;
      
      if (orderEvent.eventType === 'added') {
        // 'added' events represent market orders that are immediately executed
        orderType = 'MARKET';
        orderStatus = 'FILLED'; // Market orders are immediately filled
        console.log(`📊 [DEBUG] Processing market order (added event)`);
      } else {
        // 'placed' events represent limit orders waiting in the book
        orderType = this.getOrderTypeString(orderEvent.orderType);
        orderStatus = 'PENDING'; // Limit orders start as pending
        console.log(`📊 [DEBUG] Processing limit order (placed event)`);
      }
      
      const orderData = {
        order_id: orderEvent.orderId,
        market_id: marketId,
        trader_wallet_address: orderEvent.trader,
        side: orderEvent.side === 0 ? 'BUY' : 'SELL', // Use uppercase to match schema
        quantity: quantity,
        price: price,
        order_type: orderType,
        order_status: orderStatus,
        filled_quantity: orderEvent.eventType === 'added' ? quantity : 0, // Market orders are fully filled
        created_at: new Date().toISOString(),
        creation_transaction_hash: orderEvent.txHash,
        creation_block_number: orderEvent.blockNumber
        // Note: log_index not included as it doesn't exist in the schema
      };

      console.log(`💾 [DEBUG] Order data to insert:`, {
        orderId: orderData.order_id,
        marketId: orderData.market_id,
        type: orderData.order_type,
        status: orderData.order_status,
        side: orderData.side,
        quantity: orderData.quantity,
        price: orderData.price,
        filledQuantity: orderData.filled_quantity,
        createdAt: orderData.created_at
      });

      console.log(`🔍 [DEBUG] Raw order event data:`, {
        rawQuantity: orderEvent.quantity,
        rawPrice: orderEvent.price,
        quantityInEther: quantityInEther,
        priceInEther: priceInEther,
        finalQuantity: quantity,
        finalPrice: price
      });

      // 🚨 Use upsert on order_hash to avoid duplicate key violations and reuse UUID
      const computedOrderHash = '0x' + ethers.keccak256(ethers.toUtf8Bytes(`${orderEvent.orderId}_${orderEvent.trader}_${orderEvent.txHash}`)).slice(2);
      const { data: upsertedRow, error } = await this.supabase
        .from('off_chain_orders')
        .upsert([
          {
            order_id: parseInt(orderEvent.orderId),
            market_id: marketId,
            trader_wallet_address: orderEvent.trader,
            order_type: orderType,
            side: orderEvent.side === 0 ? 'BUY' : 'SELL',
            quantity: quantity,
            price: price,
            order_status: orderStatus,
            time_in_force: 'GTC',
            post_only: false,
            reduce_only: false,
            order_hash: computedOrderHash,
            signature: '0x' + '0'.repeat(130),
            nonce: parseInt(orderEvent.orderId) % 1000000,
            required_collateral: quantity * (price || 1) * 0.1,
            collateral_token_address: CONTRACT_ADDRESSES.USDC,
            creation_transaction_hash: orderEvent.txHash,
            creation_block_number: orderEvent.blockNumber
          }
        ], { onConflict: ['order_hash'] })
        .select('id')
        .single();

      if (error) {
        console.error(`❌ Supabase upsert error: ${error.message}`);
        return false;
      }

      console.log(`✅ Successfully saved order ${orderEvent.orderId} to Supabase (UUID: ${upsertedRow?.id})`);
      
      // For executed orders (market orders or filled limit orders), update positions
      if (orderStatus === 'FILLED' || orderEvent.eventType === 'added') {
        console.log(`📊 [DEBUG] Order is filled, updating position...`);
        await this.updatePosition(orderEvent, marketId, quantity, price);
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
      const { error } = await this.supabase
        .from('market_orders')
        .update({ 
          order_status: status,
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
    const types = ['market', 'limit', 'stop_loss', 'take_profit', 'stop_limit', 'iceberg', 'fill_or_kill', 'immediate_or_cancel', 'all_or_none'];
    return types[orderType] || 'unknown';
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
        await this.pusherService.pusher.trigger(`market-${metricId}`, 'order-update', broadcastData);
        console.log(`📡 [BROADCAST] Sent to market-${metricId} channel`);
      }

      // 2. Global recent transactions channel
      await this.pusherService.pusher.trigger('recent-transactions', 'new-order', broadcastData);
      console.log(`📡 [BROADCAST] Sent to recent-transactions channel`);

      // 3. User-specific channel for authenticated updates
      await this.pusherService.pusher.trigger(`user-${orderEvent.trader}`, 'order-update', broadcastData);
      console.log(`📡 [BROADCAST] Sent to user-${orderEvent.trader} channel`);

      // 4. Trading events channel
      await this.pusherService.broadcastTradingEvent({
        symbol: metricId || 'UNKNOWN',
        action: orderEvent.eventType,
        userAddress: orderEvent.trader,
        orderType: broadcastData.orderType,
        side: broadcastData.side,
        quantity: broadcastData.quantity,
        price: broadcastData.price,
        timestamp: broadcastData.timestamp,
        txHash: orderEvent.txHash,
        blockNumber: orderEvent.blockNumber
      });

      console.log(`✅ [BROADCAST] Successfully broadcasted order update for ${orderEvent.orderId}`);

    } catch (error) {
      console.error(`❌ [BROADCAST] Failed to broadcast order update:`, error);
      // Don't throw error as this is a non-critical enhancement
    }
  }
}

export default OrderBookWebhookProcessor;
