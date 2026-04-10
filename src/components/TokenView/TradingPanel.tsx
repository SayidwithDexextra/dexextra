'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TokenData } from '@/types/token';
import { useWallet } from '@/hooks/useWallet';
import { useMarketData } from '@/contexts/MarketDataContext';
import { useMarginSummary } from '@/hooks/useMarginSummary';
import { usePortfolioData, type PortfolioOrdersBucket } from '@/hooks/usePortfolioData';
import type { OrderBookOrder } from '@/hooks/useOrderBook';
import { formatEther, parseEther } from 'viem';
import { ethers } from 'ethers';
import { initializeContracts, OBOrderPlacementFacetABI } from '@/lib/contracts';
// Removed gas override utilities to rely on provider estimation
import { ensureHyperliquidWallet, isOnCorrectChain, getReadProvider } from '@/lib/network';
import type { Address } from 'viem';
import { submitSessionTrade, isSessionErrorMessage, ensureGaslessChain } from '@/lib/gasless';
import { useSession } from '@/contexts/SessionContext';
import WalletModal from '@/components/WalletModal';
import { OrderFillLoadingModal, type OrderFillStatus } from '@/components/TokenView/OrderFillLoadingModal';
import { dispatchOptimisticOrderEvent } from '@/hooks/useLightweightOrderBook';

interface TradingPanelProps {
  tokenData: TokenData;
  initialAction?: 'long' | 'short' | null;
  marketData?: {
    markPrice: number;
    fundingRate: number;
    currentPrice: number;
    priceChange24h: number;
    priceChangePercent24h: number;
    dataSource: string;
    lastUpdated?: string;
  };
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

const normalizeOrderStatusForPanel = (rawStatus: any): OrderBookOrder['status'] => {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (!status || status === 'pending' || status === 'open' || status === 'submitted') return 'pending';
  if (status === 'partial' || status === 'partially_filled') return 'partially_filled';
  if (status === 'filled') return 'filled';
  if (status === 'expired') return 'expired';
  if (status === 'cancelled' || status === 'canceled' || status === 'rejected') return 'cancelled';
  return 'pending';
};

const normalizeQuantityForPanel = (qty: number): number => {
  const n = Number.isFinite(qty) ? Math.abs(qty) : 0;
  if (n >= 1_000_000) return n / 1_000_000_000_000;
  return n;
};

const parseTimestamp = (value: any): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
};

const mapBucketOrderToOrderBookOrder = (
  rawOrder: any,
  symbolUpper: string,
  traderAddress?: string | null
): OrderBookOrder | null => {
  if (!rawOrder) return null;
  const id = String(rawOrder?.order_id ?? rawOrder?.id ?? '').trim();
  if (!id) return null;

  const qty = normalizeQuantityForPanel(Number(rawOrder?.quantity ?? rawOrder?.size ?? 0));
  if (!(qty > 0)) return null;

  const filledQty = normalizeQuantityForPanel(
    Number(rawOrder?.filled_quantity ?? rawOrder?.filledQuantity ?? rawOrder?.filled ?? 0)
  );

  const status = normalizeOrderStatusForPanel(rawOrder?.order_status ?? rawOrder?.status);
  if (status === 'filled' || status === 'cancelled' || status === 'expired') return null;

  const sideStr = String(rawOrder?.side ?? (rawOrder?.isBuy ? 'buy' : 'sell')).toLowerCase();
  const isBuy = sideStr !== 'sell';
  const priceRaw = rawOrder?.price ?? 0;
  const price =
    typeof priceRaw === 'string'
      ? parseFloat(priceRaw)
      : Number.isFinite(priceRaw)
        ? Number(priceRaw)
        : 0;

  const expiryCandidate = rawOrder?.expiry_time ?? rawOrder?.expiry_ts ?? rawOrder?.expiry;
  const expiryTime = expiryCandidate ? parseTimestamp(expiryCandidate) : undefined;

  return {
    id,
    trader: (traderAddress ?? ZERO_ADDRESS) as Address,
    price: Number.isFinite(price) ? price : 0,
    size: qty,
    quantity: qty,
    filledQuantity: filledQty,
    filled: filledQty,
    isBuy,
    side: isBuy ? 'buy' : 'sell',
    status,
    timestamp: parseTimestamp(rawOrder?.updated_at ?? rawOrder?.created_at ?? rawOrder?.timestamp),
    ...(expiryTime ? { expiryTime } : {}),
  };
};

const deriveOrdersForSymbolFromBuckets = (
  buckets: PortfolioOrdersBucket[] | undefined,
  symbolUpper: string | null,
  traderAddress?: string | null
): OrderBookOrder[] => {
  if (!symbolUpper || !Array.isArray(buckets)) return [];
  const bucket = buckets.find(
    (b) => String(b?.symbol || '').toUpperCase() === symbolUpper
  );
  if (!bucket) return [];

  const results = (bucket?.orders || [])
    .map((order: any) => mapBucketOrderToOrderBookOrder(order, symbolUpper, traderAddress))
    .filter((order): order is OrderBookOrder => Boolean(order))
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

  return results;
};

const SESSION_STORAGE_PREFIX = 'orderbook:activeOrders:v1:';
const isActiveOrder = (order: OrderBookOrder | null | undefined): order is OrderBookOrder => {
  if (!order || !order.id) return false;
  const status = String(order.status || '').toLowerCase();
  return status !== 'filled' && status !== 'cancelled' && status !== 'canceled' && status !== 'expired';
};

export default function TradingPanel({ tokenData, initialAction, marketData }: TradingPanelProps) {
  const wallet = useWallet() as any;
  const isConnected = !!(wallet?.walletData?.isConnected ?? wallet?.isConnected);
  const address = (wallet?.walletData?.address ?? wallet?.address) as string | null;
  const connect = wallet?.connect as (() => Promise<void>);

  // Get the metric ID for orderbook queries
  const metricId = tokenData.symbol;
  const md = useMarketData();
  const marketRow = md.market as any;
  const {
    sessionId: globalSessionId,
    sessionActive: globalSessionActive,
    enableTrading: globalEnableTrading,
    refresh: refreshSession,
    clear: clearSession,
  } = useSession();
  // No per-component status fetch; rely on SessionProvider for session status

  
  // Initialize OrderBook hook
  console.log('metricId OrderBook hook', metricId);
  const orderBookState = md.orderBookState;
  const orderBookActions = md.orderBookActions;
  
  // Order submission state
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);

  // Order fill modal (subtle "cup fill" loader)
  const [orderFillModal, setOrderFillModal] = useState<{
    isOpen: boolean;
    progress: number; // 0..1
    status: OrderFillStatus;
    allowClose: boolean;
    startedAt: number;
    kind: 'market' | 'limit' | 'cancel' | null;
    headlineText?: string;
    detailText?: string;
    showProgressLabel?: boolean;
  }>({
    isOpen: false,
    progress: 0,
    status: 'submitting',
    allowClose: false,
    startedAt: 0,
    kind: null,
    headlineText: undefined,
    detailText: undefined,
    showProgressLabel: undefined,
  });

  const startOrderFillModal = useCallback((kind: 'market' | 'limit' | 'cancel') => {
    setOrderFillModal({
      isOpen: true,
      progress: 0.06,
      status: kind === 'cancel' ? 'canceling' : 'submitting',
      allowClose: false,
      startedAt: Date.now(),
      kind,
      headlineText: undefined,
      detailText: undefined,
      showProgressLabel: undefined,
    });
  }, []);

  const markOrderFillError = useCallback(() => {
    setOrderFillModal((cur) => ({
      ...cur,
      isOpen: true,
      status: 'error',
      progress: 1,
      allowClose: true,
      showProgressLabel: false,
    }));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pendingOrderResolved', { detail: { status: 'error' } }));
    }
  }, []);

  const finishOrderFillModal = useCallback(() => {
    setOrderFillModal((cur) => ({
      ...cur,
      status: 'success',
      progress: 1,
      allowClose: false,
      headlineText: undefined,
      detailText: undefined,
      showProgressLabel: undefined,
    }));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pendingOrderResolved', { detail: { status: 'success' } }));
    }
    window.setTimeout(() => {
      setOrderFillModal((cur) => ({
        ...cur,
        isOpen: false,
        kind: null,
        headlineText: undefined,
        detailText: undefined,
        showProgressLabel: undefined,
      }));
    }, 750);
  }, []);

  const markOrderAsSlowBackgroundable = useCallback((opts: { kind: 'market' | 'limit' | 'cancel'; routedPool?: string; reroutedToBig?: boolean }) => {
    const isBig = opts.routedPool === 'hub_trade_big' || opts.reroutedToBig === true;
    if (!isBig) return false;
    const isCancel = opts.kind === 'cancel';
    setOrderFillModal((cur) => ({
      ...cur,
      isOpen: true,
      status: isCancel ? 'canceling' : 'submitting',
      progress: Math.max(cur.progress || 0, 0.12),
      allowClose: true,
      kind: opts.kind,
      headlineText: 'Please wait a moment while we process your order.',
      detailText:
        isCancel
          ? 'This can take between 1 and 2 minutes. You can close this dialog and continue in the background.'
          : 'This can take between 1 and 2 minutes. You can close this dialog and continue in the background.',
      showProgressLabel: false,
    }));
    // Auto-dismiss after a moment so the UI doesn't feel stuck.
    window.setTimeout(() => {
      setOrderFillModal((cur) => {
        if (!cur.isOpen) return cur;
        // Only auto-dismiss if we're still in progress
        if (cur.status === 'success' || cur.status === 'error') return cur;
        return { ...cur, isOpen: false, kind: null, headlineText: undefined, detailText: undefined, showProgressLabel: undefined };
      });
    }, 9000);
    return true;
  }, []);
  
  // Order cancellation state
  const [isCancelingOrder, setIsCancelingOrder] = useState(false);
  
  // Extract values from orderBookState
  const {
    bestBid,
    bestAsk,
    markPrice,
    indexPrice,
    fundingRate,
    activeOrders: orderBookActiveOrders,
    isLoading: orderBookLoading,
    error: orderBookError,
    marketParams
  } = orderBookState;

  // Extract actions from orderBookActions
  const {
    placeMarketOrder,
    placeLimitOrder,
    cancelOrder,
    refreshOrders: refreshOrderBookData,
    getOrderBookDepth,
    estimateMarketOrder
  } = orderBookActions;

  // Portfolio-level orders (Supabase-backed)
  const {
    ordersBuckets,
    isLoadingOrders: portfolioOrdersLoading,
    refreshOrders: refreshPortfolioOrders,
    error: portfolioOrdersError
  } = usePortfolioData({ enabled: Boolean(isConnected), refreshInterval: 0 });

  const normalizedSymbol = useMemo(() => (metricId ? metricId.toUpperCase() : null), [metricId]);

  const [sessionOrders, setSessionOrders] = useState<OrderBookOrder[]>([]);

  const hydrateSessionOrders = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!address || !normalizedSymbol) {
      setSessionOrders([]);
      return;
    }

    const lowerAddress = address.toLowerCase();
    const results: OrderBookOrder[] = [];

    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (!key || !key.startsWith(SESSION_STORAGE_PREFIX)) continue;
      const raw = window.sessionStorage.getItem(key);
      if (!raw) continue;
      try {
        const payload = JSON.parse(raw);
        if (!payload || Number(payload.version) !== 1) continue;
        if (String(payload.walletAddress || '').toLowerCase() !== lowerAddress) continue;
        const payloadSymbol = String(payload.marketId || '').toUpperCase();
        if (payloadSymbol !== normalizedSymbol) continue;
        const orders = Array.isArray(payload.orders) ? payload.orders : [];
        orders.forEach((order: OrderBookOrder) => {
          if (isActiveOrder(order)) {
            results.push(order);
          }
        });
      } catch (err) {
        console.warn('[TradingPanel] session hydrate failed', err);
      }
    }

    setSessionOrders(results);
  }, [address, normalizedSymbol]);

  useEffect(() => {
    hydrateSessionOrders();
  }, [hydrateSessionOrders]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      hydrateSessionOrders();
    };
    window.addEventListener('ordersUpdated', handler as EventListener);
    return () => {
      window.removeEventListener('ordersUpdated', handler as EventListener);
    };
  }, [hydrateSessionOrders]);

  const bucketOrdersForMarket = useMemo(
    () => deriveOrdersForSymbolFromBuckets(ordersBuckets, normalizedSymbol, address),
    [ordersBuckets, normalizedSymbol, address]
  );

  const activeOrders = useMemo(() => {
    const map = new Map<string, OrderBookOrder>();
    const addOrder = (order: OrderBookOrder | null | undefined, preferOverwrite = false) => {
      if (!isActiveOrder(order)) return;
      if (preferOverwrite || !map.has(order.id)) {
        map.set(order.id, order);
      }
    };

    bucketOrdersForMarket.forEach((order) => addOrder(order, false));
    (orderBookActiveOrders || []).forEach((order) => addOrder(order, false));
    sessionOrders.forEach((order) => addOrder(order, true));
    return Array.from(map.values());
  }, [bucketOrdersForMarket, orderBookActiveOrders, sessionOrders]);

  const ordersLoading = isConnected ? portfolioOrdersLoading : orderBookLoading;
  const ordersError = activeOrders.length === 0 ? portfolioOrdersError : null;

  // Filled orders from active orders history
  const filledOrdersForThisMarket = activeOrders.filter(order => order.filled > 0);

  const refreshOrders = useCallback(async () => {
    const tasks: Promise<unknown>[] = [];
    if (typeof refreshOrderBookData === 'function') {
      tasks.push(refreshOrderBookData());
    }
    if (typeof refreshPortfolioOrders === 'function') {
      tasks.push(refreshPortfolioOrders());
    }
    if (tasks.length === 0) {
      hydrateSessionOrders();
      return;
    }
    await Promise.allSettled(tasks);
    hydrateSessionOrders();
  }, [refreshOrderBookData, refreshPortfolioOrders, hydrateSessionOrders]);

  // Smooth progress while submitting/filling (purely visual)
  useEffect(() => {
    if (!orderFillModal.isOpen) return;
    if (orderFillModal.status === 'success' || orderFillModal.status === 'error') return;

    const target = orderFillModal.status === 'submitting' ? 0.7 : 0.92;
    const id = window.setInterval(() => {
      setOrderFillModal((cur) => {
        if (!cur.isOpen) return cur;
        if (cur.status === 'success' || cur.status === 'error') return cur;
        const t = cur.status === 'submitting' ? 0.7 : 0.92;
        const next = Math.min(t, cur.progress + (t - cur.progress) * 0.08 + 0.003);
        return { ...cur, progress: next };
      });
    }, 120);

    return () => window.clearInterval(id);
  }, [orderFillModal.isOpen, orderFillModal.status]);

  // Escape hatch: if a market order stays pending too long, allow user to close.
  useEffect(() => {
    if (!orderFillModal.isOpen) return;
    if (orderFillModal.kind !== 'market') return;
    if (orderFillModal.status === 'success' || orderFillModal.status === 'error') return;
    const startedAt = orderFillModal.startedAt;
    const id = window.setInterval(() => {
      setOrderFillModal((cur) => {
        if (!cur.isOpen || cur.kind !== 'market') return cur;
        if (cur.status === 'success' || cur.status === 'error') return cur;
        if (Date.now() - startedAt > 25_000) {
          return { ...cur, allowClose: true };
        }
        return cur;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [orderFillModal.isOpen, orderFillModal.kind, orderFillModal.startedAt, orderFillModal.status]);

  // Escape hatch for cancel too (avoid trapping UI if RPC hangs)
  useEffect(() => {
    if (!orderFillModal.isOpen) return;
    if (orderFillModal.kind !== 'cancel') return;
    if (orderFillModal.status === 'success' || orderFillModal.status === 'error') return;
    const startedAt = orderFillModal.startedAt;
    const id = window.setInterval(() => {
      setOrderFillModal((cur) => {
        if (!cur.isOpen || cur.kind !== 'cancel') return cur;
        if (cur.status === 'success' || cur.status === 'error') return cur;
        if (Date.now() - startedAt > 18_000) {
          return { ...cur, allowClose: true };
        }
        return cur;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [orderFillModal.isOpen, orderFillModal.kind, orderFillModal.startedAt, orderFillModal.status]);

  // Auto-dismiss the order modal after 2s for market/limit orders so the user
  // sees inline progress in the Market Activity tab instead of staying blocked.
  useEffect(() => {
    if (!orderFillModal.isOpen) return;
    if (orderFillModal.kind !== 'market' && orderFillModal.kind !== 'limit') return;

    const timer = setTimeout(() => {
      setOrderFillModal((cur) => {
        if (!cur.isOpen) return cur;
        if (cur.status === 'error') return cur;
        return {
          ...cur,
          isOpen: false,
          kind: null,
          headlineText: undefined,
          detailText: undefined,
          showProgressLabel: undefined,
        };
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [orderFillModal.isOpen, orderFillModal.kind]);

  // Trading validation
  const canPlaceOrder = useCallback(() => {
    return isConnected && !orderBookLoading && !isSubmittingOrder;
  }, [isConnected, orderBookLoading, isSubmittingOrder]);

  // Clear any trading errors
  const clearTradingError = useCallback(() => {
    setOrderFillModal((cur) => {
      // Only clear the "error dialog" variant (not active submit/fill flows)
      if (!cur.isOpen) return cur;
      if (cur.status !== 'error') return cur;
      if (cur.kind !== null) return cur;
      return {
        ...cur,
        isOpen: false,
        headlineText: undefined,
        detailText: undefined,
        showProgressLabel: undefined,
      };
    });
  }, []);
  
  const isSystemReady = !orderBookLoading && !isSubmittingOrder;
  
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');
  const [selectedOption, setSelectedOption] = useState<'long' | 'short' | null>(initialAction || 'long');
  const [amount, setAmount] = useState(0);
  const [amountInput, setAmountInput] = useState<string>(''); // raw input to preserve decimals while typing (e.g., "0.", ".5")
  const [isUsdMode, setIsUsdMode] = useState(true); // New state for toggling between USD and units
  const [slippage] = useState(0.5); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [quoteState, setQuoteState] = useState<{
    isLoading: boolean;
    price: number; // estimated average fill price
    units: number; // estimated units to be filled
    value: number; // estimated total value in USDC
    partial: boolean; // true if book depth insufficient
    levelsUsed: number;
    error?: string | null;
    topPrice?: number;
    topSize?: number;
    side?: 'bid' | 'ask';
  }>({ isLoading: false, price: 0, units: 0, value: 0, partial: false, levelsUsed: 0, error: null, topPrice: undefined, topSize: undefined, side: undefined });
  
  // Limit Order States
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [triggerPrice, setTriggerPrice] = useState(0);
  // Keep a raw string for the trigger price so users can type decimals like "0." smoothly
  const [triggerPriceInput, setTriggerPriceInput] = useState<string>("");
  const [limitOrderType, setLimitOrderType] = useState<'LIMIT' | 'MARKET_IF_TOUCHED' | 'STOP_LOSS' | 'TAKE_PROFIT'>('LIMIT');
  const [orderExpiry, setOrderExpiry] = useState(24); // hours from now
  const [maxSlippage, setMaxSlippage] = useState(100); // basis points (1%)
  const [isSlippageModalOpen, setIsSlippageModalOpen] = useState(false);
  const [draftMaxSlippage, setDraftMaxSlippage] = useState<number>(100);
  const SLIPPAGE_MIN_BPS = 10; // 0.10%
  const SLIPPAGE_MAX_BPS = 10_000; // 100.00%

  const openSlippageModal = useCallback(() => {
    setDraftMaxSlippage(maxSlippage);
    setIsSlippageModalOpen(true);
  }, [maxSlippage]);

  const closeSlippageModal = useCallback(() => {
    setIsSlippageModalOpen(false);
  }, []);

  const confirmSlippageModal = useCallback(() => {
    setMaxSlippage(draftMaxSlippage);
    setIsSlippageModalOpen(false);
  }, [draftMaxSlippage]);

  useEffect(() => {
    if (!isSlippageModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSlippageModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSlippageModalOpen]);

  const formatSlippagePct = (bps: number) => {
    const pct = bps / 100;
    // Keep it compact but precise enough for a slider
    if (pct >= 10) return `${pct.toFixed(0)}%`;
    if (pct >= 1) return `${pct.toFixed(2).replace(/\.00$/, '')}%`;
    return `${pct.toFixed(2)}%`;
  };
  const [isContractInfoExpanded, setIsContractInfoExpanded] = useState(false);
  // Note: We intentionally avoid syncing amount -> amountInput via effect to not
  // overwrite partial decimal typing like "0." during user input.

  // Helper functions
  const formatNumber = (value: number | string | null | undefined) => {
    // Convert to number if it's a string
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    
    if (numValue === null || numValue === undefined || isNaN(numValue)) return '0.00';
    if (numValue < 0.01) return numValue.toFixed(2);
    if (numValue < 1) return numValue.toFixed(2);
    if (numValue < 100) return numValue.toFixed(2);
    return Math.round(numValue).toLocaleString();
  };

  // Format bigint or number values safely
  const formatBigIntOrNumber = (value: bigint | number | string, decimals: number = 6): string => {
    if (typeof value === 'string') {
      const numValue = parseFloat(value);
      return isNaN(numValue) ? '0.00' : formatNumber(numValue);
    }
    if (typeof value === 'bigint') {
      // Convert bigint to number with proper decimal handling
      const divisor = BigInt(10 ** decimals);
      const wholePart = Number(value / divisor);
      const fractionalPart = Number(value % divisor) / (10 ** decimals);
      return formatNumber(wholePart + fractionalPart);
    }
    return formatNumber(value);
  };

  // formatInputNumber / parseInputNumber removed in favor of raw input with sanitization

  // Helper to get input value safely
  const getInputValue = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): string => {
    const target = e.target as any;
    return target.value;
  };

  // Format price with commas + 2 decimals
  const formatPrice = (rawPrice: string | number) => {
    const numPrice = typeof rawPrice === 'string'
      ? parseFloat(rawPrice.replace(/,/g, ''))
      : rawPrice;
    if (!Number.isFinite(numPrice)) return '0.00';
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      // Limit prices can require more precision (tick sizes can be < 0.01)
      maximumFractionDigits: 8,
    }).format(numPrice);
  };

  // Format amount with commas + up to 2 decimals
  const formatAmountInput = (rawAmount: string | number) => {
    const numAmount = typeof rawAmount === 'string'
      ? parseFloat(rawAmount.replace(/,/g, ''))
      : rawAmount;
    if (!Number.isFinite(numAmount)) return '';
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(numAmount);
  };

  // Sanitize a numeric string, permitting a single dot and up to 6 decimals
  const sanitizeDecimalInput = (raw: string, maxDecimals: number = 6) => {
    // Allow only digits and dot
    const cleaned = raw.replace(/[^0-9.]/g, '');
    // Keep first dot, remove others
    const parts = cleaned.split('.');
    const head = parts.shift() || '';
    let tail = parts.join('');
    // Trim decimals beyond max
    if (tail.length > maxDecimals) tail = tail.slice(0, maxDecimals);
    // Preserve leading 0 if starting with '.'
    if (cleaned.startsWith('.') && head === '') {
      // Allow typing "." and ".5" style numbers
      return tail.length > 0 ? `.${tail}` : '.';
    }
    // Preserve a trailing decimal point while typing (e.g. "0." or "12.")
    if (cleaned.includes('.') && cleaned.endsWith('.') && tail.length === 0) {
      return `${head}.`;
    }
    return tail.length > 0 ? `${head}.${tail}` : head;
  };

  const clearMessages = () => {
    setOrderFillModal((cur) => ({
      ...cur,
      isOpen: false,
      kind: null,
      headlineText: undefined,
      detailText: undefined,
      showProgressLabel: undefined,
    }));
    clearTradingError();
  };

  const showSuccess = (message: string, title: string = 'Success') => {
    setOrderFillModal((cur) => ({
      ...cur,
      isOpen: true,
      kind: null,
      startedAt: cur.startedAt || Date.now(),
      status: 'success',
      progress: 1,
      allowClose: true,
      headlineText: title,
      detailText: message,
      showProgressLabel: false,
    }));
    window.setTimeout(() => {
      setOrderFillModal((cur) => {
        if (cur.status !== 'success') return cur;
        return { ...cur, isOpen: false, kind: null, headlineText: undefined, detailText: undefined, showProgressLabel: undefined };
      });
    }, 2500);
  };

  const showError = (message: string, title: string = 'Error') => {
    // Use the new OrderFillLoadingModal as a unified status modal for errors too.
    setOrderFillModal((cur) => ({
      ...cur,
      isOpen: true,
      kind: null,
      startedAt: cur.startedAt || Date.now(),
      status: 'error',
      progress: 1,
      allowClose: true,
      headlineText: title,
      detailText: message,
      showProgressLabel: false,
    }));
  };

  // Navigation helper
  const navigateToTab = (tab: 'buy' | 'sell', option: 'long' | 'short') => {
    setActiveTab(tab);
    setSelectedOption(option);
  };

  // Quick amount buttons - increased values since scaling is fixed
  const quickAmounts = [100, 500, 1000, 5000];

  const handleQuickAmount = (value: number) => {
    setAmount(prev => {
      let next: number;
      if (isUsdMode) {
        next = prev + value;
      } else {
        const currentPrice = resolveCurrentPrice();
        next = prev + (value * currentPrice);
      }
      setAmountInput(formatAmountInput(next));
      return next;
    });
  };

  const handleMaxAmount = () => {
    // Use margin summary for max amount
    const maxAmount = Math.max(marginSummary.availableCollateral, 50000); // $50K default or available collateral
    if (isUsdMode) {
      setAmount(maxAmount);
      setAmountInput(formatAmountInput(maxAmount));
    } else {
      const currentPrice = resolveCurrentPrice();
      const next = maxAmount / currentPrice;
      setAmount(next);
      setAmountInput(formatAmountInput(next));
    }
  };

  // Token data access with safety checks
  const getSymbol = () => tokenData?.symbol || 'Unknown';
  
  // Helper to get tick_size from orderbook market data
  const getTickSize = () => {
    // Get tick_size from the orderbook market data
    if (marketRow?.tick_size && marketRow.tick_size > 0) {
      return marketRow.tick_size;
    }
    return 0.01; // Default tick size
  };
  const getStartPrice = () => {
    // Using simplified price logic
    let currentMarkPrice = 0;
    let priceSource = 'none';
    
    // Use passed marketData as primary source
    if (marketData?.currentPrice && marketData.currentPrice > 0) {
      currentMarkPrice = marketData.currentPrice;
      priceSource = 'marketData-current';
    }
    else if (marketData?.markPrice && marketData.markPrice > 0) {
      currentMarkPrice = marketData.markPrice;
      priceSource = 'marketData-mark';
    }
    // LAST RESORT: Legacy token data
    else if (tokenData?.price && tokenData.price > 0) {
      currentMarkPrice = tokenData.price;
      priceSource = 'legacy-token-price';
    } else {
      currentMarkPrice = 1.0; // Fallback for completely new markets
      priceSource = 'default-fallback';
    }

    console.log('🎯 TradingPanel Price for:', metricId, {
      // ALIGNMENT CHECK: Using marketData prop since legacy hooks removed
      marketDataProp: {
        currentPrice: marketData?.currentPrice,
        markPrice: marketData?.markPrice,
        dataSource: marketData?.dataSource,
        lastUpdated: marketData?.lastUpdated
      },
      
      // Final Computed Values
      finalPrice: currentMarkPrice,
      priceSource
    });

    return currentMarkPrice;
  };

  // Resolve an effective current price for validation/execution with sensible fallbacks
  const resolveCurrentPrice = (): number => {
    // If limit order with a valid trigger price, that's the effective price
    if (orderType === 'limit' && triggerPrice > 0) return triggerPrice;

    // For buy orders (long), prefer best ask if available; for sell orders (short), prefer best bid
    if (selectedOption === 'long' && bestAsk > 0) return bestAsk;
    if (selectedOption === 'short' && bestBid > 0) return bestBid;

    // Fall back to mid of best bid/ask if both available
    if (bestBid > 0 && bestAsk > 0) return (bestBid + bestAsk) / 2;

    // Prefer live mark price from order book state when available
    if (markPrice && markPrice > 0) return markPrice;

    // Fall back to marketData supplied by the token page
    if (marketData?.currentPrice && marketData.currentPrice > 0) return marketData.currentPrice;
    if (marketData?.markPrice && marketData.markPrice > 0) return marketData.markPrice;

    // Fall back to initial/tick size, then legacy token data, then a safe default
    const start = getStartPrice();
    return start && start > 0 ? start : 1.0;
  };

  // =====================
  // 📉 LIQUIDATION PRICE (UI-ONLY ESTIMATE)
  // =====================
  type LiquidationArgs = {
    positionType: 'short' | 'long';
    entryPrice: number;
    collateralRatio?: number;
    mmr?: number;
  };

  const calculateLiquidationPrice = ({
    positionType = 'short',
    entryPrice,
    collateralRatio = 1.5,
    mmr = 0.2
  }: LiquidationArgs): number => {
    if (!entryPrice || entryPrice <= 0) {
      return NaN;
    }

    if (positionType === 'short') {
      return ((collateralRatio + 1) * entryPrice) / (1 + mmr);
    } else if (positionType === 'long') {
      return 0;
    }
    return NaN;
  };

  const effectiveEntryPrice = useMemo(() => {
    if (orderType === 'limit' && triggerPrice > 0) return triggerPrice;
    return resolveCurrentPrice();
  }, [orderType, triggerPrice, markPrice, bestBid, bestAsk, marketData?.currentPrice, marketData?.markPrice]);

  // removed placeholder for computedLiquidationPrice (defined after marginSummary)

  // =====================
  // 💰 SIMPLE VALIDATION FOR TRADING ROUTER
  // =====================

  // Initialize margin summary hook
  const marginSummary = useMarginSummary();
  
  // Listen for propagated coreVaultSummary values to keep TradingPanel in sync
  useEffect(() => {
    const handler = (e: any) => {
      try {
        const detail = e.detail || {};
        // Optionally: use detail.availableBalance, detail.marginUsed, etc. for local overrides
        // setLocalMargin({ ... }) // if we add local state later
      } catch {}
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('coreVaultSummary', handler);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('coreVaultSummary', handler);
      }
    };
  }, []);

  // Define liquidation price memo after marginSummary to avoid use-before-declare
  const computedLiquidationPrice = useMemo(() => {
    if (!selectedOption) return null;

    const entryPrice = effectiveEntryPrice;
    if (!entryPrice || entryPrice <= 0) return null;

    // Derive collateralRatio and mmr from on-chain marketParams
    const marginBps = selectedOption === 'short'
      ? Math.max(marketParams.marginReqBps, 15000)
      : marketParams.marginReqBps;
    const collateralRatio = marginBps / 10000;
    const mmr = marginBps / 10000 * 0.2;

    const price = calculateLiquidationPrice({
      positionType: selectedOption,
      entryPrice,
      collateralRatio,
      mmr
    });

    if (!price || !isFinite(price) || price <= 0) return null;
    return Number(price.toFixed(6));
  }, [selectedOption, effectiveEntryPrice, marketParams.marginReqBps]);

  // =====================
  // 🧮 QUOTE COMPUTATION (on-chain estimate with depth-walk fallback)
  // =====================
  useEffect(() => {
    let cancelled = false;
    const computeQuote = async () => {
      if (!selectedOption || !amount || amount <= 0) {
        setQuoteState(prev => ({ ...prev, isLoading: false, price: 0, units: 0, value: 0, partial: false, levelsUsed: 0, error: null }));
        return;
      }
      // Limit orders: deterministic at trigger price
      if (orderType === 'limit') {
        const px = triggerPrice > 0 ? triggerPrice : resolveCurrentPrice();
        if (!(px > 0)) {
          setQuoteState(prev => ({ ...prev, isLoading: false, price: 0, units: 0, value: 0, partial: false, levelsUsed: 0, error: 'No price available' }));
          return;
        }
        const units = isUsdMode ? amount / px : amount;
        const value = units * px;
        setQuoteState({ isLoading: false, price: px, units, value, partial: false, levelsUsed: 1, error: null });
        return;
      }

      // Market orders: try on-chain estimateMarketOrder first, fall back to depth walk
      try {
        setQuoteState(prev => ({ ...prev, isLoading: true, error: null }));
        const isBuy = selectedOption === 'long';
        const sideLabel: 'ask' | 'bid' = isBuy ? 'ask' : 'bid';

        // Resolve quantity in units (the contract expects units, not notional)
        let quantityUnits: number;
        if (isUsdMode) {
          const refPrice = isBuy
            ? (bestAsk > 0 ? bestAsk : resolveCurrentPrice())
            : (bestBid > 0 ? bestBid : resolveCurrentPrice());
          if (!(refPrice > 0)) {
            if (!cancelled) setQuoteState({ isLoading: false, price: 0, units: 0, value: 0, partial: false, levelsUsed: 0, error: 'No price available', side: sideLabel });
            return;
          }
          quantityUnits = amount / refPrice;
        } else {
          quantityUnits = amount;
        }

        // Attempt on-chain estimate
        const estimate = await estimateMarketOrder(isBuy, quantityUnits);
        if (!cancelled && estimate && estimate.averagePrice > 0) {
          const estUnits = quantityUnits;
          const estValue = estUnits * estimate.averagePrice;
          setQuoteState({
            isLoading: false,
            price: estimate.averagePrice,
            units: estUnits,
            value: estValue,
            partial: false,
            levelsUsed: 0,
            error: null,
            topPrice: undefined,
            topSize: undefined,
            side: sideLabel,
          });
          return;
        }

        // Fallback: client-side depth walk
        const depth = await getOrderBookDepth(20);
        const asks = (depth.asks || []).filter(l => (l.price > 0 && l.size > 0)).sort((a, b) => a.price - b.price);
        const bids = (depth.bids || []).filter(l => (l.price > 0 && l.size > 0)).sort((a, b) => b.price - a.price);
        const book = isBuy ? asks : bids;
        if (!book || book.length === 0) {
          if (!cancelled) setQuoteState({ isLoading: false, price: 0, units: 0, value: 0, partial: false, levelsUsed: 0, error: 'No liquidity', topPrice: undefined, topSize: undefined, side: sideLabel });
          return;
        }
        let totalUnits = 0;
        let totalCost = 0;
        let remainingNotional = isUsdMode ? amount : null;
        let remainingUnits = !isUsdMode ? amount : null;
        let levelsUsed = 0;
        const topPrice = book[0]?.price;
        const topSize = book[0]?.size;
        for (const level of book) {
          if ((remainingNotional !== null && remainingNotional <= 0) || (remainingUnits !== null && remainingUnits <= 0)) break;
          levelsUsed += 1;
          const levelPrice = level.price;
          const levelSize = level.size;
          if (remainingNotional !== null) {
            const levelValueCapacity = levelPrice * levelSize;
            if (remainingNotional <= levelValueCapacity) {
              const fillUnits = remainingNotional / levelPrice;
              totalUnits += fillUnits;
              totalCost += remainingNotional;
              remainingNotional = 0;
              break;
            } else {
              totalUnits += levelSize;
              totalCost += levelValueCapacity;
              remainingNotional -= levelValueCapacity;
            }
          } else if (remainingUnits !== null) {
            if (remainingUnits <= levelSize) {
              totalUnits += remainingUnits;
              totalCost += remainingUnits * levelPrice;
              remainingUnits = 0;
              break;
            } else {
              totalUnits += levelSize;
              totalCost += levelSize * levelPrice;
              remainingUnits -= levelSize;
            }
          }
        }
        const partial = (remainingNotional !== null && remainingNotional > 0) || (remainingUnits !== null && remainingUnits > 0);
        const avgPrice = totalUnits > 0 ? totalCost / totalUnits : 0;
        if (!cancelled) setQuoteState({ isLoading: false, price: avgPrice, units: totalUnits, value: totalCost, partial, levelsUsed, error: null, topPrice, topSize, side: sideLabel });
      } catch (e: any) {
        if (!cancelled) setQuoteState({ isLoading: false, price: 0, units: 0, value: 0, partial: false, levelsUsed: 0, error: e?.message || 'Failed to fetch order book', topPrice: undefined, topSize: undefined, side: selectedOption === 'long' ? 'ask' : 'bid' });
      }
    };
    computeQuote();
    return () => { cancelled = true; };
  }, [amount, isUsdMode, orderType, selectedOption, triggerPrice, bestBid, bestAsk, getOrderBookDepth, estimateMarketOrder]);

  const validateOrderAmount = (): { isValid: boolean; message?: string } => {
    // Check if amount is a valid number
    if (!amount || amount <= 0 || isNaN(amount)) {
      return { isValid: false, message: 'Enter a valid USDC amount' };
    }
    
    // Check minimum amount
    if (amount < 1) {
      return { isValid: false, message: 'Minimum $1 USDC required' };
    }
    
    // Check maximum amount  
    if (amount > 10000000) {
      return { isValid: false, message: 'Maximum $10M USDC per order' };
    }
    
    // Check for reasonable decimal precision (USDC has 6 decimals, but UI shows 2-4)
    const decimalPlaces = (amount.toString().split('.')[1] || '').length;
    if (decimalPlaces > 6) {
      return { isValid: false, message: 'Too many decimal places (max 6 for USDC)' };
    }
    
    // Ensure we can calculate meaningful units
    const currentPrice = resolveCurrentPrice();
    if (currentPrice <= 0) {
      return { isValid: false, message: 'Price data not available' };
    }
    
    const calculatedUnits = amount / currentPrice;
    if (calculatedUnits < 0.0001) {
      return { isValid: false, message: 'Amount too small - would result in negligible units' };
    }
    
    // Check margin requirements
    if (marginSummary.isLoading) {
      return { isValid: false, message: 'Loading margin data...' };
    }
    
    if (marginSummary.error) {
      return { isValid: false, message: 'Unable to validate margin requirements' };
    }
    
    // Check available collateral
    if (amount > marginSummary.availableCollateral) {
      const neededDeposit = amount - marginSummary.availableCollateral;
      return { 
        isValid: false, 
        message: `Insufficient collateral. Need $${neededDeposit.toFixed(2)} more USDC. Please deposit using the header.` 
      };
    }
    
    // Check margin utilization
    const projectedUtilization = ((marginSummary.totalMarginUsed + amount) / marginSummary.totalCollateral) * 100;
    if (projectedUtilization > 90) {
      return {
        isValid: false,
        message: `Order would exceed safe margin utilization (${projectedUtilization.toFixed(1)}% > 90%)`
      };
    }
    
    // Check account health
    if (!marginSummary.isHealthy) {
      return {
        isValid: false,
        message: 'Account margin requirements not met. Please add collateral or reduce positions.'
      };
    }
    
    return { isValid: true };
  };

  const canExecuteTrade = useCallback(() => {
    // Only check basic requirements to enable button
    if (!isConnected) return false;
    if (isSubmittingOrder || isCancelingOrder) return false;
    if (!selectedOption) return false;
    // Block trading if market is settled (DB status)
    if ((marketRow as any)?.market_status === 'SETTLED') return false;
    // Disable when market is settled (from header context) — removed undefined reference
    
    // Check if amount is set and valid
    if (!amount || amount <= 0 || isNaN(amount)) return false;
    
    // For limit orders, validate trigger price
    if (orderType === 'limit' && triggerPrice <= 0) return false;
    
    // Enable button even if other checks might fail - we'll handle those during execution
    return true;
  }, [
    isConnected,
    isSubmittingOrder,
    isCancelingOrder,
    selectedOption,
    amount,
    orderType,
    triggerPrice,
    marketRow?.market_status
  ]);

  // Helper function to abbreviate long market names for button display
  const abbreviateMarketName = (symbol: string, maxLength: number = 12): string => {
    if (symbol.length <= maxLength) return symbol;
    
    // For very long symbols, show first few characters + "..." + last few characters
    const startChars = Math.floor((maxLength - 3) / 2);
    const endChars = maxLength - 3 - startChars;
    
    return `${symbol.slice(0, startChars)}...${symbol.slice(-endChars)}`;
  };

  const getTradeButtonText = () => {
    if ((marketRow as any)?.market_status === 'SETTLED') return 'Settled';
    if ((marketRow as any)?.market_status === 'SETTLEMENT_REQUESTED') return 'Settlement Pending';
    if (!isConnected) return 'Connect Wallet';
    if (orderBookLoading) return 'Loading...';
    if (isSubmittingOrder) return 'Submitting Order...';
    if (isCancelingOrder) return 'Canceling Order...';
    // Gasless session: prompt to enable trading when session is not active
    const GASLESS_ENABLED = process.env.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
    if (GASLESS_ENABLED && address && globalSessionActive === false) {
      const activeChainId = (wallet?.walletData?.chainId ?? wallet?.chainId) as number | null | undefined;
      if (activeChainId != null && !isOnCorrectChain(activeChainId)) return 'Switch Network';
      return 'Enable Trading';
    }
    if (!selectedOption) return 'Select Position Direction';
    if (orderType === 'limit' && triggerPrice <= 0) return 'Set Limit Price';

    // Always show a generic action label; do not render validation errors in the UI
    return `Place ${orderType === 'limit' ? 'Limit' : 'Market'} ${selectedOption.toUpperCase()}`;
  };

  const OrderValidationComponent = () => {
    if (!amount || amount <= 0) return null;
    
    const validation = validateOrderAmount();
    
    if (!validation.isValid) {
      return (
        <div className="text-[10px] text-red-400 mt-1">
          <div className="font-semibold">
            ❌ {validation.message}
          </div>
        </div>
      );
    }
    
    
    return (
      <div className="text-[10px] text-green-400 mt-1">
        <div className="font-semibold">
          ✅ Order amount valid
        </div>
        <div className="opacity-75 mt-0.5">
          Ready to place order
        </div>
      </div>
    );
  };

  // =====================
  // 🔍 SIMPLE ORDER VALIDATION
  // =====================

  const validateOrder = (): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    if (!isConnected) {
      errors.push('Wallet not connected');
    }
    
    if (!selectedOption) {
      errors.push('Select buy or sell');
    }
    
    const amountValidation = validateOrderAmount();
    if (!amountValidation.isValid) {
      errors.push(amountValidation.message || 'Invalid amount');
    }
    
    // Enhanced limit order validation
    if (orderType === 'limit') {
      if (triggerPrice <= 0) {
        errors.push('Set trigger price for limit orders');
      }
      
      // Check tick size compliance if available
      const tickSize = getTickSize();
      if (tickSize > 0) {
        const isValidTick = Math.abs(triggerPrice % tickSize) < 0.000001;
        if (!isValidTick) {
          errors.push(`Price must be in increments of ${tickSize}`);
        }
      }
    }
    
      // Market availability checks
    if (orderBookError) {
      errors.push(`Market issue: ${orderBookError}`);
    }
    
    // Calculate position size for advanced validation
    const currentPrice = resolveCurrentPrice();
    if (currentPrice && currentPrice > 0 && amount > 0) {
      const positionSize = amount / currentPrice;
      if (positionSize < 0.001) { // Example minimum size check
        errors.push('Position size too small');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  };

  // Clear any trading errors when needed
  const clearAllErrors = () => {
    clearTradingError();
  };

  // =====================
  // 📈 TRADING EXECUTION
  // =====================

  const executeMarketOrder = async () => {
    console.log('🚀 Starting market order execution with OrderBook...');
    
    if (!isConnected || !address) {
      showError('Please connect your wallet to place orders.', 'Wallet Required');
      return;
    }
    
    if (!selectedOption) {
      showError('Please select buy or sell.', 'Missing Direction');
      return;
    }
    
    clearAllErrors();
    startOrderFillModal('market');
    setIsSubmittingOrder(true);

    if (typeof window !== 'undefined') {
      const approxPrice = resolveCurrentPrice() || 0;
      const approxSize = isUsdMode && approxPrice > 0 ? amount / approxPrice : amount;
      window.dispatchEvent(new CustomEvent('pendingOrderPlaced', {
        detail: {
          id: `pending-${Date.now()}`,
          symbol: String(metricId || '').toUpperCase(),
          side: selectedOption === 'long' ? 'BUY' : 'SELL',
          type: 'MARKET',
          price: approxPrice,
          size: approxSize,
          timestamp: Date.now(),
        }
      }));
    }

    try {
      // Resolve current market price with robust fallbacks
      const currentPrice = resolveCurrentPrice();
      
      if (!currentPrice || currentPrice <= 0) {
        throw new Error('Cannot execute trade: Market price not available. Please wait for price data to load or try refreshing the page.');
      }
      
      // Prepare signer and contracts for on-chain reads/writes
      const signer = await ensureHyperliquidWallet();
      
      // Ensure we have the market row data
      if (!marketRow) {
        throw new Error(`Market data not available for ${metricId}`);
      }
      
      // Strictly use the market's own contract addresses
      const contracts = await initializeContracts({ 
        providerOrSigner: signer,
        orderBookAddressOverride: marketRow.market_address || undefined,
        marketIdentifier: marketRow.market_identifier || undefined,
        marketSymbol: marketRow.symbol || undefined,
        network: marketRow.network || undefined,
        chainId: marketRow.chain_id,
        marketIdBytes32: (marketRow as any)?.market_id_bytes32 || (marketRow as any)?.market_identifier_bytes32 || undefined
      });

      // Fetch reference price from orderbook (bestAsk for buy, bestBid for sell)
      console.log(`📡 [RPC] Fetching reference prices from OrderBook`);
      let startTimePrices = Date.now();
      const bestBid: bigint = await contracts.obView.bestBid();
      const bestAsk: bigint = await contracts.obView.bestAsk();
      const durationPrices = Date.now() - startTimePrices;
      console.log(`✅ [RPC] Reference prices fetched in ${durationPrices}ms`, {
        bestBid: bestBid.toString(),
        bestAsk: bestAsk.toString()
      });
      const isBuy = selectedOption === 'long';
      const referencePrice: bigint = isBuy ? bestAsk : bestBid;

      if (referencePrice === 0n || (isBuy && referencePrice >= ethers.MaxUint256)) {
        throw new Error('No liquidity available for market order');
      }

      // Spot/margin liquidity cross-check: margin market orders cannot fill against spot limit orders
      try {
        if (!isBuy && bestBid > 0n) {
          const lvl: any = await contracts.obView.buyLevels(bestBid);
          const firstId = BigInt(lvl?.firstOrderId ?? 0);
          if (firstId > 0n) {
            const top: any = await contracts.obView.getOrder(firstId);
            if (!top?.isMarginOrder) {
              throw new Error('Cannot mix margin and spot trades. The top buy order is a spot order — cancel any spot orders on this market or use a limit order that does not immediately cross.');
            }
          }
        } else if (isBuy && bestAsk > 0n) {
          const lvl: any = await contracts.obView.sellLevels(bestAsk);
          const firstId = BigInt(lvl?.firstOrderId ?? 0);
          if (firstId > 0n) {
            const top: any = await contracts.obView.getOrder(firstId);
            if (!top?.isMarginOrder) {
              throw new Error('Cannot mix margin and spot trades. The top sell order is a spot order — cancel any spot orders on this market or use a limit order that does not immediately cross.');
            }
          }
        }
      } catch (spotCheckErr: any) {
        if (spotCheckErr?.message?.includes('Cannot mix margin and spot')) throw spotCheckErr;
        console.warn('⚠️ [RPC] Spot liquidity cross-check non-fatal:', spotCheckErr?.message || spotCheckErr);
      }

      // Compute size in wei using precise BigInt math to match contract decimals
      let sizeWei: bigint;
      if (isUsdMode) {
        // amount is in USDC, 6 decimals → sizeWei = (amount6 * 1e18) / referencePrice6
        const amount6 = ethers.parseUnits(String(Number(amount).toFixed(6)), 6);
        if (referencePrice === 0n) throw new Error('Reference price unavailable');
        sizeWei = (amount6 * (10n ** 18n)) / referencePrice;
      } else {
        // amount is in token units → encode directly to 18 decimals
        sizeWei = ethers.parseUnits(String(Number(amount).toFixed(18)), 18);
      }
      if (sizeWei <= 0n) {
        throw new Error('Order size too small for current price; increase amount.');
      }
      const quantity = Number(ethers.formatUnits(sizeWei, 18));
      const refPriceNum = Number(ethers.formatUnits(referencePrice, 6));
      const notionalEstimate = quantity * refPriceNum;
      console.log('Market Order', {
        mode: isUsdMode ? 'USD' : 'UNITS',
        inputAmount: amount,
        sizeWei: sizeWei.toString(),
        quantity,
        refPrice: refPriceNum,
        notionalEstimate,
      });

      // Sanity check: if in token mode and the notional is much larger than the input,
      // the user may have intended USD mode
      if (!isUsdMode && notionalEstimate > amount * 10 && notionalEstimate > 10000) {
        throw new Error(
          `You are in Units mode — entering ${amount} tokens at ~$${refPriceNum.toLocaleString('en-US', { maximumFractionDigits: 2 })} each ` +
          `= ~$${notionalEstimate.toLocaleString('en-US', { maximumFractionDigits: 0 })} notional. ` +
          `If you meant $${amount.toLocaleString('en-US')} USDC, click the "Units/USD" toggle above the amount field to switch to USD mode.`
        );
      }

      if (quantity <= 0) {
        throw new Error('Invalid order quantity. Please enter a valid amount.');
      }
      
      if (currentPrice < 0.01 || currentPrice > 100000) {
        throw new Error('Invalid market price. Please try again when price data is stable.');
      }

      // Compute slippage bps (use UI state)
      const slippageBps = Math.max(SLIPPAGE_MIN_BPS, Math.min(SLIPPAGE_MAX_BPS, Number(maxSlippage || 100))); // clamp 0.1%..100%

      // Pre-trade validation: available collateral vs required (accurate margin bps)
      // Runs before preflight so users see a clear message instead of a cryptic "!balance" revert
      try {
        const userAddr = address as string;
        console.log(`📡 [RPC] Checking available collateral for ${userAddr.slice(0, 6)}...`);
        let startTimeCollateral = Date.now();
        const available: bigint = await contracts.vault.getAvailableCollateral.staticCall(userAddr);
        console.log('Available collateral:', available.toString());
        const durationCollateral = Date.now() - startTimeCollateral;
        const notional6: bigint = (sizeWei * referencePrice) / 10n ** 18n;
        let marginReqBps: bigint = BigInt(marketParams.marginReqBps || 10000);
        const effectiveBps = (selectedOption === 'short') ? (marginReqBps < 15000n ? 15000n : marginReqBps) : marginReqBps;
        const requiredMargin6: bigint = (notional6 * effectiveBps) / 10000n;
        console.log(`✅ [RPC] Collateral check completed in ${durationCollateral}ms`, {
          available: ethers.formatUnits(available, 6),
          required: ethers.formatUnits(requiredMargin6, 6),
          bps: effectiveBps.toString()
        });

        if (available < requiredMargin6) {
          const notionalUsd = Number(ethers.formatUnits(notional6, 6));
          const modeHint = !isUsdMode && notionalUsd > amount * 5
            ? ` You are in Units mode — your ${amount} tokens have a notional value of ~$${notionalUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}. Switch to USD mode if you intended $${amount.toLocaleString('en-US')}.`
            : '';
          throw new Error(
            `Insufficient available collateral. Need $${Number(ethers.formatUnits(requiredMargin6, 6)).toLocaleString('en-US', { maximumFractionDigits: 2 })}, ` +
            `available $${Number(ethers.formatUnits(available, 6)).toLocaleString('en-US', { maximumFractionDigits: 2 })}.${modeHint}`
          );
        }
      } catch (e: any) {
        if (!(e?.message || '').toLowerCase().includes('insufficient')) {
          console.warn('⚠️ [RPC] Collateral check warning:', e?.message || e);
        }
        throw e;
      }

      // Vault ↔ OrderBook configuration check (mirrors gasless route validation)
      try {
        const mktIdHex = (marketRow as any)?.market_id_bytes32 || (marketRow as any)?.market_identifier_bytes32;
        if (mktIdHex) {
          const obAddr = typeof (contracts.obOrderPlacement as any)?.getAddress === 'function'
            ? await (contracts.obOrderPlacement as any).getAddress()
            : ((contracts.obOrderPlacement as any)?.target || (contracts.obOrderPlacement as any)?.address);

          if ((contracts.vault as any)?.marketToOrderBook) {
            const assignedOb = await (contracts.vault as any).marketToOrderBook(mktIdHex);
            if (!assignedOb || String(assignedOb) === ethers.ZeroAddress) {
              console.error('[DIAG][market-order] Vault has no OrderBook assigned for this market', { mktIdHex, vault: (contracts.vault as any)?.target });
              throw new Error('This market is not yet configured in the vault. Please try again later or contact support.');
            }
            if (String(assignedOb).toLowerCase() !== String(obAddr).toLowerCase()) {
              console.error('[DIAG][market-order] OrderBook address mismatch', { assigned: assignedOb, used: obAddr, mktIdHex });
              throw new Error('Market configuration mismatch. The order book address does not match the vault assignment. Please refresh and try again.');
            }
          }

          if ((contracts.vault as any)?.hasRole) {
            const ORDERBOOK_ROLE = ethers.id('ORDERBOOK_ROLE');
            const hasRole = await (contracts.vault as any).hasRole(ORDERBOOK_ROLE, obAddr);
            if (!hasRole) {
              console.warn('[DIAG][market-order] OrderBook may be missing ORDERBOOK_ROLE on env CoreVault (OB may use a different vault internally)', { obAddr });
            }
          }
        }
      } catch (configErr: any) {
        if (configErr?.message?.includes('not yet configured') || configErr?.message?.includes('mismatch')) {
          throw configErr;
        }
        console.warn('⚠️ [RPC] Vault config check non-fatal:', configErr?.message || configErr);
      }

      // Position-aware closing-loss check (mirrors gasless route)
      const mktIdHex = (marketRow as any)?.market_id_bytes32 || (marketRow as any)?.market_identifier_bytes32;
      try {
        if (mktIdHex && (contracts.vault as any)?.getPositionSummary) {
          const posSummary = await (contracts.vault as any).getPositionSummary.staticCall(address, mktIdHex);
          const currentNet = BigInt(posSummary?.[0] ?? 0n);
          const entryPrice = BigInt(posSummary?.[1] ?? 0n);
          const isClosing = (currentNet > 0n && !isBuy) || (currentNet < 0n && isBuy);
          if (isClosing && entryPrice > 0n) {
            const posAbs = currentNet >= 0n ? currentNet : -currentNet;
            const closeAbs = sizeWei > posAbs ? posAbs : sizeWei;
            const execPrice = isBuy ? bestAsk : bestBid;
            if (closeAbs > 0n && execPrice > 0n) {
              let loss6 = 0n;
              if (currentNet > 0n && execPrice < entryPrice) {
                loss6 = (closeAbs * (entryPrice - execPrice)) / 10n ** 18n;
              } else if (currentNet < 0n && execPrice > entryPrice) {
                loss6 = (closeAbs * (execPrice - entryPrice)) / 10n ** 18n;
              }
              if (loss6 > 0n) {
                const marginBpsClose = currentNet > 0n ? BigInt(marketParams.marginReqBps || 10000) : 15000n;
                const notionalEntry6 = (closeAbs * entryPrice) / 10n ** 18n;
                const released6 = (notionalEntry6 * marginBpsClose) / 10000n;
                console.log('[DIAG][market-order] closing-loss precheck', {
                  currentNet: currentNet.toString(), entryPrice: entryPrice.toString(),
                  execPrice: execPrice.toString(), loss6: loss6.toString(), released6: released6.toString(),
                });
                if (loss6 > released6) {
                  throw new Error(
                    'Closing this position at the current price would realize more loss than the locked margin. ' +
                    'Reduce the close size or add collateral, then try again.'
                  );
                }
              }
            }
          }
        }
      } catch (posErr: any) {
        if (posErr?.message?.includes('Closing this position')) throw posErr;
        console.warn('⚠️ [RPC] Position closing-loss check non-fatal:', posErr?.message || posErr);
      }

      // Preflight static call to surface revert reasons early
      const signerAddr = await signer.getAddress();
      const mktObAddress = marketRow.market_address || await (contracts.obOrderPlacement as any)?.getAddress?.();
      try {
        console.log(`📡 [RPC] Running preflight static call for market order (from: ${signerAddr.slice(0, 6)}...)`);
        let startTimePreflight = Date.now();
        // Use server-side read provider for preflight to avoid wallet RPC mismatches
        const mktReadProvider = getReadProvider();
        const obReadContractMkt = new ethers.Contract(mktObAddress, OBOrderPlacementFacetABI, mktReadProvider);
        await obReadContractMkt.placeMarginMarketOrderWithSlippage.staticCall(
          sizeWei,
          isBuy,
          slippageBps,
          { from: signerAddr }
        );
        const durationPreflight = Date.now() - startTimePreflight;
        console.log(`✅ [RPC] Preflight check passed in ${durationPreflight}ms`);
      } catch (preflightErr: any) {
        // Comprehensive vault diagnostics for preflight failures
        let diagAvailable: bigint | null = null;
        let diagPositionCount: number | null = null;
        let diagTotalMarginUsed: bigint | null = null;
        let diagUserCollateral: bigint | null = null;
        let diagUnifiedSummary: any = null;
        let diagPosition: { size: string; entry: string } | null = null;
        let diagZeroSizePositions = 0;
        try {
          const obAddr = typeof (contracts.obOrderPlacement as any)?.getAddress === 'function'
            ? await (contracts.obOrderPlacement as any).getAddress()
            : ((contracts.obOrderPlacement as any)?.target || (contracts.obOrderPlacement as any)?.address);

          // Parallel vault reads for speed
          const [avail, posCount, marginUsed, collateral, unified, posSummary] = await Promise.allSettled([
            contracts.vault.getAvailableCollateral.staticCall(signerAddr),
            (contracts.vault as any).getUserPositionCount?.(signerAddr),
            (contracts.vault as any).getTotalMarginUsed?.staticCall?.(signerAddr),
            (contracts.vault as any).userCollateral?.(signerAddr),
            (contracts.vault as any).getUnifiedMarginSummary?.staticCall?.(signerAddr),
            mktIdHex ? (contracts.vault as any).getPositionSummary?.staticCall?.(signerAddr, mktIdHex) : Promise.resolve(null),
          ]);

          diagAvailable = avail.status === 'fulfilled' ? BigInt(avail.value ?? 0) : null;
          diagPositionCount = posCount.status === 'fulfilled' ? Number(posCount.value ?? 0) : null;
          diagTotalMarginUsed = marginUsed.status === 'fulfilled' ? BigInt(marginUsed.value ?? 0) : null;
          diagUserCollateral = collateral.status === 'fulfilled' ? BigInt(collateral.value ?? 0) : null;
          if (unified.status === 'fulfilled' && unified.value) {
            const u = unified.value;
            diagUnifiedSummary = {
              totalCollateral: u[0]?.toString(),
              marginUsedInPositions: u[1]?.toString(),
              marginReservedForOrders: u[2]?.toString(),
              availableMargin: u[3]?.toString(),
              realizedPnL: u[4]?.toString(),
              unrealizedPnL: u[5]?.toString(),
              totalCommitted: u[6]?.toString(),
              isHealthy: u[7],
            };
          }
          if (posSummary.status === 'fulfilled' && posSummary.value) {
            const ps = posSummary.value;
            diagPosition = { size: BigInt(ps[0] ?? 0).toString(), entry: BigInt(ps[1] ?? 0).toString() };
          }

          // Count zero-size positions (stale entries that bloat the array)
          if (diagPositionCount !== null && diagPositionCount > 5) {
            try {
              const positions = await contracts.vault.getUserPositions(signerAddr);
              if (Array.isArray(positions)) {
                diagZeroSizePositions = positions.filter((p: any) => BigInt(p?.size ?? 0) === 0n).length;
              }
            } catch {}
          }

          console.warn('[DIAG][market-preflight] FULL VAULT DIAGNOSTICS', {
            orderBookAddress: obAddr,
            signerAddress: signerAddr,
            uiAddress: address,
            addressMatch: signerAddr.toLowerCase() === (address || '').toLowerCase(),
            userCollateralRaw: diagUserCollateral?.toString(),
            userCollateralUSD: diagUserCollateral ? ethers.formatUnits(diagUserCollateral, 6) : null,
            availableCollateralUSD: diagAvailable ? ethers.formatUnits(diagAvailable, 6) : null,
            totalMarginUsedUSD: diagTotalMarginUsed ? ethers.formatUnits(diagTotalMarginUsed, 6) : null,
            positionCount: diagPositionCount,
            zeroSizePositions: diagZeroSizePositions,
            unifiedSummary: diagUnifiedSummary,
            existingPositionOnThisMarket: diagPosition,
            order: { sizeWei: sizeWei.toString(), isBuy, slippageBps },
            book: { bestBid: bestBid.toString(), bestAsk: bestAsk.toString() },
            marketIdBytes32: mktIdHex || 'unknown',
            revertReason: preflightErr?.reason || preflightErr?.shortMessage || preflightErr?.message,
          });
        } catch (diagErr) {
          console.warn('[DIAG][market-preflight] logging failed', diagErr);
        }
        // Use console.warn (not console.error) to avoid triggering Next.js dev error overlay
        console.warn(`⚠️ [RPC] Preflight check failed:`, preflightErr?.reason || preflightErr?.shortMessage || preflightErr?.message);
        const reason = preflightErr?.reason || preflightErr?.message || '';
        const mktRevertData = preflightErr?.data || preflightErr?.error?.data || '';
        // AccessControlUnauthorizedAccount(address,bytes32) selector = 0xe2517d3f
        if (typeof mktRevertData === 'string' && mktRevertData.startsWith('0xe2517d3f')) {
          throw new Error('This market\'s order book is not authorized by the vault (missing ORDERBOOK_ROLE). Please run market configuration or contact support.');
        }
        if (reason.includes('!balance')) {
          const notional6 = (sizeWei * referencePrice) / 10n ** 18n;
          const marginNeeded6 = (notional6 * 15000n) / 10000n;
          if (diagAvailable !== null && diagAvailable > marginNeeded6 * 2n) {
            // User has ample collateral — skip the preflight block and continue to gasless execution.
            console.warn(
              `⚠️ [RPC] Preflight !balance but user has ample collateral (available: $${ethers.formatUnits(diagAvailable, 6)}, ` +
              `needed: $${ethers.formatUnits(marginNeeded6, 6)}, userCollateralRaw: ${diagUserCollateral?.toString() ?? '?'}). ` +
              `Continuing to gasless execution path.`
            );
          } else {
            throw new Error('Insufficient available collateral. Please deposit more USDC using the "Deposit" button in the header.');
          }
        } else if (preflightErr?.code === 'BAD_DATA' || reason.includes('could not decode result data')) {
          throw new Error('OrderBook contract is not available for this market. The contract may not be deployed or the facet is not registered.');
        } else if (reason.includes('OB: settled')) {
          throw new Error('This market has been settled and is no longer accepting orders.');
        } else if (reason.includes('challenge window')) {
          throw new Error('Trading is paused during the settlement challenge window.');
        } else if (reason.includes('OB: leverage off')) {
          throw new Error('Margin trading is not enabled for this market.');
        } else {
          throw preflightErr;
        }
      }

      // Execute market order with slippage protection using default provider estimation
      const mktOverrides: any = {};
      // Pre-send native balance check to avoid -32603 from insufficient gas funds
      try {
        const provider: any = (contracts.obOrderPlacement as any)?.runner?.provider || (contracts.obOrderPlacement as any)?.provider;
        const fromAddr = await signer.getAddress();
        const feeData = await provider.getFeeData();
        const gasPrice: bigint = (feeData?.maxFeePerGas ?? feeData?.gasPrice ?? 0n) as bigint;
        const estGas: bigint = (mktOverrides?.gasLimit as bigint) || 0n;
        if (gasPrice > 0n && estGas > 0n) {
          const needed = gasPrice * estGas;
          const balance = await provider.getBalance(fromAddr);
          if (balance < needed) {
            throw new Error(`Insufficient native balance for gas. Needed ~${ethers.formatEther(needed)} ETH, have ${ethers.formatEther(balance)}.`);
          }
        }
      } catch (balErr: any) {
        console.warn('⚠️ [RPC] Gas funds check warning:', balErr?.message || balErr);
      }

      // [GASLESS] toggle and OB address log
      const GASLESS_ENABLED = process.env.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
      let obAddrForGasless: string | undefined;
      try {
        obAddrForGasless = typeof (contracts.obOrderPlacement as any)?.getAddress === 'function'
          ? await (contracts.obOrderPlacement as any).getAddress()
          : ((contracts.obOrderPlacement as any)?.target || (contracts.obOrderPlacement as any)?.address);
      } catch {}
      console.log('[GASLESS] Env:', { NEXT_PUBLIC_GASLESS_ENABLED: (process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED });
      console.log('[GASLESS] OB address:', obAddrForGasless || (marketRow as any)?.market_address);

      // Gasless first (uses session-based sign-once). If enabled and a session is active, do NOT fall back to on-chain
      if (GASLESS_ENABLED && obAddrForGasless && address) {
        const activeSessionId =
          globalSessionId ||
          (typeof window !== 'undefined'
            ? (window.localStorage.getItem(`gasless:session:${address}`) || '')
            : '');

        if (!activeSessionId || globalSessionActive !== true) {
          showError('Trading session is not enabled. Click Enable Trading before placing market orders.', 'Session Required');
          markOrderFillError();
          return;
        }

        try {
          console.log('[UpGas][UI] market submit: using active session', { sessionId: activeSessionId });

          // Optimistic UI update: simulate trade immediately for instant feedback
          // Use `quantity` (token units) not `amount` (which may be USD)
          const estimatedPrice = isBuy ? (md.bestAsk || md.markPrice || 0) : (md.bestBid || md.markPrice || 0);
          const optimisticStartTime = Date.now();
          console.log('[OptimisticUI] Pre-check:', { 
            estimatedPrice, 
            hasSimulateFunc: !!md.simulateOptimisticTrade, 
            quantity,
            willSimulate: estimatedPrice > 0 && !!md.simulateOptimisticTrade && quantity > 0,
            timestamp: optimisticStartTime,
          });
          if (estimatedPrice > 0 && md.simulateOptimisticTrade && quantity > 0) {
            const optResult = md.simulateOptimisticTrade(isBuy ? 'buy' : 'sell', 'market', estimatedPrice, quantity);
            // Record this as a taker trade to avoid double-counting when event arrives
            if (md.recordTakerTrade) {
              md.recordTakerTrade(estimatedPrice);
            }
            console.log('[OptimisticUI] Market order simulated:', optResult, { 
              inputAmount: amount, 
              tokenQuantity: quantity, 
              isUsdMode,
              elapsedMs: Date.now() - optimisticStartTime,
            });
          }

            const r = await submitSessionTrade({
              method: 'sessionPlaceMarginMarket',
              orderBook: obAddrForGasless!,
            sessionId: activeSessionId,
              trader: address as string,
              amountWei: sizeWei as unknown as bigint,
              isBuy,
            });
          if (!r.success) {
            const msg = r.error || 'Gasless market order failed';
            if (isSessionErrorMessage(msg)) {
              console.warn('[GASLESS] session error during market submit; clearing session', msg);
              clearSession();
              showError(msg || 'Trading session expired. Click Enable Trading to re-enable gasless trading.', 'Session Error');
            } else {
              showError(msg, 'Gasless Error');
            }
            markOrderFillError();
            return;
          }
          const txHash = r.txHash || null;
          try {
            console.log('[UpGas][UI] market gas estimate', {
              estimatedGas: (r as any)?.estimatedGas,
              estimatedGasBuffered: (r as any)?.estimatedGasBuffered,
              routedPool: (r as any)?.routedPool,
              estimatedFromAddress: (r as any)?.estimatedFromAddress,
            });
          } catch {}
          const mined = Boolean((r as any)?.mined);
          const pending = Boolean((r as any)?.pending);
          const slow = markOrderAsSlowBackgroundable({ kind: 'market', routedPool: (r as any)?.routedPool, reroutedToBig: (r as any)?.reroutedToBig });
          // Success popup modal removed for order placement (replaced by fill modal UX)
          console.log('[Dispatch] ✅ [GASLESS][SESSION] Market order relayed', { txHash });
          console.log('[UpGas][UI] market submit: success', { txHash });
          try {
            if (typeof window !== 'undefined' && txHash) {
              const now = Date.now();
              // Trigger immediate Order History refresh (Supabase write happens server-side before this returns)
              window.dispatchEvent(new CustomEvent('orderHistoryRefreshRequested', { detail: { trader: address, txHash, timestamp: now } }));
              // Also reuse existing realtime plumbing (open orders/history listeners)
              // Include price so lightweight order book overlay can update
              const estimatedPriceForEvent = isBuy ? (md.bestAsk || md.markPrice || 0) : (md.bestBid || md.markPrice || 0);
              window.dispatchEvent(new CustomEvent('ordersUpdated', {
                detail: {
                  traceId: `gasless:${txHash}`,
                  symbol: String(metricId || '').toUpperCase(),
                  trader: address,
                  txHash,
                  timestamp: now,
                  eventType: 'order-placed',
                  orderId: `tx:${txHash}`,
                  price: BigInt(Math.round(estimatedPriceForEvent * 1e6)).toString(),
                  amount: (sizeWei as unknown as bigint)?.toString?.(),
                  isBuy,
                  isMarginOrder: true,
                  isMarketOrder: true,
                  orderType: 'MARKET',
                }
              }));
            }
          } catch {}
          await refreshOrders();
          setAmount(0);
          setAmountInput('');
          setOrderFillModal((cur) => ({ ...cur, status: mined ? 'success' : 'processing' }));
          if (mined) {
            finishOrderFillModal();
          } else {
            window.setTimeout(() => finishOrderFillModal(), slow ? 5000 : 1400);
          }
          return;
        } catch (gerr: any) {
          console.warn('[GASLESS] Market order gasless path failed:', gerr?.message || gerr);
          console.warn('[UpGas][UI] market submit: error', gerr?.message || gerr);
          const msg = gerr?.message || 'Gasless market order failed';
          if (isSessionErrorMessage(msg)) {
            clearSession();
            showError(msg || 'Trading session expired. Click Enable Trading to re-enable gasless trading.', 'Session Error');
          } else {
            showError(msg, 'Gasless Error');
          }
          markOrderFillError();
          return;
        }
      }

      console.log(`📡 [RPC] Submitting market order transaction`);
      let startTimeTx = Date.now();
      let tx;
      tx = await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage(
        sizeWei,
        isBuy,
        slippageBps,
        mktOverrides
      );
      const durationTx = Date.now() - startTimeTx;
      console.log(`✅ [RPC] Market order transaction submitted in ${durationTx}ms`, { txHash: tx.hash });
      console.log('[Order TX][market] submitted:', tx.hash);
      const receipt = await tx.wait();
      console.log('[Order TX][market] confirmed:', tx.hash);

      // Success popup modal removed for order placement (replaced by fill modal UX)
      
      // Refresh orders after successful placement
      await refreshOrders();
      
      // Clear input fields after successful order
      setAmount(0);
      setAmountInput('');

      finishOrderFillModal();
      
      } catch (error: any) {
      console.error('💥 Market order execution failed:', error);
      
      let errorMessage = 'Order placement failed. Please try again.';
      let errorTitle = 'Order Failed';
      const errorStr = error?.message || error?.toString() || '';
      const lower = (errorStr || '').toLowerCase();
      
      if (lower.includes('insufficient') || lower.includes('!balance')) {
        errorMessage = 'Insufficient collateral. Please deposit more USDC using the "Deposit" button in the header.';
        errorTitle = 'Insufficient Collateral';
      } else if (lower.includes('cancelled') || lower.includes('denied') || lower.includes('user denied')) {
        errorMessage = 'Transaction was cancelled. Please try again if you want to proceed.';
        errorTitle = 'Transaction Cancelled';
      } else if (lower.includes('paused')) {
        errorMessage = 'Trading is currently paused. Please try again later.';
        errorTitle = 'Trading Paused';
      } else if (errorStr.includes('No liquidity')) {
        // Keep case-sensitive check here to match our own thrown error text above
        errorMessage = 'No liquidity available for market order at the moment. Please try a smaller size or later.';
        errorTitle = 'No Liquidity';
      } else if (lower.includes('market not') || lower.includes('not found')) {
        errorMessage = 'Market not available for trading. Please check if the market exists.';
        errorTitle = 'Market Not Available';
      } else if (lower.includes('invalid price') || lower.includes('tick size')) {
        errorMessage = 'Invalid price. Please check the price format and tick size requirements.';
        errorTitle = 'Invalid Price';
      } else if (lower.includes('minimum') || lower.includes('below')) {
        errorMessage = 'Order size below minimum. Please increase the order amount.';
        errorTitle = 'Order Too Small';
      } else if (lower.includes('cannot mix margin and spot trades')) {
        errorMessage =
          'Cannot execute a margin trade against spot-only liquidity at the top of the book. Cancel any spot orders on this market or place a limit order that does not immediately cross.';
        errorTitle = 'Margin / Spot Liquidity Mismatch';
      } else if (lower.includes('spot trading disabled for futures markets')) {
        errorMessage =
          'Spot trading is disabled for this futures market. Please place your order as a margin trade instead.';
        errorTitle = 'Spot Trading Disabled';
      } else if (lower.includes('not deployed') || lower.includes('not available for this market') || lower.includes('could not decode result data') || error?.code === 'BAD_DATA') {
        errorMessage = 'OrderBook contract is not available. Please check that you are on the correct network.';
        errorTitle = 'Contract Not Found';
      } else if (lower.includes('not authorized') || lower.includes('orderbook_role') || (typeof error?.data === 'string' && error.data.startsWith('0xe2517d3f'))) {
        errorMessage = 'This market\'s order book is not authorized by the vault. The admin needs to grant ORDERBOOK_ROLE.';
        errorTitle = 'Market Not Configured';
      } else if (lower.includes('settled')) {
        errorMessage = 'This market has been settled and is no longer accepting orders.';
        errorTitle = 'Market Settled';
      } else if (lower.includes('leverage off') || lower.includes('margin trading is not enabled')) {
        errorMessage = 'Margin trading is not enabled for this market.';
        errorTitle = 'Margin Not Available';
      }
      
      showError(errorMessage, errorTitle);
      markOrderFillError();
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const executeLimitOrder = async () => {
    if (!selectedOption || orderType !== 'limit') return;
    
    if (!isConnected || !address) {
      showError('Please connect your wallet to place orders.', 'Wallet Required');
      return;
    }
    
    if (triggerPrice <= 0) {
      showError('Please enter a valid limit price.', 'Invalid Price');
      return;
    }
    
    console.log('📋 Creating limit order with OrderBook...');
    clearAllErrors();
    startOrderFillModal('limit');
    setIsSubmittingOrder(true);

    if (typeof window !== 'undefined') {
      const approxSize = isUsdMode && triggerPrice > 0 ? amount / triggerPrice : amount;
      window.dispatchEvent(new CustomEvent('pendingOrderPlaced', {
        detail: {
          id: `pending-${Date.now()}`,
          symbol: String(metricId || '').toUpperCase(),
          side: selectedOption === 'long' ? 'BUY' : 'SELL',
          type: 'LIMIT',
          price: triggerPrice,
          size: approxSize,
          timestamp: Date.now(),
        }
      }));
    }

    try {
      // Calculate size in wei precisely from trigger price and amount
      let sizeWei: bigint;
      if (isUsdMode) {
        const amount6 = ethers.parseUnits(String(Number(amount).toFixed(6)), 6);
        const price6 = ethers.parseUnits(String(Number(triggerPrice).toFixed(6)), 6);
        if (price6 === 0n) throw new Error('Invalid limit price');
        sizeWei = (amount6 * (10n ** 18n)) / price6;
      } else {
        sizeWei = ethers.parseUnits(String(Number(amount).toFixed(18)), 18);
      }
      if (sizeWei <= 0n) {
        throw new Error('Order size too small for given price; increase amount.');
      }
      const quantity = Number(ethers.formatUnits(sizeWei, 18));
      
      // Validate order parameters
      if (quantity <= 0) {
        throw new Error('Invalid order quantity. Please enter a valid amount.');
      }
      
      // Prepare signer and contracts for pre-trade checks and placement
      const signer = await ensureHyperliquidWallet();
      
      // Ensure we have the market row data
      if (!marketRow) {
        throw new Error(`Market data not available for ${metricId}`);
      }
      
      // Strictly use the market's own contract addresses
      const contracts = await initializeContracts({ 
        providerOrSigner: signer,
        orderBookAddressOverride: marketRow.market_address || undefined,
        marketIdentifier: marketRow.market_identifier || undefined,
        marketSymbol: marketRow.symbol || undefined,
        network: marketRow.network || undefined,
        chainId: marketRow.chain_id,
        marketIdBytes32: (marketRow as any)?.market_id_bytes32 || (marketRow as any)?.market_identifier_bytes32 || undefined
      });

      // Parse amounts to on-chain units (price: 6 decimals USDC, size: 18 decimals)
      const priceWei = ethers.parseUnits(String(Number(triggerPrice).toFixed(6)), 6);

      // Resolve OB address for code check and preflight
      const obAddress = marketRow.market_address || await (contracts.obOrderPlacement as any)?.getAddress?.();

      // Sanity check: ensure OB contract code exists using server-side RPC (reliable)
      const readProvider = getReadProvider();
      try {
        if (obAddress) {
          const code = await readProvider.getCode(obAddress);
          if (!code || code === '0x') {
            throw new Error('OrderBook contract not deployed at ' + obAddress + '. Please switch to the correct network or check the market configuration.');
          }
        }
      } catch (addrErr: any) {
        const msg = addrErr?.message || '';
        if (msg.includes('not deployed') || msg.includes('OrderBook contract')) {
          throw addrErr;
        }
        console.warn('⚠️ [RPC] OrderBook code check warning:', msg || addrErr);
      }

      // Vault ↔ OrderBook role check (advisory — OB may use a different vault than env's CoreVault)
      try {
        if ((contracts.vault as any)?.hasRole && obAddress) {
          const OB_ROLE = ethers.id('ORDERBOOK_ROLE');
          const hasRole = await (contracts.vault as any).hasRole(OB_ROLE, obAddress);
          if (!hasRole) {
            console.warn('[DIAG][limit-order] OrderBook may be missing ORDERBOOK_ROLE on env CoreVault (OB may use a different vault internally)', { obAddress });
          }
        }
      } catch (roleErr: any) {
        console.warn('⚠️ [RPC] Role check warning:', roleErr?.message || roleErr);
      }

      // Determine available placement function via preflight BEFORE collateral checks
      const isBuy = selectedOption === 'long';
      const signerAddr = await signer.getAddress();
      let placeFn: 'placeMarginLimitOrder' | 'placeLimitOrder' = 'placeMarginLimitOrder';
      try {
        console.log(`📡 [RPC] Running preflight static call for limit order (margin)`);
        let startTimePreflight = Date.now();
        // Use server-side read provider for preflight to avoid wallet RPC mismatches
        const obReadContract = new ethers.Contract(obAddress, OBOrderPlacementFacetABI, readProvider);
        await obReadContract.placeMarginLimitOrder.staticCall(
          priceWei,
          sizeWei,
          isBuy,
          { from: signerAddr }
        );
        const durationPreflight = Date.now() - startTimePreflight;
        console.log(`✅ [RPC] Preflight (margin) passed in ${durationPreflight}ms`);
      } catch (preflightErr: any) {
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
          console.error('[DIAG][limit-preflight] address and network diagnostics', {
            orderBookAddressOverride: (marketRow as any)?.market_address,
            obOrderPlacement: obAddr,
            obView: obViewAddr,
            coreVault: (contracts.vault as any)?.target || (contracts.vault as any)?.address,
            coreVaultMappedOB: mapped,
            chainId: (net && (net.chainId?.toString?.() || net.chainId)) || 'unknown',
            obCodeLength: (code || '').length
          });
        } catch (diagErr) {
          console.warn('[DIAG][limit-preflight] logging failed', diagErr);
        }
        const msg = preflightErr?.reason || preflightErr?.message || preflightErr?.shortMessage || '';
        const revertData = preflightErr?.data || preflightErr?.error?.data || '';
        console.error(`❌ [RPC] Preflight check failed:`, preflightErr);
        // AccessControlUnauthorizedAccount(address,bytes32) selector = 0xe2517d3f
        if (typeof revertData === 'string' && revertData.startsWith('0xe2517d3f')) {
          throw new Error('This market\'s order book is not authorized by the vault (missing ORDERBOOK_ROLE). Please run market configuration or contact support.');
        }
        if (msg.includes('!balance')) {
          throw new Error('Insufficient available collateral. Please deposit more USDC using the "Deposit" button in the header.');
        }
        if (preflightErr?.code === 'BAD_DATA' || msg.includes('could not decode result data')) {
          throw new Error('OrderBook contract is not available for this market. The contract may not be deployed or the facet is not registered. Please check the market configuration.');
        }
        if (msg.includes('OB: settled')) {
          throw new Error('This market has been settled and is no longer accepting orders.');
        }
        if (msg.includes('challenge window')) {
          throw new Error('Trading is paused during the settlement challenge window.');
        }
        if (msg.includes('OB: leverage off')) {
          throw new Error('Margin trading is not enabled for this market.');
        }
        throw preflightErr;
      }

      // Collateral check only for margin limit orders; compute accurate required margin using on-chain bps
      if (placeFn === 'placeMarginLimitOrder') {
        try {
          const userAddr = address as string;
          console.log(`📡 [RPC] Checking available collateral for ${userAddr.slice(0, 6)}...`);
          let startTimeCollateral = Date.now();
          const available: bigint = await contracts.vault.getAvailableCollateral.staticCall(userAddr);
          const durationCollateral = Date.now() - startTimeCollateral;
          // notional in 6 decimals
          const notional6: bigint = (sizeWei * priceWei) / 10n ** 18n;
          let marginReqBps: bigint = BigInt(marketParams.marginReqBps || 10000);
          const effectiveBps = (selectedOption === 'short') ? (marginReqBps < 15000n ? 15000n : marginReqBps) : marginReqBps;
          const requiredMargin6: bigint = (notional6 * effectiveBps) / 10000n;
          console.log(`✅ [RPC] Collateral check completed in ${durationCollateral}ms`, {
            available: ethers.formatUnits(available, 6),
            required: ethers.formatUnits(requiredMargin6, 6),
            bps: effectiveBps.toString()
          });

          if (available < requiredMargin6) {
            throw new Error(`Insufficient available collateral. Need $${ethers.formatUnits(requiredMargin6, 6)}, available $${ethers.formatUnits(available, 6)}.`);
          }
        } catch (e: any) {
          if (!(e?.message || '').toLowerCase().includes('insufficient')) {
            console.warn('⚠️ [RPC] Collateral check warning:', e?.message || e);
          }
          throw e;
        }
      }
      // Use default provider estimation for limit order
      const limOverrides: any = {};
      // Pre-send native balance check to avoid -32603 from insufficient gas funds
      try {
        const provider: any = (contracts.obOrderPlacement as any)?.runner?.provider || (contracts.obOrderPlacement as any)?.provider;
        const fromAddr = await signer.getAddress();
        const feeData = await provider.getFeeData();
        const gasPrice: bigint = (feeData?.maxFeePerGas ?? feeData?.gasPrice ?? 0n) as bigint;
        const estGas: bigint = (limOverrides?.gasLimit as bigint) || 0n;
        if (gasPrice > 0n && estGas > 0n) {
          const needed = gasPrice * estGas;
          const balance = await provider.getBalance(fromAddr);
          if (balance < needed) {
            throw new Error(`Insufficient native balance for gas. Needed ~${ethers.formatEther(needed)} ETH, have ${ethers.formatEther(balance)}.`);
          }
        }
      } catch (balErr: any) {
        console.warn('⚠️ [RPC] Gas funds check warning:', balErr?.message || balErr);
      }

      // [GASLESS] toggle and OB address log
      const GASLESS_ENABLED = process.env.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
      let obAddrForGasless: string | undefined;
      try {
        obAddrForGasless = typeof (contracts.obOrderPlacement as any)?.getAddress === 'function'
          ? await (contracts.obOrderPlacement as any).getAddress()
          : ((contracts.obOrderPlacement as any)?.target || (contracts.obOrderPlacement as any)?.address);
      } catch {}
      console.log('[GASLESS] Env:', { NEXT_PUBLIC_GASLESS_ENABLED: (process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED });
      console.log('[GASLESS] OB address:', obAddrForGasless || (marketRow as any)?.market_address);

      // Gasless first (session-based sign-once). If enabled, do NOT fall back to on-chain
      if (GASLESS_ENABLED && obAddrForGasless && address) {
        try {
          const activeSessionId =
            globalSessionId ||
            (typeof window !== 'undefined'
              ? (window.localStorage.getItem(`gasless:session:${address}`) || '')
              : '');

          if (!activeSessionId || globalSessionActive !== true) {
            showError('Trading session is not enabled. Click Enable Trading before placing limit orders.', 'Session Required');
            markOrderFillError();
            return;
          }

          // Optimistic UI update: add liquidity immediately for limit orders
          // Use `quantity` (token units) not `amount` (which may be USD)
          const limitOptimisticStartTime = Date.now();
          if (triggerPrice > 0 && md.simulateOptimisticTrade && quantity > 0) {
            // For limit orders, we simulate as a limit which will add liquidity if it doesn't cross
            const optResult = md.simulateOptimisticTrade(isBuy ? 'buy' : 'sell', 'limit', triggerPrice, quantity);
            // If the limit order crosses (filledAmount > 0), record as taker trade
            if (optResult.filledAmount > 0 && md.recordTakerTrade) {
              md.recordTakerTrade(triggerPrice);
            }
            console.log('[OptimisticUI] Limit order simulated:', optResult, { 
              inputAmount: amount, 
              tokenQuantity: quantity, 
              isUsdMode,
              elapsedMs: Date.now() - limitOptimisticStartTime,
            });
          }

            const r = await submitSessionTrade({
              method: 'sessionPlaceMarginLimit',
              orderBook: obAddrForGasless!,
            sessionId: activeSessionId,
              trader: address as string,
              priceWei: priceWei as unknown as bigint,
              amountWei: sizeWei as unknown as bigint,
              isBuy,
            });
          if (!r.success) {
            const msg = r.error || 'Gasless limit order failed';
            if (isSessionErrorMessage(msg)) {
              console.warn('[GASLESS] session error during limit submit; clearing session', msg);
              clearSession();
              showError(msg || 'Trading session expired. Click Enable Trading to re-enable gasless trading.', 'Session Error');
            } else {
              showError(msg, 'Gasless Error');
            }
            markOrderFillError();
            return;
          }
          const txHash = r.txHash || null;
          try {
            console.log('[UpGas][UI] limit gas estimate', {
              estimatedGas: (r as any)?.estimatedGas,
              estimatedGasBuffered: (r as any)?.estimatedGasBuffered,
              routedPool: (r as any)?.routedPool,
              estimatedFromAddress: (r as any)?.estimatedFromAddress,
            });
          } catch {}
          const slow = markOrderAsSlowBackgroundable({
            kind: 'limit',
            routedPool: (r as any)?.routedPool,
            reroutedToBig: (r as any)?.reroutedToBig,
          });
          const mined = Boolean((r as any)?.mined);
          const pending = Boolean((r as any)?.pending);
          // Success popup modal removed for order placement (replaced by fill modal UX)
          console.log('[Dispatch] ✅ [GASLESS][SESSION] Limit order relayed', { txHash });
          console.log('[UpGas][UI] limit submit: success', { txHash });
          try {
            if (typeof window !== 'undefined' && txHash) {
              const now = Date.now();
              window.dispatchEvent(new CustomEvent('orderHistoryRefreshRequested', { detail: { trader: address, txHash, timestamp: now } }));
              window.dispatchEvent(new CustomEvent('ordersUpdated', {
                detail: {
                  traceId: `gasless:${txHash}`,
                  symbol: String(metricId || '').toUpperCase(),
                  trader: address,
                  txHash,
                  timestamp: now,
                  eventType: 'order-placed',
                  orderId: `tx:${txHash}`,
                  price: (priceWei as unknown as bigint)?.toString?.(),
                  amount: (sizeWei as unknown as bigint)?.toString?.(),
                  isBuy,
                  isMarginOrder: true,
                }
              }));
            }
          } catch {}
          await refreshOrders();
          setAmount(0);
          setAmountInput('');
          setTriggerPrice(0);
          setTriggerPriceInput("");
          setOrderFillModal((cur) => ({ ...cur, status: mined ? 'success' : 'processing' }));
          window.setTimeout(() => finishOrderFillModal(), slow ? 5000 : (mined ? 750 : 1100));
          return;
        } catch (gerr: any) {
          console.warn('[GASLESS] Limit order gasless path failed:', gerr?.message || gerr);
          console.warn('[UpGas][UI] limit submit: error', gerr?.message || gerr);
          showError(gerr?.message || 'Gasless limit order failed', 'Gasless Error');
          markOrderFillError();
          return;
        }
      }

      console.log(`📡 [RPC] Submitting limit order transaction`);
      let startTimeTx = Date.now();
      let tx;
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
      const durationTx = Date.now() - startTimeTx;
      console.log('[Dispatch] ✅ [RPC] Limit order transaction submitted in', durationTx, 'ms', { txHash: tx.hash });
      console.log('[Dispatch] [Order TX][limit] submitted:', tx.hash);
      const receipt = await tx.wait();
      console.log('[Dispatch] [Order TX][limit] confirmed:', tx.hash);

      // Success popup modal removed for order placement (replaced by fill modal UX)
      
      // Refresh orders after successful placement
      console.log('[Dispatch] 🔄 [UI][TradingPanel] Calling refreshOrders after limit order placement');
      await refreshOrders();
      console.log('[Dispatch] ✅ [UI][TradingPanel] refreshOrders complete');
      
      // Clear input fields after successful order
      setAmount(0);
      setAmountInput('');
      setTriggerPrice(0);
      setTriggerPriceInput("");

      finishOrderFillModal();
      
    } catch (error: any) {
      console.error('❌ Limit order creation failed:', error);
      
      let errorMessage = 'Failed to create limit order. Please try again.';
      let errorTitle = 'Limit Order Failed';
      const errorStr = error?.message || error?.toString() || '';
      
      if (errorStr.includes('insufficient') || errorStr.includes('Insufficient') || errorStr.includes('!balance')) {
        errorMessage = 'Insufficient collateral. Please deposit more USDC using the "Deposit" button in the header.';
        errorTitle = 'Insufficient Collateral';
      } else if (errorStr.includes('cancelled') || errorStr.includes('denied') || errorStr.includes('User denied')) {
        errorMessage = 'Transaction was cancelled. Please try again if you want to proceed.';
        errorTitle = 'Transaction Cancelled';
      } else if (errorStr.includes('Invalid price') || errorStr.includes('tick size')) {
        errorMessage = 'Invalid price. Please check the price format and tick size requirements.';
        errorTitle = 'Invalid Price';
      } else if (errorStr.includes('minimum') || errorStr.includes('below')) {
        errorMessage = 'Order size below minimum. Please increase the order amount.';
        errorTitle = 'Order Too Small';
      } else if (errorStr.includes('paused') || errorStr.includes('challenge window')) {
        errorMessage = 'Trading is currently paused. Please try again later.';
        errorTitle = 'Trading Paused';
      } else if (errorStr.includes('margin configuration') || errorStr.includes('Invalid margin configuration')) {
        errorMessage = 'Trading temporarily unavailable due to margin configuration. Please try again later.';
        errorTitle = 'Invalid Margin Configuration';
      } else if (errorStr.includes('not deployed') || errorStr.includes('not available for this market') || errorStr.includes('could not decode result data') || error?.code === 'BAD_DATA') {
        errorMessage = 'OrderBook contract is not available. Please check that you are on the correct network.';
        errorTitle = 'Contract Not Found';
      } else if (errorStr.includes('not authorized') || errorStr.includes('ORDERBOOK_ROLE') || (typeof error?.data === 'string' && error.data.startsWith('0xe2517d3f'))) {
        errorMessage = 'This market\'s order book is not authorized by the vault. The admin needs to grant ORDERBOOK_ROLE.';
        errorTitle = 'Market Not Configured';
      } else if (errorStr.includes('settled')) {
        errorMessage = 'This market has been settled and is no longer accepting orders.';
        errorTitle = 'Market Settled';
      } else if (errorStr.includes('leverage off') || errorStr.includes('Margin trading is not enabled')) {
        errorMessage = 'Margin trading is not enabled for this market.';
        errorTitle = 'Margin Not Available';
      }
      
      showError(errorMessage, errorTitle);
      markOrderFillError();
    } finally {
      setIsSubmittingOrder(false);
    }
  };
  
  // Handle cancel order
  const handleCancelOrder = async (orderId: string): Promise<boolean> => {
    if (!isConnected || !address) {
      showError('Please connect your wallet to cancel orders.', 'Wallet Required');
      return false;
    }
    
    try {
      startOrderFillModal('cancel');
      // [GASLESS] try session-based gasless cancel first
      const GASLESS_ENABLED = process.env.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
      const obAddrForGasless = (marketRow as any)?.market_address as string | undefined;
      console.log('[GASLESS] Env:', { NEXT_PUBLIC_GASLESS_ENABLED: (process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED });
      console.log('[GASLESS] OB address:', obAddrForGasless);
      if (GASLESS_ENABLED && obAddrForGasless && address) {
        try {
          const activeSessionId =
            globalSessionId ||
            (typeof window !== 'undefined'
              ? (window.localStorage.getItem(`gasless:session:${address}`) || '')
              : '');

          if (!activeSessionId || globalSessionActive !== true) {
            showError('Trading session is not enabled. Click Enable Trading before using gasless cancel.', 'Session Required');
            return false;
          }

          console.log('[UpGas][UI] cancel: using active session', { sessionId: activeSessionId });
            const r = await submitSessionTrade({
              method: 'sessionCancelOrder',
              orderBook: obAddrForGasless!,
            sessionId: activeSessionId,
              trader: address as string,
              orderId: BigInt(orderId) as unknown as bigint,
            });
          if (!r.success) {
            const msg = r.error || 'Gasless cancel failed';
            if (isSessionErrorMessage(msg)) {
              console.warn('[GASLESS] session error during cancel; clearing session', msg);
              clearSession();
              showError(msg || 'Trading session expired. Click Enable Trading to re-enable gasless trading.', 'Session Error');
            } else {
              showError(msg, 'Gasless Error');
            }
            markOrderFillError();
            return false;
          }
          const txHash = r.txHash || null;
          try {
            console.log('[UpGas][UI] cancel gas estimate', {
              estimatedGas: (r as any)?.estimatedGas,
              estimatedGasBuffered: (r as any)?.estimatedGasBuffered,
              routedPool: (r as any)?.routedPool,
              estimatedFromAddress: (r as any)?.estimatedFromAddress,
            });
          } catch {}
          markOrderAsSlowBackgroundable({
            kind: 'cancel',
            routedPool: (r as any)?.routedPool,
            reroutedToBig: (r as any)?.reroutedToBig,
          });
          console.log('[Dispatch] ✅ [GASLESS][SESSION] Cancel relayed', { txHash });
          console.log('[UpGas][UI] cancel: success', { txHash });
          await refreshOrders();
          // Success popup modal removed (replaced by fill modal UX)
          finishOrderFillModal();
          return true;
        } catch (gerr: any) {
          console.warn('[GASLESS] Cancel gasless path failed:', gerr?.message || gerr);
          console.warn('[UpGas][UI] cancel: error', gerr?.message || gerr);
          const msg = gerr?.message || 'Gasless cancel failed';
          if (isSessionErrorMessage(msg)) {
            clearSession();
            showError(msg || 'Trading session expired. Click Enable Trading to re-enable gasless trading.', 'Session Error');
          } else {
            showError(msg, 'Gasless Error');
          }
          markOrderFillError();
          return false;
        }
      }

      const success = await orderBookActions.cancelOrder(orderId);
      
      if (success) {
        await refreshOrders();
        // Success popup modal removed (replaced by fill modal UX)
        finishOrderFillModal();
        return true;
      } else {
        throw new Error('Failed to cancel order');
      }
    } catch (error: any) {
      console.error('Failed to cancel order:', error);
      let errorMessage = 'Failed to cancel order. Please try again.';
      showError(errorMessage, 'Cancellation Failed');
      markOrderFillError();
      return false;
    }
  };

  // (Removed ActiveOrdersSection; active orders are rendered exclusively in the Orders tab)

  // =====================
  // 🎯 EVENT HANDLERS
  // =====================

  const handleLongClick = () => {
    navigateToTab('buy', 'long');
  };

  const handleShortClick = () => {
    navigateToTab('buy', 'short');
  };

  const handleTradeClick = async () => {
    if (!isConnected) {
      await connect();
      return;
    }

    // If gasless is enabled and no active session, create it first instead of trading
    try {
      const GASLESS_ENABLED = process.env.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
      if (GASLESS_ENABLED && address && globalSessionActive === false) {
        // Ensure wallet is actually on the trading chain BEFORE requesting any signature.
        const activeChainId = (wallet?.walletData?.chainId ?? wallet?.chainId) as number | null | undefined;
        if (activeChainId != null && !isOnCorrectChain(activeChainId)) {
          const chainRes = await ensureGaslessChain();
          if (!chainRes.ok) {
            showError(chainRes.error || 'Wrong network. Please switch to Hyperliquid Mainnet and retry.', 'Wrong Network');
            return;
          }
        }
        const created = await globalEnableTrading();
        if (created.success) {
          showSuccess('Trading enabled for your account. You can place orders now.', 'Session Enabled');
          try { await refreshSession(); } catch {}
        } else {
          showError(created.error || 'Failed to enable trading. Please try again.', 'Session Error');
        }
        return;
      }
    } catch (e: any) {
      console.warn('[UpGas][UI] enable trading error', e?.message || e);
      showError(e?.message || 'Failed to enable trading. Please try again.', 'Session Error');
      return;
    }

    if (orderType === 'limit') {
      await executeLimitOrder();
    } else {
      await executeMarketOrder();
    }
  };

  // Position closing not applicable to orderbook system
  // Orders are cancelled rather than positions closed

  // =====================
  // 🔄 EFFECTS
  // =====================

  useEffect(() => {
    if (initialAction) {
      setSelectedOption(initialAction);
      setActiveTab('buy');
      if (initialAction === 'short') {
        setOrderType('limit');
      }
    }
  }, [initialAction]);

  useEffect(() => {
    const event = new CustomEvent('limitTabChange', {
      detail: { isLimitTabActive: orderType === 'limit' }
    });
    window.dispatchEvent(event);
  }, [orderType]);

  // Wallet modal state
  const [showWalletModal, setShowWalletModal] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [showBottomFade, setShowBottomFade] = useState(false);

  const updateBottomFade = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    const next = remaining > 12;
    setShowBottomFade((cur) => (cur === next ? cur : next));
  }, []);

  useEffect(() => {
    updateBottomFade();
  }, [updateBottomFade, activeTab, orderType]);

  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateBottomFade);
    };

    el.addEventListener('scroll', onScroll, { passive: true });

    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateBottomFade())
      : null;
    ro?.observe(el);

    // Initial measurement
    updateBottomFade();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, [updateBottomFade]);

  return (
    <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 flex flex-col min-h-0 h-full">
      {/* Status Modals */}
      <OrderFillLoadingModal
        isOpen={orderFillModal.isOpen}
        progress={orderFillModal.progress}
        status={orderFillModal.status}
        allowClose={orderFillModal.allowClose}
        onClose={() =>
          setOrderFillModal((cur) => ({
            ...cur,
            isOpen: false,
            kind: null,
            headlineText: undefined,
            detailText: undefined,
            showProgressLabel: undefined,
          }))
        }
        headlineText={
          orderFillModal.headlineText ??
          (orderFillModal.kind === 'cancel' ? 'Cancelling order,' : 'Submitting your order,')
        }
        detailText={orderFillModal.detailText}
        showProgressLabel={orderFillModal.showProgressLabel}
      />
      
      {/* Wallet Connection Modal */}
      <WalletModal 
        isOpen={showWalletModal} 
        onClose={() => setShowWalletModal(false)} 
      />

      {/* Slippage Config Modal (portaled to body for true screen-center, matching close/modify modals) */}
      {isSlippageModalOpen && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Adjust max slippage"
          onClick={closeSlippageModal}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          />

          {/* Panel */}
          <div
            className="relative z-10 w-full max-w-md rounded-md border border-t-stroke bg-t-card shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 p-4 border-b border-t-stroke-sub">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                  <h3 className="text-sm font-semibold text-t-fg">Adjust Max Slippage</h3>
                </div>
                <p className="mt-1 text-[10px] text-t-fg-muted leading-relaxed">
                  Max slippage applies to <span className="text-t-fg-label">market orders</span> placed from this panel.
                  Higher values can improve fill likelihood during volatility, but may result in worse execution.
                </p>
              </div>

              <button
                type="button"
                onClick={closeSlippageModal}
                className="p-1 rounded-md hover:bg-t-card-hover text-t-fg-label hover:text-t-fg transition-colors duration-200"
                aria-label="Close"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-t-fg-sub">Max slippage</span>
                <span className="text-[10px] text-t-fg font-mono">{formatSlippagePct(draftMaxSlippage)}</span>
              </div>

              {(() => {
                const pct =
                  ((draftMaxSlippage - SLIPPAGE_MIN_BPS) / (SLIPPAGE_MAX_BPS - SLIPPAGE_MIN_BPS)) * 100;
                const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
                return (
                  <input
                    type="range"
                    min={SLIPPAGE_MIN_BPS}
                    max={SLIPPAGE_MAX_BPS}
                    step="5"
                    value={draftMaxSlippage}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setDraftMaxSlippage(parseInt(getInputValue(e)))
                    }
                    className="w-full appearance-none cursor-pointer slippageRange"
                    style={{
                      background: `linear-gradient(to right, #60A5FA 0%, #60A5FA ${safePct}%, #2A2A2A ${safePct}%, #2A2A2A 100%)`,
                    }}
                  />
                );
              })()}

              <div className="flex justify-between text-[9px] text-t-fg-muted">
                <span>0.1%</span>
                <span>Conservative</span>
                <span>Aggressive</span>
                <span>100%</span>
              </div>

              <div className="text-[9px] text-t-fg-muted">
                Tip: for most markets, <span className="text-t-fg-label">0.5–2%</span> is a good starting range.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-t-stroke-sub bg-t-page">
              <button
                type="button"
                onClick={closeSlippageModal}
                className="px-3 py-2 rounded-md border border-t-stroke bg-t-card hover:bg-t-card-hover hover:border-t-stroke-hover text-[11px] font-medium text-t-fg-label hover:text-t-fg transition-all duration-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSlippageModal}
                className="px-3 py-2 rounded-md bg-[#3B82F6] hover:bg-[#2563EB] text-[11px] font-semibold text-t-fg transition-all duration-200"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      
      <div className="rounded-md bg-t-page border border-t-stroke-hover p-3 h-full flex flex-col overflow-hidden">


        {/* Header section */}
        <div className="mb-2">
          {/* Order Type Toggle - Full Width */}
          <div className="bg-t-card rounded-md border border-t-stroke p-1 w-full">
            <div className="flex w-full gap-1">
              <button
                onClick={() => setOrderType('market')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-green-400/20 ${
                  orderType === 'market'
                    ? 'bg-t-inset text-t-fg'
                    : 'text-t-fg-sub hover:text-[#D1D5DB] hover:bg-[#101010]'
                }`}
                aria-pressed={orderType === 'market'}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    orderType === 'market' ? 'bg-green-400' : 'bg-t-dot'
                  }`}
                />
                Market
              </button>
              <button
                onClick={() => setOrderType('limit')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400/20 ${
                  orderType === 'limit'
                    ? 'bg-t-inset text-t-fg'
                    : 'text-t-fg-sub hover:text-[#D1D5DB] hover:bg-[#101010]'
                }`}
                aria-pressed={orderType === 'limit'}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    orderType === 'limit' ? 'bg-blue-400' : 'bg-t-dot'
                  }`}
                />
                Limit
              </button>
            </div>
          </div>
        </div>

        {/* Trading Content Area - scrollable within the panel to avoid cut-offs on large screens */}
        <div className="relative flex-1 min-h-0">
          <div
            ref={scrollAreaRef}
            className="h-full space-y-1.5 pb-1.5 trading-panel-scroll overflow-y-auto"
          >

          {/* Trading Interface */}

          {/* Long/Short Option Buttons - Sophisticated Design */}
          <div className="space-y-1 mb-2">
            {/* <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-t-fg-label uppercase tracking-wide">Position Direction</h4>
              <div className="text-[10px] text-t-fg-muted bg-t-inset px-1.5 py-0.5 rounded">
                {selectedOption || 'Select'}
              </div>
            </div> */}
            
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedOption('long')}
                className={`group flex-1 bg-t-card hover:bg-t-card-hover rounded-md border transition-all duration-200 ${
                  selectedOption === 'long' 
                    ? 'border-green-400 bg-green-400/10' 
                    : 'border-t-stroke hover:border-t-stroke-hover'
                }`}
              >
                <div className="flex items-center justify-center p-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      selectedOption === 'long' ? 'bg-green-400' : 'bg-t-dot'
                    }`} />
                    <span className={`text-xs font-medium ${
                      selectedOption === 'long' ? 'text-green-400' : 'text-t-fg-sub'
                    }`}>
                      Long
                    </span>
                    {selectedOption === 'long' && (
                      <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
              
              <button
                onClick={() => setSelectedOption('short')}
                className={`group flex-1 bg-t-card hover:bg-t-card-hover rounded-md border transition-all duration-200 ${
                  selectedOption === 'short' 
                    ? 'border-red-400 bg-red-400/10' 
                    : 'border-t-stroke hover:border-t-stroke-hover'
                }`}
              >
                <div className="flex items-center justify-center p-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      selectedOption === 'short' ? 'bg-red-400' : 'bg-t-dot'
                    }`} />
                    <span className={`text-xs font-medium ${
                      selectedOption === 'short' ? 'text-red-400' : 'text-t-fg-sub'
                    }`}>
                      Short
                    </span>
                    {selectedOption === 'short' && (
                      <svg className="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Limit Order Configuration - Sophisticated Design */}
          {orderType === 'limit' && (
            <div className="space-y-1 mb-2">
              {/* <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-t-fg-label uppercase tracking-wide">Limit Order Settings</h4>
                <div className="text-[10px] text-t-fg-muted bg-t-inset px-1.5 py-0.5 rounded">
                  Advanced
                </div>
              </div> */}
              
              {/* Trigger Price Section */}
              <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200">
                <div className="p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${triggerPrice > 0 ? 'bg-blue-400' : 'bg-t-dot'}`} />
                      <span className="text-[11px] font-medium text-t-fg-sub">Limit Price</span>
                    </div>
                    <span className="text-[10px] text-t-fg-muted">USDC</span>
                  </div>
                  <div className="relative">
                    <div className="absolute left-2 top-1/2 transform -translate-y-1/2 text-t-fg-muted text-xs pointer-events-none">$</div>
                    <input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      value={triggerPriceInput}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        // Strip commas before sanitizing
                        const raw = e.target.value.replace(/,/g, '');
                        const value = sanitizeDecimalInput(raw, 8);
                        // Format with commas as user types
                        if (value === '' || value === '.') {
                          setTriggerPriceInput(value);
                          setTriggerPrice(0);
                        } else if (value.includes('.')) {
                          // Handle decimal: format the whole part, keep decimal part as-is
                          const [wholePart, decimalPart] = value.split('.');
                          const formattedWhole = wholePart ? parseInt(wholePart, 10).toLocaleString('en-US') : '0';
                          setTriggerPriceInput(`${formattedWhole}.${decimalPart}`);
                          const parsed = parseFloat(value);
                          setTriggerPrice(Number.isFinite(parsed) ? parsed : 0);
                        } else {
                          // No decimal - format entire number
                          const parsed = parseInt(value, 10);
                          if (!isNaN(parsed)) {
                            setTriggerPriceInput(parsed.toLocaleString('en-US'));
                            setTriggerPrice(parsed);
                          } else {
                            setTriggerPriceInput('');
                            setTriggerPrice(0);
                          }
                        }
                      }}
                      onBlur={() => {
                        const num = parseFloat((triggerPriceInput || '').replace(/,/g, ''));
                        if (Number.isFinite(num) && num > 0) {
                          setTriggerPriceInput(formatPrice(num));
                          setTriggerPrice(num);
                        } else {
                          setTriggerPriceInput('');
                          setTriggerPrice(0);
                        }
                      }}
                      placeholder="0.00"
                      className="w-full bg-t-inset border border-t-stroke-hover rounded px-2 py-1 pl-6 text-xs font-medium text-t-fg placeholder-t-fg-muted focus:outline-none focus:border-blue-400 transition-colors duration-200"
                    />
                  </div>
                </div>
              </div>

              {/* Order Type Section */}
              {/* <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200">
                <div className="p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                      <span className="text-[11px] font-medium text-t-fg-sub">Order Type</span>
                    </div>
                    <span className="text-[10px] text-t-fg-muted">{limitOrderType}</span>
                  </div>
                  <select
                    value={limitOrderType}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setLimitOrderType(getInputValue(e) as typeof limitOrderType)}
                    className="w-full bg-t-inset border border-t-stroke-hover rounded px-2 py-1 text-xs font-medium text-t-fg focus:outline-none focus:border-blue-400 transition-colors duration-200 cursor-pointer"
                  >
                    <option value="LIMIT">Limit Order</option>
                    <option value="MARKET_IF_TOUCHED">Market If Touched</option>
                    <option value="STOP_LOSS">Stop Loss</option>
                    <option value="TAKE_PROFIT">Take Profit</option>
                  </select>
                </div>
              </div> */}

              {/* Order Expiry Section */}
              {/* <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200">
                <div className="p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400" />
                      <span className="text-[11px] font-medium text-t-fg-sub">Order Expires</span>
                    </div>
                    <span className="text-[10px] text-t-fg-muted">
                      {orderExpiry === 1 ? '1h' : orderExpiry === 6 ? '6h' : orderExpiry === 24 ? '1d' : orderExpiry === 72 ? '3d' : '1w'}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {[1, 6, 24, 72, 168].map((hours) => (
                      <button
                        key={hours}
                        onClick={() => setOrderExpiry(hours)}
                        className={`flex-1 py-1.5 px-2 text-[10px] font-medium rounded transition-all duration-200 ${
                          orderExpiry === hours
                            ? 'bg-blue-400 text-black'
                            : 'bg-t-inset text-t-fg-sub hover:text-t-fg-label border border-t-stroke-hover hover:border-[#444444]'
                        }`}
                      >
                        {hours === 1 ? '1h' : hours === 6 ? '6h' : hours === 24 ? '1d' : hours === 72 ? '3d' : '1w'}
                      </button>
                    ))}
                  </div>
                </div>
              </div> */}

              {/* Max Slippage Section */}
              {/* <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200">
                <div className="p-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                      <span className="text-[11px] font-medium text-t-fg-sub">Max Slippage</span>
                    </div>
                    <span className="text-[10px] text-t-fg font-mono">
                      {(maxSlippage / 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="10"
                      max="500"
                      value={maxSlippage}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxSlippage(parseInt(getInputValue(e)))}
                      className="flex-1 h-1 bg-t-skeleton rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div className="flex justify-between text-[8px] text-t-fg-muted mt-1">
                    <span>0.1%</span>
                    <span>Conservative</span>
                    <span>Aggressive</span>
                    <span>5.0%</span>
                  </div>
                </div>
              </div> */}

              {/* Limit Order Summary removed to save vertical space (Order Summary below covers details) */}
            </div>
          )}

          {/* Amount Section */}
          <div>
            <div className="flex items-center justify-between mb-2 cursor-pointer hover:bg-t-card-hover px-2 py-1 rounded-md transition-all duration-200" onClick={() => setIsUsdMode(!isUsdMode)}
                title="Click to switch between USD and Units">
              <h4 className="text-xs font-medium text-t-fg-label uppercase tracking-wide">Position Size</h4>
              <div className="flex items-center gap-1 text-[10px] text-t-fg-muted bg-t-inset px-1.5 py-0.5 rounded hover:bg-t-card-hover transition-all duration-200">
                {isUsdMode ? 'USD' : 'Units'}
                <svg className="w-3 h-3 text-t-fg-label" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
            </div>
            
            {/* Amount Input Container */}
            <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 mb-3">
              <div className="relative">
                <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-t-fg-label text-xl font-bold pointer-events-none">
                  {isUsdMode ? '$' : '#'}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  value={amountInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    // Strip commas before validating
                    const raw = e.target.value.replace(/,/g, '');
                    // Allow only digits and a single decimal point
                    if (/^\d*\.?\d*$/.test(raw)) {
                      // Format with commas as user types
                      if (raw === '' || raw === '.') {
                        setAmountInput(raw);
                        setAmount(0);
                      } else if (raw.includes('.')) {
                        // Handle decimal: format the whole part, keep decimal part as-is
                        const [wholePart, decimalPart] = raw.split('.');
                        const formattedWhole = wholePart ? parseInt(wholePart, 10).toLocaleString('en-US') : '0';
                        setAmountInput(`${formattedWhole}.${decimalPart}`);
                        const parsed = parseFloat(raw);
                        setAmount(!isNaN(parsed) ? parsed : 0);
                      } else {
                        // No decimal - format entire number
                        const parsed = parseInt(raw, 10);
                        if (!isNaN(parsed)) {
                          setAmountInput(parsed.toLocaleString('en-US'));
                          setAmount(parsed);
                        } else {
                          setAmountInput('');
                          setAmount(0);
                        }
                      }
                    }
                  }}
                  onBlur={() => {
                    const num = parseFloat((amountInput || '').replace(/,/g, ''));
                    if (Number.isFinite(num) && num > 0) {
                      setAmountInput(formatAmountInput(num));
                      setAmount(num);
                    } else {
                      setAmountInput('');
                      setAmount(0);
                    }
                  }}
                  placeholder={isUsdMode ? "1,000.00" : "100.00"}
                  className="w-full bg-transparent border-none px-3 py-2.5 pl-8 text-right text-2xl font-bold transition-all duration-150 focus:outline-none focus:ring-0"
                  style={{
                    color: amount > 0 ? '#FFFFFF' : '#6B7280',
                    fontSize: '20px',
                    fontWeight: '700',
                    WebkitAppearance: 'none',
                    MozAppearance: 'textfield',
                    outline: 'none',
                    boxShadow: 'none'
                  }}
                />
              </div>
            </div>

            {/* Quick Amount Buttons - Sophisticated Design */}
            {orderType === 'market' && (
              <div className="space-y-1 mb-2">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-medium text-t-fg-label uppercase tracking-wide">Quick Amounts</h4>
                  <div className="text-[10px] text-t-fg-muted bg-t-inset px-1.5 py-0.5 rounded">
                    USD
                  </div>
                </div>
                
                <div className="flex gap-1">
                                    {quickAmounts.map((value) => (
                      <button
                        key={value}
                        onClick={() => handleQuickAmount(value)}
                        className="group bg-t-card hover:bg-t-card-hover rounded border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 flex-1"
                      >
                      <div className="flex items-center justify-center py-1 px-1">
                          <div className="flex items-center gap-1">
                            <div className="w-1 h-1 rounded-full bg-t-dot group-hover:bg-blue-400" />
                            <span className="text-[9px] font-medium text-t-fg-sub group-hover:text-t-fg-label">
                              +${value >= 1000 ? `${value/1000}K` : value}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  <button
                    onClick={handleMaxAmount}
                    className="group bg-t-card hover:bg-t-card-hover rounded border border-t-stroke hover:border-blue-400 transition-all duration-200"
                  >
                    <div className="flex items-center justify-center py-1 px-2.5">
                      <div className="flex items-center gap-1">
                        <div className="w-1 h-1 rounded-full bg-blue-400" />
                        <span className="text-[10px] font-medium text-blue-400">
                          Max
                        </span>
                      </div>
                    </div>
                  </button>
                </div>

                {/* Discreet slippage control (opens modal) */}
                <div className="flex items-center justify-end pt-1">
                  <button
                    type="button"
                    onClick={openSlippageModal}
                    className="group inline-flex items-center gap-1.5 rounded px-2 py-1 hover:bg-t-card-hover transition-all duration-200"
                    title="Adjust max slippage"
                  >
                    <svg
                      className="w-3 h-3 text-t-fg-muted group-hover:text-t-fg-label transition-colors duration-200"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05a2.2 2.2 0 0 1-1.56 3.76 2.2 2.2 0 0 1-1.56-.64l-.05-.05a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.08 1.65V22a2.2 2.2 0 0 1-4.4 0v-.07a1.8 1.8 0 0 0-1.08-1.65 1.8 1.8 0 0 0-1.98.36l-.05.05A2.2 2.2 0 1 1 2.2 17l.05-.05A1.8 1.8 0 0 0 2.6 15a1.8 1.8 0 0 0-1.65-1.08H.9a2.2 2.2 0 0 1 0-4.4h.07A1.8 1.8 0 0 0 2.7 8.44a1.8 1.8 0 0 0-.36-1.98l-.05-.05A2.2 2.2 0 1 1 5.05 2.64l.05.05a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 8.16 1.4V1.33a2.2 2.2 0 0 1 4.4 0v.07a1.8 1.8 0 0 0 1.08 1.65 1.8 1.8 0 0 0 1.98-.36l.05-.05A2.2 2.2 0 1 1 21.8 7l-.05.05A1.8 1.8 0 0 0 21.44 9a1.8 1.8 0 0 0 1.65 1.08h.07a2.2 2.2 0 0 1 0 4.4h-.07A1.8 1.8 0 0 0 19.4 15Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>

                    <span className="text-[10px] text-t-fg-muted group-hover:text-t-fg-label transition-colors duration-200">
                      Slippage
                    </span>
                    <span className="text-[10px] text-t-fg font-mono whitespace-nowrap">
                      {formatSlippagePct(maxSlippage)}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Advanced Setup removed (leverage disabled) */}

            {/* Order Summary */}
            <div className="mb-1">
                {(() => {
                  const currentPrice = resolveCurrentPrice();
                  const feeBps = orderType === 'limit' ? marketParams.makerFeeBps : marketParams.takerFeeBps;
                  const feeRate = feeBps / 10000;
                  const marginBps = selectedOption === 'short'
                    ? Math.max(marketParams.marginReqBps, 15000)
                    : marketParams.marginReqBps;
                  const marginMultiplier = marginBps / 10000;
                  const marginPct = (marginMultiplier * 100).toFixed(0);
                  const estPrice = orderType === 'limit' ? (triggerPrice > 0 ? triggerPrice : currentPrice) : (quoteState.price > 0 ? quoteState.price : (selectedOption === 'long' && bestAsk > 0 ? bestAsk : (selectedOption === 'short' && bestBid > 0 ? bestBid : currentPrice)));
                  const estUnits = orderType === 'limit'
                    ? (isUsdMode ? (amount > 0 && estPrice > 0 ? amount / estPrice : 0) : amount)
                    : (quoteState.units > 0 ? quoteState.units : (isUsdMode ? (amount > 0 && estPrice > 0 ? amount / estPrice : 0) : amount));
                  const orderValue = orderType === 'limit'
                    ? (isUsdMode ? amount : amount * estPrice)
                    : (quoteState.value > 0 ? quoteState.value : (isUsdMode ? amount : amount * estPrice));
                  const tradingFee = orderValue * feeRate;
                  const marginRequired = orderValue * marginMultiplier;
                  const hasPriceEstimate = estPrice > 0;
                  const hasOrderValueEstimate = orderValue > 0;
                  const hasMarginEstimate = marginRequired > 0;
                  const quoteUnavailable = orderType === 'market' && !quoteState.isLoading && !!quoteState.error && quoteState.error.includes('No liquidity');
                  const liquidationDisplay = selectedOption === 'long'
                    ? 'N/A (100% collateral)'
                    : (computedLiquidationPrice && computedLiquidationPrice > 0
                        ? `$${formatNumber(computedLiquidationPrice)}`
                        : (quoteState.isLoading ? '...' : 'Awaiting quote'));
                  const slippageRate = maxSlippage / 10000;
                  const isBuy = selectedOption === 'long';
                  const worstPrice = hasPriceEstimate
                    ? (isBuy ? estPrice * (1 + slippageRate) : estPrice * (1 - slippageRate))
                    : 0;
                  const estFillAmount = isUsdMode && worstPrice > 0
                    ? amount / worstPrice
                    : estUnits;
                  const estFillAmountBest = estUnits;
                  const notional = (quoteState.value && quoteState.value > 0) ? quoteState.value : (isUsdMode ? amount : amount * currentPrice);
                  const isLoading = quoteState.isLoading;

                  return (
                    <div className="rounded-md border border-t-stroke-sub overflow-hidden">
                      {/* Header */}
                      <div className="flex items-center justify-between px-2.5 py-1.5 bg-t-page border-b border-t-stroke-sub">
                        <span className="text-[10px] font-medium text-t-fg-sub uppercase tracking-wider">Order Summary</span>
                        <span className="text-[9px] font-mono text-t-fg-muted bg-t-elevated border border-t-stroke px-1.5 py-px rounded-full">{orderType.toUpperCase()}</span>
                      </div>

                      {/* Primary: Fill Price + Fill Amount */}
                      <div className="px-2.5 py-1.5 bg-[#0C0C0C] space-y-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10px] text-[#707070]">Est. Fill Price</span>
                          <span className="text-[12px] text-t-fg font-mono font-medium">
                            {isLoading ? '...' : (hasPriceEstimate ? `$${formatNumber(estPrice)}` : '—')}
                            {quoteState.partial && <span className="text-[9px] text-[#F59E0B] ml-1">partial</span>}
                          </span>
                        </div>
                        {hasPriceEstimate && estFillAmountBest > 0 && (
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[10px] text-[#707070]">Est. Fill Amount</span>
                            <span className="text-[12px] text-t-fg font-mono font-medium">
                              {isLoading ? '...' : (
                                isUsdMode && orderType === 'market' && estFillAmount < estFillAmountBest
                                  ? <>{formatNumber(estFillAmount)}<span className="text-t-fg-muted mx-0.5">–</span>{formatNumber(estFillAmountBest)} <span className="text-[9px] text-t-fg-muted font-normal">units</span></>
                                  : <>{formatNumber(estFillAmountBest)} <span className="text-[9px] text-t-fg-muted font-normal">units</span></>
                              )}
                            </span>
                          </div>
                        )}
                        {orderType === 'limit' && (
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[10px] text-[#707070]">Limit Price</span>
                            <span className="text-[12px] text-t-fg font-mono font-medium">{triggerPrice > 0 ? `$${formatNumber(triggerPrice)}` : '—'}</span>
                          </div>
                        )}
                      </div>

                      {quoteUnavailable && (
                        <div className="px-2.5 py-1 bg-[#1A1400] border-y border-[#2A2000]">
                          <span className="text-[9px] text-[#F59E0B]">Order book liquidity unavailable</span>
                        </div>
                      )}

                      {/* Details */}
                      <div className="px-2.5 py-1.5 bg-t-card space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-t-fg-muted">{orderType === 'limit' ? 'Maker Fee' : 'Taker Fee'}</span>
                          <span className="text-[10px] text-t-fg-label font-mono">${formatNumber(notional * feeRate)}<span className="text-t-fg-muted ml-1">({(feeRate * 100).toFixed(2)}%)</span></span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-t-fg-muted">Order Value</span>
                          <span className="text-[10px] text-t-fg-label font-mono">{hasOrderValueEstimate ? `$${formatNumber(orderValue)}` : '—'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-t-fg-muted">Margin <span className="text-t-dot">({marginPct}%)</span></span>
                          <span className="text-[10px] text-t-fg-label font-mono">{hasMarginEstimate ? `$${formatNumber(marginRequired)}` : '—'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-t-fg-muted">Liquidation</span>
                          <span className="text-[10px] text-t-fg-label font-mono">{liquidationDisplay}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>


          </div>
          </div>

          {/* Bottom fade hint (shows when content is cut off) */}
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 right-0 bottom-0 h-12 z-10 bg-gradient-to-b from-[#0A0A0A]/0 via-[#0A0A0A]/70 to-[#0A0A0A] transition-opacity duration-200 ${
              showBottomFade ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </div>

        {/* Trade Button */}
        <div className="flex gap-2 mt-1.5">
          {!isConnected ? (
            <button 
              onClick={() => setShowWalletModal(true)}
              className="flex-1 transition-all duration-150 border-none cursor-pointer rounded-md bg-[#3B82F6] text-t-fg"
              style={{
                padding: '10px',
                fontSize: '16px',
                fontWeight: '600'
              }}
            >
              Connect Wallet
            </button>
          ) : (
            <button 
              onClick={handleTradeClick}
              disabled={(isSubmittingOrder || isCancelingOrder) || (!(process.env.NEXT_PUBLIC_GASLESS_ENABLED === 'true' && address && globalSessionActive === false) && !canExecuteTrade())}
              className="flex-1 transition-all duration-150 border-none cursor-pointer rounded-md"
              style={{
                padding: '10px',
                fontSize: '16px',
                fontWeight: '600',
                backgroundColor: ((isSubmittingOrder || isCancelingOrder) || (!(process.env.NEXT_PUBLIC_GASLESS_ENABLED === 'true' && address && globalSessionActive === false) && !canExecuteTrade())) ? '#1A1A1A' : '#3B82F6',
                color: ((isSubmittingOrder || isCancelingOrder) || (!(process.env.NEXT_PUBLIC_GASLESS_ENABLED === 'true' && address && globalSessionActive === false) && !canExecuteTrade())) ? '#6B7280' : '#FFFFFF',
                cursor: ((isSubmittingOrder || isCancelingOrder) || (!(process.env.NEXT_PUBLIC_GASLESS_ENABLED === 'true' && address && globalSessionActive === false) && !canExecuteTrade())) ? 'not-allowed' : 'pointer'
              }}
            >
              {getTradeButtonText()}
            </button>
          )}
        </div>
      </div>
      
      {/* Custom slider styles (scrollbar uses default browser appearance) */}
      <style jsx>{`
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        
        input[type="number"]:focus,
        input[type="number"] {
          outline: none !important;
          box-shadow: none !important;
          border: none !important;
        }

        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #22C55E;
          cursor: pointer;
        }

        .slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #22C55E;
          cursor: pointer;
          border: none;
        }

        .slippageRange::-webkit-slider-thumb {
          appearance: none;
          height: 14px;
          width: 14px;
          border-radius: 9999px;
          background: #60A5FA; /* blue-400 */
          cursor: pointer;
          border: 2px solid #0F0F0F;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
          margin-top: -5px; /* center thumb on 4px track */
          position: relative;
          z-index: 3;
        }

        .slippageRange::-moz-range-thumb {
          height: 14px;
          width: 14px;
          border-radius: 9999px;
          background: #60A5FA; /* blue-400 */
          cursor: pointer;
          border: 2px solid #0F0F0F;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
          position: relative;
          z-index: 3;
        }

        .slippageRange::-webkit-slider-runnable-track {
          height: 4px;
          background: transparent; /* filled via input background gradient */
          border-radius: 9999px;
          position: relative;
          z-index: 1;
        }

        .slippageRange::-moz-range-track {
          height: 4px;
          background: transparent; /* filled via input background gradient */
          border-radius: 9999px;
          position: relative;
          z-index: 1;
        }

        .slippageRange {
          height: 14px;
          border-radius: 9999px;
          outline: none;
          overflow: visible;
          position: relative;
          z-index: 2;
        }

        .slippageRange:focus {
          box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.18);
        }
      `}</style>
      
      {/* Active orders are shown in the Orders tab only */}
    </div>
  );
} 