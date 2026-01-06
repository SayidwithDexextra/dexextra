import { NextRequest, NextResponse } from 'next/server';
import type { Address } from 'viem';
import { publicClient } from '@/lib/viemClient';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { CHAIN_CONFIG, CONTRACT_ADDRESSES } from '@/lib/contractConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LiveResponse = {
  ok: true;
  fromCache: boolean;
  cacheAgeMs: number;
  data: {
    orderBookAddress: Address | null;
    bestBid: number | null;
    bestAsk: number | null;
    lastTradePrice: number | null;
    markPrice: number | null;
    totalTrades: number | null;
    volume24h: number | null;
    openInterest: number | null;
    priceChange24h: number | null;
    activeBuyOrders: number | null;
    activeSellOrders: number | null;
    depth: {
      bidPrices: number[];
      bidAmounts: number[];
      askPrices: number[];
      askAmounts: number[];
    } | null;
    recentTrades: Array<{ tradeId: string; price: number; amount: number; timestamp: number }> | null;
    lastUpdated: string;
  };
};

type ErrResponse = { ok: false; error: string };

const CORE_VAULT_MIN_ABI = [
  {
    type: 'function',
    name: 'marketToOrderBook',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ name: 'orderBook', type: 'address' }],
  },
] as const;

const ORDERBOOK_VIEW_ABI = [
  { type: 'function', name: 'getOrderBookDepth', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'levels' }], outputs: [
    { type: 'uint256[]', name: 'bidPrices' }, { type: 'uint256[]', name: 'bidAmounts' }, { type: 'uint256[]', name: 'askPrices' }, { type: 'uint256[]', name: 'askAmounts' }
  ] },
  { type: 'function', name: 'getOrderBookDepthFromPointers', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'levels' }], outputs: [
    { type: 'uint256[]', name: 'bidPrices' }, { type: 'uint256[]', name: 'bidAmounts' }, { type: 'uint256[]', name: 'askPrices' }, { type: 'uint256[]', name: 'askAmounts' }
  ] },
  { type: 'function', name: 'getMarketPriceData', stateMutability: 'view', inputs: [], outputs: [
    { type: 'uint256', name: 'midPrice' },
    { type: 'uint256', name: 'bestBidPrice' },
    { type: 'uint256', name: 'bestAskPrice' },
    { type: 'uint256', name: 'lastTradePriceReturn' },
    { type: 'uint256', name: 'markPrice' },
    { type: 'uint256', name: 'spread' },
    { type: 'uint256', name: 'spreadBps' },
    { type: 'bool', name: 'isValid' },
  ] },
  { type: 'function', name: 'calculateMarkPrice', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'bestBid', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'bestAsk', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lastTradePrice', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getMarketStats', stateMutability: 'view', inputs: [], outputs: [
    { type: 'uint256', name: 'volume24h' },
    { type: 'uint256', name: 'openInterest' },
    { type: 'uint256', name: 'totalTrades' },
    { type: 'uint256', name: 'lastTradePrice' },
    { type: 'uint256', name: 'priceChange24h' },
  ] },
  { type: 'function', name: 'getActiveOrdersCount', stateMutability: 'view', inputs: [], outputs: [
    { type: 'uint256', name: 'buyCount' },
    { type: 'uint256', name: 'sellCount' },
  ] },
  { type: 'function', name: 'getLastTwentyTrades', stateMutability: 'view', inputs: [], outputs: [{ type: 'tuple[]', components: [
    { type: 'uint256', name: 'tradeId' },
    { type: 'address', name: 'buyer' },
    { type: 'address', name: 'seller' },
    { type: 'uint256', name: 'price' },
    { type: 'uint256', name: 'amount' },
    { type: 'uint256', name: 'timestamp' },
    { type: 'uint256', name: 'buyOrderId' },
    { type: 'uint256', name: 'sellOrderId' },
    { type: 'bool', name: 'buyerIsMargin' },
    { type: 'bool', name: 'sellerIsMargin' },
    { type: 'uint256', name: 'tradeValue' },
    { type: 'uint256', name: 'buyerFee' },
    { type: 'uint256', name: 'sellerFee' },
  ] } as any] },
  { type: 'function', name: 'getRecentTrades', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'count' }], outputs: [{ type: 'tuple[]', components: [
    { type: 'uint256', name: 'tradeId' },
    { type: 'address', name: 'buyer' },
    { type: 'address', name: 'seller' },
    { type: 'uint256', name: 'price' },
    { type: 'uint256', name: 'amount' },
    { type: 'uint256', name: 'timestamp' },
    { type: 'uint256', name: 'buyOrderId' },
    { type: 'uint256', name: 'sellOrderId' },
    { type: 'bool', name: 'buyerIsMargin' },
    { type: 'bool', name: 'sellerIsMargin' },
    { type: 'uint256', name: 'tradeValue' },
    { type: 'uint256', name: 'buyerFee' },
    { type: 'uint256', name: 'sellerFee' },
  ] } as any] },
] as const;

const PRICE_DECIMALS = 6;
const AMOUNT_DECIMALS = 18;
const TEN = 10n;
const pow10 = (d: number) => TEN ** BigInt(d);
const bigintToFloat = (x: bigint, decimals: number, maxFraction = 8): number => {
  const base = pow10(decimals);
  const intPart = x / base;
  const fracPart = x % base;
  const fracStrFull = fracPart.toString().padStart(decimals, '0');
  const fracStr = maxFraction > 0 ? fracStrFull.slice(0, Math.min(maxFraction, decimals)) : '';
  const str = fracStr ? `${intPart.toString()}.${fracStr}` : intPart.toString();
  return parseFloat(str);
};
const scalePrice = (x: bigint | number | null | undefined): number | null => {
  if (x === null || x === undefined) return null;
  if (typeof x === 'bigint') return bigintToFloat(x, PRICE_DECIMALS, 8);
  return x / Math.pow(10, PRICE_DECIMALS);
};
const scaleAmount = (x: bigint | number | null | undefined): number => {
  if (x === null || x === undefined) return 0;
  if (typeof x === 'bigint') return bigintToFloat(x, AMOUNT_DECIMALS, 12);
  return x / Math.pow(10, AMOUNT_DECIMALS);
};

function isHexAddress(x: string | null | undefined): x is `0x${string}` {
  return Boolean(x && x.startsWith('0x') && x.length === 42);
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: any;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return (await Promise.race([p, timeout])) as T;
  } finally {
    try { clearTimeout(t); } catch {}
  }
}

async function resolveOrderBookAddressFromDb(symbol: string): Promise<{ address: Address | null; marketIdBytes32?: `0x${string}` }>{
  const sf = String(symbol || '').trim();
  if (!sf) return { address: null };
  const chainId = Number(CHAIN_CONFIG.chainId || 0);
  const { data, error } = await supabaseAdmin
    .from('markets')
    .select('symbol, name, market_identifier, market_id_bytes32, market_address, chain_id, market_status, is_active')
    .or(`symbol.ilike.%${sf}%,market_identifier.ilike.%${sf}%,name.ilike.%${sf}%`)
    .order('created_at', { ascending: false })
    .limit(8);
  if (error || !data || data.length === 0) return { address: null };

  const lower = sf.toLowerCase();
  const filtered = data.filter((m: any) => {
    if (typeof m?.chain_id === 'number' && chainId) {
      if (Number(m.chain_id) !== chainId) return false;
    }
    if (m?.is_active === false) return false;
    if (m?.market_status && String(m.market_status).toUpperCase() !== 'ACTIVE') return false;
    return true;
  });
  const rows = filtered.length ? filtered : data;
  const best =
    rows.find((m: any) => String(m?.market_identifier || '').toLowerCase() === lower) ||
    rows.find((m: any) => String(m?.symbol || '').toLowerCase() === lower) ||
    rows.find((m: any) => String(m?.name || '').toLowerCase() === lower) ||
    rows[0];
  const addr = String((best as any)?.market_address || '');
  const mid = (best as any)?.market_id_bytes32;
  return { address: isHexAddress(addr) ? (addr as Address) : null, marketIdBytes32: (typeof mid === 'string' && mid.startsWith('0x')) ? (mid as any) : undefined };
}

async function resolveOrderBookAddress(symbol?: string | null, explicitAddr?: string | null, marketIdBytes32?: string | null): Promise<Address | null> {
  if (isHexAddress(explicitAddr)) return explicitAddr as Address;

  // Try DB lookup
  if (symbol) {
    const r = await resolveOrderBookAddressFromDb(symbol);
    if (r.address) return r.address;
    // If DB has no address but we have marketId + core vault, try mapping
    const candidateId = (marketIdBytes32 && marketIdBytes32.startsWith('0x') ? (marketIdBytes32 as `0x${string}`) : r.marketIdBytes32) || null;
    if (candidateId && (CONTRACT_ADDRESSES as any).CORE_VAULT) {
      try {
        const mapped = await withTimeout(
          publicClient.readContract({
            address: (CONTRACT_ADDRESSES as any).CORE_VAULT as Address,
            abi: CORE_VAULT_MIN_ABI,
            functionName: 'marketToOrderBook',
            args: [candidateId],
          }),
          2500,
          'marketToOrderBook'
        );
        if (mapped && mapped !== '0x0000000000000000000000000000000000000000') return mapped as Address;
      } catch {}
    }
  }

  return null;
}

type CacheEntry = { ts: number; data: LiveResponse['data'] };
function getCache(): Map<string, CacheEntry> {
  const g: any = globalThis as any;
  if (!g.__obLiveCache) g.__obLiveCache = new Map<string, CacheEntry>();
  return g.__obLiveCache as Map<string, CacheEntry>;
}

export async function GET(req: NextRequest): Promise<NextResponse<LiveResponse | ErrResponse>> {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get('symbol') || '';
    const orderBookAddress = searchParams.get('orderBookAddress');
    const marketIdBytes32 = searchParams.get('marketIdBytes32');
    const levels = Math.min(25, Math.max(1, Number(searchParams.get('levels') || 10)));

    const chainId = Number(CHAIN_CONFIG.chainId || 0);
    const cacheKey = `${chainId}:${String(orderBookAddress || '').toLowerCase()}:${String(symbol || '').toLowerCase()}:${levels}`;
    const cache = getCache();

    const TTL_MS = 1250;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TTL_MS) {
      const res = NextResponse.json({
        ok: true,
        fromCache: true,
        cacheAgeMs: Date.now() - cached.ts,
        data: cached.data,
      } satisfies LiveResponse);
      res.headers.set('Cache-Control', 'public, s-maxage=1, stale-while-revalidate=4');
      return res;
    }

    const address = await resolveOrderBookAddress(symbol, orderBookAddress, marketIdBytes32);
    if (!address) {
      return NextResponse.json({ ok: false, error: 'OrderBook address could not be resolved' }, { status: 404 });
    }

    // Depth first (fast)
    let depth: LiveResponse['data']['depth'] = null;
    try {
      const lvl = BigInt(levels);
      let d: any = null;
      try {
        d = await withTimeout(
          publicClient.readContract({ address, abi: ORDERBOOK_VIEW_ABI as any, functionName: 'getOrderBookDepth', args: [lvl] }),
          2000,
          'getOrderBookDepth'
        );
      } catch {
        d = await withTimeout(
          publicClient.readContract({ address, abi: ORDERBOOK_VIEW_ABI as any, functionName: 'getOrderBookDepthFromPointers', args: [lvl] }),
          2000,
          'getOrderBookDepthFromPointers'
        );
      }
      if (Array.isArray(d) && d.length >= 4) {
        const [bidPrices, bidAmounts, askPrices, askAmounts] = d as [bigint[], bigint[], bigint[], bigint[]];
        depth = {
          bidPrices: (bidPrices || []).map((x) => scalePrice(x) || 0),
          bidAmounts: (bidAmounts || []).map((x) => scaleAmount(x)),
          askPrices: (askPrices || []).map((x) => scalePrice(x) || 0),
          askAmounts: (askAmounts || []).map((x) => scaleAmount(x)),
        };
      }
    } catch {}

    // Prices + optional stats/counts/trades
    let bestBidRaw: bigint = 0n;
    let bestAskRaw: bigint = 0n;
    let lastTradeRaw: bigint = 0n;
    let markPriceRaw: bigint = 0n;

    let volume24h: bigint | null = null;
    let openInterest: bigint | null = null;
    let totalTrades: bigint | null = null;
    let priceChange24h: bigint | null = null;

    let activeBuyOrders: bigint | null = null;
    let activeSellOrders: bigint | null = null;

    let recentTrades: LiveResponse['data']['recentTrades'] = null;

    const priceReads = (async () => {
      try {
        const mp: any = await withTimeout(
          publicClient.readContract({ address, abi: ORDERBOOK_VIEW_ABI as any, functionName: 'getMarketPriceData', args: [] }),
          2500,
          'getMarketPriceData'
        );
        if (Array.isArray(mp) && mp.length >= 8) {
          bestBidRaw = BigInt(mp[1] ?? 0);
          bestAskRaw = BigInt(mp[2] ?? 0);
          lastTradeRaw = BigInt(mp[3] ?? 0);
          markPriceRaw = BigInt(mp[4] ?? 0);
        } else {
          throw new Error('bad shape');
        }
      } catch {
        try {
          bestBidRaw = (await withTimeout(publicClient.readContract({ address, abi: ORDERBOOK_VIEW_ABI as any, functionName: 'bestBid', args: [] }), 1500, 'bestBid').catch(() => 0n)) as any;
          bestAskRaw = (await withTimeout(publicClient.readContract({ address, abi: ORDERBOOK_VIEW_ABI as any, functionName: 'bestAsk', args: [] }), 1500, 'bestAsk').catch(() => 0n)) as any;
          lastTradeRaw = (await withTimeout(publicClient.readContract({ address, abi: ORDERBOOK_VIEW_ABI as any, functionName: 'lastTradePrice', args: [] }), 1500, 'lastTradePrice').catch(() => 0n)) as any;
          markPriceRaw = (await withTimeout(publicClient.readContract({ address, abi: ORDERBOOK_VIEW_ABI as any, functionName: 'calculateMarkPrice', args: [] }), 1500, 'calculateMarkPrice').catch(() => 0n)) as any;
        } catch {}
      }
    })();

    const statsReads = (async () => {
      try {
        const stats: any = await withTimeout(
          publicClient.readContract({ address, abi: ORDERBOOK_VIEW_ABI as any, functionName: 'getMarketStats', args: [] }),
          2000,
          'getMarketStats'
        );
        if (Array.isArray(stats) && stats.length >= 5) {
          volume24h = BigInt(stats[0]);
          openInterest = BigInt(stats[1]);
          totalTrades = BigInt(stats[2]);
          priceChange24h = BigInt(stats[4]);
        }
      } catch {}
    })();

    const countsReads = (async () => {
      try {
        const counts: any = await withTimeout(
          publicClient.readContract({ address, abi: ORDERBOOK_VIEW_ABI as any, functionName: 'getActiveOrdersCount', args: [] }),
          2000,
          'getActiveOrdersCount'
        );
        if (Array.isArray(counts) && counts.length >= 2) {
          activeBuyOrders = BigInt(counts[0]);
          activeSellOrders = BigInt(counts[1]);
        }
      } catch {}
    })();

    const tradesReads = (async () => {
      try {
        let trades: any = null;
        try {
          trades = await withTimeout(
            publicClient.readContract({ address, abi: ORDERBOOK_VIEW_ABI as any, functionName: 'getLastTwentyTrades', args: [] }),
            2500,
            'getLastTwentyTrades'
          );
        } catch {
          trades = await withTimeout(
            publicClient.readContract({ address, abi: ORDERBOOK_VIEW_ABI as any, functionName: 'getRecentTrades', args: [20n] }),
            2500,
            'getRecentTrades'
          );
        }
        if (Array.isArray(trades)) {
          recentTrades = trades.map((t: any) => ({
            tradeId: String(t?.tradeId ?? ''),
            price: scalePrice(t?.price ?? 0) || 0,
            amount: scaleAmount(t?.amount ?? 0),
            timestamp: Number(t?.timestamp ?? 0),
          }));
        }
      } catch {}
    })();

    await Promise.allSettled([priceReads, statsReads, countsReads, tradesReads]);

    const bestBid = scalePrice(bestBidRaw as any) || 0;
    const bestAsk = scalePrice(bestAskRaw as any) || 0;
    const lastTradePrice = scalePrice(lastTradeRaw as any) || null;
    const markPriceCalc = scalePrice(markPriceRaw as any) || null;
    const markPrice =
      markPriceCalc && markPriceCalc > 0
        ? markPriceCalc
        : bestBid > 0 && bestAsk > 0
          ? (bestBid + bestAsk) / 2
          : (lastTradePrice || 0);

    const data: LiveResponse['data'] = {
      orderBookAddress: address,
      bestBid,
      bestAsk,
      lastTradePrice,
      markPrice,
      totalTrades: totalTrades === null ? null : Number(totalTrades),
      volume24h: volume24h === null ? null : Number(volume24h),
      openInterest: openInterest === null ? null : Number(openInterest),
      priceChange24h: scalePrice(priceChange24h),
      activeBuyOrders: activeBuyOrders === null ? null : Number(activeBuyOrders),
      activeSellOrders: activeSellOrders === null ? null : Number(activeSellOrders),
      depth,
      recentTrades,
      lastUpdated: new Date().toISOString(),
    };

    cache.set(cacheKey, { ts: Date.now(), data });

    const res = NextResponse.json({
      ok: true,
      fromCache: false,
      cacheAgeMs: 0,
      data,
    } satisfies LiveResponse);
    res.headers.set('Cache-Control', 'public, s-maxage=1, stale-while-revalidate=4');
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}






