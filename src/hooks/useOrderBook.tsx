import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from './useWallet';
import { usePositions } from './usePositions';
import { initializeContracts } from '@/lib/contracts';
import { useMarket } from '@/hooks/useMarket';
import { CONTRACT_ADDRESSES, CHAIN_CONFIG } from '@/lib/contractConfig';
import { getReadProvider, ensureHyperliquidWallet } from '@/lib/network';
import { orderService } from '@/lib/orderService';
import { formatUnits, parseEther, parseUnits } from 'viem';
import { ethers } from 'ethers';
import { isHyperLiquid, getEthersFallbackOverrides, getBufferedGasLimit } from '@/lib/gas';
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

  // Initialize contracts when wallet is connected
  useEffect(() => {
    const init = async () => {
      try {
        // Strictly resolve OrderBook by marketId on current chain
        const currentChain = CHAIN_CONFIG.chainId;
        const entries = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {}) as any[];
        const match = entries.find((m: any) => {
          if (!m?.chainId || m.chainId !== currentChain) return false;
          const marketMatches = [
            m?.symbol?.toLowerCase?.(),
            m?.name?.toLowerCase?.(),
            m?.marketIdentifier?.toLowerCase?.()
          ].filter(Boolean);
          const searchKey = marketId?.toLowerCase?.() || '';
          return marketMatches.includes(searchKey);
        });
        
        if (!match) {
          console.warn(`[useOrderBook] No market found for ${marketId} on chain ${currentChain}`);
          setState(prev => ({ 
            ...prev, 
            error: `Market ${marketId} not available on current network (chain ${currentChain})`,
            isLoading: false 
          }));
          return;
        }
        
        // Prefer DB-sourced OrderBook address when available, fallback to static mapping
        const orderBookAddressOverride = (marketRow as any)?.market_address || match.orderBook;
        if (!orderBookAddressOverride) {
          console.warn(`[useOrderBook] No OrderBook address for ${marketId} on chain ${currentChain}`);
          setState(prev => ({ 
            ...prev, 
            error: `Market ${marketId} contract not deployed on current network`,
            isLoading: false 
          }));
          return;
        }
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
                console.warn('[useOrderBook] Wrong network detected', { connected: net?.chainId?.toString?.(), required: required.toString() });
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
        const contractInstances = await initializeContracts({ 
          providerOrSigner: runner, 
          orderBookAddressOverride 
        });
        console.log('[useOrderBook] Initialized contracts for marketId', marketId, 'address', orderBookAddressOverride);
        
        // Ensure we have the trade execution facet
        if (!contractInstances.obTradeExecution) {
          console.warn('[useOrderBook] Trade execution facet not initialized');
        }
        
        setContracts(contractInstances);

      // Use market's bytes32 ID for CoreVault mapping
      const marketBytes32 = (marketRow as any)?.market_identifier_bytes32 || (match.marketId as string | undefined);
      if (marketBytes32 && contractInstances.vault?.marketToOrderBook) {
        try {
          const resolved = await contractInstances.vault.marketToOrderBook(marketBytes32);
          if (resolved && resolved.toLowerCase() !== orderBookAddressOverride.toLowerCase()) {
            console.warn(`[useOrderBook] CoreVault mapping mismatch for ${marketId}:`,
              `\nExpected: ${orderBookAddressOverride}`,
              `\nResolved: ${resolved}`
            );
          }
        } catch (e) {
          console.warn('[useOrderBook] CoreVault mapping check failed:', e);
        }
      }
      } catch (error: any) {
        console.error('Failed to initialize contracts:', error);
        setState(prev => ({ ...prev, error: 'Failed to initialize contracts', isLoading: false }));
      }
    };

    init();
  }, [walletIsConnected, walletSigner, marketId, (marketRow as any)?.market_address]);

  // Fetch initial market data (no polling)
  useEffect(() => {
    if (!contracts) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    const fetchMarketData = async () => {
      try {
        console.log(`📡 [RPC] Starting OrderBook market data fetch for ${marketId}`);
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
            console.log(`📡 [RPC] Fetching user orders via getUserOrders for ${walletAddress}`);
            const startTimeOrders = Date.now();
            const orderIds: bigint[] = await contracts.obView.getUserOrders(walletAddress);
            const durationOrders = Date.now() - startTimeOrders;
            console.log(`✅ [RPC] User orders fetched in ${durationOrders}ms`, { orderCount: orderIds.length });
            console.log('[useOrderBook] getUserOrders count =', orderIds.length);
            for (const id of orderIds) {
              try {
                console.log(`📡 [RPC] Fetching order details for order ID ${id}`);
                const startTimeOrder = Date.now();
                const order = await contracts.obView.getOrder(id);
                const filled = await contracts.obView.getFilledAmount(id);
                const durationOrder = Date.now() - startTimeOrder;
                console.log(`✅ [RPC] Order ${id} details fetched in ${durationOrder}ms`);

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
                console.warn(`⚠️ [RPC] Failed to hydrate order ${id}:`, e);
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
            // No cross-market fallbacks - each market uses its own OrderBook only
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
          console.log(`📡 [RPC] Fetching best prices via pricing facet`);
          const startTimePrices = Date.now();
          let bestBid: bigint = 0n;
          let bestAsk: bigint = 0n;
          try { bestBid = await contracts.obPricing.getBestBid(); } catch {}
          try { bestAsk = await contracts.obPricing.getBestAsk(); } catch {}
          const durationPrices = Date.now() - startTimePrices;
          bestBidNum = Number(formatUnits(bestBid, 6));
          bestAskNum = Number(formatUnits(bestAsk, 6));
          console.log(`✅ [RPC] Best prices fetched in ${durationPrices}ms`, { bestBid: bestBidNum, bestAsk: bestAskNum });
        } catch (e) {
          console.warn(`⚠️ [RPC] Best prices unavailable:`, e);
        }
        try {
          console.log(`📡 [RPC] Fetching market price data via getMarketPriceData`);
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
          console.log(`✅ [RPC] Market price data fetched in ${durationMarket}ms`, {
            markPrice: markPriceNum,
            indexPrice: indexPriceNum,
            fundingRate: fundingRateNum
          });
        } catch (e) {
          console.warn(`⚠️ [RPC] Market price data unavailable:`, e);
        }

        console.log(`📊 [RPC] OrderBook market data fetch complete for ${marketId}`, {
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
      } catch (error: any) {
        console.error(`❌ [RPC] OrderBook market data fetch failed for ${marketId}:`, error);
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
      console.log(`🚀 [RPC] Placing market order for ${marketId}`, { size, isBuy, maxSlippageBps });
      // Settlement guard: prevent orders if market is settled
      try {
        console.log(`📡 [RPC] Checking settlement status via isSettled`);
        const startTimeSettlement = Date.now();
        const settled = await (contracts.obSettlement?.isSettled?.() as Promise<boolean>);
        const durationSettlement = Date.now() - startTimeSettlement;
        console.log(`✅ [RPC] Settlement check completed in ${durationSettlement}ms`, { settled });

        if (settled) {
          setState(prev => ({ ...prev, error: 'Market has been settled. New orders are disabled.' }));
          return false;
        }
      } catch (error) {
        console.warn(`⚠️ [RPC] Settlement check failed:`, error);
        // ignore if facet not present
      }

      const sizeWei = parseEther(size.toString());
      // Preflight static call to surface revert reasons early
      try {
        console.log(`📡 [RPC] Running preflight static call for market order`);
        const startTimePreflight = Date.now();
        await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage.staticCall(
          sizeWei,
          isBuy,
          maxSlippageBps
        );
        const durationPreflight = Date.now() - startTimePreflight;
        console.log(`✅ [RPC] Preflight check passed in ${durationPreflight}ms`);
      } catch (preflightErr: any) {
        const msg = preflightErr?.shortMessage || preflightErr?.message || String(preflightErr);
        console.error(`❌ [RPC] Preflight check failed:`, preflightErr);
        setState(prev => ({ ...prev, error: msg || 'Market order preflight failed' }));
        return false;
      }
      console.log(`📡 [RPC] Estimating gas for market order`);
      let startTimeGas = Date.now();
      // Use slippage-protected market order
      let mktOverrides: any = {};
      if (isHyperLiquid()) {
        try {
          const est = await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage.estimateGas(
            sizeWei,
            isBuy,
            maxSlippageBps
          );
          mktOverrides = { gasLimit: getBufferedGasLimit(est) };
          const durationGas = Date.now() - startTimeGas;
          console.log(`✅ [RPC] Gas estimation completed in ${durationGas}ms`, { gasLimit: mktOverrides.gasLimit?.toString() });
        } catch (error) {
          console.warn(`⚠️ [RPC] Gas estimation failed:`, error);
          // Avoid sending oversized manual gas; let provider estimate on send
          mktOverrides = {};
        }
      }
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
        console.warn('⚠️ [RPC] Gas funds check warning:', balErr?.message || balErr);
      }
      console.log(`📡 [RPC] Submitting market order transaction`);
      let startTimeTx = Date.now();
      let tx;
      try {
        tx = await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage(
          sizeWei,
          isBuy,
          maxSlippageBps,
          mktOverrides
        );
      } catch (sendErr: any) {
        const msg = sendErr?.message || '';
        const isInternal = msg.includes('-32603') || msg.includes('Internal JSON-RPC error') || (sendErr?.code === 'UNKNOWN_ERROR');
        if (isInternal) {
          console.warn('⚠️ [RPC] Send failed (-32603). Retrying with fallback gas override...');
          const fallback = getEthersFallbackOverrides();
          tx = await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage(
            sizeWei,
            isBuy,
            maxSlippageBps,
            fallback
          );
        } else {
          throw sendErr;
        }
      }
      const durationTx = Date.now() - startTimeTx;
      console.log(`✅ [RPC] Market order transaction submitted in ${durationTx}ms`, { txHash: tx.hash });
      console.log('[Order TX][market] submitted:', tx.hash);
      const receipt = await tx.wait();
      console.log('[Order TX][market] confirmed:', tx.hash);
      
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
      console.log(`📋 [RPC] Placing limit order for ${marketId}`, { price, size, isBuy });
      // Settlement guard
      try {
        console.log(`📡 [RPC] Checking settlement status for limit order`);
        const startTimeSettlement = Date.now();
        const settled = await (contracts.obSettlement?.isSettled?.() as Promise<boolean>);
        const durationSettlement = Date.now() - startTimeSettlement;
        console.log(`✅ [RPC] Settlement check completed in ${durationSettlement}ms`, { settled });

        if (settled) {
          setState(prev => ({ ...prev, error: 'Market has been settled. New orders are disabled.' }));
          return false;
        }
      } catch (error) {
        console.warn(`⚠️ [RPC] Settlement check failed for limit order:`, error);
        // ignore if facet not present
      }

      console.log('[DBG][placeLimitOrder] start', { marketId, walletAddress, price, size, isBuy });
      // Encode price with USDC decimals (6) and size with token decimals (18)
      const priceWei = parseUnits(price.toString(), 6);
      const sizeWei = parseEther(size.toString());

      // Determine available placement function via preflight
      let placeFn: 'placeMarginLimitOrder' | 'placeLimitOrder' = 'placeMarginLimitOrder';
      try {
        await contracts.obOrderPlacement.placeMarginLimitOrder.staticCall(
          priceWei,
          sizeWei,
          isBuy
        );
      } catch (preflightErr: any) {
        const msg = preflightErr?.shortMessage || preflightErr?.message || preflightErr?.data?.message || String(preflightErr);
        if (/function does not exist/i.test(msg) || /Diamond: Function does not exist/i.test(msg)) {
          placeFn = 'placeLimitOrder';
          try {
            await contracts.obOrderPlacement.placeLimitOrder.staticCall(
              priceWei,
              sizeWei,
              isBuy
            );
          } catch (fallbackErr) {
            console.error('❌ [RPC] Preflight (fallback) failed:', fallbackErr);
            setState(prev => ({ ...prev, error: msg || 'Limit order preflight failed' }));
            return false;
          }
        } else {
          console.error(`❌ [RPC] Preflight check failed:`, preflightErr);
          setState(prev => ({ ...prev, error: msg || 'Limit order preflight failed' }));
          return false;
        }
      }

      console.log(`📡 [RPC] Estimating gas for limit order`);
      let startTimeGas = Date.now();
      let limOverrides: any = {};
      if (isHyperLiquid()) {
        try {
          const est = placeFn === 'placeMarginLimitOrder'
            ? await contracts.obOrderPlacement.placeMarginLimitOrder.estimateGas(
                priceWei,
                sizeWei,
                isBuy
              )
            : await contracts.obOrderPlacement.placeLimitOrder.estimateGas(
                priceWei,
                sizeWei,
                isBuy
              );
          limOverrides = { gasLimit: getBufferedGasLimit(est) };
          const durationGas = Date.now() - startTimeGas;
          console.log(`✅ [RPC] Limit order gas estimation completed in ${durationGas}ms`, { gasLimit: limOverrides.gasLimit?.toString() });
        } catch (error) {
          console.warn(`⚠️ [RPC] Limit order gas estimation failed:`, error);
          limOverrides = getEthersFallbackOverrides();
        }
      }
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
        console.warn('⚠️ [RPC] Gas funds check warning:', balErr?.message || balErr);
      }

      console.log(`📡 [RPC] Submitting limit order transaction`);
      let startTimeTx = Date.now();
      let tx;
      try {
        tx = placeFn === 'placeMarginLimitOrder'
          ? await contracts.obOrderPlacement.placeMarginLimitOrder(
              priceWei,
              sizeWei,
              isBuy,
              limOverrides
            )
          : await contracts.obOrderPlacement.placeLimitOrder(
              priceWei,
              sizeWei,
              isBuy,
              limOverrides
            );
      } catch (sendErr: any) {
        const msg = sendErr?.message || '';
        const isInternal = msg.includes('-32603') || msg.includes('Internal JSON-RPC error') || (sendErr?.code === 'UNKNOWN_ERROR');
        if (isInternal) {
          console.warn('⚠️ [RPC] Send failed (-32603). Retrying with fallback gas override...');
          const fallback = getEthersFallbackOverrides();
          tx = placeFn === 'placeMarginLimitOrder'
            ? await contracts.obOrderPlacement.placeMarginLimitOrder(
                priceWei,
                sizeWei,
                isBuy,
                fallback
              )
            : await contracts.obOrderPlacement.placeLimitOrder(
                priceWei,
                sizeWei,
                isBuy,
                fallback
              );
        } else {
          throw sendErr;
        }
      }
      const durationTx = Date.now() - startTimeTx;
      console.log(`✅ [RPC] Limit order transaction submitted in ${durationTx}ms`, { txHash: tx.hash });
      console.log('[DBG][placeLimitOrder] tx sent', { hash: tx.hash });
      console.log('[Order TX][limit] submitted:', tx.hash);
      const receipt = await tx.wait();
      console.log('[DBG][placeLimitOrder] tx confirmed, awaiting refresh');
      console.log('[Order TX][limit] confirmed:', tx.hash);
      
      // Refresh orders after successful placement
      console.log('[Dispatch] 🔄 [UI][useOrderBook] Calling refreshOrders after placeLimitOrder');
      await refreshOrders();
      console.log('[Dispatch] ✅ [UI][useOrderBook] refreshOrders complete');
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
      console.log('[Dispatch] 🔄 [RPC] Refreshing orders for', marketId, `(wallet: ${walletAddress.slice(0, 6)}...)`);
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
      console.log('[Dispatch] 📡 [RPC] Fetching user orders for refresh');
      const startTimeRefresh = Date.now();
      const orderIds: bigint[] = await contracts.obView.getUserOrders(walletAddress);
      const durationRefresh = Date.now() - startTimeRefresh;
      console.log('[Dispatch] ✅ [RPC] Orders refresh fetched in', durationRefresh, 'ms', { orderCount: orderIds.length });
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
            console.log('[Dispatch] 🔁 [UI][useOrderBook] Updating activeOrders (fallback)', { count: mapped.length });
            setState(prev => ({ ...prev, activeOrders: mapped, error: null }));
            try {
              if (typeof window !== 'undefined') {
                const detail = { marketId, count: mapped.length, source: 'fallback', ts: Date.now() };
                console.log('[Dispatch] 📣 [EVT][useOrderBook] Dispatch ordersUpdated', detail);
                window.dispatchEvent(new CustomEvent('ordersUpdated', { detail }));
              }
            } catch {}
            return;
          }
        } catch {}
      }

      console.log('[Dispatch] 🔁 [UI][useOrderBook] Updating activeOrders', { count: hydrated.length });
      setState(prev => ({
        ...prev,
        activeOrders: hydrated,
        error: null
      }));
      try {
        if (typeof window !== 'undefined') {
          const detail = { marketId, count: hydrated.length, source: 'onchain', ts: Date.now() };
          console.log('[Dispatch] 📣 [EVT][useOrderBook] Dispatch ordersUpdated', detail);
          window.dispatchEvent(new CustomEvent('ordersUpdated', { detail }));
        }
      } catch {}
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
          signer = await ensureHyperliquidWallet();
        } catch {}
      }
      if (!signer) {
        setState(prev => ({ ...prev, error: 'No signer available to cancel order' }));
        return false;
      }

      const contractWithSigner = contracts.obOrderPlacement.connect(signer);
      const idBig = (() => { try { return BigInt(orderId); } catch { return BigInt(String(orderId)); } })();

      let cancelOverrides: any = {};
      if (isHyperLiquid()) {
        try {
          const est = await contractWithSigner.cancelOrder.estimateGas(idBig);
          cancelOverrides = { gasLimit: getBufferedGasLimit(est, 30) };
        } catch (_) { cancelOverrides = getEthersFallbackOverrides(); }
      }
      const tx = await contractWithSigner.cancelOrder(idBig, cancelOverrides);
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
        console.error('❌ [RPC] Close position preflight failed:', preflightErr);
        setState(prev => ({ ...prev, error: msg || 'Close position preflight failed' }));
        return false;
      }

      // Use slippage-protected market order to close with buffered gas
      let closeOverrides: any = {};
      if (isHyperLiquid()) {
        try {
          const est = await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage.estimateGas(
            sizeWei,
            isBuy,
            maxSlippageBps
          );
          closeOverrides = { gasLimit: getBufferedGasLimit(est) };
        } catch (_) { closeOverrides = {}; }
      }

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
          console.warn('⚠️ [RPC] Close send failed (-32603). Retrying with no gas override...');
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
