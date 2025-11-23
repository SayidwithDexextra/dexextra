'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '@/hooks/useWallet';
import { useMarketData } from '@/contexts/MarketDataContext';
import { initializeContracts } from '@/lib/contracts';
import { ensureHyperliquidWallet } from '@/lib/network';
import { ErrorModal, SuccessModal } from '@/components/StatusModals';
import { usePositions as useAllPositions } from '@/hooks/usePositions';
import { useMarkets } from '@/hooks/useMarkets';
import { cancelOrderForMarket } from '@/hooks/useOrderBook';
import { usePortfolioData } from '@/hooks/usePortfolioData';
import type { Address } from 'viem';
import { signAndSubmitGasless, createGaslessSession, submitSessionTrade } from '@/lib/gasless';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import { parseUnits } from 'viem';

// Public USDC icon (fallback to Circle's official)
const USDC_ICON_URL = 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Circle_USDC_Logo.svg';
const FALLBACK_TOKEN_ICON = '/Dexicon/LOGO-Dexetera-01.svg';
const logGoddMat = (step: number, message: string, data?: any) => {
  console.log(`[GODD][STEP${step}] ${message}`, data ?? '');
};
interface Position {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  pnlPercent: number;
  liquidationPrice: number;
  margin: number;
  leverage: number;
  timestamp: number;
  isUnderLiquidation?: boolean; // Flag to indicate if position is under liquidation
}

interface Order {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  price: number;
  size: number;
  filled: number;
  status: 'PENDING' | 'PARTIAL' | 'FILLED' | 'CANCELLED';
  timestamp: number;
  metricId?: string;
}

interface Trade {
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

type TabType = 'positions' | 'orders' | 'trades' | 'history';

interface MarketActivityTabsProps {
  symbol: string;
  className?: string;
}

export default function MarketActivityTabs({ symbol, className = '' }: MarketActivityTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>('positions');
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedPositionId, setExpandedPositionId] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [isCancelingOrder, setIsCancelingOrder] = useState(false);
  const [optimisticallyRemovedOrderIds, setOptimisticallyRemovedOrderIds] = useState<Set<string>>(new Set());
  const wallet = useWallet() as any;
  const walletAddress = wallet?.walletData?.address ?? wallet?.address ?? null;
  const GASLESS = typeof process !== 'undefined' && (process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
  // Ensure we consistently use metricId (aligned with TradingPanel)
  console.log('symbol MarketActivityTabs', symbol);
  const metricId = symbol;
  console.log('metricId MarketActivityTabs', metricId);
  const md = useMarketData();
  const orderBookState = md.orderBookState;
  const orderBookActions = md.orderBookActions;
  // Removed ordersUpdated -> refreshOrders recursion guard; UI re-renders from state updates

  // Reuse portfolio logic: fetch ALL positions and markets map
  const { positions: allPositions, isLoading: positionsIsLoading } = useAllPositions(undefined, { enabled: activeTab === 'positions' });
  const { markets } = useMarkets({ limit: 500, autoRefresh: true, refreshInterval: 60000 });
  const { ordersBuckets, isLoadingOrders, refreshOrders: refreshPortfolioOrders } = usePortfolioData({
    enabled: !!walletAddress,
    refreshInterval: 15000
  });
  const marketIdMap = useMemo(() => {
    const map = new Map<string, { symbol: string; name: string }>();
    for (const m of markets || []) {
      const key = (m?.market_id_bytes32 || '').toLowerCase();
      if (key) {
        map.set(key, {
          symbol: (m?.symbol || '').toUpperCase(),
          name: m?.name || (m?.symbol || '')
        });
      }
    }
    return map;
  }, [markets]);
  const marketSymbolMap = useMemo(() => {
    const map = new Map<string, { symbol: string; name: string; icon?: string }>();
    for (const m of markets || []) {
      const sym = (m?.symbol || '').toUpperCase();
      if (!sym) continue;
      map.set(sym, { symbol: sym, name: m?.name || sym, icon: (m as any)?.icon_image_url || undefined });
    }
    return map;
  }, [markets]);
  
  // Resolve per-market OrderBook address from symbol/metricId using populated CONTRACT_ADDRESSES.MARKET_INFO
  const resolveOrderBookAddress = useCallback((symbolOrMetricId?: string | null): string | null => {
    try {
      if (!symbolOrMetricId) return null;
      const entries: any[] = Object.values((CONTRACT_ADDRESSES as any)?.MARKET_INFO || {});
      // Try direct base-symbol key first (e.g. 'ALU' from 'ALU-USD')
      const baseKey = String(symbolOrMetricId).split('-')[0].toUpperCase();
      const direct = (CONTRACT_ADDRESSES as any)?.MARKET_INFO?.[baseKey];
      if (direct?.orderBook) return direct.orderBook as string;
      // Fallback: scan by marketIdentifier / full symbol / name
      const lower = String(symbolOrMetricId).toLowerCase();
      const match = entries.find((m: any) => {
        const candidates = [
          m?.marketIdentifier?.toLowerCase?.(),
          m?.symbol?.toLowerCase?.(),
          m?.name?.toLowerCase?.()
        ].filter(Boolean);
        return candidates.includes(lower);
      });
      return match?.orderBook || null;
    } catch {
      return null;
    }
  }, []);
  
  // Throttle and in-flight guards for order history
  const isFetchingHistoryRef = useRef(false);
  const lastHistoryFetchTsRef = useRef(0);

  // Positions: show ALL user positions across markets (reuse portfolio hook)
  useEffect(() => {
    if (!walletAddress) {
      setPositions([]);
      return;
    }
    try {
      const mapped = (allPositions || []).map((p: any) => {
        const keyHex = String(p?.marketId || '').toLowerCase();
        const meta = marketIdMap.get(keyHex);
        const symbolDisplay = (meta?.symbol || p?.symbol || 'UNKNOWN').toUpperCase();
        return {
          id: String(p?.id || p?.marketId || keyHex),
          symbol: symbolDisplay,
          side: (p?.side || 'LONG') as 'LONG' | 'SHORT',
          size: Number(p?.size || 0),
          entryPrice: Number(p?.entryPrice || 0),
          markPrice: Number(p?.markPrice || p?.entryPrice || 0),
          pnl: Number(p?.pnl || 0),
          pnlPercent: Number(p?.pnlPercent || 0),
          liquidationPrice: Number(p?.liquidationPrice || 0),
          margin: Number(p?.margin || 0),
          leverage: Number(p?.leverage || 1),
          timestamp: Number(p?.timestamp || Date.now()),
          isUnderLiquidation: Boolean(p?.isUnderLiquidation || false)
        } as Position;
      });
      setPositions(mapped);
    } catch (e) {
      setPositions([]);
    }
  }, [walletAddress, allPositions, marketIdMap]);

  // Add success/error modal state
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

  // Helper functions for showing success/error messages
  const showSuccess = (message: string, title: string = 'Success') => {
    setSuccessModal({ isOpen: true, title, message });
  };

  const showError = (message: string, title: string = 'Error') => {
    setErrorModal({ isOpen: true, title, message });
  };

  // Add top-up state and handler
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpPositionId, setTopUpPositionId] = useState<string | null>(null);
  const [topUpSymbol, setTopUpSymbol] = useState<string>('');
  const [topUpAmount, setTopUpAmount] = useState<string>('');
  const [currentMargin, setCurrentMargin] = useState<number>(0);

  // Add close position state and handler
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closePositionId, setClosePositionId] = useState<string | null>(null);
  const [closeSymbol, setCloseSymbol] = useState<string>('');
  const [closeSize, setCloseSize] = useState<string>('');
  const [maxSize, setMaxSize] = useState<number>(0);

  // Handle top-up action
  const handleTopUp = (positionId: string, symbol: string, currentMargin: number) => {
    setTopUpPositionId(positionId);
    setTopUpSymbol(symbol);
    setCurrentMargin(currentMargin);
    setShowTopUpModal(true);
  };

  const handleTopUpSubmit = async () => {
    if (!topUpPositionId || !topUpAmount || !walletAddress) return;
    
    try {
      console.log(`Topping up position ${topUpPositionId} for ${topUpSymbol} with amount ${topUpAmount}`);
      // Resolve signer from injected provider
      let signer: ethers.Signer | null = null;
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        signer = await ensureHyperliquidWallet();
      }
      if (!signer) {
        throw new Error('No signer available. Please connect your wallet.');
      }

      // Initialize contracts using shared config (includes CoreVault at configured address)
      const contracts = await initializeContracts({ providerOrSigner: signer });

      // Use actual marketId from position id (already bytes32 hex)
      const marketId = topUpPositionId as string;
      const amount6 = ethers.parseUnits(topUpAmount, 6);

      // Optional: liquidation price before
      try {
        console.log(`📡 [RPC] Checking liquidation price before top-up`);
        let startTimeLiq = Date.now();
        const [liqBefore] = await contracts.vault.getLiquidationPrice(walletAddress, marketId);
        const durationLiq = Date.now() - startTimeLiq;
        console.log(`✅ [RPC] Liquidation price check completed in ${durationLiq}ms`, { liqBefore: String(liqBefore) });
      } catch (error) {
        console.warn(`⚠️ [RPC] Liquidation price check failed:`, error);
      }

      console.log(`📡 [RPC] Submitting position top-up transaction`);
      let startTimeTx = Date.now();
      const tx = await contracts.vault.topUpPositionMargin(marketId, amount6);
      const durationTx = Date.now() - startTimeTx;
      console.log(`✅ [RPC] Position top-up transaction submitted in ${durationTx}ms`, { txHash: tx.hash });

      // Optional: liquidation price after
      try {
        console.log(`📡 [RPC] Checking liquidation price after top-up`);
        let startTimeLiqAfter = Date.now();
        const [liqAfter] = await contracts.vault.getLiquidationPrice(walletAddress, marketId);
        const durationLiqAfter = Date.now() - startTimeLiqAfter;
        console.log(`✅ [RPC] Post top-up liquidation price check completed in ${durationLiqAfter}ms`, { liqAfter: String(liqAfter) });
      } catch (error) {
        console.warn(`⚠️ [RPC] Post top-up liquidation price check failed:`, error);
      }
      console.log('Transaction sent, waiting for confirmation...');
      await tx.wait();
      console.log('Top-up successful!');

      // Optional: liquidation price after
      try {
        const [liqAfter] = await contracts.vault.getLiquidationPrice(walletAddress, marketId);
        console.log('Liq after:', String(liqAfter));
      } catch {}

      setTopUpAmount('');
      setTopUpPositionId(null);
      setTopUpSymbol('');
      setShowTopUpModal(false);
      alert('Position topped up successfully!');
    } catch (error) {
      console.error('Error topping up position:', error);
      alert('Failed to top up position. Please try again.');
    }
  };

  const [closeError, setCloseError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const validateCloseSize = (size: string): string | null => {
    if (!size) return 'Please enter a close size';
    const amount = parseFloat(size);
    if (isNaN(amount)) return 'Invalid number format';
    if (amount <= 0) return 'Close size must be greater than 0';
    if (amount > maxSize) return 'Close size cannot exceed position size';
    return null;
  };

  const handleCloseSubmit = async () => {
    if (!closePositionId || !closeSize || !walletAddress) return;
    
    const validationError = validateCloseSize(closeSize);
    if (validationError) {
      setCloseError(validationError);
      return;
    }

    setIsClosing(true);
    setCloseError(null);
    
    try {
      const closeAmount = parseFloat(closeSize);
      // Prefer gasless close via market order of opposite side (session-based)
      if (GASLESS && walletAddress) {
        const pos = positions.find(p => p.id === closePositionId);
        const isBuy = pos?.side === 'SHORT';
        const obAddress = resolveOrderBookAddress(closeSymbol || pos?.symbol);
        if (!obAddress) throw new Error('OrderBook not found for market');
        const amountWei = parseUnits(closeSize, 18);
        // session flow
        const sessionKey = `gasless:session:${walletAddress}`;
        let sessionId = (typeof window !== 'undefined') ? window.localStorage.getItem(sessionKey) || '' : '';
        const trySessionOnce = async (): Promise<string | null> => {
          if (!sessionId) return null;
          const r = await submitSessionTrade({
            method: 'sessionPlaceMarginMarket',
            orderBook: obAddress,
            sessionId,
            trader: walletAddress as string,
            amountWei: amountWei as unknown as bigint,
            isBuy,
          });
          if (!r.success) return null;
          return r.txHash || null;
        };
        let txHash = await trySessionOnce();
        if (!txHash) {
          const created = await createGaslessSession({
            trader: walletAddress as string,
          });
          if (created.success && created.sessionId) {
            sessionId = created.sessionId;
            if (typeof window !== 'undefined') window.localStorage.setItem(sessionKey, sessionId);
            txHash = await trySessionOnce();
          }
        }
        if (!txHash) throw new Error('Gasless close failed');
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('ordersUpdated'));
            window.dispatchEvent(new Event('positionsRefreshRequested'));
          }
        } catch {}
      } else {
        const success = await orderBookActions.closePosition(closePositionId, closeAmount);
        if (!success) {
          throw new Error('Failed to close position');
        }
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('ordersUpdated'));
            window.dispatchEvent(new Event('positionsRefreshRequested'));
          }
        } catch {}
      }

      setCloseSize('');
      setClosePositionId(null);
      setCloseSymbol('');
      setShowCloseModal(false);
    } catch (error: any) {
      console.error('Error closing position:', error);
      setCloseError(error?.message || 'Failed to close position. Please try again.');
    } finally {
      setIsClosing(false);
    }
  };

  // Open Orders sourced from portfolio data hook (aggregates across all markets)
  const flattenOrderBuckets = useCallback((buckets: any[] = []): Order[] => {
    const flat: Order[] = [];
    (buckets || []).forEach((bucket: any) => {
      const symbolUpper = String(bucket?.symbol || 'UNKNOWN').toUpperCase();
      (bucket?.orders || []).forEach((o: any) => {
        const sideStr = String(o?.side || (o?.isBuy ? 'BUY' : 'SELL')).toUpperCase();
        const typeStr = String(o?.type || 'limit').toUpperCase();
        const statusLc = String(o?.status || 'pending').toLowerCase();
        const status: Order['status'] = statusLc === 'pending'
          ? 'PENDING'
          : statusLc === 'partially_filled'
            ? 'PARTIAL'
            : statusLc === 'filled'
              ? 'FILLED'
              : statusLc === 'cancelled'
                ? 'CANCELLED'
                : 'PENDING';
        let qty = Number(o?.quantity || 0);
        if (qty >= 1_000_000_000) qty = qty / 1_000_000_000_000;
        flat.push({
          id: String(o?.id || ''),
          symbol: symbolUpper,
          side: (sideStr === 'BUY' ? 'BUY' : 'SELL'),
          type: typeStr === 'MARKET' ? 'MARKET' : 'LIMIT',
          price: Number(o?.price || 0),
          size: qty,
          filled: Number(o?.filledQuantity || 0),
          status,
          timestamp: Number(o?.timestamp || Date.now()),
          metricId: String(o?.metricId || symbolUpper)
        });
      });
    });
    return flat;
  }, []);

  const openOrders = useMemo(() => {
    const flat = flattenOrderBuckets(ordersBuckets);
    return flat.filter(o => o.status !== 'CANCELLED' && o.status !== 'FILLED' && !optimisticallyRemovedOrderIds.has(String(o.id)));
  }, [ordersBuckets, flattenOrderBuckets, optimisticallyRemovedOrderIds]);
  const openOrdersIsLoading = Boolean(isLoadingOrders && activeTab === 'orders');

  useEffect(() => {
    if (!walletAddress) return;
    logGoddMat(27, 'Wallet detected; triggering initial open orders refresh', { walletAddress });
    void refreshPortfolioOrders();
  }, [walletAddress, refreshPortfolioOrders]);

  useEffect(() => {
    if (!walletAddress) return;
    logGoddMat(21, 'MarketActivityTabs updated openOrders derived state', {
      bucketCount: ordersBuckets.length,
      flattenedOrderCount: openOrders.length,
      activeTab
    });
  }, [walletAddress, ordersBuckets, openOrders.length, activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!walletAddress) return;
    logGoddMat(22, 'Subscribing to global ordersUpdated listener from MarketActivityTabs', { walletAddress });
    const onOrdersUpdated = () => {
      logGoddMat(23, 'ordersUpdated event captured; triggering refreshPortfolioOrders', { walletAddress });
      void refreshPortfolioOrders();
    };
    window.addEventListener('ordersUpdated', onOrdersUpdated as EventListener);
    return () => {
      window.removeEventListener('ordersUpdated', onOrdersUpdated as EventListener);
    };
  }, [walletAddress, refreshPortfolioOrders]);
  // Fetch order history ONLY when History tab is active, throttle and skip when hidden
  useEffect(() => {
    if (activeTab !== 'history') return;
    if (!walletAddress) return;

    let isMounted = true;

    const fetchHistory = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (isFetchingHistoryRef.current) return;
      const now = Date.now();
      if (now - lastHistoryFetchTsRef.current < 10000) return; // 10s cooldown

      isFetchingHistoryRef.current = true;
      setIsLoading(true);
      try {
        console.log('[Dispatch] 📡 [API][MarketActivityTabs] /api/orders/query request', { metricId, trader: walletAddress });
        const params = new URLSearchParams({
          metricId, // use metric_id consistently
          trader: walletAddress,
          limit: '50'
        });
        const res = await fetch(`/api/orders/query?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          console.log('[Dispatch] ✅ [API][MarketActivityTabs] /api/orders/query response', { total: data?.orders?.length, resolvedMarketId: data?.resolvedMarketId });
          const symbolUpper = metricId.toUpperCase();
          const hist = (data.orders || []).map((o: any) => ({
            id: o.order_id,
            symbol: symbolUpper,
            side: (o.side || 'BUY') as 'BUY' | 'SELL',
            type: (o.order_type || 'LIMIT') as 'MARKET' | 'LIMIT',
            price: typeof o.price === 'number' ? o.price : (o.price ? parseFloat(o.price) : 0),
            size: typeof o.quantity === 'number' ? o.quantity : parseFloat(o.quantity || '0'),
            filled: typeof o.filled_quantity === 'number' ? o.filled_quantity : parseFloat(o.filled_quantity || '0'),
            status: (o.order_status || 'PENDING').replace('PARTIAL','PARTIAL') as any,
            timestamp: new Date(o.updated_at || o.created_at).getTime(),
          }));
          if (isMounted) setOrderHistory(hist);
        }
        else {
          console.warn('[Dispatch] ⚠️ [API][MarketActivityTabs] /api/orders/query non-200', res.status);
        }
      } catch (e) {
        console.error('[Dispatch] ❌ [API][MarketActivityTabs] /api/orders/query exception', e);
        // keep existing orderHistory on error
      } finally {
        lastHistoryFetchTsRef.current = Date.now();
        isFetchingHistoryRef.current = false;
        if (isMounted) setIsLoading(false);
      }
    };

    fetchHistory();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchHistory();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      isMounted = false;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [activeTab, walletAddress, metricId]);

  const tabs = [
    { id: 'positions' as TabType, label: 'Positions', count: positions.length },
    { id: 'orders' as TabType, label: 'Open Orders', count: openOrders.length },
    { id: 'trades' as TabType, label: 'Trade History', count: orderBookState.tradeCount },
    { id: 'history' as TabType, label: 'Order History', count: orderHistory.length },
  ];

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderPositionsTable = () => {
    if (positions.length === 0) {
  return (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${positionsIsLoading ? 'bg-blue-400 animate-pulse' : 'bg-[#404040]'}`} />
                      <span className="text-[11px] font-medium text-[#808080]">
              {positionsIsLoading ? 'Loading open positions…' : 'No open positions'}
                      </span>
                    </div>
                  </div>
      );
    }

    return (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#222222]">
                        <th className="text-left px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Symbol</th>
                        <th className="text-left px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Side</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Size</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Mark</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">PnL</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Liq Price</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((position, index) => (
            <React.Fragment key={`${position.id}-${index}`}>
              <tr className={`mat-slide-rtl group/row transition-colors duration-200 ${
                position.isUnderLiquidation 
                  ? 'bg-yellow-400/5 hover:bg-yellow-400/10 border-yellow-400/20'
                  : 'hover:bg-[#1A1A1A]'
              } ${
                index !== positions.length - 1 ? 'border-b border-[#1A1A1A]' : ''
              }`} style={{ animationDelay: `${index * 50}ms` }}>
                          <td className="pl-2 pr-1 py-1.5">
                              <div className="flex items-center gap-1">
                              <div className="relative w-5 h-5">
                                <img
                                  src={(marketSymbolMap.get(position.symbol)?.icon as string) || FALLBACK_TOKEN_ICON}
                                  alt={`${position.symbol} icon`}
                                  className="absolute top-0 left-0 w-3.5 h-3.5 rounded-full border border-[#333333] object-cover z-10"
                                />
                                <img
                                  src={USDC_ICON_URL}
                                  alt="USDC icon"
                                  className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border border-[#333333] object-cover z-0"
                                />
                              </div>
                              <div className="flex items-center gap-0.5">
                                <span className="text-[11px] font-medium text-white">
                                  {marketSymbolMap.get(position.symbol)?.name || position.symbol}
                                </span>
                                <span className="text-[10px] text-[#606060]">{position.symbol}</span>
                                {position.isUnderLiquidation && (
                                  <div className="px-1 py-0.5 bg-yellow-400/10 rounded">
                                    <span className="text-[8px] font-medium text-yellow-400">LIQUIDATING</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="pl-1 pr-2 py-1.5">
                            <span className={`text-[11px] font-medium ${
                              position.side === 'LONG' ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {position.side}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <span className="text-[11px] text-white font-mono">{position.size.toFixed(2)}</span>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <span className="text-[11px] text-white font-mono">${position.markPrice.toFixed(2)}</span>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <div className="flex justify-end">
                              <span className="relative inline-block pr-4">
                                <span className={`text-[11px] font-medium font-mono ${
                                  position.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                                }`}>
                                  {position.pnl >= 0 ? '+' : ''}{position.pnl.toFixed(2)}
                                </span>
                                <span className={`absolute -top-2 -right-0 text-[9px] font-mono ${
                                  position.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                                }`}>
                                  {position.pnlPercent >= 0 ? '+' : ''}{position.pnlPercent.toFixed(2)}%
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <div className={`flex items-center justify-end gap-1.5 ${
                                position.isUnderLiquidation 
                                  ? 'bg-yellow-400/10 px-2 py-1 rounded border border-yellow-400/20'
                                  : ''
                              }`}>
                                {position.isUnderLiquidation && (
                                  <>
                                    <svg className="w-2.5 h-2.5 text-yellow-400 animate-pulse" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M12 9V14M12 19C8.13401 19 5 15.866 5 12C5 8.13401 8.13401 5 12 5C15.866 5 19 8.13401 19 12C19 15.866 15.866 19 12 19ZM12 16V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                    </svg>
                                  </>
                                )}
                                <span className={`text-[11px] font-mono ${
                                  position.isUnderLiquidation 
                                    ? 'text-yellow-400 font-bold'
                                    : 'text-white'
                                }`}>
                                  ${position.liquidationPrice.toFixed(2)}
                                </span>
                              </div>
                              {position.isUnderLiquidation && (
                                <span className="text-[8px] font-medium text-yellow-400 animate-pulse">
                                  UNDER LIQUIDATION
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                  <button 
                    onClick={() => setExpandedPositionId(expandedPositionId === position.id ? null : position.id)}
                    className="opacity-0 group-hover/row:opacity-100 transition-opacity duration-200 px-1.5 py-0.5 text-[9px] text-[#808080] hover:text-white hover:bg-[#2A2A2A] rounded"
                  >
                    {expandedPositionId === position.id ? 'Hide' : 'Manage'}
                            </button>
                          </td>
                        </tr>
              {expandedPositionId === position.id && (
                <tr className="bg-[#1A1A1A]">
                  <td colSpan={7} className="px-0">
                    <div className="px-2 py-1.5 border-t border-[#222222]">
                      <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col gap-1">
                                <span className="text-[9px] text-[#606060]">Current Margin</span>
                                <span className={`text-[10px] font-medium font-mono ${
                                  position.isUnderLiquidation ? 'text-yellow-400' : 'text-white'
                                }`}>
                                  ${position.margin.toFixed(2)}
                                </span>
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-[9px] text-[#606060]">Leverage</span>
                                <span className={`text-[10px] font-medium font-mono ${
                                  position.isUnderLiquidation ? 'text-yellow-400' : 'text-white'
                                }`}>
                                  {position.leverage}x
                                </span>
                              </div>
                              {position.isUnderLiquidation && (
                                <div className="flex flex-col gap-1">
                                  <div className="bg-yellow-400/10 border border-yellow-400/20 rounded-md px-2.5 py-1.5">
                                    <div className="flex items-center gap-2 mb-1">
                                      <svg className="w-2.5 h-2.5 text-yellow-400" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M12 9V14M12 19C8.13401 19 5 15.866 5 12C5 8.13401 8.13401 5 12 5C15.866 5 19 8.13401 19 12C19 15.866 15.866 19 12 19ZM12 16V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                      </svg>
                                      <span className="text-[9px] font-medium text-yellow-400 uppercase tracking-wide">Position Under Liquidation</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <div className="flex flex-col gap-0.5">
                                        <span className="text-[8px] text-yellow-400/60">Time Remaining</span>
                                        <span className="text-[10px] font-medium text-yellow-400 font-mono animate-pulse">00:30:00</span>
                                      </div>
                                      <div className="flex flex-col gap-0.5">
                                        <span className="text-[8px] text-yellow-400/60">Required Margin</span>
                                        <span className="text-[10px] font-medium text-yellow-400 font-mono">+$500.00</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleTopUp(position.id, position.symbol, position.margin)}
                              className="px-2.5 py-1 text-[10px] font-medium text-green-400 hover:text-green-300 bg-green-400/5 hover:bg-green-400/10 rounded transition-colors duration-200"
                            >
                              Top Up Position
                            </button>
                            <button
                              onClick={() => {
                                setClosePositionId(position.id);
                                setCloseSymbol(position.symbol);
                                setMaxSize(position.size);
                                setCloseSize(position.size.toString());
                                setShowCloseModal(true);
                              }}
                              className="px-2.5 py-1 text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-400/5 hover:bg-red-400/10 rounded transition-colors duration-200"
                            >
                              Close Position
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                          </td>
                        </tr>
              )}
            </React.Fragment>
                      ))}
                    </tbody>
                  </table>
    );
  };

  const renderOpenOrdersTable = () => {
    if (openOrders.length === 0) {
      return (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${openOrdersIsLoading ? 'bg-blue-400 animate-pulse' : 'bg-[#404040]'}`} />
                      <span className="text-[11px] font-medium text-[#808080]">
                        {openOrdersIsLoading ? 'Loading open orders…' : 'No open orders'}
                      </span>
                    </div>
                  </div>
      );
    }

    return (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#222222]">
                        <th className="text-left px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Symbol</th>
                        <th className="text-left px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Side</th>
                        <th className="text-left px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Type</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Price</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Size</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Filled</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Status</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openOrders.map((order, index) => (
                        <React.Fragment key={`${order.id}-${index}`}>
                          <tr className={`mat-slide-rtl hover:bg-[#1A1A1A] transition-colors duration-200 ${index !== openOrders.length - 1 ? 'border-b border-[#1A1A1A]' : ''}`} style={{ animationDelay: `${index * 50}ms` }}>
                            <td className="pl-2 pr-1 py-1.5">
                              <div className="flex items-center gap-1">
                                <div className="relative w-5 h-5">
                                  <img
                                    src={(marketSymbolMap.get(order.symbol)?.icon as string) || FALLBACK_TOKEN_ICON}
                                    alt={`${order.symbol} icon`}
                                    className="absolute top-0 left-0 w-3.5 h-3.5 rounded-full border border-[#333333] object-cover z-10"
                                  />
                                  <img
                                    src={USDC_ICON_URL}
                                    alt="USDC icon"
                                    className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border border-[#333333] object-cover z-0"
                                  />
                                </div>
                                <div className="flex items-center gap-0.5">
                                  <span className="text-[11px] font-medium text-white">
                                    {marketSymbolMap.get(order.symbol)?.name || order.symbol}
                                  </span>
                                  <span className="text-[10px] text-[#606060]">{order.symbol}</span>
                                </div>
                              </div>
                            </td>
                            <td className="pl-1 pr-2 py-1.5">
                              <span className={`text-[11px] font-medium ${order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{order.side}</span>
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="text-[11px] text-white">{order.type}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <span className="text-[11px] text-white font-mono">${order.price.toFixed(2)}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <span className="text-[11px] text-white font-mono">{order.size.toFixed(4)}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <span className="text-[11px] text-white font-mono">{order.filled.toFixed(4)}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <span className="text-[11px] text-[#9CA3AF]">{order.status}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <button
                                onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 px-1.5 py-0.5 text-[9px] text-[#808080] hover:text-white hover:bg-[#2A2A2A] rounded"
                              >
                                {expandedOrderId === order.id ? 'Hide' : 'Manage'}
                              </button>
                            </td>
                          </tr>
                          {expandedOrderId === order.id && (
                            <tr className="bg-[#1A1A1A]">
                              <td colSpan={8} className="px-0">
                                <div className="px-2 py-1.5 border-t border-[#222222]">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                      <div className="flex items-center gap-3">
                                        <div className="flex flex-col gap-1">
                                          <span className="text-[9px] text-[#606060]">Order Value</span>
                                          <span className="text-[10px] font-medium text-white font-mono">
                                            ${(order.price * order.size).toFixed(2)}
                                          </span>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                          <span className="text-[9px] text-[#606060]">Fill Progress</span>
                                          <span className="text-[10px] font-medium text-white font-mono">
                                            {((order.filled / order.size) * 100).toFixed(1)}%
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={async () => {
                                            try {
                                              setIsCancelingOrder(true);
                                              const metric = String(order.metricId || order.symbol);
                                              const obAddress = resolveOrderBookAddress(metric || order.symbol);
                                              if (GASLESS && walletAddress && obAddress) {
                                                let oid: bigint;
                                                try { oid = typeof order.id === 'bigint' ? (order.id as any) : BigInt(order.id as any); } catch { oid = 0n; }
                                                if (oid === 0n) throw new Error('Invalid order id');
                                                // session-based cancel
                                                const sessionKey = `gasless:session:${walletAddress}`;
                                                let sessionId = (typeof window !== 'undefined') ? window.localStorage.getItem(sessionKey) || '' : '';
                                                const trySessionCancel = async (): Promise<string | null> => {
                                                  if (!sessionId) return null;
                                                  const r = await submitSessionTrade({
                                                    method: 'sessionCancelOrder',
                                                    orderBook: obAddress,
                                                    sessionId,
                                                    trader: walletAddress as string,
                                                    orderId: oid as unknown as bigint,
                                                  });
                                                  if (!r.success) return null;
                                                  return r.txHash || null;
                                                };
                                                let txHash = await trySessionCancel();
                                                if (!txHash) {
                                                  const created = await createGaslessSession({
                                                    trader: walletAddress as string,
                                                  });
                                                  if (created.success && created.sessionId) {
                                                    sessionId = created.sessionId;
                                                    if (typeof window !== 'undefined') window.localStorage.setItem(sessionKey, sessionId);
                                                    txHash = await trySessionCancel();
                                                  }
                                                }
                                                if (!txHash) throw new Error('Gasless cancel failed');
                                                showSuccess('Order cancelled successfully');
                                                setOptimisticallyRemovedOrderIds(prev => {
                                                  const next = new Set(prev);
                                                  next.add(String(order.id));
                                                  return next;
                                                });
                                                // keep original refresh hook if available
                                                try {
                                                  // @ts-ignore
                                                  if (typeof fetchOpenOrders !== 'undefined') {
                                                    // @ts-ignore
                                                    fetchOpenOrders({ showSpinner: activeTab === 'orders' });
                                                  }
                                                } catch {}
                                                // ensure portfolio-wide refresh fires to update counts immediately
                                                try { await refreshPortfolioOrders(); } catch {}
                                                try {
                                                  if (typeof window !== 'undefined') {
                                                    window.dispatchEvent(new Event('ordersUpdated'));
                                                  }
                                                } catch {}
                                              } else {
                                                const ok = await cancelOrderForMarket(order.id, metric);
                                                if (!ok) {
                                                  showError('Failed to cancel order. Please try again.');
                                                } else {
                                                  showSuccess('Order cancelled successfully');
                                                  setOptimisticallyRemovedOrderIds(prev => {
                                                    const next = new Set(prev);
                                                    next.add(String(order.id));
                                                    return next;
                                                  });
                                                  try {
                                                    // @ts-ignore
                                                    if (typeof fetchOpenOrders !== 'undefined') {
                                                      // @ts-ignore
                                                      fetchOpenOrders({ showSpinner: activeTab === 'orders' });
                                                    }
                                                  } catch {}
                                                  try { await refreshPortfolioOrders(); } catch {}
                                                  try {
                                                    if (typeof window !== 'undefined') {
                                                      window.dispatchEvent(new Event('ordersUpdated'));
                                                    }
                                                  } catch {}
                                                }
                                              }
                                            } catch (e) {
                                              showError('Cancellation failed. Please try again.');
                                            } finally {
                                              setIsCancelingOrder(false);
                                            }
                                          }}
                                          disabled={isCancelingOrder}
                                          className="px-2.5 py-1 text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-400/5 hover:bg-red-400/10 rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          {isCancelingOrder ? 'Canceling...' : 'Cancel Order'}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
    );
  };

  // Trade history pagination state
  const [tradeOffset, setTradeOffset] = useState(0);
  const [tradeLimit, setTradeLimit] = useState(10);
  const [hasMoreTrades, setHasMoreTrades] = useState(false);
  const [isLoadingTrades, setIsLoadingTrades] = useState(false);

  // Do not reset trade offset on tab changes to avoid re-fetching on click

  // Prefetch trade count for badge whenever wallet or symbol changes
  useEffect(() => {
    const prefetch = async () => {
      try {
        await orderBookActions.getUserTradeCountOnly?.();
      } catch {}
    };
    if (walletAddress) prefetch();
  }, [walletAddress, symbol, orderBookActions.getUserTradeCountOnly]);

  // Load trade history when pagination changes (not on tab click)
  useEffect(() => {
    let isMounted = true;
    let loadingTimeout: NodeJS.Timeout;
    
    const loadTradeHistory = async () => {
      if (!walletAddress) {
        // Clear loading state if we switch away from trades tab
        setIsLoadingTrades(false);
        return;
      }
      
      // Set a minimum loading time to prevent flickering
      loadingTimeout = setTimeout(() => {
        if (isMounted) {
          setIsLoadingTrades(true);
        }
      }, 100); // Small delay before showing loading state

      try {
        const { getUserTradeHistory } = orderBookActions;
        if (!getUserTradeHistory) {
          console.log('[Dispatch] ⏭️ [UI][MarketActivityTabs] getUserTradeHistory not available');
          return;
        }

        console.log('[Dispatch] 📡 [ACTION][MarketActivityTabs] getUserTradeHistory request', { offset: tradeOffset, limit: tradeLimit, symbol })
        const { trades: newTrades, hasMore } = await getUserTradeHistory(tradeOffset, tradeLimit);
        
        // Ensure we keep loading state visible for at least 500ms to prevent flickering
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Only update state if component is still mounted and we have trades
        if (isMounted) {
          if (newTrades && newTrades.length > 0) {
            console.log('[Dispatch] ✅ [ACTION][MarketActivityTabs] getUserTradeHistory response', { count: newTrades.length, hasMore })
            setTrades(newTrades);
            setHasMoreTrades(hasMore);
          }
          setIsLoadingTrades(false);
        }
      } catch (error) {
        console.error('Failed to load trade history:', error);
        if (isMounted) {
          // Don't clear trades on error, keep existing state
          setIsLoadingTrades(false);
        }
      }
    };

    loadTradeHistory();

    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
      clearTimeout(loadingTimeout);
    };
  }, [walletAddress, tradeOffset, tradeLimit, orderBookActions.getUserTradeHistory]);

  const renderTradesTable = () => {

    if (isLoadingTrades) {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-[11px] font-medium text-[#808080]">
              Loading trade history...
            </span>
          </div>
        </div>
      );
    }

    if (!walletAddress) {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
            <span className="text-[11px] font-medium text-[#808080]">
              Connect wallet to view trade history
            </span>
          </div>
        </div>
      );
    }

    if (trades.length === 0) {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
            <span className="text-[11px] font-medium text-[#808080]">
              No trades yet
            </span>
          </div>
        </div>
      );
    }

    // Trade statistics
    const stats = {
      totalVolume: orderBookState.totalVolume,
      totalFees: orderBookState.totalFees,
      buyCount: orderBookState.buyCount,
      sellCount: orderBookState.sellCount,
      avgTradeSize: orderBookState.totalVolume / (orderBookState.buyCount + orderBookState.sellCount),
      avgFee: orderBookState.totalFees / (orderBookState.buyCount + orderBookState.sellCount),
      feeRate: (orderBookState.totalFees / orderBookState.totalVolume) * 100
    };

    return (
      <div className="space-y-4">
        {/* Trade Statistics and Controls Header */}
        <div className="bg-[#0F0F0F] rounded-md border border-[#222222] p-2 flex items-center justify-between overflow-x-auto">
          <div className="flex items-center gap-4">
            <h4 className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide whitespace-nowrap">Trading Performance</h4>
            <div className="flex items-center gap-4 text-nowrap">
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-[#606060] whitespace-nowrap">Volume:</span>
                <span className="text-[10px] font-medium text-white font-mono">${stats.totalVolume.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-[#606060] whitespace-nowrap">Fees:</span>
                <span className="text-[10px] font-medium text-white font-mono">${stats.totalFees.toFixed(4)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-[#606060] whitespace-nowrap">Buy/Sell:</span>
                <span className="text-[10px] font-medium text-white font-mono">{stats.buyCount}/{stats.sellCount}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-[#606060] whitespace-nowrap">Avg Size:</span>
                <span className="text-[10px] font-medium text-white font-mono">${stats.avgTradeSize.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={tradeLimit}
              onChange={(e) => {
                setTradeLimit(Number(e.target.value));
                setTradeOffset(0);
              }}
              className="bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-blue-400"
            >
              <option value="10">10 trades</option>
              <option value="25">25 trades</option>
              <option value="50">50 trades</option>
              <option value="100">100 trades</option>
            </select>
            <span className="text-[10px] text-[#606060]">
              {orderBookState.tradeCount} total trades
            </span>
          </div>
        </div>

        {/* Trade History Table */}
        <div className="overflow-auto scrollbar-hide max-h-96">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#222222]">
                <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Side</th>
                <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Price</th>
                <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Size</th>
                <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Value</th>
                <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Fee</th>
                <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Type</th>
                <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Time</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, index) => {
                const isBuyer = trade.buyer.toLowerCase() === walletAddress?.toLowerCase();
                const side = isBuyer ? 'BUY' : 'SELL';
                const fee = isBuyer ? trade.buyerFee : trade.sellerFee;
                const isMargin = isBuyer ? trade.buyerIsMargin : trade.sellerIsMargin;

                return (
                  <tr key={`${trade.tradeId}-${index}`} className={`hover:bg-[#1A1A1A] transition-colors duration-200 ${index !== trades.length - 1 ? 'border-b border-[#1A1A1A]' : ''}`}>
                    <td className="px-2.5 py-2.5">
                      <span className={`text-[11px] font-medium ${side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{side}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-white font-mono">${trade.price.toFixed(2)}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-white font-mono">{trade.amount.toFixed(4)}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-white font-mono">${trade.tradeValue.toFixed(2)}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-white font-mono">${fee.toFixed(4)}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-[#9CA3AF]">{isMargin ? 'Margin' : 'Spot'}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-[#9CA3AF]">{formatTime(trade.timestamp)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Navigation Controls */}
        <div className="flex items-center justify-end pt-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTradeOffset(Math.max(0, tradeOffset - tradeLimit))}
              disabled={tradeOffset === 0}
              className="px-2 py-1 text-[11px] text-[#808080] hover:text-white disabled:text-[#404040] disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setTradeOffset(tradeOffset + tradeLimit)}
              disabled={!hasMoreTrades}
              className="px-2 py-1 text-[11px] text-[#808080] hover:text-white disabled:text-[#404040] disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>

        {/* Legend */}
        {/* <div className="text-[10px] text-[#606060] pt-2">
          <div>• Side: Your perspective (BUY/SELL)</div>
          <div>• Type: Margin or Spot trade</div>
          <div>• Fees shown are what you paid</div>
          <div>• Times shown in your local timezone</div>
        </div> */}
      </div>
    );
  };

  const renderOrderHistoryTable = () => {
    if (orderHistory.length === 0) {
      return (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">
                        No order history
                      </span>
                    </div>
                  </div>
      );
    }

    return (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#222222]">
                        <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Side</th>
                        <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Type</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Price</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Size</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Filled</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Status</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderHistory.map((order, index) => (
                        <tr key={`${order.id}-${index}`} className={`hover:bg-[#1A1A1A] transition-colors duration-200 ${index !== orderHistory.length - 1 ? 'border-b border-[#1A1A1A]' : ''}`}>
                          <td className="px-2.5 py-2.5">
                            <span className={`text-[11px] font-medium ${order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{order.side}</span>
                          </td>
                          <td className="px-2.5 py-2.5">
                            <span className="text-[11px] text-white">{order.type}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">${order.price.toFixed(2)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">{order.size.toFixed(4)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">{order.filled.toFixed(4)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-[#9CA3AF]">{order.status}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-[#9CA3AF]">{formatDate(order.timestamp)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
    );
  };

  return (
    <div className={`group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 flex flex-col ${className}`}>
      {/* Status Modals */}
      <style jsx global>{`
        .scrollbar-hide {
          overflow-y: auto !important;
          scrollbar-width: none !important; /* Firefox */
          -ms-overflow-style: none !important; /* IE and Edge */
          -webkit-overflow-scrolling: touch !important;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
          background: transparent !important;
        }
        /* Cascading slide-in from right to left */
        @keyframes matSlideRtl {
          0% {
            opacity: 0;
            transform: translateX(12px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .mat-slide-rtl {
          opacity: 0;
          transform: translateX(12px);
          animation: matSlideRtl 300ms ease-out forwards;
          will-change: transform, opacity;
        }
      `}</style>
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
      
      <div className="flex items-center justify-between border-b border-[#222222] p-2.5 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === 'orders') {
                  logGoddMat(26, 'Orders tab clicked; triggering refreshPortfolioOrders');
                  void refreshPortfolioOrders();
                }
              }}
              className={`px-2.5 py-1.5 text-[11px] font-medium rounded transition-all duration-200 flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'text-white bg-[#1A1A1A] border border-[#333333]'
                  : 'text-[#808080] hover:text-white hover:bg-[#1A1A1A] border border-transparent hover:border-[#222222]'
              }`}
            >
              <span>{tab.label}</span>
              <div className="text-[10px] text-[#606060] bg-[#2A2A2A] px-1.5 py-0.5 rounded">
                {tab.count}
              </div>
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-2">
          {isLoading ? (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[10px] text-[#606060]">Loading...</span>
            </>
          ) : (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-[10px] text-[#606060]">Live</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        {!walletAddress ? (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">
                Connect wallet to view {activeTab}
                      </span>
                    </div>
                  </div>
                ) : (
          <div className="min-w-full h-full">
            {activeTab === 'positions' && renderPositionsTable()}
            {activeTab === 'orders' && renderOpenOrdersTable()}
            {activeTab === 'trades' && renderTradesTable()}
            {activeTab === 'history' && renderOrderHistoryTable()}
          </div>
        )}
      </div>

      {showCloseModal && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => {
            setShowCloseModal(false);
            setCloseSize('');
            setCloseError(null);
          }}
        >
          <div 
            className="bg-[#1A1A1A] border border-[#333333] rounded-md p-6 w-96 max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <img 
                    src="/Dexicon/LOGO-Dexetera-01.svg" 
                    alt="Dexetera Logo" 
                    className="w-5 h-5"
                  />
                  <h3 className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                    Close Position - {closeSymbol}
                  </h3>
                </div>
                <button
                  onClick={() => setShowCloseModal(false)}
                  className="text-[#606060] hover:text-white transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="h-[1px] bg-gradient-to-r from-transparent via-[#333333] to-transparent" />
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-2 bg-[#0F0F0F] rounded">
                <span className="text-[10px] text-[#808080]">Position Size</span>
                <span className="text-[11px] font-medium text-white font-mono">
                  {maxSize.toFixed(2)}
                </span>
              </div>
              
              <div>
                <label className="block text-[10px] text-[#9CA3AF] mb-1">
                  Close Size
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={closeSize}
                    onChange={(e) => {
                      setCloseSize(e.target.value);
                      setCloseError(null);
                    }}
                    className={`w-full bg-[#0F0F0F] border rounded px-3 py-2 text-[11px] text-white font-mono focus:outline-none transition-colors ${
                      closeError 
                        ? 'border-red-500 focus:border-red-400' 
                        : 'border-[#333333] focus:border-blue-400'
                    }`}
                    placeholder="Enter amount"
                    min="0"
                    max={maxSize}
                    step="0.0001"
                    disabled={isClosing}
                  />
                  <button
                    onClick={() => {
                      setCloseSize(maxSize.toString());
                      setCloseError(null);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-blue-400 hover:text-blue-300"
                    disabled={isClosing}
                  >
                    MAX
                  </button>
                </div>
                {closeError && (
                  <div className="mt-1">
                    <span className="text-[10px] text-red-400">{closeError}</span>
                  </div>
                )}
              </div>
              
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowCloseModal(false);
                    setCloseSize('');
                    setCloseError(null);
                  }}
                  className="px-3 py-1.5 text-[11px] font-medium text-[#808080] hover:text-white bg-[#2A2A2A] hover:bg-[#333333] rounded transition-colors"
                  disabled={isClosing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCloseSubmit}
                  disabled={isClosing || !closeSize || parseFloat(closeSize) <= 0 || parseFloat(closeSize) > maxSize}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1.5 ${
                    isClosing || !closeSize || parseFloat(closeSize) <= 0 || parseFloat(closeSize) > maxSize
                      ? 'text-[#606060] bg-[#2A2A2A] cursor-not-allowed'
                      : 'text-white bg-red-500 hover:bg-red-600'
                  }`}
                >
                  {isClosing ? (
                    <>
                      <div className="w-3 h-3 border-2 border-t-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
                      <span>Closing...</span>
                    </>
                  ) : (
                    'Confirm Close'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTopUpModal && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => {
            setShowTopUpModal(false);
            setTopUpAmount('');
          }}
        >
          <div 
            className="bg-[#1A1A1A] border border-[#333333] rounded-md p-6 w-96 max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                Top Up Position - {topUpSymbol}
              </h3>
              <button
                onClick={() => setShowTopUpModal(false)}
                className="text-[#606060] hover:text-white transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-2 bg-[#0F0F0F] rounded">
                <span className="text-[10px] text-[#808080]">Current Margin</span>
                <span className="text-[11px] font-medium text-white font-mono">
                  ${currentMargin.toFixed(2)}
                              </span>
                            </div>
              
              <div>
                <label className="block text-[10px] text-[#9CA3AF] mb-1">
                  Additional Margin (USDC)
                </label>
                <input
                  type="number"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="w-full bg-[#0F0F0F] border border-[#333333] rounded px-3 py-2 text-[11px] text-white font-mono focus:outline-none focus:border-blue-400 transition-colors"
                  placeholder="Enter amount"
                  min="0"
                  step="0.01"
                />
              </div>
              
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowTopUpModal(false);
                    setTopUpAmount('');
                  }}
                  className="px-3 py-1.5 text-[11px] font-medium text-[#808080] hover:text-white bg-[#2A2A2A] hover:bg-[#333333] rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTopUpSubmit}
                  disabled={!topUpAmount || parseFloat(topUpAmount) <= 0}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded transition-colors ${
                    !topUpAmount || parseFloat(topUpAmount) <= 0
                      ? 'text-[#606060] bg-[#2A2A2A] cursor-not-allowed'
                      : 'text-white bg-blue-500 hover:bg-blue-600'
                  }`}
                >
                  Confirm Top-Up
                </button>
              </div>
            </div>
          </div>
        </div>
        )}
    </div>
  );
}