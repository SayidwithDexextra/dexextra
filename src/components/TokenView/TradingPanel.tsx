'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TokenData } from '@/types/token';
import { useWallet } from '@/hooks/useWallet';
import { useMarketData } from '@/contexts/MarketDataContext';
import { useMarginSummary } from '@/hooks/useMarginSummary';
import { usePortfolioData, type PortfolioOrdersBucket } from '@/hooks/usePortfolioData';
import type { OrderBookOrder } from '@/hooks/useOrderBook';
import { ErrorModal, SuccessModal } from '@/components/StatusModals';
import { formatEther, parseEther } from 'viem';
import { ethers } from 'ethers';
import { initializeContracts } from '@/lib/contracts';
// Removed gas override utilities to rely on provider estimation
import { ensureHyperliquidWallet } from '@/lib/network';
import type { Address } from 'viem';
import { submitSessionTrade, isSessionErrorMessage } from '@/lib/gasless';
import { useSession } from '@/contexts/SessionContext';
import WalletModal from '@/components/WalletModal';

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
    error: orderBookError
  } = orderBookState;

  // Extract actions from orderBookActions
  const {
    placeMarketOrder,
    placeLimitOrder,
    cancelOrder,
    refreshOrders: refreshOrderBookData,
    getOrderBookDepth
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

  // Trading validation
  const canPlaceOrder = useCallback(() => {
    return isConnected && !orderBookLoading && !isSubmittingOrder;
  }, [isConnected, orderBookLoading, isSubmittingOrder]);

  // Clear any trading errors
  const clearTradingError = useCallback(() => {
    setErrorModal({ isOpen: false, title: '', message: '' });
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
  const [isContractInfoExpanded, setIsContractInfoExpanded] = useState(false);
  const [successModal, setSuccessModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });

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
    setSuccessModal({ isOpen: false, title: '', message: '' });
    setErrorModal({ isOpen: false, title: '', message: '' });
  };

  const showSuccess = (message: string, title: string = 'Success') => {
    setSuccessModal({ isOpen: true, title, message });
  };

  const showError = (message: string, title: string = 'Error') => {
    setErrorModal({ isOpen: true, title, message });
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
      setAmountInput(String(next));
      return next;
    });
  };

  const handleMaxAmount = () => {
    // Use margin summary for max amount
    const maxAmount = Math.max(marginSummary.availableCollateral, 50000); // $50K default or available collateral
    if (isUsdMode) {
      setAmount(maxAmount);
      setAmountInput(String(maxAmount));
    } else {
      const currentPrice = resolveCurrentPrice();
      const next = maxAmount / currentPrice;
      setAmount(next);
      setAmountInput(String(next));
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
    collateralRatio?: number; // initial margin multiplier (e.g. 1.5 = 150%)
    mmr?: number; // maintenance margin requirement (e.g. 0.2 = 20%)
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
      // Formula for short positions
      // P_liq = ((collateralRatio + 1) * entryPrice) / (1 + mmr)
      return ((collateralRatio + 1) * entryPrice) / (1 + mmr);
    } else if (positionType === 'long') {
      // Longs require 100% collateral, so no liquidation price
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

    // Use fixed collateralRatio and mmr as specified
    const collateralRatio = 1.5; // 150%
    const mmr = 0.2; // 20%

    const price = calculateLiquidationPrice({
      positionType: selectedOption,
      entryPrice,
      collateralRatio,
      mmr
    });

    if (!price || !isFinite(price) || price <= 0) return null;
    return Number(price.toFixed(6));
  }, [selectedOption, effectiveEntryPrice]);

  // =====================
  // 🧮 QUOTE COMPUTATION (depth-aware)
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
      // Market orders: aggregate across depth
      try {
        setQuoteState(prev => ({ ...prev, isLoading: true, error: null }));
        const depth = await getOrderBookDepth(20);
        const asks = (depth.asks || []).filter(l => (l.price > 0 && l.size > 0)).sort((a, b) => a.price - b.price);
        const bids = (depth.bids || []).filter(l => (l.price > 0 && l.size > 0)).sort((a, b) => b.price - a.price);
        const book = selectedOption === 'long' ? asks : bids;
        if (!book || book.length === 0) {
          setQuoteState({ isLoading: false, price: 0, units: 0, value: 0, partial: false, levelsUsed: 0, error: 'No liquidity', topPrice: undefined, topSize: undefined, side: selectedOption === 'long' ? 'ask' : 'bid' });
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
          const levelSize = level.size; // units available at this level
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
        if (!cancelled) setQuoteState({ isLoading: false, price: avgPrice, units: totalUnits, value: totalCost, partial, levelsUsed, error: null, topPrice, topSize, side: selectedOption === 'long' ? 'ask' : 'bid' });
      } catch (e: any) {
        if (!cancelled) setQuoteState({ isLoading: false, price: 0, units: 0, value: 0, partial: false, levelsUsed: 0, error: e?.message || 'Failed to fetch order book', topPrice: undefined, topSize: undefined, side: selectedOption === 'long' ? 'ask' : 'bid' });
      }
    };
    computeQuote();
    return () => { cancelled = true; };
  }, [amount, isUsdMode, orderType, selectedOption, triggerPrice, bestBid, bestAsk, getOrderBookDepth]);

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
    if (!isConnected) return 'Connect Wallet';
    if (orderBookLoading) return 'Loading...';
    if (isSubmittingOrder) return 'Submitting Order...';
    if (isCancelingOrder) return 'Canceling Order...';
    // Gasless session: prompt to enable trading when session is not active
    const GASLESS_ENABLED = (process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
    if (GASLESS_ENABLED && address && globalSessionActive === false) return 'Enable Trading';
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
    setErrorModal({ isOpen: false, title: '', message: '' });
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
    setIsSubmittingOrder(true);

    try {
      // Resolve current market price with robust fallbacks
      const currentPrice = resolveCurrentPrice();
      
      if (!currentPrice || currentPrice <= 0) {
        throw new Error('Cannot execute trade: Market price not available. Please wait for price data to load or try refreshing the page.');
      }
      
      // Prepare signer and contracts for on-chain reads/writes
      if (typeof window === 'undefined' || !(window as any).ethereum) {
        throw new Error('No wallet provider available. Please install a wallet.');
      }
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
      console.log('Market Order sizeWei', sizeWei.toString(), 'quantity', quantity);
      // Validate order parameters
      if (quantity <= 0) {
        throw new Error('Invalid order quantity. Please enter a valid amount.');
      }
      
      if (currentPrice < 0.01 || currentPrice > 100000) {
        throw new Error('Invalid market price. Please try again when price data is stable.');
      }

      // Compute slippage bps (use UI state)
      const slippageBps = Math.max(10, Math.min(5000, Number(maxSlippage || 100))); // clamp 0.1%..50%

      // Preflight static call to surface revert reasons early
      try {
        console.log(`📡 [RPC] Running preflight static call for market order`);
        let startTimePreflight = Date.now();
        await contracts.obOrderPlacement.placeMarginMarketOrderWithSlippage.staticCall(
          sizeWei,
          isBuy,
          slippageBps
        );
        const durationPreflight = Date.now() - startTimePreflight;
        console.log(`✅ [RPC] Preflight check passed in ${durationPreflight}ms`);
      } catch (preflightErr) {
        console.error(`❌ [RPC] Preflight check failed:`, preflightErr);
        // Re-throw to let error mapper present a friendly message
        throw preflightErr;
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

      // Pre-trade validation: available collateral vs required (accurate margin bps)
      try {
        const userAddr = address as string;
        console.log(`📡 [RPC] Checking available collateral for ${userAddr.slice(0, 6)}...`);
        let startTimeCollateral = Date.now();
        const available: bigint = await contracts.vault.getAvailableCollateral(userAddr);
        console.log('Available collateral:', available.toString());
        const durationCollateral = Date.now() - startTimeCollateral;
        const notional6: bigint = (sizeWei * referencePrice) / 10n ** 18n;
        let marginReqBps: bigint = 10000n;
        try {
          const levInfo = await (contracts.obView as any).getLeverageInfo?.();
          if (levInfo && levInfo.length >= 3) {
            const mr = BigInt(levInfo[2]?.toString?.() ?? levInfo[2]);
            marginReqBps = mr > 0n ? mr : 10000n;
          }
        } catch {}
        const effectiveBps = (selectedOption === 'short') ? 15000n : marginReqBps;
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
        // If unable to fetch, surface error to user as it likely blocks placement
        if (!(e?.message || '').toLowerCase().includes('insufficient')) {
          console.warn('⚠️ [RPC] Collateral check warning:', e?.message || e);
        }
        // Re-throw to be handled by error mapping below
        throw e;
      }

      // [GASLESS] toggle and OB address log
      const GASLESS_ENABLED = (process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
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
          return;
        }

        try {
          console.log('[UpGas][UI] market submit: using active session', { sessionId: activeSessionId });
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
            return;
          }
          const txHash = r.txHash || null;
          showSuccess(
            `Market ${selectedOption} order placed successfully!`,
            'Order Placed'
          );
          console.log('[Dispatch] ✅ [GASLESS][SESSION] Market order relayed', { txHash });
          console.log('[UpGas][UI] market submit: success', { txHash });
          await refreshOrders();
          setAmount(0);
          setAmountInput('');
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

      showSuccess(
        `Market ${selectedOption} order placed successfully!`,
        'Order Placed'
      );
      
      // Refresh orders after successful placement
      await refreshOrders();
      
      // Clear input fields after successful order
      setAmount(0);
      setAmountInput('');
      
      } catch (error: any) {
      console.error('💥 Market order execution failed:', error);
      
      let errorMessage = 'Order placement failed. Please try again.';
      let errorTitle = 'Order Failed';
      const errorStr = error?.message || error?.toString() || '';
      const lower = (errorStr || '').toLowerCase();
      
      if (lower.includes('insufficient')) {
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
      }
      
      showError(errorMessage, errorTitle);
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
    setIsSubmittingOrder(true);

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
      if (typeof window === 'undefined' || !(window as any).ethereum) {
        throw new Error('No wallet provider available. Please install a wallet.');
      }

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

      // Sanity check: ensure OB contract code exists on-chain for current network
      try {
        const obAddress = await (contracts.obOrderPlacement as any)?.getAddress?.();
        const provider: any = (contracts.obOrderPlacement as any)?.runner?.provider || (contracts.obOrderPlacement as any)?.provider;
        if (provider && obAddress) {
          const code = await provider.getCode(obAddress);
          if (!code || code === '0x') {
            throw new Error('OrderBook not deployed on current network. Please switch networks.');
          }
        }
      } catch (addrErr) {
        console.warn('⚠️ [RPC] OrderBook code check warning:', (addrErr as any)?.message || addrErr);
      }

      // Pre-trade validation: leverage/margin configuration
      // Skip leverage check: not available on current facet build

      // Determine available placement function via preflight BEFORE collateral checks
      const isBuy = selectedOption === 'long';
      let placeFn: 'placeMarginLimitOrder' | 'placeLimitOrder' = 'placeMarginLimitOrder';
      try {
        console.log(`📡 [RPC] Running preflight static call for limit order (margin)`);
        let startTimePreflight = Date.now();
        await contracts.obOrderPlacement.placeMarginLimitOrder.staticCall(
          priceWei,
          sizeWei,
          isBuy
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
        const msg = preflightErr?.message || preflightErr?.shortMessage || '';
        console.error(`❌ [RPC] Preflight check failed:`, preflightErr);
        // Do not fall back to non-margin; limit orders must be supported on this market
        throw preflightErr;
      }

      // Collateral check only for margin limit orders; compute accurate required margin using on-chain bps
      if (placeFn === 'placeMarginLimitOrder') {
        try {
          const userAddr = address as string;
          console.log(`📡 [RPC] Checking available collateral for ${userAddr.slice(0, 6)}...`);
          let startTimeCollateral = Date.now();
          const available: bigint = await contracts.vault.getAvailableCollateral(userAddr);
          const durationCollateral = Date.now() - startTimeCollateral;
          // notional in 6 decimals
          const notional6: bigint = (sizeWei * priceWei) / 10n ** 18n;
          // get leverage/margin requirement bps from view facet
          let marginReqBps: bigint = 10000n;
          try {
            const levInfo = await (contracts.obView as any).getLeverageInfo?.();
            if (levInfo && levInfo.length >= 3) {
              // tuple(enabled, maxLev, marginReqBps, controller)
              const mr = BigInt(levInfo[2]?.toString?.() ?? levInfo[2]);
              marginReqBps = mr > 0n ? mr : 10000n;
            }
          } catch {}
          // shorts require 150% margin
          const effectiveBps = (selectedOption === 'short') ? 15000n : marginReqBps;
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
      const GASLESS_ENABLED = (process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
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
            return;
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
            return;
          }
          const txHash = r.txHash || null;
          showSuccess(
            `Limit ${selectedOption} order placed successfully!`,
            'Order Placed'
          );
          console.log('[Dispatch] ✅ [GASLESS][SESSION] Limit order relayed', { txHash });
          console.log('[UpGas][UI] limit submit: success', { txHash });
          await refreshOrders();
          setAmount(0);
          setAmountInput('');
          setTriggerPrice(0);
          setTriggerPriceInput("");
          return;
        } catch (gerr: any) {
          console.warn('[GASLESS] Limit order gasless path failed:', gerr?.message || gerr);
          console.warn('[UpGas][UI] limit submit: error', gerr?.message || gerr);
          showError(gerr?.message || 'Gasless limit order failed', 'Gasless Error');
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

      showSuccess(
        `Limit ${selectedOption} order placed successfully!`,
        'Order Placed'
      );
      
      // Refresh orders after successful placement
      console.log('[Dispatch] 🔄 [UI][TradingPanel] Calling refreshOrders after limit order placement');
      await refreshOrders();
      console.log('[Dispatch] ✅ [UI][TradingPanel] refreshOrders complete');
      
      // Clear input fields after successful order
      setAmount(0);
      setAmountInput('');
      setTriggerPrice(0);
      setTriggerPriceInput("");
      
    } catch (error: any) {
      console.error('❌ Limit order creation failed:', error);
      
      let errorMessage = 'Failed to create limit order. Please try again.';
      let errorTitle = 'Limit Order Failed';
      const errorStr = error?.message || error?.toString() || '';
      
      if (errorStr.includes('insufficient') || errorStr.includes('Insufficient')) {
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
      } else if (errorStr.includes('paused')) {
        errorMessage = 'Trading is currently paused. Please try again later.';
        errorTitle = 'Trading Paused';
      } else if (errorStr.includes('margin configuration') || errorStr.includes('Invalid margin configuration')) {
        errorMessage = 'Trading temporarily unavailable due to margin configuration. Please try again later.';
        errorTitle = 'Invalid Margin Configuration';
      }
      
      showError(errorMessage, errorTitle);
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
      // [GASLESS] try session-based gasless cancel first
      const GASLESS_ENABLED = (process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
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
            return false;
          }
          const txHash = r.txHash || null;
          console.log('[Dispatch] ✅ [GASLESS][SESSION] Cancel relayed', { txHash });
          console.log('[UpGas][UI] cancel: success', { txHash });
          await refreshOrders();
          showSuccess('Order cancelled successfully', 'Order Cancelled');
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
          return false;
        }
      }

      const success = await orderBookActions.cancelOrder(orderId);
      
      if (success) {
        showSuccess('Order cancelled successfully', 'Order Cancelled');
        await refreshOrders();
        return true;
      } else {
        throw new Error('Failed to cancel order');
      }
    } catch (error: any) {
      console.error('Failed to cancel order:', error);
      let errorMessage = 'Failed to cancel order. Please try again.';
      showError(errorMessage, 'Cancellation Failed');
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
    navigateToTab('sell', 'short');
  };

  const handleTradeClick = async () => {
    if (!isConnected) {
      await connect();
      return;
    }

    // If gasless is enabled and no active session, create it first instead of trading
    try {
      const GASLESS_ENABLED = (process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
      if (GASLESS_ENABLED && address && globalSessionActive === false) {
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
      setActiveTab(initialAction === 'long' ? 'buy' : 'sell');
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

  return (
    <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 flex flex-col min-h-0 h-full">
      {/* Status Modals */}
      <ErrorModal
        isOpen={errorModal.isOpen}
        onClose={() => setErrorModal({ isOpen: false, title: '', message: '' })}
        title={errorModal.title}
        message={errorModal.message}
      />
      
      <SuccessModal
        isOpen={successModal.isOpen}
        onClose={() => setSuccessModal({ isOpen: false, title: '', message: '' })}
        title={successModal.title}
        message={successModal.message}
      />
      
      {/* Wallet Connection Modal */}
      <WalletModal 
        isOpen={showWalletModal} 
        onClose={() => setShowWalletModal(false)} 
      />
      
      <div className="rounded-md bg-[#0A0A0A] border border-[#333333] p-3 h-full flex flex-col overflow-hidden">


        {/* Header section */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('buy')}
              className="transition-all duration-150 outline-none border-none cursor-pointer rounded-md"
              style={{
                padding: '5px 14px',
                fontSize: '14px',
                fontWeight: '600',
                backgroundColor: activeTab === 'buy' ? '#22C55E' : '#2A2A2A',
                color: activeTab === 'buy' ? '#000000' : '#9CA3AF'
              }}
            >
              Buy
            </button>
            <button
              onClick={() => setActiveTab('sell')}
              className="transition-all duration-150 outline-none border-none cursor-pointer rounded-md"
              style={{
                padding: '5px 14px',
                fontSize: '14px',
                fontWeight: '600',
                backgroundColor: activeTab === 'sell' ? '#22C55E' : '#2A2A2A',
                color: activeTab === 'sell' ? '#000000' : '#9CA3AF'
              }}
            >
              Orders
            </button>
          </div>
          
          {/* Order Type Toggle - Compact Design */}
          <div className="bg-[#0F0F0F] rounded-md border border-[#222222] p-0.5">
            <div className="flex">
              <button
                onClick={() => setOrderType('market')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-200 ${
                  orderType === 'market'
                    ? 'bg-[#1A1A1A] text-white'
                    : 'text-[#808080] hover:text-[#9CA3AF]'
                }`}
              >
                <div className={`w-1 h-1 rounded-full ${
                  orderType === 'market' ? 'bg-green-400' : 'bg-[#404040]'
                }`} />
                Market
              </button>
              <button
                onClick={() => setOrderType('limit')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-200 ${
                  orderType === 'limit'
                    ? 'bg-[#1A1A1A] text-white'
                    : 'text-[#808080] hover:text-[#9CA3AF]'
                }`}
              >
                <div className={`w-1 h-1 rounded-full ${
                  orderType === 'limit' ? 'bg-blue-400' : 'bg-[#404040]'
                }`} />
                Limit
              </button>
            </div>
          </div>
        </div>

        {/* Trading Content Area - scrollable within the panel to avoid cut-offs on large screens */}
        <div className="flex-1 space-y-1.5 pb-1.5 trading-panel-scroll overflow-y-auto">
          {/* Sell Tab - Current Positions */}
          {activeTab === 'sell' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-white">Current Positions</h4>
                <button
                  onClick={() => {
                    refreshOrders();
                  }}
                  disabled={ordersLoading}
                  className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                >
                  {ordersLoading ? '⟳ Loading...' : '⟳ Refresh'}
                </button>
              </div>
              
              {/* Filled Orders Summary (Positions) */}
              {!ordersLoading && filledOrdersForThisMarket.length > 0 && (
                <div className="mb-3 p-2 bg-[#1A1A1A] rounded-lg border border-[#333333]">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Filled Orders:</span>
                      <span className="text-white font-medium">{filledOrdersForThisMarket.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Total Volume:</span>
                      <span className="text-white font-medium">
                        ${formatNumber(filledOrdersForThisMarket.reduce((sum, order) => sum + (order.quantity * (order.price || 0)), 0))}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Buy Orders:</span>
                      <span className="text-green-400 font-medium">
                        {filledOrdersForThisMarket.filter(order => order.side === 'buy').length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Sell Orders:</span>
                      <span className="text-red-400 font-medium">
                        {filledOrdersForThisMarket.filter(order => order.side === 'sell').length}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              
              {ordersLoading && (
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Trade History</h4>
                    <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                      •••
                    </div>
                  </div>
                  
                  <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                    <div className="flex items-center justify-between p-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {/* Side indicator - animated for loading */}
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
                        
                        {/* Loading state info */}
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="text-[11px] font-medium text-[#808080]">
                            Loading orders...
                          </span>
                        </div>
                      </div>
                      
                      {/* Status and visual consistency */}
                      <div className="flex items-center gap-2">
                        {/* Animated progress indicator */}
                        <div className="w-8 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 animate-pulse" style={{ width: '60%' }} />
                        </div>
                        
                        {/* Status dot - animated */}
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        
                        {/* Loading icon */}
                        <svg className="w-3 h-3 text-blue-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </div>
                    </div>
                    
                    {/* Expandable details on hover/focus */}
                    <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                      <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                        <div className="text-[9px] pt-1.5">
                          <span className="text-[#606060]">Fetching your trade history and positions...</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {!ordersLoading && filledOrdersForThisMarket.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {/* Section Header */}
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Trade History</h4>
                    <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                      {filledOrdersForThisMarket.length}
                    </div>
                  </div>
                  
                  {/* Trade Items */}
                  {filledOrdersForThisMarket.slice(0, 10).map((order) => (
                    <div key={order.id} className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                      <div className="flex items-center justify-between p-2.5">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {/* Side indicator dot */}
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${order.side === 'buy' ? 'bg-green-400' : 'bg-red-400'}`} />
                          
                          {/* Trade info */}
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className={`text-[11px] font-medium ${order.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                              {order.side.toUpperCase()}
                            </span>
                            <span className="text-[10px] text-[#808080]">
                              {order.quantity.toFixed(4)}
                            </span>
                            <span className="text-[10px] text-[#606060]">
                              @ {order.price ? `$${order.price.toFixed(4)}` : 'MKT'}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {/* Value */}
                          <span className="text-[10px] text-white font-mono">
                            {order.price ? `$${(order.quantity * order.price).toFixed(2)}` : 'PENDING'}
                          </span>
                          
                          {/* Status dot */}
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        </div>
                      </div>
                      
                      {/* Expandable details on hover */}
                      <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                        <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                          <div className="text-[9px] pt-1.5">
                            <span className="text-[#606060]">ID: {order.id.slice(0, 8)}... • {order.timestamp ? new Date(order.timestamp).toLocaleDateString() : 'N/A'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Sell Tab - No Orders Message */}
              {!ordersLoading && filledOrdersForThisMarket.length === 0 && (
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Trade History</h4>
                    <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                      0
                    </div>
                  </div>
                  
                  <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                    <div className="flex items-center justify-between p-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {/* Side indicator */}
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                        
                        {/* Empty state info */}
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="text-[11px] font-medium text-[#808080]">
                            No filled orders for {tokenData.symbol}
                          </span>
                        </div>
                      </div>
                      
                      {/* Status and visual consistency */}
                      <div className="flex items-center gap-2">
                        {/* Status dot */}
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                        
                        {/* Subtle icon */}
                        <svg className="w-3 h-3 text-[#404040]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                    </div>
                    
                    {/* Expandable details on hover/focus */}
                    <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                      <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                        <div className="text-[9px] pt-1.5">
                          <span className="text-[#606060]">Your trade history will appear here after placing orders</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sell Tab - Active Limit Orders */}
          {activeTab === 'sell' && (
            <div className="space-y-1.5 mb-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Active Orders</h4>
                <div className="flex items-center gap-2">
                  <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                    {activeOrders.length}
                  </div>
                  <button
                    onClick={() => {
                      refreshOrders();
                    }}
                    disabled={ordersLoading}
                    className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                  >
                    {ordersLoading ? '⟳ Loading...' : '⟳ Refresh'}
                  </button>
                </div>
              </div>
              
              {ordersError && (
                <div className="text-center py-4 text-red-400 bg-[#1A1A1A] rounded-lg border border-red-900/30 mb-3">
                  <div className="text-sm font-medium">Error Fetching Orders</div>
                  <div className="text-xs mt-1 max-w-[90%] mx-auto">{ordersError}</div>
                  <button
                    onClick={() => {
                      refreshOrders();
                    }}
                    disabled={ordersLoading}
                    className="mt-2 px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-xs rounded border border-blue-800/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    Retry Now
                  </button>
                </div>
              )}

              {activeOrders.length === 0 && !ordersError ? (
                <div className="text-center py-4 text-[#606060]">
                  <div className="text-sm">No active orders</div>
                  <div className="text-xs mt-1">
                    {ordersLoading ? 'Loading orders...' : 
                     !isConnected ? 'Wallet not connected' :
                     !metricId ? 'No market selected' :
                     'No active orders for this market'}
                  </div>
                </div>
              ) : !ordersError ? (
                activeOrders.map((order) => (
                  <div key={order.id} className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                    {/* Main order row - compact single line */}
                    <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* Side indicator */}
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${order.side === 'buy' ? 'bg-green-400' : 'bg-red-400'}`} />
                      
                      {/* Order info */}
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className={`text-[11px] font-medium ${order.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                          {order.side.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-[#808080]">
                          {order.quantity.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-[#606060]">@</span>
                        <span className="text-[10px] text-white font-mono">
                          ${order.price ? order.price.toFixed(4) : 'N/A'}
                        </span>
                      </div>
                    </div>
                    
                    {/* Status and actions */}
                    <div className="flex items-center gap-2">
                      {/* Progress indicator for partially filled */}
                      {order.filledQuantity > 0 && (
                        <div className="w-8 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-400 transition-all duration-300"
                            style={{ width: `${order.quantity > 0 ? (order.filledQuantity / order.quantity) * 100 : 0}%` }}
                          />
                        </div>
                      )}
                      
                      {/* Status dot */}
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        order.status === 'pending' ? 'bg-yellow-400' : 
                        order.status === 'partially_filled' ? 'bg-blue-400' :
                        'bg-gray-400'
                      }`} />
                      
                      {/* Cancel button */}
                      <button
                        onClick={async () => {
                          try {
                            setIsCancelingOrder(true);
                            const ok = await handleCancelOrder(order.id);
                            if (!ok) {
                              showError('Failed to cancel order. Please try again.');
                            }
                          } catch (e) {
                            showError('Cancellation failed. Please try again.');
                          } finally {
                            setIsCancelingOrder(false);
                          }
                        }}
                        disabled={ordersLoading || isCancelingOrder}
                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-red-500/10 rounded text-red-400 hover:text-red-300 disabled:opacity-50"
                        title="Cancel order"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  
                  {/* Expandable details on hover/focus */}
                  <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                    <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px] pt-1.5">
                        <div className="flex justify-between">
                          <span className="text-[#606060]">Total:</span>
                          <span className="text-[#9CA3AF] font-mono">${order.price ? (order.quantity * order.price).toFixed(2) : 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#606060]">Filled:</span>
                          <span className="text-[#9CA3AF]">{order.quantity > 0 ? ((order.filledQuantity / order.quantity) * 100).toFixed(1) : '0.0'}%</span>
                        </div>
                        {order.expiryTime && (
                          <div className="flex justify-between col-span-2">
                            <span className="text-[#606060]">Expires:</span>
                            <span className="text-[#9CA3AF]">{new Date(order.expiryTime).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                ))
              ) : (
                <div className="text-center py-4 text-red-400 bg-[#1A1A1A] rounded-lg border border-red-900/30 mb-3">
                  <div className="text-sm font-medium">Error Fetching Orders</div>
                  <div className="text-xs mt-1 max-w-[90%] mx-auto">{ordersError}</div>
                  <button
                    onClick={() => {
                      refreshOrders();
                    }}
                    disabled={ordersLoading}
                    className="mt-2 px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-xs rounded border border-blue-800/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    Retry Now
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Buy Tab - Trading Interface */}
          {activeTab === 'buy' && (
            <>


              {/* Contract & Market Info removed to reduce height */}

          {/* Long/Short Option Buttons - Sophisticated Design */}
          <div className="space-y-1 mb-2">
            {/* <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Position Direction</h4>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                {selectedOption || 'Select'}
              </div>
            </div> */}
            
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedOption('long')}
                className={`group flex-1 bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border transition-all duration-200 ${
                  selectedOption === 'long' 
                    ? 'border-green-400 bg-green-400/10' 
                    : 'border-[#222222] hover:border-[#333333]'
                }`}
              >
                <div className="flex items-center justify-center p-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      selectedOption === 'long' ? 'bg-green-400' : 'bg-[#404040]'
                    }`} />
                    <span className={`text-xs font-medium ${
                      selectedOption === 'long' ? 'text-green-400' : 'text-[#808080]'
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
                className={`group flex-1 bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border transition-all duration-200 ${
                  selectedOption === 'short' 
                    ? 'border-red-400 bg-red-400/10' 
                    : 'border-[#222222] hover:border-[#333333]'
                }`}
              >
                <div className="flex items-center justify-center p-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      selectedOption === 'short' ? 'bg-red-400' : 'bg-[#404040]'
                    }`} />
                    <span className={`text-xs font-medium ${
                      selectedOption === 'short' ? 'text-red-400' : 'text-[#808080]'
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
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Limit Order Settings</h4>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                  Advanced
                </div>
              </div> */}
              
              {/* Trigger Price Section */}
              <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                <div className="p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${triggerPrice > 0 ? 'bg-blue-400' : 'bg-[#404040]'}`} />
                      <span className="text-[11px] font-medium text-[#808080]">Limit Price</span>
                    </div>
                    <span className="text-[10px] text-[#606060]">USDC</span>
                  </div>
                  <div className="relative">
                    <div className="absolute left-2 top-1/2 transform -translate-y-1/2 text-[#606060] text-xs pointer-events-none">$</div>
                    <input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      value={triggerPriceInput}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        // Strip commas before sanitizing
                        const raw = e.target.value.replace(/,/g, '');
                        const value = sanitizeDecimalInput(raw, 8);
                        setTriggerPriceInput(value);
                        const parsed = parseFloat(value);
                        setTriggerPrice(Number.isFinite(parsed) ? parsed : 0);
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
                      onFocus={() => {
                        // Remove commas for easier editing
                        setTriggerPriceInput((triggerPriceInput || '').replace(/,/g, ''));
                      }}
                      placeholder="0.00"
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1 pl-6 text-xs font-medium text-white placeholder-[#606060] focus:outline-none focus:border-blue-400 transition-colors duration-200"
                    />
                  </div>
                </div>
              </div>

              {/* Order Type Section */}
              {/* <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                <div className="p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                      <span className="text-[11px] font-medium text-[#808080]">Order Type</span>
                    </div>
                    <span className="text-[10px] text-[#606060]">{limitOrderType}</span>
                  </div>
                  <select
                    value={limitOrderType}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setLimitOrderType(getInputValue(e) as typeof limitOrderType)}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1 text-xs font-medium text-white focus:outline-none focus:border-blue-400 transition-colors duration-200 cursor-pointer"
                  >
                    <option value="LIMIT">Limit Order</option>
                    <option value="MARKET_IF_TOUCHED">Market If Touched</option>
                    <option value="STOP_LOSS">Stop Loss</option>
                    <option value="TAKE_PROFIT">Take Profit</option>
                  </select>
                </div>
              </div> */}

              {/* Order Expiry Section */}
              {/* <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                <div className="p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400" />
                      <span className="text-[11px] font-medium text-[#808080]">Order Expires</span>
                    </div>
                    <span className="text-[10px] text-[#606060]">
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
                            : 'bg-[#1A1A1A] text-[#808080] hover:text-[#9CA3AF] border border-[#333333] hover:border-[#444444]'
                        }`}
                      >
                        {hours === 1 ? '1h' : hours === 6 ? '6h' : hours === 24 ? '1d' : hours === 72 ? '3d' : '1w'}
                      </button>
                    ))}
                  </div>
                </div>
              </div> */}

              {/* Max Slippage Section */}
              {/* <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                <div className="p-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                      <span className="text-[11px] font-medium text-[#808080]">Max Slippage</span>
                    </div>
                    <span className="text-[10px] text-white font-mono">
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
                      className="flex-1 h-1 bg-[#2A2A2A] rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div className="flex justify-between text-[8px] text-[#606060] mt-1">
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
            <div className="flex items-center justify-between mb-2 cursor-pointer hover:bg-[#1A1A1A] px-2 py-1 rounded-md transition-all duration-200" onClick={() => setIsUsdMode(!isUsdMode)}
                title="Click to switch between USD and Units">
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Position Size</h4>
              <div className="flex items-center gap-1 text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded hover:bg-[#2A2A2A] transition-all duration-200">
                {isUsdMode ? 'USD' : 'Units'}
                <svg className="w-3 h-3 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
            </div>
            
            {/* Amount Input Container */}
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-3">
              <div className="relative">
                <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#9CA3AF] text-xl font-bold pointer-events-none">
                  {isUsdMode ? '$' : '#'}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  value={amountInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const value = e.target.value;
                    // Mirror Limit Price input behavior: allow only digits and a single decimal point
                    if (/^\d*\.?\d*$/.test(value)) {
                      setAmountInput(value);
                      const parsed = parseFloat(value);
                      setAmount(!isNaN(parsed) ? parsed : 0);
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
                  <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Quick Amounts</h4>
                  <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                    USD
                  </div>
                </div>
                
                <div className="flex gap-1">
                                    {quickAmounts.map((value) => (
                      <button
                        key={value}
                        onClick={() => handleQuickAmount(value)}
                        className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded border border-[#222222] hover:border-[#333333] transition-all duration-200 flex-1"
                      >
                      <div className="flex items-center justify-center py-1 px-1">
                          <div className="flex items-center gap-1">
                            <div className="w-1 h-1 rounded-full bg-[#404040] group-hover:bg-blue-400" />
                            <span className="text-[9px] font-medium text-[#808080] group-hover:text-[#9CA3AF]">
                              +${value >= 1000 ? `${value/1000}K` : value}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  <button
                    onClick={handleMaxAmount}
                    className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded border border-[#222222] hover:border-blue-400 transition-all duration-200"
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
              </div>
            )}

            {/* Advanced Setup removed (leverage disabled) */}

            {/* Trade Summary - Sophisticated Design */}
            <div className="space-y-1 mb-1">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Order Summary</h4>
                  <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                    {orderType.toUpperCase()}
                  </div>
                </div>
                
                <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                  <div className="p-1.5">
                    <div className="space-y-0.5 text-[10px]">
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="text-[#606060] flex-1 min-w-0 truncate">Order Amount:</span>
                        <span className="text-white font-mono whitespace-nowrap">{isUsdMode ? '$' : ''}{formatNumber(amount)}{!isUsdMode ? ' units' : ''}</span>
                      </div>
                      {/* Leverage and Position Size removed */}
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="text-[#606060] flex-1 min-w-0 truncate">Trading Fee:</span>
                        <span className="text-white font-mono whitespace-nowrap">${formatNumber((quoteState.value && quoteState.value > 0) ? (quoteState.value * 0.001) : (isUsdMode ? (amount * 0.001) : (amount * resolveCurrentPrice() * 0.001)))}</span>
                      </div>
                      {orderType === 'limit' && (
                        <>
                          <div className="border-t border-[#1A1A1A] my-1"></div>
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <span className="text-[#606060] flex-1 min-w-0 truncate">Limit Price:</span>
                            <span className="text-white font-mono whitespace-nowrap">${triggerPrice > 0 ? formatNumber(triggerPrice) : 'Not set'}</span>
                          </div>
                        </>
                      )}
                      {/* Additional Details */}
                      {(() => {
                        const currentPrice = resolveCurrentPrice();
                        const tradingFee = (quoteState.value && quoteState.value > 0)
                          ? (quoteState.value * 0.001)
                          : amount * (isUsdMode ? 0.001 : 0.001 * currentPrice);
                        const automationFee = orderType === 'limit' ? 2 : 0;
                        const executionFee = orderType === 'limit' ? 3 : 0;
                        const feesTotal = tradingFee + automationFee + executionFee;
                        const marginMultiplier = selectedOption === 'short' ? 1.5 : 1.0;
                        // Depth-aware quote values, respecting position type
                        const estPrice = orderType === 'limit' ? (triggerPrice > 0 ? triggerPrice : currentPrice) : (quoteState.price > 0 ? quoteState.price : (selectedOption === 'long' && bestAsk > 0 ? bestAsk : (selectedOption === 'short' && bestBid > 0 ? bestBid : currentPrice)));
                        const estUnits = orderType === 'limit'
                          ? (isUsdMode ? (amount > 0 && estPrice > 0 ? amount / estPrice : 0) : amount)
                          : (quoteState.units > 0 ? quoteState.units : (isUsdMode ? (amount > 0 && estPrice > 0 ? amount / estPrice : 0) : amount));
                        const orderValue = orderType === 'limit'
                          ? (isUsdMode ? amount : amount * estPrice)
                          : (quoteState.value > 0 ? quoteState.value : (isUsdMode ? amount : amount * estPrice));
                        const marginRequired = orderValue * marginMultiplier;
                        // Adjusted liquidity check to consider currentPrice as fallback for market orders
                        const hasLiquidity = orderType === 'limit' ? (selectedOption === 'long' ? bestAsk > 0 : bestBid > 0) : (selectedOption === 'long' ? (bestAsk > 0 || currentPrice > 0) : (bestBid > 0 || currentPrice > 0));
                        return (
                          <div className="text-[10px] space-y-0.5">
                            {/* Quote health/status */}
                            <div className="flex items-center justify-between gap-2 min-w-0">
                              <span className="text-[#606060] flex-1 min-w-0 truncate">Est. Fill Price:</span>
                              <span className="text-white font-mono whitespace-nowrap">{quoteState.isLoading ? '...' : (hasLiquidity ? `$${formatNumber(estPrice)}` : 'No liquidity')}{quoteState.partial ? ' (partial)' : ''}</span>
                            </div>
                    
                            <div className="flex items-center justify-end gap-2 min-w-0">
                              {/* <span className="text-[#606060]">{isUsdMode ? 'Est. Units:' : 'Est. Value:'}</span> */}
                              <span className="text-white font-mono whitespace-nowrap">
                                {quoteState.isLoading ? '...'
                                  : (hasLiquidity
                                      ? (isUsdMode
                                          ? `${formatNumber(estUnits)} units`
                                          : `$${formatNumber(orderValue)}`)
                                      : 'No liquidity')}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 min-w-0">
                              <span className="text-[#606060] flex-1 min-w-0 truncate">Order Value:</span>
                              <span className="text-white font-mono whitespace-nowrap">{hasLiquidity ? `$${formatNumber(orderValue)}` : 'No liquidity'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 min-w-0">
                              <span className="text-[#606060] flex-1 min-w-0 truncate">Margin Required{selectedOption === 'short' ? ' (150%)' : ''}:</span>
                              <span className="text-white font-mono whitespace-nowrap">{hasLiquidity ? `$${formatNumber(marginRequired)}` : 'No liquidity'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 min-w-0">
                              <span className="text-[#606060] flex-1 min-w-0 truncate">Liquidation Price:</span>
                              <span className="text-white font-mono whitespace-nowrap">{hasLiquidity ? `$${formatNumber(computedLiquidationPrice || 0)}` : 'No liquidity'}</span>
                            </div>
                    
                          </div>
                        );
                      })()}
                    </div>
                    
                    {/* Order validation messages */}
                    {/* <div className="mt-1.5">
                      <OrderValidationComponent />
                    </div> */}
                  </div>
                  
                  
                </div>
              </div>


          </div>
            </>
          )}
        </div>

        {/* Trade Button */}
        <div className="flex gap-2 mt-1.5">
          {!isConnected ? (
            <button 
              onClick={() => setShowWalletModal(true)}
              className="flex-1 transition-all duration-150 border-none cursor-pointer rounded-md bg-[#3B82F6] text-white"
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
              disabled={(isSubmittingOrder || isCancelingOrder) || (!((process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED === 'true' && address && globalSessionActive === false) && !canExecuteTrade())}
              className="flex-1 transition-all duration-150 border-none cursor-pointer rounded-md"
              style={{
                padding: '10px',
                fontSize: '16px',
                fontWeight: '600',
                backgroundColor: ((isSubmittingOrder || isCancelingOrder) || (!((process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED === 'true' && address && globalSessionActive === false) && !canExecuteTrade())) ? '#1A1A1A' : '#3B82F6',
                color: ((isSubmittingOrder || isCancelingOrder) || (!((process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED === 'true' && address && globalSessionActive === false) && !canExecuteTrade())) ? '#6B7280' : '#FFFFFF',
                cursor: ((isSubmittingOrder || isCancelingOrder) || (!((process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED === 'true' && address && globalSessionActive === false) && !canExecuteTrade())) ? 'not-allowed' : 'pointer'
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
      `}</style>
      
      {/* Active orders are shown in the Orders tab only */}
    </div>
  );
} 