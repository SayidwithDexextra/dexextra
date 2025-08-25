import { Address, formatUnits } from 'viem';
import { publicClient } from './viemClient';
import { CONTRACT_ADDRESSES, ORDER_ROUTER_ABI, OrderType, OrderSide, OrderStatus, TimeInForce } from './contractConfig';
import { ContractOrder, Order, OrderBookEntry, MarketDepth, TradeExecution, Transaction } from '@/types/orders';

/**
 * Service for interacting with OrderRouter smart contract using Viem
 */
export class OrderService {
  private client = publicClient;



  /**
   * Get a specific order by ID
   */
  async getOrder(orderId: bigint): Promise<Order | null> {
    try {
      const result = await this.client.readContract({
        address: CONTRACT_ADDRESSES.orderRouter,
        abi: ORDER_ROUTER_ABI,
        functionName: 'getOrder',
        args: [orderId],
      });

      return this.transformContractOrder(result as ContractOrder);
    } catch (error) {
      console.error('Error fetching order:', error);
      return null;
    }
  }

  /**
   * Get all active orders for a user
   */
  async getUserActiveOrders(trader: Address): Promise<Order[]> {
    try {
      const result = await this.client.readContract({
        address: CONTRACT_ADDRESSES.orderRouter,
        abi: ORDER_ROUTER_ABI,
        functionName: 'getUserActiveOrders',
        args: [trader],
      });

      return (result as ContractOrder[]).map(order => this.transformContractOrder(order));
    } catch (error) {
      console.error('Error fetching user active orders:', error);
      return [];
    }
  }

  /**
   * Get order history for a user with pagination
   */
  async getUserOrderHistory(trader: Address, limit: number = 50, offset: number = 0): Promise<Order[]> {
    try {
      const result = await this.client.readContract({
        address: CONTRACT_ADDRESSES.orderRouter,
        abi: ORDER_ROUTER_ABI,
        functionName: 'getUserOrderHistory',
        args: [trader, BigInt(limit), BigInt(offset)],
      });

      return (result as ContractOrder[]).map(order => this.transformContractOrder(order));
    } catch (error) {
      console.error('Error fetching user order history:', error);
      return [];
    }
  }

  /**
   * Get market depth (order book) for a specific metric
   */
  async getMarketDepth(metricId: string, depth: number = 15): Promise<MarketDepth> {
    try {
      const result = await this.client.readContract({
        address: CONTRACT_ADDRESSES.orderRouter,
        abi: ORDER_ROUTER_ABI,
        functionName: 'getMarketDepth',
        args: [metricId, BigInt(depth)],
      });

      const [buyOrders, sellOrders] = result as [ContractOrder[], ContractOrder[]];
      
      const bids = buyOrders.map(order => this.transformToOrderBookEntry(order, 'bid'));
      const asks = sellOrders.map(order => this.transformToOrderBookEntry(order, 'ask'));

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
   */
  private transformContractOrder(contractOrder: ContractOrder): Order {
    const orderType = this.getOrderTypeString(contractOrder.orderType);
    const side = contractOrder.side === OrderSide.BUY ? 'buy' : 'sell';
    const status = this.getOrderStatusString(contractOrder.status);
    const timeInForce = this.getTimeInForceString(contractOrder.timeInForce);

    // Convert from wei to standard units (assuming 18 decimals for price and quantity)
    const quantity = parseFloat(formatUnits(contractOrder.quantity, 18));
    const price = parseFloat(formatUnits(contractOrder.price, 18));
    const filledQuantity = parseFloat(formatUnits(contractOrder.filledQuantity, 18));

    return {
      id: contractOrder.orderId.toString(),
      trader: contractOrder.trader,
      metricId: contractOrder.metricId,
      type: orderType,
      side,
      quantity,
      price,
      filledQuantity,
      timestamp: Number(contractOrder.timestamp) * 1000, // Convert to milliseconds
      expiryTime: contractOrder.expiryTime > 0n ? Number(contractOrder.expiryTime) * 1000 : null,
      status,
      timeInForce,
      stopPrice: contractOrder.stopPrice > 0n ? parseFloat(formatUnits(contractOrder.stopPrice, 18)) : null,
      icebergQty: contractOrder.icebergQty > 0n ? parseFloat(formatUnits(contractOrder.icebergQty, 18)) : null,
      postOnly: contractOrder.postOnly,
    };
  }

  /**
   * Transform contract order to order book entry
   */
  private transformToOrderBookEntry(contractOrder: ContractOrder, side: 'bid' | 'ask'): OrderBookEntry {
    const quantity = parseFloat(formatUnits(contractOrder.quantity, 18));
    const price = parseFloat(formatUnits(contractOrder.price, 18));
    
    return {
      id: contractOrder.orderId.toString(),
      price,
      quantity,
      total: price * quantity,
      side,
      timestamp: Number(contractOrder.timestamp) * 1000,
      trader: contractOrder.trader,
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
