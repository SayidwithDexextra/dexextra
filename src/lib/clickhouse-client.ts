// src/lib/clickhouse-client.ts
// Optimized ClickHouse client with dynamic aggregation
// Architecture: market_ticks → ohlcv_1m → dynamic aggregation for higher timeframes

import { createClient, ClickHouseClient } from '@clickhouse/client';

export interface MarketTick {
  symbol: string;
  ts: Date;
  price: number;
  size: number;
  event_type: string;
  is_long: boolean;
  market_id: number;
  contract_address: string;
}

export interface OHLCVCandle {
  symbol: string;
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export interface HealthStats {
  tickCount: number;
  symbolCount: number;
  ohlcv1mCount: number;
  oldestTick?: Date;
  newestTick?: Date;
  oldestCandle?: Date;
  newestCandle?: Date;
}

interface TimeframeConfig {
  interval: string;
  clickhouseInterval: string;
}

const TIMEFRAME_MAP: Record<string, TimeframeConfig> = {
  '1m': { interval: '1m', clickhouseInterval: 'INTERVAL 1 MINUTE' },
  '5m': { interval: '5m', clickhouseInterval: 'INTERVAL 5 MINUTE' },
  '15m': { interval: '15m', clickhouseInterval: 'INTERVAL 15 MINUTE' },
  '30m': { interval: '30m', clickhouseInterval: 'INTERVAL 30 MINUTE' },
  '1h': { interval: '1h', clickhouseInterval: 'INTERVAL 1 HOUR' },
  '4h': { interval: '4h', clickhouseInterval: 'INTERVAL 4 HOUR' },
  '1d': { interval: '1d', clickhouseInterval: 'INTERVAL 1 DAY' },
};

export class ClickHouseDataPipeline {
  private client: ClickHouseClient;
  private database: string;
  private tickBuffer: MarketTick[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BUFFER_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 5000; // 5 seconds

  constructor() {
    this.database = process.env.CLICKHOUSE_DATABASE || 'market_analytics';
    
    this.client = createClient({
      url: process.env.CLICKHOUSE_HOST,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD,
      database: this.database,
      request_timeout: 30000,
    });

    // Start buffer flushing
    this.startBufferFlushing();
  }

  private startBufferFlushing() {
    this.flushInterval = setInterval(() => {
      if (this.tickBuffer.length > 0) {
        this.flushTicks().catch(console.error);
      }
    }, this.FLUSH_INTERVAL_MS);
  }

  /**
   * Insert a single tick into the buffer
   */
  async insertTick(tick: MarketTick): Promise<void> {
    this.tickBuffer.push(tick);
    
    if (this.tickBuffer.length >= this.BUFFER_SIZE) {
      await this.flushTicks();
    }
  }

  /**
   * Insert multiple ticks at once
   */
  async insertTicks(ticks: MarketTick[]): Promise<void> {
    this.tickBuffer.push(...ticks);
    
    if (this.tickBuffer.length >= this.BUFFER_SIZE) {
      await this.flushTicks();
    }
  }

  /**
   * Flush buffered ticks to ClickHouse
   */
  private async flushTicks(): Promise<void> {
    if (this.tickBuffer.length === 0) return;

    const ticksToFlush = [...this.tickBuffer];
    this.tickBuffer = [];

    try {
      await this.client.insert({
        table: 'market_ticks',
        values: ticksToFlush,
        format: 'JSONEachRow'
      });
      
      console.log(`✅ Flushed ${ticksToFlush.length} ticks to ClickHouse`);
    } catch (error) {
      console.error('❌ Failed to flush ticks to ClickHouse:', error);
      // Re-add failed ticks to buffer for retry
      this.tickBuffer.unshift(...ticksToFlush);
      throw error;
    }
  }

  /**
   * Convert ChartDataEvent to ticks and insert
   * This maintains compatibility with existing pusher data
   */
  async processChartData(data: {
    symbol: string;
    timeframe: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
  }): Promise<void> {
    // Convert OHLCV to representative ticks for storage
    const baseTime = new Date(data.timestamp);
    const volumePerTick = data.volume / 4;
    
    const ticks: MarketTick[] = [
      {
        symbol: data.symbol,
        ts: new Date(baseTime.getTime()),
        price: data.open,
        size: volumePerTick,
        event_type: 'open',
        is_long: true,
        market_id: 0,
        contract_address: ''
      },
      {
        symbol: data.symbol,
        ts: new Date(baseTime.getTime() + 15000), // +15s
        price: data.high,
        size: volumePerTick,
        event_type: 'high',
        is_long: true,
        market_id: 0,
        contract_address: ''
      },
      {
        symbol: data.symbol,
        ts: new Date(baseTime.getTime() + 30000), // +30s
        price: data.low,
        size: volumePerTick,
        event_type: 'low',
        is_long: false,
        market_id: 0,
        contract_address: ''
      },
      {
        symbol: data.symbol,
        ts: new Date(baseTime.getTime() + 45000), // +45s
        price: data.close,
        size: volumePerTick,
        event_type: 'close',
        is_long: true,
        market_id: 0,
        contract_address: ''
      }
    ];

    await this.insertTicks(ticks);
  }

  /**
   * Get OHLCV candles for any timeframe using dynamic aggregation
   * This replaces all the individual timeframe tables
   */
  async getOHLCVCandles(
    symbol: string,
    timeframe: string,
    limit: number = 200,
    startTime?: Date,
    endTime?: Date
  ): Promise<OHLCVCandle[]> {
    const config = TIMEFRAME_MAP[timeframe];
    if (!config) {
      throw new Error(`Unsupported timeframe: ${timeframe}`);
    }

    let query: string;
    let whereConditions = [`symbol = '${symbol}'`];

    if (timeframe === '1m') {
      // Direct query from ohlcv_1m table
      if (startTime) {
        whereConditions.push(`ts >= '${startTime.toISOString().slice(0, 19).replace('T', ' ')}'`);
      }
      if (endTime) {
        whereConditions.push(`ts <= '${endTime.toISOString().slice(0, 19).replace('T', ' ')}'`);
      }

      query = `
        SELECT
          symbol,
          toUnixTimestamp(ts) AS time,
          open,
          high,
          low,
          close,
          volume,
          trades
        FROM ohlcv_1m
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY ts DESC
        LIMIT ${limit}
      `;
    } else {
      // Dynamic aggregation from ohlcv_1m for higher timeframes
      if (startTime) {
        whereConditions.push(`ts >= '${startTime.toISOString().slice(0, 19).replace('T', ' ')}'`);
      }
      if (endTime) {
        whereConditions.push(`ts <= '${endTime.toISOString().slice(0, 19).replace('T', ' ')}'`);
      }

      query = `
        SELECT
          symbol,
          toUnixTimestamp(bucket_ts) AS time,
          any(open) AS open,
          max(high) AS high,
          min(low) AS low,
          anyLast(close) AS close,
          sum(volume) AS volume,
          sum(trades) AS trades
        FROM (
          SELECT
            symbol,
            toStartOfInterval(ts, ${config.clickhouseInterval}, 'UTC') AS bucket_ts,
            open,
            high,
            low,
            close,
            volume,
            trades,
            ts
          FROM ohlcv_1m
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY ts ASC
        )
        GROUP BY symbol, bucket_ts
        ORDER BY bucket_ts DESC
        LIMIT ${limit}
      `;
    }

    try {
      const result = await this.client.query({
        query,
        format: 'JSONEachRow'
      });

      const data = await result.json<OHLCVCandle[]>();
      
      // Return in chronological order (oldest first)
      return data.reverse();
    } catch (error) {
      console.error(`❌ Failed to fetch ${timeframe} candles for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get the latest price for a symbol
   */
  async getLatestPrice(symbol: string): Promise<number | null> {
    try {
      const result = await this.client.query({
        query: `
          SELECT close
          FROM ohlcv_1m
          WHERE symbol = '${symbol}'
          ORDER BY ts DESC
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });

      const data = await result.json<{ close: number }[]>();
      return data.length > 0 ? data[0].close : null;
    } catch (error) {
      console.error(`❌ Failed to get latest price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get all available symbols
   */
  async getAvailableSymbols(): Promise<string[]> {
    try {
      const result = await this.client.query({
        query: `
          SELECT DISTINCT symbol
          FROM ohlcv_1m
          ORDER BY symbol ASC
        `,
        format: 'JSONEachRow'
      });

      const data = await result.json<{ symbol: string }[]>();
      return data.map(row => row.symbol);
    } catch (error) {
      console.error('❌ Failed to get available symbols:', error);
      return [];
    }
  }

  /**
   * Get health statistics for monitoring
   */
  async getHealthStats(): Promise<HealthStats> {
    try {
      // Get tick stats
      const tickStatsResult = await this.client.query({
        query: `
          SELECT
            count() AS tickCount,
            uniq(symbol) AS symbolCount,
            min(ts) AS oldestTick,
            max(ts) AS newestTick
          FROM market_ticks
        `,
        format: 'JSONEachRow'
      });

      const tickStats = await tickStatsResult.json<{
        tickCount: number;
        symbolCount: number;
        oldestTick?: string;
        newestTick?: string;
      }[]>();

      // Get candle stats
      const candleStatsResult = await this.client.query({
        query: `
          SELECT
            count() AS ohlcv1mCount,
            min(ts) AS oldestCandle,
            max(ts) AS newestCandle
          FROM ohlcv_1m
        `,
        format: 'JSONEachRow'
      });

      const candleStats = await candleStatsResult.json<{
        ohlcv1mCount: number;
        oldestCandle?: string;
        newestCandle?: string;
      }[]>();

      const tStats = tickStats[0] || {};
      const cStats = candleStats[0] || {};

      return {
        tickCount: tStats.tickCount || 0,
        symbolCount: tStats.symbolCount || 0,
        ohlcv1mCount: cStats.ohlcv1mCount || 0,
        oldestTick: tStats.oldestTick ? new Date(tStats.oldestTick) : undefined,
        newestTick: tStats.newestTick ? new Date(tStats.newestTick) : undefined,
        oldestCandle: cStats.oldestCandle ? new Date(cStats.oldestCandle) : undefined,
        newestCandle: cStats.newestCandle ? new Date(cStats.newestCandle) : undefined,
      };
    } catch (error) {
      console.error('❌ Failed to get health stats:', error);
      return {
        tickCount: 0,
        symbolCount: 0,
        ohlcv1mCount: 0,
      };
    }
  }

  /**
   * Ensure required tables exist
   * In the optimized architecture, this is minimal since the schema script handles setup
   */
  async ensureTables(): Promise<void> {
    try {
      // Verify base tables exist
      await this.client.query({
        query: 'SELECT 1 FROM market_ticks LIMIT 1',
        format: 'JSONEachRow'
      });

      await this.client.query({
        query: 'SELECT 1 FROM ohlcv_1m LIMIT 1',
        format: 'JSONEachRow'
      });

      console.log('✅ ClickHouse tables verified');
    } catch (error) {
      console.error('❌ ClickHouse table verification failed:', error);
      throw new Error(
        'Required ClickHouse tables not found. Please run: node scripts/optimize-clickhouse-schema.js'
      );
    }
  }

  /**
   * Get market statistics for the markets API
   */
  async getMarketStats(
    symbol: string,
    hours: number = 24
  ): Promise<{
    totalVolume: number;
    totalTrades: number;
    avgPrice: number;
    high24h: number;
    low24h: number;
    priceChange24h: number;
    priceChangePercent24h: number;
  } | null> {
    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);

      const result = await this.client.query({
        query: `
          SELECT
            sum(volume) AS totalVolume,
            sum(trades) AS totalTrades,
            avg((high + low) / 2) AS avgPrice,
            max(high) AS high24h,
            min(low) AS low24h,
            first_value(open) OVER (ORDER BY ts ASC) AS openPrice,
            last_value(close) OVER (ORDER BY ts ASC) AS closePrice
          FROM ohlcv_1m
          WHERE symbol = '${symbol}'
            AND ts >= '${startTime.toISOString().slice(0, 19).replace('T', ' ')}'
            AND ts <= '${endTime.toISOString().slice(0, 19).replace('T', ' ')}'
        `,
        format: 'JSONEachRow'
      });

      const data = await result.json<{
        totalVolume: number;
        totalTrades: number;
        avgPrice: number;
        high24h: number;
        low24h: number;
        openPrice: number;
        closePrice: number;
      }[]>();

      if (data.length === 0) return null;

      const stats = data[0];
      const priceChange24h = stats.closePrice - stats.openPrice;
      const priceChangePercent24h = stats.openPrice > 0 
        ? (priceChange24h / stats.openPrice) * 100 
        : 0;

      return {
        totalVolume: stats.totalVolume || 0,
        totalTrades: stats.totalTrades || 0,
        avgPrice: stats.avgPrice || 0,
        high24h: stats.high24h || 0,
        low24h: stats.low24h || 0,
        priceChange24h,
        priceChangePercent24h,
      };
    } catch (error) {
      console.error(`❌ Failed to get market stats for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Close the client and cleanup
   */
  async close(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    
    // Flush any remaining ticks
    await this.flushTicks();
    
    await this.client.close();
    console.log('✅ ClickHouse client closed');
  }
}

// Singleton instance
let clickhouseInstance: ClickHouseDataPipeline | null = null;

export function getClickHouseDataPipeline(): ClickHouseDataPipeline {
  if (!clickhouseInstance) {
    clickhouseInstance = new ClickHouseDataPipeline();
  }
  return clickhouseInstance;
}

// Initialize tables on startup
export async function initializeClickHouse(): Promise<void> {
  const pipeline = getClickHouseDataPipeline();
  await pipeline.ensureTables();
}

// Backward compatibility - export the ClickHouse client constructor
export { createClient } from '@clickhouse/client'; 