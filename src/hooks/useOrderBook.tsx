import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from './useWallet';
import { usePositions } from './usePositions';
import { initializeContracts } from '@/lib/contracts';
import { CONTRACT_ADDRESSES, CHAIN_CONFIG } from '@/lib/contractConfig';
import { orderService } from '@/lib/orderService';
import { formatUnits, parseEther, parseUnits } from 'viem';
import { ethers } from 'ethers';
import type { Address } from 'viem';
import { createPublicClient, http } from 'viem';
import { createClientWithRPC } from '@/lib/viemClient';
import { usePusher } from '@/lib/pusher-client';
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

export function useOrderBook(marketId?: string): [OrderBookState, OrderBookActions] {
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

  // Initialize contracts when wallet is connected
  useEffect(() => {
    const init = async () => {
      try {
        // Resolve orderbook by marketId hint
        let orderBookAddressOverride: string | undefined;
        if (marketId && /btc/i.test(marketId)) {
          // Use market info from CONTRACT_ADDRESSES if available
          const btcMarketInfo = (CONTRACT_ADDRESSES.MARKET_INFO as any)?.BTC;
          orderBookAddressOverride = btcMarketInfo?.orderBook || CONTRACT_ADDRESSES.orderBook;
        } else {
          // Default to aluminum orderbook or general orderbook
          orderBookAddressOverride = CONTRACT_ADDRESSES.aluminumOrderBook || CONTRACT_ADDRESSES.orderBook;
        }
        // Choose runner: prefer signer; else derive signer from BrowserProvider; else fail
        let runner: ethers.Signer | ethers.AbstractProvider | undefined = undefined;
        if (walletSigner) {
          runner = walletSigner as ethers.Signer;
        } else if (typeof window !== 'undefined' && (window as any).ethereum) {
          try {
            const browserProvider = new ethers.BrowserProvider((window as any).ethereum);
            const injectedSigner = await browserProvider.getSigner();
            // Validate connected network matches configured chain; otherwise fall back to read-only provider
            try {
              const net = await browserProvider.getNetwork();
              const required = BigInt(CHAIN_CONFIG.chainId);
              if (!net || net.chainId !== required) {
                console.warn('[useOrderBook] Wrong network detected', { connected: net?.chainId?.toString?.(), required: required.toString() });
                setState(prev => ({ ...prev, error: `Wrong network. Using read-only data for chainId ${CHAIN_CONFIG.chainId}.` }));
                runner = new ethers.JsonRpcProvider(CHAIN_CONFIG.rpcUrl);
              } else {
                runner = injectedSigner;
              }
            } catch {
              // If we cannot determine network, prefer signer but errors may occur later
              runner = injectedSigner;
            }
          } catch (e) {
            // As a last resort, use provider for reads only (writes will fail)
            runner = new ethers.BrowserProvider((window as any).ethereum);
          }
        }
        if (!runner) {
          try {
            if (CHAIN_CONFIG?.rpcUrl) {
              runner = new ethers.JsonRpcProvider(CHAIN_CONFIG.rpcUrl);
            }
          } catch {}
          if (!runner) {
            setState(prev => ({ ...prev, error: 'Wallet/provider not available', isLoading: false }));
            return;
          }
        }
        const contractInstances = await initializeContracts({ 
          providerOrSigner: runner, 
          orderBookAddressOverride 
        });
        console.log('[useOrderBook] Initialized contracts for marketId', marketId);
        
        // Ensure we have the trade execution facet
        if (!contractInstances.obTradeExecution) {
          console.warn('[useOrderBook] Trade execution facet not initialized');
        }
        
        setContracts(contractInstances);

        // Attempt dynamic OB resolution via CoreVault mapping if marketId known
        try {
          // Try to find bytes32 marketId from config by matching symbol/name
          const marketEntries = CONTRACT_ADDRESSES.MARKET_INFO ? Object.values(CONTRACT_ADDRESSES.MARKET_INFO as any) : [];
          const matched = marketEntries.find((m: any) => {
            const sym = (m?.symbol || '').toLowerCase();
            const name = (m?.name || '').toLowerCase();
            const key = (marketId || '').toLowerCase();
            return sym === key || name === key || sym.includes(key) || key.includes(sym);
          }) as any;
          const marketBytes32 = matched?.marketId as string | undefined;
          if (marketBytes32 && contractInstances.vault?.marketToOrderBook) {
            const resolved = await contractInstances.vault.marketToOrderBook(marketBytes32);
            if (resolved && typeof resolved === 'string') {
              console.log('[useOrderBook] Re-initializing with resolved OB', resolved);
              const reinit = await initializeContracts({ 
                providerOrSigner: runner, 
                orderBookAddressOverride: resolved 
              });
              setContracts(reinit);
            }
          }
        } catch (e) {
          console.warn('[useOrderBook] Dynamic OB resolution failed', e);
        }
      } catch (error: any) {
        console.error('Failed to initialize contracts:', error);
        setState(prev => ({ ...prev, error: 'Failed to initialize contracts', isLoading: false }));
      }
    };

    init();
  }, [walletIsConnected, walletSigner]);

  // Fetch initial market data and set up polling
  useEffect(() => {
    if (!contracts) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    const fetchMarketData = async () => {
      try {
        // Fetch orders first (only when walletAddress is available)
        let hydrated: OrderBookOrder[] = [];
        if (walletAddress) {
          try {
            // Ensure the OrderBook contract code exists on current network before calling
            try {
              const provider: any = (contracts.obView as any)?.runner?.provider || (contracts.obView as any)?.provider;
              const obAddr = (contracts.orderBookAddress || (await (contracts.obView as any)?.getAddress?.())) as string | undefined;
              const code = provider && obAddr ? await provider.getCode(obAddr) : '0x';
              if (!code || code === '0x') {
                console.warn('[useOrderBook] OrderBook contract code not found on current network. Skipping on-chain order fetch.');
                setState(prev => ({ ...prev, error: 'OrderBook not deployed on current network', isLoading: false }));
                return;
              }
            } catch (codeErr) {
              // Proceed; any decode errors will be caught below
            }
            const orderIds: bigint[] = await contracts.obView.getUserOrders(walletAddress);
            console.log('[useOrderBook] getUserOrders count =', orderIds.length);
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
                console.warn('[useOrderBook] Failed to hydrate order', id, e);
              }
            }
            // Fallback via orderService if contract returned empty but we expect orders
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
                  console.log('[useOrderBook] Fallback orderService returned', mapped.length, 'orders');
                  hydrated = mapped;
                }
              } catch (svcErr) {
                console.warn('[useOrderBook] orderService fallback failed', svcErr);
              }
            }
            // Enhanced fallback to query multiple known OrderBook contracts if still empty
            if (hydrated.length === 0) {
              // Get all available market addresses from CONTRACT_ADDRESSES.MARKET_INFO
              const marketInfo = CONTRACT_ADDRESSES.MARKET_INFO as Record<string, any>;
              const knownOrderBooks = Object.values(marketInfo)
                .filter(market => market && typeof market === 'object' && market.orderBook)
                .map(market => market.orderBook as string);
              
              // Add default orderBook if not already included
              if (CONTRACT_ADDRESSES.orderBook && 
                  !knownOrderBooks.includes(CONTRACT_ADDRESSES.orderBook)) {
                knownOrderBooks.push(CONTRACT_ADDRESSES.orderBook);
              }
              
              for (const obAddress of knownOrderBooks) {
                try {
                  const provider = walletSigner || 
                    (typeof window !== 'undefined' && (window as any).ethereum ? 
                      new ethers.BrowserProvider((window as any).ethereum) : 
                      new ethers.JsonRpcProvider(CHAIN_CONFIG.rpcUrl));
                      
                  const tempContracts = await initializeContracts({
                    providerOrSigner: provider,
                    orderBookAddressOverride: obAddress
                  });
                  const tempOrderIds = await tempContracts.obView.getUserOrders(walletAddress);
                  if (tempOrderIds.length > 0) {
                    console.log(`[useOrderBook] Fallback to OB ${obAddress} found ${tempOrderIds.length} orders`);
                    for (const id of tempOrderIds) {
                      try {
                        const order = await tempContracts.obView.getOrder(id);
                        const filled = await tempContracts.obView.getFilledAmount(id);
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
                        console.warn(`[useOrderBook] Failed to hydrate order from fallback OB ${obAddress}`, id, e);
                      }
                    }
                  }
                } catch (e) {
                  console.warn(`[useOrderBook] Fallback query to OB ${obAddress} failed`, e);
                }
                if (hydrated.length > 0) break; // Stop if we found orders
              }
            }
          } catch (e: any) {
            const msg = e?.message || '';
            const code = e?.code || '';
            const isMissingSelector = msg.includes('missing revert data') || code === 'CALL_EXCEPTION';
            if (isMissingSelector) {
              console.warn('[useOrderBook] getUserOrders not available on this OrderBook (facet missing). Falling back.', e);
              // Proceed to fallbacks below without setting a hard error
            } else {
              console.error('[useOrderBook] Failed to fetch user order IDs', e);
              setState(prev => ({ ...prev, error: 'Failed to fetch orders from blockchain. Please try again.' }));
            }
          }
        }

        // Market data (best prices, mark/index/funding) - resilient defaults
        let bestBidNum = 0;
        let bestAskNum = 0;
        let markPriceNum = 0;
        let indexPriceNum = 0;
        let fundingRateNum = 0;
        try {
          const [bestBid, bestAsk] = await contracts.obView.getBestPrices();
          bestBidNum = Number(formatUnits(bestBid, 6));
          bestAskNum = Number(formatUnits(bestAsk, 6));
        } catch (e) {
          console.warn('[useOrderBook] best prices unavailable');
        }
        try {
          const mp = await contracts.obPricing.getMarketPriceData();
          // Some providers return an array instead of object; handle both
          const mpMark = (mp?.markPrice ?? (Array.isArray(mp) ? mp[0] : 0n)) as bigint;
          const mpIndex = (mp?.indexPrice ?? (Array.isArray(mp) ? mp[1] : 0n)) as bigint;
          const mpFunding = (mp?.fundingRate ?? (Array.isArray(mp) ? mp[2] : 0n)) as bigint;
          markPriceNum = Number(formatUnits(mpMark, 6));
          indexPriceNum = Number(formatUnits(mpIndex, 6));
          // funding could be signed; handle via Number() fallback
          try { fundingRateNum = Number(formatUnits(mpFunding, 6)); } catch { fundingRateNum = Number(mpFunding) / 1e6; }
        } catch (e) {
          console.warn('[useOrderBook] market price data unavailable');
        }

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
      } catch (error: any) {
        console.error('Failed to fetch market data:', error);
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

    // Initial fetch
    fetchMarketData();

    // Poll every 5 seconds for updates (increased from 2 seconds to reduce load)
    const interval = setInterval(fetchMarketData, 5000);

    return () => {
      clearInterval(interval);
      console.log('[useOrderBook] Cleaned up polling interval');
    };
  }, [contracts, walletAddress, marketId]);

  // Near real-time push via Pusher
  const pusher = usePusher();
  useEffect(() => {
    if (!pusher) return;
    if (!contracts) return;

    const handlers = {
      'order-update': () => fastRefreshRef.current?.(),
      'trading-event': () => fastRefreshRef.current?.(),
      'price-update': () => fastRefreshRef.current?.(),
      'batch-price-update': () => fastRefreshRef.current?.(),
    } as Record<string, (data: any) => void>;

    const channelKey = marketId || '';
    const unsubs: Array<() => void> = [];
    if (channelKey) {
      try { unsubs.push(pusher.subscribeToChannel(`market-${channelKey}`, handlers)); } catch {}
    }
    try { unsubs.push(pusher.subscribeToChannel('recent-transactions', { 'new-order': () => fastRefreshRef.current?.() })); } catch {}

    return () => {
      unsubs.forEach((u) => { try { u(); } catch {} });
    };
  }, [pusher, contracts, marketId]);

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
      // Settlement guard: prevent orders if market is settled
      try {
        const settled = await (contracts.obSettlement?.isSettled?.() as Promise<boolean>);
        if (settled) {
          setState(prev => ({ ...prev, error: 'Market has been settled. New orders are disabled.' }));
          return false;
        }
      } catch { /* ignore if facet not present */ }

      const sizeWei = parseEther(size.toString());
      // Use slippage-protected market order
      const tx = await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage(
        sizeWei,
        isBuy,
        maxSlippageBps
      );
      
      await tx.wait();
      
      // Refresh orders after successful placement
      await refreshOrders();
      return true;
    } catch (error: any) {
      console.error('Failed to place market order:', error);
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
      // Settlement guard
      try {
        const settled = await (contracts.obSettlement?.isSettled?.() as Promise<boolean>);
        if (settled) {
          setState(prev => ({ ...prev, error: 'Market has been settled. New orders are disabled.' }));
          return false;
        }
      } catch { /* ignore if facet not present */ }

      console.log('[DBG][placeLimitOrder] start', { marketId, walletAddress, price, size, isBuy });
      // Encode price with USDC decimals (6) and size with token decimals (18)
      const priceWei = parseUnits(price.toString(), 6);
      const sizeWei = parseEther(size.toString());
      
      const tx = await contracts.obOrderPlacement.placeMarginLimitOrder(
        priceWei,
        sizeWei,
        isBuy
      );
      console.log('[DBG][placeLimitOrder] tx sent', { hash: tx.hash });
      
      await tx.wait();
      console.log('[DBG][placeLimitOrder] tx confirmed, awaiting refresh');
      
      // Refresh orders after successful placement
      await refreshOrders();
      console.log('[DBG][placeLimitOrder] refresh complete');
      return true;
    } catch (error: any) {
      console.error('Failed to place limit order:', error);
      setState(prev => ({ ...prev, error: 'Failed to place limit order' }));
      return false;
    }
  }, [contracts, walletAddress]);

  // Refresh orders
  const refreshOrders = useCallback(async () => {
    if (!contracts || !walletAddress) return;

    try {
      // Guard against calling into non-existent code which yields BAD_DATA decode errors
      try {
        const provider: any = (contracts.obView as any)?.runner?.provider || (contracts.obView as any)?.provider;
        const obAddr = (contracts.orderBookAddress || (await (contracts.obView as any)?.getAddress?.())) as string | undefined;
        const code = provider && obAddr ? await provider.getCode(obAddr) : '0x';
        if (!code || code === '0x') {
          console.warn('[useOrderBook] OrderBook contract code not found on current network. Skipping refresh.');
          setState(prev => ({ ...prev, error: 'OrderBook not deployed on current network' }));
          return;
        }
      } catch {}
      const orderIds: bigint[] = await contracts.obView.getUserOrders(walletAddress);
      const hydrated: OrderBookOrder[] = [];
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
            setState(prev => ({ ...prev, activeOrders: mapped, error: null }));
            return;
          }
        } catch {}
      }

      setState(prev => ({
        ...prev,
        activeOrders: hydrated,
        error: null
      }));
    } catch (error: any) {
      console.error('Failed to refresh orders:', error);
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
          const bp = new ethers.BrowserProvider((window as any).ethereum);
          signer = await bp.getSigner();
        } catch {}
      }
      if (!signer) {
        setState(prev => ({ ...prev, error: 'No signer available to cancel order' }));
        return false;
      }

      const contractWithSigner = contracts.obOrderPlacement.connect(signer);
      const idBig = (() => { try { return BigInt(orderId); } catch { return BigInt(String(orderId)); } })();

      const tx = await contractWithSigner.cancelOrder(idBig);
      await tx.wait();
      
      await refreshOrders();
      return true;
    } catch (error: any) {
      console.error('Failed to cancel order:', error);
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
        const best = await contracts.obView.getBestPrices();
        const bestBidPtr = (typeof best?.[0] === 'bigint' ? best[0] : BigInt(0)) > 0n;
        const bestAskPtr = (typeof best?.[1] === 'bigint' ? best[1] : BigInt(0)) > 0n;
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
      const [bid, ask] = await contracts.obView.getBestPrices();
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
      
      // Use slippage-protected market order to close
      const tx = await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage(
        sizeWei,
        isBuy,
        maxSlippageBps
      );
      
      await tx.wait();
      
      // Refresh orders after successful closure
      await refreshOrders();
      return true;
    } catch (error: any) {
      console.error('Failed to close position:', error);
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
        console.warn('[useOrderBook] Facet trade history unavailable, falling back to read-only recent trades', e);
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
          console.warn('[useOrderBook] Recent trades fallback failed', fallbackErr);
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
      console.error('Failed to fetch trade history:', error);
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
      console.error('Failed to refresh trade history:', error);
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
