/**
 * Dev helper: push raw trade ticks into ClickHouse `market_ticks` for BITCOIN and broadcast
 * updated 1m candles to Pusher (so TradingView realtime updates immediately).
 *
 * Requires the Next dev server running (this script hits the dev API route):
 *   POST /api/dev/market-ticks
 *
 * Usage:
 *   tsx scripts/push-bitcoin-market-ticks.ts
 *   MARKET_UUID=<uuid> tsx scripts/push-bitcoin-market-ticks.ts --count 50 --intervalMs 1000
 *   tsx scripts/push-bitcoin-market-ticks.ts --startPrice 67668.48 --volBps 5 --count 999999
 */

type Args = {
  baseUrl: string;
  marketUuid: string;
  symbol: string;
  startPrice: number;
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

function looksLikeUuid(value: string): boolean {
  const v = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function parseArgs(): Args {
  const baseUrl = (getArg('baseUrl') || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const marketUuid = String(process.env.MARKET_UUID || 'e120c445-37fc-47e1-a65d-5cedf945bf5d').trim();
  const symbol = String(process.env.SYMBOL || 'BITCOIN').trim();

  const startPriceRaw = Number(getArg('startPrice') || process.env.START_PRICE || '67668.48');
  const startPrice = Number.isFinite(startPriceRaw) ? startPriceRaw : 67668.48;

  const volBpsRaw = Number(getArg('volBps') || process.env.VOL_BPS || '5'); // 5 bps
  const volBps = Number.isFinite(volBpsRaw) ? clamp(volBpsRaw, 0.1, 250) : 5;

  const countRaw = Number(getArg('count') || process.env.COUNT || '60');
  const count = Number.isFinite(countRaw) ? Math.max(1, Math.floor(countRaw)) : 60;

  const intervalMsRaw = Number(getArg('intervalMs') || process.env.INTERVAL_MS || '1000');
  const intervalMs = Number.isFinite(intervalMsRaw) ? clamp(intervalMsRaw, 50, 60_000) : 1000;

  if (!looksLikeUuid(marketUuid)) {
    throw new Error(`MARKET_UUID must be a UUID (got: ${marketUuid})`);
  }

  return { baseUrl, marketUuid, symbol, startPrice, volBps, count, intervalMs };
}

async function main() {
  const args = parseArgs();
  const endpoint = `${args.baseUrl}/api/dev/market-ticks`;

  let price = args.startPrice;
  console.log('📈 Pushing BITCOIN ticks → market_ticks (and broadcasting candle)', {
    endpoint,
    marketUuid: args.marketUuid,
    symbol: args.symbol,
    startPrice: price,
    volBps: args.volBps,
    count: args.count,
    intervalMs: args.intervalMs,
  });

  for (let i = 0; i < args.count; i++) {
    // Random-walk step in basis points
    const stepBps = (Math.random() * 2 - 1) * args.volBps;
    price = Math.max(1, price * (1 + stepBps / 10_000));

    const side = Math.random() > 0.5 ? 'buy' : 'sell';
    const size = Number((Math.random() * 0.05 + 0.01).toFixed(6));

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marketUuid: args.marketUuid,
        symbol: args.symbol,
        price: Number(price.toFixed(6)),
        size,
        side,
      }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('❌ tick push failed', { status: res.status, body });
      process.exitCode = 1;
      return;
    }

    const close = body?.latestCandle?.close ?? null;
    console.log(`✅ tick ${i + 1}/${args.count}`, {
      tickPrice: body?.inserted?.price ?? null,
      side: body?.inserted?.side ?? null,
      candleClose: close,
      candleTime: body?.latestCandle?.time ?? null,
    });

    if (i + 1 < args.count) {
      await sleep(args.intervalMs);
    }
  }

  console.log('🎯 Done.');
}

main().catch((e) => {
  console.error('❌ push-bitcoin-market-ticks failed:', e?.stack || e);
  process.exit(1);
});


