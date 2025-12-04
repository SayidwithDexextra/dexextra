// src/lib/clickhouse-client.ts
// Optimized ClickHouse client with dynamic aggregation
// Architecture: market_ticks → ohlcv_1m → dynamic aggregation for higher timeframes

import { createClient, ClickHouseClient } from '@clickhouse/client';
import { createClient as createSbClient, SupabaseClient } from '@supabase/supabase-js';

export interface MarketTick {
  symbol: string;
  ts: Date;
  price: number;
  size: number;
  event_type: string;
  is_long: boolean;
  market_id: number;
  contract_address: string;
  // Optional Supabase market UUID tag for cross-system lineage
  market_uuid?: string;
}

export interface OrderbookTrade {
  symbol: string;
  ts: Date;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  maker?: boolean;
  trade_id?: string;
  order_id?: string;
  market_id?: number;
  contract_address?: string;
  // Optional Supabase market UUID tag for cross-system lineage
  market_uuid?: string;
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
  tickCount: number; // legacy vAMM ticks or trades fallback
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
  private client: ClickHouseClient | null = null;
  private database: string;
  private tickBuffer: MarketTick[] = [];
  private tradeBuffer: OrderbookTrade[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BUFFER_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 5000; // 5 seconds
  private initialized: boolean = false;
  // Cached feature detection for optional columns
  private supportsTradeMarketUuid: boolean | null = null;
  private supportsTickMarketUuid: boolean | null = null;
  // Lazy Supabase admin client for market lookups
  private supabase: SupabaseClient | null = null;

  constructor() {
    this.database = process.env.CLICKHOUSE_DATABASE || 'default';
    // Don't initialize client at construction time - do it lazily when needed
  }

  /**
   * Lazy initialization of ClickHouse client
   * Only creates the client when actually needed (not during build)
   */
  private ensureClient(): ClickHouseClient {
    if (this.client) {
      return this.client;
    }

    const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
    
    if (!url) {
      throw new Error(
        'ClickHouse URL not configured. Please set CLICKHOUSE_URL or CLICKHOUSE_HOST environment variable.'
      );
    }

    this.client = createClient({
      url,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD,
      database: this.database,
      request_timeout: 30000,
    });

    // Start buffer flushing only after client is initialized
    if (!this.initialized) {
      this.startBufferFlushing();
      this.initialized = true;
    }

    return this.client;
  }

  /**
   * Lazy init of Supabase admin client for market lookups
   */
  private ensureSupabase(): SupabaseClient | null {
    if (this.supabase) return this.supabase;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      return null;
    }
    this.supabase = createSbClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    return this.supabase;
  }

  /**
   * Resolve Supabase market metadata by symbol
   */
  private async resolveMarketBySymbol(symbol: string): Promise<{ marketUuid?: string; contractAddress?: string } | null> {
    const sb = this.ensureSupabase();
    if (!sb) return null;
    try {
      const { data, error } = await sb
        .from('markets')
        .select('id, symbol, market_address, market_status')
        .ilike('symbol', symbol)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      if (!data) return null;
      return { marketUuid: String(data.id), contractAddress: data.market_address || undefined };
    } catch {
      return null;
    }
  }

  /**
   * Check if ClickHouse is configured
   */
  isConfigured(): boolean {
    const url = ensureUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
    return !!url;
  }

  /**
   * Detect if a table contains a specific column; cache the result.
   */
  private async supportsColumn(table: 'trades' | 'market_ticks', column: string): Promise<boolean> {
    const cacheKey = table === 'trades' ? 'supportsTradeMarketUuid' : 'supportsTickMarketUuid';
    const cached = this[cacheKey as keyof this] as boolean | null;
    if (cached !== null) return cached;
    try {
      const result = await this.ensureClient().query({
        query: `DESCRIBE TABLE ${table}`,
        format: 'JSONEachRow'
      });
      const rows = (await result.json()) as Array<{ name: string }>;
      const ok = Array.isArray(rows) && rows.some(r => String(r.name) === column);
      if (table === 'trades') this.supportsTradeMarketUuid = ok;
      if (table === 'market_ticks') this.supportsTickMarketUuid = ok;
      return ok;
    } catch {
      if (table === 'trades') this.supportsTradeMarketUuid = false;
      if (table === 'market_ticks') this.supportsTickMarketUuid = false;
      return false;
    }
  }

  /**
   * Insert trade immediately (serverless-safe). Accepts single or array.
   */
  async insertTradeImmediate(tradeOrTrades: OrderbookTrade | OrderbookTrade[]): Promise<void> {
    if (!this.isConfigured()) {
      console.warn('⚠️ ClickHouse not configured, skipping trade insert');
      return;
    }
    const values = Array.isArray(tradeOrTrades) ? tradeOrTrades : [tradeOrTrades];
    if (values.length === 0) return;
    const allowMarketUuid = await this.supportsColumn('trades', 'market_uuid');
    const mapped = allowMarketUuid
      ? values
      : values.map(({ market_uuid, ...rest }) => rest);
    await this.ensureClient().insert({
      table: 'trades',
      values: mapped,
      format: 'JSONEachRow'
    });
  }

  /**
   * Insert tick immediately (serverless-safe). Accepts single or array.
   */
  async insertTickImmediate(tickOrTicks: MarketTick | MarketTick[]): Promise<void> {
    if (!this.isConfigured()) {
      console.warn('⚠️ ClickHouse not configured, skipping tick insert');
      return;
    }
    const values = Array.isArray(tickOrTicks) ? tickOrTicks : [tickOrTicks];
    if (values.length === 0) return;
    const allowMarketUuid = await this.supportsColumn('market_ticks', 'market_uuid');
    const mapped = allowMarketUuid
      ? values
      : values.map(({ market_uuid, ...rest }) => rest);
    await this.ensureClient().insert({
      table: 'market_ticks',
      values: mapped,
      format: 'JSONEachRow'
    });
  }

  /**
   * Fetch the most recent 1m candle for a symbol.
   */
  async fetchLatestOhlcv1m(symbol: string): Promise<OHLCVCandle | null> {
    if (!this.isConfigured()) {
      return null;
    }
    const result = await this.ensureClient().query({
      query: `
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
        WHERE symbol = '${symbol}'
        ORDER BY ts DESC
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const rows = (await result.json()) as any[];
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    return {
      symbol: String(row.symbol),
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      trades: Number(row.trades)
    };
  }

  private startBufferFlushing() {
    this.flushInterval = setInterval(() => {
      if (this.tickBuffer.length > 0) {
        this.flushTicks().catch(console.error);
      }
      if (this.tradeBuffer.length > 0) {
        this.flushTrades().catch(console.error);
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
    if (!this.isConfigured()) {
      console.warn('⚠️ ClickHouse not configured, clearing tick buffer');
      this.tickBuffer = [];
      return;
    }

    const ticksToFlush = [...this.tickBuffer];
    this.tickBuffer = [];

    try {
      const allowMarketUuid = await this.supportsColumn('market_ticks', 'market_uuid');
      const mapped = allowMarketUuid
        ? ticksToFlush
        : ticksToFlush.map(({ market_uuid, ...rest }) => rest);
      await this.ensureClient().insert({
        // Legacy vAMM raw events table (kept for backward compatibility)
        table: 'market_ticks',
        values: mapped,
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
   * Insert a single order-book trade into the buffer
   */
  async insertTrade(trade: OrderbookTrade): Promise<void> {
    this.tradeBuffer.push(trade);
    if (this.tradeBuffer.length >= this.BUFFER_SIZE) {
      await this.flushTrades();
    }
  }

  /**
   * Insert multiple trades at once
   */
  async insertTrades(trades: OrderbookTrade[]): Promise<void> {
    this.tradeBuffer.push(...trades);
    if (this.tradeBuffer.length >= this.BUFFER_SIZE) {
      await this.flushTrades();
    }
  }

  /**
   * Flush buffered trades to ClickHouse
   */
  private async flushTrades(): Promise<void> {
    if (this.tradeBuffer.length === 0) return;
    if (!this.isConfigured()) {
      console.warn('⚠️ ClickHouse not configured, clearing trade buffer');
      this.tradeBuffer = [];
      return;
    }

    const tradesToFlush = [...this.tradeBuffer];
    this.tradeBuffer = [];

    try {
      const allowMarketUuid = await this.supportsColumn('trades', 'market_uuid');
      const mapped = allowMarketUuid
        ? tradesToFlush
        : tradesToFlush.map(({ market_uuid, ...rest }) => rest);
      await this.ensureClient().insert({
        table: 'trades',
        values: mapped,
        format: 'JSONEachRow'
      });
      console.log(`✅ Flushed ${tradesToFlush.length} trades to ClickHouse`);
    } catch (error) {
      console.error('❌ Failed to flush trades to ClickHouse:', error);
      // Re-add failed trades to buffer for retry
      this.tradeBuffer.unshift(...tradesToFlush);
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
    // Best effort market lookup (Supabase UUID)
    let marketUuid: string | undefined;
    let contractAddressHint: string | undefined;
    try {
      const resolved = await this.resolveMarketBySymbol(String(data.symbol).toUpperCase());
      marketUuid = resolved?.marketUuid;
      contractAddressHint = resolved?.contractAddress;
    } catch {}

    const ticks: MarketTick[] = [
      {
        symbol: data.symbol,
        ts: new Date(baseTime.getTime()),
        price: data.open,
        size: volumePerTick,
        event_type: 'open',
        is_long: true,
        market_id: 0,
        contract_address: contractAddressHint || '',
        market_uuid: marketUuid
      },
      {
        symbol: data.symbol,
        ts: new Date(baseTime.getTime() + 15000), // +15s
        price: data.high,
        size: volumePerTick,
        event_type: 'high',
        is_long: true,
        market_id: 0,
        contract_address: contractAddressHint || '',
        market_uuid: marketUuid
      },
      {
        symbol: data.symbol,
        ts: new Date(baseTime.getTime() + 30000), // +30s
        price: data.low,
        size: volumePerTick,
        event_type: 'low',
        is_long: false,
        market_id: 0,
        contract_address: contractAddressHint || '',
        market_uuid: marketUuid
      },
      {
        symbol: data.symbol,
        ts: new Date(baseTime.getTime() + 45000), // +45s
        price: data.close,
        size: volumePerTick,
        event_type: 'close',
        is_long: true,
        market_id: 0,
        contract_address: contractAddressHint || '',
        market_uuid: marketUuid
      }
    ];

    await this.insertTicks(ticks);
  }

  /**
   * Convert an order-book trade-like event into a ClickHouse trade row and insert
   */
  async processTradeEvent(data: {
    symbol: string;
    price: number;
    size: number;
    side: 'buy' | 'sell';
    timestamp: number | Date;
    tradeId?: string;
    orderId?: string;
    marketId?: number;
    contractAddress?: string;
    maker?: boolean;
  }): Promise<void> {
    const ts =
      typeof data.timestamp === 'number'
        ? new Date(data.timestamp)
        : data.timestamp;

    const trade: OrderbookTrade = {
      symbol: data.symbol,
      ts,
      price: data.price,
      size: data.size,
      side: data.side,
      trade_id: data.tradeId,
      order_id: data.orderId,
      market_id: data.marketId,
      contract_address: data.contractAddress,
      maker: data.maker,
    };

    await this.insertTrade(trade);
  }

  /**
   * Get OHLCV candles for any timeframe using dynamic aggregation
   * This replaces all the individual timeframe tables
   */
  async getOHLCVCandles(
    symbol: string | undefined,
    timeframe: string,
    limit: number = 200,
    startTime?: Date,
    endTime?: Date,
    marketUuid?: string
  ): Promise<OHLCVCandle[]> {
    const config = TIMEFRAME_MAP[timeframe];
    if (!config) {
      throw new Error(`Unsupported timeframe: ${timeframe}`);
    }

    let query: string;
    const whereConditions: string[] = [];
    if (symbol) {
      whereConditions.push(`symbol = '${symbol}'`);
    }
    if (marketUuid) {
      whereConditions.push(`market_uuid = '${marketUuid}'`);
    }
    // Use a safe default WHERE clause when no filters are provided
    const whereClause = whereConditions.length > 0 ? whereConditions.join(' AND ') : '1=1';
    // Normalize optional time range to epoch seconds to avoid timezone ambiguity
    const startEpochSec = startTime ? Math.floor(startTime.getTime() / 1000) : undefined;
    const endEpochSec = endTime ? Math.floor(endTime.getTime() / 1000) : undefined;

    if (timeframe === '1m') {
      // Direct query from ohlcv_1m table
      if (typeof startEpochSec === 'number') {
        whereConditions.push(`toUnixTimestamp(ts) >= ${startEpochSec}`);
      }
      if (typeof endEpochSec === 'number') {
        whereConditions.push(`toUnixTimestamp(ts) <= ${endEpochSec}`);
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
        WHERE ${whereClause}
        ORDER BY ts DESC
        LIMIT ${limit}
      `;
    } else {
      // Dynamic aggregation from ohlcv_1m for higher timeframes
      if (typeof startEpochSec === 'number') {
        whereConditions.push(`toUnixTimestamp(ts) >= ${startEpochSec}`);
      }
      if (typeof endEpochSec === 'number') {
        whereConditions.push(`toUnixTimestamp(ts) <= ${endEpochSec}`);
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
          WHERE ${whereClause}
          ORDER BY ts ASC
        )
        GROUP BY symbol, bucket_ts
        ORDER BY bucket_ts DESC
        LIMIT ${limit}
      `;
    }

    if (!this.isConfigured()) {
      return [];
    }

    try {
      const result = await this.ensureClient().query({
        query,
        format: 'JSONEachRow'
      });

      const data = (await result.json()) as any[];
      const mapped: OHLCVCandle[] = (data || []).map((row: any) => ({
        symbol: String(row.symbol),
        time: Number(row.time),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
        trades: Number(row.trades),
      }));
      // Return in chronological order (oldest first)
      return mapped.reverse();
    } catch (error) {
      console.error(`❌ Failed to fetch ${timeframe} candles for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get the latest price for a symbol
   */
  async getLatestPrice(symbol: string): Promise<number | null> {
    if (!this.isConfigured()) {
      return null;
    }
    try {
      const result = await this.ensureClient().query({
        query: `
          SELECT close
          FROM ohlcv_1m
          WHERE symbol = '${symbol}'
          ORDER BY ts DESC
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });

      const data = (await result.json()) as any[];
      return data.length > 0 ? Number(data[0].close) : null;
    } catch (error) {
      console.error(`❌ Failed to get latest price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get all available symbols
   */
  async getAvailableSymbols(): Promise<string[]> {
    if (!this.isConfigured()) {
      return [];
    }
    try {
      const result = await this.ensureClient().query({
        query: `
          SELECT DISTINCT symbol
          FROM ohlcv_1m
          ORDER BY symbol ASC
        `,
        format: 'JSONEachRow'
      });

      const data = (await result.json()) as any[];
      return data.map(row => String(row.symbol));
    } catch (error) {
      console.error('❌ Failed to get available symbols:', error);
      return [];
    }
  }

  /**
   * Get health statistics for monitoring
   */
  async getHealthStats(): Promise<HealthStats> {
    if (!this.isConfigured()) {
      return {
        tickCount: 0,
        symbolCount: 0,
        ohlcv1mCount: 0,
      };
    }
    try {
      // Prefer order-book trades as primary source of truth
      let tickStats: any[] = [];
      try {
        const tradesStatsResult = await this.ensureClient().query({
          query: `
            SELECT
              count() AS tickCount,
              uniq(symbol) AS symbolCount,
              min(ts) AS oldestTick,
              max(ts) AS newestTick
            FROM trades
          `,
          format: 'JSONEachRow'
        });
        tickStats = (await tradesStatsResult.json()) as any[];
      } catch {
        // Fallback to legacy tables if trades doesn't exist
        try {
          const legacyStatsResult = await this.ensureClient().query({
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
          tickStats = (await legacyStatsResult.json()) as any[];
        } catch {
          // Last resort: vamm_ticks if present
          const vammStatsResult = await this.ensureClient().query({
            query: `
              SELECT
                count() AS tickCount,
                uniq(symbol) AS symbolCount,
                min(ts) AS oldestTick,
                max(ts) AS newestTick
              FROM vamm_ticks
            `,
            format: 'JSONEachRow'
          });
          tickStats = (await vammStatsResult.json()) as any[];
        }
      }

      // Get candle stats
      const candleStatsResult = await this.ensureClient().query({
        query: `
          SELECT
            count() AS ohlcv1mCount,
            min(ts) AS oldestCandle,
            max(ts) AS newestCandle
          FROM ohlcv_1m
        `,
        format: 'JSONEachRow'
      });

      const candleStats = (await candleStatsResult.json()) as any[];

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
    if (!this.isConfigured()) {
      throw new Error('ClickHouse not configured');
    }
    try {
      // Verify order-book trades table exists (new architecture)
      await this.ensureClient().query({
        query: 'SELECT 1 FROM trades LIMIT 1',
        format: 'JSONEachRow'
      });

      await this.ensureClient().query({
        query: 'SELECT 1 FROM ohlcv_1m LIMIT 1',
        format: 'JSONEachRow'
      });

      console.log('✅ ClickHouse tables verified (trades, ohlcv_1m)');
    } catch (error) {
      console.error('❌ ClickHouse table verification failed:', error);
      throw new Error(
        'Required ClickHouse tables not found. Please run: node scripts/setup-orderbook-clickhouse.js'
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

      if (!this.isConfigured()) {
        return null;
      }

      const result = await this.ensureClient().query({
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

      const data = (await result.json()) as any[];

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
    // Flush any remaining buffers
    await this.flushAll();
    if (this.client) {
      await this.client.close();
      console.log('✅ ClickHouse client closed');
    }
  }

  /**
   * Explicitly flush both buffers (serverless-safe).
   */
  async flushAll(): Promise<void> {
    await this.flushTicks();
    await this.flushTrades();
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

function ensureUrl(value?: string): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}