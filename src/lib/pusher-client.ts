import PusherJS from 'pusher-js';
import { 
  PriceUpdateEvent, 
  MarketDataEvent, 
  TradingEvent, 
  TokenTickerEvent, 
  ChartDataEvent,
  MetricSeriesEvent
} from './pusher-server';

const REALTIME_PREFIX = '[REALTIME]';
const rtLog = (...args: any[]) => {
  // eslint-disable-next-line no-console
  console.log(REALTIME_PREFIX, ...args);
};
const rtWarn = (...args: any[]) => {
  // eslint-disable-next-line no-console
  console.warn(REALTIME_PREFIX, ...args);
};
const rtErr = (...args: any[]) => {
  // eslint-disable-next-line no-console
  console.error(REALTIME_PREFIX, ...args);
};

const REALTIME_METRIC_PREFIX = '[REALTIME_METRIC]';
const rtMetricLog = (...args: any[]) => {
  // eslint-disable-next-line no-console
  console.log(REALTIME_METRIC_PREFIX, ...args);
};
const rtMetricWarn = (...args: any[]) => {
  // eslint-disable-next-line no-console
  console.warn(REALTIME_METRIC_PREFIX, ...args);
};

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
  private chartUnsubscribeGraceMs = 15_000;
  private metricCallbacks = new Map<string, Set<(data: MetricSeriesEvent) => void>>();

  private attachChannelSignalLogging(channelName: string) {
    const sub = this.subscriptions.get(channelName);
    if (!sub?.channel) return;
    if (sub.__realtimeSignalLoggingAttached) return;

    const channel = sub.channel;

    const globalCb = (eventName: string, data: any) => {
      rtLog('signal received', { channel: channelName, event: eventName, data });
    };
    const succeededCb = () => {
      rtLog('subscription succeeded', { channel: channelName });
    };
    const errorCb = (error: any) => {
      rtErr('subscription error', { channel: channelName, error });
    };

    try {
      if (typeof channel.bind_global === 'function') {
        channel.bind_global(globalCb);
      }
    } catch (e) {
      rtWarn('failed to bind channel global handler', { channel: channelName, error: e });
    }

    // These are emitted by PusherJS per-channel; useful to see if we ever subscribe successfully.
    try {
      channel.bind('pusher:subscription_succeeded', succeededCb);
      channel.bind('pusher:subscription_error', errorCb);
    } catch (e) {
      rtWarn('failed to bind subscription lifecycle handlers', { channel: channelName, error: e });
    }

    sub.__realtimeSignalLoggingAttached = true;
    sub.__realtimeSignalLogging = { globalCb, succeededCb, errorCb };
  }

  private detachChannelSignalLogging(channelName: string) {
    const sub = this.subscriptions.get(channelName);
    if (!sub?.channel) return;
    if (!sub.__realtimeSignalLoggingAttached) return;

    const channel = sub.channel;
    const bindings = sub.__realtimeSignalLogging;

    try {
      if (typeof channel.unbind_global === 'function') {
        if (bindings?.globalCb) channel.unbind_global(bindings.globalCb);
        else channel.unbind_global();
      }
    } catch {
      // best-effort
    }

    try {
      if (bindings?.succeededCb) channel.unbind('pusher:subscription_succeeded', bindings.succeededCb);
      if (bindings?.errorCb) channel.unbind('pusher:subscription_error', bindings.errorCb);
    } catch {
      // best-effort
    }

    sub.__realtimeSignalLoggingAttached = false;
    sub.__realtimeSignalLogging = null;
  }

  private normalizeTimeframe(tf: string): string {
    const t = String(tf || '').trim();
    if (!t) return '1m';
    // TradingView numeric resolutions → our channel suffix format
    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      if (n === 1) return '1m';
      if (n === 5) return '5m';
      if (n === 15) return '15m';
      if (n === 30) return '30m';
      if (n === 60) return '1h';
      if (n === 240) return '4h';
      return `${n}m`;
    }
    return t;
  }

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

    // Helpful for debugging "stuck until refresh" cases.
    this.pusher.connection.bind('state_change', (s: any) => {
      rtLog('connection state change', { previous: s?.previous, current: s?.current });
    });

    rtLog('PusherClientService initialized', {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2',
      keyPrefix: String(process.env.NEXT_PUBLIC_PUSHER_KEY || '').slice(0, 8),
    });
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
      rtLog('connection established', {
        state: this.pusher.connection.state,
        socketId: this.pusher.connection.socket_id,
      });
      this.notifyConnectionState('connected');
    });

    this.pusher.connection.bind('disconnected', () => {
      this.isConnected = false;
      rtWarn('connection disconnected', {
        state: this.pusher.connection.state,
        socketId: this.pusher.connection.socket_id,
      });
      this.notifyConnectionState('disconnected');
    });

    this.pusher.connection.bind('error', (error: any) => {
      rtErr('connection error', error);
      this.notifyConnectionState('error');
    });

    this.pusher.connection.bind('unavailable', () => {
      rtWarn('connection unavailable', {
        state: this.pusher.connection.state,
        socketId: this.pusher.connection.socket_id,
      });
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
      rtLog('already subscribed', { channel: channelName });
      return this.subscriptions.get(channelName).unsubscribe;
    }

    const channel = this.pusher.subscribe(channelName);
    
    channel.bind(eventName, (data: PriceUpdateEvent) => {
      callback(data);
    });

    const unsubscribe = () => {
      this.detachChannelSignalLogging(channelName);
      channel.unbind(eventName);
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
      rtLog('unsubscribed', { channel: channelName });
    };

    this.subscriptions.set(channelName, { channel, unsubscribe });
    this.attachChannelSignalLogging(channelName);
    rtLog('subscribed', { channel: channelName, event: eventName });

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
      rtLog('already subscribed', { channel: channelName });
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
      this.detachChannelSignalLogging(channelName);
      channel.unbind('price-update');
      channel.unbind('batch-price-update');
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
      rtLog('unsubscribed', { channel: channelName });
    };

    this.subscriptions.set(channelName, { channel, unsubscribe });
    this.attachChannelSignalLogging(channelName);
    rtLog('subscribed', { channel: channelName });

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
      rtLog('already subscribed', { channel: channelName });
      return this.subscriptions.get(channelName).unsubscribe;
    }

    const channel = this.pusher.subscribe(channelName);
    
    channel.bind(eventName, (data: MarketDataEvent) => {
      callback(data);
    });

    const unsubscribe = () => {
      this.detachChannelSignalLogging(channelName);
      channel.unbind(eventName);
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
    };

    this.subscriptions.set(channelName, { channel, unsubscribe });
    this.attachChannelSignalLogging(channelName);
    rtLog('subscribed', { channel: channelName, event: eventName });

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
          this.detachChannelSignalLogging(channelName);
          this.pusher.unsubscribe(channelName);
          this.subscriptions.delete(channelName);
        }
      };
      this.subscriptions.set(channelName, subscription);
      this.attachChannelSignalLogging(channelName);
    } else {
      // Ensure we always log signals even if channel was created earlier by a different subscription method.
      this.attachChannelSignalLogging(channelName);
    }

    // Bind to trading events if not already bound
    if (!subscription.events.has(eventName)) {
      subscription.channel.bind(eventName, (data: TradingEvent) => {
        callback(data);
      });
      subscription.events.add(eventName);
    }

    rtLog('subscribed', { channel: channelName, event: eventName });

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
      rtLog('already subscribed', { channel: channelName });
      return this.subscriptions.get(channelName).unsubscribe;
    }

    const channel = this.pusher.subscribe(channelName);
    
    channel.bind(eventName, (data: TradingEvent) => {
      callback(data);
    });

    const unsubscribe = () => {
      this.detachChannelSignalLogging(channelName);
      channel.unbind(eventName);
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
    };

    this.subscriptions.set(channelName, { channel, unsubscribe });
    this.attachChannelSignalLogging(channelName);
    rtLog('subscribed', { channel: channelName, event: eventName });

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
      rtLog('already subscribed', { channel: channelName });
      return this.subscriptions.get(channelName).unsubscribe;
    }

    const channel = this.pusher.subscribe(channelName);
    
    channel.bind(eventName, (data: TokenTickerEvent) => {
      callback(data);
    });

    const unsubscribe = () => {
      this.detachChannelSignalLogging(channelName);
      channel.unbind(eventName);
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
    };

    this.subscriptions.set(channelName, { channel, unsubscribe });
    this.attachChannelSignalLogging(channelName);
    rtLog('subscribed', { channel: channelName, event: eventName });

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
    const tf = this.normalizeTimeframe(timeframe);
    const channelName = `chart-${symbol}-${tf}`;
    const eventName = 'chart-update';

    rtLog('subscribing to chart channel', { channel: channelName, event: eventName, symbol, timeframe, normalizedTimeframe: tf });

    let subscription = this.subscriptions.get(channelName);
    if (!subscription) {
      const channel = this.pusher.subscribe(channelName);

      // Store chart handlers keyed by the original callback function, so we can unbind precisely.
      subscription = {
        channel,
        chartHandlers: new Map<Function, Function>(),
        pendingUnsubTimer: null as any,
        unsubscribe: () => {
          rtLog('unsubscribing (all handlers)', { channel: channelName });
          try {
            const handlers: Function[] = Array.from(subscription.chartHandlers.values());
            for (const h of handlers) channel.unbind(eventName, h as any);
          } catch {
            // best-effort
          }
          try {
            subscription.chartHandlers.clear();
          } catch {
            // best-effort
          }
          this.detachChannelSignalLogging(channelName);
          this.pusher.unsubscribe(channelName);
          this.subscriptions.delete(channelName);
        },
      };

      this.subscriptions.set(channelName, subscription);
      this.attachChannelSignalLogging(channelName);
      rtLog('subscribed (channel)', { channel: channelName, event: eventName });
    } else {
      // Ensure logging is attached even if this channel was created earlier.
      this.attachChannelSignalLogging(channelName);
    }

    // If an unsubscribe was scheduled (e.g. transient TradingView resubscribe), cancel it.
    try {
      if (subscription.pendingUnsubTimer) {
        clearTimeout(subscription.pendingUnsubTimer);
        subscription.pendingUnsubTimer = null;
        rtLog('cancelled scheduled unsubscribe', { channel: channelName });
      }
    } catch {
      // ignore
    }

    // If we already bound this exact callback, return an idempotent unsubscriber for it.
    if (subscription.chartHandlers?.has(callback)) {
      rtLog('already subscribed (handler)', { channel: channelName, event: eventName });
      return () => {
        const existingHandler = subscription.chartHandlers?.get(callback);
        if (!existingHandler) return;
        subscription.channel.unbind(eventName, existingHandler as any);
        subscription.chartHandlers.delete(callback);
        if (subscription.chartHandlers.size === 0) {
          // Delay full channel unsubscribe to avoid flapping during widget rebuilds.
          subscription.pendingUnsubTimer = setTimeout(() => {
            try {
              if (subscription.chartHandlers.size === 0) subscription.unsubscribe();
            } catch {
              // ignore
            }
          }, this.chartUnsubscribeGraceMs);
          rtLog('scheduled unsubscribe', { channel: channelName, inMs: this.chartUnsubscribeGraceMs });
        }
      };
    }

    const handler = (data: ChartDataEvent) => {
      try {
        callback(data);
      } catch (error) {
        rtErr('error in chart data callback', { channel: channelName, error });
      }
    };

    subscription.channel.bind(eventName, handler);
    subscription.chartHandlers?.set(callback, handler);
    rtLog('subscribed (handler)', { channel: channelName, event: eventName, handlerCount: subscription.chartHandlers?.size || 0 });

    return () => {
      const existingHandler = subscription.chartHandlers?.get(callback);
      if (!existingHandler) return;
      subscription.channel.unbind(eventName, existingHandler as any);
      subscription.chartHandlers.delete(callback);
      rtLog('unsubscribed (handler)', { channel: channelName, event: eventName, handlerCount: subscription.chartHandlers.size });

      // If no more handlers are interested, fully unsubscribe from the Pusher channel.
      if (subscription.chartHandlers.size === 0) {
        try {
          const dbg = (globalThis as any).REALTIME_DBG || process.env.NODE_ENV === 'development';
          if (dbg) {
            rtLog('unsubscribe triggered from', { channel: channelName, stack: new Error().stack });
          }
        } catch {
          // ignore
        }
        // Delay full channel unsubscribe to avoid flapping during widget rebuilds.
        subscription.pendingUnsubTimer = setTimeout(() => {
          try {
            if (subscription.chartHandlers.size === 0) subscription.unsubscribe();
          } catch {
            // ignore
          }
        }, this.chartUnsubscribeGraceMs);
        rtLog('scheduled unsubscribe', { channel: channelName, inMs: this.chartUnsubscribeGraceMs });
      }
    };
  }

  /**
   * Subscribe to metric-series point updates for a market (used by TradingView metric overlay).
   *
   * Channel: `metric-${marketId}`
   * Event: `metric-update`
   */
  subscribeToMetricSeries(
    marketId: string,
    callback: (data: MetricSeriesEvent) => void
  ): () => void {
    const id = String(marketId || '').trim();
    if (!id) return () => {};

    const channelName = `metric-${id}`;
    const eventName = 'metric-update';

    rtMetricLog('subscribe request', { channel: channelName, event: eventName, marketId: id });

    // Track callbacks per channel so we only bind ONE Pusher handler per channel.
    let callbacks = this.metricCallbacks.get(channelName);
    if (!callbacks) {
      callbacks = new Set();
      this.metricCallbacks.set(channelName, callbacks);
    }
    callbacks.add(callback);

    let subscription = this.subscriptions.get(channelName);
    if (!subscription) {
      const channel = this.pusher.subscribe(channelName);

      const masterHandler = (data: MetricSeriesEvent) => {
        rtMetricLog('event received', {
          channel: channelName,
          event: eventName,
          marketId: data?.marketId,
          metricName: data?.metricName,
          ts: (data as any)?.ts,
          value: (data as any)?.value,
          callbackCount: this.metricCallbacks.get(channelName)?.size || 0,
        });

        // IMPORTANT: kick the chart from the main app window.
        // This avoids relying on the indicator iframe realm to force redraws.
        try {
          if (typeof window !== 'undefined') {
            const kick = (window as any).__DEXEXTRA_TV_METRIC_OVERLAY_KICK__;
            if (typeof kick === 'function') kick();
          }
        } catch {
          // ignore
        }

        const cbs = this.metricCallbacks.get(channelName);
        if (!cbs) return;
        for (const cb of cbs) {
          try {
            cb(data);
          } catch {
            // ignore
          }
        }
      };

      subscription = {
        channel,
        events: new Set(),
        masterHandler,
        unsubscribe: () => {
          this.detachChannelSignalLogging(channelName);
          try {
            subscription.events?.forEach((evt: string) => channel.unbind(evt));
          } catch {
            // best-effort
          }
          this.pusher.unsubscribe(channelName);
          this.subscriptions.delete(channelName);
          this.metricCallbacks.delete(channelName);
          rtMetricLog('unsubscribed (channel)', { channel: channelName });
        }
      };
      this.subscriptions.set(channelName, subscription);
      this.attachChannelSignalLogging(channelName);
      rtMetricLog('subscribed (channel)', { channel: channelName });

      // Bind only once per channel.
      channel.bind(eventName, masterHandler);
      subscription.events.add(eventName);
    } else {
      this.attachChannelSignalLogging(channelName);
    }

    rtMetricLog('subscribed (handler)', { channel: channelName, event: eventName, callbackCount: callbacks.size });

    return () => {
      const cbs = this.metricCallbacks.get(channelName);
      if (cbs) {
        cbs.delete(callback);
        rtMetricLog('unsubscribed (handler)', { channel: channelName, event: eventName, callbackCount: cbs.size });
        if (cbs.size === 0) {
          subscription.unsubscribe();
        }
      }
    };
  }

  /**
   * Generic method to subscribe to any channel with multiple events
   */
  subscribeToChannel(
    channelName: string,
    eventHandlers: Record<string, (data: any) => void>
  ): () => void {
    rtLog('subscribing (generic)', { channel: channelName });
    
    if (this.subscriptions.has(channelName)) {
      rtLog('already subscribed', { channel: channelName });
      return this.subscriptions.get(channelName).unsubscribe;
    }

    const channel = this.pusher.subscribe(channelName);
    const boundEvents = new Set<string>();

    // Bind all event handlers
    Object.entries(eventHandlers).forEach(([eventName, handler]) => {
      channel.bind(eventName, (data: any) => {
        handler(data);
      });
      boundEvents.add(eventName);
    });

    const unsubscribe = () => {
      rtLog('unsubscribing (generic)', { channel: channelName });
      this.detachChannelSignalLogging(channelName);
      // Unbind all events
      boundEvents.forEach(eventName => {
        channel.unbind(eventName);
      });
      this.pusher.unsubscribe(channelName);
      this.subscriptions.delete(channelName);
    };

    this.subscriptions.set(channelName, { channel, unsubscribe, events: boundEvents });
    this.attachChannelSignalLogging(channelName);
    rtLog('subscribed (generic)', { channel: channelName, events: Array.from(boundEvents) });

    return unsubscribe;
  }

  /**
   * Unsubscribe from a specific channel
   */
  unsubscribe(channelName: string): void {
    const subscription = this.subscriptions.get(channelName);
    if (subscription && subscription.unsubscribe) {
      subscription.unsubscribe();
      rtLog('unsubscribed', { channel: channelName });
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
    rtLog('disconnecting');
    
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
    
    rtLog('disconnected and cleaned up');
  }

  /**
   * Reconnect to Pusher
   */
  reconnect() {
    if (this.reconnectionAttempts >= this.maxReconnectionAttempts) {
      rtErr('max reconnection attempts reached', {
        reconnectionAttempts: this.reconnectionAttempts,
        maxReconnectionAttempts: this.maxReconnectionAttempts,
      });
      return;
    }

    this.reconnectionAttempts++;
    rtLog('attempting reconnect', {
      reconnectionAttempts: this.reconnectionAttempts,
      maxReconnectionAttempts: this.maxReconnectionAttempts,
    });
    
    this.pusher.connect();
  }
}

// Singleton instance
const GLOBAL_PUSHER_SINGLETON_KEY = '__DEXEXTRA_PUSHER_CLIENT_SINGLETON__';
let pusherClientInstance: PusherClientService | null = null;

/**
 * Get the singleton PusherClientService instance
 */
export function getPusherClient(options?: PusherClientOptions): PusherClientService {
  // Only initialize in the browser; PusherJS depends on DOM globals.
  if (typeof window === 'undefined') {
    throw new Error('Pusher client can only be initialized in the browser.');
  }

  // Ensure singleton even if the module is loaded more than once (Next.js dev/HMR, duplicate bundles).
  const g = globalThis as any;
  const existing = g[GLOBAL_PUSHER_SINGLETON_KEY] as PusherClientService | undefined;
  if (existing) {
    pusherClientInstance = existing;
    return existing;
  }

  if (!pusherClientInstance) {
    pusherClientInstance = new PusherClientService(options);
  }
  g[GLOBAL_PUSHER_SINGLETON_KEY] = pusherClientInstance;
  return pusherClientInstance;
}

/**
 * Hook for using Pusher in React components
 */
export function usePusher(options?: PusherClientOptions) {
  // Only initialize on client-side
  if (typeof window === 'undefined') {
    return null;
  }
  
  return getPusherClient(options);
} 