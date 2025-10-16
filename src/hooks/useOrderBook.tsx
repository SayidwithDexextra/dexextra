import { useState, useEffect, useCallback } from 'react';
import { useWallet } from './useWallet';
import { initializeContracts } from '@/lib/contracts';
import { CONTRACT_ADDRESSES, CHAIN_CONFIG } from '@/lib/contractConfig';
import { orderService } from '@/lib/orderService';
import { formatUnits, parseEther, parseUnits } from 'viem';
import { ethers } from 'ethers';
import type { Address } from 'viem';
import { createPublicClient, http } from 'viem';
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

export interface OrderBookState {
  bestBid: number;
  bestAsk: number;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  activeOrders: OrderBookOrder[];
  isLoading: boolean;
  error: string | null;
}

export interface OrderBookActions {
  placeMarketOrder: (size: number, isBuy: boolean, maxSlippageBps?: number) => Promise<boolean>;
  placeLimitOrder: (price: number, size: number, isBuy: boolean) => Promise<boolean>;
  cancelOrder: (orderId: string) => Promise<boolean>;
  refreshOrders: () => Promise<void>;
  getOrderBookDepth: (depth: number) => Promise<{
    bids: { price: number; size: number }[];
    asks: { price: number; size: number }[];
  }>;
  getBestPrices: () => Promise<{ bestBid: number; bestAsk: number }>;
}

export function useOrderBook(marketId?: string): [OrderBookState, OrderBookActions] {
  const wallet = useWallet() as any;
  const walletAddress: string | null = wallet?.walletData?.address ?? wallet?.address ?? null;
  const walletSigner = wallet?.walletData?.signer ?? wallet?.signer ?? null;
  const walletIsConnected: boolean = !!(wallet?.walletData?.isConnected ?? wallet?.isConnected);
  const [contracts, setContracts] = useState<any>(null);
  const [state, setState] = useState<OrderBookState>({
    bestBid: 0,
    bestAsk: 0,
    markPrice: 0,
    indexPrice: 0,
    fundingRate: 0,
    activeOrders: [],
    isLoading: true,
    error: null
  });

  // Initialize contracts when wallet is connected
  useEffect(() => {
    const init = async () => {
      try {
        // Resolve orderbook by marketId hint
        let orderBookAddressOverride: string | undefined;
        if (marketId && /btc/i.test(marketId)) {
          orderBookAddressOverride = CONTRACT_ADDRESSES.BTC_ORDERBOOK;
        } else {
          orderBookAddressOverride = CONTRACT_ADDRESSES.ALUMINUM_ORDERBOOK;
        }
        // Choose runner: prefer signer; else derive signer from BrowserProvider; else fail
        let runner: ethers.Signer | ethers.AbstractProvider | undefined = undefined;
        if (walletSigner) {
          runner = walletSigner as ethers.Signer;
        } else if (typeof window !== 'undefined' && (window as any).ethereum) {
          try {
            const browserProvider = new ethers.BrowserProvider((window as any).ethereum);
            const injectedSigner = await browserProvider.getSigner();
            runner = injectedSigner;
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
        const contractInstances = await initializeContracts(runner, { orderBookAddressOverride });
        console.log('[useOrderBook] Initialized contracts with OB', contractInstances.orderBookAddress, 'for marketId', marketId);
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
            if (resolved && typeof resolved === 'string' && resolved.toLowerCase() !== contractInstances.orderBookAddress.toLowerCase()) {
              console.log('[useOrderBook] Re-initializing with resolved OB', resolved);
              const reinit = await initializeContracts(runner, { orderBookAddressOverride: resolved });
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
              const knownOrderBooks = [CONTRACT_ADDRESSES.BTC_ORDERBOOK, CONTRACT_ADDRESSES.ALUMINUM_ORDERBOOK];
              for (const obAddress of knownOrderBooks) {
                try {
                  const tempContracts = await initializeContracts(walletSigner || new ethers.BrowserProvider((window as any).ethereum), { orderBookAddressOverride: obAddress });
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

    // Initial fetch
    fetchMarketData();

    // Poll every 5 seconds for updates (increased from 2 seconds to reduce load)
    const interval = setInterval(fetchMarketData, 5000);

    // Set up event listeners for real-time updates (if supported by the blockchain client)
    let unsubscribeOrderPlaced: (() => void) | null = null;
    let unsubscribeOrderFilled: (() => void) | null = null;
    let unsubscribeOrderCancelled: (() => void) | null = null;

    if (contracts && walletAddress) {
      const setupEventWatchers = async () => {
        try {
          const eventClient = createPublicClient({ transport: http(CHAIN_CONFIG.rpcUrl) });
          // Start from latest block to avoid large eth_getLogs ranges on free-tier RPC
          let latestBlock: bigint | undefined = undefined;
          try {
            latestBlock = await eventClient.getBlockNumber();
          } catch {}

          // Event listener for new order placement
          unsubscribeOrderPlaced = eventClient.watchContractEvent({
            address: contracts.orderBookAddress,
            abi: OrderBookEventABI as any,
            eventName: 'OrderPlaced',
            args: { trader: walletAddress },
            fromBlock: latestBlock,
            poll: true,
            pollingInterval: 5_000,
            onLogs: (logs: any[]) => {
              console.log('[useOrderBook] OrderPlaced event detected', logs);
              fetchMarketData(); // Refresh orders on event
            },
            onError: (error: Error) => {
              console.error('[useOrderBook] Error in OrderPlaced event listener', error);
            }
          });

          // Event listener for order filled
          unsubscribeOrderFilled = eventClient.watchContractEvent({
            address: contracts.orderBookAddress,
            abi: OrderBookEventABI as any,
            eventName: 'OrderFilled',
            args: { trader: walletAddress },
            fromBlock: latestBlock,
            poll: true,
            pollingInterval: 5_000,
            onLogs: (logs: any[]) => {
              console.log('[useOrderBook] OrderFilled event detected', logs);
              fetchMarketData(); // Refresh orders on event
            },
            onError: (error: Error) => {
              console.error('[useOrderBook] Error in OrderFilled event listener', error);
            }
          });

          // Event listener for order cancellation
          unsubscribeOrderCancelled = eventClient.watchContractEvent({
            address: contracts.orderBookAddress,
            abi: OrderBookEventABI as any,
            eventName: 'OrderCancelled',
            args: { trader: walletAddress },
            fromBlock: latestBlock,
            poll: true,
            pollingInterval: 5_000,
            onLogs: (logs: any[]) => {
              console.log('[useOrderBook] OrderCancelled event detected', logs);
              fetchMarketData(); // Refresh orders on event
            },
            onError: (error: Error) => {
              console.error('[useOrderBook] Error in OrderCancelled event listener', error);
            }
          });

          console.log('[useOrderBook] Event listeners set up for real-time order updates from block', latestBlock?.toString() || 'latest');
        } catch (error) {
          console.error('[useOrderBook] Failed to set up event listeners', error);
        }
      };

      setupEventWatchers();
    }

    return () => {
      clearInterval(interval);
      if (unsubscribeOrderPlaced) unsubscribeOrderPlaced();
      if (unsubscribeOrderFilled) unsubscribeOrderFilled();
      if (unsubscribeOrderCancelled) unsubscribeOrderCancelled();
      console.log('[useOrderBook] Cleaned up event listeners and interval');
    };
  }, [contracts, walletAddress, marketId]);

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
      // Encode price with USDC decimals (6) and size with token decimals (18)
      const priceWei = parseUnits(price.toString(), 6);
      const sizeWei = parseEther(size.toString());
      
      const tx = await contracts.obOrderPlacement.placeMarginLimitOrder(
        priceWei,
        sizeWei,
        isBuy
      );
      
      await tx.wait();
      
      // Refresh orders after successful placement
      await refreshOrders();
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

  const actions: OrderBookActions = {
    placeMarketOrder,
    placeLimitOrder,
    cancelOrder,
    refreshOrders,
    getOrderBookDepth,
    getBestPrices
  };

  return [state, actions];
}
