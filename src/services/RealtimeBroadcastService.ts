import { WebSocketService } from './WebSocketService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { Redis } from 'ioredis';

interface OrderBookUpdate {
  metricId: string;
  bids: Array<{ price: string; quantity: string; total: string }>;
  asks: Array<{ price: string; quantity: string; total: string }>;
  bestBid: string | null;
  bestAsk: string | null;
  spread: string | null;
  timestamp: number;
}

interface TradeUpdate {
  metricId: string;
  tradeId: string;
  price: string;
  quantity: string;
  totalValue: string;
  side: 'BUY' | 'SELL';
  timestamp: number;
  buyerFee: string;
  sellerFee: string;
}

interface OrderUpdate {
  orderId: string;
  metricId: string;
  trader: string;
  orderType: 'MARKET' | 'LIMIT';
  side: 'BUY' | 'SELL';
  status: string;
  filledQuantity: string;
  remainingQuantity: string;
  averageFillPrice?: string;
  timestamp: number;
}

interface MarketStatsUpdate {
  metricId: string;
  volume24h: string;
  totalTrades: number;
  openInterestLong: string;
  openInterestShort: string;
  lastTradePrice: string;
  priceChange24h: string;
  priceChangePercentage24h: string;
  timestamp: number;
}

export class RealtimeBroadcastService {
  private wsService: WebSocketService;
  private redis: Redis;
  private isRunning = false;
  private updateQueues: Map<string, any[]> = new Map();
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly BATCH_DELAY = 100; // 100ms batching
  private readonly MAX_BATCH_SIZE = 50;

  constructor(wsService: WebSocketService, redisUrl: string) {
    this.wsService = wsService;
    this.redis = new Redis(redisUrl);
  }

  /**
   * Start the real-time broadcast service
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('🚀 Starting Realtime Broadcast Service...');

    // Setup Redis subscribers for different update types
    await this.setupRedisSubscribers();
    
    this.isRunning = true;
    console.log('✅ Realtime Broadcast Service started');
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('🛑 Stopping Realtime Broadcast Service...');

    // Clear all batch timers
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();

    // Disconnect Redis
    await this.redis.disconnect();
    
    this.isRunning = false;
    console.log('✅ Realtime Broadcast Service stopped');
  }

  /**
   * Setup Redis subscribers for different event types
   */
  private async setupRedisSubscribers(): Promise<void> {
    // Subscribe to order book updates
    this.redis.subscribe('orderbook_updates', (err) => {
      if (err) console.error('Failed to subscribe to orderbook_updates:', err);
    });

    // Subscribe to trade updates  
    this.redis.subscribe('trade_updates', (err) => {
      if (err) console.error('Failed to subscribe to trade_updates:', err);
    });

    // Subscribe to order updates
    this.redis.subscribe('order_updates', (err) => {
      if (err) console.error('Failed to subscribe to order_updates:', err);
    });

    // Subscribe to market stats updates
    this.redis.subscribe('market_stats_updates', (err) => {
      if (err) console.error('Failed to subscribe to market_stats_updates:', err);
    });

    // Handle incoming Redis messages
    this.redis.on('message', async (channel, message) => {
      try {
        const data = JSON.parse(message);
        await this.handleRedisMessage(channel, data);
      } catch (error) {
        console.error(`Error processing Redis message from ${channel}:`, error);
      }
    });
  }

  /**
   * Handle incoming Redis messages and route to appropriate handlers
   */
  private async handleRedisMessage(channel: string, data: any): Promise<void> {
    switch (channel) {
      case 'orderbook_updates':
        await this.handleOrderBookUpdate(data);
        break;
      case 'trade_updates':
        await this.handleTradeUpdate(data);
        break;
      case 'order_updates':
        await this.handleOrderUpdate(data);
        break;
      case 'market_stats_updates':
        await this.handleMarketStatsUpdate(data);
        break;
      default:
        console.warn(`Unknown Redis channel: ${channel}`);
    }
  }

  /**
   * Handle order book updates with batching
   */
  private async handleOrderBookUpdate(update: OrderBookUpdate): Promise<void> {
    const channel = `orderbook:${update.metricId}`;
    
    // Add to batch queue
    this.addToBatch(channel, update);
    
    // Schedule batch processing
    this.scheduleBatchProcess(channel, () => {
      const updates = this.updateQueues.get(channel) || [];
      if (updates.length === 0) return;

      // Take the latest update (most recent order book state)
      const latestUpdate = updates[updates.length - 1];
      
      // Broadcast to all subscribers
      this.wsService.broadcast(channel, {
        type: 'orderbook_update',
        data: latestUpdate
      });

      // Clear the batch
      this.updateQueues.set(channel, []);
    });
  }

  /**
   * Handle trade updates
   */
  private async handleTradeUpdate(update: TradeUpdate): Promise<void> {
    const marketChannel = `trades:${update.metricId}`;
    const globalChannel = 'trades:all';
    
    const tradeData = {
      type: 'trade_update',
      data: update
    };

    // Broadcast to market-specific channel
    this.wsService.broadcast(marketChannel, tradeData);
    
    // Broadcast to global trades channel
    this.wsService.broadcast(globalChannel, tradeData);

    // Update market ticker data
    await this.updateMarketTicker(update.metricId, update);
  }

  /**
   * Handle order updates (for authenticated users)
   */
  private async handleOrderUpdate(update: OrderUpdate): Promise<void> {
    // Broadcast to user-specific channel
    const userChannel = `orders:${update.trader}`;
    
    this.wsService.broadcast(userChannel, {
      type: 'order_update',
      data: update
    });

    // If order is filled or partially filled, also broadcast to market channel
    if (['FILLED', 'PARTIALLY_FILLED'].includes(update.status)) {
      const marketChannel = `orders:${update.metricId}`;
      
      this.wsService.broadcast(marketChannel, {
        type: 'order_filled',
        data: {
          metricId: update.metricId,
          side: update.side,
          filledQuantity: update.filledQuantity,
          averageFillPrice: update.averageFillPrice,
          timestamp: update.timestamp
        }
      });
    }
  }

  /**
   * Handle market statistics updates
   */
  private async handleMarketStatsUpdate(update: MarketStatsUpdate): Promise<void> {
    const channel = `market_stats:${update.metricId}`;
    
    // Add to batch queue for market stats
    this.addToBatch(channel, update);
    
    // Schedule batch processing (less frequent for stats)
    this.scheduleBatchProcess(channel, () => {
      const updates = this.updateQueues.get(channel) || [];
      if (updates.length === 0) return;

      // Aggregate stats from multiple updates
      const aggregatedStats = this.aggregateMarketStats(updates);
      
      // Broadcast aggregated stats
      this.wsService.broadcast(channel, {
        type: 'market_stats_update',
        data: aggregatedStats
      });

      // Also broadcast to global market overview
      this.wsService.broadcast('market_overview', {
        type: 'market_stats_update',
        data: aggregatedStats
      });

      // Clear the batch
      this.updateQueues.set(channel, []);
    }, 1000); // 1 second batching for stats
  }

  /**
   * Update market ticker with latest trade
   */
  private async updateMarketTicker(metricId: string, trade: TradeUpdate): Promise<void> {
    try {
      // Get current market data
      const { data: market } = await supabaseAdmin
        .from('orderbook_markets')
        .select('total_volume, total_trades, last_trade_price')
        .eq('metric_id', metricId)
        .single();

      if (!market) return;

      // Calculate price change
      const currentPrice = parseFloat(trade.price);
      const lastPrice = parseFloat(market.last_trade_price || trade.price);
      const priceChange = currentPrice - lastPrice;
      const priceChangePercentage = lastPrice > 0 ? (priceChange / lastPrice) * 100 : 0;

      // Update market in database
      await supabaseAdmin
        .from('orderbook_markets')
        .update({
          last_trade_price: trade.price,
          total_volume: (parseFloat(market.total_volume || '0') + parseFloat(trade.totalValue)).toString(),
          total_trades: (market.total_trades || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq('metric_id', metricId);

      // Broadcast ticker update
      this.wsService.broadcast(`ticker:${metricId}`, {
        type: 'ticker_update',
        data: {
          metricId,
          lastPrice: trade.price,
          priceChange: priceChange.toString(),
          priceChangePercentage: `${priceChangePercentage.toFixed(2)}%`,
          volume24h: trade.totalValue, // This should be calculated properly
          timestamp: trade.timestamp
        }
      });

    } catch (error) {
      console.error('Error updating market ticker:', error);
    }
  }

  /**
   * Add update to batch queue
   */
  private addToBatch(channel: string, update: any): void {
    if (!this.updateQueues.has(channel)) {
      this.updateQueues.set(channel, []);
    }
    
    const queue = this.updateQueues.get(channel)!;
    queue.push(update);
    
    // Limit batch size
    if (queue.length > this.MAX_BATCH_SIZE) {
      queue.shift(); // Remove oldest update
    }
  }

  /**
   * Schedule batch processing with debouncing
   */
  private scheduleBatchProcess(
    channel: string, 
    processor: () => void, 
    delay: number = this.BATCH_DELAY
  ): void {
    // Clear existing timer
    const existingTimer = this.batchTimers.get(channel);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Schedule new processing
    const timer = setTimeout(() => {
      processor();
      this.batchTimers.delete(channel);
    }, delay);
    
    this.batchTimers.set(channel, timer);
  }

  /**
   * Aggregate multiple market stats updates
   */
  private aggregateMarketStats(updates: MarketStatsUpdate[]): MarketStatsUpdate {
    if (updates.length === 0) {
      throw new Error('No updates to aggregate');
    }
    
    // Take the latest update as base
    const latest = updates[updates.length - 1];
    
    // For now, just return the latest
    // In a more sophisticated implementation, you might aggregate volume, etc.
    return latest;
  }

  /**
   * Manually trigger order book broadcast (for external services)
   */
  async broadcastOrderBookUpdate(metricId: string, orderBook: OrderBookUpdate): Promise<void> {
    await this.handleOrderBookUpdate(orderBook);
  }

  /**
   * Manually trigger trade broadcast (for external services)
   */
  async broadcastTradeUpdate(trade: TradeUpdate): Promise<void> {
    await this.handleTradeUpdate(trade);
  }

  /**
   * Manually trigger order broadcast (for external services)
   */
  async broadcastOrderUpdate(order: OrderUpdate): Promise<void> {
    await this.handleOrderUpdate(order);
  }

  /**
   * Get current service metrics
   */
  getMetrics() {
    return {
      isRunning: this.isRunning,
      activeChannels: this.updateQueues.size,
      pendingBatches: this.batchTimers.size,
      totalQueuedUpdates: Array.from(this.updateQueues.values())
        .reduce((sum, queue) => sum + queue.length, 0)
    };
  }

  /**
   * Health check
   */
  async getHealth() {
    return {
      status: this.isRunning ? 'healthy' : 'stopped',
      redis: this.redis.status,
      metrics: this.getMetrics(),
      lastUpdate: Date.now()
    };
  }
}

