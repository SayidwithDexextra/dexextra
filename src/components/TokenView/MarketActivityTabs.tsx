'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '@/hooks/useWallet';
import { useMarketData } from '@/contexts/MarketDataContext';
import { initializeContracts } from '@/lib/contracts';
import { ensureHyperliquidWallet } from '@/lib/network';
import { ErrorModal, SuccessModal } from '@/components/StatusModals';
import { useMarkets } from '@/hooks/useMarkets';
import { cancelOrderForMarket } from '@/hooks/useOrderBook';
import { usePortfolioData } from '@/hooks/usePortfolioData';
import type { Address } from 'viem';
import { signAndSubmitGasless, createGaslessSession, submitSessionTrade } from '@/lib/gasless';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import { gaslessTopUpPosition } from '@/lib/gaslessTopup';
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
  const [positions, setPositions] = useState<Position[]>([]); // base positions (from vault reads)
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
  // Event-driven only (no polling). Positions refresh via 'positionsRefreshRequested' / 'ordersUpdated'.
  // Disable autoRefresh polling; markets are fetched once on mount.
  const { markets } = useMarkets({ limit: 500, autoRefresh: false });
  const { positions: allPositions, isLoadingPositions: positionsIsLoading, ordersBuckets, isLoadingOrders } = usePortfolioData({
    enabled: !!walletAddress,
    // Disable polling; orders refresh via 'ordersUpdated' events.
    refreshInterval: 0
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
  
  // Optimistic overlay for positions on trade events (prevents "revert" when vault reads lag a block).
  // We keep small deltas for a short TTL and render basePositions + deltas.
  const posOverlayRef = useRef<Map<string, { delta: number; expiresAt: number }>>(new Map());
  const appliedTraceRef = useRef<Map<string, number>>(new Map());
  const [posOverlayTick, setPosOverlayTick] = useState(0); // re-render trigger

  const displayedPositions = useMemo(() => {
    const base = Array.isArray(positions) ? positions : [];
    const now = Date.now();
    const overlay = posOverlayRef.current;
    const next: Position[] = [];
    for (const p of base) {
      const sym = String(p.symbol || '').toUpperCase();
      const o = overlay.get(sym);
      if (!o || o.expiresAt <= now || !Number.isFinite(o.delta) || o.delta === 0) {
        next.push(p);
        continue;
      }
      const signed = p.side === 'LONG' ? p.size : -p.size;
      const nextSigned = signed + o.delta;
      if (Math.abs(nextSigned) < 1e-12) continue;
      const nextSide: Position['side'] = nextSigned >= 0 ? 'LONG' : 'SHORT';
      next.push({ ...p, side: nextSide, size: Math.abs(nextSigned) });
    }
    // Add new positions created purely from overlay (no base yet)
    for (const [sym, o] of overlay.entries()) {
      if (o.expiresAt <= now || !Number.isFinite(o.delta) || o.delta === 0) continue;
      const exists = next.some((p) => String(p.symbol || '').toUpperCase() === sym);
      if (exists) continue;
      next.push({
        id: `${sym}:${now}`,
        symbol: sym,
        side: o.delta >= 0 ? 'LONG' : 'SHORT',
        size: Math.abs(o.delta),
        entryPrice: 0,
        markPrice: 0,
        pnl: 0,
        pnlPercent: 0,
        liquidationPrice: 0,
        margin: 0,
        leverage: 1,
        timestamp: now,
        isUnderLiquidation: false,
      });
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, posOverlayTick]);

  // Immediate optimistic UI patch for Open Orders on `ordersUpdated`.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!walletAddress) return;

    const onOrdersUpdated = (e: any) => {
      const detail = (e as CustomEvent)?.detail as any;
      const traceId = String(detail?.traceId || '');
      const now = Date.now();
      if (traceId) {
        const prev = openOrdersOverlayRef.current.seenTrace.get(traceId) || 0;
        if (now - prev < 10_000) return;
        openOrdersOverlayRef.current.seenTrace.set(traceId, now);
      }

      const sym = String(detail?.symbol || '').toUpperCase();
      const trader = String(detail?.trader || '').toLowerCase();
      const me = String(walletAddress || '').toLowerCase();
      if (!sym || !me) return;
      // Only mutate UI for the current wallet's orders when trader is present
      if (trader && trader !== me) return;

      const eventType = String(detail?.eventType || detail?.reason || '').trim();
      const orderId = detail?.orderId !== undefined ? String(detail.orderId) : '';
      const ttlMs = 8_000;

      if (eventType === 'OrderCancelled' || eventType === 'cancel') {
        if (orderId) {
          // Ensure a cancel can't leave behind a stale optimistic "added" order (which can render as 0/0/0).
          openOrdersOverlayRef.current.removed.set(orderId, now + ttlMs);
          openOrdersOverlayRef.current.added.delete(orderId);
        }
        setOpenOrdersOverlayTick((x) => x + 1);
        // eslint-disable-next-line no-console
        console.log('[RealTimeToken] ui:openOrders:patched', { traceId, symbol: sym, eventType, orderId, action: 'remove' });
        return;
      }

      // Treat as an order placement only when we have enough fields to render a real row.
      // IMPORTANT: don't treat empty eventType as "placed" (it can be a partial/unknown payload) or we may add 0/0/0 rows.
      const isPlacementEvent = eventType === 'OrderPlaced' || eventType === 'order-placed';
      if (isPlacementEvent) {
        if (!orderId) return;
        // If we already marked this id removed, don't re-add it (race between cancel + stale updates).
        if (openOrdersOverlayRef.current.removed.has(orderId)) return;

        let priceNum = 0;
        let sizeNum = 0;
        try {
          const pStr = String(detail?.price || '0');
          priceNum = parseFloat(ethers.formatUnits(BigInt(pStr), 6)); // 6 decimals
          if (!Number.isFinite(priceNum)) priceNum = 0;
        } catch {}
        try {
          const aStr = String(detail?.amount || '0');
          sizeNum = parseFloat(ethers.formatUnits(BigInt(aStr), 18)); // 18 decimals
          if (!Number.isFinite(sizeNum)) sizeNum = 0;
        } catch {}

        // If we don't have a real price/size, skip creating an optimistic order row.
        if (!(priceNum > 0) || !(sizeNum > 0)) {
          // eslint-disable-next-line no-console
          console.warn('[RealTimeToken] ui:openOrders:skip:add:missing-fields', { traceId, symbol: sym, eventType, orderId, priceNum, sizeNum });
          return;
        }

        const isBuy = detail?.isBuy === undefined ? true : Boolean(detail.isBuy);
        const side: Order['side'] = isBuy ? 'BUY' : 'SELL';

        const optimistic: Order = {
          id: orderId,
          symbol: sym,
          side,
          type: 'LIMIT',
          price: priceNum,
          size: sizeNum,
          filled: 0,
          status: 'PENDING',
          timestamp: now,
          metricId: sym,
        };

        openOrdersOverlayRef.current.added.set(orderId, { order: optimistic, expiresAt: now + ttlMs });
        setOpenOrdersOverlayTick((x) => x + 1);
        // eslint-disable-next-line no-console
        console.log('[RealTimeToken] ui:openOrders:patched', { traceId, symbol: sym, eventType: 'OrderPlaced', orderId, action: 'add' });
      }
    };

    window.addEventListener('ordersUpdated', onOrdersUpdated as EventListener);
    return () => window.removeEventListener('ordersUpdated', onOrdersUpdated as EventListener);
  }, [walletAddress]);

  // Immediate UI patch for positions on trade events (no waiting on contract reads).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!walletAddress) return;

    const onPositionsRefresh = (e: any) => {
      const detail = (e as CustomEvent)?.detail as any;
      const sym = String(detail?.symbol || '').toUpperCase();
      const traceId = String(detail?.traceId || '');
      const buyer = String(detail?.buyer || '').toLowerCase();
      const seller = String(detail?.seller || '').toLowerCase();
      const me = String(walletAddress || '').toLowerCase();
      if (!sym || !me) return;
      if (buyer !== me && seller !== me) return;

      // Dedup repeated dispatches for the same tx/trace in a short window
      if (traceId) {
        const now = Date.now();
        const prev = appliedTraceRef.current.get(traceId) || 0;
        if (now - prev < 10_000) return;
        appliedTraceRef.current.set(traceId, now);
      }

      let delta = 0;
      try {
        const amtStr = String(detail?.amount || '0');
        // amount is units in 18 decimals
        delta = parseFloat(ethers.formatUnits(BigInt(amtStr), 18));
        if (!Number.isFinite(delta)) delta = 0;
      } catch {
        delta = 0;
      }
      if (delta === 0) return;

      const signedDelta = buyer === me ? delta : -delta;
      const now = Date.now();
      const ttlMs = 8_000; // keep overlay long enough for vault to catch up
      const existing = posOverlayRef.current.get(sym);
      const nextDelta = (existing?.delta || 0) + signedDelta;
      posOverlayRef.current.set(sym, { delta: nextDelta, expiresAt: now + ttlMs });
      // eslint-disable-next-line no-console
      console.log('[RealTimeToken] ui:positions:patched', { traceId, symbol: sym, signedDelta, overlayDelta: nextDelta });
      setPosOverlayTick((x) => x + 1);
    };

    window.addEventListener('positionsRefreshRequested', onPositionsRefresh as EventListener);
    return () => {
      window.removeEventListener('positionsRefreshRequested', onPositionsRefresh as EventListener);
    };
  }, [walletAddress]);

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
  const [isToppingUp, setIsToppingUp] = useState(false);

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
    // Temporary: disable gasless top-up while CoreVault metaTopUp is under investigation
    showError(
      'Gasless margin top-up is temporarily disabled while we upgrade the vault. ' +
      'You can still adjust risk by closing or reducing positions.'
    , 'Top-up unavailable');
    return;

    if (!topUpPositionId || !topUpAmount || !walletAddress) return;

    const amtNum = Number(topUpAmount);
    if (Number.isNaN(amtNum) || amtNum <= 0) {
      showError('Enter a valid top-up amount greater than 0');
      return;
    }

    setIsToppingUp(true);
    try {
      console.log(`Topping up position ${topUpPositionId} for ${topUpSymbol} with amount ${topUpAmount}`);
      const marketId = topUpPositionId as string;

      if (GASLESS) {
        const res = await gaslessTopUpPosition({
          vault: CONTRACT_ADDRESSES.CORE_VAULT,
          trader: walletAddress,
          marketId,
          amount: topUpAmount,
        });
        if (!res.success) throw new Error(res.error || 'gasless top-up failed');
        console.log('Gasless top-up tx:', res.txHash);
      } else {
        // Fallback: direct signer flow
        let signer: ethers.Signer | null = null;
        if (typeof window !== 'undefined' && (window as any).ethereum) {
          signer = await ensureHyperliquidWallet();
        }
        if (!signer) {
          throw new Error('No signer available. Please connect your wallet.');
        }
        const contracts = await initializeContracts({ providerOrSigner: signer });
        const amount6 = ethers.parseUnits(topUpAmount, 6);
        const tx = await contracts.vault.topUpPositionMargin(marketId, amount6);
        await tx.wait();
      }

      setTopUpAmount('');
      setTopUpPositionId(null);
      setTopUpSymbol('');
      setShowTopUpModal(false);
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('positionsRefreshRequested'));
        }
      } catch {}
      showSuccess('Position top-up submitted. Pending confirmation.', 'Top-up sent');
    } catch (error: any) {
      console.error('Error topping up position:', error);
      showError(error?.message || 'Failed to top up position. Please try again.');
    } finally {
      setIsToppingUp(false);
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
            window.dispatchEvent(new CustomEvent('ordersUpdated', { detail: { symbol: metricId, reason: 'close', timestamp: Date.now() } }));
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
            window.dispatchEvent(new CustomEvent('ordersUpdated', { detail: { symbol: metricId, reason: 'close', timestamp: Date.now() } }));
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
        let qty = normalizeQuantity(Number(o?.quantity || 0));
        let filledQty = normalizeQuantity(Number(o?.filledQuantity || 0));
        flat.push({
          id: String(o?.id || ''),
          symbol: symbolUpper,
          side: (sideStr === 'BUY' ? 'BUY' : 'SELL'),
          type: typeStr === 'MARKET' ? 'MARKET' : 'LIMIT',
          price: Number(o?.price || 0),
          size: qty,
          filled: filledQty,
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
    // Defensive: never render a LIMIT order with non-positive price/size. This usually indicates a stale/partial
    // optimistic/session snapshot, and it matches the "$0 / 0 / 0" ghost rows we've observed after cancels.
    return flat
      .filter((o) => o.status !== 'CANCELLED' && o.status !== 'FILLED' && !optimisticallyRemovedOrderIds.has(String(o.id)))
      .filter((o) => {
        const sizeOk = Number(o.size) > 0;
        const priceOk = o.type === 'LIMIT' ? Number(o.price) > 0 : true;
        if (!sizeOk || !priceOk) {
          // eslint-disable-next-line no-console
          console.warn('[RealTimeToken] ui:openOrders:skip:invalid-order', {
            id: String(o.id),
            symbol: o.symbol,
            type: o.type,
            status: o.status,
            price: o.price,
            size: o.size,
            filled: o.filled,
          });
          return false;
        }
        return true;
      });
  }, [ordersBuckets, flattenOrderBuckets, optimisticallyRemovedOrderIds]);
  const openOrdersIsLoading = Boolean(isLoadingOrders && activeTab === 'orders');

  // Optimistic overlay for open orders driven by `ordersUpdated` event detail.
  // Prevents flicker/revert while backend/onchain read catches up.
  const openOrdersOverlayRef = useRef<{
    added: Map<string, { order: Order; expiresAt: number }>;
    removed: Map<string, number>;
    seenTrace: Map<string, number>;
  }>({ added: new Map(), removed: new Map(), seenTrace: new Map() });
  const [openOrdersOverlayTick, setOpenOrdersOverlayTick] = useState(0);

  const displayedOpenOrders = useMemo(() => {
    const base = Array.isArray(openOrders) ? openOrders : [];
    const now = Date.now();
    const overlay = openOrdersOverlayRef.current;

    // prune expired
    for (const [id, until] of overlay.removed.entries()) {
      if (until <= now) overlay.removed.delete(id);
    }
    for (const [id, rec] of overlay.added.entries()) {
      if (rec.expiresAt <= now) overlay.added.delete(id);
    }

    const next = base.filter((o) => !overlay.removed.has(String(o.id)));
    for (const rec of overlay.added.values()) {
      const id = String(rec.order.id);
      // Never show an optimistic "added" order if we've also marked it removed (race safety).
      if (overlay.removed.has(id)) continue;
      const exists = next.some((o) => String(o.id) === id);
      if (!exists) next.push(rec.order);
    }
    // Stable ordering: newest first
    next.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOrders, openOrdersOverlayTick]);
  const lastUiLogRef = useRef<{ key: string } | null>(null);

  useEffect(() => {
    if (!walletAddress) return;
    logGoddMat(21, 'MarketActivityTabs updated openOrders derived state', {
      bucketCount: ordersBuckets.length,
      flattenedOrderCount: displayedOpenOrders.length,
      activeTab
    });
  }, [walletAddress, ordersBuckets, displayedOpenOrders.length, activeTab]);

  // Real-time UI update log (post-render): confirms the Open Orders UI state changed.
  useEffect(() => {
    if (!walletAddress) return;
    const key = `${activeTab}:${ordersBuckets.length}:${displayedOpenOrders.length}:${optimisticallyRemovedOrderIds.size}`;
    if (lastUiLogRef.current?.key === key) return;
    lastUiLogRef.current = { key };
    // eslint-disable-next-line no-console
    console.log('[RealTimeToken] ui:openOrders:rendered', {
      activeTab,
      bucketCount: ordersBuckets.length,
      openOrdersCount: displayedOpenOrders.length,
      hiddenOptimisticCount: optimisticallyRemovedOrderIds.size,
    });
  }, [walletAddress, activeTab, ordersBuckets.length, displayedOpenOrders.length, optimisticallyRemovedOrderIds.size]);
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
    { id: 'positions' as TabType, label: 'Positions', count: displayedPositions.length },
    { id: 'orders' as TabType, label: 'Open Orders', count: displayedOpenOrders.length },
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

  // Display helpers
  const formatPrice = (value: number) =>
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);

  const formatAmount = (value: number, decimals = 4) => {
    if (!Number.isFinite(value) || value === 0) return '0.0000';
    if (value < 0.00000001 && value > 0) return value.toFixed(8);
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: Math.min(decimals, 4),
      maximumFractionDigits: decimals,
    }).format(value);
  };

  const normalizeQuantity = (qty: number) => {
    const n = Number.isFinite(qty) ? qty : 0;
    // Orders often arrive in 1e12 base units; scale down when clearly oversized
    if (n >= 1_000_000) return n / 1_000_000_000_000;
    return n;
  };

  const renderPositionsTable = () => {
    if (displayedPositions.length === 0) {
  return (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${positionsIsLoading ? 'bg-blue-400 animate-pulse' : 'bg-[#404040]'}`} />
                      <span className="text-[11px] font-medium text-[#E5E7EB]">
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
                      {displayedPositions.map((position, index) => (
            <React.Fragment key={`${position.id}-${index}`}>
              <tr className={`mat-slide-rtl group/row transition-colors duration-200 ${
                position.isUnderLiquidation 
                  ? 'bg-yellow-400/5 hover:bg-yellow-400/10 border-yellow-400/20'
                  : 'hover:bg-[#1A1A1A]'
              } ${
                index !== displayedPositions.length - 1 ? 'border-b border-[#1A1A1A]' : ''
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
                                <span className="text-[10px] text-[#CBD5E1]">{position.symbol}</span>
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
                            <span className="text-[11px] text-white font-mono">${formatPrice(position.markPrice)}</span>
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
                                  ${formatPrice(position.liquidationPrice)}
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
                    className="opacity-0 group-hover/row:opacity-100 transition-opacity duration-200 px-1.5 py-0.5 text-[9px] text-[#E5E7EB] hover:text-white hover:bg-[#2A2A2A] rounded"
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
                                <span className="text-[9px] text-[#CBD5E1]">Current Margin</span>
                                <span className={`text-[10px] font-medium font-mono ${
                                  position.isUnderLiquidation ? 'text-yellow-400' : 'text-white'
                                }`}>
                                  ${position.margin.toFixed(2)}
                                </span>
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-[9px] text-[#CBD5E1]">Leverage</span>
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
    if (displayedOpenOrders.length === 0) {
      return (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${openOrdersIsLoading ? 'bg-blue-400 animate-pulse' : 'bg-[#404040]'}`} />
                      <span className="text-[11px] font-medium text-[#E5E7EB]">
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
                      {displayedOpenOrders.map((order, index) => (
                        <React.Fragment key={`${order.id}-${index}`}>
                          <tr className={`mat-slide-rtl hover:bg-[#1A1A1A] transition-colors duration-200 ${index !== displayedOpenOrders.length - 1 ? 'border-b border-[#1A1A1A]' : ''}`} style={{ animationDelay: `${index * 50}ms` }}>
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
                                  <span className="text-[10px] text-[#CBD5E1]">{order.symbol}</span>
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
                              <span className="text-[11px] text-white font-mono">${formatPrice(order.price)}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <span className="text-[11px] text-white font-mono">{formatAmount(order.size, 4)}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <span className="text-[11px] text-white font-mono">{formatAmount(order.filled, 4)}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <span className="text-[11px] text-[#9CA3AF]">{order.status}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <button
                                onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 px-1.5 py-0.5 text-[9px] text-[#E5E7EB] hover:text-white hover:bg-[#2A2A2A] rounded"
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
                                          <span className="text-[9px] text-[#CBD5E1]">Order Value</span>
                                          <span className="text-[10px] font-medium text-white font-mono">
                                            ${formatPrice(order.price * order.size)}
                                          </span>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                          <span className="text-[9px] text-[#CBD5E1]">Fill Progress</span>
                                          <span className="text-[10px] font-medium text-white font-mono">
                                            {order.size > 0 ? ((order.filled / order.size) * 100).toFixed(1) : '0.0'}%
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
                                                try {
                                                  if (typeof window !== 'undefined') {
                                                    const remaining = Math.max(0, Number(order.size || 0) - Number(order.filled || 0));
                                                    let price6 = '0';
                                                    let amount18 = '0';
                                                    try { price6 = String(ethers.parseUnits(String(order.price || 0), 6)); } catch {}
                                                    try { amount18 = String(ethers.parseUnits(String(remaining), 18)); } catch {}
                                                    window.dispatchEvent(new CustomEvent('ordersUpdated', {
                                                      detail: {
                                                        symbol: metric,
                                                        eventType: 'OrderCancelled',
                                                        reason: 'cancel',
                                                        orderId: String(order.id),
                                                        trader: String(walletAddress || ''),
                                                        // For optimistic OrderBook depth patching (TransactionTable)
                                                        price: price6,
                                                        amount: amount18,
                                                        isBuy: String(order.side || '').toUpperCase() === 'BUY',
                                                        timestamp: Date.now()
                                                      }
                                                    }));
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
                                                    if (typeof window !== 'undefined') {
                                                      const remaining = Math.max(0, Number(order.size || 0) - Number(order.filled || 0));
                                                      let price6 = '0';
                                                      let amount18 = '0';
                                                      try { price6 = String(ethers.parseUnits(String(order.price || 0), 6)); } catch {}
                                                      try { amount18 = String(ethers.parseUnits(String(remaining), 18)); } catch {}
                                                      window.dispatchEvent(new CustomEvent('ordersUpdated', {
                                                        detail: {
                                                          symbol: metric,
                                                          eventType: 'OrderCancelled',
                                                          reason: 'cancel',
                                                          orderId: String(order.id),
                                                          trader: String(walletAddress || ''),
                                                          price: price6,
                                                          amount: amount18,
                                                          isBuy: String(order.side || '').toUpperCase() === 'BUY',
                                                          timestamp: Date.now()
                                                        }
                                                      }));
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
            <span className="text-[11px] font-medium text-[#E5E7EB]">
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
            <span className="text-[11px] font-medium text-[#E5E7EB]">
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
            <span className="text-[11px] font-medium text-[#E5E7EB]">
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
                <span className="text-[9px] text-[#CBD5E1] whitespace-nowrap">Volume:</span>
                <span className="text-[10px] font-medium text-white font-mono">${stats.totalVolume.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-[#CBD5E1] whitespace-nowrap">Fees:</span>
                <span className="text-[10px] font-medium text-white font-mono">${stats.totalFees.toFixed(4)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-[#CBD5E1] whitespace-nowrap">Buy/Sell:</span>
                <span className="text-[10px] font-medium text-white font-mono">{stats.buyCount}/{stats.sellCount}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-[#CBD5E1] whitespace-nowrap">Avg Size:</span>
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
            <span className="text-[10px] text-[#CBD5E1]">
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
              className="px-2 py-1 text-[11px] text-[#E5E7EB] hover:text-white disabled:text-[#404040] disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setTradeOffset(tradeOffset + tradeLimit)}
              disabled={!hasMoreTrades}
              className="px-2 py-1 text-[11px] text-[#E5E7EB] hover:text-white disabled:text-[#404040] disabled:cursor-not-allowed"
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
                      <span className="text-[11px] font-medium text-[#E5E7EB]">
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
                            <span className="text-[11px] text-white font-mono">${formatPrice(order.price)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">{formatAmount(order.size, 4)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">{formatAmount(order.filled, 4)}</span>
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
                  logGoddMat(26, 'Orders tab clicked', { activeTab: tab.id });
                }
              }}
              className={`px-2.5 py-1.5 text-[11px] font-medium rounded transition-all duration-200 flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'text-white bg-[#1A1A1A] border border-[#333333]'
                  : 'text-[#E5E7EB] hover:text-white hover:bg-[#1A1A1A] border border-transparent hover:border-[#222222]'
              }`}
            >
              <span>{tab.label}</span>
              <div className="text-[10px] text-[#CBD5E1] bg-[#2A2A2A] px-1.5 py-0.5 rounded">
                {tab.count}
              </div>
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-2">
          {isLoading ? (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[10px] text-[#CBD5E1]">Loading...</span>
            </>
          ) : (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-[10px] text-[#CBD5E1]">Live</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        {!walletAddress ? (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#E5E7EB]">
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
                  className="text-[#CBD5E1] hover:text-white transition-colors"
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
                <span className="text-[10px] text-[#E5E7EB]">Position Size</span>
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
                  className="px-3 py-1.5 text-[11px] font-medium text-[#E5E7EB] hover:text-white bg-[#2A2A2A] hover:bg-[#333333] rounded transition-colors"
                  disabled={isClosing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCloseSubmit}
                  disabled={isClosing || !closeSize || parseFloat(closeSize) <= 0 || parseFloat(closeSize) > maxSize}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1.5 ${
                    isClosing || !closeSize || parseFloat(closeSize) <= 0 || parseFloat(closeSize) > maxSize
                      ? 'text-[#CBD5E1] bg-[#2A2A2A] cursor-not-allowed'
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
                className="text-[#CBD5E1] hover:text-white transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-2 bg-[#0F0F0F] rounded">
                <span className="text-[10px] text-[#E5E7EB]">Current Margin</span>
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
                  className="px-3 py-1.5 text-[11px] font-medium text-[#E5E7EB] hover:text-white bg-[#2A2A2A] hover:bg-[#333333] rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  disabled={isToppingUp}
                >
                  Cancel
                </button>
                <button
                  onClick={handleTopUpSubmit}
                  disabled={!topUpAmount || parseFloat(topUpAmount) <= 0 || isToppingUp}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded transition-colors ${
                    !topUpAmount || parseFloat(topUpAmount) <= 0 || isToppingUp
                      ? 'text-[#CBD5E1] bg-[#2A2A2A] cursor-not-allowed'
                      : 'text-white bg-blue-500 hover:bg-blue-600'
                  }`}
                >
                  {isToppingUp ? 'Submitting...' : 'Confirm Top-Up'}
                </button>
              </div>
            </div>
          </div>
        </div>
        )}
    </div>
  );
}