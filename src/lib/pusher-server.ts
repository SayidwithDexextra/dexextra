import Pusher from 'pusher';
import { Redis } from '@upstash/redis';
import { getClickHouseDataPipeline } from './clickhouse-client';

const REALTIME_METRIC_PREFIX = '[REALTIME_METRIC]';
const rtMetricLog = (...args: any[]) => console.log(REALTIME_METRIC_PREFIX, ...args);
const rtMetricWarn = (...args: any[]) => console.warn(REALTIME_METRIC_PREFIX, ...args);
const rtMetricErr = (...args: any[]) => console.error(REALTIME_METRIC_PREFIX, ...args);

// Types for real-time events
export interface PriceUpdateEvent {
  symbol: string;
  markPrice: number;
  fundingRate?: number;
  timestamp: number;
  volume24h?: number;
  priceChange24h?: number;
}

export interface MarketDataEvent {
  marketCap: string;
  marketCapChange: number;
  tradingVolume: string;
  timestamp: number;
}

export interface TradingEvent {
  userAddress: string;
  symbol: string;
  action: 'open' | 'close' | 'liquidate';
  positionSize: string;
  markPrice: number;
  timestamp: number;
  isLong: boolean;
}

export interface TokenTickerEvent {
  symbol: string;
  price: number;
  priceChange24h: number;
  volume24h?: number;
  timestamp: number;
}

export interface ChartDataEvent {
  symbol: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
  // Optional: canonical Supabase markets.id (UUID). Realtime subscriptions may use UUID as symbol.
  marketUuid?: string;
}

// Metric-series realtime point update (used by TradingView Live Metric Tracker overlay)
export interface MetricSeriesEvent {
  /** Canonical Supabase markets.id (UUID) */
  marketId: string;
  /** ClickHouse metric_name */
  metricName: string;
  /** Epoch milliseconds for the point */
  ts: number;
  /** Metric value at ts */
  value: number;
  /** Optional source label (worker/api/debug_seed/etc) */
  source?: string;
  /** Optional version used by writers (monotonic-ish) */
  version?: number;
}

export interface BroadcastChartOptions {
  /** Persist to ClickHouse via `processChartData()` (default: true) */
  persist?: boolean;
  /** Cache latest candle in Redis for API fallback (default: true) */
  cache?: boolean;
  /** Trigger analytics hooks (default: true) */
  analytics?: boolean;
}

function looksLikeUuid(value: string): boolean {
  const v = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeTimeframe(tf: string): string {
  const t = String(tf || '').trim();
  if (!t) return '1m';
  // TradingView numeric resolutions → our suffix format
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

/**
 * PusherServer - Server-side service for broadcasting real-time updates
 * 
 * This service handles all real-time broadcasting needs including:
 * - VAMM price updates
 * - Market data changes
 * - Trading events
 * - Token ticker updates
 * - Chart data streaming
 */
export class PusherServerService {
  private pusher: Pusher;
  private redis?: Redis;
  private clickhousePipeline?: any; // ClickHouse pipeline for data persistence
  private isInitialized = false;

  constructor() {
    // Validate environment variables
    this.validateEnvironment();
    
    this.pusher = new Pusher({
      appId: process.env.PUSHER_APP_ID!,
      key: process.env.PUSHER_KEY!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER || 'us2',
      useTLS: true,
      encryptionMasterKeyBase64: process.env.PUSHER_ENCRYPTION_KEY,
    });

    // Initialize Redis for caching if available
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      this.redis = Redis.fromEnv();
    }

    // Initialize ClickHouse pipeline for data persistence
    try {
      this.clickhousePipeline = getClickHouseDataPipeline();
       console.log('🗄️ ClickHouse data pipeline integrated');
    } catch (error) {
      console.warn('⚠️ ClickHouse pipeline not available:', error);
    }

    this.isInitialized = true;
     console.log('🚀 PusherServerService initialized successfully');
  }

  private validateEnvironment() {
    const required = ['PUSHER_APP_ID', 'PUSHER_KEY', 'PUSHER_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required Pusher environment variables: ${missing.join(', ')}`);
    }else{
       console.log('🚀 Pusher environment variables validated successfully');
    }
  }

  /**
   * Broadcast price updates for VAMM markets
   */
  async broadcastPriceUpdate(data: PriceUpdateEvent): Promise<void> {
    if (!this.isInitialized) return;

    try {
      const channel = `market-${data.symbol}`;
      const event = 'price-update';

      // Broadcast to specific market channel
      await this.pusher.trigger(channel, event, {
        ...data,
        timestamp: data.timestamp || Date.now(),
      });

      // Also broadcast to global price updates channel
      await this.pusher.trigger('global-prices', 'price-update', {
        ...data,
        timestamp: data.timestamp || Date.now(),
      });

      // Cache the latest price for fallback
      if (this.redis) {
        await this.redis.setex(
          `price:${data.symbol}`,
          300, // 5 minutes TTL
          JSON.stringify(data)
        );
      }

       console.log(`📈 Price update broadcasted for ${data.symbol}: $${data.markPrice}`);
    } catch (error) {
      console.error('Error broadcasting price update:', error);
    }
  }

  /**
   * Broadcast market data updates (market cap, volume, etc.)
   */
  async broadcastMarketData(data: MarketDataEvent): Promise<void> {
    if (!this.isInitialized) return;

    try {
      await this.pusher.trigger('global-market', 'market-data-update', {
        ...data,
        timestamp: data.timestamp || Date.now(),
      });

      // Cache market data
      if (this.redis) {
        await this.redis.setex(
          'market-data',
          300, // 5 minutes TTL
          JSON.stringify(data)
        );
      }

       console.log('📊 Market data update broadcasted');
    } catch (error) {
      console.error('Error broadcasting market data:', error);
    }
  }

  /**
   * Broadcast trading events (position opens/closes, liquidations)
   */
  async broadcastTradingEvent(data: TradingEvent): Promise<void> {
    if (!this.isInitialized) return;

    try {
      // Broadcast to market-specific channel
      await this.pusher.trigger(`market-${data.symbol}`, 'trading-event', {
        ...data,
        timestamp: data.timestamp || Date.now(),
      });

      // Broadcast to user-specific channel (private)
      await this.pusher.trigger(`private-user-${data.userAddress}`, 'position-update', {
        ...data,
        timestamp: data.timestamp || Date.now(),
      });

      // Broadcast to global trading events
      await this.pusher.trigger('global-trading', 'trading-event', {
        ...data,
        timestamp: data.timestamp || Date.now(),
      });

       console.log(`⚡ Trading event broadcasted: ${data.action} ${data.symbol} for ${data.userAddress}`);
    } catch (error) {
      console.error('Error broadcasting trading event:', error);
    }
  }

  /**
   * Broadcast token ticker updates for price tickers
   */
  async broadcastTokenTicker(tokens: TokenTickerEvent[]): Promise<void> {
    if (!this.isInitialized) return;

    try {
      // Batch broadcast for efficiency
      const triggers = tokens.map(token => ({
        channel: 'token-ticker',
        name: 'ticker-update',
        data: {
          ...token,
          timestamp: token.timestamp || Date.now(),
        }
      }));

      // Use batch trigger for better performance
      await this.pusher.triggerBatch(triggers);

      // Cache individual token prices
      if (this.redis) {
        const cachePromises = tokens.map(token =>
          this.redis!.setex(
            `ticker:${token.symbol}`,
            60, // 1 minute TTL for tickers
            JSON.stringify(token)
          )
        );
        await Promise.all(cachePromises);
      }

       console.log(`🎯 Token ticker updates broadcasted for ${tokens.length} tokens`);
    } catch (error) {
      console.error('Error broadcasting token ticker:', error);
    }
  }

  /**
   * Broadcast chart data updates
   */
  async broadcastChartData(data: ChartDataEvent, options?: BroadcastChartOptions): Promise<void> {
    if (!this.isInitialized) {
       console.log('❌ Pusher server not initialized, cannot broadcast chart data');
      return;
    }

    try {
      const shouldPersist = options?.persist !== false;
      const shouldCache = options?.cache !== false;
      const shouldAnalytics = options?.analytics !== false;

      const event = 'chart-update';
      const timeframe = normalizeTimeframe(data.timeframe);

      // UUID-only realtime routing (canonical).
      // We intentionally do NOT broadcast to symbol-based channels to avoid split streams.
      const mu = data.marketUuid ? String(data.marketUuid).trim() : '';
      if (!mu || !looksLikeUuid(mu)) {
        console.warn('⚠️ Skipping chart realtime broadcast: missing/invalid marketUuid', {
          marketUuid: data.marketUuid,
          symbol: data.symbol,
          timeframe,
        });
        return;
      }
      const channels = new Set<string>([`chart-${mu}-${timeframe}`]);

       console.log(`📡 Broadcasting chart data to channel(s): ${Array.from(channels).join(', ')}`);
       console.log(`🎯 Event name: ${event}`);
       console.log(`📊 Chart data:`, data);

      const broadcastData = {
        ...data,
        timeframe,
        timestamp: data.timestamp || Date.now(),
      };

       console.log(`📤 Final broadcast data:`, broadcastData);

      // Development debug - show outgoing payload
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
         console.log('🔴 WILL-BROADCAST', Array.from(channels), JSON.stringify(broadcastData, null, 2));
      }

      // 1️⃣ BROADCAST TO CLIENTS (Real-time)
      const triggers = Array.from(channels).map(channel => ({
        channel,
        name: event,
        data: broadcastData,
      }));
      if (triggers.length === 1) {
        await this.pusher.trigger(triggers[0]!.channel, triggers[0]!.name, triggers[0]!.data);
      } else {
        await this.pusher.triggerBatch(triggers);
      }
       console.log(`📈 Chart data broadcasted successfully for ${data.symbol} (${timeframe})`);

      // 2️⃣ PERSIST TO CLICKHOUSE (Data pipeline)
      if (shouldPersist) {
        await this.persistChartDataToClickHouse(broadcastData);
      }

      // 3️⃣ CACHE FOR API FALLBACK (Performance)
      if (shouldCache) {
        await this.cacheChartData(broadcastData);
      }

      // 4️⃣ TRIGGER ANALYTICS PROCESSING (Background)
      if (shouldAnalytics) {
        await this.triggerAnalyticsProcessing(broadcastData);
      }

    } catch (error) {
      console.error('❌ Error broadcasting chart data:', error);
      console.error('❌ Error details:', {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : 'No stack trace',
        data
      });
    }
  }

  /**
   * Broadcast a metric-series point update (real-time)
   *
   * Channel: `metric-${marketId}`
   * Event: `metric-update`
   */
  async broadcastMetricSeries(data: MetricSeriesEvent): Promise<void> {
    if (!this.isInitialized) return;

    try {
      const marketId = String((data as any)?.marketId || '').trim();
      const metricName = String((data as any)?.metricName || '').trim();
      if (!marketId || !looksLikeUuid(marketId) || !metricName) {
        rtMetricWarn('skip broadcast: invalid marketId/metricName', {
          marketId,
          metricName,
        });
        return;
      }

      const channel = `metric-${marketId}`;
      const event = 'metric-update';

      const payload = {
        marketId,
        metricName,
        ts: Number((data as any)?.ts) || Date.now(),
        value: Number((data as any)?.value),
        source: (data as any)?.source,
        version: (data as any)?.version,
      };

      if (!Number.isFinite(payload.ts)) payload.ts = Date.now();
      if (!Number.isFinite(payload.value)) {
        rtMetricWarn('skip broadcast: non-finite value', payload);
        return;
      }

      rtMetricLog('pusher trigger', { channel, event, marketId, metricName, ts: payload.ts, value: payload.value });
      await this.pusher.trigger(channel, event, payload);
      rtMetricLog('pusher trigger complete', { channel, event, marketId, metricName });
    } catch (error) {
      rtMetricErr('pusher trigger failed', { error });
    }
  }

  /**
   * 2️⃣ PERSIST CHART DATA TO CLICKHOUSE
   * This creates the complete data pipeline for historical analysis
   */
  private async persistChartDataToClickHouse(data: ChartDataEvent): Promise<void> {
    if (!this.clickhousePipeline) {
      console.warn('⚠️ ClickHouse pipeline not initialized, skipping persistence.');
      return;
    }

    try {
       console.log(`💾 Persisting chart data to ClickHouse: ${data.symbol}`);

       // Convert OHLCV data to tick format and insert
       // The new architecture uses materialized views to auto-aggregate
       await this.clickhousePipeline.processChartData({
         symbol: data.symbol,
         timeframe: data.timeframe,
         open: data.open,
         high: data.high,
         low: data.low,
         close: data.close,
         volume: data.volume,
         timestamp: data.timestamp,
         marketUuid: data.marketUuid,
       });

       console.log(`✅ Chart data persisted to ClickHouse: ${data.symbol}`);
    } catch (error) {
      console.error('❌ Failed to persist chart data to ClickHouse:', error);
      // Don't throw - persistence failure shouldn't break real-time updates
    }
  }

  /**
   * 3️⃣ CACHE CHART DATA FOR API PERFORMANCE
   */
  private async cacheChartData(data: ChartDataEvent): Promise<void> {
    if (!this.redis) return;

    try {
      // Cache latest candle for:
      // - symbol key (human label)
      // - marketUuid key (canonical id) when available
      const tf = normalizeTimeframe(data.timeframe);
      const cacheKeys = new Set<string>();
      if (data.symbol) cacheKeys.add(`chart:${data.symbol}:${tf}:latest`);
      if (data.marketUuid) cacheKeys.add(`chart:${data.marketUuid}:${tf}:latest`);
      await Promise.all(
        Array.from(cacheKeys).map(k => this.redis!.setex(k, 300, JSON.stringify({ ...data, timeframe: tf })))
      ); // 5min TTL

      // Cache in price lookup for fast API responses
      const pricePayload = JSON.stringify({
        symbol: data.symbol,
        price: data.close,
        timestamp: data.timestamp,
        marketUuid: data.marketUuid,
      });
      if (data.symbol) {
        const priceKey = `price:${data.symbol}:latest`;
        await this.redis.setex(priceKey, 60, pricePayload); // 1min TTL
      }
      if (data.marketUuid) {
        const priceKeyById = `price:${data.marketUuid}:latest`;
        await this.redis.setex(priceKeyById, 60, pricePayload); // 1min TTL
      }

       console.log(`📱 Chart data cached: ${data.symbol}-${tf}`);
    } catch (error) {
      console.error('❌ Failed to cache chart data:', error);
    }
  }

  /**
   * 4️⃣ TRIGGER BACKGROUND ANALYTICS PROCESSING
   */
  private async triggerAnalyticsProcessing(data: ChartDataEvent): Promise<void> {
    try {
      // TODO: Implement background processing triggers
      // A. Volume analysis
      // B. Price trend detection  
      // C. Market volatility calculations
      // D. Trading signal generation

       console.log(`🔬 Analytics processing triggered for ${data.symbol}`);
    } catch (error) {
      console.error('❌ Failed to trigger analytics processing:', error);
    }
  }

  /**
   * Broadcast multiple price updates efficiently
   */
  async broadcastBatchPriceUpdates(updates: PriceUpdateEvent[]): Promise<void> {
    if (!this.isInitialized || updates.length === 0) return;

    try {
      // Create batch triggers for individual markets
      const marketTriggers = updates.map(update => ({
        channel: `market-${update.symbol}`,
        name: 'price-update',
        data: {
          ...update,
          timestamp: update.timestamp || Date.now(),
        }
      }));

      // Create single trigger for global updates
      const globalTrigger = {
        channel: 'global-prices',
        name: 'batch-price-update',
        data: {
          updates: updates.map(update => ({
            ...update,
            timestamp: update.timestamp || Date.now(),
          })),
          timestamp: Date.now(),
        }
      };

      // Execute batch triggers
      await Promise.all([
        this.pusher.triggerBatch(marketTriggers),
        this.pusher.trigger(globalTrigger.channel, globalTrigger.name, globalTrigger.data)
      ]);

      // Cache updates
      if (this.redis) {
        const cachePromises = updates.map(update =>
          this.redis!.setex(
            `price:${update.symbol}`,
            300,
            JSON.stringify(update)
          )
        );
        await Promise.all(cachePromises);
      }

       console.log(`🔥 Batch price updates broadcasted for ${updates.length} markets`);
    } catch (error) {
      console.error('Error broadcasting batch price updates:', error);
    }
  }

  /**
   * Get connection info for debugging
   */
  getConnectionInfo() {
    return {
      appId: process.env.PUSHER_APP_ID,
      cluster: process.env.PUSHER_CLUSTER || 'us2',
      isInitialized: this.isInitialized,
      hasRedis: !!this.redis,
      hasClickhouse: !!this.clickhousePipeline,
    };
  }

  /**
   * Test the connection by sending a test event
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.pusher.trigger('test-channel', 'test-event', {
        message: 'Connection test',
        timestamp: Date.now(),
      });
      return true;
    } catch (error) {
      console.error('Pusher connection test failed:', error);
      return false;
    }
  }
}

// Singleton instance
let pusherServerInstance: PusherServerService | null = null;

/**
 * Get the singleton PusherServerService instance
 */
export function getPusherServer(): PusherServerService {
  if (!pusherServerInstance) {
    pusherServerInstance = new PusherServerService();
  }
  return pusherServerInstance;
}

// Convenience functions for quick access
export const broadcastPriceUpdate = (data: PriceUpdateEvent) => 
  getPusherServer().broadcastPriceUpdate(data);

export const broadcastMarketData = (data: MarketDataEvent) => 
  getPusherServer().broadcastMarketData(data);

export const broadcastTradingEvent = (data: TradingEvent) => 
  getPusherServer().broadcastTradingEvent(data);

export const broadcastTokenTicker = (tokens: TokenTickerEvent[]) => 
  getPusherServer().broadcastTokenTicker(tokens);

export const broadcastChartData = (data: ChartDataEvent) => 
  getPusherServer().broadcastChartData(data);

export const broadcastMetricSeries = (data: MetricSeriesEvent) =>
  getPusherServer().broadcastMetricSeries(data);

export const broadcastBatchPriceUpdates = (updates: PriceUpdateEvent[]) => 
  getPusherServer().broadcastBatchPriceUpdates(updates); 