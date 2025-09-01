import PusherJS from 'pusher-js';
import { 
  PriceUpdateEvent, 
  MarketDataEvent, 
  TradingEvent, 
  TokenTickerEvent, 
  ChartDataEvent 
} from './pusher-server';

// Types for client-side subscriptions
export interface PusherSubscription {
  channel: string;
  events: string[];
  callback: (data: any) => void;
}

export interface PusherClientOptions {
  enableLogging?: boolean;
  activityTimeout?: number;
  pongTimeout?: number;
  maxReconnectionAttempts?: number;
  reconnectionDelay?: number;
}

/**
 * PusherClient - Client-side service for subscribing to real-time updates
 * 
 * This service handles all client-side real-time subscriptions including:
 * - VAMM price updates
 * - Market data changes
 * - Trading events
 * - Token ticker updates
 * - Chart data streaming
 */
export class PusherClientService {
  private pusher: PusherJS;
  private subscriptions: Map<string, any> = new Map();
  private reconnectionAttempts = 0;
  private maxReconnectionAttempts = 5;
  private isConnected = false;
  private connectionStateCallbacks: ((state: string) => void)[] = [];

  constructor(options: PusherClientOptions = {}) {
    // Validate environment variables
    this.validateEnvironment();

    this.pusher = new PusherJS(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2',
      enabledTransports: ['ws', 'wss'],
      activityTimeout: options.activityTimeout || 30000,
      pongTimeout: options.pongTimeout || 6000,
      authEndpoint: '/api/pusher/auth', // For private channels
      authorizer: (channel: any, options: any) => {
        return {
          authorize: (socketId: string, callback: Function) => {
            fetch('/api/pusher/auth', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                socket_id: socketId,
                channel_name: channel.name,
              }),
            })
            .then(response => response.json())
            .then(data => callback(null, data))
            .catch(error => callback(error, null));
          }
        };
      }
    });

    // Enable SDK-level logging to console if requested
    if (options.enableLogging) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - property exists at runtime
      (PusherJS as any).logToConsole = true;
    }

    this.maxReconnectionAttempts = options.maxReconnectionAttempts || 5;
    this.setupConnectionHandlers();

    // Extra debug for connection state
    if (typeof globalThis !== 'undefined') {
      const isDebug = (globalThis as any).PUSHER_DBG || process.env.NODE_ENV === 'development';
      if (isDebug) {
        this.pusher.connection.bind('state_change', (s: any) => {
          // eslint-disable-next-line no-console
           console.log('Pusher-STATE', s.previous + '→' + s.current);
        });
        this.pusher.bind_global((eventName: string, data: any) => {
          // eslint-disable-next-line no-console
           console.log('GLOBAL-EVENT', eventName, data);
        });
      }
    }

     console.log('📱 PusherClientService initialized successfully');
  }

  private validateEnvironment() {
    if (!process.env.NEXT_PUBLIC_PUSHER_KEY) {
      throw new Error('Missing NEXT_PUBLIC_PUSHER_KEY environment variable');
    }
  }

  private setupConnectionHandlers() {
    this.pusher.connection.bind('connected', () => {
      this.isConnected = true;
      this.reconnectionAttempts = 0;
       console.log('🟢 Pusher connected successfully');
      this.notifyConnectionState('connected');
    });

    this.pusher.connection.bind('disconnected', () => {
      this.isConnected = false;
       console.log('🔴 Pusher disconnected');
      this.notifyConnectionState('disconnected');
    });

    this.pusher.connection.bind('error', (error: any) => {
      console.error('❌ Pusher connection error:', error);
      this.notifyConnectionState('error');
    });

    this.pusher.connection.bind('unavailable', () => {
      console.warn('⚠️ Pusher connection unavailable');
      this.notifyConnectionState('unavailable');
    });
  }

  private notifyConnectionState(state: string) {
    this.connectionStateCallbacks.forEach(callback => callback(state));
  }

  /**
   * Subscribe to connection state changes
   */
  onConnectionStateChange(callback: (state: string) => void) {
    this.connectionStateCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.connectionStateCallbacks.indexOf(callback);
      if (index > -1) {
        this.connectionStateCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to price updates for a specific market
   */
  subscribeToPriceUpdates(
    symbol: string, 
    callback: (data: PriceUpdateEvent) => void
  ): () => void {
    const channelName = `market-${symbol}`;
    const eventName = 'price-update';

    if (this.subscriptions.has(channelName)) {
       console.log(`Already subscribed to ${channelName}`);
      return this.subscriptions.get(channelName).unsubscribe;
    }

    const channel = this.pusher.subscribe(channelName);
    
    channel.bind(eventName, (data: PriceUpdateEvent) => {
       console.log(`📈 Price update received for ${symbol}:`, data);
      callback(data);
    });

    const unsubscribe = () => {
      channel.unbind(eventName);
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
       console.log(`🔌 Unsubscribed from ${channelName}`);
    };

    this.subscriptions.set(channelName, { channel, unsubscribe });
     console.log(`✅ Subscribed to price updates for ${symbol}`);

    return unsubscribe;
  }

  /**
   * Subscribe to global price updates (all markets)
   */
  subscribeToGlobalPrices(
    callback: (data: PriceUpdateEvent | { updates: PriceUpdateEvent[] }) => void
  ): () => void {
    const channelName = 'global-prices';

    if (this.subscriptions.has(channelName)) {
       console.log(`Already subscribed to ${channelName}`);
      return this.subscriptions.get(channelName).unsubscribe;
    }

    const channel = this.pusher.subscribe(channelName);
    
    // Single price update
    channel.bind('price-update', (data: PriceUpdateEvent) => {
      callback(data);
    });

    // Batch price updates
    channel.bind('batch-price-update', (data: { updates: PriceUpdateEvent[] }) => {
      callback(data);
    });

    const unsubscribe = () => {
      channel.unbind('price-update');
      channel.unbind('batch-price-update');
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
       console.log(`🔌 Unsubscribed from ${channelName}`);
    };

    this.subscriptions.set(channelName, { channel, unsubscribe });
     console.log(`✅ Subscribed to global price updates`);

    return unsubscribe;
  }

  /**
   * Subscribe to market data updates
   */
  subscribeToMarketData(
    callback: (data: MarketDataEvent) => void
  ): () => void {
    const channelName = 'global-market';
    const eventName = 'market-data-update';

    if (this.subscriptions.has(channelName)) {
       console.log(`Already subscribed to ${channelName}`);
      return this.subscriptions.get(channelName).unsubscribe;
    }

    const channel = this.pusher.subscribe(channelName);
    
    channel.bind(eventName, (data: MarketDataEvent) => {
       console.log('📊 Market data update received:', data);
      callback(data);
    });

    const unsubscribe = () => {
      channel.unbind(eventName);
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
    };

    this.subscriptions.set(channelName, { channel, unsubscribe });
     console.log(`✅ Subscribed to market data updates`);

    return unsubscribe;
  }

  /**
   * Subscribe to trading events for a specific market
   */
  subscribeToTradingEvents(
    symbol: string,
    callback: (data: TradingEvent) => void
  ): () => void {
    const channelName = `market-${symbol}`;
    const eventName = 'trading-event';

    // Get existing subscription or create new one
    let subscription = this.subscriptions.get(channelName);
    if (!subscription) {
      const channel = this.pusher.subscribe(channelName);
      subscription = { 
        channel, 
        events: new Set(),
        unsubscribe: () => {
          this.pusher.unsubscribe(channelName);
          this.subscriptions.delete(channelName);
        }
      };
      this.subscriptions.set(channelName, subscription);
    }

    // Bind to trading events if not already bound
    if (!subscription.events.has(eventName)) {
      subscription.channel.bind(eventName, (data: TradingEvent) => {
         console.log(`⚡ Trading event received for ${symbol}:`, data);
        callback(data);
      });
      subscription.events.add(eventName);
    }

     console.log(`✅ Subscribed to trading events for ${symbol}`);

    return () => {
      subscription.channel.unbind(eventName);
      subscription.events.delete(eventName);
      
      // If no more events, unsubscribe from channel
      if (subscription.events.size === 0) {
        subscription.unsubscribe();
      }
    };
  }

  /**
   * Subscribe to user-specific position updates (private channel)
   */
  subscribeToUserPositions(
    userAddress: string,
    callback: (data: TradingEvent) => void
  ): () => void {
    const channelName = `private-user-${userAddress}`;
    const eventName = 'position-update';

    if (this.subscriptions.has(channelName)) {
       console.log(`Already subscribed to ${channelName}`);
      return this.subscriptions.get(channelName).unsubscribe;
    }

    const channel = this.pusher.subscribe(channelName);
    
    channel.bind(eventName, (data: TradingEvent) => {
       console.log(`👤 Position update received for ${userAddress}:`, data);
      callback(data);
    });

    const unsubscribe = () => {
      channel.unbind(eventName);
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
    };

    this.subscriptions.set(channelName, { channel, unsubscribe });
     console.log(`✅ Subscribed to position updates for ${userAddress}`);

    return unsubscribe;
  }

  /**
   * Subscribe to token ticker updates
   */
  subscribeToTokenTicker(
    callback: (data: TokenTickerEvent) => void
  ): () => void {
    const channelName = 'token-ticker';
    const eventName = 'ticker-update';

    if (this.subscriptions.has(channelName)) {
       console.log(`Already subscribed to ${channelName}`);
      return this.subscriptions.get(channelName).unsubscribe;
    }

    const channel = this.pusher.subscribe(channelName);
    
    channel.bind(eventName, (data: TokenTickerEvent) => {
      callback(data);
    });

    const unsubscribe = () => {
      channel.unbind(eventName);
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
    };

    this.subscriptions.set(channelName, { channel, unsubscribe });
     console.log(`✅ Subscribed to token ticker updates`);

    return unsubscribe;
  }

  /**
   * Subscribe to chart data updates
   */
  subscribeToChartData(
    symbol: string,
    timeframe: string,
    callback: (data: ChartDataEvent) => void
  ): () => void {
    const channelName = `chart-${symbol}-${timeframe}`;
    const eventName = 'chart-update';

     console.log(`🔗 Attempting to subscribe to chart channel: ${channelName}`);
     console.log(`🎯 Event name: ${eventName}`);

    if (this.subscriptions.has(channelName)) {
       console.log(`Already subscribed to ${channelName}`);
      return this.subscriptions.get(channelName).unsubscribe;
    }

     console.log(`📡 Creating Pusher subscription for ${channelName}`);
    const channel = this.pusher.subscribe(channelName);
    
     console.log(`🎪 Channel object:`, channel);
     console.log(`🎪 Channel state:`, channel.subscribed);

    // Add channel state event listeners for debugging
    channel.bind('pusher:subscription_succeeded', () => {
       console.log(`✅ Successfully subscribed to channel: ${channelName}`);
    });

    channel.bind('pusher:subscription_error', (error: any) => {
      console.error(`❌ Subscription error for channel ${channelName}:`, error);
    });
    
    channel.bind(eventName, (data: ChartDataEvent) => {
       console.log(`📈 Chart update received for ${symbol} (${timeframe}):`, data);
       console.log(`🎯 Calling callback function...`);
      try {
        callback(data);
         console.log(`✅ Callback executed successfully`);
      } catch (error) {
        console.error(`❌ Error in chart data callback:`, error);
      }
    });

    const unsubscribe = () => {
       console.log(`🧹 Unsubscribing from ${channelName}`);
      channel.unbind(eventName);
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
    };

    this.subscriptions.set(channelName, { channel, unsubscribe });
     console.log(`✅ Subscribed to chart data for ${symbol} (${timeframe})`);

    return unsubscribe;
  }

  /**
   * Generic method to subscribe to any channel with multiple events
   */
  subscribeToChannel(
    channelName: string,
    eventHandlers: Record<string, (data: any) => void>
  ): () => void {
    console.log(`📡 [GENERIC] Subscribing to channel: ${channelName}`);
    
    if (this.subscriptions.has(channelName)) {
      console.log(`Already subscribed to ${channelName}`);
      return this.subscriptions.get(channelName).unsubscribe;
    }

    const channel = this.pusher.subscribe(channelName);
    const boundEvents = new Set<string>();

    // Bind all event handlers
    Object.entries(eventHandlers).forEach(([eventName, handler]) => {
      channel.bind(eventName, (data: any) => {
        console.log(`📨 [${channelName}] ${eventName}:`, data);
        handler(data);
      });
      boundEvents.add(eventName);
    });

    const unsubscribe = () => {
      console.log(`🔌 [GENERIC] Unsubscribing from ${channelName}`);
      // Unbind all events
      boundEvents.forEach(eventName => {
        channel.unbind(eventName);
      });
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
    };

    this.subscriptions.set(channelName, { channel, unsubscribe, events: boundEvents });
    console.log(`✅ [GENERIC] Subscribed to ${channelName} with ${boundEvents.size} events`);

    return unsubscribe;
  }

  /**
   * Unsubscribe from a specific channel
   */
  unsubscribe(channelName: string): void {
    const subscription = this.subscriptions.get(channelName);
    if (subscription && subscription.unsubscribe) {
      subscription.unsubscribe();
      console.log(`🔌 Unsubscribed from ${channelName}`);
    }
  }

  /**
   * Get connection status
   */
  getConnectionState() {
    return {
      isConnected: this.isConnected,
      state: this.pusher.connection.state,
      socketId: this.pusher.connection.socket_id,
      subscriptionCount: this.subscriptions.size,
      subscriptions: Array.from(this.subscriptions.keys()),
    };
  }

  /**
   * Disconnect from Pusher and clean up all subscriptions
   */
  disconnect() {
     console.log('🔌 Disconnecting from Pusher...');
    
    // Unsubscribe from all channels
    this.subscriptions.forEach((subscription, channelName) => {
      if (subscription.unsubscribe) {
        subscription.unsubscribe();
      }
    });
    
    this.subscriptions.clear();
    this.connectionStateCallbacks = [];
    
    // Disconnect from Pusher
    this.pusher.disconnect();
    
     console.log('✅ Pusher disconnected and cleaned up');
  }

  /**
   * Reconnect to Pusher
   */
  reconnect() {
    if (this.reconnectionAttempts >= this.maxReconnectionAttempts) {
      console.error('❌ Max reconnection attempts reached');
      return;
    }

    this.reconnectionAttempts++;
     console.log(`🔄 Attempting to reconnect (${this.reconnectionAttempts}/${this.maxReconnectionAttempts})...`);
    
    this.pusher.connect();
  }
}

// Singleton instance
let pusherClientInstance: PusherClientService | null = null;

/**
 * Get the singleton PusherClientService instance
 */
export function getPusherClient(options?: PusherClientOptions): PusherClientService {
  if (!pusherClientInstance && typeof globalThis !== 'undefined') {
    pusherClientInstance = new PusherClientService(options);
  }
  return pusherClientInstance!;
}

/**
 * Hook for using Pusher in React components
 */
export function usePusher(options?: PusherClientOptions) {
  // Only initialize on client-side
  if (typeof globalThis === 'undefined') {
    return null;
  }
  
  return getPusherClient(options);
} 