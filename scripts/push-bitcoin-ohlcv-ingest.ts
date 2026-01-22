/**
 * Dev helper: push synthetic trade events into Supabase Edge Function `ohlcv-ingest`,
 * which writes raw ticks into ClickHouse `market_ticks` and broadcasts 1m candles to Pusher.
 *
 * This is meant to mirror the feel of:
 *   tsx scripts/push-bitcoin-market-ticks.ts --count 200 --intervalMs 300
 *
 * Usage:
 *   # required (signing key used by ohlcv-ingest signature verification)
 *   ALCHEMY_WEBHOOK_SIGNING_KEY_OHLCV=whsec_... tsx scripts/push-bitcoin-ohlcv-ingest.ts --count 200 --intervalMs 300
 *
 * Optional env:
 *   SUPABASE_PROJECT_REF=khhknmobkkkvvogznxdj         # default
 *   SUPABASE_FUNCTIONS_URL=https://<ref>.functions.supabase.co
 *   MARKET_ADDRESS=0x...                              # default BITCOIN market_address
 *   # Optional: omit START_PRICE to auto-pick it up from ClickHouse/Supabase.
 *   START_PRICE=65000.12
 *   VOL_BPS=5
 *
 * Optional flags:
 *   --count 200 --intervalMs 300 --startPrice 65000 --volBps 5 --marketAddress 0x...
 *   --functionsUrl https://<ref>.functions.supabase.co
 *   --topic <topic0>                                  # defaults to TradeExecuted topic used in ohlcv-ingest
 */

import crypto from 'node:crypto';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

type Args = {
  functionsUrl: string;
  signingKey: string;
  marketAddress: string;
  topic0: string;
  startPrice: number | null; // null -> auto
  volBps: number;
  count: number;
  intervalMs: number;
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

function ensureUrl(value?: string): string {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
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

function buildFunctionsUrl(): string {
  const explicit = ensureUrl(getArg('functionsUrl') || process.env.SUPABASE_FUNCTIONS_URL);
  if (explicit) return explicit;
  const ref = String(process.env.SUPABASE_PROJECT_REF || 'khhknmobkkkvvogznxdj').trim();
  if (!ref) throw new Error('Missing SUPABASE_PROJECT_REF or SUPABASE_FUNCTIONS_URL');
  return `https://${ref}.functions.supabase.co`;
}

function mustGetSigningKey(): string {
  const k =
    (getArg('signingKey') || process.env.ALCHEMY_WEBHOOK_SIGNING_KEY_OHLCV || '').trim() ||
    '';
  if (!k) {
    throw new Error('Missing ALCHEMY_WEBHOOK_SIGNING_KEY_OHLCV (required to sign requests)');
  }
  return k;
}

function parseArgs(): Args {
  const functionsUrl = buildFunctionsUrl();
  const signingKey = mustGetSigningKey();

  // Default to BITCOIN market_address (from Supabase markets table in this project)
  const marketAddress = String(getArg('marketAddress') || process.env.MARKET_ADDRESS || '0xB6Ca359d31582BBa368a890Ed60e6e0E81937AA2')
    .trim()
    .toLowerCase();

  // Default to the TradeExecuted topic used in the edge function mapping.
  const topic0 = String(
    getArg('topic') ||
      process.env.TRADE_TOPIC0 ||
      '0xb0100c4a25ad7c8bfaa42766f529176b9340f45755da88189bd092353fe50f0b'
  )
    .trim()
    .toLowerCase();

  const startPriceArg = getArg('startPrice') || process.env.START_PRICE || '';
  const startPriceRaw = startPriceArg ? Number(startPriceArg) : NaN;
  const startPrice = Number.isFinite(startPriceRaw) ? startPriceRaw : null;

  const volBpsRaw = Number(getArg('volBps') || process.env.VOL_BPS || '5');
  const volBps = Number.isFinite(volBpsRaw) ? clamp(volBpsRaw, 0.1, 250) : 5;

  const countRaw = Number(getArg('count') || process.env.COUNT || '200');
  const count = Number.isFinite(countRaw) ? Math.max(1, Math.floor(countRaw)) : 200;

  const intervalMsRaw = Number(getArg('intervalMs') || process.env.INTERVAL_MS || '300');
  const intervalMs = Number.isFinite(intervalMsRaw) ? clamp(intervalMsRaw, 50, 60_000) : 300;

  return { functionsUrl, signingKey, marketAddress, topic0, startPrice, volBps, count, intervalMs };
}

function encodeWord(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function buildGraphqlTradePayload(opts: {
  contractAddress: string;
  topic0: string;
  tsSec: number;
  txHash: string;
  logIndex: number;
  transactionIndex: number;
  price: number;
  size: number;
  priceDecimals: number;
  sizeDecimals: number;
}) {
  // IMPORTANT: ohlcv-ingest expects trade topics; for TradeExecuted mapping, it reads:
  // - word[0] size (18d)
  // - word[1] price (6d)
  const priceI = BigInt(Math.round(opts.price * 10 ** opts.priceDecimals));
  const sizeI = BigInt(Math.round(opts.size * 10 ** opts.sizeDecimals));
  const data = `0x${encodeWord(sizeI)}${encodeWord(priceI)}`;

  return {
    type: 'GRAPHQL',
    event: {
      data: {
        block: {
          timestamp: opts.tsSec,
          logs: [
            {
              account: { address: opts.contractAddress },
              address: opts.contractAddress,
              topics: [opts.topic0],
              data,
              logIndex: opts.logIndex,
              transactionIndex: opts.transactionIndex,
              timestamp: opts.tsSec,
              transaction: { hash: opts.txHash },
            },
          ],
        },
      },
    },
  };
}

function signAlchemyBodyHex(signingKey: string, rawBody: string): string {
  return crypto.createHmac('sha256', signingKey).update(rawBody, 'utf8').digest('hex');
}

function ensureClickhouseUrl(value?: string): string {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}:8443`;
}

async function fetchLatestPriceFromClickHouse(opts: {
  contractAddress: string;
}): Promise<number | null> {
  const chUrl = ensureClickhouseUrl(process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST);
  if (!chUrl) return null;

  const db = String(process.env.CLICKHOUSE_DATABASE || 'default').trim();
  const user = String(process.env.CLICKHOUSE_USER || 'default').trim();
  const password = String(process.env.CLICKHOUSE_PASSWORD || '').trim();

  // Prefer the canonical contract_address that ohlcv-ingest writes into market_ticks.
  const addr = String(opts.contractAddress || '').trim().toLowerCase().replace(/'/g, "\\'");
  if (!addr) return null;

  const query = `
SELECT price
FROM market_ticks
WHERE contract_address = '${addr}'
ORDER BY ts DESC
LIMIT 1
FORMAT JSONEachRow
`.trim();

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
    const row = JSON.parse(line) as any;
    const p = Number(row?.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

async function fetchLatestPriceFromSupabaseTicker(opts: {
  marketAddress: string;
}): Promise<number | null> {
  const sbUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const sbKey =
    String(
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        ''
    ).trim();
  if (!sbUrl || !sbKey) return null;

  const addr = String(opts.marketAddress || '').trim().toLowerCase();
  if (!addr) return null;

  // Resolve market UUID
  const marketsUrl =
    `${sbUrl}/rest/v1/markets?select=id,market_address&limit=1&market_address=ilike.${encodeURIComponent(addr)}`;
  const mResp = await fetch(marketsUrl, {
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
  }).catch(() => null);
  if (!mResp || !mResp.ok) return null;
  const mJson = (await mResp.json().catch(() => null)) as any;
  const marketId = Array.isArray(mJson) && mJson[0]?.id ? String(mJson[0].id) : '';
  if (!marketId) return null;

  // Pull current mark price (if available)
  const tickerUrl = `${sbUrl}/rest/v1/market_tickers?select=mark_price,is_stale&limit=1&market_id=eq.${encodeURIComponent(
    marketId
  )}`;
  const tResp = await fetch(tickerUrl, {
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
  }).catch(() => null);
  if (!tResp || !tResp.ok) return null;
  const tJson = (await tResp.json().catch(() => null)) as any;
  const row = Array.isArray(tJson) ? tJson[0] : null;
  const isStale = Boolean(row?.is_stale);
  const p = Number(row?.mark_price);
  if (isStale) return null;
  return Number.isFinite(p) && p > 0 ? p : null;
}

async function resolveStartPrice(args: Args): Promise<{ price: number; source: string }> {
  if (Number.isFinite(Number(args.startPrice)) && (args.startPrice as number) > 0) {
    return { price: Number(args.startPrice), source: 'arg/env' };
  }

  // 1) ClickHouse: latest tick price by contract_address (best match to runtime candle source)
  try {
    const p = await fetchLatestPriceFromClickHouse({ contractAddress: args.marketAddress });
    if (p) return { price: p, source: 'clickhouse.market_ticks.latest' };
  } catch {}

  // 2) Supabase: market_tickers mark_price (if being updated)
  try {
    const p = await fetchLatestPriceFromSupabaseTicker({ marketAddress: args.marketAddress });
    if (p) return { price: p, source: 'supabase.market_tickers.mark_price' };
  } catch {}

  // 3) Fallback: safe default
  return { price: 65000.12, source: 'fallback' };
}

async function main() {
  loadEnv();
  const args = parseArgs();
  const endpoint = `${args.functionsUrl}/ohlcv-ingest`;

  const start = await resolveStartPrice(args);
  let price = start.price;
  let logIndex = 1;

  // Edge function defaults: OHLCV_PRICE_DECIMALS=6, OHLCV_SIZE_DECIMALS=18
  const priceDecimals = 6;
  const sizeDecimals = 18;

  console.log('📈 Pushing synthetic trades → Supabase ohlcv-ingest → ClickHouse market_ticks → Pusher chart-update', {
    endpoint,
    marketAddress: args.marketAddress,
    topic0: args.topic0,
    startPrice: price,
    startPriceSource: start.source,
    volBps: args.volBps,
    count: args.count,
    intervalMs: args.intervalMs,
  });

  for (let i = 0; i < args.count; i++) {
    // Random-walk step in basis points
    const stepBps = (Math.random() * 2 - 1) * args.volBps;
    price = Math.max(1, price * (1 + stepBps / 10_000));

    const size = Number((Math.random() * 0.05 + 0.01).toFixed(6));
    const tsSec = Math.floor(Date.now() / 1000);
    const txHash = `0x${randomHex(32)}`;

    const bodyObj = buildGraphqlTradePayload({
      contractAddress: args.marketAddress,
      topic0: args.topic0,
      tsSec,
      txHash,
      logIndex: logIndex++,
      transactionIndex: 1,
      price: Number(price.toFixed(6)),
      size,
      priceDecimals,
      sizeDecimals,
    });

    const rawBody = JSON.stringify(bodyObj);
    const sig = signAlchemyBodyHex(args.signingKey, rawBody);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-alchemy-signature': sig,
      },
      body: rawBody,
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('❌ ohlcv-ingest failed', { status: res.status, json });
      process.exitCode = 1;
      return;
    }

    const inserted = json?.ch?.ticks?.inserted ?? null;
    const published = json?.pusher?.published ?? null;

    console.log(`✅ trade ${i + 1}/${args.count}`, {
      price: bodyObj.event.data.block.logs[0].data ? Number(price.toFixed(6)) : null,
      size,
      inserted,
      published,
    });

    if (i + 1 < args.count) {
      await sleep(args.intervalMs);
    }
  }

  console.log('🎯 Done.');
}

main().catch((e) => {
  console.error('❌ push-bitcoin-ohlcv-ingest failed:', e?.stack || e);
  process.exit(1);
});

