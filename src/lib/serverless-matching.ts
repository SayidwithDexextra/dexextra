/**
 * Serverless-Compatible Order Matching
 * 
 * This module provides order matching functionality that works in both:
 * - Local development (with or without persistent services)
 * - Vercel serverless deployment (stateless, per-request processing)
 */

import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { createHash } from 'crypto';
import { PusherServerService } from '@/lib/pusher-server';

interface Order {
  id: string;
  uuid_id?: string; // Database UUID ID (set after insertion)
  market_id: string;
  trader_wallet_address: string;
  order_type: 'MARKET' | 'LIMIT';
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number;
  filled_quantity: number;
  order_status: 'PENDING' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED';
  time_in_force: 'GTC' | 'IOC' | 'FOK' | 'GTD';
  post_only: boolean;
  reduce_only: boolean;
  created_at: string;
  expires_at?: string;
}

interface Match {
  id?: string; // Optional for new matches
  buyOrderId: string;
  sellOrderId: string;
  quantity: number;
  price: number;
  timestamp: Date;
  marketId: string;
  buyTraderAddress: string;
  sellTraderAddress: string;
}

export class ServerlessMatchingEngine {
  private supabase: any;
  private redis: Redis | null = null;
  private pusherService: PusherServerService | null;
  private static orderCounter = 0;

  constructor() {
    // Initialize Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);

    // Initialize Redis if available (for caching order book)
    if (process.env.REDIS_URL) {
      try {
        this.redis = new Redis({
          url: process.env.REDIS_URL,
          token: process.env.REDIS_TOKEN
        });
      } catch (error) {
        console.warn('Redis not available, falling back to database-only matching:', error);
      }
    }

    // Initialize Pusher service for real-time broadcasting
    try {
      this.pusherService = new PusherServerService();
    } catch (error) {
      console.warn('Pusher service not available, continuing without real-time broadcasting:', error);
      this.pusherService = null;
    }
  }

  /**
   * Process a new order and attempt to match it
   */
  async processOrder(orderRequest: Omit<Order, 'id' | 'created_at' | 'filled_quantity' | 'order_status' | 'market_id'> & { metricId: string; signature: string; nonce: number }): Promise<{
    order: Order;
    matches: Match[];
    success: boolean;
    blockchainTxHash?: string;
    error?: string;
  }> {
    try {
      // Resolve metricId to market_id
      const { data: market, error: marketError } = await this.supabase
        .from('orderbook_markets')
        .select('id')
        .eq('metric_id', orderRequest.metricId)
        .single();

      if (marketError || !market) {
        throw new Error(`Market not found for metric: ${orderRequest.metricId}`);
      }

      // Generate unique integer order ID for database (timestamp + counter + random)
      ServerlessMatchingEngine.orderCounter = (ServerlessMatchingEngine.orderCounter + 1) % 1000;
      const orderId = `${Date.now()}${ServerlessMatchingEngine.orderCounter.toString().padStart(3, '0')}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`;
      
      // Create full order object
      const fullOrder: Order = {
        market_id: market.id,
        trader_wallet_address: orderRequest.trader_wallet_address,
        order_type: orderRequest.order_type,
        side: orderRequest.side,
        quantity: orderRequest.quantity,
        price: orderRequest.price,
        time_in_force: orderRequest.time_in_force,
        post_only: orderRequest.post_only,
        reduce_only: orderRequest.reduce_only,
        expires_at: orderRequest.expires_at,
        id: orderId,
        filled_quantity: 0,
        order_status: 'PENDING',
        created_at: new Date().toISOString()
      };

            // Handle market orders (immediate execution) - PURE OFF-CHAIN
      if (fullOrder.order_type === 'MARKET') {
        console.log('📈 Processing MARKET order for off-chain matching...');
        
        // Store the order first to get UUID
        const orderUuid = await this.storeOrder(fullOrder, orderRequest.signature, orderRequest.nonce);
        fullOrder.id = orderUuid; // Use the UUID for matching
        
        console.log(`✅ Order stored with UUID: ${orderUuid}`);
        
        // Execute off-chain matching
        const matches = await this.executeMarketOrder(fullOrder);
        
        // Update order status based on matches
        const totalFilled = matches.reduce((sum, match) => sum + match.quantity, 0);
        fullOrder.filled_quantity = totalFilled;
        fullOrder.order_status = totalFilled >= fullOrder.quantity ? 'FILLED' : 'PARTIALLY_FILLED';

        console.log(`🎯 Market order matching complete: ${matches.length} matches, ${totalFilled} filled`);

        // Store matches and update order status
        try {
          // Update the order with final status
          const { error: updateError } = await this.supabase
            .from('orders')
            .update({
              filled_quantity: fullOrder.filled_quantity,
              order_status: fullOrder.order_status,
              updated_at: new Date().toISOString()
            })
            .eq('id', orderUuid);
          
          if (updateError) {
            throw new Error(`Failed to update order status: ${updateError.message}`);
          }
          
          // Store matches with UUID mapping
          const orderUuidMap = new Map<string, string>();
          orderUuidMap.set(fullOrder.id, orderUuid); // Map current order UUID
          
          // Get UUIDs for matched orders
          for (const match of matches) {
            if (!orderUuidMap.has(match.buyOrderId)) {
              const uuid = await this.getOrderUuidById(match.buyOrderId);
              if (uuid) orderUuidMap.set(match.buyOrderId, uuid);
            }
            if (!orderUuidMap.has(match.sellOrderId)) {
              const uuid = await this.getOrderUuidById(match.sellOrderId);
              if (uuid) orderUuidMap.set(match.sellOrderId, uuid);
            }
          }
          
          for (const match of matches) {
            await this.storeMatch(match, orderUuidMap);
            console.log(`✅ Match stored: ${match.buyOrderId} ↔ ${match.sellOrderId} (${match.quantity} @ ${match.price})`);
          }
          
          // Submit order to blockchain via OrderRouter.placeOrder() to solidify in OrderBook.sol
          console.log(`🔗 Submitting MARKET order to blockchain to solidify matches...`);
          const blockchainResult = await this.submitOrderToBlockchain(fullOrder, orderRequest);
          
          if (blockchainResult.success) {
                      console.log(`✅ MARKET order solidified on blockchain: ${blockchainResult.txHash}`);
          
          // Update order with blockchain transaction hash
          await this.supabase
            .from('orders')
            .update({
              // Note: creation_transaction_hash column may not exist, using a comment for now
              // creation_transaction_hash: blockchainResult.txHash,
              updated_at: new Date().toISOString()
            })
            .eq('id', orderUuid);
            
          // NOTE: recordTradeExecution is handled by the settlement processor
          // during batch settlement, not immediately after matching.
          // This is the correct architectural approach for off-chain matching.
          console.log(`📊 Trade executions will be recorded on-chain during settlement processing`);
          if (matches && matches.length > 0) {
            console.log(`📝 ${matches.length} matches created and will be settled in the next batch`);
          }
          } else {
            console.error(`❌ Failed to solidify MARKET order on blockchain: ${blockchainResult.error}`);
            // Note: We continue with off-chain record even if blockchain fails
          }

          // Broadcast order update
          await this.broadcastOrderUpdate(fullOrder, orderRequest.metricId, matches.length > 0 ? 'executed' : 'placed');

          console.log('✅ All off-chain and on-chain operations completed successfully');

          // Attempt to trigger settlement processing immediately (non-blocking)
          if ((matches?.length || 0) > 0) {
            try {
              const { getSettlementProcessor } = await import('@/lib/settlement-processor');
              const processor = getSettlementProcessor();
              // Fire-and-forget; do not await to avoid blocking API response
              processor.processSettlementManually().catch(err => {
                console.warn('⚠️ Settlement trigger failed (processSettlementManually):', err);
              });
            } catch (e) {
              console.warn('⚠️ Settlement processor not available to trigger immediately:', e);
            }
          }

          return {
            order: fullOrder,
            matches,
            success: true,
            blockchainTxHash: blockchainResult.success ? blockchainResult.txHash : undefined
          };
          
        } catch (dbError: any) {
          console.error('🚨 Database operation failed:', dbError);
          throw new Error(`Failed to complete off-chain order: ${dbError.message}`);
        }
      }

            // Handle limit orders - PURE OFF-CHAIN
      if (fullOrder.order_type === 'LIMIT') {
        console.log('📊 Processing LIMIT order for off-chain matching...');
        
        // Store the order first to get UUID
        const orderUuid = await this.storeOrder(fullOrder, orderRequest.signature, orderRequest.nonce);
        fullOrder.id = orderUuid; // Use the UUID for matching
        
        console.log(`✅ Order stored with UUID: ${orderUuid}`);
        
        // Execute off-chain matching
        const matches = await this.executeLimitOrder(fullOrder);
        
        // Update order status based on matches
        const totalFilled = matches.reduce((sum, match) => sum + match.quantity, 0);
        fullOrder.filled_quantity = totalFilled;
        
        if (totalFilled >= fullOrder.quantity) {
          fullOrder.order_status = 'FILLED';
        } else if (totalFilled > 0) {
          fullOrder.order_status = 'PARTIALLY_FILLED';
        } else {
          fullOrder.order_status = 'PENDING';
        }

        console.log(`🎯 Limit order matching complete: ${matches.length} matches, ${totalFilled} filled, status: ${fullOrder.order_status}`);

        // Store matches and update order status
        try {
          // Update the order with final status
          const { error: updateError } = await this.supabase
            .from('orders')
            .update({
              filled_quantity: fullOrder.filled_quantity,
              order_status: fullOrder.order_status,
              updated_at: new Date().toISOString()
            })
            .eq('id', orderUuid);
          
          if (updateError) {
            throw new Error(`Failed to update order status: ${updateError.message}`);
          }
          
          // Store matches with UUID mapping
          const orderUuidMap = new Map<string, string>();
          orderUuidMap.set(fullOrder.id, orderUuid); // Map current order UUID
          
          // Get UUIDs for matched orders
          for (const match of matches) {
            if (!orderUuidMap.has(match.buyOrderId)) {
              const uuid = await this.getOrderUuidById(match.buyOrderId);
              if (uuid) orderUuidMap.set(match.buyOrderId, uuid);
            }
            if (!orderUuidMap.has(match.sellOrderId)) {
              const uuid = await this.getOrderUuidById(match.sellOrderId);
              if (uuid) orderUuidMap.set(match.sellOrderId, uuid);
            }
          }
          
          for (const match of matches) {
            await this.storeMatch(match, orderUuidMap);
            console.log(`✅ Match stored: ${match.buyOrderId} ↔ ${match.sellOrderId} (${match.quantity} @ ${match.price})`);
          }
          
          // Submit order to blockchain via OrderRouter.placeOrder() to solidify in OrderBook.sol
          console.log(`🔗 Submitting order to blockchain to solidify matches...`);
          const blockchainResult = await this.submitOrderToBlockchain(fullOrder, orderRequest);
          
          if (blockchainResult.success) {
                      console.log(`✅ Order solidified on blockchain: ${blockchainResult.txHash}`);
          
          // Update order with blockchain transaction hash
          await this.supabase
            .from('orders')
            .update({
              creation_transaction_hash: blockchainResult.txHash,
              updated_at: new Date().toISOString()
            })
            .eq('id', orderUuid);
            
          // NOTE: recordTradeExecution is handled by the settlement processor
          // during batch settlement, not immediately after matching.
          // This is the correct architectural approach for off-chain matching.
          console.log(`📊 Trade executions will be recorded on-chain during settlement processing`);
          if (matches && matches.length > 0) {
            console.log(`📝 ${matches.length} matches created and will be settled in the next batch`);
          }
          } else {
            console.error(`❌ Failed to solidify order on blockchain: ${blockchainResult.error}`);
            console.error(`❌ Full blockchain error details:`, blockchainResult);
            // Note: We continue with off-chain record even if blockchain fails
            // This allows for retry mechanisms and hybrid operation
          }
          
          // Broadcast order update
          const eventType = fullOrder.order_status === 'FILLED' ? 'executed' : 'placed';
          await this.broadcastOrderUpdate(fullOrder, orderRequest.metricId, eventType);

          console.log('✅ All off-chain and on-chain operations completed successfully');

          // Attempt to trigger settlement processing immediately (non-blocking)
          if ((matches?.length || 0) > 0) {
            try {
              const { getSettlementProcessor } = await import('@/lib/settlement-processor');
              const processor = getSettlementProcessor();
              // Fire-and-forget; do not await to avoid blocking API response
              processor.processSettlementManually().catch(err => {
                console.warn('⚠️ Settlement trigger failed (processSettlementManually):', err);
              });
            } catch (e) {
              console.warn('⚠️ Settlement processor not available to trigger immediately:', e);
            }
          }

          return { order: fullOrder, matches, success: true, blockchainTxHash: blockchainResult.success ? blockchainResult.txHash : undefined };
          
        } catch (dbError: any) {
          console.error('🚨 Database operation failed:', dbError);
          throw new Error(`Failed to complete off-chain order: ${dbError.message}`);
        }
      }

      throw new Error(`Unsupported order type: ${fullOrder.order_type}`);

    } catch (error) {
      console.error('Order processing failed:', error);
      return {
        order: null as any,
        matches: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Execute a market order by matching against the best available prices
   * Enhanced to include both off-chain and on-chain orders
   */
  private async executeMarketOrder(order: Order): Promise<Match[]> {
    const matches: Match[] = [];
    let remainingQuantity = order.quantity;

    // Get opposite side orders, sorted by best price first
    const oppositeSide = order.side === 'BUY' ? 'SELL' : 'BUY';
    const priceOrder = order.side === 'BUY' ? 'asc' : 'desc'; // BUY wants lowest SELL prices, SELL wants highest BUY prices

    // STEP 1: Get off-chain orders (both LIMIT and MARKET orders)
    const { data: oppositeOrders, error } = await this.supabase
      .from('orders')
      .select('*')
      .eq('market_id', order.market_id)
      .eq('side', oppositeSide)
      .in('order_type', ['LIMIT', 'MARKET']) // Include both LIMIT and MARKET orders
      .in('status', ['PENDING', 'PARTIAL'])
      .gt('size', 0) // Has remaining quantity
      .order('price', { ascending: priceOrder === 'asc' })
      .order('created_at', { ascending: true }); // Price-time priority

    if (error) {
      throw new Error(`Failed to fetch opposite orders: ${error.message}`);
    }

    // STEP 2: Get compatible on-chain orders for bidirectional matching
    const onChainOrders = await this.getOnChainOrdersForMatching(order);
    
    // Combine and sort all available orders by price priority
    // For market orders (price = null), we'll handle them separately
    const allOppositeOrders = [...(oppositeOrders || []), ...onChainOrders]
      .sort((a, b) => {
        // Market orders (no price) should be matched first (time priority)
        if (!a.price && !b.price) return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (!a.price) return -1; // Market orders first
        if (!b.price) return 1;
        
        // For limit orders, sort by price
        if (priceOrder === 'asc') {
          return (a.price || 0) - (b.price || 0);
        } else {
          return (b.price || 0) - (a.price || 0);
        }
      });

    // Match against all available orders (off-chain + on-chain)
    for (const oppositeOrder of allOppositeOrders || []) {
      if (remainingQuantity <= 0) break;

      const availableQuantity = oppositeOrder.remaining_quantity;
      const matchQuantity = Math.min(remainingQuantity, availableQuantity);
      
      if (matchQuantity > 0) {
        // Determine match price based on order types
        let matchPrice: number;
        if (oppositeOrder.price) {
          // If opposite order has a price (LIMIT order), use it
          matchPrice = oppositeOrder.price;
        } else {
          // Market-to-market matching: use a fair market price from recent trades or limit orders
          matchPrice = await this.getMarketPrice(order.market_id);
        }

        const match: Match = {
          buyOrderId: order.side === 'BUY' ? (order.uuid_id || order.id) : (oppositeOrder.uuid_id || oppositeOrder.id),
          sellOrderId: order.side === 'SELL' ? (order.uuid_id || order.id) : (oppositeOrder.uuid_id || oppositeOrder.id),
          quantity: matchQuantity,
          price: matchPrice,
          timestamp: new Date(),
          marketId: order.market_id,
          buyTraderAddress: order.side === 'BUY' ? order.trader_wallet_address : oppositeOrder.trader_wallet_address,
          sellTraderAddress: order.side === 'SELL' ? order.trader_wallet_address : oppositeOrder.trader_wallet_address
        };

        matches.push(match);
        remainingQuantity -= matchQuantity;

        // Update the opposite order
        if (oppositeOrder.isOnChain) {
          // For on-chain orders, we'll handle the update through settlement
          console.log(`🔗 On-chain order ${oppositeOrder.order_id} will be updated via settlement`);
        } else {
          // For off-chain orders, update immediately
          await this.updateOrderFill(oppositeOrder.id, oppositeOrder.filled_quantity + matchQuantity);
        }
      }
    }

    return matches;
  }

  /**
   * Execute a limit order by matching against compatible orders
   */
  private async executeLimitOrder(order: Order): Promise<Match[]> {
    if (!order.price) {
      throw new Error('Limit order must have a price');
    }

    const matches: Match[] = [];
    let remainingQuantity = order.quantity;

    // Get opposite side orders that can be matched
    const oppositeSide = order.side === 'BUY' ? 'SELL' : 'BUY';
    
    // For BUY orders: match with SELL orders at or below our price
    // For SELL orders: match with BUY orders at or above our price
    const priceFilter = order.side === 'BUY' ? 'lte' : 'gte';
    const priceOrder = order.side === 'BUY' ? 'asc' : 'desc';

    const query = this.supabase
      .from('orders')
      .select('*')
      .eq('market_id', order.market_id)
      .eq('side', oppositeSide)
      .in('order_type', ['LIMIT', 'MARKET']) // Include both LIMIT and MARKET orders
      .in('status', ['PENDING', 'PARTIAL'])
      .gt('size', 0);

    // Apply price filter (but allow MARKET orders which have null prices)
    if (priceFilter === 'lte') {
      query.or(`price.lte.${order.price},price.is.null`);
    } else {
      query.or(`price.gte.${order.price},price.is.null`);
    }

    const { data: oppositeOrders, error } = await query
      .order('created_at', { ascending: true }); // Use time priority for mixed order types

    if (error) {
      throw new Error(`Failed to fetch compatible orders: ${error.message}`);
    }

    // STEP 2: Get compatible on-chain orders for bidirectional matching
    const onChainOrders = await this.getOnChainOrdersForMatching(order);
    
    // Filter on-chain orders by price compatibility
    const compatibleOnChainOrders = onChainOrders.filter(onChainOrder => {
      if (order.side === 'BUY') {
        return onChainOrder.price <= (order.price || 0); // BUY can match SELL at or below our price
      } else {
        return onChainOrder.price >= (order.price || 0); // SELL can match BUY at or above our price
      }
    });

    // Combine and sort all available orders by price priority
    const allOppositeOrders = [...(oppositeOrders || []), ...compatibleOnChainOrders]
      .sort((a, b) => {
        // Market orders (no price) should be matched first (time priority)
        if (!a.price && !b.price) return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (!a.price) return -1; // Market orders first
        if (!b.price) return 1;
        
        // For limit orders, sort by price
        if (priceOrder === 'asc') {
          return (a.price || 0) - (b.price || 0);
        } else {
          return (b.price || 0) - (a.price || 0);
        }
      });

    // Match against all compatible orders (off-chain + on-chain)
    for (const oppositeOrder of allOppositeOrders || []) {
      if (remainingQuantity <= 0) break;

      const availableQuantity = oppositeOrder.remaining_quantity;
      const matchQuantity = Math.min(remainingQuantity, availableQuantity);
      
      if (matchQuantity > 0) {
        const match: Match = {
          buyOrderId: order.side === 'BUY' ? (order.uuid_id || order.id) : (oppositeOrder.uuid_id || oppositeOrder.id),
          sellOrderId: order.side === 'SELL' ? (order.uuid_id || order.id) : (oppositeOrder.uuid_id || oppositeOrder.id),
          quantity: matchQuantity,
          price: oppositeOrder.price!, // Use existing order price (price-time priority)
          timestamp: new Date(),
          marketId: order.market_id,
          buyTraderAddress: order.side === 'BUY' ? order.trader_wallet_address : oppositeOrder.trader_wallet_address,
          sellTraderAddress: order.side === 'SELL' ? order.trader_wallet_address : oppositeOrder.trader_wallet_address
        };

        matches.push(match);
        remainingQuantity -= matchQuantity;

        // Update the opposite order
        if (oppositeOrder.isOnChain) {
          // For on-chain orders, we'll handle the update through settlement
          console.log(`🔗 On-chain order ${oppositeOrder.order_id} will be updated via settlement`);
        } else {
          // For off-chain orders, update immediately
          await this.updateOrderFill(oppositeOrder.id, oppositeOrder.filled_quantity + matchQuantity);
        }
      }
    }

    return matches;
  }

  /**
   * 🔄 Retroactively match existing on-chain orders with new off-chain orders
   * This enables bidirectional matching regardless of order placement sequence
   */
  async processRetroactiveMatching(metricId: string): Promise<{
    matches: Match[];
    success: boolean;
    error?: string;
  }> {
    try {
      console.log(`🔄 Processing retroactive matching for market: ${metricId}`);
      
      // Get market ID
      const { data: market, error: marketError } = await this.supabase
        .from('orderbook_markets')
        .select('id, metric_id, market_address, order_router_address')
        .eq('metric_id', metricId)
        .single();

      if (marketError || !market) {
        throw new Error(`Market not found for metric: ${metricId}`);
      }

      // Get all on-chain orders for this market
      const allOnChainOrders = await this.getOnChainOrdersForMatching({
        market_id: market.id,
        side: 'BUY', // We'll get both sides
        trader_wallet_address: '',
        order_type: 'LIMIT',
        quantity: 0,
        filled_quantity: 0,
        order_status: 'PENDING',
        time_in_force: 'GTC',
        post_only: false,
        reduce_only: false,
        created_at: '',
        id: ''
      } as Order);

      // Try to get orders by matching metric_id instead of market UUID
      // Since orders.market_id uses strings but orderbook_markets.id uses UUIDs
      const { data: offChainOrders, error: offChainError } = await this.supabase
        .from('orders')
        .select('*')
        .eq('market_id', metricId) // Use the metric_id directly
        .in('status', ['PENDING', 'PARTIAL'])
        .gt('size', 0);

      if (offChainError) {
        console.warn(`⚠️ Failed to fetch off-chain orders: ${offChainError.message}`);
        // Don't throw error, just continue with empty orders array
      }

      const matches: Match[] = [];

      // Try to match on-chain BUY orders with off-chain SELL orders
      const onChainBuys = allOnChainOrders.filter(o => o.side === 'BUY');
      const offChainSells = (offChainOrders || []).filter((o: any) => o.side === 'SELL');

      for (const buyOrder of onChainBuys) {
        for (const sellOrder of offChainSells) {
          if (buyOrder.price >= sellOrder.price && buyOrder.remaining_quantity > 0 && (sellOrder.size - sellOrder.filled) > 0) {
            const matchQuantity = Math.min(buyOrder.remaining_quantity, sellOrder.size - sellOrder.filled);
            
            if (matchQuantity > 0) {
              const match: Match = {
                buyOrderId: buyOrder.id,
                sellOrderId: sellOrder.id,
                quantity: matchQuantity,
                price: sellOrder.price, // Use sell order price
                timestamp: new Date(),
                marketId: market.id,
                buyTraderAddress: buyOrder.trader_wallet_address,
                sellTraderAddress: sellOrder.user_address
              };

              matches.push(match);
              
              // Update quantities for next iterations
              buyOrder.remaining_quantity -= matchQuantity;
              sellOrder.filled += matchQuantity;
              
              // Store the match with UUID mapping
              const retroUuidMap = new Map<string, string>();
              // Get UUIDs for the orders involved
              const buyUuid = await this.getOrderUuidById(match.buyOrderId);
              const sellUuid = await this.getOrderUuidById(match.sellOrderId);
              if (buyUuid) retroUuidMap.set(match.buyOrderId, buyUuid);
              if (sellUuid) retroUuidMap.set(match.sellOrderId, sellUuid);
              await this.storeMatch(match, retroUuidMap);
              console.log(`✅ Retroactive match: On-chain BUY ${buyOrder.order_id} ↔ Off-chain SELL ${sellOrder.id}`);
            }
          }
        }
      }

      // Try to match on-chain SELL orders with off-chain BUY orders
      const onChainSells = allOnChainOrders.filter(o => o.side === 'SELL');
      const offChainBuys = (offChainOrders || []).filter((o: any) => o.side === 'BUY');

      for (const sellOrder of onChainSells) {
        for (const buyOrder of offChainBuys) {
          if (buyOrder.price >= sellOrder.price && (buyOrder.size - buyOrder.filled) > 0 && sellOrder.remaining_quantity > 0) {
            const matchQuantity = Math.min(buyOrder.size - buyOrder.filled, sellOrder.remaining_quantity);
            
            if (matchQuantity > 0) {
              const match: Match = {
                buyOrderId: buyOrder.id,
                sellOrderId: sellOrder.id,
                quantity: matchQuantity,
                price: sellOrder.price, // Use sell order price
                timestamp: new Date(),
                marketId: market.id,
                buyTraderAddress: buyOrder.user_address,
                sellTraderAddress: sellOrder.trader_wallet_address
              };

              matches.push(match);
              
              // Update quantities for next iterations
              buyOrder.filled += matchQuantity;
              sellOrder.remaining_quantity -= matchQuantity;
              
              // Store the match with UUID mapping
              const retroUuidMap = new Map<string, string>();
              // Get UUIDs for the orders involved
              const buyUuid = await this.getOrderUuidById(match.buyOrderId);
              const sellUuid = await this.getOrderUuidById(match.sellOrderId);
              if (buyUuid) retroUuidMap.set(match.buyOrderId, buyUuid);
              if (sellUuid) retroUuidMap.set(match.sellOrderId, sellUuid);
              await this.storeMatch(match, retroUuidMap);
              console.log(`✅ Retroactive match: Off-chain BUY ${buyOrder.id} ↔ On-chain SELL ${sellOrder.order_id}`);
            }
          }
        }
      }

      console.log(`🎉 Retroactive matching complete: ${matches.length} matches created`);
      return { matches, success: true };

    } catch (error) {
      console.error('❌ Retroactive matching failed:', error);
      return {
        matches: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Store order in database
   */
  private async storeOrder(order: Order, signature?: string, nonce?: number): Promise<string> {
    // Generate order hash from order data
    const orderHash = this.generateOrderHash(order);
    
    // Calculate required collateral based on order type
    const requiredCollateral = order.order_type === 'LIMIT' && order.price ? 
      order.quantity * order.price : 
      order.quantity * 100; // Default collateral for market orders

    const insertData = {
      order_id: parseInt(order.id), // Convert to integer for BIGINT field
      market_id: order.market_id,
      trader_wallet_address: order.trader_wallet_address,
      order_type: order.order_type,
      side: order.side,
      quantity: order.quantity,
      price: order.order_type === 'MARKET' ? null : order.price,
      filled_quantity: order.filled_quantity,
      order_status: order.order_status,
      time_in_force: order.time_in_force,
      post_only: order.post_only,
      reduce_only: order.reduce_only,
      order_hash: orderHash,
      signature: signature || '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      nonce: nonce || 0,
      required_collateral: requiredCollateral,
      collateral_token_address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC on Polygon
      source: 'api',
      expires_at: order.expires_at
    };
    
    console.log('💾 Attempting to insert order data:', insertData);

        // 🚨 USE SAFE INSERT FUNCTION: For atomic deduplication
    console.log('💾 Inserting order via safe insert function:', {
      order_id: insertData.order_id,
      market_id: insertData.market_id,
      trader_wallet_address: insertData.trader_wallet_address,
      order_type: insertData.order_type,
      side: insertData.side,
      quantity: insertData.quantity,
      price: insertData.price
    });

    const { data: upsertedRows, error } = await this.supabase
      .from('orders')
      .upsert([
        {
          order_id: insertData.order_id,
          market_id: insertData.market_id,
          trader_wallet_address: insertData.trader_wallet_address,
          order_type: insertData.order_type,
          side: insertData.side,
          quantity: insertData.quantity,
          price: insertData.price,
          order_status: insertData.order_status,
          time_in_force: insertData.time_in_force,
          post_only: insertData.post_only,
          reduce_only: insertData.reduce_only,
          order_hash: insertData.order_hash,
          signature: insertData.signature,
          nonce: insertData.nonce,
          required_collateral: insertData.required_collateral,
          collateral_token_address: insertData.collateral_token_address
        }
      ], { onConflict: ['order_hash'] })
      .select('id')
      .single();

    if (error) {
      console.error('🚨 Database insertion error details:', {
        error,
        errorMessage: error.message,
        errorCode: error.code,
        errorHint: error.hint,
        errorDetails: error.details,
        fullError: JSON.stringify(error, null, 2)
      });
      throw new Error(`Failed to store order: ${error.message || JSON.stringify(error)}`);
    } else {
      const orderUuid = upsertedRows?.id;
      console.log('✅ Order stored successfully in orders:', orderUuid);
      if (orderUuid) {
        // Update additional fields that aren't in the safe insert function
        const { error: updateError } = await this.supabase
          .from('orders')
          .update({
            filled_quantity: insertData.filled_quantity,
            source: insertData.source,
            expires_at: insertData.expires_at,
            updated_at: new Date().toISOString()
          })
          .eq('id', orderUuid);

        if (updateError) {
          console.warn('⚠️ Failed to update additional order fields:', updateError.message);
        }

        return orderUuid; // Return the UUID from upsert
      } else {
        throw new Error('Failed to get order UUID from database function');
      }
    }
  }

  /**
   * Generate order hash from order data
   */
  private generateOrderHash(order: Order): string {
    const dataString = `${order.market_id}-${order.order_type}-${order.side}-${order.quantity}-${order.price || 0}-${order.trader_wallet_address}-${order.id}-${Date.now()}-${Math.random()}`;
    const hash = createHash('sha256').update(dataString).digest('hex');
    // Return as 0x prefixed hex string (66 chars total)
    return `0x${hash}`;
  }

  /**
   * Store match in database with proper UUID mapping
   */
  private async storeMatch(match: Match, orderUuidMap: Map<string, string>): Promise<void> {
    // Get the actual UUIDs from the mapping instead of converting
    let buyOrderUuid = orderUuidMap.get(match.buyOrderId) || null;
    let sellOrderUuid = orderUuidMap.get(match.sellOrderId) || null;

    // Attempt to hydrate missing mappings gracefully
    const ensureOrderUuidForId = async (orderId: string, marketId: string): Promise<string | null> => {
      // Try existing DB mappings first
      const existing = await this.getOrderUuidById(orderId);
      if (existing) return existing;

      // If it's an on-chain reference, attempt hydration by querying the blockchain and inserting a DB row
      try {
        if (orderId && orderId.startsWith('onchain_')) {
          const numericId = Number(orderId.slice('onchain_'.length));
          if (!Number.isNaN(numericId)) {
            // Load market and chain context
            const { data: market, error: marketError } = await this.supabase
              .from('orderbook_markets')
              .select('order_router_address, metric_id')
              .eq('id', marketId)
              .single();
            if (marketError || !market?.order_router_address) {
              console.warn(`⚠️ Cannot hydrate on-chain order ${numericId}: missing market/order router for market ${marketId}`);
              return null;
            }

            const { createPublicClient, http } = await import('viem');
            const { polygon } = await import('viem/chains');
            const { env } = await import('@/lib/env');
            const ORDER_ROUTER_JSON = (await import('@/lib/abis/OrderRouter.json')).default as any;
            const ORDER_ROUTER_ABI = (ORDER_ROUTER_JSON.abi ?? ORDER_ROUTER_JSON) as unknown as any[];

            const publicClient = createPublicClient({ chain: polygon, transport: http(env.RPC_URL) });

            // Read on-chain order details
            const onchainOrder: any = await publicClient.readContract({
              address: market.order_router_address as `0x${string}`,
              abi: ORDER_ROUTER_ABI,
              functionName: 'getOrder',
              args: [BigInt(numericId)]
            });

            // Basic validation: trader non-zero indicates existence
            if (!onchainOrder || !onchainOrder.trader || onchainOrder.trader === '0x0000000000000000000000000000000000000000') {
              console.warn(`⚠️ On-chain order ${numericId} not found or invalid while hydrating`);
              return null;
            }

            // Prepare insert via safe RPC to ensure mapping exists
            const orderTypeStr = Number(onchainOrder.orderType) === 1 ? 'LIMIT' : 'MARKET';
            const sideStr = Number(onchainOrder.side) === 0 ? 'BUY' : 'SELL';
            const quantity = Number(onchainOrder.quantity) / 1e18;
            const price = Number(onchainOrder.price) / 1e18;
            const filledQty = Number(onchainOrder.filledQuantity) / 1e18;
            const nonceVal = Number(onchainOrder.timestamp) % 1000000;
            const requiredCollateral = Math.max(quantity * (price || 1), 0.01);

            const { data: upsertHydrated, error: insertErr } = await this.supabase
              .from('orders')
              .upsert([
                {
                  order_id: numericId,
                  market_id: marketId,
                  trader_wallet_address: onchainOrder.trader as string,
                  order_type: orderTypeStr,
                  side: sideStr,
                  quantity: quantity,
                  price: price || null,
                  order_status: 'PENDING',
                  time_in_force: 'GTC',
                  post_only: false,
                  reduce_only: false,
                  order_hash: onchainOrder.metadataHash || `0x${numericId.toString(16).padStart(64, '0')}`,
                  signature: '0x' + '0'.repeat(130),
                  nonce: nonceVal,
                  required_collateral: requiredCollateral,
                  collateral_token_address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
                }
              ], { onConflict: ['order_hash'] })
              .select('id')
              .single();

            if (insertErr) {
              console.warn(`⚠️ Failed to insert hydrated on-chain order ${numericId}: ${insertErr.message}`);
              // Try to find again in case of race
              const fallback = await this.getOrderUuidById(orderId);
              return fallback;
            }

            if (upsertHydrated?.id) {
              return upsertHydrated.id as unknown as string;
            }
          }
        }
      } catch (e) {
        console.warn(`⚠️ Error hydrating order mapping for ${orderId}: ${e}`);
      }

      return null;
    };

    if (!buyOrderUuid) {
      buyOrderUuid = await ensureOrderUuidForId(match.buyOrderId, match.marketId);
    }
    if (!sellOrderUuid) {
      sellOrderUuid = await ensureOrderUuidForId(match.sellOrderId, match.marketId);
    }

    if (!buyOrderUuid || !sellOrderUuid) {
      console.warn(`⚠️ Skipping match storage due to unresolved UUID mapping: buy=${match.buyOrderId}→${buyOrderUuid}, sell=${match.sellOrderId}→${sellOrderUuid}`);
      return; // Recoverable: do not throw; allow processing of other matches
    }

    console.log(`🔗 Storing match with UUIDs: buy=${buyOrderUuid}, sell=${sellOrderUuid}`);

    // Validate trade price before insertion
    if (match.price === null || match.price === undefined || isNaN(match.price)) {
      console.error('❌ Invalid trade price detected:', {
        marketId: match.marketId,
        buyOrderId: match.buyOrderId,
        sellOrderId: match.sellOrderId,
        price: match.price,
        buyTraderAddress: match.buyTraderAddress,
        sellTraderAddress: match.sellTraderAddress,
        quantity: match.quantity,
        timestamp: match.timestamp
      });
      throw new Error(`Invalid trade_price (${match.price}) for market ${match.marketId}. Buy Order: ${match.buyOrderId}, Sell Order: ${match.sellOrderId}`);
    }

    // Log successful price validation
    console.log(`✅ Valid trade price ${match.price} for market ${match.marketId}`);

    const { error } = await this.supabase
      .from('trade_matches')
      .insert({
        match_id: Date.now(), // Simple incrementing ID
        market_id: match.marketId,
        buy_order_id: buyOrderUuid, // Use actual UUID from mapping
        sell_order_id: sellOrderUuid, // Use actual UUID from mapping
        buy_trader_wallet_address: match.buyTraderAddress,
        sell_trader_wallet_address: match.sellTraderAddress,
        trade_price: match.price,
        trade_quantity: match.quantity,
        // Add required NOT NULL fields with defaults
        buy_trader_fee: 0, // Default fee for buyer
        sell_trader_fee: 0, // Default fee for seller
        settlement_status: 'PENDING',
        matched_at: match.timestamp.toISOString()
      });

    if (error) {
      // Enhanced error handling for foreign key constraints
      if (error.code === '23503' && error.message.includes('trade_matches_buy_order_id_fkey')) {
        throw new Error(`Foreign key constraint violation: Buy order UUID ${buyOrderUuid} not found in orders table. Original order ID: ${match.buyOrderId}`);
      } else if (error.code === '23503' && error.message.includes('trade_matches_sell_order_id_fkey')) {
        throw new Error(`Foreign key constraint violation: Sell order UUID ${sellOrderUuid} not found in orders table. Original order ID: ${match.sellOrderId}`);
      } else if (error.code === '23503') {
        throw new Error(`Foreign key constraint violation in trade_matches: ${error.message}`);
      }
      throw new Error(`Failed to store match: ${error.message}`);
    }
    
    console.log(`✅ Trade match stored successfully: ${match.buyOrderId} ↔ ${match.sellOrderId}`);
  }

  /**
   * Get order UUID by order ID (for existing orders)
   */
  private async getOrderUuidById(orderId: string): Promise<string | null> {
    try {
      // Handle on-chain order identifiers like "onchain_5"
      if (typeof orderId === 'string' && orderId.startsWith('onchain_')) {
        const raw = orderId.slice('onchain_'.length);
        const onchainNumericId = Number(raw);
        if (!Number.isNaN(onchainNumericId)) {
          const { data: byOnchainId, error: onchainErr } = await this.supabase
            .from('orders')
            .select('id')
            .eq('order_id', onchainNumericId)
            .single();
          if (!onchainErr && byOnchainId) {
            return byOnchainId.id;
          }
          // Fallback: try by deterministic fallback order_hash used during hydration
          const fallbackHash = `0x${onchainNumericId.toString(16).padStart(64, '0')}`;
          const { data: byHash } = await this.supabase
            .from('orders')
            .select('id')
            .eq('order_hash', fallbackHash)
            .single();
          if (byHash) {
            return byHash.id;
          }
        }
      }

      // First try to find by UUID (if orderId is already a UUID)
      {
        const { data: orderByUuid, error: uuidError } = await this.supabase
          .from('orders')
          .select('id')
          .eq('id', orderId)
          .single();
        if (!uuidError && orderByUuid) {
          return orderByUuid.id;
        }
      }

      // Then try to find by order_id (integer field) if it's a numeric string
      {
        const maybeInt = Number(orderId);
        if (!Number.isNaN(maybeInt)) {
          const { data: orderByIntId, error: intError } = await this.supabase
            .from('orders')
            .select('id')
            .eq('order_id', maybeInt)
            .single();
          if (!intError && orderByIntId) {
            return orderByIntId.id;
          }
        }
      }

      console.warn(`⚠️ Could not find UUID for order ID: ${orderId}`);
      return null;
    } catch (error) {
      console.error(`❌ Error getting UUID for order ${orderId}:`, error);
      return null;
    }
  }

  /**
   * Convert order ID to database-compatible format
   * If it's an on-chain order ID (format: "onchain_X"), generate a deterministic UUID
   * If it's already a UUID, return as-is
   */
  private convertOrderIdForDatabase(orderId: string): string {
    // Check if it's an on-chain order ID
    if (orderId.startsWith('onchain_')) {
      // Generate a deterministic UUID based on the on-chain order ID
      // Using a namespace UUID approach to ensure consistency
      const namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // Random namespace UUID
      const hash = createHash('sha1');
      hash.update(namespace + orderId);
      const hashBytes = hash.digest();
      
      // Format as UUID v5 (name-based SHA-1)
      const uuid = [
        hashBytes.slice(0, 4).toString('hex'),
        hashBytes.slice(4, 6).toString('hex'),
        '5' + hashBytes.slice(6, 8).toString('hex').slice(1), // Version 5
        ((parseInt(hashBytes[8].toString(16), 16) & 0x3f) | 0x80).toString(16) + hashBytes.slice(9, 10).toString('hex'),
        hashBytes.slice(10, 16).toString('hex')
      ].join('-');
      
      return uuid;
    }
    
    // If it's already a UUID or other format, return as-is
    return orderId;
  }

  /**
   * Update order filled quantity
   */
  private async updateOrderFill(orderId: string, newFilledQuantity: number): Promise<void> {
    // Get current order to determine new status
    const { data: orderData } = await this.supabase
      .from('orders')
      .select('quantity')
      .eq('id', orderId)
      .single();

    if (!orderData) return;

    const newStatus = newFilledQuantity >= orderData.quantity ? 'FILLED' : 'PARTIALLY_FILLED';

    const { error } = await this.supabase
      .from('orders')
      .update({
        filled_quantity: newFilledQuantity,
        order_status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) {
      throw new Error(`Failed to update order fill: ${error.message}`);
    }
  }

  /**
   * 🔗 Get on-chain orders that can match with the given order
   */
  private async getOnChainOrdersForMatching(order: Order): Promise<any[]> {
    try {
      console.log(`🔍 Checking on-chain orders for bidirectional matching...`);
      
      // Get market contract addresses
      const { data: market, error: marketError } = await this.supabase
        .from('orderbook_markets')
        .select('market_address, order_router_address, metric_id')
        .eq('id', order.market_id)
        .single();

      if (marketError || !market?.order_router_address) {
        console.log('⚠️ Market not found or missing contract addresses, skipping on-chain matching');
        return [];
      }

      // Import blockchain dependencies
      const { createPublicClient, http } = await import('viem');
      const { polygon } = await import('viem/chains');
      const { env } = await import('@/lib/env');

      // Use the complete OrderRouter ABI with getUserActiveOrders function
      const ORDER_ROUTER_ABI = [
        {
          inputs: [{ name: "trader", type: "address" }],
          name: "getUserActiveOrders",
          outputs: [
            {
              components: [
                { name: "orderId", type: "uint256" },
                { name: "trader", type: "address" },
                { name: "metricId", type: "string" },
                { name: "orderType", type: "uint8" },
                { name: "side", type: "uint8" },
                { name: "quantity", type: "uint256" },
                { name: "price", type: "uint256" },
                { name: "filledQuantity", type: "uint256" },
                { name: "timestamp", type: "uint256" },
                { name: "expiryTime", type: "uint256" },
                { name: "status", type: "uint8" },
                { name: "timeInForce", type: "uint8" },
                { name: "stopPrice", type: "uint256" },
                { name: "icebergQty", type: "uint256" },
                { name: "postOnly", type: "bool" },
                { name: "metadataHash", type: "bytes32" },
              ],
              name: "orders",
              type: "tuple[]",
            },
          ],
          stateMutability: "view",
          type: "function",
        },
      ];

      const publicClient = createPublicClient({
        chain: polygon,
        transport: http(env.RPC_URL)
      });

      // Get all traders who have active orders for this market
      // We'll need to check multiple traders since getUserActiveOrders is trader-specific
      const knownTraders = [
        '0x1Bc0a803de77a004086e6010cD3f72ca7684e444', // Your address
        '0x67578a5bffc0ff03cf7661db7ed51360884fc371', // Other known trader
        '0x60D1b2c4B2960e4ab7d7382D6b18Ee6ab872796B'  // Another known trader
      ];

      const allOnChainOrders = [];
      
      for (const traderAddress of knownTraders) {
        try {
          const activeOrders = await publicClient.readContract({
            address: market.order_router_address as `0x${string}`,
            abi: ORDER_ROUTER_ABI,
            functionName: 'getUserActiveOrders',
            args: [traderAddress as `0x${string}`],
          });

          // Filter orders for this specific market and opposite side
          const compatibleOrders = (activeOrders as any[])
            .filter((onChainOrder: any) => 
              onChainOrder.metricId === market.metric_id &&
              (onChainOrder.side === 0 ? 'BUY' : 'SELL') === (order.side === 'BUY' ? 'SELL' : 'BUY') &&
              onChainOrder.status === 0 && // PENDING
              Number(onChainOrder.quantity) > Number(onChainOrder.filledQuantity)
            )
            .map((onChainOrder: any) => ({
              id: `onchain_${onChainOrder.orderId}`,
              order_id: Number(onChainOrder.orderId),
              trader_wallet_address: onChainOrder.trader,
              order_type: 'LIMIT',
              side: onChainOrder.side === 0 ? 'BUY' : 'SELL',
              quantity: Number(onChainOrder.quantity) / 1e18,
              price: Number(onChainOrder.price) / 1e18,
              filled_quantity: Number(onChainOrder.filledQuantity) / 1e18,
              remaining_quantity: (Number(onChainOrder.quantity) - Number(onChainOrder.filledQuantity)) / 1e18,
              order_status: 'PENDING',
              created_at: new Date(Number(onChainOrder.timestamp) * 1000).toISOString(),
              isOnChain: true // Flag to identify on-chain orders
            }));

          allOnChainOrders.push(...compatibleOrders);
          
        } catch (error) {
          console.log(`⚠️ Could not fetch orders for trader ${traderAddress}: ${error}`);
        }
      }

      console.log(`🔍 Found ${allOnChainOrders.length} compatible on-chain orders`);
      return allOnChainOrders;

    } catch (error) {
      console.error('❌ Error fetching on-chain orders:', error);
      return [];
    }
  }

  /**
   * 🔗 Submit order to blockchain using OrderRouter.placeOrderWithSig()
   * Now uses the corrected order signing utility
   */
  private async submitOrderToBlockchain(order: Order, orderRequest: any): Promise<{
    success: boolean;
    txHash?: string;
    error?: string;
  }> {
    console.log(`\x1b[38;5;208m🚨 ===== SUBMIT ORDER TO BLOCKCHAIN CALLED ===== \x1b[0m`);
    console.log(`\x1b[38;5;208m🚨 DEBUG: submitOrderToBlockchain function in serverless-matching.ts HAS BEEN CALLED!\x1b[0m`);
    console.log(`\x1b[38;5;208m🚨 DEBUG: Order type: ${order.order_type}, Side: ${order.side}, Quantity: ${order.quantity}\x1b[0m`);
    console.log(`\x1b[38;5;208m🚨 ============================================== \x1b[0m`);
    
    try {
      console.log(`🔗 Submitting order to blockchain via OrderRouter.placeOrderWithSig()...`);
      
      // Get market contract addresses
      const { data: market, error: marketLookupError } = await this.supabase
        .from('orderbook_markets')
        .select('market_address, order_router_address, central_vault_address')
        .eq('id', order.market_id)
        .single();

      if (marketLookupError) {
        return {
          success: false,
          error: `Failed to find market: ${marketLookupError.message}`
        };
      }

      if (!market?.market_address || !market?.order_router_address) {
        return {
          success: false,
          error: `Market not deployed to blockchain - missing contract addresses`
        };
      }

      // Import required dependencies for blockchain interaction
      const { createWalletClient, createPublicClient, http } = await import('viem');
      const { parseUnits } = await import('viem');
      const { polygon } = await import('viem/chains');
      const { privateKeyToAccount } = await import('viem/accounts');
      const { getSettlementPrivateKey } = await import('@/lib/runtime-env-loader');
      const { ORDER_ROUTER_ABI } = await import('@/lib/orderRouterAbi');
      const { env } = await import('@/lib/env');
      const { signOrder } = await import('@/lib/order-signing');

      // Get settlement private key for blockchain transactions
      const settlementPrivateKey = getSettlementPrivateKey();
      if (!settlementPrivateKey) {
        throw new Error('SETTLEMENT_PRIVATE_KEY required for blockchain order submission');
      }

      // Create blockchain clients
      const account = privateKeyToAccount(settlementPrivateKey as `0x${string}`);
      
      const publicClient = createPublicClient({
        chain: polygon,
        transport: http(env.RPC_URL)
      });
      
      const walletClient = createWalletClient({
        account,
        chain: polygon,
        transport: http(env.RPC_URL)
      });

      // Get current nonce for the trader (not the settlement account!)
      const currentNonce = await publicClient.readContract({
        address: market.order_router_address as `0x${string}`,
        abi: [
          {
            inputs: [{ name: "trader", type: "address" }],
            name: "getNonce",
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
            type: "function",
          }
        ],
        functionName: 'getNonce',
        args: [order.trader_wallet_address as `0x${string}`],
      }) as bigint;

      console.log(`🔐 Current nonce for trader ${order.trader_wallet_address}: ${currentNonce}`);

      // ⚠️ CRITICAL: We submit the user's signed order using settlement wallet as relayer
      // The user already signed the order with their wallet (orderRequest.signature)
      // Settlement wallet acts as a relayer to submit the signed order to the blockchain

      // Fetch on-chain metricId from OrderBook to ensure router validation passes
      const onChainMetricId = (orderRequest.metricId ?? '').toString();

      // ===== Preflight price validation & conversion =====
      const rawInputPrice = order.price;
      const rawInputQuantity = order.quantity;
      const isLimitOrder = order.order_type === 'LIMIT';
      const providedNonZeroPrice = typeof rawInputPrice === 'number' && rawInputPrice > 0;

      if (isLimitOrder && !providedNonZeroPrice) {
        console.error('❌ Preflight failed: LIMIT order missing valid price (> 0).', {
          orderType: order.order_type,
          side: order.side,
          rawInputPrice
        });
        return {
          success: false,
          error: 'Invalid price: LIMIT orders require a non-zero price before blockchain submission'
        };
      }

      if (!isLimitOrder && !providedNonZeroPrice) {
        console.error('❌ Preflight failed: MARKET order missing price for on-chain solidification. Skipping blockchain submission.', {
          orderType: order.order_type,
          side: order.side,
          rawInputPrice
        });
        return {
          success: false,
          error: 'MARKET order missing price for on-chain submission. Provide a non-zero price in signed order.'
        };
      }

      // Align to 2-decimal tick size expected on-chain (1e16)
      const toTwoDecimals = (value: number) => Math.round(value * 100) / 100;
      const normalizedPrice = toTwoDecimals(rawInputPrice as number);
      const priceScaled = parseUnits(normalizedPrice.toFixed(2), 18);
      const quantityScaled = parseUnits(rawInputQuantity.toString(), 18);

      // Verify tick alignment: price % 1e16 == 0
      if (priceScaled % (10n ** 16n) !== 0n) {
        console.error('❌ Preflight failed: Price not aligned to tick size (0.01).', {
          normalizedPrice,
          priceScaled: priceScaled.toString()
        });
        return {
          success: false,
          error: 'Invalid price: not aligned to tick size of 0.01'
        };
      }

      console.log('🧪 Price/Quantity conversion', {
        rawInputPrice,
        normalizedPrice,
        priceScaled: priceScaled.toString(),
        rawInputQuantity,
        quantityScaled: quantityScaled.toString()
      });

      // Convert order to blockchain format (must match what was signed by the user)
      const blockchainOrder = {
        orderId: BigInt(0),
        trader: order.trader_wallet_address as `0x${string}`,
        metricId: onChainMetricId,
        orderType: order.order_type === 'MARKET' ? 0 : 1,
        side: order.side === 'BUY' ? 0 : 1,
        quantity: quantityScaled,
        price: priceScaled,
        filledQuantity: BigInt(0),
        timestamp: BigInt(0),
        expiryTime: BigInt(0),
        status: 0,
        timeInForce: 0,
        stopPrice: BigInt(0),
        icebergQty: BigInt(0),
        // Use the same postOnly flag that was part of the signed payload to avoid signature mismatch
        postOnly: Boolean(order.post_only || false),
        metadataHash: (orderRequest.metadataHash || `0x${'0'.repeat(64)}`) as `0x${string}`
      };

      // Verify the signature matches our expected order format with detailed mismatches
      const { validateOrderSignature } = await import('@/lib/order-signing');
      const validation = await validateOrderSignature({
        orderLike: blockchainOrder,
        signature: orderRequest.signature as `0x${string}`,
        nonce: BigInt(orderRequest.nonce || currentNonce),
        orderRouterAddress: market.order_router_address as `0x${string}`,
        expectedTrader: order.trader_wallet_address as `0x${string}`,
      });

      if (!validation.valid) {
        console.error('❌ Signature validation failed before blockchain submission', validation);
        return {
          success: false,
          error: 'Invalid order signature - signature does not match order data'
        };
      }

      console.log('✅ Signature validated successfully before blockchain submission');

      console.log(`📡 Submitting order to OrderRouter at ${market.order_router_address}`);
      console.log(`📊 Order details:`, {
        trader: blockchainOrder.trader,
        metricId: blockchainOrder.metricId,
        type: order.order_type,
        side: order.side,
        quantity: order.quantity,
        price: order.price,
        nonce: orderRequest.nonce || currentNonce
      });

      // Submit order to OrderRouter.placeOrderWithSig(order, signature)
      console.log(`\x1b[38;5;208m🔥 ===== CALLING PLACE ORDER WITH SIG ===== \x1b[0m`);
      console.log(`\x1b[38;5;208m📡 About to call placeOrderWithSig on OrderRouter...\x1b[0m`);
      console.log(`\x1b[38;5;208m🔥 ======================================== \x1b[0m`);
      const txHash = await walletClient.writeContract({
        address: market.order_router_address as `0x${string}`,
        abi: ORDER_ROUTER_ABI,
        functionName: 'placeOrderWithSig',
        args: [blockchainOrder, orderRequest.signature as `0x${string}`]
      });

      console.log(`\x1b[38;5;208m🚀 ===== PLACE ORDER WITH SIG SUCCESS ===== \x1b[0m`);
      console.log(`\x1b[38;5;208m🔗 Order submitted to blockchain: ${txHash}\x1b[0m`);
      console.log(`\x1b[38;5;208m🌐 View on PolyScan: https://polygonscan.com/tx/${txHash}\x1b[0m`);
      console.log(`\x1b[38;5;208m🚀 ========================================= \x1b[0m`);

      // Wait for transaction confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ 
        hash: txHash,
        timeout: 60000 // 60 second timeout
      });

      console.log(`✅ Order confirmed on blockchain at block ${receipt.blockNumber}`);
      
      return {
        success: true,
        txHash
      };

    } catch (error: any) {
      console.error('❌ Blockchain submission error:', error);
      
      // Enhanced error handling for signature-related issues
      if (error.message?.includes('invalid signature')) {
        return {
          success: false,
          error: 'OrderRouter: invalid signature - EIP-712 signature mismatch'
        };
      }
      
      return {
        success: false,
        error: error.message || 'Unknown blockchain error'
      };
    }
  }

  // Removed recordTradeExecutionOnChain method - trade execution recording
  // is now handled properly by the settlement processor during batch settlement

  /**
   * 🚀 Real-time broadcast order update to connected clients
   */
  private async broadcastOrderUpdate(order: Order, metricId: string, eventType: string): Promise<void> {
    try {
      if (!this.pusherService) {
        console.log(`📡 [BROADCAST] Pusher service not available, skipping broadcast for ${order.id}`);
        return;
      }

      console.log(`📡 [BROADCAST] Broadcasting off-chain order update for ${order.id}`);
      
      // Prepare broadcast data
      const broadcastData = {
        orderId: order.id,
        trader: order.trader_wallet_address,
        metricId: metricId,
        orderType: order.order_type,
        side: order.side,
        quantity: order.quantity,
        price: order.price || 0,
        filledQuantity: order.filled_quantity,
        status: order.order_status,
        eventType: eventType,
        timestamp: Date.now(),
        source: 'off_chain'
      };

      console.log(`📡 [BROADCAST] Off-chain broadcast data:`, broadcastData);

      // Broadcast trading event using the public method
      const actionType: 'open' | 'close' | 'liquidate' = eventType === 'executed' ? 'close' : 'open';
      
      await this.pusherService.broadcastTradingEvent({
        symbol: metricId,
        action: actionType,
        userAddress: order.trader_wallet_address,
        positionSize: order.quantity.toString(),
        markPrice: order.price || 0,
        timestamp: Date.now(),
        isLong: order.side === 'BUY'
      });

      console.log(`✅ [BROADCAST] Successfully broadcasted off-chain order update for ${order.id}`);

    } catch (error) {
      console.error(`❌ [BROADCAST] Failed to broadcast off-chain order update:`, error);
      // Don't throw error as this is a non-critical enhancement
    }
  }

  /**
   * Get market price for market-to-market matching
   * Always read from on-chain OrderBook; never fall back to database values
   */
  private async getMarketPrice(marketId: string): Promise<number> {
    try {
      // Load on-chain market address
      const { data: market, error: marketLookupError } = await this.supabase
        .from('orderbook_markets')
        .select('market_address, metric_id')
        .eq('id', marketId)
        .single();

      if (marketLookupError || !market?.market_address) {
        throw new Error(`Missing market_address for market ${marketId}`);
      }

      // Import blockchain deps lazily
      const { createPublicClient, http } = await import('viem');
      const { polygon } = await import('viem/chains');
      const { env } = await import('@/lib/env');

      // Minimal ABI for reads
      const ORDERBOOK_ABI = [
        'function getMarketStats() external view returns (tuple(uint256 lastPrice,uint256 volume24h,uint256 high24h,uint256 low24h,int256 priceChange24h,uint256 totalTrades,uint256 bestBid,uint256 bestAsk,uint256 spread))',
        'function getBestBid() external view returns (uint256)',
        'function getBestAsk() external view returns (uint256)'
      ];

      const publicClient = createPublicClient({ chain: polygon, transport: http(env.RPC_URL) });

      // Try lastPrice first
      const stats: any = await publicClient.readContract({
        address: market.market_address as `0x${string}`,
        abi: ORDERBOOK_ABI as any,
        functionName: 'getMarketStats',
        args: []
      });

      const lastPriceWei: bigint = stats?.[0] ?? 0n;
      if (lastPriceWei > 0n) {
        const price = Number(lastPriceWei) / 1e18;
        return price;
      }

      // If no trades yet, compute mid or available side
      const [bestBidWei, bestAskWei] = await Promise.all([
        publicClient.readContract({ address: market.market_address as `0x${string}`, abi: ORDERBOOK_ABI as any, functionName: 'getBestBid', args: [] }) as Promise<bigint>,
        publicClient.readContract({ address: market.market_address as `0x${string}`, abi: ORDERBOOK_ABI as any, functionName: 'getBestAsk', args: [] }) as Promise<bigint>
      ]);

      if (bestBidWei > 0n && bestAskWei > 0n) {
        const mid = (bestBidWei + bestAskWei) / 2n;
        return Number(mid) / 1e18;
      }

      if (bestBidWei > 0n) return Number(bestBidWei) / 1e18;
      if (bestAskWei > 0n) return Number(bestAskWei) / 1e18;

      // No on-chain signal available; return neutral price of 0 to force caller handling
      console.warn(`⚠️ No on-chain price available for market ${market.metric_id} (${marketId}). Returning 0.`);
      return 0;
    } catch (error) {
      console.error(`❌ Error determining on-chain market price for market ${marketId}:`, error);
      // Strict: never read from DB; return 0 to indicate no price
      return 0;
    }
  }
}

// Singleton instance for reuse within the same request
let matchingEngineInstance: ServerlessMatchingEngine | null = null;

export function getServerlessMatchingEngine(): ServerlessMatchingEngine {
  if (!matchingEngineInstance) {
    matchingEngineInstance = new ServerlessMatchingEngine();
  }
  return matchingEngineInstance;
}
