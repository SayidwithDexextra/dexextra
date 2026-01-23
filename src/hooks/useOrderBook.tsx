import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWallet } from './useWallet';
import { usePositions } from './usePositions';
import { initializeContracts } from '@/lib/contracts';
import { useMarket } from '@/hooks/useMarket';
import { CONTRACT_ADDRESSES, CHAIN_CONFIG, populateMarketInfoClient } from '@/lib/contractConfig';
import { getReadProvider, ensureHyperliquidWallet } from '@/lib/network';
import { orderService } from '@/lib/orderService';
import { formatUnits, parseEther, parseUnits } from 'viem';
import { ethers } from 'ethers';
// Removed gas override utilities to rely on provider estimation
import type { Address } from 'viem';
import { createPublicClient, http } from 'viem';
import { createClientWithRPC } from '@/lib/viemClient';
import { useMarketEventHub } from '@/services/realtime/marketEventHub';
// Minimal ABI fragments for events to avoid wildcard import issues
const OrderBookEventABI = [
  {
    type: 'event',
    name: 'OrderPlaced',
    inputs: [
      { indexed: true, name: 'orderId', type: 'uint256' },
      { indexed: true, name: 'trader', type: 'address' },
      { indexed: false, name: 'price', type: 'uint256' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'isBuy', type: 'bool' }
    ]
  },
  {
    type: 'event',
    name: 'OrderFilled',
    inputs: [
      { indexed: true, name: 'orderId', type: 'uint256' },
      { indexed: true, name: 'trader', type: 'address' },
      { indexed: false, name: 'filledAmount', type: 'uint256' }
    ]
  },
  {
    type: 'event',
    name: 'OrderCancelled',
    inputs: [
      { indexed: true, name: 'orderId', type: 'uint256' },
      { indexed: true, name: 'trader', type: 'address' }
    ]
  }
] as const;

export interface OrderBookOrder {
  id: string;
  trader: Address;
  price: number;
  size: number;
  quantity: number;
  filledQuantity: number;
  isBuy: boolean;
  side: 'buy' | 'sell';
  status: 'pending' | 'partially_filled' | 'filled' | 'cancelled' | 'expired';
  filled: number;
  timestamp?: number;
  expiryTime?: number;
}

export interface TradeHistoryItem {
  tradeId: string;
  buyer: Address;
  seller: Address;
  price: number;
  amount: number;
  tradeValue: number;
  buyerFee: number;
  sellerFee: number;
  buyerIsMargin: boolean;
  sellerIsMargin: boolean;
  timestamp: number;
}

export interface OrderBookState {
  bestBid: number;
  bestAsk: number;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  activeOrders: OrderBookOrder[];
  tradeHistory: TradeHistoryItem[];
  tradeCount: number;
  totalVolume: number;
  totalFees: number;
  buyCount: number;
  sellCount: number;
  isLoading: boolean;
  error: string | null;
}

export interface OrderBookActions {
  placeMarketOrder: (size: number, isBuy: boolean, maxSlippageBps?: number) => Promise<boolean>;
  placeLimitOrder: (price: number, size: number, isBuy: boolean) => Promise<boolean>;
  cancelOrder: (orderId: string) => Promise<boolean>;
  closePosition: (positionId: string, closeSize: number, maxSlippageBps?: number) => Promise<boolean>;
  refreshOrders: () => Promise<void>;
  getOrderBookDepth: (depth: number) => Promise<{
    bids: { price: number; size: number }[];
    asks: { price: number; size: number }[];
  }>;
  getBestPrices: () => Promise<{ bestBid: number; bestAsk: number }>;
  getUserTradeHistory: (offset?: number, limit?: number) => Promise<{
    trades: TradeHistoryItem[];
    hasMore: boolean;
  }>;
  getUserTradeCountOnly: () => Promise<number>;
  refreshTradeHistory: () => Promise<void>;
}

type OrdersSessionCachePayload = {
  version: 1;
  chainId: string | number;
  walletAddress: string;
  marketId: string;
  ts: number;
  orders: OrderBookOrder[];
};

export function useOrderBook(marketId?: string): [OrderBookState, OrderBookActions] {
  // Prefer dynamic market address from DB when available
  const { market: marketRow } = useMarket(marketId as string);
  const wallet = useWallet() as any;
  const walletAddress: string | null = wallet?.walletData?.address ?? wallet?.address ?? null;
  const walletSigner = wallet?.walletData?.signer ?? wallet?.signer ?? null;
  const walletIsConnected: boolean = !!(wallet?.walletData?.isConnected ?? wallet?.isConnected);
  const [contracts, setContracts] = useState<any>(null);
  const positionsState = usePositions(marketId);
  const [state, setState] = useState<OrderBookState>({
    bestBid: 0,
    bestAsk: 0,
    markPrice: 0,
    indexPrice: 0,
    fundingRate: 0,
    activeOrders: [],
    tradeHistory: [],
    tradeCount: 0,
    totalVolume: 0,
    totalFees: 0,
    buyCount: 0,
    sellCount: 0,
    isLoading: true,
    error: null
  });

  // Keep track of last successful trade history fetch
  const lastTradeHistoryRef = useRef<{
    trades: TradeHistoryItem[];
    hasMore: boolean;
  } | null>(null);
  const fastRefreshRef = useRef<null | (() => void)>(null);
  const lastRealtimeRefreshRef = useRef<number>(0);
  const ENABLE_ORDERBOOK_POLLING = false;
  const [obAddress, setObAddress] = useState<Address | null>(null);

  const ordersSessionHydratedRef = useRef<string | null>(null);
  const opOrdersLogRef = useRef<{
    key: string;
    mode: 'no_session' | 'has_session';
    didLogFetchedOrders: boolean;
  } | null>(null);

  const getOrdersSessionKey = (addr: string, market: string) => {
    const chainId = String((CHAIN_CONFIG as any)?.chainId ?? 'unknown');
    return `orderbook:activeOrders:v1:${chainId}:${String(addr).toLowerCase()}:${String(market).toUpperCase()}`;
  };

  const hydrateOrdersFromSession = () => {
    if (typeof window === 'undefined') return;
    if (!walletAddress || !marketId) return;
    const key = getOrdersSessionKey(walletAddress, marketId);
    if (ordersSessionHydratedRef.current === key) return;
    ordersSessionHydratedRef.current = key;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) {
        // eslint-disable-next-line no-console
        console.log('[OPorders] Fetching orders');
        opOrdersLogRef.current = { key, mode: 'no_session', didLogFetchedOrders: false };
        return;
      }
      const payload = JSON.parse(raw) as OrdersSessionCachePayload;
      if (!payload || payload.version !== 1) return;
      if (String(payload.walletAddress || '').toLowerCase() !== String(walletAddress).toLowerCase()) return;
      if (String(payload.marketId || '').toUpperCase() !== String(marketId).toUpperCase()) return;
      if (!Array.isArray(payload.orders)) return;
      const orders = payload.orders as OrderBookOrder[];
      if (orders.length === 0) {
        // Drop stale empty cache to avoid persisting blanks for markets without orders
        window.sessionStorage.removeItem(key);
        return;
      }
      // eslint-disable-next-line no-console
      console.log('[OPorders] Skip skipping fetching orders');
      opOrdersLogRef.current = { key, mode: 'has_session', didLogFetchedOrders: false };
      setState(prev => ({
        ...prev,
        activeOrders: orders
      }));
      // eslint-disable-next-line no-console
      console.log('[RealTimeToken] orderBook:session:hydrate', {
        marketId,
        walletAddress,
        orderCount: orders.length,
        ageMs: Date.now() - Number(payload.ts || 0)
      });
    } catch {
      // ignore malformed cache
    }
  };

  const persistOrdersToSession = (orders: OrderBookOrder[]) => {
    if (typeof window === 'undefined') return;
    if (!walletAddress || !marketId) return;
    try {
      const key = getOrdersSessionKey(walletAddress, marketId);
      if (!orders?.length) {
        // Do not persist empty markets; clean up any stale cache
        window.sessionStorage.removeItem(key);
        return;
      }
      const payload: OrdersSessionCachePayload = {
        version: 1,
        chainId: (CHAIN_CONFIG as any)?.chainId ?? 'unknown',
        walletAddress,
        marketId,
        ts: Date.now(),
        orders
      };
      window.sessionStorage.setItem(key, JSON.stringify(payload));
      // eslint-disable-next-line no-console
      console.log('[RealTimeToken] orderBook:session:persist', {
        marketId,
        walletAddress,
        orderCount: orders.length
      });
    } catch {
      // ignore persistence failures
    }
  };

  // Hydrate optimistic orders from session on first mount for this wallet+market,
  // then let live contract reads refresh in the background.
  useEffect(() => {
    if (!walletAddress || !marketId) return;
    hydrateOrdersFromSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, marketId]);

  // Initialize contracts when wallet is connected and market is resolvable
  useEffect(() => {
    const init = async () => {
      try {
        // Strictly resolve OrderBook by marketId on current chain
        const currentChain = CHAIN_CONFIG.chainId;
        let entries = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {}) as any[];
        // MARKET_INFO is populated at runtime; if empty, try a best-effort client-side population.
        if ((!entries || entries.length === 0) && marketId) {
          try {
            await populateMarketInfoClient(marketId);
          } catch {}
          entries = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {}) as any[];
        }

        const rawSearch = String(marketId || '').trim();
        const searchKey = rawSearch.toLowerCase();
        const prefixKey = (rawSearch.split('-')[0] || rawSearch).toLowerCase();
        const candidates = Array.from(new Set([searchKey, prefixKey].filter(Boolean)));

        const match = entries.find((m: any) => {
          // Filter to current chain when present
          if (m?.chainId && String(m.chainId) !== String(currentChain)) return false;
          const mSymbol = String(m?.symbol || '').toLowerCase();
          const mName = String(m?.name || '').toLowerCase();
          const mId = String(m?.marketIdentifier || '').toLowerCase();
          return candidates.some((c) => mSymbol === c || mName === c || mId === c || mSymbol.startsWith(`${c}-`));
        });
        
        // If we cannot resolve a market yet, skip initialization quietly and wait for later
        if (!match && !marketRow) {
          return;
        }

        // If MARKET_INFO doesn't have this market but DB does, proceed using DB data.
        if (!match && marketRow) {
          console.warn(`[ALTKN][useOrderBook] No MARKET_INFO entry for ${marketId} on chain ${currentChain}; using DB market row`);
        }
        
        // Prefer DB-sourced OrderBook address when available, fallback to static mapping
        const orderBookAddressOverride = (marketRow as any)?.market_address || match?.orderBook;
        if (!orderBookAddressOverride) {
          console.warn(`[ALTKN][useOrderBook] No OrderBook address for ${marketId} on chain ${currentChain}`);
          setState(prev => ({ 
            ...prev, 
            error: `Market ${marketId} contract not deployed on current network`,
            isLoading: false 
          }));
          return;
        }
        // Track address for centralized event hub
        try {
          const addr = String(orderBookAddressOverride);
          if (addr.startsWith('0x') && addr.length === 42) {
            setObAddress(addr as Address);
          }
        } catch {}
        // Choose runner: prefer signer; else derive signer from BrowserProvider; else fail
        let runner: ethers.Signer | ethers.Provider | undefined = undefined;
        if (walletSigner) {
          runner = walletSigner as ethers.Signer;
        } else if (typeof window !== 'undefined' && (window as any).ethereum) {
          try {
            const injectedSigner = await ensureHyperliquidWallet();
            // Validate connected network matches configured chain; otherwise fall back to read-only provider
            try {
              const net = await (injectedSigner.provider as any)?.getNetwork?.();
              const required = BigInt(CHAIN_CONFIG.chainId);
              if (!net || net.chainId !== required) {
                console.warn('[ALTKN][useOrderBook] Wrong network detected', { connected: net?.chainId?.toString?.(), required: required.toString() });
                setState(prev => ({ ...prev, error: `Wrong network. Using read-only data for chainId ${CHAIN_CONFIG.chainId}.` }));
                runner = getReadProvider();
              } else {
                runner = injectedSigner;
              }
            } catch {
              // If we cannot determine network, prefer signer but errors may occur later
              runner = injectedSigner;
            }
          } catch (e) {
            // As a last resort, use provider for reads only (writes will fail)
            runner = getReadProvider();
          }
        }
        if (!runner) {
          try {
            if (CHAIN_CONFIG?.rpcUrl) {
              runner = getReadProvider();
            }
          } catch {}
          if (!runner) {
            setState(prev => ({ ...prev, error: 'Wallet/provider not available', isLoading: false }));
            return;
          }
        }
        // Prefer bytes32 market id when available for CoreVault mapping resolution
        let marketBytes32 =
          (marketRow as any)?.market_identifier_bytes32 ||
          (marketRow as any)?.market_id_bytes32 ||
          (match?.marketId as string | undefined);
        const contractInstances = await initializeContracts({ 
          providerOrSigner: runner, 
          orderBookAddressOverride,
          marketIdBytes32: marketBytes32
        });
        console.log('[ALTKN][useOrderBook] Initialized contracts for marketId', marketId, 'address', orderBookAddressOverride);
        
        // Ensure we have the trade execution facet
        if (!contractInstances.obTradeExecution) {
          console.warn('[ALTKN][useOrderBook] Trade execution facet not initialized');
        }
        
        setContracts(contractInstances);

      // Use market's bytes32 ID for CoreVault mapping
      marketBytes32 =
        (marketRow as any)?.market_identifier_bytes32 ||
        (marketRow as any)?.market_id_bytes32 ||
        (match?.marketId as string | undefined);
      if (marketBytes32 && contractInstances.vault?.marketToOrderBook) {
        try {
          const resolved = await contractInstances.vault.marketToOrderBook(marketBytes32);
          if (resolved && resolved.toLowerCase() !== orderBookAddressOverride.toLowerCase()) {
            console.warn(`[ALTKN][useOrderBook] CoreVault mapping mismatch for ${marketId}:`,
              `\nExpected: ${orderBookAddressOverride}`,
              `\nResolved: ${resolved}`
            );
          }
        } catch (e) {
          console.warn('[ALTKN][useOrderBook] CoreVault mapping check failed:', e);
        }
      }
      } catch (error: any) {
        console.error('[ALTKN] Failed to initialize contracts:', error);
        setState(prev => ({ ...prev, error: 'Failed to initialize contracts', isLoading: false }));
      }
    };

    init();
  }, [walletIsConnected, walletSigner, marketId, (marketRow as any)?.market_address]);

  // Centralized real-time event bridge (OrderPlaced + TradeExecutionCompleted).
  // Replaces the previous per-hook Pusher subscription.
  const hubSubscriber = useMemo(() => {
    return {
      dispatchDomEvents: true,
      onOrdersChanged: () => fastRefreshRef.current?.(),
      onTradesChanged: () => fastRefreshRef.current?.(),
    };
  }, []);
  useMarketEventHub(marketId || '', obAddress, hubSubscriber);

  // Fetch initial market data (no polling)
  useEffect(() => {
    if (!contracts) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    const fetchMarketData = async () => {
      try {
        console.log(`[ALTKN] 📡 [RPC] Starting OrderBook market data fetch for ${marketId}`);
        // Fetch orders first (only when walletAddress is available)
        let hydrated: OrderBookOrder[] = [];
        if (walletAddress) {
          try {
            // Ensure the OrderBook contract code exists on current network before calling
            try {
              // ethers v6: Contract.runner is Provider | Signer (Contract doesn't reliably expose .provider)
              const runner: any = (contracts.obView as any)?.runner;
              const provider: any = runner?.provider ?? runner;
              const obAddr = (contracts.orderBookAddress || (await (contracts.obView as any)?.getAddress?.())) as string | undefined;
              if (provider && typeof provider.getCode === 'function' && obAddr) {
                const code = await provider.getCode(obAddr);
                if (!code || code === '0x') {
                  console.warn('[ALTKN][useOrderBook] OrderBook contract code not found on current network. Skipping on-chain order fetch.');
                  setState(prev => ({ ...prev, error: 'OrderBook not deployed on current network', isLoading: false }));
                  return;
                }
              }
            } catch (codeErr) {
              // Proceed; any decode errors will be caught below
            }
            console.log(`[ALTKN] 📡 [RPC] Fetching user orders via getUserOrders for ${walletAddress}`);
            let orderIds: bigint[] = [];
            let getUserOrdersErr: any = null;
            try {
              const startTimeOrders = Date.now();
              orderIds = await contracts.obView.getUserOrders(walletAddress);
              const durationOrders = Date.now() - startTimeOrders;
              console.log(`[ALTKN] ✅ [RPC] User orders fetched in ${durationOrders}ms`, { orderCount: orderIds.length });
              console.log('[ALTKN][useOrderBook] getUserOrders count =', orderIds.length);
            } catch (e: any) {
              getUserOrdersErr = e;
              const msg = e?.message || '';
              const code = e?.code || '';
              const isMissingSelector = msg.includes('missing revert data') || code === 'CALL_EXCEPTION';
              if (isMissingSelector) {
                console.warn('[ALTKN][useOrderBook] getUserOrders not available on this OrderBook (facet missing). Will use fallback.', e);
              } else {
                console.warn('[ALTKN][useOrderBook] getUserOrders failed. Will attempt fallback.', e);
              }
            }

            if (Array.isArray(orderIds) && orderIds.length > 0) {
              for (const id of orderIds) {
                try {
                  console.log(`[ALTKN] 📡 [RPC] Fetching order details for order ID ${id}`);
                  const startTimeOrder = Date.now();
                  const order = await contracts.obView.getOrder(id);
                  const filled = await contracts.obView.getFilledAmount(id);
                  const durationOrder = Date.now() - startTimeOrder;
                  console.log(`[ALTKN] ✅ [RPC] Order ${id} details fetched in ${durationOrder}ms`);

                  const getField = (o: any, key: string, index: number) => (o && (o[key] !== undefined ? o[key] : o[index]));
                  const orderIdRaw = getField(order, 'orderId', 0) as bigint;
                  const traderRaw = getField(order, 'trader', 1) as Address;
                  const priceRaw = getField(order, 'price', 2) as bigint;
                  const amountRaw = getField(order, 'amount', 3) as bigint;
                  const isBuyRaw = getField(order, 'isBuy', 4) as boolean;
                  const timestampRaw = getField(order, 'timestamp', 5) as bigint;
                  const priceNum = Number(formatUnits(priceRaw ?? 0n, 6));
                  const sizeNum = Number(formatUnits(amountRaw ?? 0n, 18));
                  const filledNum = Number(formatUnits(filled, 18));
                  hydrated.push({
                    id: (orderIdRaw ?? id).toString(),
                    trader: traderRaw as Address,
                    price: priceNum,
                    size: sizeNum,
                    quantity: sizeNum,
                    filledQuantity: filledNum,
                    isBuy: Boolean(isBuyRaw),
                    side: isBuyRaw ? 'buy' : 'sell',
                    status: (amountRaw && filled >= amountRaw) ? 'filled' : filled > 0n ? 'partially_filled' : 'pending',
                    filled: filledNum,
                    timestamp: timestampRaw ? Number(timestampRaw) * 1000 : Date.now(),
                    expiryTime: undefined
                  });
                } catch (e) {
                  console.warn(`[ALTKN] ⚠️ [RPC] Failed to hydrate order ${id}:`, e);
                }
              }
            }

            // Fallback via orderService when on-chain path yields nothing (or getUserOrders is missing/broken)
            if (hydrated.length === 0) {
              try {
                const metricHint = marketId || 'ALUMINUM';
                const svcOrders = await orderService.getUserOrdersFromOrderBook(walletAddress as Address, metricHint);
                const mapped = svcOrders.map(o => ({
                  id: o.id,
                  trader: o.trader,
                  price: o.price,
                  size: o.quantity,
                  quantity: o.quantity,
                  filledQuantity: o.filledQuantity,
                  isBuy: o.side === 'buy',
                  side: o.side,
                  status: o.status,
                  filled: o.filledQuantity,
                  timestamp: o.timestamp,
                  expiryTime: o.expiryTime || undefined,
                })) as OrderBookOrder[];
                if (mapped.length > 0) {
                  console.log('[ALTKN][useOrderBook] Fallback orderService returned', mapped.length, 'orders');
                  hydrated = mapped;
                } else if (getUserOrdersErr) {
                  // Preserve a helpful error when both on-chain + fallback fail
                  setState(prev => ({ ...prev, error: 'Failed to fetch orders from blockchain. Please try again.' }));
                }
              } catch (svcErr) {
                console.warn('[ALTKN][useOrderBook] orderService fallback failed', svcErr);
                if (getUserOrdersErr) {
                  setState(prev => ({ ...prev, error: 'Failed to fetch orders from blockchain. Please try again.' }));
                }
              }
            }
            // No cross-market fallbacks - each market uses its own OrderBook only
          } catch (e: any) {
            console.error('[ALTKN][useOrderBook] Failed to fetch user orders', e);
            setState(prev => ({ ...prev, error: 'Failed to fetch orders from blockchain. Please try again.' }));
          }
        }
        // If we didn't have session orders, log the fetched on-chain result once (pairs with "[OPorders] Fetching orders").
        try {
          if (walletAddress && marketId) {
            const key = getOrdersSessionKey(walletAddress, marketId);
            const ref = opOrdersLogRef.current;
            if (ref && ref.key === key && ref.mode === 'no_session' && !ref.didLogFetchedOrders) {
              // eslint-disable-next-line no-console
              console.log('[OPorders]', hydrated);
              ref.didLogFetchedOrders = true;
            }
          }
        } catch {
          // ignore log issues
        }

        // Market data (best prices, mark/index/funding) - resilient defaults
        let bestBidNum = 0;
        let bestAskNum = 0;
        let markPriceNum = 0;
        let indexPriceNum = 0;
        let fundingRateNum = 0;
        try {
          console.log(`[ALTKN] 📡 [RPC] Fetching best prices via pricing facet`);
          const startTimePrices = Date.now();
          let bestBid: bigint = 0n;
          let bestAsk: bigint = 0n;
          try { bestBid = await contracts.obPricing.getBestBid(); } catch {}
          try { bestAsk = await contracts.obPricing.getBestAsk(); } catch {}
          const durationPrices = Date.now() - startTimePrices;
          bestBidNum = Number(formatUnits(bestBid, 6));
          bestAskNum = Number(formatUnits(bestAsk, 6));
          console.log(`[ALTKN] ✅ [RPC] Best prices fetched in ${durationPrices}ms`, { bestBid: bestBidNum, bestAsk: bestAskNum });
        } catch (e) {
          console.warn(`[ALTKN] ⚠️ [RPC] Best prices unavailable:`, e);
        }
        try {
          console.log(`[ALTKN] 📡 [RPC] Fetching market price data via getMarketPriceData`);
          const startTimeMarket = Date.now();
          const mp = await contracts.obPricing.getMarketPriceData();
          const durationMarket = Date.now() - startTimeMarket;
          // Some providers return an array instead of object; handle both
          const mpMark = (mp?.markPrice ?? (Array.isArray(mp) ? mp[0] : 0n)) as bigint;
          const mpIndex = (mp?.indexPrice ?? (Array.isArray(mp) ? mp[1] : 0n)) as bigint;
          const mpFunding = (mp?.fundingRate ?? (Array.isArray(mp) ? mp[2] : 0n)) as bigint;
          markPriceNum = Number(formatUnits(mpMark, 6));
          indexPriceNum = Number(formatUnits(mpIndex, 6));
          // funding could be signed; handle via Number() fallback
          try { fundingRateNum = Number(formatUnits(mpFunding, 6)); } catch { fundingRateNum = Number(mpFunding) / 1e6; }
          console.log(`[ALTKN] ✅ [RPC] Market price data fetched in ${durationMarket}ms`, {
            markPrice: markPriceNum,
            indexPrice: indexPriceNum,
            fundingRate: fundingRateNum
          });
        } catch (e) {
          console.warn(`[ALTKN] ⚠️ [RPC] Market price data unavailable:`, e);
        }

        console.log(`[ALTKN] 📊 [RPC] OrderBook market data fetch complete for ${marketId}`, {
          bestBid: bestBidNum,
          bestAsk: bestAskNum,
          markPrice: markPriceNum,
          indexPrice: indexPriceNum,
          fundingRate: fundingRateNum,
          ordersCount: hydrated.length,
          walletAddress: walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'none'
        });

        setState(prev => ({
          ...prev,
          bestBid: bestBidNum,
          bestAsk: bestAskNum,
          markPrice: markPriceNum,
          indexPrice: indexPriceNum,
          fundingRate: fundingRateNum,
          activeOrders: hydrated,
          isLoading: false,
          error: hydrated.length === 0 && walletAddress && prev.error ? 'No orders found after multiple attempts. Please try again later.' : null
        }));
        if (walletAddress && marketId) {
          persistOrdersToSession(hydrated);
        }
      } catch (error: any) {
        console.error(`[ALTKN] ❌ [RPC] OrderBook market data fetch failed for ${marketId}:`, error);
        setState(prev => ({ ...prev, error: 'Failed to fetch market data. Please try again.', isLoading: false }));
      }
    };

    // Expose fast refresh for realtime triggers
    fastRefreshRef.current = () => {
      const now = Date.now();
      if (now - lastRealtimeRefreshRef.current < 750) return;
      lastRealtimeRefreshRef.current = now;
      void fetchMarketData();
    };

    // Initial fetch only
    fetchMarketData();

    // Optional polling disabled by default
    if (!ENABLE_ORDERBOOK_POLLING) {
      return () => { /* no interval to clear */ };
    }

    const interval = setInterval(fetchMarketData, 5000);
    return () => { clearInterval(interval); };
  }, [contracts, walletAddress, marketId]);

  // (Realtime handled by MarketEventHub)

  // Place market order
  const placeMarketOrder = useCallback(async (
    size: number,
    isBuy: boolean,
    maxSlippageBps: number = 100 // 1% default slippage
  ): Promise<boolean> => {
    if (!contracts || !walletAddress) {
      setState(prev => ({ ...prev, error: 'Wallet not connected' }));
      return false;
    }

    try {
      console.log(`[ALTKN] 🚀 [RPC] Placing market order for ${marketId}`, { size, isBuy, maxSlippageBps });
      // Settlement guard: prevent orders if market is settled
      try {
        console.log(`[ALTKN] 📡 [RPC] Checking settlement status via isSettled`);
        const startTimeSettlement = Date.now();
        const settled = await (contracts.obSettlement?.isSettled?.() as Promise<boolean>);
        const durationSettlement = Date.now() - startTimeSettlement;
        console.log(`[ALTKN] ✅ [RPC] Settlement check completed in ${durationSettlement}ms`, { settled });

        if (settled) {
          setState(prev => ({ ...prev, error: 'Market has been settled. New orders are disabled.' }));
          return false;
        }
      } catch (error) {
        console.warn(`[ALTKN] ⚠️ [RPC] Settlement check failed:`, error);
        // ignore if facet not present
      }

      const sizeWei = parseEther(size.toString());
      // Preflight static call to surface revert reasons early
      try {
        console.log(`[ALTKN] 📡 [RPC] Running preflight static call for market order`);
        const startTimePreflight = Date.now();
        await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage.staticCall(
          sizeWei,
          isBuy,
          maxSlippageBps
        );
        const durationPreflight = Date.now() - startTimePreflight;
        console.log(`[ALTKN] ✅ [RPC] Preflight check passed in ${durationPreflight}ms`);
      } catch (preflightErr: any) {
        const msg = preflightErr?.shortMessage || preflightErr?.message || String(preflightErr);
        console.error(`[ALTKN] ❌ [RPC] Preflight check failed:`, preflightErr);
        setState(prev => ({ ...prev, error: msg || 'Market order preflight failed' }));
        return false;
      }
      // Use slippage-protected market order with default provider estimation
      const mktOverrides: any = {};
      // Pre-send native balance check to avoid -32603 from insufficient gas funds
      try {
        const provider: any = (contracts.obOrderPlacement as any)?.runner?.provider || (contracts.obOrderPlacement as any)?.provider;
        const feeData = await provider.getFeeData();
        const gasPrice: bigint = (feeData?.maxFeePerGas ?? feeData?.gasPrice ?? 0n) as bigint;
        const estGas: bigint = (mktOverrides?.gasLimit as bigint) || 0n;
        if (walletAddress && gasPrice > 0n && estGas > 0n) {
          const needed = gasPrice * estGas;
          const balance = await provider.getBalance(walletAddress);
          if (balance < needed) {
            setState(prev => ({ ...prev, error: `Insufficient native balance for gas. Need ~${ethers.formatEther(needed)} ETH, have ${ethers.formatEther(balance)}.` }));
            return false;
          }
        }
      } catch (balErr: any) {
        console.warn('[ALTKN] ⚠️ [RPC] Gas funds check warning:', balErr?.message || balErr);
      }
      console.log(`[ALTKN] 📡 [RPC] Submitting market order transaction`);
      let startTimeTx = Date.now();
      let tx;
      tx = await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage(
        sizeWei,
        isBuy,
        maxSlippageBps,
        mktOverrides
      );
      const durationTx = Date.now() - startTimeTx;
      console.log(`[ALTKN] ✅ [RPC] Market order transaction submitted in ${durationTx}ms`, { txHash: tx.hash });
      console.log('[ALTKN][Order TX][market] submitted:', tx.hash);
      const receipt = await tx.wait();
      console.log('[ALTKN][Order TX][market] confirmed:', tx.hash);
      
      // Refresh orders after successful placement
      await refreshOrders();
      return true;
    } catch (error: any) {
      console.error('[ALTKN] Failed to place market order:', error);
      setState(prev => ({ ...prev, error: 'Failed to place market order' }));
      return false;
    }
  }, [contracts, walletAddress]);

  // Place limit order
  const placeLimitOrder = useCallback(async (
    price: number,
    size: number,
    isBuy: boolean
  ): Promise<boolean> => {
    if (!contracts || !walletAddress) {
      setState(prev => ({ ...prev, error: 'Wallet not connected' }));
      return false;
    }

    try {
      console.log(`[ALTKN] 📋 [RPC] Placing limit order for ${marketId}`, { price, size, isBuy });
      // Settlement guard
      try {
        console.log(`[ALTKN] 📡 [RPC] Checking settlement status for limit order`);
        const startTimeSettlement = Date.now();
        const settled = await (contracts.obSettlement?.isSettled?.() as Promise<boolean>);
        const durationSettlement = Date.now() - startTimeSettlement;
        console.log(`[ALTKN] ✅ [RPC] Settlement check completed in ${durationSettlement}ms`, { settled });

        if (settled) {
          setState(prev => ({ ...prev, error: 'Market has been settled. New orders are disabled.' }));
          return false;
        }
      } catch (error) {
        console.warn(`[ALTKN] ⚠️ [RPC] Settlement check failed for limit order:`, error);
        // ignore if facet not present
      }

      console.log('[ALTKN][DBG][placeLimitOrder] start', { marketId, walletAddress, price, size, isBuy });
      // Encode price with USDC decimals (6) and size with token decimals (18)
      const priceWei = parseUnits(price.toString(), 6);
      const sizeWei = parseEther(size.toString());

      // Determine available placement function via preflight (margin only)
      let placeFn: 'placeMarginLimitOrder' | 'placeLimitOrder' = 'placeMarginLimitOrder';
      try {
        await contracts.obOrderPlacement.placeMarginLimitOrder.staticCall(
          priceWei,
          sizeWei,
          isBuy
        );
      } catch (preflightErr: any) {
        const msg = preflightErr?.shortMessage || preflightErr?.message || preflightErr?.data?.message || String(preflightErr);
        // Diagnostic logging to verify we are using the correct OB diamond address
        try {
          const obAddr = typeof (contracts.obOrderPlacement as any)?.getAddress === 'function'
            ? await (contracts.obOrderPlacement as any).getAddress()
            : ((contracts.obOrderPlacement as any)?.target || (contracts.obOrderPlacement as any)?.address);
          const obViewAddr = typeof (contracts.obView as any)?.getAddress === 'function'
            ? await (contracts.obView as any).getAddress()
            : ((contracts.obView as any)?.target || (contracts.obView as any)?.address);
          const provider: any = (contracts.obOrderPlacement as any)?.runner?.provider || (contracts.obOrderPlacement as any)?.provider;
          let net: any = null;
          try { net = await provider?.getNetwork?.(); } catch {}
          let mapped: string | null = null;
          try {
            const mktIdHex = (marketRow as any)?.market_id_bytes32 || (marketRow as any)?.market_identifier_bytes32;
            if (mktIdHex && (contracts.vault as any)?.marketToOrderBook) {
              mapped = await (contracts.vault as any).marketToOrderBook(mktIdHex);
            }
          } catch {}
          let code = '0x';
          try { if (obAddr && provider) { code = await provider.getCode(obAddr); } } catch {}
          console.error('[ALTKN][DIAG][useOrderBook][limit-preflight] address and network diagnostics', {
            orderBookAddressOverride: (marketRow as any)?.market_address,
            obOrderPlacement: obAddr,
            obView: obViewAddr,
            coreVault: (contracts.vault as any)?.target || (contracts.vault as any)?.address,
            coreVaultMappedOB: mapped,
            chainId: (net && (net.chainId?.toString?.() || net.chainId)) || 'unknown',
            obCodeLength: (code || '').length
          });
        } catch (diagErr) {
          console.warn('[ALTKN][DIAG][useOrderBook][limit-preflight] logging failed', diagErr);
        }
        console.error(`[ALTKN] ❌ [RPC] Preflight check failed:`, preflightErr);
        setState(prev => ({ ...prev, error: msg || 'Limit order preflight failed' }));
        return false;
      }

      // Use default provider estimation for limit order
      const limOverrides: any = {};
      // Pre-send native balance check to avoid -32603 from insufficient gas funds
      try {
        const provider: any = (contracts.obOrderPlacement as any)?.runner?.provider || (contracts.obOrderPlacement as any)?.provider;
        let fromAddr: string | undefined;
        try { fromAddr = await (provider as any)?.getSigner?.()?.getAddress?.(); } catch {}
        const feeData = await provider.getFeeData();
        const gasPrice: bigint = (feeData?.maxFeePerGas ?? feeData?.gasPrice ?? 0n) as bigint;
        const estGas: bigint = (limOverrides?.gasLimit as bigint) || 0n;
        if (fromAddr && gasPrice > 0n && estGas > 0n) {
          const needed = gasPrice * estGas;
          const balance = await provider.getBalance(fromAddr);
          if (balance < needed) {
            setState(prev => ({ ...prev, error: `Insufficient native balance for gas. Need ~${ethers.formatEther(needed)} ETH, have ${ethers.formatEther(balance)}.` }));
            return false;
          }
        }
      } catch (balErr: any) {
        console.warn('[ALTKN] ⚠️ [RPC] Gas funds check warning:', balErr?.message || balErr);
      }

      console.log(`[ALTKN] 📡 [RPC] Submitting limit order transaction`);
      let startTimeTx = Date.now();
      let tx;
      tx = await contracts.obOrderPlacement.placeMarginLimitOrder(
        priceWei,
        sizeWei,
        isBuy,
        limOverrides
      );
      const durationTx = Date.now() - startTimeTx;
      console.log(`[ALTKN] ✅ [RPC] Limit order transaction submitted in ${durationTx}ms`, { txHash: tx.hash });
      console.log('[ALTKN][DBG][placeLimitOrder] tx sent', { hash: tx.hash });
      console.log('[ALTKN][Order TX][limit] submitted:', tx.hash);
      const receipt = await tx.wait();
      console.log('[ALTKN][DBG][placeLimitOrder] tx confirmed, awaiting refresh');
      console.log('[ALTKN][Order TX][limit] confirmed:', tx.hash);
      
      // Refresh orders after successful placement
      console.log('[ALTKN][Dispatch] 🔄 [UI][useOrderBook] Calling refreshOrders after placeLimitOrder');
      await refreshOrders();
      console.log('[ALTKN][Dispatch] ✅ [UI][useOrderBook] refreshOrders complete');
      return true;
    } catch (error: any) {
      console.error('[ALTKN] Failed to place limit order:', error);
      setState(prev => ({ ...prev, error: 'Failed to place limit order' }));
      return false;
    }
  }, [contracts, walletAddress]);

  // Refresh orders
  const refreshOrders = useCallback(async () => {
    if (!contracts || !walletAddress) return;

    try {
      console.log('[ALTKN][Dispatch] 🔄 [RPC] Refreshing orders for', marketId, `(wallet: ${walletAddress.slice(0, 6)}...)`);
      // Guard against calling into non-existent code which yields BAD_DATA decode errors
      try {
        const runner: any = (contracts.obView as any)?.runner;
        const provider: any = runner?.provider ?? runner;
        const obAddr = (contracts.orderBookAddress || (await (contracts.obView as any)?.getAddress?.())) as string | undefined;
        if (provider && typeof provider.getCode === 'function' && obAddr) {
          const code = await provider.getCode(obAddr);
          if (!code || code === '0x') {
            console.warn('[ALTKN][useOrderBook] OrderBook contract code not found on current network. Skipping refresh.');
            setState(prev => ({ ...prev, error: 'OrderBook not deployed on current network' }));
            return;
          }
        }
      } catch {}
      console.log('[ALTKN][Dispatch] 📡 [RPC] Fetching user orders for refresh');
      let orderIds: bigint[] = [];
      let getUserOrdersErr: any = null;
      try {
        const startTimeRefresh = Date.now();
        orderIds = await contracts.obView.getUserOrders(walletAddress);
        const durationRefresh = Date.now() - startTimeRefresh;
        console.log('[ALTKN][Dispatch] ✅ [RPC] Orders refresh fetched in', durationRefresh, 'ms', { orderCount: orderIds.length });
      } catch (e: any) {
        getUserOrdersErr = e;
        console.warn('[ALTKN][Dispatch] getUserOrders failed during refresh. Will attempt fallback.', e);
      }
      const hydrated: OrderBookOrder[] = [];
      if (Array.isArray(orderIds) && orderIds.length > 0) {
        for (const id of orderIds) {
          try {
            const order = await contracts.obView.getOrder(id);
            const filled = await contracts.obView.getFilledAmount(id);
            const getField = (o: any, key: string, index: number) => (o && (o[key] !== undefined ? o[key] : o[index]));
            const orderIdRaw = getField(order, 'orderId', 0) as bigint;
            const traderRaw = getField(order, 'trader', 1) as Address;
            const priceRaw = getField(order, 'price', 2) as bigint;
            const amountRaw = getField(order, 'amount', 3) as bigint;
            const isBuyRaw = getField(order, 'isBuy', 4) as boolean;
            const timestampRaw = getField(order, 'timestamp', 5) as bigint;
            const priceNum = Number(formatUnits(priceRaw ?? 0n, 6));
            const sizeNum = Number(formatUnits(amountRaw ?? 0n, 18));
            const filledNum = Number(formatUnits(filled, 18));
            hydrated.push({
              id: (orderIdRaw ?? id).toString(),
              trader: traderRaw as Address,
              price: priceNum,
              size: sizeNum,
              quantity: sizeNum,
              filledQuantity: filledNum,
              isBuy: Boolean(isBuyRaw),
              side: isBuyRaw ? 'buy' : 'sell',
              status: (amountRaw && filled >= amountRaw) ? 'filled' : filled > 0n ? 'partially_filled' : 'pending',
              filled: filledNum,
              timestamp: timestampRaw ? Number(timestampRaw) * 1000 : Date.now(),
              expiryTime: undefined
            });
          } catch (e) {
            // Skip bad order decode
          }
        }
      }
      // Fallback via orderService if empty
      if (hydrated.length === 0) {
        try {
          const metricHint = marketId || 'ALUMINUM';
          const svcOrders = await orderService.getUserOrdersFromOrderBook(walletAddress as Address, metricHint);
          const mapped = svcOrders.map(o => ({
            id: o.id,
            trader: o.trader,
            price: o.price,
            size: o.quantity,
            quantity: o.quantity,
            filledQuantity: o.filledQuantity,
            isBuy: o.side === 'buy',
            side: o.side,
            status: o.status,
            filled: o.filledQuantity,
            timestamp: o.timestamp,
            expiryTime: o.expiryTime || undefined,
          })) as OrderBookOrder[];
          if (mapped.length > 0) {
            console.log('[ALTKN][Dispatch] 🔁 [UI][useOrderBook] Updating activeOrders (fallback)', { count: mapped.length });
            setState(prev => ({ ...prev, activeOrders: mapped, error: null }));
            if (walletAddress && marketId) {
              persistOrdersToSession(mapped);
            }
            try {
              if (typeof window !== 'undefined') {
                const detail = { marketId, count: mapped.length, source: 'fallback', ts: Date.now() };
                console.log('[ALTKN][Dispatch] 📣 [EVT][useOrderBook] Dispatch ordersUpdated', detail);
                window.dispatchEvent(new CustomEvent('ordersUpdated', { detail }));
              }
            } catch {}
            return;
          }
        } catch {}
        if (getUserOrdersErr) {
          setState(prev => ({ ...prev, error: 'Failed to fetch orders from blockchain. Please try again.' }));
        }
      }

      console.log('[ALTKN][Dispatch] 🔁 [UI][useOrderBook] Updating activeOrders', { count: hydrated.length });
      setState(prev => ({
        ...prev,
        activeOrders: hydrated,
        error: null
      }));
      if (walletAddress && marketId) {
        persistOrdersToSession(hydrated);
      }
      try {
        if (typeof window !== 'undefined') {
          const detail = { marketId, count: hydrated.length, source: 'onchain', ts: Date.now() };
          console.log('[ALTKN][Dispatch] 📣 [EVT][useOrderBook] Dispatch ordersUpdated', detail);
          window.dispatchEvent(new CustomEvent('ordersUpdated', { detail }));
        }
      } catch {}
    } catch (error: any) {
      console.error('[ALTKN] Failed to refresh orders:', error);
      setState(prev => ({ ...prev, error: 'Failed to refresh orders' }));
    }
  }, [contracts, walletAddress]);

  // Cancel order (defined after refreshOrders to avoid use-before-define)
  const cancelOrder = useCallback(async (orderId: string): Promise<boolean> => {
    if (!contracts || !walletAddress) {
      setState(prev => ({ ...prev, error: 'Wallet not connected' }));
      return false;
    }

    try {
      // Ensure we have a signer for write
      let signer: ethers.Signer | null = null;
      if (contracts.obOrderPlacement.runner && 'getSigner' in (contracts.obOrderPlacement.runner as any)) {
        try {
          signer = await (contracts.obOrderPlacement.runner as any).getSigner?.();
        } catch {}
      }
      if (!signer && typeof window !== 'undefined' && (window as any).ethereum) {
        try {
          signer = await ensureHyperliquidWallet();
        } catch {}
      }
      if (!signer) {
        setState(prev => ({ ...prev, error: 'No signer available to cancel order' }));
        return false;
      }

      const contractWithSigner = contracts.obOrderPlacement.connect(signer);
      const idBig = (() => { try { return BigInt(orderId); } catch { return BigInt(String(orderId)); } })();

      // Cancel using default provider estimation
      const tx = await contractWithSigner.cancelOrder(idBig, {});
      await tx.wait();
      
      await refreshOrders();
      return true;
    } catch (error: any) {
      console.error('[ALTKN] Failed to cancel order:', error);
      setState(prev => ({ ...prev, error: error?.message || 'Failed to cancel order' }));
      return false;
    }
  }, [contracts, walletAddress, refreshOrders]);

  // Get order book depth
  const getOrderBookDepth = useCallback(async (depth: number = 10) => {
    if (!contracts) {
      throw new Error('Contracts not initialized');
    }

    // Helper to normalize level objects/tuples to { price, size }
    const normalizeLevels = (levels: any[]): { price: number; size: number }[] => {
      return (levels || []).map((lvl: any) => {
        const getField = (o: any, key: string, index: number) => (o && (o[key] !== undefined ? o[key] : o[index]));
        const rawPrice = getField(lvl, 'price', 0) ?? 0n;
        const rawSize = getField(lvl, 'size', 1) ?? 0n;
        return {
          price: Number(formatUnits(rawPrice, 6)),
          size: Number(formatUnits(rawSize, 18))
        };
      });
    };

    // Primary depth call (some providers return an array, others an object)
    let result: any;
    try {
      result = await contracts.obPricing.getOrderBookDepth(depth);
    } catch (e) {
      result = null;
    }

    let bidsRaw: any[] = [];
    let asksRaw: any[] = [];
    if (result) {
      bidsRaw = Array.isArray(result) ? (result[0] || []) : (result.bids || []);
      asksRaw = Array.isArray(result) ? (result[1] || []) : (result.asks || []);
    }

    // Fallback: if empty depth but best pointers indicate liquidity, use pointer-based depth
    if ((!bidsRaw || bidsRaw.length === 0) || (!asksRaw || asksRaw.length === 0)) {
      try {
        let bestBidPtr = false;
        let bestAskPtr = false;
        try {
          const bb = await contracts.obPricing.getBestBid();
          bestBidPtr = (typeof bb === 'bigint' ? bb : BigInt(0)) > 0n;
        } catch {}
        try {
          const ba = await contracts.obPricing.getBestAsk();
          bestAskPtr = (typeof ba === 'bigint' ? ba : BigInt(0)) > 0n;
        } catch {}
        if (bestBidPtr || bestAskPtr) {
          const alt = await (contracts.obPricing as any).getOrderBookDepthFromPointers?.(depth);
          if (alt) {
            bidsRaw = Array.isArray(alt) ? (alt[0] || []) : (alt.bids || []);
            asksRaw = Array.isArray(alt) ? (alt[1] || []) : (alt.asks || []);
          }
        }
      } catch {}
    }

    const bids = normalizeLevels(bidsRaw);
    const asks = normalizeLevels(asksRaw);

    return { bids, asks };
  }, [contracts]);

  const getBestPrices = useCallback(async () => {
    if (!contracts) {
      throw new Error('Contracts not initialized');
    }
    try {
      let bid: bigint = 0n;
      let ask: bigint = 0n;
      try { bid = await contracts.obPricing.getBestBid(); } catch {}
      try { ask = await contracts.obPricing.getBestAsk(); } catch {}
      return {
        bestBid: Number(formatUnits(bid, 6)),
        bestAsk: Number(formatUnits(ask, 6))
      };
    } catch {
      return { bestBid: 0, bestAsk: 0 };
    }
  }, [contracts]);

  // Close position using market order
  const closePosition = useCallback(async (
    positionId: string,
    closeSize: number,
    maxSlippageBps: number = 100 // 1% default slippage
  ): Promise<boolean> => {
    if (!contracts || !walletAddress) {
      setState(prev => ({ ...prev, error: 'Wallet not connected' }));
      return false;
    }

    try {
      const sizeWei = parseEther(closeSize.toString());
      // Get position details to determine if it's long or short
      const position = positionsState.positions.find(p => p.id === positionId);
      if (!position) {
        throw new Error('Position not found');
      }
      
      // For long positions, we need to sell. For short positions, we need to buy
      const isBuy = position.side === 'SHORT';
      
      // Preflight: surface revert reasons
      try {
        await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage.staticCall(
          sizeWei,
          isBuy,
          maxSlippageBps
        );
      } catch (preflightErr: any) {
        const msg = preflightErr?.shortMessage || preflightErr?.message || String(preflightErr);
        console.error('[ALTKN] ❌ [RPC] Close position preflight failed:', preflightErr);
        setState(prev => ({ ...prev, error: msg || 'Close position preflight failed' }));
        return false;
      }

      // Use slippage-protected market order to close with default provider estimation
      const closeOverrides: any = {};

      // Pre-send native balance check
      try {
        const provider: any = (contracts.obOrderPlacement as any)?.runner?.provider || (contracts.obOrderPlacement as any)?.provider;
        if (provider && walletAddress) {
          const feeData = await provider.getFeeData();
          const gasPrice: bigint = (feeData?.maxFeePerGas ?? feeData?.gasPrice ?? 0n) as bigint;
          const estGas: bigint = (closeOverrides?.gasLimit as bigint) || 0n;
          if (gasPrice > 0n && estGas > 0n) {
            const needed = gasPrice * estGas;
            const balance = await provider.getBalance(walletAddress);
            if (balance < needed) {
              setState(prev => ({ ...prev, error: `Insufficient native balance for gas. Need ~${ethers.formatEther(needed)} ETH, have ${ethers.formatEther(balance)}.` }));
              return false;
            }
          }
        }
      } catch {}

      let tx;
      try {
        tx = await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage(
          sizeWei,
          isBuy,
          maxSlippageBps,
          closeOverrides
        );
      } catch (sendErr: any) {
        const msg = sendErr?.message || '';
        const isInternal = msg.includes('-32603') || msg.includes('Internal JSON-RPC error') || (sendErr?.code === 'UNKNOWN_ERROR');
        if (isInternal) {
          console.warn('[ALTKN] ⚠️ [RPC] Close send failed (-32603). Retrying with no gas override...');
          tx = await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage(
            sizeWei,
            isBuy,
            maxSlippageBps
          );
        } else {
          throw sendErr;
        }
      }
      
      await tx.wait();
      
      // Refresh orders after successful closure
      await refreshOrders();
      return true;
    } catch (error: any) {
      console.error('[ALTKN] Failed to close position:', error);
      setState(prev => ({ ...prev, error: 'Failed to close position' }));
      return false;
    }
  }, [contracts, walletAddress, positionsState.positions]);

  // Get user's trade history
  const getUserTradeHistory = useCallback(async (
    offset: number = 0,
    limit: number = 10
  ): Promise<{
    trades: TradeHistoryItem[];
    hasMore: boolean;
  }> => {
    if (!contracts || !walletAddress) {
      // Gracefully degrade: return cached results if available, else empty
      if (lastTradeHistoryRef.current) {
        return lastTradeHistoryRef.current;
      }
      return { trades: [], hasMore: false };
    }

    try {
      // Helper: map trade tuple to TradeHistoryItem
      const mapTrade = (t: any): TradeHistoryItem => {
        const getField = (o: any, key: string, index: number) => (o && (o[key] !== undefined ? o[key] : o[index]));
        const tradeId = getField(t, 'tradeId', 0);
        const buyer = getField(t, 'buyer', 1);
        const seller = getField(t, 'seller', 2);
        const price = getField(t, 'price', 3);
        const amount = getField(t, 'amount', 4);
        const timestamp = getField(t, 'timestamp', 5);
        const buyerIsMargin = getField(t, 'buyerIsMargin', 8);
        const sellerIsMargin = getField(t, 'sellerIsMargin', 9);
        const tradeValue = getField(t, 'tradeValue', 10);
        const buyerFee = getField(t, 'buyerFee', 11);
        const sellerFee = getField(t, 'sellerFee', 12);
        return {
          tradeId: tradeId?.toString?.() ?? String(tradeId ?? ''),
          buyer,
          seller,
          price: Number(formatUnits(price ?? 0, 6)),
          amount: Number(formatUnits(amount ?? 0, 18)),
          tradeValue: Number(formatUnits(tradeValue ?? 0, 6)),
          buyerFee: Number(formatUnits(buyerFee ?? 0, 6)),
          sellerFee: Number(formatUnits(sellerFee ?? 0, 6)),
          buyerIsMargin: Boolean(buyerIsMargin),
          sellerIsMargin: Boolean(sellerIsMargin),
          timestamp: Number(timestamp ?? 0) * 1000
        } as TradeHistoryItem;
      };

      // Step 1: try facet-based count and paginated trades
      let userTradeCount: bigint = 0n;
      let trades: any[] | null = null;
      let hasMore: boolean = false;
      let addressForReads: string | undefined;
      try {
        addressForReads = (contracts.orderBookAddress || (await (contracts.obView as any)?.getAddress?.())) as string | undefined;
      } catch {}

      try {
        if (contracts.obTradeExecution) {
          userTradeCount = await contracts.obTradeExecution.getUserTradeCount(walletAddress);
          const pageSize = Math.min(limit, Number(userTradeCount));
          const res = await contracts.obTradeExecution.getUserTrades(walletAddress, offset, pageSize);
          trades = res?.[0] ?? res?.tradeData ?? res ?? [];
          hasMore = Boolean(res?.[1] ?? false);
        }
      } catch (e: any) {
        console.warn('[ALTKN][useOrderBook] Facet trade history unavailable, falling back to read-only recent trades', e);
      }

      // Step 2: fallback via viem recent trades if facet path failed or empty
      if (!trades || !Array.isArray(trades)) {
        try {
          const client = createClientWithRPC(CHAIN_CONFIG.rpcUrl);
          // Minimal ABI for recent trades on exec facet
          const TRADE_ABI = [
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
          ] as const as any[];
          const address = addressForReads as Address;
          let recent: any[] | null = null;
          try {
            recent = await client.readContract({ address, abi: TRADE_ABI, functionName: 'getLastTwentyTrades', args: [] }) as any[];
          } catch {
            const count = BigInt(Math.max(limit, 10));
            recent = await client.readContract({ address, abi: TRADE_ABI, functionName: 'getRecentTrades', args: [count] }) as any[];
          }
          // Filter to user-specific trades
          const addrLc = walletAddress.toLowerCase();
          const userTrades = (recent || []).filter((t: any) => {
            const buyer = (t?.buyer || t?.[1] || '').toLowerCase?.() || '';
            const seller = (t?.seller || t?.[2] || '').toLowerCase?.() || '';
            return buyer === addrLc || seller === addrLc;
          });
          trades = userTrades.slice(offset, offset + limit);
          hasMore = userTrades.length > offset + limit;
          userTradeCount = BigInt(userTrades.length);
        } catch (fallbackErr) {
          console.warn('[ALTKN][useOrderBook] Recent trades fallback failed', fallbackErr);
          trades = [];
          hasMore = false;
          userTradeCount = 0n;
        }
      }

      const mappedTrades: TradeHistoryItem[] = (trades || []).map(mapTrade);

      // Calculate statistics
      let totalVolume = 0;
      let totalFees = 0;
      let buyCount = 0;
      let sellCount = 0;
      const addrLc = walletAddress.toLowerCase();
      mappedTrades.forEach(trade => {
        totalVolume += trade.tradeValue;
        const userFee = trade.buyer.toLowerCase() === addrLc ? trade.buyerFee : trade.sellerFee;
        totalFees += userFee;
        if (trade.buyer.toLowerCase() === addrLc) buyCount++; else sellCount++;
      });

      // Update state with trade history and stats
      setState(prev => ({
        ...prev,
        tradeHistory: mappedTrades,
        tradeCount: Number(userTradeCount),
        totalVolume,
        totalFees,
        buyCount,
        sellCount
      }));

      // Cache and return
      lastTradeHistoryRef.current = { trades: mappedTrades, hasMore };
      return { trades: mappedTrades, hasMore };
    } catch (error: any) {
      console.error('[ALTKN] Failed to fetch trade history:', error);
      // Graceful degrade: return cached or empty instead of throwing
      if (lastTradeHistoryRef.current) return lastTradeHistoryRef.current;
      return { trades: [], hasMore: false };
    }
  }, [contracts, walletAddress]);

  // Lightweight trade count fetcher for tab badge
  const getUserTradeCountOnly = useCallback(async (): Promise<number> => {
    if (!contracts || !walletAddress) return 0;
    try {
      if (!contracts.obTradeExecution) return state.tradeCount || 0;
      const count: bigint = await contracts.obTradeExecution.getUserTradeCount(walletAddress);
      const num = Number(count);
      if (!Number.isFinite(num)) return state.tradeCount || 0;
      // Update state only if changed to avoid re-renders
      setState(prev => (prev.tradeCount === num ? prev : { ...prev, tradeCount: num }));
      return num;
    } catch (e) {
      return state.tradeCount || 0;
    }
  }, [contracts, walletAddress, state.tradeCount]);

  // Refresh trade history
  const refreshTradeHistory = useCallback(async () => {
    if (!contracts || !walletAddress) return;

    try {
      await getUserTradeHistory(0, 10); // Refresh first page by default
    } catch (error: any) {
      console.error('[ALTKN] Failed to refresh trade history:', error);
      setState(prev => ({ ...prev, error: 'Failed to refresh trade history' }));
    }
  }, [contracts, walletAddress, getUserTradeHistory]);

  const actions: OrderBookActions = {
    placeMarketOrder,
    placeLimitOrder,
    cancelOrder,
    closePosition,
    refreshOrders,
    getOrderBookDepth,
    getBestPrices,
    getUserTradeHistory,
    getUserTradeCountOnly,
    refreshTradeHistory
  };

  return [state, actions];
}

// Utility function (not a hook) to fetch active orders across all markets for a user
// Returns an array of market buckets with symbol, token name, and the list of active orders
const logGoddOrders = (step: number, message: string, data?: any) => {
  console.log(`[GODD][STEP${step}] ${message}`, data ?? '');
};

export async function getUserActiveOrdersAllMarkets(trader: string): Promise<Array<{ symbol: string; token: string; orders: any[] }>> {
  if (!trader) return [];
  logGoddOrders(12, 'Starting all-market orders fetch', { trader });
  // Lightweight cache to prevent repeated RPCs and flapping results
  const now = Date.now();
  const TTL_MS = 30000; // 30s
  const DEBUG_PORTFOLIO_LOGS = process.env.NEXT_PUBLIC_DEBUG_PORTFOLIO === 'true' || process.env.NODE_ENV !== 'production';
  const dlog = (...args: any[]) => { if (DEBUG_PORTFOLIO_LOGS) console.log('[ALTKN][Portfolio][OrdersAllMkts]', ...args); };
  const dwarn = (...args: any[]) => { if (DEBUG_PORTFOLIO_LOGS) console.warn('[ALTKN][Portfolio][OrdersAllMkts]', ...args); };
  dlog('Start fetching active orders across markets', { trader: String(trader), chainId: CHAIN_CONFIG.chainId });
  const key = `${String(trader).toLowerCase()}::${String(CHAIN_CONFIG.chainId)}`;
  logGoddOrders(13, 'Checking global cache for trader+chain combination', { key });
  // @ts-ignore
  const g: any = globalThis as any;
  if (!g.__ordersAllMktsCache) g.__ordersAllMktsCache = new Map<string, { ts: number; data: any[] }>();
  if (!g.__ordersAllMktsPopulateOnce) g.__ordersAllMktsPopulateOnce = { populated: false, inFlight: null as null | Promise<any> };
  const cached = g.__ordersAllMktsCache.get(key);
  if (cached && now - cached.ts < TTL_MS) {
    dlog('Cache hit', { ageMs: now - cached.ts, bucketCount: cached.data.length, markets: (cached.data || []).map((b: any) => b.symbol) });
    logGoddOrders(14, 'Cache hit for all-market orders', { bucketCount: cached.data.length });
    return cached.data;
  }
  try {
    logGoddOrders(15, 'Ensuring market info populated before RPC sweep');
    // Populate market info at most once if empty
    const initial = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {}) as any[];
    if (!initial.length && !g.__ordersAllMktsPopulateOnce.populated) {
      g.__ordersAllMktsPopulateOnce.inFlight = g.__ordersAllMktsPopulateOnce.inFlight || populateMarketInfoClient();
      try { await g.__ordersAllMktsPopulateOnce.inFlight; } catch {}
      g.__ordersAllMktsPopulateOnce.populated = true;
    }
    const entries: any[] = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {});
    if (!entries.length) {
      dwarn('No market entries available; returning cached or empty');
      return cached?.data || [];
    }
    logGoddOrders(16, 'Resolved market entries for sweep', { marketCount: entries.length });
    dlog('Market entries resolved', { markets: entries.length });
    // Fast path: bounded concurrency sweep with per-market timeouts (prevents one slow market blocking all).
    const chainId = CHAIN_CONFIG.chainId;
    const markets = (entries || [])
      .filter((m: any) => {
        // Filter to current chain when present
        if (m?.chainId && String(m.chainId) !== String(chainId)) return false;
        return true;
      })
      .map((m: any) => {
        const metric = String(m?.marketIdentifier || m?.symbol || '').trim();
        const symbol = String(m?.symbol || '').toUpperCase();
        const token = m?.name || symbol || metric;
        return { m, metric, symbol, token };
      })
      .filter((x) => Boolean(x.metric));

    const withTimeout = async <T,>(p: Promise<T>, ms: number): Promise<T> => {
      let t: any;
      const timeout = new Promise<never>((_, rej) => {
        t = setTimeout(() => rej(new Error(`timeout:${ms}ms`)), ms);
      });
      try {
        return await Promise.race([p, timeout]) as T;
      } finally {
        try { clearTimeout(t); } catch {}
      }
    };

    const CONCURRENCY = 8;
    const PER_MARKET_TIMEOUT_MS = 7000;
    const buckets: Array<{ symbol: string; token: string; orders: any[] }> = [];

    let idx = 0;
    const worker = async () => {
      while (idx < markets.length) {
        const myIdx = idx++;
        const item = markets[myIdx];
        if (!item) continue;
        try {
          dlog('Fetching active orders for market', { metric: item.metric, symbol: item.symbol });
          logGoddOrders(17, 'Fetching orders for market', { metric: item.metric, symbol: item.symbol });
          const orders = await withTimeout(
            orderService.getUserActiveOrders(trader as any, item.metric),
            PER_MARKET_TIMEOUT_MS
          );
          if (Array.isArray(orders) && orders.length > 0) {
            dlog('Active orders fetched', { metric: item.metric, count: orders.length });
            logGoddOrders(18, 'Orders found for market', { symbol: item.symbol, count: orders.length });
            buckets.push({ symbol: item.symbol, token: item.token, orders });
          }
        } catch (e: any) {
          // Skip slow/failing markets; keep rest responsive
          dwarn('Market orders fetch skipped', { metric: item.metric, symbol: item.symbol, error: e?.message || String(e) });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, markets.length) }, () => worker()));
    // Stable ordering for UI (avoid flicker from async completion order)
    buckets.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
    try {
      const totalOrders = (buckets || []).reduce((sum, b) => sum + ((b?.orders || []).length), 0);
      dlog('Done fetching active orders across markets', { bucketCount: buckets.length, totalOrders });
    } catch {}
    logGoddOrders(19, 'All-market fetch complete; caching result', { bucketCount: buckets.length });
    g.__ordersAllMktsCache.set(key, { ts: Date.now(), data: buckets });
    return buckets;
  } catch (error: any) {
    dwarn('Error fetching active orders; returning cached or empty');
    logGoddOrders(20, 'Error during all-market fetch; returning fallback', { error: error?.message });
    return cached?.data || [];
  }
}

// Utility function (not a hook) to fetch active orders for a single market for a user.
// Used for event-driven updates to avoid sweeping every market.
export async function getUserActiveOrdersForMarket(
  trader: string,
  marketIdentifier: string
): Promise<{ symbol: string; token: string; orders: any[] } | null> {
  if (!trader || !marketIdentifier) return null;
  const metric = String(marketIdentifier).trim();
  if (!metric) return null;

  // Best-effort ensure market info exists (used for display name/symbol)
  try {
    const initial = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {}) as any[];
    if (!initial.length) {
      try { await populateMarketInfoClient(metric); } catch {}
    }
  } catch {}

  // Resolve market metadata
  const entries: any[] = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {});
  const lower = metric.toLowerCase();
  const m = entries.find((x: any) => {
    const candidates = [
      x?.marketIdentifier?.toLowerCase?.(),
      x?.symbol?.toLowerCase?.(),
      x?.name?.toLowerCase?.(),
    ].filter(Boolean);
    return candidates.includes(lower);
  });
  const symbol = String(m?.symbol || metric).toUpperCase();
  const token = m?.name || symbol;

  try {
    const orders = await orderService.getUserActiveOrders(trader as any, metric);
    return { symbol, token, orders: Array.isArray(orders) ? orders : [] };
  } catch (e: any) {
    return { symbol, token, orders: [] };
  }
}

// Cancel a single order on a given market identifier (symbol/metricId)
export async function cancelOrderForMarket(
  orderId: string | number | bigint,
  marketIdentifier: string
): Promise<boolean> {
  try {
    if (!orderId || !marketIdentifier) return false;

    const metric = String(marketIdentifier).trim();
    if (!metric) return false;

    // Resolve signer from injected wallet first
    let signer: ethers.Signer | null = null;
    try {
      signer = await ensureHyperliquidWallet();
    } catch {
      signer = null;
    }
    if (!signer) {
      console.warn('[ALTKN][cancelOrderForMarket] No signer available');
      return false;
    }

    // Best-effort ensure MARKET_INFO is populated for this metric
    try {
      const initial = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {}) as any[];
      if (!initial.length) {
        try {
          await populateMarketInfoClient(metric);
        } catch {
          // ignore populate failure here; we'll handle missing market below
        }
      }
    } catch {
      // ignore MARKET_INFO introspection issues; we'll handle below
    }

    // Resolve the specific market entry on the current chain
    const entries: any[] = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {});
    const lower = metric.toLowerCase();
    const chainId = CHAIN_CONFIG.chainId;
    const match = entries.find((m: any) => {
      if (m?.chainId && String(m.chainId) !== String(chainId)) return false;
      const candidates = [
        m?.marketIdentifier?.toLowerCase?.(),
        m?.symbol?.toLowerCase?.(),
        m?.name?.toLowerCase?.(),
      ].filter(Boolean);
      return candidates.includes(lower);
    });

    if (!match || !match.orderBook) {
      console.warn('[ALTKN][cancelOrderForMarket] No OrderBook address for market', {
        metric,
        chainId,
      });
      return false;
    }

    const initOpts: any = {
      providerOrSigner: signer,
      orderBookAddressOverride: match.orderBook,
      marketIdentifier: match.marketIdentifier,
      marketSymbol: match.symbol,
      marketIdBytes32: match.marketId,
      chainId: match.chainId,
    };

    const contracts = await initializeContracts(initOpts);
    if (!contracts?.obOrderPlacement) {
      console.warn('[ALTKN][cancelOrderForMarket] obOrderPlacement facet missing');
      return false;
    }

    // Normalize order id to bigint
    let idBig: bigint = 0n;
    try {
      idBig = typeof orderId === 'bigint' ? orderId : BigInt(orderId as any);
    } catch {
      idBig = 0n;
    }
    if (idBig === 0n) {
      console.warn('[ALTKN][cancelOrderForMarket] Invalid order id', { orderId });
      return false;
    }

    const tx = await contracts.obOrderPlacement.cancelOrder(idBig);
    await tx.wait();
    return true;
  } catch (e) {
    console.error('[ALTKN][cancelOrderForMarket] failed', e);
    return false;
  }
}
