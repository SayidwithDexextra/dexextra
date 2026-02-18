'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Address } from 'viem';
import { CHAIN_CONFIG, CONTRACT_ADDRESSES, populateMarketInfoClient } from '@/lib/contractConfig';
import { publicClient as fallbackPublicClient } from '@/lib/viemClient';
import { useMarketEventHub } from '@/services/realtime/marketEventHub';

const UI_UPDATE_PREFIX = '[UI,Update]';

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
  recentTrades: Array<{ tradeId: string; price: number; amount: number; timestamp: number }> | null;
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

type UseOBOptions = {
  refreshInterval?: number;
  orderBookAddress?: Address | string | null;
  marketIdBytes32?: `0x${string}` | string | null;
  /** Number of price levels to fetch for each side (clamped 1..25). */
  levels?: number;
  /** When false, disables polling + RPC reads (useful when a parent provider already fetches this data). */
  enabled?: boolean;
  /** Prefer backend aggregator API (reduces browser RPC). Falls back to direct RPC on failure. */
  source?: 'api' | 'rpc';
};

export function useOrderBookContractData(symbol: string, _options?: UseOBOptions) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OrderBookLiveData | null>(null);
  const [watchAddress, setWatchAddress] = useState<Address | null>(null);
  const watchAddressRef = useRef<Address | null>(null);
  const fetchNowRef = useRef<null | (() => void)>(null);
  const lastRealtimeRefreshRef = useRef<number>(0);
  const fetchInProgressRef = useRef<boolean>(false);
  const resolveAttemptsRef = useRef<number>(0);
  const pollTimerRef = useRef<any>(null);
  const fastPollTimerRef = useRef<any>(null);
  const addressRetryTimerRef = useRef<any>(null);
  const refreshInterval = _options?.refreshInterval ?? 5000;
  const enabled = _options?.enabled !== false;
  const source = _options?.source ?? 'api';
  const requestedLevels = useMemo(() => {
    const raw = Number(_options?.levels ?? 10);
    if (!Number.isFinite(raw)) return 10;
    return Math.min(25, Math.max(1, Math.floor(raw)));
  }, [_options?.levels]);
  // Cache the resolved address to ensure consistency
  const resolvedAddressRef = useRef<Address | null>(null);
  const resolvedIsFallbackRef = useRef<boolean>(false);
  const lastSlowReadsAtRef = useRef<number>(0);
  const fastPollStartAtRef = useRef<number>(0);
  // Reset cache when symbol changes
  useEffect(() => {
    resolvedAddressRef.current = null;
    resolveAttemptsRef.current = 0;
    resolvedIsFallbackRef.current = false;
    lastSlowReadsAtRef.current = 0;
    fastPollStartAtRef.current = 0;
    // Allow new fetches after symbol change
    fetchInProgressRef.current = false;
    // Clear any pending address retry timers on symbol change
    try { if (addressRetryTimerRef.current) { clearTimeout(addressRetryTimerRef.current); addressRetryTimerRef.current = null; } } catch {}
  }, [symbol]);

  // Also reset cache when caller-provided address or marketId hint changes
  useEffect(() => {
    resolvedAddressRef.current = null;
    resolvedIsFallbackRef.current = false;
    lastSlowReadsAtRef.current = 0;
    fastPollStartAtRef.current = 0;
    // Allow new fetches after option changes
    fetchInProgressRef.current = false;
    try { if (addressRetryTimerRef.current) { clearTimeout(addressRetryTimerRef.current); addressRetryTimerRef.current = null; } } catch {}
  }, [_options?.orderBookAddress, _options?.marketIdBytes32]);

  // Use shared client with fallback transports and timeouts to avoid long-hanging RPCs
  const publicClient = useMemo(() => {
    return fallbackPublicClient;
  }, []);

  // Note: realtime event subscriptions are handled by MarketEventHub.
  // Human-readable scaling using BigInt-safe conversion to avoid overflow/precision loss
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
  const scalePrice = (x: bigint | number | null): number | null => {
    if (x === null || x === undefined) return null;
    if (typeof x === 'bigint') return bigintToFloat(x, PRICE_DECIMALS, 8);
    return x / Math.pow(10, PRICE_DECIMALS);
  };
  const scaleAmount = (x: bigint | number | null): number => {
    if (x === null || x === undefined) return 0;
    if (typeof x === 'bigint') return bigintToFloat(x, AMOUNT_DECIMALS, 12);
    return x / Math.pow(10, AMOUNT_DECIMALS);
  };

  // Resolve market config by symbol
  const marketConfig = useMemo(() => {
    const markets = CONTRACT_ADDRESSES.MARKET_INFO as any;
    if (!markets) return null;
    const entries = Object.values(markets) as any[];
    const currentChain = CHAIN_CONFIG.chainId;
    const searchKey = (symbol || '').toLowerCase().trim();
    if (!searchKey) return null;
    const marketMatch = entries.find((m: any) => {
      if (m?.chainId !== currentChain) return false;
      const mSymbol = (m?.symbol || '').toLowerCase();
      const mName = (m?.name || '').toLowerCase();
      const mId = (m?.marketIdentifier || '').toLowerCase();
      return mSymbol === searchKey || mName === searchKey || mId === searchKey;
    });
    return marketMatch || null;
  }, [symbol]);

  // Build robust resolver for market config that tolerates async population
  const resolveMarketConfigStrict = async (rawSymbol: string): Promise<any | null> => {
    const raw = (rawSymbol || '').trim();
    console.log('[MarketConfig] Resolving market config for symbol:', raw);
    if (!raw) return null;
    const currentChain = CHAIN_CONFIG.chainId;

    const candidates: string[] = Array.from(new Set([
      raw,
      raw.toUpperCase(),
      raw.toLowerCase(),
      (raw.split('-')[0] || raw).toUpperCase(),
      (raw.split('-')[0] || raw).toLowerCase(),
    ]));

    const findMatch = (ignoreChainId = false): any | null => {
      const markets = (CONTRACT_ADDRESSES as any).MARKET_INFO || {};
      const entries = Object.values(markets) as any[];
      for (const key of candidates) {
        const k = key.toLowerCase();
        const match = entries.find((m: any) => {
          if (!ignoreChainId && m?.chainId !== currentChain) return false;
          const mSymbol = (m?.symbol || '').toLowerCase();
          const mName = (m?.name || '').toLowerCase();
          const mId = (m?.marketIdentifier || '').toLowerCase();
          return mSymbol === k || mName === k || mId === k;
        });
        if (match) return match;
      }
      return null;
    };

    // 1) Try existing in-memory markets
    let match = findMatch();
    if (match) return match;

    // 2) Attempt client-side population filtered by the most specific key
    try {
      const primary = raw;
      const added = await populateMarketInfoClient(primary);
      if (added && added > 0) {
        match = findMatch();
        if (match) return match;
      }
    } catch {}

    // 3) As a secondary attempt, try with the prefix variant (e.g., ALU from ALU-USD)
    try {
      const prefix = (raw.split('-')[0] || raw);
      if (prefix && prefix !== raw) {
        const added2 = await populateMarketInfoClient(prefix);
        if (added2 && added2 > 0) {
          match = findMatch();
          if (match) return match;
        }
      }
    } catch {}

    // 4) Final fallback: ignore chainId filter if misconfigured
    try {
      match = findMatch(true);
      if (match) {
        console.warn('[MarketConfig] Falling back to market match ignoring chainId; check CHAIN_ID env');
        return match;
      }
    } catch {}

    return null;
  };

  const resolveOrderBookAddress = async (): Promise<Address | null> => {
    // Check if we already have a cached address. If it's a fallback, we will still try to re-resolve in the background.
    if (resolvedAddressRef.current && !resolvedIsFallbackRef.current) {
      console.log('[OrderBook] Using cached address:', resolvedAddressRef.current);
      return resolvedAddressRef.current;
    }

    try {
      // 0) If caller provided an explicit address, trust it first
      const optAddr = (_options?.orderBookAddress || null) as string | null;
      if (optAddr && typeof optAddr === 'string' && optAddr.startsWith('0x') && optAddr.length === 42) {
        resolvedAddressRef.current = optAddr as Address;
        resolvedIsFallbackRef.current = false;
        console.log('[OrderBook] Using provided orderBookAddress from options:', optAddr);
        return resolvedAddressRef.current;
      }

      const sym = (symbol || '').trim();
      console.log('[OrderBook] Resolving OrderBook address for symbol:', sym);
      if (!sym) {
        console.warn('[OrderBook] Empty symbol provided; skipping market resolution');
        return null;
      }
      // Resolve market config dynamically to avoid stale memo and race with DB population
      const mc = await resolveMarketConfigStrict(sym);
      console.log('[OrderBook] Market config resolved:', mc ? 'found' : 'null');
      if (!mc) {
        console.warn(`No market configuration found for ${sym} on chain ${CHAIN_CONFIG.chainId}`);
        return null;
      }
      
      // First try the direct OrderBook address from market config
      if (mc.orderBook && mc.orderBook !== '0x0000000000000000000000000000000000000000') {
        console.log('[OrderBook] Direct orderBook address found:', mc.orderBook);
        // Cache the address for future use
        resolvedAddressRef.current = mc.orderBook as Address;
        resolvedIsFallbackRef.current = false;
        return resolvedAddressRef.current;
      }

      // If no direct address but we have marketId, try CoreVault mapping
      const candidateMarketId = (_options?.marketIdBytes32 as any) || mc?.marketId;
      if (candidateMarketId && (CONTRACT_ADDRESSES as any).CORE_VAULT) {
        try {
          const mapped = await publicClient.readContract({
            address: (CONTRACT_ADDRESSES as any).CORE_VAULT as Address,
            abi: CORE_VAULT_MIN_ABI,
            functionName: 'marketToOrderBook',
            args: [candidateMarketId as `0x${string}`]
          });

          if (mapped && mapped !== '0x0000000000000000000000000000000000000000') {
            // Cache the mapped address for future use
            resolvedAddressRef.current = mapped as Address;
            resolvedIsFallbackRef.current = false;
            console.log('[OrderBook] CoreVault mapped address found:', resolvedAddressRef.current);
            return resolvedAddressRef.current;
          }
        } catch (error) {
          console.warn(`CoreVault mapping failed for market ${symbol}:`, error);
        }
      }

      // Try API fallback to populate markets if client-side population missed
      try {
        const params = new URLSearchParams({ search: sym, status: 'ACTIVE', limit: '5' });
        const resp = await fetch(`/api/markets?${params.toString()}`, { method: 'GET' });
        if (resp.ok) {
          const json = await resp.json();
          const markets = (json?.markets || []) as any[];
          if (Array.isArray(markets) && markets.length > 0) {
            // Pick the best match by symbol/name/identifier
            const lower = sym.toLowerCase();
            const best = markets.find((m: any) =>
              (m?.symbol || '').toLowerCase() === lower ||
              (m?.market_identifier || '').toLowerCase() === lower ||
              (m?.name || '').toLowerCase() === lower
            ) || markets[0];
            if (best?.market_address && typeof best.market_address === 'string') {
              const addr = best.market_address as string;
              if (addr.startsWith('0x') && addr.length === 42 && addr !== '0x0000000000000000000000000000000000000000') {
                (CONTRACT_ADDRESSES as any).MARKET_INFO[(best.symbol?.split('-')[0] || best.symbol || sym).toUpperCase()] = {
                  id: best.id,
                  name: best.name,
                  symbol: best.symbol,
                  marketId: best.market_id_bytes32,
                  marketIdentifier: best.market_identifier,
                  orderBook: addr,
                  chainId: best.chain_id,
                  network: best.network,
                  active: true,
                  status: best.market_status
                };
                resolvedAddressRef.current = addr as Address;
                resolvedIsFallbackRef.current = false;
                console.log('[OrderBook] Address resolved via /api/markets fallback:', addr);
                return resolvedAddressRef.current;
              }
            }
          }
        }
      } catch (apiErr) {
        console.warn('[OrderBook] API fallback resolve failed:', apiErr);
      }

      // Do not use any global default; address must be market-specific

      // No address yet
      console.warn(`No OrderBook address found for market ${symbol}`);
      return null;
    } catch (e: any) {
      console.error(`Failed to resolve OrderBook address:`, e);
      return null;
    }
  };

  // Centralized real-time event bridge (OrderPlaced + TradeExecutionCompleted).
  // This replaces the previous mix of in-hook WS watchers + Pusher listeners.
  const hubSubscriber = useMemo(() => {
    return {
      dispatchDomEvents: true,
      onOrdersChanged: () => {
        try {
          // eslint-disable-next-line no-console
          console.log(`${UI_UPDATE_PREFIX} orderbookLive:onOrdersChanged -> fetchNow`, { symbol: String(symbol || '').toUpperCase() });
        } catch {}
        fetchNowRef.current?.();
      },
      onTradesChanged: () => {
        try {
          // eslint-disable-next-line no-console
          console.log(`${UI_UPDATE_PREFIX} orderbookLive:onTradesChanged -> fetchNow`, { symbol: String(symbol || '').toUpperCase() });
        } catch {}
        fetchNowRef.current?.();
      },
    };
  }, []);
  useMarketEventHub(symbol, watchAddress, hubSubscriber);

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      // Do not poll or do RPC reads when disabled. This allows higher-level providers to own polling.
      setIsLoading(false);
      setError(null);
      return () => {
        cancelled = true;
        try { if (pollTimerRef.current) { clearInterval(pollTimerRef.current); } } catch {}
        try { if (fastPollTimerRef.current) { clearInterval(fastPollTimerRef.current); } } catch {}
        try { if (addressRetryTimerRef.current) { clearTimeout(addressRetryTimerRef.current); } } catch {}
      };
    }

    // Enforce per-call timeouts so optional/slow reads don't block UI depth updates
    const withTimeout = async <T,>(p: Promise<T>, ms: number, label?: string): Promise<T> => {
      let timeoutHandle: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`${label || 'operation'} timed out after ${ms}ms`)), ms);
      });
      try {
        return await Promise.race([p, timeoutPromise]) as T;
      } finally {
        clearTimeout(timeoutHandle);
      }
    };

    // Use a minimal, explicit ABI to avoid decoding mismatches
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
      // Optional aggregated stats (not available on all deployments)
      { type: 'function', name: 'getMarketStats', stateMutability: 'view', inputs: [], outputs: [
        { type: 'uint256', name: 'volume24h' },
        { type: 'uint256', name: 'openInterest' },
        { type: 'uint256', name: 'totalTrades' },
        { type: 'uint256', name: 'lastTradePrice' },
        { type: 'uint256', name: 'priceChange24h' }
      ] },
      // Optional active order counts (not available on all deployments)
      { type: 'function', name: 'getActiveOrdersCount', stateMutability: 'view', inputs: [], outputs: [
        { type: 'uint256', name: 'buyCount' },
        { type: 'uint256', name: 'sellCount' }
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
        { type: 'uint256', name: 'timestamp' },
        { type: 'uint256', name: 'buyOrderId' },
        { type: 'uint256', name: 'sellOrderId' },
        { type: 'bool', name: 'buyerIsMargin' },
        { type: 'bool', name: 'sellerIsMargin' },
        { type: 'uint256', name: 'tradeValue' },
        { type: 'uint256', name: 'buyerFee' },
        { type: 'uint256', name: 'sellerFee' }
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
        { type: 'uint256', name: 'sellerFee' }
      ] } as any] },
      // Events for WS subscription
      { type: 'event', name: 'OrderPlaced', inputs: [
        { indexed: true,  name: 'orderId', type: 'uint256' },
        { indexed: true,  name: 'trader',  type: 'address' },
        { indexed: false, name: 'price',   type: 'uint256' },
        { indexed: false, name: 'amount',  type: 'uint256' },
        { indexed: false, name: 'isBuy',   type: 'bool' },
        { indexed: false, name: 'isMarginOrder', type: 'bool' }
      ] },
      { type: 'event', name: 'OrderCancelled', inputs: [
        { indexed: true, name: 'orderId', type: 'uint256' },
        { indexed: true, name: 'trader',  type: 'address' }
      ] },
      { type: 'event', name: 'OrderModified', inputs: [
        { indexed: true,  name: 'oldOrderId', type: 'uint256' },
        { indexed: true,  name: 'newOrderId', type: 'uint256' },
        { indexed: true,  name: 'trader',     type: 'address' },
        { indexed: false, name: 'newPrice',   type: 'uint256' },
        { indexed: false, name: 'newAmount',  type: 'uint256' }
      ] },
      { type: 'event', name: 'TradeExecutionCompleted', inputs: [
        { indexed: true, name: 'buyer',  type: 'address' },
        { indexed: true, name: 'seller', type: 'address' },
        { indexed: false, name: 'price', type: 'uint256' },
        { indexed: false, name: 'amount', type: 'uint256' }
      ] },
      { type: 'event', name: 'PriceUpdated', inputs: [
        { indexed: false, name: 'lastTradePrice',  type: 'uint256' },
        { indexed: false, name: 'currentMarkPrice', type: 'uint256' }
      ] },
    ] as const as any[];
    const abi = [...facetAbi];
    if (!abi || abi.length === 0) {
      setError('OrderBook ABI not found');
      setIsLoading(false);
      return;
    }

    const fetchData = async () => {
      if (fetchInProgressRef.current) {
        return;
      }
      fetchInProgressRef.current = true;
      try {
        // If no symbol and no valid explicit address is provided, do nothing until inputs are ready
        const normalizedSymbol = (symbol || '').trim();
        const explicitAddr = (_options?.orderBookAddress as string | undefined) || undefined;
        const hasValidExplicitAddr = !!(explicitAddr && explicitAddr.startsWith('0x') && explicitAddr.length === 42);
        if (!normalizedSymbol && !hasValidExplicitAddr) {
          setIsLoading(false);
          // Allow subsequent attempts once inputs change
          fetchInProgressRef.current = false;
          return;
        }

        setIsLoading(true);
        setError(null);

        // Prefer backend aggregator API to avoid browser-side RPC bursts.
        if (source === 'api') {
          try {
            const params = new URLSearchParams();
            if (normalizedSymbol) params.set('symbol', normalizedSymbol);
            const explicitAddr = (_options?.orderBookAddress as string | undefined) || '';
            if (explicitAddr && explicitAddr.startsWith('0x') && explicitAddr.length === 42) params.set('orderBookAddress', explicitAddr);
            const mid = (_options?.marketIdBytes32 as string | undefined) || '';
            if (mid && mid.startsWith('0x')) params.set('marketIdBytes32', mid);
            params.set('levels', String(requestedLevels));
            const resp = await fetch(`/api/orderbook/live?${params.toString()}`, { method: 'GET' });
            if (resp.ok) {
              const json = await resp.json();
              const ob = (json as any)?.data || null;
              const addr = (ob?.orderBookAddress as Address | null) || null;
              if (addr) {
                try {
                  if (addr !== watchAddressRef.current) {
                    watchAddressRef.current = addr;
                    setWatchAddress(addr);
                  }
                } catch {}
              }
              if (!cancelled && ob) {
                setData({
                  orderBookAddress: addr,
                  bestBid: typeof ob.bestBid === 'number' ? ob.bestBid : null,
                  bestAsk: typeof ob.bestAsk === 'number' ? ob.bestAsk : null,
                  lastTradePrice: typeof ob.lastTradePrice === 'number' ? ob.lastTradePrice : null,
                  markPrice: typeof ob.markPrice === 'number' ? ob.markPrice : null,
                  totalTrades: typeof ob.totalTrades === 'number' ? ob.totalTrades : null,
                  volume24h: typeof ob.volume24h === 'number' ? ob.volume24h : null,
                  openInterest: typeof ob.openInterest === 'number' ? ob.openInterest : null,
                  priceChange24h: typeof ob.priceChange24h === 'number' ? ob.priceChange24h : null,
                  activeBuyOrders: typeof ob.activeBuyOrders === 'number' ? ob.activeBuyOrders : null,
                  activeSellOrders: typeof ob.activeSellOrders === 'number' ? ob.activeSellOrders : null,
                  depth: ob.depth || null,
                  recentTrades: ob.recentTrades || null,
                  lastUpdated: ob.lastUpdated || new Date().toISOString(),
                } as OrderBookLiveData);
                setIsLoading(false);
              }

              // Polling strategy: keep it light; realtime events will call fetchNowRef anyway.
              const now = Date.now();
              const isEmptyBook = !ob?.depth || ((ob?.depth?.bidPrices?.length || 0) === 0 && (ob?.depth?.askPrices?.length || 0) === 0);
              const MAX_FAST_POLL_WINDOW_MS = 10_000;
              if (fastPollStartAtRef.current === 0) fastPollStartAtRef.current = now;
              const withinFastWindow = now - fastPollStartAtRef.current < MAX_FAST_POLL_WINDOW_MS;
              try { if (pollTimerRef.current) { clearInterval(pollTimerRef.current); } } catch {}
              pollTimerRef.current = setInterval(() => {
                fetchNowRef.current?.();
              }, Math.max(2500, refreshInterval));
              try { if (fastPollTimerRef.current) { clearInterval(fastPollTimerRef.current); } } catch {}
              if (isEmptyBook && withinFastWindow) {
                fastPollTimerRef.current = setInterval(() => {
                  fetchNowRef.current?.();
                }, 1500);
              }
              // Success path: skip direct RPC
              fetchInProgressRef.current = false;
              return;
            }
          } catch (apiErr) {
            // fall through to RPC below
            console.warn('[OrderBook] API fetch failed, falling back to RPC', apiErr);
          }
        }

        const address = await resolveOrderBookAddress();
        console.log('The fetchData function', address);
        if (!address) {
          // Schedule a jittered retry instead of throwing
          const attempt = ++resolveAttemptsRef.current;
          const baseDelay = Math.min(1500 * attempt, 8000);
          const jitter = Math.floor(Math.random() * 400);
          const delay = baseDelay + jitter;
          console.warn(`[OrderBook] Address not resolved yet for ${symbol}. Retrying in ${delay}ms (attempt ${attempt})`);
          // Immediately allow subsequent fetch attempts (e.g., when options change)
          fetchInProgressRef.current = false;
          try { if (addressRetryTimerRef.current) { clearTimeout(addressRetryTimerRef.current); } } catch {}
          addressRetryTimerRef.current = setTimeout(() => {
            if (!cancelled) {
              void fetchData();
            }
          }, delay);
          return;
        }

        // Track resolved address for the centralized event hub (only update on change)
        try {
          if (address && address !== watchAddressRef.current) {
            watchAddressRef.current = address;
            setWatchAddress(address);
          }
        } catch {}
        // If we previously used a fallback, ensure we resubscribe on real address change
        if (resolvedIsFallbackRef.current === true) {
          // Reset flag so subsequent resolves use cache
          resolvedIsFallbackRef.current = false;
        }
        // Reset attempts on success
        resolveAttemptsRef.current = 0;
        // First fetch depth quickly and update state so UI can render bids/asks immediately
        let depth: OrderBookLiveData['depth'] = null;
        try {
          const levels = BigInt(requestedLevels);
          let d: any = null;
          try {
            // Prefer pointer walk so we always fetch the levels closest to the spread (best bid/ask outward).
            d = await withTimeout(publicClient.readContract({ address, abi, functionName: 'getOrderBookDepthFromPointers', args: [levels] }), 2000, 'getOrderBookDepthFromPointers');
          } catch (_e) {
            // Fallback: full scan + sort (can be heavier on large books)
            try {
              d = await withTimeout(publicClient.readContract({ address, abi, functionName: 'getOrderBookDepth', args: [levels] }), 2500, 'getOrderBookDepth');
            } catch (_fallbackError) {}
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
        } catch (_error) {}

        if (!cancelled) {
          setData((prev) => ({
            orderBookAddress: address,
            bestBid: prev?.bestBid ?? 0,
            bestAsk: prev?.bestAsk ?? 0,
            lastTradePrice: prev?.lastTradePrice ?? null,
            markPrice: prev?.markPrice ?? null,
            totalTrades: prev?.totalTrades ?? null,
            volume24h: prev?.volume24h ?? null,
            openInterest: prev?.openInterest ?? null,
            priceChange24h: prev?.priceChange24h ?? null,
            activeBuyOrders: prev?.activeBuyOrders ?? null,
            activeSellOrders: prev?.activeSellOrders ?? null,
            depth,
            recentTrades: prev?.recentTrades ?? null,
            lastUpdated: new Date().toISOString(),
          } as OrderBookLiveData));
          setIsLoading(false);
          // Polling: always respect refreshInterval. Optionally do a brief fast-poll window after first resolve.
          const now = Date.now();
          const isEmptyBook = !depth || ((depth.bidPrices?.length || 0) === 0 && (depth.askPrices?.length || 0) === 0);
          const MAX_FAST_POLL_WINDOW_MS = 10_000;
          if (fastPollStartAtRef.current === 0) fastPollStartAtRef.current = now;
          const withinFastWindow = now - fastPollStartAtRef.current < MAX_FAST_POLL_WINDOW_MS;

          try { if (pollTimerRef.current) { clearInterval(pollTimerRef.current); } } catch {}
          pollTimerRef.current = setInterval(() => {
            fetchNowRef.current?.();
          }, Math.max(2500, refreshInterval));

          // Only fast-poll briefly, and only if the book is empty (newly deployed / just starting up).
          try { if (fastPollTimerRef.current) { clearInterval(fastPollTimerRef.current); } } catch {}
          if (isEmptyBook && withinFastWindow) {
            fastPollTimerRef.current = setInterval(() => {
              fetchNowRef.current?.();
            }, 1500);
          }
        }

        // In parallel, fetch prices quickly; fetch stats/counts/trades on a slower cadence to reduce RPC spam.
        const now = Date.now();
        const SLOW_READS_INTERVAL_MS = Math.max(30_000, refreshInterval * 2);
        const shouldRunSlowReads = lastSlowReadsAtRef.current === 0 || (now - lastSlowReadsAtRef.current >= SLOW_READS_INTERVAL_MS);
        if (shouldRunSlowReads) lastSlowReadsAtRef.current = now;

        const priceReads = (async () => {
          let bestBidRaw: bigint = 0n;
          let bestAskRaw: bigint = 0n;
          let lastTradeRaw: bigint = 0n;
          let markPriceRaw: bigint = 0n;
          try {
            const mp: any = await withTimeout(publicClient.readContract({ address, abi, functionName: 'getMarketPriceData', args: [] }), 2500, 'getMarketPriceData');
            if (Array.isArray(mp) && mp.length >= 8) {
              bestBidRaw = BigInt(mp[1] ?? 0);
              bestAskRaw = BigInt(mp[2] ?? 0);
              lastTradeRaw = BigInt(mp[3] ?? 0);
              markPriceRaw = BigInt(mp[4] ?? 0);
            } else {
              throw new Error('getMarketPriceData returned unexpected shape');
            }
          } catch (_error) {
            try {
              bestBidRaw = (await withTimeout(publicClient.readContract({ address, abi, functionName: 'bestBid', args: [] }), 1500, 'bestBid').catch(() => 0n)) as unknown as bigint;
              bestAskRaw = (await withTimeout(publicClient.readContract({ address, abi, functionName: 'bestAsk', args: [] }), 1500, 'bestAsk').catch(() => 0n)) as unknown as bigint;
              lastTradeRaw = (await withTimeout(publicClient.readContract({ address, abi, functionName: 'lastTradePrice', args: [] }), 1500, 'lastTradePrice').catch(() => 0n)) as unknown as bigint;
              markPriceRaw = (await withTimeout(publicClient.readContract({ address, abi, functionName: 'calculateMarkPrice', args: [] }), 1500, 'calculateMarkPrice').catch(() => 0n)) as unknown as bigint;
            } catch {
              // ignore completely if still failing
            }
          }
          const bestBid = scalePrice(bestBidRaw as any) || 0;
          const bestAsk = scalePrice(bestAskRaw as any) || 0;
          const lastTradePrice = scalePrice(lastTradeRaw as any) || null;
          const markPriceCalc = scalePrice(markPriceRaw as any) || null;
          const markPrice = markPriceCalc && markPriceCalc > 0 ? markPriceCalc : (bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : (lastTradePrice || 0));
          if (!cancelled) {
            setData((prev) => ({
              ...(prev as OrderBookLiveData),
              orderBookAddress: address,
              bestBid,
              bestAsk,
              lastTradePrice,
              markPrice,
              lastUpdated: new Date().toISOString(),
            }));
          }
        })();

        const statsReads = (async () => {
          if (!shouldRunSlowReads) return;
          let volume24h: bigint | null = null,
            openInterest: bigint | null = null,
            totalTrades: bigint | null = null,
            priceChange24h: bigint | null = null;
          try {
            const stats: any = await withTimeout(publicClient.readContract({ address, abi, functionName: 'getMarketStats', args: [] }), 2000, 'getMarketStats');
            if (Array.isArray(stats) && stats.length >= 5) {
              volume24h = BigInt(stats[0]);
              openInterest = BigInt(stats[1]);
              totalTrades = BigInt(stats[2]);
              priceChange24h = BigInt(stats[4]);
            }
          } catch {}
          const toNumNullable = (x: bigint | null): number | null => (x === null ? null : Number(x));
          if (!cancelled) {
            setData((prev) => ({
              ...(prev as OrderBookLiveData),
              volume24h: toNumNullable(volume24h),
              openInterest: toNumNullable(openInterest),
              totalTrades: toNumNullable(totalTrades),
              priceChange24h: scalePrice(priceChange24h),
              lastUpdated: new Date().toISOString(),
            }));
          }
        })();

        const countsReads = (async () => {
          if (!shouldRunSlowReads) return;
          let activeBuyOrders: bigint | null = null;
          let activeSellOrders: bigint | null = null;
          try {
            const counts: any = await withTimeout(publicClient.readContract({ address, abi, functionName: 'getActiveOrdersCount', args: [] }), 2000, 'getActiveOrdersCount');
            if (Array.isArray(counts) && counts.length >= 2) {
              activeBuyOrders = BigInt(counts[0]);
              activeSellOrders = BigInt(counts[1]);
            }
          } catch {}
          const toNumZero = (x: bigint | null): number => (x === null ? 0 : Number(x));
          if (!cancelled) {
            setData((prev) => ({
              ...(prev as OrderBookLiveData),
              activeBuyOrders: toNumZero(activeBuyOrders),
              activeSellOrders: toNumZero(activeSellOrders),
              lastUpdated: new Date().toISOString(),
            }));
          }
        })();

        const tradesReads = (async () => {
          if (!shouldRunSlowReads) return;
          let recentTrades: OrderBookLiveData['recentTrades'] = null;
          try {
            let trades: any = null;
            try {
              trades = await withTimeout(publicClient.readContract({ address, abi, functionName: 'getLastTwentyTrades', args: [] }), 2500, 'getLastTwentyTrades');
            } catch (_e) {
              const limit = 20n;
              trades = await withTimeout(publicClient.readContract({ address, abi, functionName: 'getRecentTrades', args: [limit] }), 2500, 'getRecentTrades');
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
          if (!cancelled) {
            setData((prev) => ({
              ...(prev as OrderBookLiveData),
              recentTrades,
              lastUpdated: new Date().toISOString(),
            }));
          }
        })();

        await Promise.allSettled([priceReads, statsReads, countsReads, tradesReads]);
      } catch (e: any) {
        console.error(`OrderBook data fetch failed for ${symbol}:`, e);
        if (!cancelled) {
          setError(e?.message || 'Failed to fetch OrderBook data');
          setIsLoading(false);
        }
      } finally {
        fetchInProgressRef.current = false;
      }
    };

    // expose immediate fetch for realtime triggers
    fetchNowRef.current = () => {
      // Simple debounce to avoid bursts
      const now = Date.now();
      if (now - lastRealtimeRefreshRef.current < 750) {
        try {
          // eslint-disable-next-line no-console
          console.log(`${UI_UPDATE_PREFIX} orderbookLive:fetchNow:debounced`, {
            symbol: String(symbol || '').toUpperCase(),
            deltaMs: now - lastRealtimeRefreshRef.current,
          });
        } catch {}
        return;
      }
      lastRealtimeRefreshRef.current = now;
      try {
        // eslint-disable-next-line no-console
        console.log(`${UI_UPDATE_PREFIX} orderbookLive:fetchNow:run`, { symbol: String(symbol || '').toUpperCase() });
      } catch {}
      void fetchData();
    };

    fetchData();

    // Log mode: this hook operates read-only without requiring a wallet
    try {
      console.log(`[OrderBook] Read-only mode. HTTP RPC: ${CHAIN_CONFIG.rpcUrl} | WS RPC: ${CHAIN_CONFIG.wsRpcUrl || 'none'}`);
    } catch {}

    return () => {
      cancelled = true;
      try { if (pollTimerRef.current) { clearInterval(pollTimerRef.current); } } catch {}
      try { if (fastPollTimerRef.current) { clearInterval(fastPollTimerRef.current); } } catch {}
      try { if (addressRetryTimerRef.current) { clearTimeout(addressRetryTimerRef.current); } } catch {}
    };
  }, [symbol, publicClient, _options?.orderBookAddress, _options?.marketIdBytes32, enabled, refreshInterval, source]);

  return { data, isLoading, error } as const;
}


