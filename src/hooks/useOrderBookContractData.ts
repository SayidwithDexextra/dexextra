'use client';

import { useEffect, useMemo, useState } from 'react';
import { Address, createPublicClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { CHAIN_CONFIG, CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import OrderBookArtifact from '@/lib/abis/OrderBook.json';

type OrderBookLiveData = {
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
  recentTrades: Array<{ price: number; amount: number; timestamp: number }> | null;
  lastUpdated: string;
};

const CORE_VAULT_MIN_ABI = [
  // Resolve diamond OB by marketId if mapping exists
  {
    type: 'function',
    name: 'marketToOrderBook',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ name: 'orderBook', type: 'address' }]
  }
] as const;

export function useOrderBookContractData(symbol: string, options?: { refreshInterval?: number }) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OrderBookLiveData | null>(null);

  const refreshInterval = options?.refreshInterval ?? 15000;

  const publicClient = useMemo(() => {
    return createPublicClient({ chain: polygon, transport: http(CHAIN_CONFIG.rpcUrl) });
  }, []);
  // Pricing uses 6 decimals on-chain; scale to human-readable
  const PRICE_DECIMALS = 6;
  const SCALE_PRICE = Math.pow(10, PRICE_DECIMALS);
  const toNum = (x: bigint | number | null) => (typeof x === 'bigint' ? Number(x) : x === null ? null : Number(x));
  const scalePrice = (x: bigint | number | null): number | null => {
    const n = toNum(x);
    if (n === null) return null;
    return n / SCALE_PRICE;
  };
  // Order sizes are stored in 18 decimals (token precision)
  const AMOUNT_DECIMALS = 18;
  const SCALE_AMOUNT = Math.pow(10, AMOUNT_DECIMALS);
  const scaleAmount = (x: bigint | number | null): number => {
    const n = toNum(x);
    if (n === null) return 0;
    return n / SCALE_AMOUNT;
  };

  // Resolve market config by symbol
  const marketConfig = useMemo(() => {
    const markets = CONTRACT_ADDRESSES.MARKET_INFO as any;
    if (!markets) return null;
    const entries = Object.values(markets) as any[];
    const match = entries.find((m) => m?.symbol === symbol || m?.name === symbol);
    return match || (entries.length > 0 ? entries[0] : null);
  }, [symbol]);

  const resolveOrderBookAddress = async (): Promise<Address | null> => {
    try {
      const fallbacks: (string | undefined)[] = [
        marketConfig?.orderBook,
        (CONTRACT_ADDRESSES as any).ALUMINUM_ORDERBOOK,
        (CONTRACT_ADDRESSES as any).orderBook,
        (CONTRACT_ADDRESSES as any).aluminumOrderBook,
      ];

      // Try CoreVault mapping first if we have a marketId
      if (marketConfig?.marketId && (CONTRACT_ADDRESSES as any).CORE_VAULT) {
        try {
          const mapped = await publicClient.readContract({
            address: (CONTRACT_ADDRESSES as any).CORE_VAULT as Address,
            abi: CORE_VAULT_MIN_ABI,
            functionName: 'marketToOrderBook',
            args: [marketConfig.marketId as `0x${string}`]
          });
          if (mapped && mapped !== '0x0000000000000000000000000000000000000000') {
            return mapped as Address;
          }
        } catch {}
      }

      // Fall back to configured addresses
      for (const addr of fallbacks) {
        if (addr && addr !== '0x0000000000000000000000000000000000000000') {
          return addr as Address;
        }
      }
      return null;
    } catch (e: any) {
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    let timer: any;

    // Compose ABI: base diamond ABI plus minimal facet views used here
    const baseAbi = ((OrderBookArtifact as any)?.abi ?? []) as any[];
    const facetAbi = [
      // Pricing/View facet methods used for UI
      { type: 'function', name: 'calculateMarkPrice', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
      { type: 'function', name: 'getBestPrices', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256', name: 'bidPrice' }, { type: 'uint256', name: 'askPrice' }] },
      { type: 'function', name: 'getMarketPriceData', stateMutability: 'view', inputs: [], outputs: [
        { type: 'uint256', name: 'midPrice' },
        { type: 'uint256', name: 'bestBidPrice' },
        { type: 'uint256', name: 'bestAskPrice' },
        { type: 'uint256', name: 'lastTradePriceReturn' },
        { type: 'uint256', name: 'markPrice' },
        { type: 'uint256', name: 'spread' },
        { type: 'uint256', name: 'spreadBps' },
        { type: 'bool', name: 'isValid' }
      ] },
      { type: 'function', name: 'getOrderBookDepth', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'levels' }], outputs: [
        { type: 'uint256[]', name: 'bidPrices' }, { type: 'uint256[]', name: 'bidAmounts' }, { type: 'uint256[]', name: 'askPrices' }, { type: 'uint256[]', name: 'askAmounts' }
      ] },
      { type: 'function', name: 'getOrderBookDepthFromPointers', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'levels' }], outputs: [
        { type: 'uint256[]', name: 'bidPrices' }, { type: 'uint256[]', name: 'bidAmounts' }, { type: 'uint256[]', name: 'askPrices' }, { type: 'uint256[]', name: 'askAmounts' }
      ] },
      // Compatibility getters typically present on view facet
      { type: 'function', name: 'bestBid', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
      { type: 'function', name: 'bestAsk', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
      { type: 'function', name: 'lastTradePrice', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
      // Trade history helpers (diamond trade execution facet)
      { type: 'function', name: 'getLastTwentyTrades', stateMutability: 'view', inputs: [], outputs: [{ type: 'tuple[]', components: [
        { type: 'uint256', name: 'tradeId' },
        { type: 'address', name: 'buyer' },
        { type: 'address', name: 'seller' },
        { type: 'uint256', name: 'price' },
        { type: 'uint256', name: 'amount' },
        { type: 'uint256', name: 'timestamp' }
      ] } as any] },
      { type: 'function', name: 'getRecentTrades', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'count' }], outputs: [{ type: 'tuple[]', components: [
        { type: 'uint256', name: 'tradeId' },
        { type: 'address', name: 'buyer' },
        { type: 'address', name: 'seller' },
        { type: 'uint256', name: 'price' },
        { type: 'uint256', name: 'amount' },
        { type: 'uint256', name: 'timestamp' }
      ] } as any] },
    ] as const as any[];
    const abi = [...baseAbi, ...facetAbi];
    if (!abi || abi.length === 0) {
      setError('OrderBook ABI not found');
      setIsLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const address = await resolveOrderBookAddress();
        if (!address) throw new Error('OrderBook address could not be resolved');

        // Read best bid/ask and last trade price (fallback friendly)
        const [bestBidRaw, bestAskRaw] = await Promise.all([
          publicClient.readContract({ address, abi, functionName: 'bestBid', args: [] }).catch(() => 0n),
          publicClient.readContract({ address, abi, functionName: 'bestAsk', args: [] }).catch(() => 0n),
        ]);

        // Optional reads
        const lastTradeRaw = await publicClient
          .readContract({ address, abi, functionName: 'lastTradePrice', args: [] })
          .catch(() => 0n);

        // Mark price via pricing facet if exposed
        const markPriceRaw = await publicClient
          .readContract({ address, abi, functionName: 'calculateMarkPrice', args: [] })
          .catch(() => 0n);

        // Optional market stats if facet exposes it
        let volume24h: bigint | null = null,
          openInterest: bigint | null = null,
          totalTrades: bigint | null = null,
          priceChange24h: bigint | null = null;
        try {
          const stats: any = await publicClient.readContract({
            address,
            abi,
            functionName: 'getMarketStats',
            args: []
          });
          if (Array.isArray(stats) && stats.length >= 5) {
            volume24h = BigInt(stats[0]);
            openInterest = BigInt(stats[1]);
            totalTrades = BigInt(stats[2]);
            // stats[3] is lastTradePrice; we already read it separately
            priceChange24h = BigInt(stats[4]);
          }
        } catch {}

        // Order counts if view facet exposes it
        let activeBuyOrders: bigint | null = null;
        let activeSellOrders: bigint | null = null;
        try {
          const counts: any = await publicClient.readContract({
            address,
            abi,
            functionName: 'getActiveOrdersCount',
            args: []
          });
          if (Array.isArray(counts) && counts.length >= 2) {
            activeBuyOrders = BigInt(counts[0]);
            activeSellOrders = BigInt(counts[1]);
          }
        } catch {}

        // Depth if pricing facet exposes it
        let depth: OrderBookLiveData['depth'] = null;
        try {
          const levels = 10n;
          let d: any = null;
          try {
            d = await publicClient.readContract({ address, abi, functionName: 'getOrderBookDepth', args: [levels] });
          } catch (e) {
            // Try alternate function name if primary not present
            try {
              d = await publicClient.readContract({ address, abi, functionName: 'getOrderBookDepthFromPointers', args: [levels] });
            } catch {}
          }
          if (Array.isArray(d) && d.length >= 4) {
            const [bidPrices, bidAmounts, askPrices, askAmounts] = d as [bigint[], bigint[], bigint[], bigint[]];
            depth = {
              bidPrices: bidPrices.map((x) => scalePrice(x) || 0),
              bidAmounts: bidAmounts.map((x) => scaleAmount(x)),
              askPrices: askPrices.map((x) => scalePrice(x) || 0),
              askAmounts: askAmounts.map((x) => scaleAmount(x)),
            };
          }
        } catch {}

        // Recent trades if exec facet exposes it
        let recentTrades: OrderBookLiveData['recentTrades'] = null;
        try {
          // Prefer getLastTwentyTrades if present
          let trades: any = null;
          try {
            trades = await publicClient.readContract({ address, abi, functionName: 'getLastTwentyTrades', args: [] });
          } catch (_e) {
            // Fallback to getRecentTrades(count)
            const limit = 20n;
            trades = await publicClient.readContract({ address, abi, functionName: 'getRecentTrades', args: [limit] });
          }
          if (Array.isArray(trades)) {
            recentTrades = trades.map((t: any) => ({
              price: scalePrice(t?.price ?? 0) || 0,
              amount: scaleAmount(t?.amount ?? 0),
              timestamp: Number(t?.timestamp ?? 0),
            }));
          }
        } catch {}

        const bestBid = scalePrice(bestBidRaw as any) || 0;
        const bestAsk = scalePrice(bestAskRaw as any) || 0;
        const lastTradePrice = scalePrice(lastTradeRaw as any) || null;
        const markPriceCalc = scalePrice(markPriceRaw as any) || null;
        const markPrice = markPriceCalc && markPriceCalc > 0 ? markPriceCalc : (bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : (lastTradePrice || 0));

        const live: OrderBookLiveData = {
          orderBookAddress: address,
          bestBid,
          bestAsk,
          lastTradePrice,
          markPrice,
          totalTrades: toNum(totalTrades),
          volume24h: toNum(volume24h),
          openInterest: toNum(openInterest),
          priceChange24h: scalePrice(priceChange24h),
          activeBuyOrders: toNum(activeBuyOrders),
          activeSellOrders: toNum(activeSellOrders),
          depth,
          recentTrades,
          lastUpdated: new Date().toISOString(),
        };

        if (!cancelled) {
          setData(live);
          setIsLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to fetch OrderBook data');
          setIsLoading(false);
        }
      } finally {
        if (!cancelled && refreshInterval > 0) {
          timer = setTimeout(fetchData, refreshInterval);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [symbol, publicClient, refreshInterval]);

  return { data, isLoading, error } as const;
}


