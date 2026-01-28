/**
 * Dev helper: push raw trade ticks into ClickHouse `market_ticks` for any market and broadcast
 * updated 1m candles to Pusher (so TradingView realtime updates immediately).
 *
 * Requires the Next dev server running (this script hits the dev API route):
 *   POST /api/dev/market-ticks
 *
 * Metric helper (Live Metric Tracker):
 *   POST /api/charts/metric
 * This path is important because it triggers the Pusher `metric-update` event so the
 * TradingView metric overlay redraws immediately.
 *
 * Interactive usage (recommended):
 *   tsx scripts/push-market-ticks.ts
 *
 * Non-interactive usage:
 *   MARKET_UUID=<uuid> tsx scripts/push-market-ticks.ts --count 50 --intervalMs 1000
 *   SYMBOL=BITCOIN tsx scripts/push-market-ticks.ts --count 50 --intervalMs 1000
 *   MODE=metric MARKET_UUID=<uuid> tsx scripts/push-market-ticks.ts --count 10 --intervalMs 2000 --metricName BITCOIN
 *
 * Optional flags/env:
 *   --baseUrl http://localhost:3000
 *   --mode candle|metric
 *   --metricName BITCOIN
 *   --startPrice 100 --volBps 5
 *   --trend 0|1|2   # 0=uptrend, 1=downtrend, 2=consolidate
 *   --interactive true|false (default: auto)
 *
 * Notes:
 * - This script pulls markets from Supabase for selection when env is configured.
 * - Supabase env expected (any of):
 *   - NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (preferred) or NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

type Args = {
  baseUrl: string;
  marketUuid: string | null;
  symbol: string | null;
  /** If null/undefined, auto-resolve from ClickHouse (preferred). */
  startPrice: number | null;
  volBps: number;
  count: number;
  intervalMs: number;
  trend: TrendMode;
  interactive: boolean;
  mode: InsertMode;
  metricName: string | null;
};

type TrendMode = 'uptrend' | 'downtrend' | 'consolidate';
type InsertMode = 'candle' | 'metric';

type MarketRow = {
  id: string;
  metric_id?: string | null;
  symbol?: string | null;
  name?: string | null;
  category?: string | null;
  market_status?: string | null;
  deployment_status?: string | null;
  is_active?: boolean | null;
  last_trade_price?: number | string | null;
  created_at?: string | null;
};

function getArg(name: string): string | null {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return typeof v === 'string' ? v : null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function looksLikeUuid(value: string): boolean {
  const v = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function ensureUrl(value?: string): string {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `http://${raw}`;
}

function loadEnv() {
  // Next.js loads `.env.local` automatically, but standalone scripts do not.
  // Load `.env.local` first (highest precedence), then `.env` as a fallback.
  const cwd = process.cwd();
  const candidates = ['.env.local', '.env'];
  for (const file of candidates) {
    const full = path.join(cwd, file);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full });
    }
  }
}

function parseBoolLoose(v: string | null | undefined): boolean | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return null;
}

function parseTrendMode(v: string | null | undefined): TrendMode | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s === '0') return 'uptrend';
  if (s === '1') return 'downtrend';
  if (s === '2') return 'consolidate';
  if (s === 'up' || s === 'uptrend' || s === 'up-trend') return 'uptrend';
  if (s === 'down' || s === 'downtrend' || s === 'down-trend') return 'downtrend';
  if (s === 'flat' || s === 'sideways' || s === 'range' || s === 'consolidate' || s === 'consolidation')
    return 'consolidate';
  return null;
}

function parseInsertMode(v: string | null | undefined): InsertMode | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s === 'c' || s === 'candle' || s === 'candles' || s === 'tick' || s === 'ticks') return 'candle';
  if (s === 'm' || s === 'metric' || s === 'metrics') return 'metric';
  return null;
}

function parseArgs(): Args {
  const baseUrl = ensureUrl(getArg('baseUrl') || process.env.BASE_URL || 'http://localhost:3000');

  const marketUuidRaw = String(getArg('marketUuid') || process.env.MARKET_UUID || '').trim();
  const symbolRaw = String(getArg('symbol') || process.env.SYMBOL || '').trim();
  const marketUuid = marketUuidRaw ? marketUuidRaw : null;
  const symbol = symbolRaw ? symbolRaw : null;

  const mode =
    parseInsertMode(getArg('mode') || process.env.MODE || process.env.INSERT_MODE) || 'candle';
  const metricNameRaw = String(getArg('metricName') || process.env.METRIC_NAME || '').trim();
  const metricName = metricNameRaw ? metricNameRaw : null;

  const startPriceRaw = Number(getArg('startPrice') || process.env.START_PRICE || '');
  const startPrice = Number.isFinite(startPriceRaw) && startPriceRaw > 0 ? startPriceRaw : null;

  const volBpsRaw = Number(getArg('volBps') || process.env.VOL_BPS || '5'); // 5 bps
  // Allow larger values so you can get meaningful moves when desired:
  // - 100 bps = 1%
  // - 500 bps = 5%
  // - 1000 bps = 10%
  const volBps = Number.isFinite(volBpsRaw) ? clamp(volBpsRaw, 0.1, 10_000) : 5;

  const countRaw = Number(getArg('count') || process.env.COUNT || '60');
  const count = Number.isFinite(countRaw) ? Math.max(1, Math.floor(countRaw)) : 60;

  const intervalMsRaw = Number(getArg('intervalMs') || process.env.INTERVAL_MS || '1000');
  const intervalMs = Number.isFinite(intervalMsRaw) ? clamp(intervalMsRaw, 50, 60_000) : 1000;

  const trend =
    parseTrendMode(getArg('trend') || process.env.TREND || process.env.TREND_MODE) || 'consolidate';

  const interactiveFlag = parseBoolLoose(getArg('interactive') || process.env.INTERACTIVE);
  const interactive = interactiveFlag ?? (!marketUuid && !symbol);

  if (marketUuid && !looksLikeUuid(marketUuid) && !symbol) {
    // If someone passed a symbol in MARKET_UUID, accept it as symbol for convenience.
    return {
      baseUrl,
      marketUuid: null,
      symbol: marketUuid,
      startPrice,
      volBps,
      count,
      intervalMs,
      trend,
      interactive,
      mode,
      metricName,
    };
  }

  return { baseUrl, marketUuid, symbol, startPrice, volBps, count, intervalMs, trend, interactive, mode, metricName };
}

function getSupabaseClient(): SupabaseClient | null {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      ''
  ).trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function ensureClickhouseUrl(value?: string): string {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  // Common local setup uses https + 8443 when a host is provided
  return `https://${raw}:8443`;
}

function escapeSqlString(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function fetchLatestPriceFromClickHouseByMarketUuid(marketUuid: string): Promise<number | null> {
  const chUrl = ensureClickhouseUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  if (!chUrl) return null;

  const db = String(process.env.CLICKHOUSE_DATABASE || 'default').trim();
  const user = String(process.env.CLICKHOUSE_USER || 'default').trim();
  const password = String(process.env.CLICKHOUSE_PASSWORD || '').trim();

  const id = escapeSqlString(String(marketUuid || '').trim());
  if (!id) return null;

  async function run(query: string): Promise<any | null> {
    const resp = await fetch(`${chUrl}/?database=${encodeURIComponent(db)}`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        Accept: 'application/json',
        'X-ClickHouse-Database': db,
        'X-ClickHouse-User': user,
        ...(password ? { 'X-ClickHouse-Key': password } : {}),
      } as any,
      body: query,
    }).catch(() => null);
    if (!resp || !resp.ok) return null;
    const text = await resp.text().catch(() => '');
    const line = text.split('\n').map((l) => l.trim()).filter(Boolean)[0];
    if (!line) return null;
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }

  // Prefer raw ticks if available (matches /api/dev/market-ticks behavior).
  const row1 = await run(
    `
SELECT price
FROM market_ticks
WHERE market_uuid = '${id}'
ORDER BY ts DESC
LIMIT 1
FORMAT JSONEachRow
`.trim()
  );
  const p1 = Number(row1?.price);
  if (Number.isFinite(p1) && p1 > 0) return p1;

  // Fallback: latest candle close.
  const row2 = await run(
    `
SELECT close
FROM ohlcv_1m
WHERE market_uuid = '${id}'
ORDER BY ts DESC
LIMIT 1
FORMAT JSONEachRow
`.trim()
  );
  const p2 = Number(row2?.close);
  if (Number.isFinite(p2) && p2 > 0) return p2;

  return null;
}

async function resolveMarketUuidFromSymbol(sb: SupabaseClient | null, symbol: string): Promise<string | null> {
  if (!sb) return null;
  const sym = String(symbol || '').trim();
  if (!sym) return null;
  try {
    const { data, error } = await sb
      .from('orderbook_markets_view')
      .select('id')
      .or(`eq.metric_id.${sym},eq.symbol.${sym},ilike.metric_id.${sym},ilike.symbol.${sym}`)
      .limit(1)
      .maybeSingle();
    if (error) return null;
    const id = data?.id ? String((data as any).id) : '';
    return id && looksLikeUuid(id) ? id : null;
  } catch {
    return null;
  }
}

async function fetchAllMarkets(sb: SupabaseClient): Promise<MarketRow[]> {
  const pageSize = 1000;
  const all: MarketRow[] = [];

  // Prefer the compatibility view used across the codebase.
  // Fall back to `markets` if the view isn't present in an env.
  const sources: Array<{ table: string; select: string; order: { column: string; ascending: boolean } }> = [
    {
      table: 'orderbook_markets_view',
      select: 'id, metric_id, symbol, category, market_status, deployment_status, is_active, last_trade_price, created_at',
      order: { column: 'created_at', ascending: false },
    },
    {
      table: 'markets',
      select: 'id, market_identifier, symbol, name, category, market_status, deployment_status, is_active, last_trade_price, created_at',
      order: { column: 'created_at', ascending: false },
    },
  ];

  let lastErr: any = null;
  for (const src of sources) {
    all.length = 0;
    lastErr = null;
    try {
      for (let page = 0; page < 100; page++) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await sb
          .from(src.table)
          .select(src.select)
          .order(src.order.column as any, { ascending: src.order.ascending })
          .range(from, to);
        if (error) throw error;
        const rows = (data || []) as any[];
        rows.forEach((r) => {
          // Normalize `markets.market_identifier` into `metric_id` field for UI convenience.
          const metric_id =
            typeof r?.metric_id === 'string'
              ? r.metric_id
              : typeof r?.market_identifier === 'string'
                ? r.market_identifier
                : null;
          all.push({
            id: String(r.id),
            metric_id,
            symbol: r.symbol != null ? String(r.symbol) : null,
            name: r.name != null ? String(r.name) : null,
            category: r.category != null ? String(r.category) : null,
            market_status: r.market_status != null ? String(r.market_status) : null,
            deployment_status: r.deployment_status != null ? String(r.deployment_status) : null,
            is_active: r.is_active != null ? Boolean(r.is_active) : null,
            last_trade_price: r.last_trade_price ?? null,
            created_at: r.created_at != null ? String(r.created_at) : null,
          });
        });
        if (rows.length < pageSize) break;
      }
      return all;
    } catch (e: any) {
      lastErr = e;
      continue;
    }
  }

  throw new Error(
    `Failed to fetch markets from Supabase. Last error: ${String(lastErr?.message || lastErr || 'unknown')}`
  );
}

function formatMarketLabel(m: MarketRow): string {
  const metric = (m.metric_id || '').trim();
  const sym = (m.symbol || '').trim();
  const primary = metric || sym || m.id;
  const statusBits: string[] = [];
  if (m.is_active === false) statusBits.push('inactive');
  if (m.deployment_status) statusBits.push(String(m.deployment_status));
  if (m.market_status) statusBits.push(String(m.market_status));
  const status = statusBits.length ? ` [${statusBits.join(', ')}]` : '';
  const cat = m.category ? ` (${m.category})` : '';
  return `${primary}${cat}${status}`;
}

async function promptInteractiveSelection(sb: SupabaseClient | null): Promise<{
  marketUuid: string;
  symbol: string | null;
  startPriceHint: number | null;
}> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!sb) {
      console.warn('⚠️ Supabase env not configured; falling back to manual market selection.');
      const mu = String(await rl.question('Enter market UUID: ')).trim();
      if (!looksLikeUuid(mu)) throw new Error(`Market UUID must be a UUID (got: ${mu})`);
      const sym = String(await rl.question('Enter market symbol/metric id (optional): ')).trim();
      return { marketUuid: mu, symbol: sym || null, startPriceHint: null };
    }

    const markets = await fetchAllMarkets(sb);
    if (!markets.length) {
      throw new Error('No markets found in Supabase.');
    }

    let filtered = markets.slice();
    for (;;) {
      // Show up to 50 rows
      const maxShow = 50;
      const showing = filtered.slice(0, maxShow);
      console.log('\nAvailable markets (showing up to 50):');
      showing.forEach((m, i) => {
        console.log(`  ${i + 1}. ${formatMarketLabel(m)}  → ${m.id}`);
      });
      if (filtered.length > maxShow) {
        console.log(`  ... (${filtered.length - maxShow} more not shown)`);
      }

      const q = String(
        await rl.question(
          "\nPick a market by number, paste a UUID, or type a filter (enter = keep list). Type 'q' to quit: "
        )
      ).trim();

      if (!q) {
        // Keep current list; require a selection next
        const pick = String(await rl.question('Select number (default 1): ')).trim();
        const idx = pick ? Number(pick) : 1;
        if (!Number.isFinite(idx) || idx < 1 || idx > showing.length) {
          throw new Error(`Invalid selection: ${pick}`);
        }
        const m = showing[idx - 1]!;
        const start = Number(m.last_trade_price);
        const startPriceHint = Number.isFinite(start) && start > 0 ? start : null;
        return { marketUuid: m.id, symbol: (m.metric_id || m.symbol || null) as any, startPriceHint };
      }

      if (q.toLowerCase() === 'q') {
        process.exit(0);
      }

      if (looksLikeUuid(q)) {
        const found = markets.find((m) => String(m.id) === q) || null;
        const start = Number(found?.last_trade_price);
        const startPriceHint = Number.isFinite(start) && start > 0 ? start : null;
        return { marketUuid: q, symbol: (found?.metric_id || found?.symbol || null) as any, startPriceHint };
      }

      const asNum = Number(q);
      if (Number.isFinite(asNum) && asNum >= 1 && asNum <= showing.length) {
        const m = showing[asNum - 1]!;
        const start = Number(m.last_trade_price);
        const startPriceHint = Number.isFinite(start) && start > 0 ? start : null;
        return { marketUuid: m.id, symbol: (m.metric_id || m.symbol || null) as any, startPriceHint };
      }

      // Treat as filter
      const needle = q.toLowerCase();
      filtered = markets.filter((m) => {
        const hay = [
          m.metric_id || '',
          m.symbol || '',
          m.name || '',
          m.category || '',
          m.market_status || '',
          m.deployment_status || '',
          m.id,
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(needle);
      });
      if (!filtered.length) {
        console.log('No matches. Resetting to full list.');
        filtered = markets.slice();
      }
    }
  } finally {
    rl.close();
  }
}

async function promptNumber(rl: ReturnType<typeof createInterface>, label: string, def: number, opts?: { min?: number; max?: number }) {
  const raw = String(await rl.question(`${label} (default ${def}): `)).trim();
  const n = raw ? Number(raw) : def;
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${label}: ${raw}`);
  const min = opts?.min ?? -Infinity;
  const max = opts?.max ?? Infinity;
  if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max} (got ${n})`);
  return n;
}

async function promptOptionalOverrideNumber(
  rl: ReturnType<typeof createInterface>,
  label: string,
  autoValue: number,
  opts?: { min?: number; max?: number }
): Promise<number> {
  const raw = String(await rl.question(`${label} (enter = use auto ${autoValue}): `)).trim();
  if (!raw) return autoValue;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${label}: ${raw}`);
  const min = opts?.min ?? -Infinity;
  const max = opts?.max ?? Infinity;
  if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max} (got ${n})`);
  return n;
}

async function promptTrendMode(
  rl: ReturnType<typeof createInterface>,
  def: TrendMode
): Promise<TrendMode> {
  const raw = String(
    await rl.question(`Trend mode (0=uptrend, 1=downtrend, 2=consolidate) (default ${def === 'uptrend' ? 0 : def === 'downtrend' ? 1 : 2}): `)
  ).trim();
  const parsed = parseTrendMode(raw);
  return parsed || def;
}

async function promptInsertMode(
  rl: ReturnType<typeof createInterface>,
  def: InsertMode
): Promise<InsertMode> {
  const raw = String(
    await rl.question(
      `Insert type (0=candlestick via ticks, 1=live metric point) (default ${def === 'candle' ? 0 : 1}): `
    )
  ).trim();
  if (!raw) return def;
  if (raw === '0') return 'candle';
  if (raw === '1') return 'metric';
  const parsed = parseInsertMode(raw);
  if (!parsed) throw new Error(`Invalid insert type: ${raw}`);
  return parsed;
}

async function promptText(
  rl: ReturnType<typeof createInterface>,
  label: string,
  def: string
): Promise<string> {
  const raw = String(await rl.question(`${label} (default ${def}): `)).trim();
  return raw || def;
}

function computeStepBps(opts: {
  trend: TrendMode;
  volBps: number;
  price: number;
  anchorPrice: number;
}): number {
  const noise = (Math.random() * 2 - 1) * opts.volBps; // uniform in [-volBps, +volBps]

  if (opts.trend === 'uptrend') {
    // Bias the step upward; the user controls magnitude via volBps.
    const drift = Math.max(opts.volBps * 0.25, 0.5);
    return noise + drift;
  }
  if (opts.trend === 'downtrend') {
    const drift = -Math.max(opts.volBps * 0.25, 0.5);
    return noise + drift;
  }

  // consolidate: mean-revert gently around the anchor (start) price
  const anchor = Math.max(1e-9, opts.anchorPrice);
  const deviationBps = ((opts.price - anchor) / anchor) * 10_000; // + when above anchor
  const k = 0.12; // mean reversion strength in bps per bps-deviation
  const meanRevert = clamp(-deviationBps * k, -opts.volBps * 3, opts.volBps * 3);
  return noise + meanRevert;
}

async function postMetricPoint(params: {
  baseUrl: string;
  marketId: string;
  metricName: string;
  value: number;
  tsMs: number;
}) {
  const endpoint = `${params.baseUrl}/api/charts/metric`;
  console.log('[REALTIME_METRIC]', 'script POST /api/charts/metric', {
    endpoint,
    marketId: params.marketId,
    metricName: params.metricName,
    ts: params.tsMs,
    value: params.value,
  });
  const body = {
    marketId: params.marketId,
    metricName: String(params.metricName).toUpperCase(),
    source: 'push-market-ticks',
    version: params.tsMs % 2_147_483_647,
    points: { ts: params.tsMs, value: params.value },
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Metric insert failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  loadEnv();
  const args = parseArgs();
  const tickEndpoint = `${args.baseUrl}/api/dev/market-ticks`;
  const metricEndpoint = `${args.baseUrl}/api/charts/metric`;

  const sb = getSupabaseClient();

  let marketUuid = args.marketUuid;
  let symbol = args.symbol;
  let startPriceOverride = args.startPrice;
  let volBps = args.volBps;
  let count = args.count;
  let intervalMs = args.intervalMs;
  let trend = args.trend;
  let startPriceHintFromSupabase: number | null = null;
  let mode: InsertMode = args.mode;
  let metricNameOverride: string | null = args.metricName;

  if (args.interactive) {
    const selection = await promptInteractiveSelection(sb);
    marketUuid = selection.marketUuid;
    symbol = symbol || selection.symbol;
    startPriceHintFromSupabase = selection.startPriceHint;

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      mode = await promptInsertMode(rl, mode);
      count = Math.floor(await promptNumber(rl, 'Insert count', count, { min: 1, max: 1_000_000 }));
      intervalMs = Math.floor(await promptNumber(rl, 'Interval (ms)', intervalMs, { min: 50, max: 60_000 }));
      trend = await promptTrendMode(rl, trend);
      volBps = await promptNumber(rl, 'Volatility (bps per insert)', volBps, { min: 0.1, max: 10_000 });
      // Start price is *optional override*; default is auto-resolved from ClickHouse.
      if (mode === 'metric') {
        const defMetricName = String(metricNameOverride || symbol || 'BITCOIN').toUpperCase();
        const name = await promptText(rl, 'Metric name (must match your overlay metricName)', defMetricName);
        metricNameOverride = String(name || defMetricName).toUpperCase();
      }
    } finally {
      rl.close();
    }
  }

  if (!marketUuid && symbol && looksLikeUuid(symbol)) {
    marketUuid = symbol;
    symbol = null;
  }

  if (!marketUuid && !symbol) {
    throw new Error('Missing market selection. Provide MARKET_UUID or SYMBOL, or run interactively.');
  }
  if (marketUuid && !looksLikeUuid(marketUuid)) {
    throw new Error(`MARKET_UUID must be a UUID (got: ${marketUuid})`);
  }

  // Resolve market UUID for ClickHouse price lookup if user only provided symbol.
  let marketUuidForPrice = marketUuid;
  if (!marketUuidForPrice && symbol) {
    marketUuidForPrice = await resolveMarketUuidFromSymbol(sb, symbol);
    // If we can resolve it, also use it for the POST body to avoid server-side resolution.
    if (marketUuidForPrice) marketUuid = marketUuidForPrice;
  }

  let startPriceSource = 'fallback';
  let autoStartPrice: number | null = null;

  if (!startPriceOverride && marketUuidForPrice) {
    autoStartPrice = await fetchLatestPriceFromClickHouseByMarketUuid(marketUuidForPrice);
    if (autoStartPrice != null) startPriceSource = 'clickhouse.latest';
  }
  if (!startPriceOverride && autoStartPrice == null && startPriceHintFromSupabase != null) {
    autoStartPrice = startPriceHintFromSupabase;
    startPriceSource = 'supabase.last_trade_price';
  }
  if (!startPriceOverride && autoStartPrice == null) {
    autoStartPrice = 100;
    startPriceSource = 'fallback';
  }

  // Interactive: ask for optional override *after* auto resolution so enter keeps auto.
  if (args.interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      startPriceOverride = await promptOptionalOverrideNumber(rl, 'Start price override', autoStartPrice!, {
        min: 0.00000001,
        max: 1e15,
      });
      if (startPriceOverride === autoStartPrice) {
        // keep source
      } else {
        startPriceSource = 'override';
      }
    } finally {
      rl.close();
    }
  }

  const startPriceUsed = startPriceOverride ?? autoStartPrice!;
  let price = startPriceUsed;
  const anchorPrice = startPriceUsed;

  if (mode === 'metric') {
    if (!marketUuid) {
      throw new Error('Metric insert requires a market UUID (marketId). Provide MARKET_UUID or a resolvable SYMBOL.');
    }
    const metricName = String(metricNameOverride || symbol || 'BITCOIN').toUpperCase();
    console.log('📈 Pushing live metric points → /api/charts/metric (broadcasts metric-update)', {
      endpoint: metricEndpoint,
      marketId: marketUuid,
      metricName,
      startValue: price,
      startValueSource: startPriceSource,
      trend,
      volBps,
      count,
      intervalMs,
    });

    for (let i = 0; i < count; i++) {
      const stepBps = computeStepBps({ trend, volBps, price, anchorPrice });
      price = Math.max(1e-9, price * (1 + stepBps / 10_000));
      const tsMs = Date.now();
      const inserted = await postMetricPoint({
        baseUrl: args.baseUrl,
        marketId: marketUuid,
        metricName,
        value: Number(price.toFixed(6)),
        tsMs,
      });

      console.log(`✅ metric ${i + 1}/${count}`, {
        marketId: marketUuid,
        metricName,
        value: Number(price.toFixed(6)),
        tsMs,
        inserted: inserted?.inserted ?? null,
      });

      if (i + 1 < count) {
        await sleep(intervalMs);
      }
    }

    console.log('🎯 Done.');
    return;
  }

  console.log('📈 Pushing ticks → market_ticks (and broadcasting candle)', {
    endpoint: tickEndpoint,
    marketUuid: marketUuid || null,
    symbol: symbol || null,
    startPrice: price,
    startPriceSource,
    trend,
    volBps,
    count,
    intervalMs,
  });

  for (let i = 0; i < count; i++) {
    // Random-walk step in basis points
    const stepBps = computeStepBps({ trend, volBps, price, anchorPrice });
    price = Math.max(1e-9, price * (1 + stepBps / 10_000));

    const side = Math.random() > 0.5 ? 'buy' : 'sell';
    const size = Number((Math.random() * 0.05 + 0.01).toFixed(6));

    const body = {
      ...(marketUuid ? { marketUuid } : {}),
      ...(symbol ? { symbol } : {}),
      price: Number(price.toFixed(6)),
      size,
      side,
    };

    const res = await fetch(tickEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('❌ tick push failed', { status: res.status, json });
      process.exitCode = 1;
      return;
    }

    console.log(`✅ tick ${i + 1}/${count}`, {
      tickPrice: json?.inserted?.price ?? null,
      side: json?.inserted?.side ?? null,
      candleClose: json?.latestCandle?.close ?? null,
      candleTime: json?.latestCandle?.time ?? null,
    });

    if (i + 1 < count) {
      await sleep(intervalMs);
    }
  }

  console.log('🎯 Done.');
}

main().catch((e) => {
  console.error('❌ push-market-ticks failed:', e?.stack || e);
  process.exit(1);
});

