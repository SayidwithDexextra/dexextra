import { Address, formatUnits, parseAbi } from 'viem';
import { publicClient } from './viemClient';
import { CONTRACT_ADDRESSES, ORDER_ROUTER_ABI, OrderType, OrderSide, OrderStatus, TimeInForce } from './contractConfig';
import { CONTRACT_ABIS } from './contracts';
import { ContractOrder, ActualContractOrder, Order, OrderBookEntry, MarketDepth, TradeExecution, Transaction } from '@/types/orders';

/**
 * Service for interacting with OrderRouter smart contract using Viem
 */
export class OrderService {
  private client = publicClient;
  private addressCache = new Map<string, { address: Address; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
  private readonly ORDERBOOK_ABI = parseAbi([
    // Minimal VIEM-compatible ABI subset required by this service
    'function getUserOrders(address user) external view returns (uint256[] orderIds)',
    'function getOrder(uint256 orderId) external view returns (uint256 orderId_, address trader, uint256 price, uint256 amount, bool isBuy, uint256 timestamp, uint256 nextOrderId, uint256 marginRequired, bool isMarginOrder)',
    'function getOrderBookDepth(uint256 levels) external view returns (uint256[] bidPrices, uint256[] bidAmounts, uint256[] askPrices, uint256[] askAmounts)',
    'function bestBid() external view returns (uint256)',
    'function bestAsk() external view returns (uint256)',
    'function getBestPrices() external view returns (uint256 bidPrice, uint256 askPrice)'
  ] as const);

  private async ensureContractAvailable(address: Address): Promise<boolean> {
    try {
      // Check that bytecode exists at the target address on the configured network
      // Many BAD_DATA decode errors are caused by pointing at the wrong chain or a non-contract address
      const bytecode = await this.client.getBytecode({ address });
      return !!bytecode && bytecode !== '0x';
    } catch {
      return false;
    }
  }

  /**
   * Dynamically resolve OrderBook contract address for a given metricId with caching
   */
  private resolveOrderBookAddress(metricId?: string): Address {
    if (!metricId) {
      console.log('⚠️ No metricId provided, using aluminum OrderBook as fallback');
      return CONTRACT_ADDRESSES.aluminumOrderBook;
    }

    // Check cache first
    const cached = this.addressCache.get(metricId);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      console.log('✅ OrderService: Using cached OrderBook address:', { metricId, address: cached.address });
      return cached.address;
    }

    // Lookup in hardcoded MARKET_INFO config
    const marketInfo = CONTRACT_ADDRESSES.MARKET_INFO[metricId];
    const address = marketInfo?.orderBook ?? CONTRACT_ADDRESSES.aluminumOrderBook;
    if (!marketInfo) {
      console.warn(`⚠️ OrderService: No MARKET_INFO found for metricId: ${metricId}, falling back to aluminum OrderBook`);
    }

    // Cache the resolved address
    this.addressCache.set(metricId, { address, timestamp: Date.now() });
    console.log('✅ OrderService: Resolved OrderBook address from config:', { metricId, address });
    return address;
  }

  /**
   * Get a specific order by ID from the appropriate OrderBook contract
   */
  async getOrder(orderId: bigint, metricId?: string): Promise<Order | null> {
    try {
      // Dynamically resolve OrderBook address based on metricId
      const orderBookAddress = this.resolveOrderBookAddress(metricId);
      
      console.log('🔍 OrderService: Getting order from dynamic OrderBook:', {
        orderId: orderId.toString(),
        metricId,
        orderBookAddress,
        note: 'Using dynamic OrderBook resolution'
      });
      // Guard: ensure contract exists on configured network
      const exists = await this.ensureContractAvailable(orderBookAddress);
      if (!exists) {
        console.warn('⚠️ OrderService: OrderBook not deployed on configured network, skipping getOrder');
        return null;
      }
      const result = await this.client.readContract({
        address: orderBookAddress,
        abi: this.ORDERBOOK_ABI,
        functionName: 'getOrder',
        args: [orderId],
      });

      return this.transformObOrderArray(result as any[], metricId);
    } catch (error) {
      console.error('❌ OrderService: Error fetching order from OrderBook:', error);
      return null;
    }
  }

  /**
   * Get all active orders for a user
   * Uses dynamic OrderBook contract resolution based on metricId
   */
  async getUserActiveOrders(trader: Address, metricId?: string): Promise<Order[]> {
    try {
      console.log('🔍 OrderService: Getting user active orders using dynamic OrderBook approach for trader:', trader);
      
      // Use the dynamic OrderBook-based approach
      const allOrders = await this.getUserOrdersFromOrderBook(trader, metricId);
      
      // Filter for only active orders (pending or partially filled)
      const activeOrders = allOrders.filter(order => 
        order.status === 'pending' || order.status === 'partially_filled'
      );
      
      console.log('📊 OrderService: Filtered active orders:', {
        totalOrders: allOrders.length,
        activeOrders: activeOrders.length,
        trader
      });
      
      return activeOrders;
    } catch (error) {
      console.error('❌ OrderService: Error fetching user active orders:', error);
      return [];
    }
  }

  /**
   * Get user orders from the appropriate OrderBook contract (dynamic resolution)
   * This is the preferred method for getting detailed order information
   */
  async getUserOrdersFromOrderBook(trader: Address, metricId?: string): Promise<Order[]> {
    try {
      // Dynamically resolve OrderBook address based on metricId
      const orderBookAddress = this.resolveOrderBookAddress(metricId);
      
      console.log('🔍 OrderService: Getting user orders from dynamic OrderBook:', {
        trader,
        metricId,
        orderBookAddress,
        note: 'Using dynamic OrderBook resolution'
      });
      // Guard: ensure contract exists on configured network
      const exists = await this.ensureContractAvailable(orderBookAddress);
      if (!exists) {
        console.warn('⚠️ OrderService: OrderBook not deployed on configured network, returning empty orders');
        return [];
      }
      // OrderBook.getUserOrders returns array of order IDs (bytes32[])
      const orderIds = await this.client.readContract({
        address: orderBookAddress,
        abi: this.ORDERBOOK_ABI,
        functionName: 'getUserOrders',
        args: [trader],
      }) as readonly bigint[];

      console.log('📊 OrderService: OrderBook getUserOrders result:', {
        orderIdsCount: orderIds.length,
        orderIds: orderIds.slice(0, 3), // Log first 3 IDs
        metricId
      });

      // For each order ID, fetch the full order details
      const orders: Order[] = [];
      for (const orderId of orderIds) {
        try {
          const order = await this.getOrder(orderId, metricId);
          if (order) {
            console.log(`✅ OrderService: Successfully transformed order ${order.id} with metricId="${order.metricId}"`);
            orders.push(order);
          } else {
            console.warn(`⚠️ OrderService: getOrder returned null for orderId ${orderId}`);
          }
        } catch (error) {
          console.warn('⚠️ OrderService: Failed to fetch order details for ID:', orderId, error);
        }
      }
      
      console.log('📊 OrderService: Successfully fetched detailed orders:', {
        totalOrders: orders.length,
        ordersWithCorrectMetricId: orders.filter(o => o.metricId === metricId).length,
        orderSummary: orders.map(o => ({ id: o.id, metricId: o.metricId, status: o.status })),
        expectedMetricId: metricId
      });
      return orders;
    } catch (error: any) {
      const msg = error?.message || '';
      // Handle common decode/call errors gracefully to avoid UI crashes
      if (msg.includes('could not decode result data') || msg.includes('ContractFunctionExecutionError')) {
        console.warn('⚠️ OrderService: getUserOrders call failed (likely wrong network or facet missing). Returning empty list.');
        return [];
      }
      console.error('❌ OrderService: Unexpected error fetching user orders from OrderBook:', error);
      return [];
    }
  }

  /**
   * Get order history for a user with pagination
   * Uses dynamic OrderBook resolution based on metricId
   */
  async getUserOrderHistory(trader: Address, limit: number = 50, offset: number = 0, metricId?: string): Promise<Order[]> {
    try {
      console.log('🔍 OrderService: Getting user order history using dynamic OrderBook approach:', {
        trader,
        limit,
        offset,
        metricId
      });
      
      // Get all orders from dynamic OrderBook and apply pagination manually
      const allOrders = await this.getUserOrdersFromOrderBook(trader, metricId);
      
      // Sort by timestamp descending (most recent first)
      const sortedOrders = allOrders.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      // Apply pagination
      const paginatedOrders = sortedOrders.slice(offset, offset + limit);
      
      console.log('📊 OrderService: Order history result:', {
        totalOrders: allOrders.length,
        returnedOrders: paginatedOrders.length,
        offset,
        limit
      });
      
      return paginatedOrders;
    } catch (error) {
      console.error('❌ OrderService: Error fetching user order history:', error);
      return [];
    }
  }

  /**
   * Get market depth (order book) for a specific metric
   */
  async getMarketDepth(metricId: string, depth: number = 15): Promise<MarketDepth> {
    try {
      // Use OrderBook address instead of orderRouter
      const orderBookAddress = this.resolveOrderBookAddress(metricId);
      
      console.log('🔍 OrderService: Getting market depth from OrderBook:', {
        metricId,
        depth,
        orderBookAddress,
        note: 'Using OrderBook.getOrderBookDepth instead of TradingRouter'
      });
      // Guard: ensure contract exists on configured network
      const exists = await this.ensureContractAvailable(orderBookAddress);
      if (!exists) {
        console.warn('⚠️ OrderService: OrderBook not deployed on configured network, returning empty depth');
        return { bids: [], asks: [], spread: 0, midPrice: 0 };
      }
      const result = await this.client.readContract({
        address: orderBookAddress,
        abi: this.ORDERBOOK_ABI,
        functionName: 'getOrderBookDepth',
        args: [BigInt(depth)],
      });

      // getOrderBookDepth returns [bidPrices[], bidSizes[], askPrices[], askSizes[]]
      const [bidPrices, bidSizes, askPrices, askSizes] = result as [bigint[], bigint[], bigint[], bigint[]];
      
      // Convert to OrderBookEntry format
      const bids: OrderBookEntry[] = bidPrices.map((price, index) => ({
        id: `bid_${index}`,
        price: Number(formatUnits(price, 6)), // PRICE_PRECISION = 1e6
        quantity: Number(formatUnits(bidSizes[index], 6)),
        total: Number(formatUnits(price * bidSizes[index], 12)), // price * size with precision adjustment
        side: 'bid' as const,
        timestamp: Date.now(),
        trader: '0x0000000000000000000000000000000000000000' as Address
      })).filter(entry => entry.price > 0 && entry.quantity > 0);

      const asks: OrderBookEntry[] = askPrices.map((price, index) => ({
        id: `ask_${index}`,
        price: Number(formatUnits(price, 6)), // PRICE_PRECISION = 1e6
        quantity: Number(formatUnits(askSizes[index], 6)),
        total: Number(formatUnits(price * askSizes[index], 12)), // price * size with precision adjustment
        side: 'ask' as const,
        timestamp: Date.now(),
        trader: '0x0000000000000000000000000000000000000000' as Address
      })).filter(entry => entry.price > 0 && entry.quantity > 0);

      // Calculate spread and mid price
      const bestBid = bids.length > 0 ? Math.max(...bids.map(b => b.price)) : 0;
      const bestAsk = asks.length > 0 ? Math.min(...asks.map(a => a.price)) : 0;
      const spread = bestAsk - bestBid;
      const midPrice = (bestBid + bestAsk) / 2;

      console.log(`✅ Successfully fetched market depth for ${metricId}: ${bids.length} bids, ${asks.length} asks`);

      return {
        bids: bids.sort((a, b) => b.price - a.price), // Highest first
        asks: asks.sort((a, b) => a.price - b.price), // Lowest first
        spread,
        midPrice,
      };
    } catch (error) {
      // Enhanced error handling for different types of contract errors
      if (error instanceof Error) {
        if (error.message.includes('Market not registered')) {
          console.warn(`⚠️ Market ${metricId} is not registered in OrderRouter contract`);
          console.warn('💡 This market exists in your database but has not been deployed to the blockchain yet');
          console.warn('💡 To deploy this market, use the deployment scripts in the orderbook-dex directory');
        } else if (error.message.includes('ContractFunctionExecutionError')) {
          console.warn(`⚠️ Contract function execution failed for ${metricId}:`, error.message);
        } else {
          console.error(`❌ Unexpected error fetching market depth for ${metricId}:`, error);
        }
      } else {
        console.error(`❌ Unknown error fetching market depth for ${metricId}:`, error);
      }
      
      // Always return empty market depth to prevent UI crashes
      return {
        bids: [],
        asks: [],
        spread: 0,
        midPrice: 0,
      };
    }
  }

  /**
   * Get trade executions for a specific order
   */
  async getOrderExecutions(orderId: bigint): Promise<TradeExecution[]> {
    try {
      const result = await this.client.readContract({
        address: CONTRACT_ADDRESSES.orderRouter,
        abi: ORDER_ROUTER_ABI,
        functionName: 'getOrderExecutions',
        args: [orderId],
      });

      return result as TradeExecution[];
    } catch (error) {
      console.error('Error fetching order executions:', error);
      return [];
    }
  }

  /**
   * Get all orders for a specific metric (combines active and recent history)
   */
  async getMetricOrders(metricId: string, limit: number = 100): Promise<Order[]> {
    try {
      // For now, we'll get market depth which gives us active orders
      // In a full implementation, you might want to add a separate contract method
      // or use event logs to get all orders for a metric
      const marketDepth = await this.getMarketDepth(metricId, limit);
      
      // Convert order book entries back to orders (this is a simplified approach)
      const allOrders: Order[] = [];
      
      // Add bid orders
      marketDepth.bids.forEach(bid => {
        allOrders.push({
          id: bid.id,
          trader: bid.trader || '0x0000000000000000000000000000000000000000',
          metricId,
          type: 'limit',
          side: 'buy',
          quantity: bid.quantity,
          price: bid.price,
          filledQuantity: 0,
          timestamp: bid.timestamp,
          expiryTime: null,
          status: 'pending',
          timeInForce: 'gtc',
          stopPrice: null,
          icebergQty: null,
          postOnly: false,
        });
      });

      // Add ask orders
      marketDepth.asks.forEach(ask => {
        allOrders.push({
          id: ask.id,
          trader: ask.trader || '0x0000000000000000000000000000000000000000',
          metricId,
          type: 'limit',
          side: 'sell',
          quantity: ask.quantity,
          price: ask.price,
          filledQuantity: 0,
          timestamp: ask.timestamp,
          expiryTime: null,
          status: 'pending',
          timeInForce: 'gtc',
          stopPrice: null,
          icebergQty: null,
          postOnly: false,
        });
      });

      return allOrders.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Error fetching metric orders:', error);
      return [];
    }
  }

  /**
   * Transform contract order to UI order format
   * Handles the actual contract response structure which differs from ContractOrder interface
   */
  /**
   * Transform contract order from array format (used by orders mapping)
   */
  private transformContractOrderArray(orderArray: any[], metricId?: string): Order {
    if (!orderArray || !Array.isArray(orderArray) || orderArray.length < 12) {
      throw new Error('Invalid contract order array: expected array with at least 12 elements');
    }

    const [
      id,
      user,
      size,
      price,
      side,
      orderType,
      timeInForce,
      expiryTime,
      filledSize,
      createdTime,
      updatedTime,
      status
    ] = orderArray;

    // Convert enum values to strings
    const orderTypeString = orderType === 0 ? 'market' : 'limit';
    const sideString = side === 0 ? 'buy' : 'sell';
    const statusString = status === 0 ? 'pending' : status === 1 ? 'filled' : status === 2 ? 'cancelled' : 'partially_filled';
    const timeInForceString = timeInForce === 0 ? 'gtc' : 'ioc';

    // Convert from wei to standard units (assuming 6 decimals for price and size)
    const quantity = size ? parseFloat(formatUnits(BigInt(size), 6)) : 0;
    const priceFormatted = price ? parseFloat(formatUnits(BigInt(price), 6)) : 0;
    const filledQuantity = filledSize ? parseFloat(formatUnits(BigInt(filledSize), 6)) : 0;

    console.log('🔧 OrderService: Transforming contract order array:', {
      id: id.toString(),
      user,
      size: size.toString(),
      price: price.toString(),
      side: `${side} (${sideString})`,
      orderType: `${orderType} (${orderTypeString})`,
      status: `${status} (${statusString})`,
      quantity,
      priceFormatted,
      filledQuantity,
      metricId
    });

    return {
      id: id.toString(),
      trader: user as Address,
      metricId: metricId || 'unknown',
      type: orderTypeString,
      side: sideString,
      quantity,
      price: priceFormatted,
      filledQuantity,
      timestamp: Number(createdTime) * 1000,
      expiryTime: Number(expiryTime) > 0 ? Number(expiryTime) * 1000 : null,
      status: statusString,
      timeInForce: timeInForceString,
      stopPrice: null,
      icebergQty: null,
      postOnly: false,
    };
  }

  /**
   * Transform OrderBookStorage.Order (facet getOrder) array to UI Order
   */
  private transformObOrderArray(orderArray: any[], metricId?: string): Order {
    if (!orderArray || !Array.isArray(orderArray) || orderArray.length < 9) {
      throw new Error('Invalid OB order array: expected array with 9 elements');
    }

    const [
      orderId,
      trader,
      price,
      amount,
      isBuy,
      timestamp,
      /* nextOrderId */ ,
      /* marginRequired */ ,
      /* isMarginOrder */
    ] = orderArray;

    const quantity = amount ? parseFloat(formatUnits(BigInt(amount), 6)) : 0;
    const priceFormatted = price ? parseFloat(formatUnits(BigInt(price), 6)) : 0;

    return {
      id: orderId.toString(),
      trader: trader as Address,
      metricId: metricId || 'unknown',
      type: 'limit',
      side: isBuy ? 'buy' : 'sell',
      quantity,
      price: priceFormatted,
      filledQuantity: 0,
      timestamp: Number(timestamp) * 1000,
      expiryTime: null,
      status: 'pending',
      timeInForce: 'gtc',
      stopPrice: null,
      icebergQty: null,
      postOnly: false,
    };
  }

  private transformContractOrder(contractOrder: ActualContractOrder | any, metricId?: string): Order {
    // Add null checks for all required properties
    if (!contractOrder || typeof contractOrder !== 'object') {
      throw new Error('Invalid contract order: order is null or not an object');
    }

    // Check for required properties with proper error messages
    if (!contractOrder.orderId) {
      throw new Error('Invalid contract order: missing orderId');
    }
    if (contractOrder.orderType === undefined || contractOrder.orderType === null) {
      throw new Error('Invalid contract order: missing orderType');
    }
    if (contractOrder.side === undefined || contractOrder.side === null) {
      throw new Error('Invalid contract order: missing side');
    }
    if (contractOrder.status === undefined || contractOrder.status === null) {
      throw new Error('Invalid contract order: missing status');
    }

    // Handle the actual contract response structure
    // The contract returns: size, filled, user instead of quantity, filledQuantity, trader
    const size = contractOrder.size || contractOrder.quantity || 0n;
    const filled = contractOrder.filled || contractOrder.filledQuantity || 0n;
    const trader = contractOrder.user || contractOrder.trader || '0x0000000000000000000000000000000000000000';
    const price = contractOrder.price || 0n;
    const timestamp = contractOrder.timestamp || 0n;

    const orderType = this.getOrderTypeString(contractOrder.orderType);
    const side = contractOrder.side === OrderSide.BUY ? 'buy' : 'sell';
    const status = this.getOrderStatusString(contractOrder.status);
    
    // Default timeInForce since it's not in the contract response
    const timeInForce = this.getTimeInForceString(contractOrder.timeInForce || 0);

    // Convert from wei to standard units (assuming 6 decimals for price and size based on contract precision)
    const quantity = size ? parseFloat(formatUnits(size, 6)) : 0;
    const priceFormatted = price ? parseFloat(formatUnits(price, 6)) : 0;
    const filledQuantity = filled ? parseFloat(formatUnits(filled, 6)) : 0;

    return {
      id: contractOrder.orderId.toString(),
      trader: trader as Address,
      metricId: metricId || contractOrder.metricId || 'unknown', // Use passed metricId or fallback
      type: orderType,
      side,
      quantity,
      price: priceFormatted,
      filledQuantity,
      timestamp: Number(timestamp) * 1000, // Convert to milliseconds
      expiryTime: null, // Not provided by contract
      status,
      timeInForce,
      stopPrice: null, // Not provided by contract
      icebergQty: null, // Not provided by contract
      postOnly: false, // Not provided by contract
    };
  }

  /**
   * Transform contract order to order book entry
   */
  private transformToOrderBookEntry(contractOrder: any, side: 'bid' | 'ask'): OrderBookEntry {
    // Handle both ContractOrder interface and actual contract response
    const size = contractOrder.size || contractOrder.quantity || 0n;
    const price = contractOrder.price || 0n;
    const trader = contractOrder.user || contractOrder.trader || '0x0000000000000000000000000000000000000000';
    const timestamp = contractOrder.timestamp || 0n;
    const orderId = contractOrder.orderId || '0';

    const quantity = size ? parseFloat(formatUnits(size, 6)) : 0;
    const priceFormatted = price ? parseFloat(formatUnits(price, 6)) : 0;
    
    return {
      id: orderId.toString(),
      price: priceFormatted,
      quantity,
      total: priceFormatted * quantity,
      side,
      timestamp: Number(timestamp) * 1000,
      trader: trader as Address,
    };
  }

  /**
   * Transform orders to legacy transaction format for backward compatibility
   */
  transformOrdersToTransactions(orders: Order[]): Transaction[] {
    return orders
      .filter(order => order.status === 'filled' || order.status === 'partially_filled')
      .map(order => ({
        id: order.id,
        type: order.side === 'buy' ? 'long' : 'short',
        amount: order.quantity,
        price: order.price,
        timestamp: order.timestamp,
        pnl: this.calculatePnL(order), // This would need current market price
        status: order.status === 'filled' ? 'closed' : 'open',
        leverage: 1, // Default leverage, would need to be calculated from contract
        fees: order.fees || 0,
      })) as Transaction[];
  }

  /**
   * Helper methods for enum conversion
   */
  private getOrderTypeString(orderType: number): Order['type'] {
    switch (orderType) {
      case OrderType.MARKET: return 'market';
      case OrderType.LIMIT: return 'limit';
      case OrderType.STOP_LOSS: return 'stop_loss';
      case OrderType.TAKE_PROFIT: return 'take_profit';
      case OrderType.STOP_LIMIT: return 'stop_limit';
      case OrderType.ICEBERG: return 'iceberg';
      case OrderType.FILL_OR_KILL: return 'fill_or_kill';
      case OrderType.IMMEDIATE_OR_CANCEL: return 'immediate_or_cancel';
      case OrderType.ALL_OR_NONE: return 'all_or_none';
      default: return 'limit';
    }
  }

  private getOrderStatusString(status: number): Order['status'] {
    switch (status) {
      case OrderStatus.PENDING: return 'pending';
      case OrderStatus.PARTIALLY_FILLED: return 'partially_filled';
      case OrderStatus.FILLED: return 'filled';
      case OrderStatus.CANCELLED: return 'cancelled';
      case OrderStatus.EXPIRED: return 'expired';
      case OrderStatus.REJECTED: return 'rejected';
      default: return 'pending';
    }
  }

  private getTimeInForceString(timeInForce: number): Order['timeInForce'] {
    switch (timeInForce) {
      case TimeInForce.GTC: return 'gtc';
      case TimeInForce.IOC: return 'ioc';
      case TimeInForce.FOK: return 'fok';
      case TimeInForce.GTD: return 'gtd';
      default: return 'gtc';
    }
  }

  /**
   * Calculate P&L for an order (simplified - would need current market price)
   */
  private calculatePnL(order: Order): number {
    // This is a placeholder - in reality you'd need current market price
    // and more complex calculations for unrealized vs realized P&L
    if (order.status !== 'filled') return 0;
    
    // Mock calculation for demonstration
    return (order.filledQuantity * order.price * 0.02) * (order.side === 'buy' ? 1 : -1);
  }
}

// Export singleton instance
export const orderService = new OrderService();
