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
  // Optional tie-breaker for deterministic open/close (e.g. txHash:logIndex or synthetic id)
  event_id?: string;
  // Optional: 1 for real trades, 0 for synthetic candle-derived ticks
  trade_count?: number;
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

export interface TopVolumeMarketRow {
  marketUuid: string;
  symbol: string | null;
  baseVolume: number;
  notionalVolume: number;
  trades: number;
}

export interface TrendingMarketRow extends TopVolumeMarketRow {
  base1h: number;
  notional1h: number;
  notionalPrev1h: number;
  trades1h: number;
  open1h: number | null;
  close1h: number | null;
  priceChange1hPct: number;
  open24h: number | null;
  close24h: number | null;
  priceChange24hPct: number;
  accel1h: number;
  score: number;
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
  '1w': { interval: '1w', clickhouseInterval: 'INTERVAL 1 WEEK' },
  '1mo': { interval: '1mo', clickhouseInterval: 'INTERVAL 1 MONTH' },
};

function looksLikeUuid(value: string): boolean {
  const v = String(value || '').trim();
  // Canonical UUID v1-v5 shape
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export class ClickHouseDataPipeline {
  private client: ClickHouseClient | null = null;
  private database: string;
  private tickBuffer: MarketTick[] = [];
  private tradeBuffer: OrderbookTrade[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BUFFER_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 5000; // 5 seconds
  private initialized: boolean = false;
  // Cached feature detection for optional columns (table -> column -> supported)
  private columnSupportCache: Map<string, Map<string, boolean>> = new Map();
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
      request_timeout: 5000,
      keep_alive: { enabled: true },
      compression: { request: true, response: true },
      clickhouse_settings: {
        max_threads: 4,
        async_insert: 1,
        max_block_size: 10000,
        optimize_move_to_prewhere: 1,
      },
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
    const sym = String(symbol || '').trim();
    if (!sym) return null;
    try {
      // Prefer orderbook markets view (canonical for TradingView + realtime)
      try {
        const { data: ob } = await sb
          .from('orderbook_markets_view')
          .select('id, metric_id, symbol, market_address, is_active, deployment_status')
          .or(`ilike.metric_id.${sym},ilike.symbol.${sym}`)
          .eq('is_active', true)
          .eq('deployment_status', 'DEPLOYED')
          .not('market_address', 'is', null)
          .limit(1)
          .maybeSingle();
        if (ob?.id) {
          return { marketUuid: String((ob as any).id), contractAddress: (ob as any).market_address || undefined };
        }
      } catch {
        // ignore and fall back
      }

      // Fallback to legacy `markets` table (vAMM / non-orderbook deployments)
      const { data, error } = await sb
        .from('markets')
        .select('id, symbol, market_address, market_status')
        .ilike('symbol', sym)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      return { marketUuid: String((data as any).id), contractAddress: (data as any).market_address || undefined };
    } catch {
      return null;
    }
  }

  /**
   * Resolve Supabase market metadata by market UUID (markets.id)
   */
  private async resolveMarketByUuid(marketUuid: string): Promise<{ symbol?: string; contractAddress?: string } | null> {
    const sb = this.ensureSupabase();
    if (!sb) return null;
    const id = String(marketUuid || '').trim();
    if (!id) return null;
    try {
      // Prefer orderbook markets view (this is what TradingView resolves + uses as UUID)
      try {
        const { data: ob } = await sb
          .from('orderbook_markets_view')
          .select('id, metric_id, symbol, market_address')
          .eq('id', id)
          .limit(1)
          .maybeSingle();
        if (ob) {
          const sym = (ob as any).metric_id || (ob as any).symbol;
          return {
            symbol: sym ? String(sym).toUpperCase() : undefined,
            contractAddress: (ob as any).market_address || undefined
          };
        }
      } catch {
        // ignore and fall back
      }

      // Fallback: resolved orderbook table (if present in a given env)
      try {
        const { data: r } = await sb
          .from('orderbook_markets_resolved')
          .select('id, metric_id, symbol, market_address')
          .eq('id', id)
          .limit(1)
          .maybeSingle();
        if (r) {
          const sym = (r as any).metric_id || (r as any).symbol;
          return {
            symbol: sym ? String(sym).toUpperCase() : undefined,
            contractAddress: (r as any).market_address || undefined
          };
        }
      } catch {
        // ignore and fall back
      }

      // Fallback to legacy `markets` table
      const { data, error } = await sb
        .from('markets')
        .select('id, symbol, market_address')
        .eq('id', id)
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      return {
        symbol: (data as any).symbol ? String((data as any).symbol).toUpperCase() : undefined,
        contractAddress: (data as any).market_address || undefined
      };
    } catch {
      return null;
    }
  }

  /**
   * Pre-warm the ClickHouse connection (TLS handshake + auth).
   * Call this at module-load time so the first real query doesn't pay the cold-start penalty.
   */
  async warmConnection(): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      await this.ensureClient().query({ query: 'SELECT 1', format: 'JSONEachRow' });
    } catch {
      // Swallow — warmup is best-effort
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
   * Top-volume markets over a time window.
   *
   * - baseVolume = sum(size)
   * - notionalVolume = sum(price * size)
   * - trades = sum(trade_count) when available, else count()
   *
   * NOTE: We compute from `market_ticks` (canonical). This is more reliable than `ohlcv_1m`
   * for ranking queries because `ohlcv_1m` can contain partial MV rows per minute when ticks
   * are inserted in separate batches.
   */
  async getTopVolumeMarkets(opts?: {
    windowHours?: number;
    limit?: number;
    minTrades?: number;
    minNotional?: number;
  }): Promise<TopVolumeMarketRow[]> {
    if (!this.isConfigured()) return [];

    const windowHours = Math.max(1, Math.min(24 * 30, Number(opts?.windowHours ?? 24)));
    const limit = Math.max(1, Math.min(500, Number(opts?.limit ?? 50)));
    const minTrades = Math.max(0, Number(opts?.minTrades ?? 0));
    const minNotional = Math.max(0, Number(opts?.minNotional ?? 0));

    const allowEventId = await this.supportsColumn('market_ticks', 'event_id');
    const allowTradeCount = await this.supportsColumn('market_ticks', 'trade_count');
    const tradesExpr = allowTradeCount ? 'sum(trade_count)' : 'count()';

    // Keep `event_id` detection for parity with other queries; top volume doesn't need it today,
    // but we intentionally probe it once so callers have consistent behavior across deployments.
    void allowEventId;

    const result = await this.ensureClient().query({
      query: `
        SELECT
          market_uuid,
          anyLast(symbol) AS symbol,
          sum(size) AS baseVolume,
          sum(price * size) AS notionalVolume,
          ${tradesExpr} AS trades
        FROM market_ticks
        WHERE market_uuid != ''
          AND ts >= now() - INTERVAL ${windowHours} HOUR
        GROUP BY market_uuid
        HAVING trades >= ${minTrades}
          AND notionalVolume >= ${minNotional}
        ORDER BY notionalVolume DESC
        LIMIT ${limit}
      `,
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as any[];
    return (rows || []).map((r: any) => ({
      marketUuid: String(r.market_uuid),
      symbol: r.symbol != null ? String(r.symbol) : null,
      baseVolume: Number(r.baseVolume) || 0,
      notionalVolume: Number(r.notionalVolume) || 0,
      trades: Number(r.trades) || 0,
    }));
  }

  /**
   * Trending markets using a hybrid score:
   * - volume/notional (1h + 24h)
   * - trade count (1h)
   * - momentum (abs % change 1h + 24h)
   * - acceleration (1h notional vs previous 1h)
   *
   * Derived from `market_ticks` only (canonical), using `event_id` tie-breaker when available
   * to compute deterministic open/close.
   */
  async getTrendingMarkets(opts?: {
    limit?: number;
    minTrades24h?: number;
    minNotional24h?: number;
    /** Window for the “24h” aggregates (default: 24). */
    windowHours?: number;
    weights?: Partial<{
      notional1h: number;
      notional24h: number;
      trades1h: number;
      absPriceChange1hPct: number;
      absPriceChange24hPct: number;
      accel1h: number;
    }>;
  }): Promise<TrendingMarketRow[]> {
    if (!this.isConfigured()) return [];

    const limit = Math.max(1, Math.min(500, Number(opts?.limit ?? 50)));
    const minTrades24h = Math.max(0, Number(opts?.minTrades24h ?? 0));
    const minNotional24h = Math.max(0, Number(opts?.minNotional24h ?? 0));
    const windowHours = Math.max(1, Math.min(24 * 30, Number(opts?.windowHours ?? 24)));

    const w = {
      notional1h: 0.35,
      notional24h: 0.15,
      trades1h: 0.2,
      absPriceChange1hPct: 0.15,
      absPriceChange24hPct: 0.1,
      accel1h: 0.05,
      ...(opts?.weights || {}),
    };

    const allowEventId = await this.supportsColumn('market_ticks', 'event_id');
    const allowTradeCount = await this.supportsColumn('market_ticks', 'trade_count');
    const tradesExpr24h = allowTradeCount ? 'sumIf(trade_count, ts >= t_24h)' : 'countIf(ts >= t_24h)';
    const tradesExpr1h = allowTradeCount ? 'sumIf(trade_count, ts >= t_1h)' : 'countIf(ts >= t_1h)';
    const eventWeight = allowEventId ? '(ts, event_id)' : 'ts';

    const result = await this.ensureClient().query({
      query: `
        WITH
          now() AS t_now,
          (t_now - INTERVAL 1 HOUR) AS t_1h,
          (t_now - INTERVAL 2 HOUR) AS t_2h,
          (t_now - INTERVAL ${windowHours} HOUR) AS t_24h
        SELECT
          market_uuid,
          anyLast(symbol) AS symbol,

          sumIf(size, ts >= t_24h) AS baseVolume,
          sumIf(price * size, ts >= t_24h) AS notionalVolume,
          ${tradesExpr24h} AS trades,

          sumIf(size, ts >= t_1h) AS base1h,
          sumIf(price * size, ts >= t_1h) AS notional1h,
          sumIf(price * size, ts >= t_2h AND ts < t_1h) AS notionalPrev1h,
          ${tradesExpr1h} AS trades1h,

          argMinIf(price, ${eventWeight}, ts >= t_1h) AS open1h,
          argMaxIf(price, ${eventWeight}, ts >= t_1h) AS close1h,
          if(open1h > 0, (close1h - open1h) / open1h * 100, 0) AS priceChange1hPct,

          argMinIf(price, ${eventWeight}, ts >= t_24h) AS open24h,
          argMaxIf(price, ${eventWeight}, ts >= t_24h) AS close24h,
          if(open24h > 0, (close24h - open24h) / open24h * 100, 0) AS priceChange24hPct,

          notional1h / greatest(notionalPrev1h, 1e-9) AS accel1h,

          (
            ${Number(w.notional1h)} * log1p(notional1h)
            + ${Number(w.notional24h)} * log1p(notionalVolume)
            + ${Number(w.trades1h)} * log1p(trades1h)
            + ${Number(w.absPriceChange1hPct)} * abs(priceChange1hPct)
            + ${Number(w.absPriceChange24hPct)} * abs(priceChange24hPct)
            + ${Number(w.accel1h)} * log1p(accel1h)
          ) AS score
        FROM market_ticks
        WHERE market_uuid != ''
          AND ts >= t_24h
        GROUP BY market_uuid
        HAVING trades >= ${minTrades24h}
          AND notionalVolume >= ${minNotional24h}
        ORDER BY score DESC
        LIMIT ${limit}
      `,
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as any[];
    return (rows || []).map((r: any) => ({
      marketUuid: String(r.market_uuid),
      symbol: r.symbol != null ? String(r.symbol) : null,
      baseVolume: Number(r.baseVolume) || 0,
      notionalVolume: Number(r.notionalVolume) || 0,
      trades: Number(r.trades) || 0,
      base1h: Number(r.base1h) || 0,
      notional1h: Number(r.notional1h) || 0,
      notionalPrev1h: Number(r.notionalPrev1h) || 0,
      trades1h: Number(r.trades1h) || 0,
      open1h: r.open1h != null ? Number(r.open1h) : null,
      close1h: r.close1h != null ? Number(r.close1h) : null,
      priceChange1hPct: Number(r.priceChange1hPct) || 0,
      open24h: r.open24h != null ? Number(r.open24h) : null,
      close24h: r.close24h != null ? Number(r.close24h) : null,
      priceChange24hPct: Number(r.priceChange24hPct) || 0,
      accel1h: Number(r.accel1h) || 0,
      score: Number(r.score) || 0,
    }));
  }

  private ohlcv1hAvailable: boolean | null = null;

  /**
   * Check if the pre-aggregated ohlcv_1h table exists (cached per instance lifetime).
   */
  private async hasOhlcv1h(): Promise<boolean> {
    if (this.ohlcv1hAvailable !== null) return this.ohlcv1hAvailable;
    try {
      await this.ensureClient().query({
        query: 'SELECT 1 FROM ohlcv_1h LIMIT 0',
        format: 'JSONEachRow',
      });
      this.ohlcv1hAvailable = true;
    } catch {
      this.ohlcv1hAvailable = false;
    }
    return this.ohlcv1hAvailable;
  }

  /**
   * Detect if a table contains a specific column; cache the result.
   */
  private async supportsColumn(table: 'trades' | 'market_ticks', column: string): Promise<boolean> {
    let tCache = this.columnSupportCache.get(table);
    if (!tCache) {
      tCache = new Map<string, boolean>();
      this.columnSupportCache.set(table, tCache);
    }
    const cached = tCache.get(column);
    if (typeof cached === 'boolean') return cached;
    try {
      const result = await this.ensureClient().query({
        query: `DESCRIBE TABLE ${table}`,
        format: 'JSONEachRow'
      });
      const rows = (await result.json()) as Array<{ name: string }>;
      const ok = Array.isArray(rows) && rows.some(r => String(r.name) === column);
      tCache.set(column, ok);
      return ok;
    } catch {
      tCache.set(column, false);
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
    const allowEventId = await this.supportsColumn('market_ticks', 'event_id');
    const allowTradeCount = await this.supportsColumn('market_ticks', 'trade_count');
    const mapped = values.map((v) => {
      const { market_uuid, event_id, trade_count, ...rest } = v as any;
      const row: any = { ...rest };
      if (allowMarketUuid) {
        // Last-line defense: if someone accidentally passes UUID as symbol, keep market_uuid coherent.
        row.market_uuid = market_uuid || (looksLikeUuid(String(row.symbol || '')) ? String(row.symbol) : undefined);
      }
      if (allowEventId) row.event_id = event_id || '';
      if (allowTradeCount) row.trade_count = Number.isFinite(Number(trade_count)) ? Number(trade_count) : 1;
      return row;
    });
    await this.ensureClient().insert({
      table: 'market_ticks',
      values: mapped,
      format: 'JSONEachRow'
    });
  }

  /**
   * Fetch the most recent 1m candle for a symbol.
   * NOTE: ohlcv_1m is ordered by (market_uuid, ts). Filtering on symbol alone
   * bypasses the primary index. Prefer fetchLatestOhlcv1mByMarketUuid when possible.
   */
  async fetchLatestOhlcv1m(symbol: string): Promise<OHLCVCandle | null> {
    if (!this.isConfigured()) {
      return null;
    }
    const safe = escapeSqlString(symbol);
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
        WHERE symbol = '${safe}'
        ORDER BY ts DESC
        LIMIT 1
        SETTINGS max_execution_time = 5
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

  /**
   * Fetch the most recent 1m candle for a market UUID (Supabase markets.id).
   * This is the canonical path for realtime streaming, since symbols are not guaranteed stable.
   */
  async fetchLatestOhlcv1mByMarketUuid(marketUuid: string): Promise<OHLCVCandle | null> {
    if (!this.isConfigured()) {
      return null;
    }
    const id = String(marketUuid || '').replace(/'/g, "\\'");
    if (!id) return null;
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
        WHERE market_uuid = '${id}'
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
      const allowEventId = await this.supportsColumn('market_ticks', 'event_id');
      const allowTradeCount = await this.supportsColumn('market_ticks', 'trade_count');
      const mapped = ticksToFlush.map((v) => {
        const { market_uuid, event_id, trade_count, ...rest } = v as any;
        const row: any = { ...rest };
        if (allowMarketUuid) {
          row.market_uuid = market_uuid || (looksLikeUuid(String(row.symbol || '')) ? String(row.symbol) : undefined);
        }
        if (allowEventId) row.event_id = event_id || '';
        if (allowTradeCount) row.trade_count = Number.isFinite(Number(trade_count)) ? Number(trade_count) : 1;
        return row;
      });
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
    marketUuid?: string;
  }): Promise<void> {
    // Convert OHLCV candle to a small set of synthetic ticks for storage.
    // NOTE: This preserves candle shape, but is not a replacement for real trade-level ticks.
    const baseTime = new Date(data.timestamp);
    // Preserve volume without inflating "trade count": attribute full volume to the open tick only.
    const openSize = Number(data.volume) || 0;
    const incomingSymbol = String(data.symbol || '').trim();
    let marketUuid: string | undefined = data.marketUuid ? String(data.marketUuid).trim() : undefined;
    let contractAddressHint: string | undefined;
    let symbolForStorage = incomingSymbol ? incomingSymbol.toUpperCase() : 'UNKNOWN';

    // If realtime pipelines use market UUID as the subscription "symbol",
    // treat it as market_uuid for ClickHouse and resolve the human symbol.
    const incomingIsUuid = looksLikeUuid(incomingSymbol);
    if (incomingIsUuid && !marketUuid) {
      marketUuid = incomingSymbol;
    }

    try {
      if (marketUuid) {
        const resolvedById = await this.resolveMarketByUuid(marketUuid);
        if (resolvedById?.symbol) symbolForStorage = resolvedById.symbol;
        if (resolvedById?.contractAddress) contractAddressHint = resolvedById.contractAddress;
      } else if (incomingSymbol) {
        // Best effort market lookup (Supabase UUID) by symbol
        const resolved = await this.resolveMarketBySymbol(symbolForStorage);
        marketUuid = resolved?.marketUuid;
        contractAddressHint = resolved?.contractAddress;
      }
    } catch {}

    if (incomingIsUuid && !marketUuid) {
      // We can still store the UUID as the market_uuid if we couldn't resolve it above
      // (e.g. Supabase not configured), which keeps queries market-centric.
      marketUuid = incomingSymbol;
    }

    const candleKey = `${symbolForStorage}:${baseTime.toISOString()}`;
    const ticks: MarketTick[] = [
      {
        symbol: symbolForStorage,
        ts: new Date(baseTime.getTime()),
        price: data.open,
        size: openSize,
        event_type: 'open',
        is_long: true,
        market_id: 0,
        contract_address: contractAddressHint || '',
        market_uuid: marketUuid,
        event_id: `candle:${candleKey}:open`,
        trade_count: 0
      },
      {
        symbol: symbolForStorage,
        ts: new Date(baseTime.getTime() + 15000), // +15s
        price: data.high,
        size: 0,
        event_type: 'high',
        is_long: true,
        market_id: 0,
        contract_address: contractAddressHint || '',
        market_uuid: marketUuid,
        event_id: `candle:${candleKey}:high`,
        trade_count: 0
      },
      {
        symbol: symbolForStorage,
        ts: new Date(baseTime.getTime() + 30000), // +30s
        price: data.low,
        size: 0,
        event_type: 'low',
        is_long: false,
        market_id: 0,
        contract_address: contractAddressHint || '',
        market_uuid: marketUuid,
        event_id: `candle:${candleKey}:low`,
        trade_count: 0
      },
      {
        symbol: symbolForStorage,
        ts: new Date(baseTime.getTime() + 45000), // +45s
        price: data.close,
        size: 0,
        event_type: 'close',
        is_long: true,
        market_id: 0,
        contract_address: contractAddressHint || '',
        market_uuid: marketUuid,
        event_id: `candle:${candleKey}:close`,
        trade_count: 0
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
   * Timeframes that benefit from the pre-aggregated ohlcv_1h table.
   * These would otherwise scan 60-10,080x more rows from ohlcv_1m.
   */
  private static readonly HOURLY_PLUS_TIMEFRAMES = new Set(['1h', '4h', '1d', '1w', '1mo']);

  /**
   * Build PREWHERE/WHERE clauses from filter params.
   * PREWHERE targets primary-key columns (market_uuid, ts) for fast granule skipping.
   * WHERE handles non-primary-key columns (symbol).
   */
  private buildFilterClauses(opts: {
    safeMarketUuid?: string;
    safeSymbol?: string;
    startEpochSec?: number;
    endEpochSec?: number;
  }) {
    const prewhereParts: string[] = [];
    const whereParts: string[] = [];

    if (opts.safeMarketUuid) {
      prewhereParts.push(`market_uuid = '${opts.safeMarketUuid}'`);
    }
    if (typeof opts.startEpochSec === 'number') {
      prewhereParts.push(`ts >= toDateTime(${opts.startEpochSec})`);
    }
    if (typeof opts.endEpochSec === 'number') {
      prewhereParts.push(`ts <= toDateTime(${opts.endEpochSec})`);
    }
    if (opts.safeSymbol) {
      whereParts.push(`symbol = '${opts.safeSymbol}'`);
    }

    return {
      prewhere: prewhereParts.length > 0 ? `PREWHERE ${prewhereParts.join(' AND ')}` : '',
      where: whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '',
    };
  }

  /**
   * Get OHLCV candles for any timeframe.
   *
   * For 1h+ timeframes, prefers the pre-aggregated ohlcv_1h table (up to 60x less data scanned).
   * Falls back to dynamic aggregation from ohlcv_1m when ohlcv_1h is unavailable.
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

    if (!this.isConfigured()) {
      return [];
    }

    const safeSymbol = symbol ? escapeSqlString(String(symbol)) : undefined;
    const safeMarketUuid = marketUuid ? escapeSqlString(String(marketUuid)) : undefined;
    const startEpochSec = startTime ? Math.floor(startTime.getTime() / 1000) : undefined;
    const endEpochSec = endTime ? Math.floor(endTime.getTime() / 1000) : undefined;

    const filterOpts = { safeMarketUuid, safeSymbol, startEpochSec, endEpochSec };

    // Route 1h+ timeframes through ohlcv_1h when available
    if (ClickHouseDataPipeline.HOURLY_PLUS_TIMEFRAMES.has(timeframe) && await this.hasOhlcv1h()) {
      try {
        return await this.getOHLCVCandlesFrom1h(timeframe, config, limit, filterOpts);
      } catch (error) {
        console.warn(`⚠️ ohlcv_1h query failed, falling back to ohlcv_1m:`, error instanceof Error ? error.message : error);
      }
    }

    return this.getOHLCVCandlesFrom1m(timeframe, config, limit, filterOpts);
  }

  /**
   * Query from the pre-aggregated ohlcv_1h table.
   * For exact 1h: GROUP BY ts (merges partial-hour rows from different insert batches).
   * For 4h/1d/1w/1mo: GROUP BY bucket from ohlcv_1h (scans 4-720 rows per bucket vs 240-43200 from 1m).
   */
  private async getOHLCVCandlesFrom1h(
    timeframe: string,
    config: TimeframeConfig,
    limit: number,
    filterOpts: { safeMarketUuid?: string; safeSymbol?: string; startEpochSec?: number; endEpochSec?: number }
  ): Promise<OHLCVCandle[]> {
    const { prewhere, where } = this.buildFilterClauses(filterOpts);

    let query: string;

    if (timeframe === '1h') {
      query = `
        SELECT
          any(symbol) AS symbol,
          toUnixTimestamp(ts) AS time,
          argMin(open, first_ts) AS open,
          max(high) AS high,
          min(low) AS low,
          argMax(close, last_ts) AS close,
          sum(volume) AS volume,
          sum(trades) AS trades
        FROM ohlcv_1h
        ${prewhere}
        ${where}
        GROUP BY ts
        ORDER BY ts DESC
        LIMIT ${limit}
        SETTINGS
          max_execution_time = 8,
          max_threads = 4,
          optimize_aggregation_in_order = 1
      `;
    } else {
      query = `
        SELECT
          any(symbol) AS symbol,
          toStartOfInterval(ts, ${config.clickhouseInterval}, 'UTC') AS bucket_ts,
          toUnixTimestamp(bucket_ts) AS time,
          argMin(open, first_ts) AS open,
          max(high) AS high,
          min(low) AS low,
          argMax(close, last_ts) AS close,
          sum(volume) AS volume,
          sum(trades) AS trades
        FROM ohlcv_1h
        ${prewhere}
        ${where}
        GROUP BY bucket_ts
        ORDER BY bucket_ts DESC
        LIMIT ${limit}
        SETTINGS
          max_execution_time = 8,
          max_threads = 4,
          optimize_aggregation_in_order = 1
      `;
    }

    const result = await this.ensureClient().query({ query, format: 'JSONEachRow' });
    const data = (await result.json()) as any[];
    return (data || []).map((row: any) => ({
      symbol: String(row.symbol),
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      trades: Number(row.trades),
    })).reverse();
  }

  /**
   * Original dynamic-aggregation path from ohlcv_1m.
   * Used for sub-hour timeframes and as fallback when ohlcv_1h is unavailable.
   */
  private async getOHLCVCandlesFrom1m(
    timeframe: string,
    config: TimeframeConfig,
    limit: number,
    filterOpts: { safeMarketUuid?: string; safeSymbol?: string; startEpochSec?: number; endEpochSec?: number }
  ): Promise<OHLCVCandle[]> {
    const { prewhere, where } = this.buildFilterClauses(filterOpts);

    let query: string;

    if (timeframe === '1m') {
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
        ${prewhere}
        ${where}
        ORDER BY ts DESC
        LIMIT ${limit}
        SETTINGS
          max_execution_time = 8,
          max_threads = 4,
          optimize_read_in_order = 1,
          read_in_order_two_level_merge_threshold = 100
      `;
    } else {
      query = `
        SELECT
          symbol,
          toStartOfInterval(ts, ${config.clickhouseInterval}, 'UTC') AS bucket_ts,
          toUnixTimestamp(bucket_ts) AS time,
          argMin(open, ts) AS open,
          max(high) AS high,
          min(low) AS low,
          argMax(close, ts) AS close,
          sum(volume) AS volume,
          sum(trades) AS trades
        FROM ohlcv_1m
        ${prewhere}
        ${where}
        GROUP BY symbol, bucket_ts
        ORDER BY bucket_ts DESC
        LIMIT ${limit}
        SETTINGS
          max_execution_time = 8,
          max_threads = 4,
          optimize_aggregation_in_order = 1
      `;
    }

    try {
      const result = await this.ensureClient().query({ query, format: 'JSONEachRow' });
      const data = (await result.json()) as any[];
      return (data || []).map((row: any) => ({
        symbol: String(row.symbol),
        time: Number(row.time),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
        trades: Number(row.trades),
      })).reverse();
    } catch (error) {
      console.error(`❌ Failed to fetch ${timeframe} candles for ${filterOpts.safeSymbol || filterOpts.safeMarketUuid || 'unknown'}:`, error);
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
      const safe = escapeSqlString(symbol);
      const result = await this.ensureClient().query({
        query: `
          SELECT close
          FROM ohlcv_1m
          WHERE symbol = '${safe}'
          ORDER BY ts DESC
          LIMIT 1
          SETTINGS max_execution_time = 5
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

function escapeSqlString(value: string): string {
  // Minimal defensive escaping for single-quoted ClickHouse string literals.
  // (We control the inputs, but this also prevents accidental quote-breaks.)
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}