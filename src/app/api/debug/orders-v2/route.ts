import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, defineChain, fallback, http, formatUnits, parseAbi, type Address } from 'viem';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { CHAIN_CONFIG } from '@/lib/contractConfig';

// ── Minimal ABI for OBViewFacet reads ──────────────────────────────────
const OB_VIEW_ABI = parseAbi([
  'function getOrder(uint256 orderId) external view returns (uint256 orderId_, address trader, uint256 price, uint256 amount, bool isBuy, uint256 timestamp, uint256 nextOrderId, uint256 marginRequired, bool isMarginOrder)',
  'function getActiveOrdersCount() external view returns (uint256 buyCount, uint256 sellCount)',
  'function bestBid() external view returns (uint256)',
  'function bestAsk() external view returns (uint256)',
  'function getUserOrders(address user) external view returns (uint256[] orderIds)',
] as const);

// ── Viem client (isolated for this route) ──────────────────────────────
function buildClient() {
  const chain = defineChain({
    id: CHAIN_CONFIG.chainId,
    name: 'hyperliquid',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [CHAIN_CONFIG.rpcUrl] },
      public: { http: [CHAIN_CONFIG.rpcUrl] },
    },
  });

  const urls: string[] = [CHAIN_CONFIG.rpcUrl];
  if (env.RPC_URL_BACKUP) urls.push(env.RPC_URL_BACKUP);
  if (env.RPC_URLS) urls.push(...env.RPC_URLS.split(',').map((s) => s.trim()).filter(Boolean));
  const unique = [...new Set(urls)];
  const transports = unique.map((u) => http(u, { retryCount: 2, timeout: 15_000 }));

  return createPublicClient({ chain, transport: fallback(transports, { rank: false }) });
}

// ── Supabase helper ────────────────────────────────────────────────────
function getSupabase() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// ── Serialise an on-chain order tuple into a plain object ──────────────
interface SerializedOrder {
  orderId: string;
  trader: string;
  price: string;
  priceFormatted: number;
  amount: string;
  amountFormatted: number;
  isBuy: boolean;
  side: 'BUY' | 'SELL';
  timestamp: number;
  timestampISO: string;
  nextOrderId: string;
  marginRequired: string;
  marginRequiredFormatted: number;
  isMarginOrder: boolean;
  market?: string;
  /** Order book contract address where this order lives (required for gasless cancel) */
  orderBook?: string;
}

function serializeOrder(raw: readonly [bigint, `0x${string}`, bigint, bigint, boolean, bigint, bigint, bigint, boolean], market?: string): SerializedOrder {
  const [orderId, trader, price, amount, isBuy, timestamp, nextOrderId, marginRequired, isMarginOrder] = raw;
  const ts = Number(timestamp) * 1000;
  return {
    orderId: orderId.toString(),
    trader,
    price: price.toString(),
    priceFormatted: parseFloat(formatUnits(price, 6)),
    amount: amount.toString(),
    amountFormatted: parseFloat(formatUnits(amount, 18)),
    isBuy,
    side: isBuy ? 'BUY' : 'SELL',
    timestamp: ts,
    timestampISO: ts > 0 ? new Date(ts).toISOString() : '',
    nextOrderId: nextOrderId.toString(),
    marginRequired: marginRequired.toString(),
    marginRequiredFormatted: parseFloat(formatUnits(marginRequired, 6)),
    isMarginOrder,
    market,
  };
}

// ── Fetch all markets from Supabase ────────────────────────────────────
interface MarketRow {
  symbol: string;
  market_address: string;
  market_id_bytes32: string;
  is_active: boolean;
  market_status: string;
}

async function fetchMarkets(): Promise<MarketRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('markets')
    .select('symbol, market_address, market_id_bytes32, is_active, market_status')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Supabase markets query failed: ${error.message}`);
  return (data || []).filter((m: MarketRow) => !!m.market_address);
}

// ── Core: iterate order IDs on a single OrderBook contract ─────────────
async function fetchAllOrdersForContract(
  client: ReturnType<typeof buildClient>,
  contractAddress: Address,
  maxId: number,
  maxConsecutiveEmpty: number,
): Promise<SerializedOrder[]> {
  const orders: SerializedOrder[] = [];
  let consecutiveEmpty = 0;

  for (let id = 1; id <= maxId; id++) {
    try {
      const result = await client.readContract({
        address: contractAddress,
        abi: OB_VIEW_ABI,
        functionName: 'getOrder',
        args: [BigInt(id)],
      });
      const tuple = result as unknown as readonly [bigint, `0x${string}`, bigint, bigint, boolean, bigint, bigint, bigint, boolean];

      // Skip zero/deleted orders (trader == 0x0 and amount == 0)
      const [, trader, , amount] = tuple;
      if (trader === '0x0000000000000000000000000000000000000000' && amount === 0n) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= maxConsecutiveEmpty) break;
        continue;
      }

      consecutiveEmpty = 0;
      orders.push(serializeOrder(tuple));
    } catch {
      consecutiveEmpty++;
      if (consecutiveEmpty >= maxConsecutiveEmpty) break;
    }
  }

  return orders;
}

// ── GET handler ────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const t0 = Date.now();

  try {
    const { searchParams } = new URL(request.url);

    // Optional filters
    const marketFilter = searchParams.get('market') || ''; // e.g. "BTC-USD"
    const traderFilter = searchParams.get('trader') || ''; // e.g. "0xabc..."
    const maxOrderId = Math.min(Number(searchParams.get('maxOrderId') || '500'), 5000);
    const maxEmpty = Math.min(Number(searchParams.get('maxEmpty') || '20'), 100);

    // 1. Resolve markets
    const allMarkets = await fetchMarkets();
    const markets = marketFilter
      ? allMarkets.filter((m) => m.symbol.toLowerCase().includes(marketFilter.toLowerCase()))
      : allMarkets;

    if (markets.length === 0) {
      return NextResponse.json({
        ok: true,
        warning: 'No matching markets found',
        markets: [],
        orders: [],
        elapsed_ms: Date.now() - t0,
      });
    }

    const client = buildClient();

    // 2. For each market, fetch contract-level stats + orders
    const marketResults: Array<{
      symbol: string;
      address: string;
      buyCount: string;
      sellCount: string;
      bestBid: string;
      bestBidFormatted: number;
      bestAsk: string;
      bestAskFormatted: number;
      ordersFound: number;
    }> = [];

    let allOrders: SerializedOrder[] = [];

    for (const market of markets) {
      const address = market.market_address as Address;

      // Quick bytecode check
      let bytecode: string | undefined;
      try {
        bytecode = await client.getBytecode({ address });
      } catch { /* ignore */ }
      if (!bytecode || bytecode === '0x') {
        marketResults.push({
          symbol: market.symbol,
          address: market.market_address,
          buyCount: '0',
          sellCount: '0',
          bestBid: '0',
          bestBidFormatted: 0,
          bestAsk: '0',
          bestAskFormatted: 0,
          ordersFound: 0,
        });
        continue;
      }

      // Fetch summary stats (best-effort)
      let buyCount = 0n;
      let sellCount = 0n;
      let bestBid = 0n;
      let bestAsk = 0n;

      try {
        const counts = await client.readContract({ address, abi: OB_VIEW_ABI, functionName: 'getActiveOrdersCount' });
        [buyCount, sellCount] = counts as [bigint, bigint];
      } catch { /* facet may not exist */ }

      try {
        bestBid = (await client.readContract({ address, abi: OB_VIEW_ABI, functionName: 'bestBid' })) as bigint;
      } catch { /* ignore */ }

      try {
        bestAsk = (await client.readContract({ address, abi: OB_VIEW_ABI, functionName: 'bestAsk' })) as bigint;
      } catch { /* ignore */ }

      // If a specific trader is requested, use getUserOrders for that market
      let orders: SerializedOrder[] = [];

      if (traderFilter) {
        try {
          const ids = (await client.readContract({
            address,
            abi: OB_VIEW_ABI,
            functionName: 'getUserOrders',
            args: [traderFilter as Address],
          })) as readonly bigint[];

          for (const oid of ids) {
            try {
              const raw = await client.readContract({
                address,
                abi: OB_VIEW_ABI,
                functionName: 'getOrder',
                args: [oid],
              });
              const tuple = raw as unknown as readonly [bigint, `0x${string}`, bigint, bigint, boolean, bigint, bigint, bigint, boolean];
              const o = serializeOrder(tuple, market.symbol);
              o.orderBook = address;
              orders.push(o);
            } catch { /* deleted/invalid order */ }
          }
        } catch { /* getUserOrders may fail */ }
      } else {
        // Iterate order IDs
        orders = await fetchAllOrdersForContract(client, address, maxOrderId, maxEmpty);
        orders = orders.map((o) => ({ ...o, market: market.symbol, orderBook: address }));
      }

      allOrders = allOrders.concat(orders);

      marketResults.push({
        symbol: market.symbol,
        address: market.market_address,
        buyCount: buyCount.toString(),
        sellCount: sellCount.toString(),
        bestBid: bestBid.toString(),
        bestBidFormatted: parseFloat(formatUnits(bestBid, 6)),
        bestAsk: bestAsk.toString(),
        bestAskFormatted: parseFloat(formatUnits(bestAsk, 6)),
        ordersFound: orders.length,
      });
    }

    // Sort orders by timestamp descending
    allOrders.sort((a, b) => b.timestamp - a.timestamp);

    return NextResponse.json({
      ok: true,
      elapsed_ms: Date.now() - t0,
      totalOrders: allOrders.length,
      marketsScanned: markets.length,
      markets: marketResults,
      orders: allOrders,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[debug/orders-v2] Error:', message);
    return NextResponse.json(
      { ok: false, error: message, elapsed_ms: Date.now() - t0 },
      { status: 500 },
    );
  }
}
