'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ethers } from 'ethers';
import { useWallet } from '@/hooks/useWallet';
import { useMarketData } from '@/contexts/MarketDataContext';
import { initializeContracts } from '@/lib/contracts';
import { ensureHyperliquidWallet } from '@/lib/network';
import { getActiveEthereumProvider } from '@/lib/wallet';
import { useMarkets } from '@/hooks/useMarkets';
import { cancelOrderForMarket } from '@/hooks/useOrderBook';
import { usePortfolioSnapshot } from '@/contexts/PortfolioSnapshotContext';
import type { Address } from 'viem';
import { signAndSubmitGasless, submitSessionTrade, isSessionErrorMessage } from '@/lib/gasless';
import { CHAIN_CONFIG, CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import { gaslessTopUpPosition, sessionTopUpPosition } from '@/lib/gaslessTopup';
import { parseUnits } from 'viem';
import { useSession } from '@/contexts/SessionContext';
import { normalizeBytes32Hex } from '@/lib/hex';
import { useWalkthrough } from '@/contexts/WalkthroughContext';
import { useOnchainOrders } from '@/contexts/OnchainOrdersContextV2';
import { OrderFillLoadingModal, type OrderFillStatus } from '@/components/TokenView/OrderFillLoadingModal';
import { MarketIconBadge } from '@/components/widgets/MarketIconBadge';

const UI_UPDATE_PREFIX = '[UI,Update]';

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
  /** Raw absolute size as string (Wei units, 18 decimals) to preserve full precision for closing positions */
  rawSize?: string;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  pnlPercent: number;
  liquidationPrice: number;
  margin: number;
  leverage: number;
  timestamp: number;
  isUnderLiquidation?: boolean;
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
  orderBookAddress?: string | null;
  txHash?: string;
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
  /** True if this trade was part of a liquidation (counterparty is the OrderBook contract) */
  isLiquidation?: boolean;
  /** The OrderBook contract address - used for liquidation detection */
  orderBookAddress?: Address;
}

interface ClosedPosition {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  size: number;
  entryValue: number;
  exitValue: number;
  pnl: number;
  pnlPercent: number;
  totalFees: number;
  entryTime: number;
  exitTime: number;
  settledViaSettlement?: boolean;
  /** True if position was closed via liquidation */
  wasLiquidated?: boolean;
  /** The margin that was locked for this position (for liquidation loss calculation) */
  marginLocked?: number;
}

export interface SettlementPnLSummary {
  settlementPrice: number;
  totalPnl: number;
  totalMarginUsed: number;
  returnOnMargin: number;
  totalFees: number;
  longCount: number;
  shortCount: number;
  longPnl: number;
  shortPnl: number;
  settledPositions: ClosedPosition[];
  openLotsPnl: number;
  closedPnl: number;
}

type TabType = 'positions' | 'orders' | 'trades' | 'history';

interface MarketActivityTabsProps {
  symbol: string;
  className?: string;
  onSettlementPnl?: (pnl: SettlementPnLSummary | null) => void;
  onChainSettlementPrice?: number;
}

export default function MarketActivityTabs({ symbol, className = '', onSettlementPnl, onChainSettlementPrice }: MarketActivityTabsProps) {
  const walkthrough = useWalkthrough();
  const walkthroughStepId = walkthrough.currentStep?.id || null;
  const forcePositionManageVisible =
    Boolean(walkthrough.state.active) && walkthroughStepId === 'token-activity-manage';

  const [activeTab, setActiveTab] = useState<TabType>('positions');
  const [positions, setPositions] = useState<Position[]>([]); // base positions (from vault reads)
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const isMountedRef = useRef(true);
  useEffect(() => {
    // In React 18 StrictMode (dev), effects mount/cleanup/mount without reinitializing refs.
    // Ensure the ref is reset on (re)mount so async fetches can update state.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedPositionId, setExpandedPositionId] = useState<string | null>(null);
  const [expandedOrderKey, setExpandedOrderKey] = useState<string | null>(null);
  const [isCancelingOrder, setIsCancelingOrder] = useState(false);
  const [isCancelingAll, setIsCancelingAll] = useState(false);
  const [cancelAllProgress, setCancelAllProgress] = useState<{ done: number; total: number; failed: number }>({ done: 0, total: 0, failed: 0 });

  // Pending orders placed via TradingPanel (shown inline with a loading animation)
  const [pendingOrders, setPendingOrders] = useState<Array<{
    id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT';
    price: number;
    size: number;
    timestamp: number;
  }>>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onPendingPlaced = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail?.id) return;
      setPendingOrders(prev => [{
        id: detail.id,
        symbol: detail.symbol || '',
        side: detail.side || 'BUY',
        type: detail.type || 'MARKET',
        price: Number(detail.price) || 0,
        size: Number(detail.size) || 0,
        timestamp: detail.timestamp || Date.now(),
      }, ...prev]);
      setActiveTab('orders');
    };

    const onPendingResolved = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.status === 'error') {
        setPendingOrders([]);
      } else {
        setTimeout(() => setPendingOrders([]), 1500);
      }
    };

    window.addEventListener('pendingOrderPlaced', onPendingPlaced);
    window.addEventListener('pendingOrderResolved', onPendingResolved);

    return () => {
      window.removeEventListener('pendingOrderPlaced', onPendingPlaced);
      window.removeEventListener('pendingOrderResolved', onPendingResolved);
    };
  }, []);

  // Fallback cleanup: remove stale pending orders after 60s
  useEffect(() => {
    if (pendingOrders.length === 0) return;
    const timer = setTimeout(() => setPendingOrders([]), 60_000);
    return () => clearTimeout(timer);
  }, [pendingOrders.length]);

  // Modify order modal state
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [modifyOrder, setModifyOrder] = useState<Order | null>(null);
  const [modifyPrice, setModifyPrice] = useState('');
  const [modifySize, setModifySize] = useState('');
  const [modifyError, setModifyError] = useState<string | null>(null);
  const [isModifying, setIsModifying] = useState(false);
  // Order cancel/close modal (subtle "cup fill" loader)
  const [orderFillModal, setOrderFillModal] = useState<{
    isOpen: boolean;
    progress: number; // 0..1
    status: OrderFillStatus;
    allowClose: boolean;
    startedAt: number;
    kind: 'cancel' | 'close' | null;
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

  const startCancelModal = useCallback(() => {
    setOrderFillModal({
      isOpen: true,
      progress: 0.06,
      status: 'canceling',
      allowClose: false,
      startedAt: Date.now(),
      kind: 'cancel',
      headlineText: undefined,
      detailText: undefined,
      showProgressLabel: undefined,
    });
  }, []);

  const finishCancelModal = useCallback(() => {
    setOrderFillModal((cur) => ({
      ...cur,
      status: 'success',
      progress: 1,
      allowClose: false,
      headlineText: undefined,
      detailText: undefined,
      showProgressLabel: undefined,
    }));
    window.setTimeout(() => {
      setOrderFillModal((cur) => ({ ...cur, isOpen: false, kind: null, headlineText: undefined, detailText: undefined, showProgressLabel: undefined }));
    }, 750);
  }, []);

  const startCloseModal = useCallback((symbol: string) => {
    setOrderFillModal({
      isOpen: true,
      progress: 0.06,
      status: 'submitting',
      allowClose: false,
      startedAt: Date.now(),
      kind: 'close',
      headlineText: `Closing ${symbol} position,`,
      detailText: undefined,
      showProgressLabel: undefined,
    });
  }, []);

  const finishCloseModal = useCallback(() => {
    setOrderFillModal((cur) => ({
      ...cur,
      status: 'success',
      progress: 1,
      allowClose: true,
      headlineText: 'Position Closed',
      detailText: 'Your position has been closed successfully.',
      showProgressLabel: false,
    }));
    window.setTimeout(() => {
      setOrderFillModal((cur) => {
        if (cur.status !== 'success') return cur;
        return { ...cur, isOpen: false, kind: null, headlineText: undefined, detailText: undefined, showProgressLabel: undefined };
      });
    }, 2500);
  }, []);

  const errorCloseModal = useCallback((errorMessage: string) => {
    setOrderFillModal((cur) => ({
      ...cur,
      status: 'error',
      progress: 1,
      allowClose: true,
      headlineText: 'Close Failed',
      detailText: errorMessage,
      showProgressLabel: false,
    }));
  }, []);

  // Smooth progress while submitting/filling (purely visual)
  useEffect(() => {
    if (!orderFillModal.isOpen) return;
    if (orderFillModal.status === 'success' || orderFillModal.status === 'error') return;

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

  // Escape hatch for cancel (avoid trapping UI if RPC hangs)
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

  // Escape hatch for close position (avoid trapping UI if RPC hangs)
  useEffect(() => {
    if (!orderFillModal.isOpen) return;
    if (orderFillModal.kind !== 'close') return;
    if (orderFillModal.status === 'success' || orderFillModal.status === 'error') return;
    const startedAt = orderFillModal.startedAt;
    const id = window.setInterval(() => {
      setOrderFillModal((cur) => {
        if (!cur.isOpen || cur.kind !== 'close') return cur;
        if (cur.status === 'success' || cur.status === 'error') return cur;
        if (Date.now() - startedAt > 25_000) {
          return { ...cur, allowClose: true };
        }
        return cur;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [orderFillModal.isOpen, orderFillModal.kind, orderFillModal.startedAt, orderFillModal.status]);

  const [optimisticallyRemovedOrderIds, setOptimisticallyRemovedOrderIds] = useState<Set<string>>(new Set());

  // Cancelled orders awaiting slide-out: 'waiting' = visible + dimmed for 2s, 'sliding' = playing animation
  const [slideOutOrderKeys, setSlideOutOrderKeys] = useState<Map<string, 'waiting' | 'sliding'>>(new Map());
  const slideOutTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const scheduleSlideOut = useCallback((key: string) => {
    if (slideOutTimersRef.current.has(key)) return;
    setSlideOutOrderKeys(prev => { const n = new Map(prev); n.set(key, 'waiting'); return n; });
    const timer = setTimeout(() => {
      slideOutTimersRef.current.delete(key);
      setSlideOutOrderKeys(prev => { const n = new Map(prev); n.set(key, 'sliding'); return n; });
    }, 2000);
    slideOutTimersRef.current.set(key, timer);
  }, []);

  const cancelSlideOut = useCallback((key: string) => {
    const timer = slideOutTimersRef.current.get(key);
    if (timer) { clearTimeout(timer); slideOutTimersRef.current.delete(key); }
    setSlideOutOrderKeys(prev => { const n = new Map(prev); n.delete(key); return n; });
  }, []);

  const completeSlideOut = useCallback((key: string) => {
    slideOutTimersRef.current.delete(key);
    setSlideOutOrderKeys(prev => { const n = new Map(prev); n.delete(key); return n; });
    setOptimisticallyRemovedOrderIds(prev => { const n = new Set(prev); n.add(key); return n; });
  }, []);

  // Global on-chain orders from OnchainOrdersContextV2
  const {
    orders: globalOnchainOrders,
    isLoading: isLoadingSitewideOrders,
    hasHydrated: hasHydratedSitewideOrders,
    refresh: refreshGlobalOrders,
  } = useOnchainOrders();
  // Map global context orders to local Order interface
  const sitewideActiveOrders: Order[] = useMemo(() => {
    return globalOnchainOrders.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      metricId: o.metricId,
      orderBookAddress: o.orderBookAddress ?? null,
      side: o.side,
      type: o.type,
      price: o.price,
      size: o.size,
      filled: o.filled,
      status: o.status,
      timestamp: o.timestamp,
    }));
  }, [globalOnchainOrders]);
  const wallet = useWallet() as any;
  const walletAddress = wallet?.walletData?.address ?? wallet?.address ?? null;
  const GASLESS = process.env.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
  const truncateMarketName = useCallback((raw: string, maxWords = 3) => {
    const cleaned = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    const words = cleaned.split(' ');
    if (words.length <= maxWords) return cleaned;
    return `${words.slice(0, maxWords).join(' ')}…`;
  }, []);
  const getOrderCompositeKey = (symbol?: string | null, id?: string | number | bigint) =>
    `${String(symbol || '').toUpperCase()}::${typeof id === 'bigint' ? id.toString() : String(id ?? '')}`;
  const isValidNumericOrderId = (id: any): boolean => {
    try {
      const b = BigInt(String(id));
      return b > 0n;
    } catch {
      return false;
    }
  };
  const getOrderUiKey = (order: Partial<Order>) => {
    const sym = String(order?.symbol || '').toUpperCase();
    const rawId: any = (order as any)?.id;
    const idStr = rawId === undefined || rawId === null ? '' : String(rawId);
    if (idStr.trim()) return getOrderCompositeKey(sym, idStr.trim());

    // Fallback when backend payload doesn't include a concrete order_id.
    // Important: expansion must be unique per-row; otherwise clicking "Manage" expands every row
    // that shares the same empty/duplicate id.
    const side = String((order as any)?.side || '');
    const type = String((order as any)?.type || '');
    const price = Number((order as any)?.price || 0);
    const size = Number((order as any)?.size || 0);
    const ts = Number((order as any)?.timestamp || 0);
    const tx = String((order as any)?.txHash || '');
    return getOrderCompositeKey(sym, `ui:${side}:${type}:${price}:${size}:${ts}:${tx}`);
  };
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
  const { markets, refetch: refetchMarkets } = useMarkets({ limit: 500, autoRefresh: false });
  const { positions: allPositions, positionsIsLoading, refresh: refreshPositions } = usePortfolioSnapshot();
  const marketIdMap = useMemo(() => {
    const map = new Map<string, { symbol: string; name: string }>();
    for (const m of markets || []) {
      const key = normalizeBytes32Hex((m as any)?.market_id_bytes32);
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
    const map = new Map<string, { symbol: string; name: string; identifier?: string; icon?: string }>();
    for (const m of markets || []) {
      const sym = (m?.symbol || '').toUpperCase();
      if (!sym) continue;
      const identifierRaw = String((m as any)?.market_identifier || '').trim();
      const identifier = identifierRaw ? identifierRaw.toUpperCase() : undefined;
      map.set(sym, { symbol: sym, name: m?.name || sym, identifier, icon: (m as any)?.icon_image_url || undefined });
    }
    return map;
  }, [markets]);

  const currentMarket = useMemo(() => {
    if (!markets || markets.length === 0) return null;
    const needle = String(symbol || '').toUpperCase();
    return (markets as any[]).find((m: any) => {
      const sym = String(m?.symbol || '').toUpperCase();
      const ident = String(m?.market_identifier || '').toUpperCase();
      return sym === needle || ident === needle;
    }) || null;
  }, [markets, symbol]);

  const isMarketSettledOrSettling =
    currentMarket?.market_status === 'SETTLED' ||
    currentMarket?.market_status === 'SETTLEMENT_REQUESTED' ||
    (onChainSettlementPrice != null && onChainSettlementPrice > 0);
  const isMarketSettled = isMarketSettledOrSettling;
  
  // Determine final settlement price, accounting for UMA dispute resolution
  const settlementPrice = useMemo(() => {
    if (!isMarketSettledOrSettling) return 0;
    
    const marketConfig = (currentMarket as any)?.market_config;
    const umaResolved = marketConfig?.uma_resolved === true;
    const umaChallengerWon = marketConfig?.uma_challenger_won === true;
    const umaWinningPrice = marketConfig?.uma_winning_price;
    
    // If UMA resolved and challenger won, use the winning price
    if (umaResolved && umaChallengerWon && umaWinningPrice != null && Number(umaWinningPrice) > 0) {
      return Number(umaWinningPrice);
    }
    
    // If UMA resolved but challenger lost, use the original proposed price
    if (umaResolved && !umaChallengerWon) {
      const proposed = Number((currentMarket as any)?.proposed_settlement_value ?? 0);
      if (proposed > 0) return proposed;
    }
    
    // Otherwise use settlement_value, proposed_settlement_value, or onChainSettlementPrice
    return (
      Number(currentMarket?.settlement_value ?? 0) || 
      Number((currentMarket as any)?.proposed_settlement_value ?? 0) || 
      onChainSettlementPrice || 
      0
    );
  }, [isMarketSettledOrSettling, currentMarket, onChainSettlementPrice]);

  const settledMarketSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const m of markets || []) {
      if ((m as any)?.market_status === 'SETTLED') {
        const sym = String((m as any)?.symbol || '').toUpperCase();
        if (sym) set.add(sym);
        const ident = String((m as any)?.market_identifier || '').toUpperCase();
        if (ident) set.add(ident);
      }
    }
    return set;
  }, [markets]);

  const {
    sessionId: globalSessionId,
    sessionActive: globalSessionActive,
    clear: clearSession,
  } = useSession();

  const getTokenHref = useCallback((sym?: string | null) => {
    const s = String(sym || '').trim();
    if (!s) return '/';
    const info = marketSymbolMap.get(s.toUpperCase());
    const slug = info?.identifier || s;
    return `/token/${encodeURIComponent(slug)}`;
  }, [marketSymbolMap]);
  
  // Optimistic overlay for positions on trade events (prevents "revert" when vault reads lag a block).
  // We keep small deltas for a short TTL and render basePositions + deltas.
  const posOverlayRef = useRef<
    Map<
      string,
      {
        delta: number;
        baseSigned: number;
        appliedAt: number;
        /** Soft TTL used to trigger background refetch nudges (not for hiding overlay). */
        expiresAt: number;
        /** Hard cap: never keep optimistic overlay beyond this time. */
        hardExpiresAt: number;
        /** Last time we nudged a base refetch for this symbol. */
        lastRefetchRequestedAt?: number;
        /** Trade price from the event, used as mark price for phantom positions */
        tradePrice?: number;
      }
    >
  >(new Map());
  const appliedTraceRef = useRef<Map<string, number>>(new Map());
  const [posOverlayTick, setPosOverlayTick] = useState(0); // re-render trigger
  const [settlingSymbols, setSettlingSymbols] = useState<Set<string>>(new Set());
  const posOverlayPruneIntervalRef = useRef<number | null>(null);

  // Canonicalize event keys (symbol vs market_identifier) so overlays apply to the same keys as positions.
  const marketKeyToSymbol = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of markets || []) {
      const sym = String((m as any)?.symbol || '').trim();
      if (sym) map.set(sym.toLowerCase(), sym.toUpperCase());
      const ident = String((m as any)?.market_identifier || '').trim();
      if (ident) map.set(ident.toLowerCase(), sym.toUpperCase());
    }
    return map;
  }, [markets]);

  const resolveCanonicalSymbol = useCallback(
    (raw?: string | null) => {
      const needle = String(raw || '').trim();
      if (!needle) return '';
      return marketKeyToSymbol.get(needle.toLowerCase()) || needle.toUpperCase();
    },
    [marketKeyToSymbol]
  );

  const getBaseSignedSize = useCallback(
    (symUpper: string) => {
      const sym = String(symUpper || '').toUpperCase();
      if (!sym) return 0;
      const p = (positions || []).find((x) => String((x as any)?.symbol || '').toUpperCase() === sym);
      if (!p) return 0;
      const size = Number((p as any)?.size || 0);
      if (!Number.isFinite(size)) return 0;
      const side = String((p as any)?.side || 'LONG').toUpperCase();
      return side === 'SHORT' ? -Math.abs(size) : Math.abs(size);
    },
    [positions]
  );

  // Important: overlay expiry is time-based, but `displayedPositions` is memoized.
  // Without a timed prune that bumps `posOverlayTick`, expired deltas can "stick"
  // visually until some unrelated re-render (e.g. full page refresh).
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const overlay = posOverlayRef.current;
    const shouldRun = overlay.size > 0;

    if (shouldRun && posOverlayPruneIntervalRef.current === null) {
      posOverlayPruneIntervalRef.current = window.setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [sym, o] of overlay.entries()) {
          if (!o || !Number.isFinite(o.delta) || o.delta === 0 || (o.hardExpiresAt || 0) <= now) {
            overlay.delete(sym);
            changed = true;
            continue;
          }

          // If the base hasn't caught up by the soft TTL, nudge another refresh for convergence.
          // This avoids "correct -> revert until reload" when event-driven reads happen too early.
          if (o.expiresAt <= now) {
            const last = Number(o.lastRefetchRequestedAt || 0);
            if (!Number.isFinite(last) || now - last > 5_000) {
              overlay.set(sym, { ...o, expiresAt: now + 8_000, lastRefetchRequestedAt: now });
              changed = true;
              try {
                window.dispatchEvent(
                  new CustomEvent('positionsRefreshRequested', {
                    detail: { symbol: sym, traceId: `ui:positions:retry:${sym}:${now}` },
                  })
                );
              } catch {}
            }
          }
        }
        if (changed) setPosOverlayTick((x) => x + 1);
        if (overlay.size === 0 && posOverlayPruneIntervalRef.current !== null) {
          window.clearInterval(posOverlayPruneIntervalRef.current);
          posOverlayPruneIntervalRef.current = null;
        }
      }, 500);
    }

    if (!shouldRun && posOverlayPruneIntervalRef.current !== null) {
      window.clearInterval(posOverlayPruneIntervalRef.current);
      posOverlayPruneIntervalRef.current = null;
    }
  }, [posOverlayTick]);

  useEffect(() => {
    return () => {
      try {
        if (posOverlayPruneIntervalRef.current !== null) {
          window.clearInterval(posOverlayPruneIntervalRef.current);
          posOverlayPruneIntervalRef.current = null;
        }
      } catch {}
    };
  }, []);

  // Reconcile overlays against refreshed base positions.
  // This prevents double-counting if the vault/portfolio data catches up before TTL expiry.
  useEffect(() => {
    const overlay = posOverlayRef.current;
    if (!overlay || overlay.size === 0) return;

    const eps = 1e-12;
    const signedBySym = new Map<string, number>();
    for (const p of positions || []) {
      const sym = String((p as any)?.symbol || '').toUpperCase();
      if (!sym) continue;
      const size = Number((p as any)?.size || 0);
      if (!Number.isFinite(size)) continue;
      const side = String((p as any)?.side || 'LONG').toUpperCase();
      signedBySym.set(sym, side === 'SHORT' ? -Math.abs(size) : Math.abs(size));
    }

    const now = Date.now();
    let changed = false;
    for (const [sym, o] of overlay.entries()) {
      if (!o) continue;

      // Eager prune invalid/expired entries.
      if (!Number.isFinite(o.delta) || o.delta === 0 || (o.hardExpiresAt || 0) <= now) {
        overlay.delete(sym);
        changed = true;
        continue;
      }

      const baseNow = signedBySym.get(sym) ?? 0;
      const baseSigned = Number.isFinite(o.baseSigned) ? o.baseSigned : 0;
      
      // CRITICAL: If the base position is gone (baseNow === 0) and the overlay delta
      // represents a position reduction (opposite sign to baseSigned), the position
      // has been fully closed on-chain. Delete the stale overlay to prevent phantom positions.
      if (Math.abs(baseNow) < eps && Math.abs(baseSigned) > eps) {
        const isClosureResidue = Math.sign(baseSigned) !== Math.sign(o.delta);
        if (isClosureResidue) {
          overlay.delete(sym);
          changed = true;
          continue;
        }
      }
      
      const caughtUp = baseNow - baseSigned;
      if (!Number.isFinite(caughtUp) || Math.abs(caughtUp) <= eps) continue;

      // Consume only when base movement aligns with overlay delta direction.
      if (Math.sign(caughtUp) !== Math.sign(o.delta)) continue;

      const consume = Math.min(Math.abs(caughtUp), Math.abs(o.delta));
      if (!(consume > eps)) continue;

      const sign = Math.sign(o.delta) || 1;
      const nextDelta = o.delta - sign * consume;
      const nextBaseSigned = baseSigned + sign * consume;

      if (!Number.isFinite(nextDelta) || Math.abs(nextDelta) <= eps) {
        overlay.delete(sym);
      } else {
        overlay.set(sym, { ...o, delta: nextDelta, baseSigned: nextBaseSigned });
      }
      changed = true;
    }

    if (changed) setPosOverlayTick((x) => x + 1);
  }, [positions]);

  const displayedPositions = useMemo(() => {
    const base = Array.isArray(positions) ? positions : [];
    const now = Date.now();
    const overlay = posOverlayRef.current;
    const next: Position[] = [];
    for (const p of base) {
      const sym = String(p.symbol || '').toUpperCase();
      if (settledMarketSymbols.has(sym) && !settlingSymbols.has(sym)) continue;
      const o = overlay.get(sym);
      if (!o || (o.hardExpiresAt || 0) <= now || !Number.isFinite(o.delta) || o.delta === 0) {
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
      if ((o.hardExpiresAt || 0) <= now || !Number.isFinite(o.delta) || o.delta === 0) continue;
      const exists = next.some((p) => String(p.symbol || '').toUpperCase() === sym);
      if (exists) continue;
      
      // CRITICAL: Check if this overlay represents a position closure rather than a new position.
      // If baseSigned and delta have opposite signs, this means the overlay is reducing/closing
      // an existing position, NOT creating a new one. When the base position disappears (closed
      // on-chain), we should NOT create a phantom position from the residual negative delta.
      const baseSigned = Number.isFinite(o.baseSigned) ? o.baseSigned : 0;
      const isClosureResidue = baseSigned !== 0 && Math.sign(baseSigned) !== Math.sign(o.delta);
      if (isClosureResidue) {
        // This delta was reducing a position that has now been closed on-chain.
        // Don't create a phantom position in the opposite direction.
        continue;
      }
      
      // Use trade price from the event, or fall back to current market price
      const phantomMarkPrice = o.tradePrice && o.tradePrice > 0
        ? o.tradePrice
        : (md.markPrice || md.lastTradePrice || md.bestBid || md.bestAsk || 0);
      
      // Use stable ID based on appliedAt to prevent flickering when memo re-runs
      const stableId = `phantom:${sym}:${o.appliedAt || now}`;
      
      next.push({
        id: stableId,
        symbol: sym,
        side: o.delta >= 0 ? 'LONG' : 'SHORT',
        size: Math.abs(o.delta),
        entryPrice: phantomMarkPrice,
        markPrice: phantomMarkPrice,
        pnl: 0,
        pnlPercent: 0,
        liquidationPrice: 0,
        margin: 0,
        leverage: 1,
        timestamp: o.appliedAt || now,
        isUnderLiquidation: false,
      });
    }
    const pageSymbol = String(symbol || '').toUpperCase();
    next.sort((a, b) => {
      const aMatch = String(a.symbol || '').toUpperCase() === pageSymbol ? 1 : 0;
      const bMatch = String(b.symbol || '').toUpperCase() === pageSymbol ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      const valueA = (a.size || 0) * (a.markPrice || 0);
      const valueB = (b.size || 0) * (b.markPrice || 0);
      return valueB - valueA;
    });
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, posOverlayTick, md.markPrice, md.lastTradePrice, md.bestBid, md.bestAsk, symbol, settledMarketSymbols, settlingSymbols]);

  // Walkthrough hooks: allow the token tour to expand a position row.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const expandFirst = () => {
      setActiveTab('positions');
      const first = displayedPositions?.[0];
      if (first?.id) {
        setExpandedPositionId(first.id);
      }
    };

    const collapseAll = () => {
      setActiveTab('positions');
      setExpandedPositionId(null);
    };

    window.addEventListener('walkthrough:tokenActivity:expandFirstPosition', expandFirst as any);
    window.addEventListener('walkthrough:tokenActivity:collapsePositions', collapseAll as any);
    return () => {
      window.removeEventListener('walkthrough:tokenActivity:expandFirstPosition', expandFirst as any);
      window.removeEventListener('walkthrough:tokenActivity:collapsePositions', collapseAll as any);
    };
  }, [displayedPositions]);

  // removeOrderFromSessionCache: after a cancel, trigger a global context re-fetch
  const removeOrderFromSessionCache = useCallback(
    (_targetOrderId?: string | number | bigint, _marketSymbol?: string | null) => {
      // The global OnchainOrdersContextV2 handles re-fetching when ordersUpdated fires.
      // This is now a no-op kept for call-site compatibility.
    },
    []
  );

  // Throttle and in-flight guards for order history (must be declared before realtime effects that reference them)
  const isFetchingHistoryRef = useRef(false);
  const lastHistoryFetchTsRef = useRef(0);

  const fetchOrderHistory = useCallback(
    async (opts?: { force?: boolean; silent?: boolean }) => {
      if (!walletAddress) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && !opts?.force) return;
      if (isFetchingHistoryRef.current) return;

      const now = Date.now();
      const cooldownMs = opts?.force ? 750 : 10_000;
      if (now - lastHistoryFetchTsRef.current < cooldownMs) return;

      isFetchingHistoryRef.current = true;
      if (!opts?.silent) setIsLoading(true);
      try {
        console.log('[Dispatch] 📡 [API][MarketActivityTabs] /api/orders/query request', { trader: walletAddress });
        const params = new URLSearchParams({
          trader: walletAddress,
          limit: '50'
        });
        const res = await fetch(`/api/orders/query?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          console.log('[Dispatch] ✅ [API][MarketActivityTabs] /api/orders/query response', { total: data?.orders?.length, resolvedMarketId: data?.resolvedMarketId });
          const hist = (data.orders || []).map((o: any) => ({
            id: o.order_id,
            symbol: String(o.market_metric_id || metricId || 'UNKNOWN').toUpperCase(),
            side: (o.side || 'BUY') as 'BUY' | 'SELL',
            type: (o.order_type || 'LIMIT') as 'MARKET' | 'LIMIT',
            price: typeof o.price === 'number' ? o.price : (o.price ? parseFloat(o.price) : 0),
            size: typeof o.quantity === 'number' ? o.quantity : parseFloat(o.quantity || '0'),
            filled: typeof o.filled_quantity === 'number' ? o.filled_quantity : parseFloat(o.filled_quantity || '0'),
            status: (o.order_status || 'PENDING').replace('PARTIAL','PARTIAL') as any,
            timestamp: new Date(o.updated_at || o.created_at).getTime(),
            txHash: typeof o.tx_hash === 'string' ? o.tx_hash : undefined,
          }));
          if (isMountedRef.current) setOrderHistory(hist);
        } else {
          console.warn('[Dispatch] ⚠️ [API][MarketActivityTabs] /api/orders/query non-200', res.status);
        }
      } catch (e) {
        console.error('[Dispatch] ❌ [API][MarketActivityTabs] /api/orders/query exception', e);
        // keep existing orderHistory on error
      } finally {
        lastHistoryFetchTsRef.current = Date.now();
        isFetchingHistoryRef.current = false;
        if (!opts?.silent && isMountedRef.current) setIsLoading(false);
      }
    },
    [walletAddress, metricId]
  );

  // IMPORTANT: Do not hit Supabase for order history unless the History tab is active.

  const lastSessionHydrateAtRef = useRef(0);

  // Immediate optimistic UI patch for Open Orders on `ordersUpdated`.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!walletAddress) return;

    const onOrdersUpdated = (e: any) => {
      const detail = (e as CustomEvent)?.detail as any;
      try {
        // eslint-disable-next-line no-console
        console.log(`${UI_UPDATE_PREFIX} MarketActivityTabs:ordersUpdated:received`, {
          activeTab,
          symbol: String(detail?.symbol || detail?.marketId || detail?.metricId || '').toUpperCase(),
          eventType: String(detail?.eventType || detail?.reason || '').trim(),
          orderId: detail?.orderId !== undefined ? String(detail.orderId) : undefined,
          txHash: String(detail?.txHash || ''),
          trader: String(detail?.trader || ''),
          traceId: String(detail?.traceId || ''),
        });
      } catch {}
      const traceId = String(detail?.traceId || '');
      const now = Date.now();
      if (traceId) {
        const prev = openOrdersOverlayRef.current.seenTrace.get(traceId) || 0;
        if (now - prev < 10_000) return;
        openOrdersOverlayRef.current.seenTrace.set(traceId, now);
      }

      const trader = String(detail?.trader || '').toLowerCase();
      const me = String(walletAddress || '').toLowerCase();
      if (!me) return;
      // Only mutate UI for the current wallet's orders when trader is present
      if (trader && trader !== me) return;

      // Global OnchainOrdersContextV2 handles re-fetch on ordersUpdated events automatically.

      const sym = String(detail?.symbol || detail?.marketId || detail?.metricId || '').toUpperCase();
      if (!sym) return;

      const eventType = String(detail?.eventType || detail?.reason || '').trim();
      const orderId = detail?.orderId !== undefined ? String(detail.orderId) : '';
      const ttlMs = 30_000;

      const isPlacementEvent = eventType === 'OrderPlaced' || eventType === 'order-placed';
      let shouldRefreshSessionOrders = false;
      const isHistoryEvent = isPlacementEvent || eventType === 'OrderCancelled' || eventType === 'cancel';

      if (eventType === 'OrderCancelled' || eventType === 'cancel') {
        if (orderId) {
          const overlayKey = getOrderCompositeKey(sym, orderId);
          // Ensure a cancel can't leave behind a stale optimistic "added" order (which can render as 0/0/0).
          openOrdersOverlayRef.current.removed.set(overlayKey, now + ttlMs);
          openOrdersOverlayRef.current.added.delete(overlayKey);
        }
        setOpenOrdersOverlayTick((x) => x + 1);
        // eslint-disable-next-line no-console
        console.log('[RealTimeToken] ui:openOrders:patched', { traceId, symbol: sym, eventType, orderId, action: 'remove' });
        try {
          // eslint-disable-next-line no-console
          console.log(`${UI_UPDATE_PREFIX} MarketActivityTabs:openOrders:overlay:remove`, { traceId, symbol: sym, orderId });
        } catch {}
        shouldRefreshSessionOrders = true;
      }

      // Treat as an order placement only when we have enough fields to render a real row.
      // IMPORTANT: don't treat empty eventType as "placed" (it can be a partial/unknown payload) or we may add 0/0/0 rows.
      if (!shouldRefreshSessionOrders && isPlacementEvent) {
        // Some producers (notably gasless UI) emit `orderId: "tx:<hash>"` as a placeholder.
        // That is NOT cancelable (can't be parsed as bigint) and will show as a duplicate once the real numeric id arrives.
        // We still want to re-hydrate session orders (handled above), but we must NOT add an optimistic Open Orders row.
        const rawOrderType = String(
          detail?.orderType ??
          detail?.order_type ??
          detail?.type ??
          ''
        ).trim().toUpperCase();
        const isMarketHint =
          rawOrderType === 'MARKET' ||
          rawOrderType === '0' ||
          rawOrderType === 'ORDER_TYPE_MARKET' ||
          Boolean(detail?.isMarketOrder);
        if (isMarketHint) {
          shouldRefreshSessionOrders = true;
          return;
        }
        let orderIdBig: bigint = 0n;
        try { orderIdBig = BigInt(orderId); } catch { orderIdBig = 0n; }
        if (!orderId || orderIdBig <= 0n) {
          shouldRefreshSessionOrders = true;
        } else {
        const overlayKey = getOrderCompositeKey(sym, orderId);
        // If we already marked this id removed, don't re-add it (race between cancel + stale updates).
        if (openOrdersOverlayRef.current.removed.has(overlayKey)) return;

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
        // Crossing placements execute immediately and should not appear in Open Orders.
        const bestBid = Number(md.bestBid || orderBookState?.bestBid || 0);
        const bestAsk = Number(md.bestAsk || orderBookState?.bestAsk || 0);
        const isCrossingOrder = isBuy
          ? (bestAsk > 0 && priceNum >= bestAsk)
          : (bestBid > 0 && priceNum <= bestBid);
        if (isCrossingOrder) {
          shouldRefreshSessionOrders = true;
          return;
        }

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

        openOrdersOverlayRef.current.added.set(overlayKey, { order: optimistic, expiresAt: now + ttlMs });
        setOpenOrdersOverlayTick((x) => x + 1);
        // eslint-disable-next-line no-console
        console.log('[RealTimeToken] ui:openOrders:patched', { traceId, symbol: sym, eventType: 'OrderPlaced', orderId, action: 'add' });
        try {
          // eslint-disable-next-line no-console
          console.log(`${UI_UPDATE_PREFIX} MarketActivityTabs:openOrders:overlay:add`, {
            traceId,
            symbol: sym,
            orderId,
            price: optimistic.price,
            size: optimistic.size,
            side: optimistic.side,
          });
        } catch {}
        shouldRefreshSessionOrders = true;
        }
      }

      // Do NOT refresh Order History unless History tab is active.
      try {
        if (activeTab === 'history' && isHistoryEvent) {
          fetchOrderHistory({ force: true, silent: false });
        }
      } catch {}
    };

    window.addEventListener('ordersUpdated', onOrdersUpdated as EventListener);
    return () => window.removeEventListener('ordersUpdated', onOrdersUpdated as EventListener);
  }, [walletAddress, activeTab, metricId, fetchOrderHistory, md.bestBid, md.bestAsk, orderBookState?.bestBid, orderBookState?.bestAsk]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!walletAddress) return;
    if (activeTab !== 'history') return;

    const onHistoryRefresh = (e: any) => {
      const detail = (e as CustomEvent)?.detail as any;
      const trader = String(detail?.trader || '').toLowerCase();
      const me = String(walletAddress || '').toLowerCase();
      if (trader && me && trader !== me) return;
      fetchOrderHistory({ force: true, silent: false });
    };

    window.addEventListener('orderHistoryRefreshRequested', onHistoryRefresh as EventListener);
    return () => window.removeEventListener('orderHistoryRefreshRequested', onHistoryRefresh as EventListener);
  }, [walletAddress, activeTab, fetchOrderHistory]);

  // On settlement: animate settled positions out, then refresh markets data
  // so `settledMarketSymbols` picks up the SETTLED status and filters them.
  // IMPORTANT: only slide-out positions when the market is actually finalized
  // on-chain (lifecycle state 3 / LifecycleSettled). During the challenge phase
  // positions must remain visible since the settlement is not yet final.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const onSettlement = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      const sym = String(detail?.symbol || '').toUpperCase();
      const eventName = String(detail?.eventName || '');
      const newState = detail?.newState !== undefined ? Number(detail.newState) : undefined;

      const isFinalized =
        eventName === 'LifecycleSettled' ||
        (eventName === 'LifecycleStateChanged' && newState === 3) ||
        detail?.settledOnChain === true;

      // Always refresh market/position data so settlement UI stays current,
      // but only trigger the position slide-out animation when finalized.
      refetchMarkets();
      refreshPositions();

      for (const delay of [2000, 5000, 10000]) {
        timers.push(setTimeout(() => refetchMarkets(), delay));
      }

      if (isFinalized && sym) {
        setSettlingSymbols((prev) => new Set(prev).add(sym));

        // After the slide-out animation, clear settling flag.
        // Positions from SETTLED markets will be filtered by settledMarketSymbols.
        timers.push(setTimeout(() => {
          setSettlingSymbols((prev) => {
            const next = new Set(prev);
            next.delete(sym);
            return next;
          });
          refreshPositions();
        }, 600));
      }
    };

    window.addEventListener('settlementUpdated', onSettlement as EventListener);
    return () => {
      window.removeEventListener('settlementUpdated', onSettlement as EventListener);
      timers.forEach(clearTimeout);
    };
  }, [refetchMarkets, refreshPositions]);

  // Immediate UI patch for positions on trade events (no waiting on contract reads).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!walletAddress) return;

    const onPositionsRefresh = (e: any) => {
      const detail = (e as CustomEvent)?.detail as any;
      const sym = resolveCanonicalSymbol(detail?.symbol || '');
      const traceId = String(detail?.traceId || '');
      const txHash = String(detail?.txHash || '');
      const blockNumber = detail?.blockNumber !== undefined ? String(detail.blockNumber) : '';
      const buyer = String(detail?.buyer || '').toLowerCase();
      const seller = String(detail?.seller || '').toLowerCase();
      const me = String(walletAddress || '').toLowerCase();
      if (!sym || !me) return;
      if (buyer !== me && seller !== me) return;

      // Dedup repeated dispatches for the same tx/trace in a short window
      {
        const now = Date.now();
        const dedupKey =
          traceId ||
          (txHash ? `tx:${txHash.toLowerCase()}` : '') ||
          (blockNumber ? `blk:${blockNumber}` : '') ||
          `${sym}:${buyer}:${seller}:${String(detail?.amount || '')}:${Math.floor(Number(detail?.timestamp || now) / 1000)}`;
        const prev = appliedTraceRef.current.get(dedupKey) || 0;
        if (now - prev < 10_000) return;
        appliedTraceRef.current.set(dedupKey, now);
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
      // Safety clamps: prevent pathological event payloads from poisoning UI state.
      if (!Number.isFinite(delta) || Math.abs(delta) > 1e9) return;

      const signedDelta = buyer === me ? delta : -delta;
      const now = Date.now();
      const ttlMs = 8_000; // soft TTL
      const hardTtlMs = 120_000; // hard cap (2 minutes) to avoid indefinite divergence
      const existing = posOverlayRef.current.get(sym);
      const nextDelta = (existing?.delta || 0) + signedDelta;
      const baseSigned = existing?.baseSigned ?? getBaseSignedSize(sym);
      
      // Capture trade price for phantom position rendering (avoid zero mark price)
      let tradePrice = existing?.tradePrice || 0;
      try {
        const priceStr = String(detail?.price || '0');
        if (priceStr && priceStr !== '0') {
          const parsed = parseFloat(ethers.formatUnits(BigInt(priceStr), 18));
          if (Number.isFinite(parsed) && parsed > 0) {
            tradePrice = parsed;
          }
        }
      } catch {}
      
      posOverlayRef.current.set(sym, {
        delta: nextDelta,
        baseSigned,
        appliedAt: existing?.appliedAt ?? now,
        expiresAt: now + ttlMs,
        hardExpiresAt: (existing?.hardExpiresAt ?? (now + hardTtlMs)),
        lastRefetchRequestedAt: existing?.lastRefetchRequestedAt,
        tradePrice,
      });
      // eslint-disable-next-line no-console
      console.log('[RealTimeToken] ui:positions:patched', { traceId, symbol: sym, signedDelta, overlayDelta: nextDelta });
      setPosOverlayTick((x) => x + 1);

      // Do not touch Order History unless History tab is active.
    };

    window.addEventListener('positionsRefreshRequested', onPositionsRefresh as EventListener);
    return () => {
      window.removeEventListener('positionsRefreshRequested', onPositionsRefresh as EventListener);
    };
  }, [walletAddress, resolveCanonicalSymbol, getBaseSignedSize]);

  // Resolve per-market OrderBook address from symbol/metricId using populated CONTRACT_ADDRESSES.MARKET_INFO
  const resolveOrderBookAddress = useCallback((symbolOrMetricId?: string | null): string | null => {
    try {
      const needle = String(symbolOrMetricId || '').trim();
      if (!needle) return null;
      const lowerNeedle = needle.toLowerCase();
      const chainId = String((CHAIN_CONFIG as any)?.chainId ?? '');

      // Prefer `markets` list (comes from DB and includes `market_address` + `chain_id`)
      const mkt = (markets || []).find((m: any) => {
        if (!m?.market_address) return false;
        if (chainId && m?.chain_id !== undefined && String(m.chain_id) !== chainId) return false;
        const candidates = [
          m?.symbol,
          m?.market_identifier,
          m?.name,
        ].filter(Boolean).map((v: any) => String(v).toLowerCase());
        if (candidates.includes(lowerNeedle)) return true;

        // Legacy "base symbol" match (e.g. BTC from BTC-USD)
        const baseNeedle = needle.split('-')[0]?.toLowerCase?.() || '';
        const baseSym = String(m?.symbol || '').split('-')[0]?.toLowerCase?.() || '';
        return Boolean(baseNeedle && baseSym && baseNeedle === baseSym);
      });
      if (mkt?.market_address) return String(mkt.market_address);

      // Fallback to populated MARKET_INFO (chain-aware)
      const entries: any[] = Object.values((CONTRACT_ADDRESSES as any)?.MARKET_INFO || {});
      const directExact = (CONTRACT_ADDRESSES as any)?.MARKET_INFO?.[needle.toUpperCase()];
      if (directExact?.orderBook && (!chainId || String(directExact.chainId || '') === chainId)) {
        return directExact.orderBook as string;
      }
      const baseKey = needle.split('-')[0].toUpperCase();
      const directBase = (CONTRACT_ADDRESSES as any)?.MARKET_INFO?.[baseKey];
      if (directBase?.orderBook && (!chainId || String(directBase.chainId || '') === chainId)) {
        return directBase.orderBook as string;
      }
      const match = entries.find((m: any) => {
        if (chainId && m?.chainId !== undefined && String(m.chainId) !== chainId) return false;
        const candidates = [
          m?.marketIdentifier?.toLowerCase?.(),
          m?.symbol?.toLowerCase?.(),
          m?.name?.toLowerCase?.()
        ].filter(Boolean);
        return candidates.includes(lowerNeedle);
      });
      return match?.orderBook || null;
    } catch {
      return null;
    }
  }, [markets]);
  
  // Positions: show ALL user positions across markets (reuse portfolio hook)
  useEffect(() => {
    if (!walletAddress) {
      setPositions([]);
      return;
    }
    try {
      const mapped = (allPositions || []).map((p: any) => {
        const keyHex = normalizeBytes32Hex(String(p?.marketId || ''));
        const meta = marketIdMap.get(keyHex);
        const symbolDisplay = (meta?.symbol || p?.symbol || 'UNKNOWN').toUpperCase();
        return {
          id: String(p?.id || p?.marketId || keyHex),
          symbol: symbolDisplay,
          side: (p?.side || 'LONG') as 'LONG' | 'SHORT',
          size: Number(p?.size || 0),
          rawSize: p?.rawSize ? String(p.rawSize) : undefined,
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

  // Helper functions for showing messages via the unified OrderFillLoadingModal
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

  // Add top-up state and handler
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpPositionId, setTopUpPositionId] = useState<string | null>(null);
  const [topUpSymbol, setTopUpSymbol] = useState<string>('');
  const [topUpAmount, setTopUpAmount] = useState<string>('');
  const [currentMargin, setCurrentMargin] = useState<number>(0);
  const [isToppingUp, setIsToppingUp] = useState(false);
  const [topUpSide, setTopUpSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [topUpEntryPrice, setTopUpEntryPrice] = useState<number>(0);
  const [topUpLeverage, setTopUpLeverage] = useState<number>(0);
  const [topUpLiqPrice, setTopUpLiqPrice] = useState<number>(0);
  const [topUpError, setTopUpError] = useState<string | null>(null);

  const [portalMounted, setPortalMounted] = useState(false);
  useEffect(() => { setPortalMounted(true); return () => setPortalMounted(false); }, []);

  // Add close position state and handler
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closePositionId, setClosePositionId] = useState<string | null>(null);
  const [closeSymbol, setCloseSymbol] = useState<string>('');
  const [closeSize, setCloseSize] = useState<string>('');
  /** Raw close size in Wei (18 decimals) for full precision when closing entire position */
  const [rawCloseSize, setRawCloseSize] = useState<string>('');
  const [maxSize, setMaxSize] = useState<number>(0);
  /** Per-position exit price fetched for the specific market (not the current page's market) */
  const [closeExitPrice, setCloseExitPrice] = useState<{ bestBid: number; bestAsk: number } | null>(null);

  // Fetch best bid/ask for a specific market identifier via the live API.
  // Used when closing a position from a market other than the current page.
  const fetchExitPriceForMarket = useCallback(async (marketIdentifier: string) => {
    try {
      const res = await fetch(`/api/orderbook/live?symbol=${encodeURIComponent(marketIdentifier)}&levels=1`);
      if (!res.ok) return null;
      const json = await res.json();
      if (json?.ok && json?.data) {
        return {
          bestBid: Number(json.data.bestBid) || 0,
          bestAsk: Number(json.data.bestAsk) || 0,
          markPrice: Number(json.data.markPrice) || 0,
          lastTradePrice: Number(json.data.lastTradePrice) || 0,
        };
      }
    } catch (e) {
      console.warn('[ClosePosition] Failed to fetch exit price for', marketIdentifier, e);
    }
    return null;
  }, []);

  // Resolve the best exit price for a position close.
  // LONG sells at best bid; SHORT buys at best ask.
  // Uses the position-specific fetched prices when available, otherwise
  // falls back to the current page's market data (correct only for same-market positions).
  const resolveExitPrice = (position: Position | null): number => {
    if (!position) return 0;

    const isCurrentMarket = position.symbol.toUpperCase() === metricId.toUpperCase();

    if (position.side === 'LONG') {
      if (closeExitPrice?.bestBid) return closeExitPrice.bestBid;
      if (isCurrentMarket) return md.bestBid || orderBookState.bestBid || md.markPrice || md.lastTradePrice || 0;
      return position.markPrice || 0;
    }
    if (closeExitPrice?.bestAsk) return closeExitPrice.bestAsk;
    if (isCurrentMarket) return md.bestAsk || orderBookState.bestAsk || md.markPrice || md.lastTradePrice || 0;
    return position.markPrice || 0;
  };

  const calculateExpectedPayout = (position: Position | null, closeSizeValue: number, exitPrice: number) => {
    if (!position || closeSizeValue <= 0 || exitPrice <= 0) {
      return { exitPrice: 0, payout: 0, pnl: 0, pnlPercent: 0 };
    }

    const payout = closeSizeValue * exitPrice;
    const pnl = position.side === 'LONG'
      ? (exitPrice - position.entryPrice) * closeSizeValue
      : (position.entryPrice - exitPrice) * closeSizeValue;
    const entryValue = position.entryPrice * closeSizeValue;
    const pnlPercent = entryValue > 0 ? (pnl / entryValue) * 100 : 0;

    return { exitPrice, payout, pnl, pnlPercent };
  };

  // Handle top-up action
  const handleTopUp = (position: Position) => {
    setTopUpPositionId(position.id);
    setTopUpSymbol(position.symbol);
    setCurrentMargin(position.margin);
    setTopUpSide(position.side);
    setTopUpEntryPrice(position.entryPrice);
    setTopUpLeverage(position.leverage);
    setTopUpLiqPrice(position.liquidationPrice);
    setTopUpError(null);
    setShowTopUpModal(true);
  };

  const handleTopUpSubmit = async () => {
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
        const activeSessionId =
          globalSessionId ||
          (typeof window !== 'undefined'
            ? (window.localStorage.getItem(`gasless:session:${walletAddress}`) || '')
            : '');

        let res: { success: boolean; txHash?: string; error?: string };

        if (activeSessionId && globalSessionActive === true) {
          res = await sessionTopUpPosition({
            vault: CONTRACT_ADDRESSES.CORE_VAULT,
            trader: walletAddress,
            marketId,
            amount: topUpAmount,
            sessionId: activeSessionId,
          });
          if (!res.success && isSessionErrorMessage(res.error || '')) {
            clearSession();
          }
        } else {
          res = await gaslessTopUpPosition({
            vault: CONTRACT_ADDRESSES.CORE_VAULT,
            trader: walletAddress,
            marketId,
            amount: topUpAmount,
          });
        }

        if (!res.success) throw new Error(res.error || 'gasless top-up failed');
        console.log('Gasless top-up tx:', res.txHash);
      } else {
        // Fallback: direct signer flow
        let signer: ethers.Signer | undefined;
        if (typeof window !== 'undefined' && (getActiveEthereumProvider() || (window as any).ethereum)) {
          const s = await ensureHyperliquidWallet();
          signer = s ?? undefined;
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

      refreshPositions();
      for (const delay of [2000, 4000, 8000]) {
        setTimeout(() => refreshPositions(), delay);
      }

      showSuccess('Position margin topped up successfully.', 'Top-up confirmed');
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

    // Close the input modal immediately and show loading modal
    const symbolToClose = closeSymbol;
    const positionIdToClose = closePositionId;
    const closeSizeValue = closeSize;
    const rawCloseSizeValue = rawCloseSize;
    const maxSizeValue = maxSize;
    
    setShowCloseModal(false);
    setCloseSize('');
    setRawCloseSize('');
    setClosePositionId(null);
    setCloseSymbol('');
    setCloseError(null);
    setCloseExitPrice(null);
    
    startCloseModal(symbolToClose);
    
    try {
      const closeAmount = parseFloat(closeSizeValue);
      // Prefer gasless close via market order of opposite side (session-based)
      if (GASLESS && walletAddress) {
        const pos = positions.find(p => p.id === positionIdToClose);
        const isBuy = pos?.side === 'SHORT';
        const obAddress = resolveOrderBookAddress(symbolToClose || pos?.symbol);
        if (!obAddress) throw new Error('OrderBook not found for market');
        
        // Use rawCloseSize (Wei) when closing the full position to avoid JS float precision loss.
        // Otherwise, parse the user-entered closeSize for partial closes.
        // Use a small tolerance for float comparison to handle rounding in UI display.
        // Also use raw size for very small positions to avoid scientific notation issues.
        const isFullClose = rawCloseSizeValue && (closeAmount >= maxSizeValue * 0.9999999);
        const isVerySmall = closeAmount < 1e-12;
        let amountWei: bigint;
        if (isFullClose) {
          amountWei = BigInt(rawCloseSizeValue);
        } else if (isVerySmall && rawCloseSizeValue) {
          // For very small amounts, scale rawCloseSize proportionally to avoid parseUnits issues
          const ratio = closeAmount / maxSizeValue;
          const rawBigInt = BigInt(rawCloseSizeValue);
          // Use integer math: multiply by ratio * 1e18, then divide by 1e18
          const scaledRatio = BigInt(Math.floor(ratio * 1e18));
          amountWei = (rawBigInt * scaledRatio) / BigInt(1e18);
          if (amountWei <= 0n) amountWei = 1n; // minimum 1 Wei
        } else {
          amountWei = parseUnits(closeSizeValue, 18) as unknown as bigint;
        }
        
        // session flow (no auto session creation)
        const activeSessionId =
          globalSessionId ||
          (typeof window !== 'undefined'
            ? (window.localStorage.getItem(`gasless:session:${walletAddress}`) || '')
            : '');
        if (!activeSessionId || globalSessionActive !== true) {
          throw new Error('Trading session is not enabled. Click Enable Trading before closing positions gaslessly.');
        }
        const r = await submitSessionTrade({
          method: 'sessionPlaceMarginMarket',
          orderBook: obAddress,
          sessionId: activeSessionId,
          trader: walletAddress as string,
          amountWei: amountWei,
          isBuy,
        });
        if (!r.success) {
          const msg = r.error || 'Gasless close failed';
          if (isSessionErrorMessage(msg)) {
            clearSession();
            throw new Error(msg || 'Trading session expired. Click Enable Trading to re-enable gasless trading.');
          }
          throw new Error(msg);
        }
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ordersUpdated', { detail: { symbol: metricId, reason: 'close', timestamp: Date.now() } }));
            window.dispatchEvent(new Event('positionsRefreshRequested'));
          }
        } catch {}
      } else {
        const success = await orderBookActions.closePosition(positionIdToClose, closeAmount);
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

      finishCloseModal();
    } catch (error: any) {
      console.error('Error closing position:', error);
      const rawMsg = error?.message || '';
      let userMessage = 'Failed to close position. Please try again.';
      
      if (rawMsg.toLowerCase().includes('ob_no_liquidity') || rawMsg.toLowerCase().includes('no_liquidity')) {
        userMessage = 'Insufficient liquidity to close this position. Try a smaller size or wait for more market activity.';
      } else if (rawMsg.toLowerCase().includes('slippage')) {
        userMessage = 'Price moved too much. Try again or increase slippage tolerance.';
      } else if (rawMsg.toLowerCase().includes('session')) {
        userMessage = rawMsg;
      } else if (rawMsg) {
        userMessage = rawMsg;
      }
      
      errorCloseModal(userMessage);
    }
  };

  function normalizeOrderStatus(rawStatus: any): Order['status'] {
    const s = String(rawStatus || '').trim().toLowerCase();
    if (!s || s === 'pending' || s === 'open' || s === 'submitted') return 'PENDING';
    if (s === 'partially_filled' || s === 'partial') return 'PARTIAL';
    if (s === 'filled') return 'FILLED';
    if (s === 'cancelled' || s === 'canceled' || s === 'expired' || s === 'rejected') return 'CANCELLED';
    return 'PENDING';
  }

  function normalizeQuantity(qty: number) {
    const n = Number.isFinite(qty) ? qty : 0;
    // Orders often arrive in 1e12 base units; scale down when clearly oversized
    if (n >= 1_000_000) return n / 1_000_000_000_000;
    return n;
  }

  // Open Orders: V2 API (on-chain reads) + session cache + optimistic overlay.
  const openOrders = useMemo(() => {
    // IMPORTANT: Open Orders are SITE-WIDE (all markets), not just the current token page.
    // This matches the requirement: every market's activities tab should show the same open orders list.
    const base = Array.isArray(sitewideActiveOrders) && sitewideActiveOrders.length > 0
      ? sitewideActiveOrders
      : [];
    const dedup = new Map<string, Order>();

    const appendOrder = (order: Order) => {
      if (!order || order.id === undefined || order.id === null) return;
      // Only show cancelable orders (numeric on-chain ids). Skip placeholder ids.
      if (!isValidNumericOrderId(order.id)) return;
      const key = getOrderCompositeKey(order.symbol, order.id);
      if (!key) return;
      const prev = dedup.get(key);
      if (!prev) return void dedup.set(key, order);
      const prevTs = Number(prev?.timestamp || 0);
      const nextTs = Number(order?.timestamp || 0);
      if (nextTs >= prevTs) dedup.set(key, order);
    };

    // 1) Authoritative on-chain orders from global OnchainOrdersContextV2
    base.forEach(appendOrder);

    // Defensive: never render a LIMIT order with non-positive price/size.
    // Keep orders visible while awaiting or playing slide-out animation.
    return Array.from(dedup.values())
      .filter((o) => {
        const removalKey = getOrderCompositeKey(o.symbol, o.id);
        if (slideOutOrderKeys.has(removalKey)) return true;
        return o.type !== 'MARKET' && o.status !== 'CANCELLED' && o.status !== 'FILLED' && !optimisticallyRemovedOrderIds.has(removalKey);
      })
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
  }, [sitewideActiveOrders, optimisticallyRemovedOrderIds, slideOutOrderKeys]);
  const openOrdersIsLoading = Boolean(isLoadingSitewideOrders && !hasHydratedSitewideOrders && activeTab === 'orders');

  // Optimistic overlay for open orders driven by `ordersUpdated` event detail.
  // Prevents flicker/revert while backend/onchain read catches up.
  const openOrdersOverlayRef = useRef<{
    added: Map<string, { order: Order; expiresAt: number }>;
    removed: Map<string, number>;
    seenTrace: Map<string, number>;
  }>({ added: new Map(), removed: new Map(), seenTrace: new Map() });
  const [openOrdersOverlayTick, setOpenOrdersOverlayTick] = useState(0);
  const openOrdersOverlayPruneIntervalRef = useRef<number | null>(null);
  const [isRefreshingOnchainOrders, setIsRefreshingOnchainOrders] = useState(false);

  // Same issue as positions: the overlay is time-based, but `displayedOpenOrders` is memoized.
  // If we never bump `openOrdersOverlayTick` when TTLs elapse, optimistic rows can linger until refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const overlay = openOrdersOverlayRef.current;
    const shouldRun = overlay.added.size > 0 || overlay.removed.size > 0;

    if (shouldRun && openOrdersOverlayPruneIntervalRef.current === null) {
      openOrdersOverlayPruneIntervalRef.current = window.setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [id, until] of overlay.removed.entries()) {
          if (!Number.isFinite(until) || until <= now) {
            overlay.removed.delete(id);
            changed = true;
          }
        }
        for (const [id, rec] of overlay.added.entries()) {
          if (!rec || !Number.isFinite(rec.expiresAt) || rec.expiresAt <= now) {
            overlay.added.delete(id);
            changed = true;
          }
        }
        if (changed) setOpenOrdersOverlayTick((x) => x + 1);
        if (overlay.added.size === 0 && overlay.removed.size === 0 && openOrdersOverlayPruneIntervalRef.current !== null) {
          window.clearInterval(openOrdersOverlayPruneIntervalRef.current);
          openOrdersOverlayPruneIntervalRef.current = null;
        }
      }, 500);
    }

    if (!shouldRun && openOrdersOverlayPruneIntervalRef.current !== null) {
      window.clearInterval(openOrdersOverlayPruneIntervalRef.current);
      openOrdersOverlayPruneIntervalRef.current = null;
    }
  }, [openOrdersOverlayTick]);

  useEffect(() => {
    return () => {
      try {
        if (openOrdersOverlayPruneIntervalRef.current !== null) {
          window.clearInterval(openOrdersOverlayPruneIntervalRef.current);
          openOrdersOverlayPruneIntervalRef.current = null;
        }
      } catch {}
    };
  }, []);

  // Reconcile open-orders overlays against refreshed base `openOrders`.
  // This avoids stale optimistic bookkeeping sticking around longer than needed.
  // Also auto-extends TTL for overlay entries the chain hasn't confirmed yet.
  useEffect(() => {
    const overlay = openOrdersOverlayRef.current;
    if (!overlay) return;
    if (overlay.added.size === 0 && overlay.removed.size === 0) return;

    const base = Array.isArray(openOrders) ? openOrders : [];
    const baseKeys = new Set<string>();
    for (const o of base) {
      baseKeys.add(getOrderCompositeKey(o.symbol, o.id));
    }

    const now = Date.now();
    let changed = false;
    // If an optimistic "added" order is now in base, drop it early.
    // If it's NOT in base yet but close to expiring, extend the TTL so
    // the row stays visible while the chain catches up.
    for (const [k, rec] of overlay.added.entries()) {
      if (baseKeys.has(k)) {
        overlay.added.delete(k);
        changed = true;
      } else if (rec.expiresAt - now < 5_000) {
        rec.expiresAt = now + 15_000;
        changed = true;
      }
    }
    // If we marked an order removed but base no longer contains it, drop the tombstone early.
    for (const [k] of overlay.removed.entries()) {
      if (!baseKeys.has(k)) {
        overlay.removed.delete(k);
        changed = true;
      }
    }

    if (changed) setOpenOrdersOverlayTick((x) => x + 1);
  }, [openOrders]);

  const clearOptimisticOpenOrders = useCallback(() => {
    try {
      openOrdersOverlayRef.current.added.clear();
      openOrdersOverlayRef.current.removed.clear();
      openOrdersOverlayRef.current.seenTrace.clear();
    } catch {}
    setOptimisticallyRemovedOrderIds(new Set());
    setExpandedOrderKey(null);
    setOpenOrdersOverlayTick((x) => x + 1);
  }, []);

  const clearSessionActiveOrdersCache = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!walletAddress) return;
    const walletLower = String(walletAddress).toLowerCase();

    // Clear V2 localStorage cache so the next fetch will re-populate it
    try {
      window.localStorage.removeItem(`v2:onchainOrders:${walletLower}`);
    } catch {}

    // Clear legacy sessionStorage keys
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k) keys.push(k);
    }
    for (const k of keys) {
      if (!k.startsWith('orderbook:activeOrders:v1:')) continue;
      const raw = window.sessionStorage.getItem(k);
      if (!raw) continue;
      try {
        const payload = JSON.parse(raw);
        if (String(payload?.walletAddress || '').toLowerCase() !== walletLower) continue;
        window.sessionStorage.removeItem(k);
      } catch {
        // If it's malformed, remove it anyway.
        try { window.sessionStorage.removeItem(k); } catch {}
      }
    }
  }, [walletAddress]);

  const resetOptimisticAndRefreshOnchain = useCallback(async () => {
    if (isRefreshingOnchainOrders) return;
    setIsRefreshingOnchainOrders(true);
    try {
      // 1) Stop showing any optimistic overlay rows immediately
      clearOptimisticOpenOrders();

      // 2) Clear legacy session caches
      clearSessionActiveOrdersCache();

      // 3) Force on-chain refresh via global context
      try {
        await refreshGlobalOrders();
      } catch {}
    } finally {
      setIsRefreshingOnchainOrders(false);
    }
  }, [
    isRefreshingOnchainOrders,
    clearOptimisticOpenOrders,
    clearSessionActiveOrdersCache,
    refreshGlobalOrders,
  ]);

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

    const next = base.filter((o) => !overlay.removed.has(getOrderCompositeKey(o.symbol, o.id)));
    for (const [key, rec] of overlay.added.entries()) {
      // Never show an optimistic "added" order if we've also marked it removed (race safety).
      if (overlay.removed.has(key)) continue;
      const exists = next.some((o) => getOrderCompositeKey(o.symbol, o.id) === key);
      if (!exists) next.push(rec.order);
    }
    // Stable ordering: newest first
    next.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOrders, openOrdersOverlayTick]);

  // Track newly arrived orders for subtle entrance animation
  const prevOrderKeysRef = useRef<Set<string>>(new Set());
  const [newlyArrivedOrderKeys, setNewlyArrivedOrderKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const currentKeys = new Set(displayedOpenOrders.map(o => getOrderCompositeKey(o.symbol, o.id)));
    const prevKeys = prevOrderKeysRef.current;
    
    // Find orders that are new (in current but not in previous)
    const newKeys: string[] = [];
    for (const key of currentKeys) {
      if (!prevKeys.has(key)) {
        newKeys.push(key);
      }
    }
    
    // Always update the ref for next comparison
    prevOrderKeysRef.current = currentKeys;
    
    // Only animate if there were already orders displayed (not initial load)
    if (newKeys.length > 0 && prevKeys.size > 0) {
      setNewlyArrivedOrderKeys(prev => {
        const next = new Set(prev);
        for (const k of newKeys) next.add(k);
        return next;
      });
      
      // Clear animation state after animation completes (~600ms)
      const timer = setTimeout(() => {
        setNewlyArrivedOrderKeys(prev => {
          const next = new Set(prev);
          for (const k of newKeys) next.delete(k);
          return next;
        });
      }, 600);
      
      return () => clearTimeout(timer);
    }
  }, [displayedOpenOrders]);

  const lastUiLogRef = useRef<{ key: string } | null>(null);

  useEffect(() => {
    if (!walletAddress) return;
    logGoddMat(21, 'MarketActivityTabs updated openOrders derived state', {
      v2OrdersCount: sitewideActiveOrders.length,
      openOrdersCount: displayedOpenOrders.length,
      activeTab
    });
  }, [walletAddress, sitewideActiveOrders.length, displayedOpenOrders.length, activeTab]);

  // Real-time UI update log (post-render): confirms the Open Orders UI state changed.
  useEffect(() => {
    if (!walletAddress) return;
    const key = `${activeTab}:${sitewideActiveOrders.length}:${displayedOpenOrders.length}:${optimisticallyRemovedOrderIds.size}`;
    if (lastUiLogRef.current?.key === key) return;
    lastUiLogRef.current = { key };
    // eslint-disable-next-line no-console
    console.log('[RealTimeToken] ui:openOrders:rendered', {
      activeTab,
      v2OrdersCount: sitewideActiveOrders.length,
      openOrdersCount: displayedOpenOrders.length,
      hiddenOptimisticCount: optimisticallyRemovedOrderIds.size,
    });
  }, [walletAddress, activeTab, sitewideActiveOrders.length, displayedOpenOrders.length, optimisticallyRemovedOrderIds.size]);
  // Prefetch order history so the History tab count is populated on initial load.
  // Keep this silent to avoid showing the global "Loading..." indicator unless the user is actively viewing the tab.
  useEffect(() => {
    if (!walletAddress) return;
    fetchOrderHistory({ force: true, silent: true });
  }, [walletAddress, fetchOrderHistory]);

  // Open orders are provided by global OnchainOrdersContextV2 (handles caching + 24h refresh).
  // Refresh when the Orders tab becomes active + visible to keep it warm.
  useEffect(() => {
    if (activeTab !== 'orders') return;
    if (!walletAddress) return;

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshGlobalOrders();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [activeTab, walletAddress, refreshGlobalOrders]);

  // Fetch order history when History tab is active. Refreshes are also triggered by realtime events.
  useEffect(() => {
    if (activeTab !== 'history') return;
    if (!walletAddress) return;

    fetchOrderHistory({ force: true });

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchOrderHistory({ force: true });
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [activeTab, walletAddress, fetchOrderHistory]);

  const handleCancelAllOrders = useCallback(async () => {
    if (isCancelingAll || !walletAddress || displayedOpenOrders.length === 0) return;

    const activeSessionId =
      globalSessionId ||
      (typeof window !== 'undefined'
        ? (window.localStorage.getItem(`gasless:session:${walletAddress}`) || '')
        : '');

    if (GASLESS && (!activeSessionId || globalSessionActive !== true)) {
      showError('Trading session is not enabled. Click Enable Trading before using gasless cancel.', 'Session Required');
      return;
    }

    const orders = [...displayedOpenOrders];
    setIsCancelingAll(true);
    setCancelAllProgress({ done: 0, total: orders.length, failed: 0 });

    setOrderFillModal({
      isOpen: true,
      progress: 0,
      status: 'canceling',
      allowClose: false,
      kind: 'cancel',
      headlineText: `Cancelling all orders (0/${orders.length})`,
      detailText: 'Please wait while all open orders are cancelled...',
      showProgressLabel: true,
    });

    let done = 0;
    let failed = 0;

    for (const order of orders) {
      const metric = String(order.metricId || order.symbol);
      const obAddress = order.orderBookAddress || resolveOrderBookAddress(metric || order.symbol);
      const removalKey = getOrderCompositeKey(order.symbol, order.id);

      try {
        if (GASLESS && obAddress) {
          let oid: bigint;
          try { oid = typeof order.id === 'bigint' ? (order.id as any) : BigInt(order.id as any); } catch { oid = 0n; }
          if (oid === 0n) throw new Error('Invalid order id');

          scheduleSlideOut(removalKey);
          const r = await submitSessionTrade({
            method: 'sessionCancelOrder',
            orderBook: obAddress,
            sessionId: activeSessionId,
            trader: walletAddress as string,
            orderId: oid as unknown as bigint,
          });

          if (!r.success) {
            cancelSlideOut(removalKey);
            const msg = r.error || 'Gasless cancel failed';
            if (isSessionErrorMessage(msg)) {
              clearSession();
              setIsCancelingAll(false);
              setCancelAllProgress({ done, total: orders.length, failed: failed + 1 });
              showError(msg || 'Trading session expired. Click Enable Trading to re-enable.', 'Session Error');
              return;
            }
            failed++;
          } else {
            try {
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
                  timestamp: Date.now(),
                },
              }));
            } catch {}
          }
        } else {
          scheduleSlideOut(removalKey);
          const ok = await cancelOrderForMarket(order.id, metric);
          if (!ok) {
            cancelSlideOut(removalKey);
            failed++;
          } else {
            try {
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
                  timestamp: Date.now(),
                },
              }));
            } catch {}
          }
        }
      } catch {
        failed++;
      }

      done++;
      const progress = Math.round((done / orders.length) * 100);
      setCancelAllProgress({ done, total: orders.length, failed });
      setOrderFillModal((cur) => ({
        ...cur,
        progress,
        headlineText: `Cancelling all orders (${done}/${orders.length})`,
      }));
    }

    try { await refreshGlobalOrders(); } catch {}

    if (failed === 0) {
      setOrderFillModal((cur) => ({
        ...cur,
        status: 'success',
        progress: 100,
        allowClose: true,
        headlineText: `All ${orders.length} orders cancelled`,
        detailText: undefined,
        showProgressLabel: false,
      }));
    } else {
      setOrderFillModal((cur) => ({
        ...cur,
        status: 'error',
        progress: 100,
        allowClose: true,
        headlineText: `Cancelled ${done - failed}/${orders.length} orders`,
        detailText: `${failed} order(s) failed to cancel.`,
        showProgressLabel: false,
      }));
    }

    setIsCancelingAll(false);
  }, [isCancelingAll, walletAddress, displayedOpenOrders, globalSessionId, globalSessionActive, GASLESS, resolveOrderBookAddress, clearSession, refreshGlobalOrders, showError]);

  const handleModifySubmit = useCallback(async () => {
    if (!modifyOrder || !walletAddress || isModifying) return;

    const newPrice = parseFloat(modifyPrice);
    const newSize = parseFloat(modifySize);
    if (!Number.isFinite(newPrice) || newPrice <= 0) {
      setModifyError('Enter a valid price greater than 0.');
      return;
    }
    if (!Number.isFinite(newSize) || newSize <= 0) {
      setModifyError('Enter a valid size greater than 0.');
      return;
    }

    const metric = String(modifyOrder.metricId || modifyOrder.symbol);
    const obAddress = modifyOrder.orderBookAddress || resolveOrderBookAddress(metric || modifyOrder.symbol);
    if (!obAddress) {
      setModifyError('Could not resolve order book address for this market.');
      return;
    }

    const activeSessionId =
      globalSessionId ||
      (typeof window !== 'undefined'
        ? (window.localStorage.getItem(`gasless:session:${walletAddress}`) || '')
        : '');

    if (GASLESS && (!activeSessionId || globalSessionActive !== true)) {
      setModifyError('Trading session is not enabled. Click Enable Trading first.');
      return;
    }

    setIsModifying(true);
    setModifyError(null);

    setOrderFillModal({
      isOpen: true,
      progress: 20,
      status: 'canceling',
      allowClose: false,
      kind: 'cancel',
      headlineText: 'Modifying order (1/2)',
      detailText: 'Cancelling existing order...',
      showProgressLabel: true,
    });

    try {
      // Step 1: Cancel the existing order
      let oid: bigint;
      try { oid = typeof modifyOrder.id === 'bigint' ? (modifyOrder.id as any) : BigInt(modifyOrder.id as any); } catch { oid = 0n; }
      if (oid === 0n) throw new Error('Invalid order id');

      const removalKey = getOrderCompositeKey(modifyOrder.symbol, modifyOrder.id);

      const cancelResult = await submitSessionTrade({
        method: 'sessionCancelOrder',
        orderBook: obAddress,
        sessionId: activeSessionId,
        trader: walletAddress as string,
        orderId: oid as unknown as bigint,
      });

      if (!cancelResult.success) {
        const msg = cancelResult.error || 'Failed to cancel existing order';
        if (isSessionErrorMessage(msg)) {
          clearSession();
          throw new Error(msg || 'Trading session expired.');
        }
        throw new Error(msg);
      }

      setOptimisticallyRemovedOrderIds(prev => { const n = new Set(prev); n.add(removalKey); return n; });

      try {
        const remaining = Math.max(0, Number(modifyOrder.size || 0) - Number(modifyOrder.filled || 0));
        let price6 = '0';
        let amount18 = '0';
        try { price6 = String(ethers.parseUnits(String(modifyOrder.price || 0), 6)); } catch {}
        try { amount18 = String(ethers.parseUnits(String(remaining), 18)); } catch {}
        window.dispatchEvent(new CustomEvent('ordersUpdated', {
          detail: {
            symbol: metric,
            eventType: 'OrderCancelled',
            reason: 'cancel',
            orderId: String(modifyOrder.id),
            trader: String(walletAddress || ''),
            price: price6,
            amount: amount18,
            isBuy: String(modifyOrder.side || '').toUpperCase() === 'BUY',
            timestamp: Date.now(),
          },
        }));
      } catch {}

      // Step 2: Place new order with modified price/size
      setOrderFillModal((cur) => ({
        ...cur,
        progress: 60,
        headlineText: 'Modifying order (2/2)',
        detailText: 'Placing new order...',
      }));

      const priceWei = ethers.parseUnits(String(newPrice), 6);
      const sizeWei = ethers.parseUnits(String(newSize), 18);
      const isBuy = String(modifyOrder.side || '').toUpperCase() === 'BUY';

      const placeResult = await submitSessionTrade({
        method: 'sessionPlaceMarginLimit',
        orderBook: obAddress,
        sessionId: activeSessionId,
        trader: walletAddress as string,
        priceWei: priceWei as unknown as bigint,
        amountWei: sizeWei as unknown as bigint,
        isBuy,
      });

      if (!placeResult.success) {
        const msg = placeResult.error || 'Failed to place modified order';
        if (isSessionErrorMessage(msg)) {
          clearSession();
          throw new Error(msg || 'Trading session expired.');
        }
        throw new Error(`Old order cancelled but new order failed: ${msg}`);
      }

      try {
        window.dispatchEvent(new CustomEvent('ordersUpdated', {
          detail: {
            symbol: metric,
            eventType: 'OrderPlaced',
            reason: 'order-placed',
            orderId: '',
            trader: String(walletAddress || ''),
            price: String(priceWei),
            amount: String(sizeWei),
            isBuy,
            orderType: 'LIMIT',
            timestamp: Date.now(),
          },
        }));
      } catch {}

      try { await refreshGlobalOrders(); } catch {}

      setShowModifyModal(false);
      setModifyOrder(null);
      setModifyPrice('');
      setModifySize('');
      setModifyError(null);

      setOrderFillModal((cur) => ({
        ...cur,
        status: 'success',
        progress: 100,
        allowClose: true,
        headlineText: 'Order modified successfully',
        detailText: undefined,
        showProgressLabel: false,
      }));
    } catch (e: any) {
      setModifyError(e?.message || 'Modification failed. Please try again.');
      setOrderFillModal((cur) => ({
        ...cur,
        status: 'error',
        progress: 100,
        allowClose: true,
        headlineText: 'Order modification failed',
        detailText: e?.message || 'Please try again.',
        showProgressLabel: false,
      }));
    } finally {
      setIsModifying(false);
    }
  }, [modifyOrder, modifyPrice, modifySize, walletAddress, isModifying, globalSessionId, globalSessionActive, GASLESS, resolveOrderBookAddress, clearSession, refreshGlobalOrders]);

  const tabs = [
    { id: 'positions' as TabType, label: 'Positions', shortLabel: 'Pos', count: displayedPositions.length },
    { id: 'orders' as TabType, label: 'Open Orders', shortLabel: 'Orders', count: displayedOpenOrders.length + pendingOrders.length },
    { id: 'trades' as TabType, label: 'Trade History', shortLabel: 'Trades', count: orderBookState.tradeCount },
    { id: 'history' as TabType, label: 'Order History', shortLabel: 'History', count: orderHistory.length },
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

  // Format P&L percent with grouping for large values (e.g. 7,002,137.00%)
  const formatPnlPercent = (value: number) =>
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);

  // Format prices with up to 4 decimals and commas (e.g. 2,631.5000)
  const formatPrice4 = (value: number) =>
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(Number.isFinite(value) ? value : 0);

  // Format price exactly as returned without rounding (preserves all significant decimals)
  const formatPriceExact = (value: number) => {
    if (!Number.isFinite(value)) return '0.00';
    const str = String(value);
    const [intPart, decPart] = str.split('.');
    const formattedInt = new Intl.NumberFormat('en-US').format(Number(intPart));
    if (!decPart) return `${formattedInt}.00`;
    const trimmed = decPart.length < 2 ? decPart.padEnd(2, '0') : decPart;
    return `${formattedInt}.${trimmed}`;
  };

  // Format P&L amount with grouping (e.g. 69,913.59)
  const formatPnlAmount = (value: number) =>
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);

  const formatAmount = (value: number, decimals = 4) => {
    if (!Number.isFinite(value) || value === 0) return '0';
    if (value < 0.00000001 && value > 0) return value.toFixed(8);
    // Format with enough precision then strip unnecessary trailing zeros,
    // keeping at least one decimal place (e.g. 1.0, not 1)
    const raw = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    }).format(value);
    // If the formatted number has a decimal, ensure at least ".X" (e.g. "1.0" not "1")
    if (!raw.includes('.')) return `${raw}.0`;
    return raw;
  };

  // Convert a number to a full decimal string without scientific notation.
  // Useful for input fields where parseUnits needs a proper decimal format.
  const toDecimalString = (value: number, maxDecimals = 18): string => {
    if (!Number.isFinite(value) || value === 0) return '0';
    // toFixed handles scientific notation conversion but may add trailing zeros
    const fixed = value.toFixed(maxDecimals);
    // Remove trailing zeros after decimal point, but keep at least one decimal
    const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return trimmed || '0';
  };

  // Like SearchModal price formatting: keep 2dp for readability,
  // but allow more decimals for small position sizes so they don't render as 0.00.
  const formatSize = (value: number) => {
    const safe = Number.isFinite(value) ? value : 0;
    const abs = Math.abs(safe);
    if (abs === 0) return '0';

    // For sizes < 1, increase max decimals until we show a meaningful non-zero digit.
    // Cap at 12 to avoid extremely long UI strings.
    const maxD =
      abs >= 1 ? 2 : Math.max(2, Math.min(12, Math.ceil(-Math.log10(abs)) + 2));
    const minD = Math.min(2, maxD);

    const rounded = Number(safe.toFixed(maxD));
    const nf = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: minD,
      maximumFractionDigits: maxD,
    });

    // If rounding still collapses to 0, show a floor indicator.
    if (rounded === 0) {
      const floor = 1 / 10 ** maxD;
      return `<${nf.format(floor)}`;
    }

    return nf.format(rounded);
  };

  const ActivityEmptyState = ({ message, isLoading: loading = false, dataWalkthrough }: { message: string; isLoading?: boolean; dataWalkthrough?: string }) => (
    <div className="flex flex-col items-center justify-center p-8 pt-6 pb-10 min-h-[140px] gap-4" {...(dataWalkthrough ? { 'data-walkthrough': dataWalkthrough } : {})}>
      <div className="flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${loading ? 'bg-blue-400 animate-pulse' : 'bg-t-dot'}`} />
        <span className="text-[11px] font-medium text-t-fg">{message}</span>
      </div>
      <img
        src="/Dexicon/LOGO-Dexetera-03.svg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none select-none w-10 h-10 opacity-[0.06]"
        draggable={false}
      />
    </div>
  );

  const renderPositionsTable = () => {
    if (displayedPositions.length === 0) {
      return (
        <ActivityEmptyState
          message={positionsIsLoading ? 'Loading open positions…' : 'No open positions'}
          isLoading={positionsIsLoading}
          dataWalkthrough="token-activity-empty-positions"
        />
      );
    }

    return (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-t-stroke">
                        <th className="text-left pl-1.5 sm:pl-2 pr-1 py-1.5 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Symbol</th>
                        <th className="text-left px-1 sm:px-2 py-1.5 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Side</th>
                        <th className="text-right px-1 sm:px-1.5 sm:px-2 py-1.5 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Size</th>
                        <th className="hidden sm:table-cell text-right px-2 py-1.5 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Entry</th>
                        <th className="hidden md:table-cell text-right px-2 py-1.5 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Mark</th>
                        <th className="text-right px-1 sm:px-2 py-1.5 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">PnL</th>
                        <th className="hidden sm:table-cell text-right px-2 py-1.5 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Liq Price</th>
                        <th className="w-0 pr-1 sm:pr-1.5 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedPositions.map((position, index) => {
                        // When positions hydrate before markets metadata resolves, the symbol can briefly be "UNKNOWN".
                        // Instead of flashing UNKNOWN, render a subtle skeleton loader (matching the token header mark-price loader style).
                        const showSkeleton =
                          String(position.symbol || '').toUpperCase() === 'UNKNOWN' &&
                          (positionsIsLoading || (markets || []).length === 0);

                        const isSettling = settlingSymbols.has(String(position.symbol || '').toUpperCase());
                        
                        // Check if position is at risk of liquidation (mark price crossed liq price)
                        const isAtRiskOfLiquidation = !position.isUnderLiquidation && 
                          position.liquidationPrice > 0 && 
                          position.markPrice > 0 &&
                          (position.side === 'SHORT' 
                            ? position.markPrice >= position.liquidationPrice
                            : position.markPrice <= position.liquidationPrice);
                        
                        const rowClass = `${isSettling ? 'position-row-slide-out' : 'mat-slide-rtl'} group/row transition-colors duration-200 ${
                          position.isUnderLiquidation
                            ? 'bg-yellow-400/5 hover:bg-yellow-400/10 border-yellow-400/20'
                            : isAtRiskOfLiquidation
                              ? 'bg-red-400/5 hover:bg-red-400/10 border-red-400/20'
                              : 'hover:bg-t-card-hover'
                        } ${index !== displayedPositions.length - 1 ? 'border-b border-t-stroke-sub' : ''}`;

                        if (showSkeleton) {
                          return (
                            <tr
                              key={position.id}
                              className={rowClass}
                              style={{ animationDelay: `${index * 50}ms` }}
                            >
                              <td className="pl-1.5 sm:pl-2 pr-1 py-1.5">
                                <div className="flex items-center gap-1 min-w-0">
                                  <span className="w-4 h-4 shrink-0 rounded-full border border-t-stroke-hover bg-t-inset animate-pulse" />
                                  <div className="min-w-0 flex-1">
                                    <span className="block w-[60px] sm:w-[120px] h-[12px] bg-t-inset rounded animate-pulse" />
                                    <span className="hidden md:block mt-1 w-[84px] h-[10px] bg-t-elevated rounded animate-pulse" />
                                  </div>
                                </div>
                              </td>
                              <td className="px-1 sm:px-2 py-1.5">
                                <span className="inline-block w-[32px] sm:w-[44px] h-[12px] bg-t-inset rounded animate-pulse" />
                              </td>
                              <td className="px-1 sm:px-1.5 sm:px-2 py-1.5 text-right">
                                <span className="inline-block w-[48px] sm:w-[64px] h-[12px] bg-t-inset rounded animate-pulse" />
                              </td>
                              <td className="hidden sm:table-cell px-2 py-1.5 text-right">
                                <span className="inline-block w-[72px] h-[12px] bg-t-inset rounded animate-pulse" />
                              </td>
                              <td className="hidden md:table-cell px-2 py-1.5 text-right">
                                <span className="inline-block w-[72px] h-[12px] bg-t-inset rounded animate-pulse" />
                              </td>
                              <td className="px-1 sm:px-2 py-1.5 text-right">
                                <span className="inline-block w-[50px] sm:w-[78px] h-[12px] bg-t-inset rounded animate-pulse" />
                              </td>
                              <td className="hidden sm:table-cell px-2 py-1.5 text-right">
                                <span className="inline-block w-[72px] h-[12px] bg-t-inset rounded animate-pulse" />
                              </td>
                              <td className="pr-1 sm:pr-1.5 py-1.5 text-right w-0">
                                <span className="inline-block w-[12px] h-[12px] bg-t-inset rounded animate-pulse" />
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <React.Fragment key={position.id}>
                            <tr className={rowClass} style={{ animationDelay: `${index * 50}ms` }}>
                              <td className="pl-1.5 sm:pl-2 pr-1 py-1.5 max-w-0">
                                <div className="flex items-center gap-1 min-w-0">
                                  <Link
                                    href={getTokenHref(position.symbol)}
                                    className="group/link flex min-w-0 max-w-full items-center gap-1 hover:opacity-90 transition-opacity"
                                    title={`Open ${position.symbol} market`}
                                  >
                                    <img
                                      src={(marketSymbolMap.get(position.symbol)?.icon as string) || FALLBACK_TOKEN_ICON}
                                      alt={`${position.symbol} logo`}
                                      className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 rounded-full border border-t-stroke-hover object-cover"
                                    />
                                    <div className="min-w-0 flex-1">
                                      <span className="block truncate text-[10px] sm:text-[11px] font-medium text-t-fg">
                                        {truncateMarketName(marketSymbolMap.get(position.symbol)?.name || position.symbol)}
                                      </span>
                                      <span className="hidden md:block truncate text-[10px] text-t-fg-label">
                                        {marketSymbolMap.get(position.symbol)?.identifier || position.symbol}
                                      </span>
                                    </div>
                                    {position.isUnderLiquidation ? (
                                      <div className="shrink-0 px-1 py-0.5 bg-yellow-400/10 rounded">
                                        <span className="text-[8px] font-medium text-yellow-400">LIQUIDATING</span>
                                      </div>
                                    ) : isAtRiskOfLiquidation && (
                                      <div className="shrink-0 px-1 py-0.5 bg-red-400/10 rounded animate-pulse">
                                        <span className="text-[8px] font-medium text-red-400">⚠ AT RISK</span>
                                      </div>
                                    )}
                                  </Link>
                                </div>
                              </td>
                              <td className="px-1 sm:px-2 py-1.5 whitespace-nowrap">
                                <span
                                  className={`text-[10px] sm:text-[11px] font-medium ${
                                    position.side === 'LONG' ? 'text-green-400' : 'text-red-400'
                                  }`}
                                >
                                  {position.side}
                                </span>
                              </td>
                          <td className="px-1 sm:px-1.5 sm:px-2 py-1.5 text-right">
                            <span className="text-[10px] sm:text-[11px] text-t-fg font-mono">{formatSize(position.size)}</span>
                          </td>
                          <td className="hidden sm:table-cell px-2 py-1.5 text-right">
                            <span className="text-[11px] text-t-fg-muted font-mono">${formatPrice4(position.entryPrice)}</span>
                          </td>
                          <td className="hidden md:table-cell px-2 py-1.5 text-right">
                            <span className="text-[11px] text-t-fg font-mono">${formatPrice4(position.markPrice)}</span>
                          </td>
                          <td className="px-1 sm:px-2 py-1.5 text-right">
                            <div className="flex flex-col items-end">
                              <span
                                className={`text-[10px] sm:text-[11px] font-medium font-mono whitespace-nowrap ${
                                  position.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                                }`}
                              >
                                {position.pnl >= 0 ? '+' : ''}
                                {formatPnlAmount(position.pnl)}
                              </span>
                              <span
                                className={`text-[8px] sm:text-[9px] font-mono ${
                                  position.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                                }`}
                              >
                                {position.pnlPercent >= 0 ? '+' : ''}
                                {formatPnlPercent(position.pnlPercent)}%
                              </span>
                            </div>
                          </td>
                          <td className="hidden sm:table-cell px-2 py-1.5 text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <div className={`flex items-center justify-end gap-1.5 ${
                                position.isUnderLiquidation 
                                  ? 'bg-yellow-400/10 px-2 py-1 rounded border border-yellow-400/20'
                                  : isAtRiskOfLiquidation
                                    ? 'bg-red-400/10 px-2 py-1 rounded border border-red-400/20'
                                    : ''
                              }`}>
                                {(position.isUnderLiquidation || isAtRiskOfLiquidation) && (
                                  <svg 
                                    className={`w-2.5 h-2.5 animate-pulse ${
                                      position.isUnderLiquidation ? 'text-yellow-400' : 'text-red-400'
                                    }`} 
                                    viewBox="0 0 24 24" 
                                    fill="none" 
                                    xmlns="http://www.w3.org/2000/svg"
                                  >
                                    <path d="M12 9V14M12 19C8.13401 19 5 15.866 5 12C5 8.13401 8.13401 5 12 5C15.866 5 19 8.13401 19 12C19 15.866 15.866 19 12 19ZM12 16V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                  </svg>
                                )}
                                <span className={`text-[11px] font-mono ${
                                  position.isUnderLiquidation 
                                    ? 'text-yellow-400 font-bold'
                                    : isAtRiskOfLiquidation
                                      ? 'text-red-400 font-bold'
                                      : 'text-t-fg'
                                }`}>
                                  ${formatPrice(position.liquidationPrice)}
                                </span>
                              </div>
                              {position.isUnderLiquidation ? (
                                <span className="text-[8px] font-medium text-yellow-400 animate-pulse">
                                  UNDER LIQUIDATION
                                </span>
                              ) : isAtRiskOfLiquidation && (
                                <span className="text-[8px] font-medium text-red-400 animate-pulse">
                                  LIQUIDATION IMMINENT
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="pr-1 sm:pr-1.5 py-1.5 text-right w-0">
                  <button 
                    onClick={() => setExpandedPositionId(expandedPositionId === position.id ? null : position.id)}
                    data-walkthrough="token-activity-manage"
                    className={`${forcePositionManageVisible ? 'opacity-100' : 'sm:opacity-0 sm:group-hover/row:opacity-100'} transition-opacity duration-200 p-0.5 text-[9px] text-t-fg-muted hover:text-t-fg hover:bg-t-card-hover rounded`}
                    title={expandedPositionId === position.id ? 'Hide' : 'Manage'}
                  >
                    {expandedPositionId === position.id ? '▾' : '▸'}
                            </button>
                          </td>
                        </tr>
              {expandedPositionId === position.id && (
                <tr className="bg-t-inset">
                  <td colSpan={100} className="px-0">
                    <div className="px-2 py-1.5 border-t border-t-stroke">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col gap-1 sm:hidden">
                                <span className="text-[9px] text-t-fg-label">Entry</span>
                                <span className="text-[10px] font-medium font-mono text-t-fg">
                                  ${formatPrice(position.entryPrice)}
                                </span>
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-[9px] text-t-fg-label">Margin</span>
                                <span className={`text-[10px] font-medium font-mono ${
                                  position.isUnderLiquidation 
                                    ? 'text-yellow-400' 
                                    : isAtRiskOfLiquidation 
                                      ? 'text-red-400'
                                      : 'text-t-fg'
                                }`}>
                                  ${position.margin.toFixed(2)}
                                </span>
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-[9px] text-t-fg-label">Leverage</span>
                                <span className={`text-[10px] font-medium font-mono ${
                                  position.isUnderLiquidation 
                                    ? 'text-yellow-400' 
                                    : isAtRiskOfLiquidation 
                                      ? 'text-red-400'
                                      : 'text-t-fg'
                                }`}>
                                  {position.leverage}x
                                </span>
                              </div>
                              {isAtRiskOfLiquidation && !position.isUnderLiquidation && (
                                <div className="flex flex-col gap-1">
                                  <div className="bg-red-400/10 border border-red-400/20 rounded-md px-2.5 py-1.5">
                                    <div className="flex items-center gap-2 mb-1">
                                      <svg className="w-2.5 h-2.5 text-red-400 animate-pulse" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M12 9V14M12 19C8.13401 19 5 15.866 5 12C5 8.13401 8.13401 5 12 5C15.866 5 19 8.13401 19 12C19 15.866 15.866 19 12 19ZM12 16V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                      </svg>
                                      <span className="text-[9px] font-medium text-red-400 uppercase tracking-wide">Liquidation Imminent</span>
                                    </div>
                                    <span className="text-[8px] text-red-400/80">Add margin to avoid liquidation</span>
                                  </div>
                                </div>
                              )}
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
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            <button
                              onClick={() => handleTopUp(position)}
                              className="px-2 sm:px-2.5 py-1 text-[9px] sm:text-[10px] font-medium text-green-400 hover:text-green-300 bg-green-400/5 hover:bg-green-400/10 rounded transition-colors duration-200"
                            >
                              <span className="sm:hidden">Top Up</span>
                              <span className="hidden sm:inline">Top Up Position</span>
                            </button>
                            <button
                              onClick={async () => {
                                setClosePositionId(position.id);
                                setCloseSymbol(position.symbol);
                                setMaxSize(position.size);
                                setCloseSize(toDecimalString(position.size));
                                setRawCloseSize(position.rawSize || '');
                                setCloseExitPrice(null);
                                setShowCloseModal(true);

                                // Fetch the correct market's prices when it differs from the current page
                                const posSymbol = position.symbol.toUpperCase();
                                const identifier = marketSymbolMap.get(posSymbol)?.identifier || posSymbol;
                                if (posSymbol !== metricId.toUpperCase()) {
                                  const prices = await fetchExitPriceForMarket(identifier);
                                  if (prices) {
                                    setCloseExitPrice({ bestBid: prices.bestBid, bestAsk: prices.bestAsk });
                                  }
                                }
                              }}
                              data-walkthrough="token-activity-close-position"
                              className="px-2 sm:px-2.5 py-1 text-[9px] sm:text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-400/5 hover:bg-red-400/10 rounded transition-colors duration-200"
                            >
                              <span className="sm:hidden">Close</span>
                              <span className="hidden sm:inline">Close Position</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                          </td>
                        </tr>
              )}
            </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
    );
  };

  const renderOpenOrdersTable = () => {
    if (displayedOpenOrders.length === 0 && pendingOrders.length === 0) {
      return (
        <ActivityEmptyState
          message={openOrdersIsLoading ? 'Loading open orders…' : 'No open orders'}
          isLoading={openOrdersIsLoading}
        />
      );
    }

    const totalOrders = displayedOpenOrders.length + pendingOrders.length;

    return (
                  <div className="w-full overflow-x-hidden">
                    {totalOrders > 1 && (
                      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-t-stroke">
                        <span className="text-[10px] text-t-fg-label">
                          {totalOrders} open order{totalOrders !== 1 ? 's' : ''}
                        </span>
                        <button
                          onClick={handleCancelAllOrders}
                          disabled={isCancelingAll || isCancelingOrder}
                          className="px-2.5 py-1 text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-400/5 hover:bg-red-400/10 border border-red-400/20 hover:border-red-400/30 rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isCancelingAll
                            ? `Cancelling ${cancelAllProgress.done}/${cancelAllProgress.total}...`
                            : 'Cancel All'}
                        </button>
                      </div>
                    )}
                    <table className="w-full">
                    <thead>
                      <tr className="border-b border-t-stroke">
                        <th className="text-left pl-1.5 sm:pl-2 pr-1 py-1.5 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Symbol</th>
                        <th className="text-left px-1 sm:px-2 py-1.5 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Side</th>
                        <th className="hidden md:table-cell text-left px-2 py-1.5 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Type</th>
                        <th className="text-right px-1 sm:px-2 py-1.5 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Price</th>
                        <th className="hidden sm:table-cell text-right px-2 py-1.5 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Size</th>
                        <th className="hidden sm:table-cell text-right px-2 py-1.5 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Status</th>
                        <th className="text-right pr-1.5 sm:pr-2 pl-1 py-1.5 text-[10px] font-medium text-t-fg-label uppercase tracking-wide"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingOrders.map((po) => (
                        <tr
                          key={po.id}
                          className="pending-order-shimmer border-b border-t-stroke-sub"
                        >
                          <td className="pl-1.5 sm:pl-2 pr-1 py-1.5 max-w-0">
                            <div className="flex items-center gap-1 min-w-0">
                              <img
                                src={(marketSymbolMap.get(po.symbol)?.icon as string) || FALLBACK_TOKEN_ICON}
                                alt={`${po.symbol} logo`}
                                className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 rounded-full border border-t-stroke-hover object-cover opacity-60"
                              />
                              <div className="min-w-0">
                                <span className="block truncate text-[10px] sm:text-[11px] font-medium text-t-fg opacity-70">
                                  {truncateMarketName(marketSymbolMap.get(po.symbol)?.name || po.symbol)}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-1 sm:px-2 py-1.5 whitespace-nowrap">
                            <span className={`text-[10px] sm:text-[11px] font-medium opacity-70 ${po.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{po.side}</span>
                          </td>
                          <td className="hidden md:table-cell px-2 py-1.5">
                            <span className="text-[11px] text-t-fg opacity-70">{po.type}</span>
                          </td>
                          <td className="px-1 sm:px-2 py-1.5 text-right">
                            <span className="text-[10px] sm:text-[11px] text-t-fg font-mono opacity-70">
                              {po.type === 'MARKET' ? 'Market' : `$${formatPrice(po.price)}`}
                            </span>
                          </td>
                          <td className="hidden sm:table-cell px-2 py-1.5 text-right">
                            <span className="text-[10px] sm:text-[11px] text-t-fg font-mono opacity-70">{formatAmount(po.size, 4)}</span>
                          </td>
                          <td className="hidden sm:table-cell px-2 py-1.5 text-right">
                            <span className="inline-flex items-center gap-1.5 text-[10px] text-blue-400 font-medium">
                              <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
                                <path d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                              PROCESSING
                            </span>
                          </td>
                          <td className="pr-1.5 sm:pr-2 pl-1 py-1.5 text-right">
                            <span className="text-[9px] text-t-fg-label opacity-50">…</span>
                          </td>
                        </tr>
                      ))}
                      {displayedOpenOrders.map((order, index) => {
                        const uiKey = getOrderUiKey(order);
                        const removalKey = getOrderCompositeKey(order.symbol, order.id);
                        const isExpanded = expandedOrderKey === uiKey;
                        const slidePhase = slideOutOrderKeys.get(removalKey);
                        const isCancelWaiting = slidePhase === 'waiting';
                        const isSliding = slidePhase === 'sliding';
                        const isNewOrder = newlyArrivedOrderKeys.has(removalKey);
                        return (
                        <React.Fragment key={uiKey}>
                          <tr
                            className={`mat-slide-rtl group/row hover:bg-t-card-hover transition-all duration-200 ${index !== displayedOpenOrders.length - 1 ? 'border-b border-t-stroke-sub' : ''} ${isSliding ? 'order-row-slide-out' : ''} ${isCancelWaiting ? 'opacity-50' : ''} ${isNewOrder ? 'order-row-new-arrival' : ''}`}
                            style={{ animationDelay: `${index * 50}ms` }}
                            onAnimationEnd={(e) => {
                              if (e.animationName !== 'order-row-slide-out') return;
                              completeSlideOut(removalKey);
                            }}
                          >
                            <td className="pl-1.5 sm:pl-2 pr-1 py-1.5 max-w-0">
                              <div className="flex items-center gap-1 min-w-0">
                                <Link
                                  href={getTokenHref(order.symbol)}
                                  className="group/link flex min-w-0 max-w-full items-center gap-1 sm:gap-2 hover:opacity-90 transition-opacity"
                                  title={`Open ${order.symbol} market`}
                                >
                                  <img
                                    src={(marketSymbolMap.get(order.symbol)?.icon as string) || FALLBACK_TOKEN_ICON}
                                    alt={`${order.symbol} logo`}
                                    className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 rounded-full border border-t-stroke-hover object-cover"
                                  />
                                  <div className="min-w-0">
                                    <span className="block truncate text-[10px] sm:text-[11px] font-medium text-t-fg">
                                      {truncateMarketName(marketSymbolMap.get(order.symbol)?.name || order.symbol)}
                                    </span>
                                    <span className="hidden md:block truncate text-[10px] text-t-fg-label">
                                      {marketSymbolMap.get(order.symbol)?.identifier || order.symbol}
                                    </span>
                                  </div>
                                </Link>
                              </div>
                            </td>
                            <td className="px-1 sm:px-2 py-1.5 whitespace-nowrap">
                              <span className={`text-[10px] sm:text-[11px] font-medium ${order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{order.side}</span>
                            </td>
                            <td className="hidden md:table-cell px-2 py-1.5">
                              <span className="text-[11px] text-t-fg">{order.type}</span>
                            </td>
                            <td className="px-1 sm:px-2 py-1.5 text-right">
                              <span className="text-[10px] sm:text-[11px] text-t-fg font-mono">${formatPrice(order.price)}</span>
                            </td>
                            <td className="hidden sm:table-cell px-2 py-1.5 text-right">
                              <span className="text-[10px] sm:text-[11px] text-t-fg font-mono">{formatAmount(order.size, 4)}</span>
                            </td>
                            <td className="hidden sm:table-cell px-2 py-1.5 text-right">
                              <span className="text-[11px] text-t-fg-label">{order.status}</span>
                            </td>
                            <td className="pr-1.5 sm:pr-2 pl-1 py-1.5 text-right">
                              <button
                                onClick={() => setExpandedOrderKey(isExpanded ? null : uiKey)}
                                className="sm:opacity-0 sm:group-hover/row:opacity-100 transition-opacity duration-200 px-1 sm:px-1.5 py-0.5 text-[9px] text-t-fg hover:text-t-fg hover:bg-t-card-hover rounded"
                              >
                                {isExpanded ? '\u25BE' : '\u25B8'}
                                <span className="hidden sm:inline ml-0.5">{isExpanded ? 'Hide' : 'Manage'}</span>
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className={`bg-t-inset ${isSliding ? 'order-row-slide-out' : ''}`}>
                              <td colSpan={100} className="px-0">
                                <div className="px-2 py-1.5 border-t border-t-stroke">
                                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                    <div className="flex items-center gap-3 flex-wrap">
                                      <div className="flex items-center gap-3">
                                        <div className="flex flex-col gap-1 sm:hidden">
                                          <span className="text-[9px] text-t-fg-label">Size</span>
                                          <span className="text-[10px] font-medium text-t-fg font-mono">
                                            {formatAmount(order.size, 4)}
                                          </span>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                          <span className="text-[9px] text-t-fg-label">Value</span>
                                          <span className="text-[10px] font-medium text-t-fg font-mono">
                                            ${formatPrice(order.price * order.size)}
                                          </span>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                          <span className="text-[9px] text-t-fg-label">Fill Progress</span>
                                          <span className="text-[10px] font-medium text-t-fg font-mono">
                                            {order.size > 0 ? ((order.filled / order.size) * 100).toFixed(1) : '0.0'}%
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 sm:gap-2">
                                        {order.type === 'LIMIT' && (
                                          <button
                                            onClick={() => {
                                              setModifyOrder(order);
                                              setModifyPrice(String(order.price));
                                              setModifySize(String(order.size));
                                              setModifyError(null);
                                              setShowModifyModal(true);
                                            }}
                                            disabled={isCancelingOrder || isCancelingAll || isModifying}
                                            className="px-2 sm:px-2.5 py-1 text-[10px] font-medium text-blue-400 hover:text-blue-300 bg-blue-400/5 hover:bg-blue-400/10 rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                          >
                                            Modify
                                          </button>
                                        )}
                                        <button
                                          onClick={async () => {
                                            const removalKey = getOrderCompositeKey(order.symbol, order.id);
                                            const revertOrder = () => {
                                              cancelSlideOut(removalKey);
                                              setOptimisticallyRemovedOrderIds(prev => {
                                                const next = new Set(prev);
                                                next.delete(removalKey);
                                                return next;
                                              });
                                            };
                                            try {
                                              startCancelModal();
                                              setIsCancelingOrder(true);
                                              const metric = String(order.metricId || order.symbol);
                                              const obAddress = order.orderBookAddress || resolveOrderBookAddress(metric || order.symbol);
                                              if (GASLESS && walletAddress && obAddress) {
                                                let oid: bigint;
                                                try { oid = typeof order.id === 'bigint' ? (order.id as any) : BigInt(order.id as any); } catch { oid = 0n; }
                                                if (oid === 0n) throw new Error('Invalid order id');
                                                const activeSessionId =
                                                  globalSessionId ||
                                                  (typeof window !== 'undefined'
                                                    ? (window.localStorage.getItem(`gasless:session:${walletAddress}`) || '')
                                                    : '');
                                                if (!activeSessionId || globalSessionActive !== true) {
                                                  throw new Error('Trading session is not enabled. Click Enable Trading before using gasless cancel.');
                                                }
                                                scheduleSlideOut(removalKey);
                                                setOrderFillModal((cur) => ({ ...cur, status: 'canceling' }));
                                                const r = await submitSessionTrade({
                                                  method: 'sessionCancelOrder',
                                                  orderBook: obAddress,
                                                  sessionId: activeSessionId,
                                                  trader: walletAddress as string,
                                                  orderId: oid as unknown as bigint,
                                                });
                                                if (!r.success) {
                                                  revertOrder();
                                                  const msg = r.error || 'Gasless cancel failed';
                                                  if (isSessionErrorMessage(msg)) {
                                                    clearSession();
                                                    throw new Error(msg || 'Trading session expired. Click Enable Trading to re-enable gasless trading.');
                                                  }
                                                  throw new Error(msg);
                                                }
                                                finishCancelModal();
                                                removeOrderFromSessionCache(order.id, metric);
                                                try { await refreshGlobalOrders(); } catch {}
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
                                              } else {
                                                scheduleSlideOut(removalKey);
                                                setOrderFillModal((cur) => ({ ...cur, status: 'canceling' }));
                                                const ok = await cancelOrderForMarket(order.id, metric);
                                                if (!ok) {
                                                  revertOrder();
                                                  showError('Failed to cancel order. Please try again.', 'Cancellation Failed');
                                                } else {
                                                  finishCancelModal();
                                                  removeOrderFromSessionCache(order.id, metric);
                                                  try { await refreshGlobalOrders(); } catch {}
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
                                            } catch (e: any) {
                                              revertOrder();
                                              showError(e?.message || 'Cancellation failed. Please try again.', 'Cancellation Failed');
                                            } finally {
                                              setIsCancelingOrder(false);
                                            }
                                          }}
                                          disabled={isCancelingOrder}
                                          className="px-2 sm:px-2.5 py-1 text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-400/5 hover:bg-red-400/10 rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
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
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
    );
  };

  // Trade history pagination state
  const [tradeOffset, setTradeOffset] = useState(0);
  const [tradeLimit, setTradeLimit] = useState(10);
  const [hasMoreTrades, setHasMoreTrades] = useState(false);
  const [isLoadingTrades, setIsLoadingTrades] = useState(false);
  const [showClosedSummary, setShowClosedSummary] = useState(false);
  const [tradeFilter, setTradeFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  
  // All trades for PnL calculation (need full history to properly match positions)
  const [allTradesForPnL, setAllTradesForPnL] = useState<Trade[]>([]);

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

  // Load ALL trades for PnL calculation (need full history to properly match opening/closing trades)
  useEffect(() => {
    let isMounted = true;
    
    const loadAllTrades = async () => {
      if (!walletAddress) {
        setAllTradesForPnL([]);
        return;
      }
      
      try {
        const { getUserTradeHistory } = orderBookActions;
        if (!getUserTradeHistory) return;
        
        // Fetch a large batch of trades for PnL calculation (up to 500)
        const { trades: allTrades } = await getUserTradeHistory(0, 500);
        
        if (isMounted && allTrades && allTrades.length > 0) {
          setAllTradesForPnL(allTrades);
        }
      } catch (error) {
        console.error('Failed to load all trades for PnL calculation:', error);
      }
    };
    
    loadAllTrades();
    
    return () => { isMounted = false; };
  }, [walletAddress, orderBookActions.getUserTradeHistory]);

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

  const { closedPositions, settlementPnL } = useMemo((): {
    closedPositions: ClosedPosition[];
    settlementPnL: SettlementPnLSummary | null;
  } => {
    if (!walletAddress || trades.length === 0) return { closedPositions: [], settlementPnL: null };

    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    const openLots: Array<{
      side: 'BUY' | 'SELL';
      price: number;
      remaining: number;
      feePerUnit: number;
      timestamp: number;
      marginLocked: number;
    }> = [];
    const results: ClosedPosition[] = [];

    // Margin requirements: 10% for longs, 15% for shorts (matching contract logic)
    const LONG_MARGIN_MULTIPLIER = 0.10;
    const SHORT_MARGIN_MULTIPLIER = 0.15;
    // Liquidation penalty from contract: 10%
    const LIQUIDATION_PENALTY_BPS = 0.10;

    for (const trade of sorted) {
      const isBuyer = trade.buyer.toLowerCase() === walletAddress.toLowerCase();
      const side: 'BUY' | 'SELL' = isBuyer ? 'BUY' : 'SELL';
      const fee = isBuyer ? trade.buyerFee : trade.sellerFee;
      const oppositeSide = side === 'BUY' ? 'SELL' : 'BUY';
      let remaining = trade.amount;
      const feePerUnit = trade.amount > 0 ? fee / trade.amount : 0;
      
      // Check if this trade was a liquidation
      // Also detect liquidation by checking if counterparty is the OrderBook
      const orderBookAddr = trade.orderBookAddress?.toLowerCase() || '';
      const counterparty = isBuyer ? trade.seller : trade.buyer;
      const counterpartyLower = String(counterparty || '').toLowerCase();
      const isLiquidationTrade = Boolean(trade.isLiquidation) || 
        (orderBookAddr !== '' && counterpartyLower === orderBookAddr);
      
      // Debug logging for liquidation detection
      if (isLiquidationTrade) {
        console.log('[LIQ DEBUG] Liquidation trade detected:', {
          tradeId: trade.tradeId,
          side,
          price: trade.price,
          amount: trade.amount,
          isLiquidation: trade.isLiquidation,
          orderBookAddr,
          counterparty: counterpartyLower,
        });
      }

      while (remaining > 0) {
        const matchIdx = openLots.findIndex((l) => l.side === oppositeSide);
        if (matchIdx === -1) break;

        const lot = openLots[matchIdx];
        const matched = Math.min(remaining, lot.remaining);

        const isLong = lot.side === 'BUY';
        const entryPrice = isLong ? lot.price : trade.price;
        const exitPrice = isLong ? trade.price : lot.price;
        const entryValue = entryPrice * matched;
        const exitValue = exitPrice * matched;
        
        // Calculate margin locked for this portion (proportional to matched amount)
        const marginLockedPortion = lot.remaining > 0 
          ? (lot.marginLocked * matched) / lot.remaining 
          : 0;
        
        let rawPnl: number;
        let pnl: number;
        let wasLiquidated = false;
        
        if (isLiquidationTrade) {
          // LIQUIDATION: User loses their margin + liquidation penalty
          // For liquidation, the PnL should ALWAYS be negative
          // The user loses their margin that was locked for this position
          
          const pricePnl = isLong
            ? (exitPrice - entryPrice) * matched
            : (entryPrice - exitPrice) * matched;
          
          // The notional value for penalty calculation
          const notional = entryValue;
          const penalty = notional * LIQUIDATION_PENALTY_BPS;
          
          // For liquidation: if price PnL appears positive (shouldn't happen normally),
          // still count it as a loss of margin
          const tradingLoss = pricePnl < 0 ? Math.abs(pricePnl) : 0;
          
          // Total loss is at minimum the margin locked (user loses collateral)
          // Plus any additional trading loss and penalty
          const marginLoss = marginLockedPortion > 0 ? marginLockedPortion : (notional * 0.10);
          const actualLoss = Math.max(marginLoss, tradingLoss + penalty);
          
          rawPnl = -Math.abs(actualLoss); // ALWAYS negative for liquidation
          pnl = rawPnl;
          wasLiquidated = true;
          
          console.log('[LIQ DEBUG] Closed position via liquidation:', {
            direction: isLong ? 'LONG' : 'SHORT',
            entryPrice,
            exitPrice,
            matched,
            pricePnl,
            marginLocked: marginLockedPortion,
            penalty,
            actualLoss,
            pnl,
          });
        } else {
          // Normal close: standard PnL calculation
          rawPnl = isLong
            ? (exitPrice - entryPrice) * matched
            : (entryPrice - exitPrice) * matched;
          const matchedFees = lot.feePerUnit * matched + feePerUnit * matched;
          pnl = rawPnl - matchedFees;
        }
        
        const pnlPercent = entryValue > 0 ? (pnl / entryValue) * 100 : 0;
        const matchedFees = lot.feePerUnit * matched + feePerUnit * matched;

        results.push({
          direction: isLong ? 'LONG' : 'SHORT',
          entryPrice: isLong ? lot.price : trade.price,
          exitPrice: isLong ? trade.price : lot.price,
          size: matched,
          entryValue,
          exitValue,
          pnl,
          pnlPercent,
          totalFees: wasLiquidated ? 0 : matchedFees, // Fees are part of liquidation penalty
          entryTime: isLong ? lot.timestamp : trade.timestamp,
          exitTime: isLong ? trade.timestamp : lot.timestamp,
          wasLiquidated,
          marginLocked: marginLockedPortion,
        });

        lot.remaining -= matched;
        remaining -= matched;
        if (lot.remaining <= 0) openLots.splice(matchIdx, 1);
      }

      if (remaining > 0) {
        // Opening a new position - calculate margin required
        const isLongPosition = side === 'BUY';
        const notional = trade.price * remaining;
        const marginMultiplier = isLongPosition ? LONG_MARGIN_MULTIPLIER : SHORT_MARGIN_MULTIPLIER;
        const marginLocked = notional * marginMultiplier;
        
        openLots.push({ 
          side, 
          price: trade.price, 
          remaining, 
          feePerUnit, 
          timestamp: trade.timestamp,
          marginLocked 
        });
      }
    }

    // For settled markets: close remaining open lots against the settlement price
    let summaryData: SettlementPnLSummary | null = null;
    if (isMarketSettled && settlementPrice > 0 && openLots.length > 0) {
      const settledPositions: ClosedPosition[] = [];
      const settlementTs = currentMarket?.settlement_timestamp
        ? new Date(currentMarket.settlement_timestamp).getTime()
        : Date.now();

      for (const lot of openLots) {
        if (lot.remaining <= 0) continue;
        const isLong = lot.side === 'BUY';
        const entryPrice = lot.price;
        const exitPrice = settlementPrice;
        const size = lot.remaining;
        const entryValue = entryPrice * size;
        const exitValue = exitPrice * size;
        const rawPnl = isLong
          ? (exitPrice - entryPrice) * size
          : (entryPrice - exitPrice) * size;
        const totalFees = lot.feePerUnit * size;
        const pnl = rawPnl - totalFees;

        // Margin: longs = 100% of entry value, shorts = 150% of entry value
        const marginMultiplier = isLong ? 1.0 : 1.5;
        const marginUsed = entryValue * marginMultiplier;
        const pnlPercent = marginUsed > 0 ? (pnl / marginUsed) * 100 : 0;

        const pos: ClosedPosition = {
          direction: isLong ? 'LONG' : 'SHORT',
          entryPrice,
          exitPrice,
          size,
          entryValue,
          exitValue,
          pnl,
          pnlPercent,
          totalFees,
          entryTime: lot.timestamp,
          exitTime: settlementTs,
          settledViaSettlement: true,
        };
        settledPositions.push(pos);
        results.push(pos);
      }

      // Build aggregate summary
      const closedPnl = results.filter(r => !r.settledViaSettlement).reduce((s, r) => s + r.pnl, 0);
      const openLotsPnl = settledPositions.reduce((s, r) => s + r.pnl, 0);
      const totalPnl = closedPnl + openLotsPnl;
      const totalFees = results.reduce((s, r) => s + r.totalFees, 0);

      let totalMarginUsed = 0;
      let longCount = 0;
      let shortCount = 0;
      let longPnl = 0;
      let shortPnl = 0;
      for (const p of results) {
        const marginMult = p.direction === 'LONG' ? 1.0 : 1.5;
        totalMarginUsed += p.entryValue * marginMult;
        if (p.direction === 'LONG') { longCount++; longPnl += p.pnl; }
        else { shortCount++; shortPnl += p.pnl; }
      }

      summaryData = {
        settlementPrice,
        totalPnl,
        totalMarginUsed,
        returnOnMargin: totalMarginUsed > 0 ? (totalPnl / totalMarginUsed) * 100 : 0,
        totalFees,
        longCount,
        shortCount,
        longPnl,
        shortPnl,
        settledPositions,
        openLotsPnl,
        closedPnl,
      };
    } else if (isMarketSettled && settlementPrice > 0 && openLots.length === 0 && results.length > 0) {
      // All positions were closed before settlement — still show summary with settlement context
      const totalPnl = results.reduce((s, r) => s + r.pnl, 0);
      const totalFees = results.reduce((s, r) => s + r.totalFees, 0);
      let totalMarginUsed = 0;
      let longCount = 0;
      let shortCount = 0;
      let longPnl = 0;
      let shortPnl = 0;
      for (const p of results) {
        const marginMult = p.direction === 'LONG' ? 1.0 : 1.5;
        totalMarginUsed += p.entryValue * marginMult;
        if (p.direction === 'LONG') { longCount++; longPnl += p.pnl; }
        else { shortCount++; shortPnl += p.pnl; }
      }
      summaryData = {
        settlementPrice,
        totalPnl,
        totalMarginUsed,
        returnOnMargin: totalMarginUsed > 0 ? (totalPnl / totalMarginUsed) * 100 : 0,
        totalFees,
        longCount,
        shortCount,
        longPnl,
        shortPnl,
        settledPositions: [],
        openLotsPnl: 0,
        closedPnl: totalPnl,
      };
    }

    return {
      closedPositions: results.sort((a, b) => b.exitTime - a.exitTime),
      settlementPnL: summaryData,
    };
  }, [trades, walletAddress, isMarketSettled, settlementPrice, currentMarket?.settlement_timestamp]);

  useEffect(() => {
    onSettlementPnl?.(settlementPnL);
  }, [settlementPnL, onSettlementPnl]);

  // Calculate realized PnL per trade (for showing in trade history)
  // Uses allTradesForPnL which contains full trade history for accurate FIFO matching
  const tradeRealizedPnL = useMemo((): Map<string, { pnl: number; closedSize: number; wasLiquidated: boolean }> => {
    const result = new Map<string, { pnl: number; closedSize: number; wasLiquidated: boolean }>();
    // Use allTradesForPnL for accurate PnL calculation (needs full history)
    const tradesToProcess = allTradesForPnL.length > 0 ? allTradesForPnL : trades;
    if (!walletAddress || tradesToProcess.length === 0) return result;

    console.log('[PnL Calc] Processing trades for realized PnL:', {
      allTradesCount: allTradesForPnL.length,
      displayedTradesCount: trades.length,
      usingFullHistory: allTradesForPnL.length > 0
    });

    const sorted = [...tradesToProcess].sort((a, b) => a.timestamp - b.timestamp);
    const openLots: Array<{
      side: 'BUY' | 'SELL';
      price: number;
      remaining: number;
      feePerUnit: number;
    }> = [];

    const LONG_MARGIN_MULTIPLIER = 0.10;
    const SHORT_MARGIN_MULTIPLIER = 0.15;
    const LIQUIDATION_PENALTY_BPS = 0.10;

    for (const trade of sorted) {
      const isBuyer = trade.buyer.toLowerCase() === walletAddress.toLowerCase();
      const side: 'BUY' | 'SELL' = isBuyer ? 'BUY' : 'SELL';
      const fee = isBuyer ? trade.buyerFee : trade.sellerFee;
      const oppositeSide = side === 'BUY' ? 'SELL' : 'BUY';
      let remaining = trade.amount;
      const feePerUnit = trade.amount > 0 ? fee / trade.amount : 0;

      // Detect liquidation
      const orderBookAddr = trade.orderBookAddress?.toLowerCase() || '';
      const counterparty = isBuyer ? trade.seller : trade.buyer;
      const counterpartyLower = String(counterparty || '').toLowerCase();
      const isLiquidationTrade = Boolean(trade.isLiquidation) || 
        (orderBookAddr !== '' && counterpartyLower === orderBookAddr);

      let totalPnlForTrade = 0;
      let totalClosedSize = 0;
      let wasLiquidated = false;

      // Match against open positions (closing trades)
      while (remaining > 0) {
        const matchIdx = openLots.findIndex((l) => l.side === oppositeSide);
        if (matchIdx === -1) break;

        const lot = openLots[matchIdx];
        const matched = Math.min(remaining, lot.remaining);

        const isLong = lot.side === 'BUY';
        const entryPrice = isLong ? lot.price : trade.price;
        const exitPrice = isLong ? trade.price : lot.price;
        const entryValue = entryPrice * matched;

        let pnl: number;

        if (isLiquidationTrade) {
          // Liquidation PnL - user loses margin
          const notional = entryValue;
          const penalty = notional * LIQUIDATION_PENALTY_BPS;
          const marginMultiplier = isLong ? LONG_MARGIN_MULTIPLIER : SHORT_MARGIN_MULTIPLIER;
          const marginLoss = notional * marginMultiplier;
          pnl = -Math.abs(marginLoss + penalty);
          wasLiquidated = true;
        } else {
          // Normal close PnL
          const rawPnl = isLong
            ? (exitPrice - entryPrice) * matched
            : (entryPrice - exitPrice) * matched;
          const matchedFees = lot.feePerUnit * matched + feePerUnit * matched;
          pnl = rawPnl - matchedFees;
        }

        totalPnlForTrade += pnl;
        totalClosedSize += matched;

        lot.remaining -= matched;
        remaining -= matched;
        if (lot.remaining <= 0) openLots.splice(matchIdx, 1);
      }

      // Store realized PnL for this trade (only if it closed something)
      if (totalClosedSize > 0) {
        console.log('[PnL Calc] Trade closed position:', {
          tradeId: trade.tradeId,
          side,
          price: trade.price,
          amount: trade.amount,
          closedSize: totalClosedSize,
          pnl: totalPnlForTrade,
          wasLiquidated,
          timestamp: new Date(trade.timestamp * 1000).toISOString()
        });
        result.set(trade.tradeId, { 
          pnl: totalPnlForTrade, 
          closedSize: totalClosedSize,
          wasLiquidated 
        });
      }

      // Any remaining amount opens a new position
      if (remaining > 0) {
        openLots.push({ side, price: trade.price, remaining, feePerUnit });
      }
    }

    return result;
  }, [allTradesForPnL, trades, walletAddress]);

  const renderTradesTable = () => {

    if (isLoadingTrades) {
      return <ActivityEmptyState message="Loading trade history..." isLoading />;
    }

    if (!walletAddress) {
      return <ActivityEmptyState message="Connect wallet to view trade history" />;
    }

    if (trades.length === 0) {
      return <ActivityEmptyState message="No trades yet" />;
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
      <div className="space-y-2 sm:space-y-4">
        {/* Trade Statistics and Controls Header */}
        <div className="bg-t-card rounded-md border border-t-stroke p-1.5 sm:p-2 space-y-1.5 sm:space-y-2">
          {/* Stats row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-4 flex-wrap min-w-0">
              <h4 className="text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide whitespace-nowrap">Performance</h4>
              <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                <div className="flex items-center gap-1">
                  <span className="text-[8px] sm:text-[9px] text-t-fg-label whitespace-nowrap">Vol:</span>
                  <span className="text-[9px] sm:text-[10px] font-medium text-t-fg font-mono">${stats.totalVolume.toFixed(2)}</span>
                </div>
                <div className="hidden sm:flex items-center gap-1">
                  <span className="text-[9px] text-t-fg-label whitespace-nowrap">Fees:</span>
                  <span className="text-[10px] font-medium text-t-fg font-mono">${stats.totalFees.toFixed(4)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[8px] sm:text-[9px] text-t-fg-label whitespace-nowrap">B/S:</span>
                  <span className="text-[9px] sm:text-[10px] font-medium text-t-fg font-mono">{stats.buyCount}/{stats.sellCount}</span>
                </div>
                <div className="hidden sm:flex items-center gap-1">
                  <span className="text-[9px] text-t-fg-label whitespace-nowrap">Avg Size:</span>
                  <span className="text-[10px] font-medium text-t-fg font-mono">${stats.avgTradeSize.toFixed(2)}</span>
                </div>
              </div>
            </div>
            <span className="text-[9px] sm:text-[10px] text-t-fg-label whitespace-nowrap flex-shrink-0">
              {orderBookState.tradeCount}
            </span>
          </div>
          {/* Controls row */}
          <div className="flex items-center justify-between border-t border-t-stroke-sub pt-1.5 sm:pt-2 gap-2">
            <div className="flex items-center rounded border border-t-stroke-hover overflow-hidden flex-shrink-0">
              {(['ALL', 'BUY', 'SELL'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setTradeFilter(f)}
                  className={`px-1.5 sm:px-2.5 py-1 text-[9px] sm:text-[10px] font-medium transition-colors duration-150 ${
                    tradeFilter === f
                      ? f === 'BUY' ? 'bg-green-400/15 text-green-400' : f === 'SELL' ? 'bg-red-400/15 text-red-400' : 'bg-t-skeleton text-t-fg'
                      : 'text-t-fg-sub hover:text-t-fg hover:bg-t-card-hover'
                  }`}
                >
                  {f === 'ALL' ? 'All' : f === 'BUY' ? 'Long' : 'Short'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <select
                value={tradeLimit}
                onChange={(e) => {
                  setTradeLimit(Number(e.target.value));
                  setTradeOffset(0);
                }}
                className="bg-t-inset border border-t-stroke-hover rounded px-1.5 sm:px-2 py-1 text-[10px] sm:text-[11px] text-t-fg focus:outline-none focus:border-blue-400"
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
              <button
                onClick={() => {
                  const rows = trades
                    .filter((t) => {
                      if (tradeFilter === 'ALL') return true;
                      const isBuyer = t.buyer.toLowerCase() === walletAddress?.toLowerCase();
                      return tradeFilter === 'BUY' ? isBuyer : !isBuyer;
                    })
                    .map((t) => {
                      const isBuyer = t.buyer.toLowerCase() === walletAddress?.toLowerCase();
                      return {
                        Side: isBuyer ? 'BUY' : 'SELL',
                        Price: t.price.toFixed(6),
                        Size: t.amount.toFixed(8),
                        Value: t.tradeValue.toFixed(2),
                        Fee: (isBuyer ? t.buyerFee : t.sellerFee).toFixed(6),
                        Type: (isBuyer ? t.buyerIsMargin : t.sellerIsMargin) ? 'Margin' : 'Spot',
                        Time: new Date(t.timestamp).toISOString(),
                        TradeId: t.tradeId,
                      };
                    });
                  if (rows.length === 0) return;
                  const headers = Object.keys(rows[0]);
                  const csv = [
                    headers.join(','),
                    ...rows.map((r) => headers.map((h) => `"${(r as any)[h]}"`).join(',')),
                  ].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `trade-history-${symbol || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-2 py-1 text-[10px] font-medium text-t-fg-sub hover:text-t-fg bg-t-inset hover:bg-t-card-hover border border-t-stroke-hover hover:border-[#444444] rounded transition-colors duration-150"
                title="Export trades as CSV"
              >
                <svg className="w-3 h-3 inline-block mr-1 -mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                CSV
              </button>
            </div>
          </div>
        </div>

        {/* Settlement P&L Summary */}
        {settlementPnL && (
          <div className="bg-t-card rounded-md border border-t-stroke overflow-hidden">
            <div className="px-3 py-2.5 border-b border-t-stroke bg-t-inset/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <h4 className="text-[10px] font-semibold text-t-fg uppercase tracking-wider">Settlement P&L</h4>
                </div>
                <span className="text-[10px] text-t-fg-label font-mono">
                  @ ${formatPrice(settlementPnL.settlementPrice)}
                </span>
              </div>
            </div>
            <div className="px-3 py-2.5 space-y-2.5">
              {/* Main P&L figure */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-t-fg-label">Total P&L</span>
                <span className={`text-sm font-bold font-mono ${settlementPnL.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {settlementPnL.totalPnl >= 0 ? '+' : ''}${formatPrice(settlementPnL.totalPnl)}
                </span>
              </div>

              {/* Return on margin */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-t-fg-label">Return on Margin</span>
                <span className={`text-[11px] font-semibold font-mono ${settlementPnL.returnOnMargin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {settlementPnL.returnOnMargin >= 0 ? '+' : ''}{formatPrice(settlementPnL.returnOnMargin)}%
                </span>
              </div>

              {/* Breakdown grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1 border-t border-t-stroke-sub">
                <div className="flex justify-between">
                  <span className="text-[9px] text-t-fg-label">Margin Used</span>
                  <span className="text-[10px] font-mono text-t-fg">${formatPrice(settlementPnL.totalMarginUsed)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[9px] text-t-fg-label">Total Fees</span>
                  <span className="text-[10px] font-mono text-t-fg">${formatPrice(settlementPnL.totalFees)}</span>
                </div>
                {settlementPnL.longCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[9px] text-green-400/70">Longs ({settlementPnL.longCount})</span>
                    <span className={`text-[10px] font-mono ${settlementPnL.longPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {settlementPnL.longPnl >= 0 ? '+' : ''}${formatPrice(settlementPnL.longPnl)}
                    </span>
                  </div>
                )}
                {settlementPnL.shortCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[9px] text-red-400/70">Shorts ({settlementPnL.shortCount})</span>
                    <span className={`text-[10px] font-mono ${settlementPnL.shortPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {settlementPnL.shortPnl >= 0 ? '+' : ''}${formatPrice(settlementPnL.shortPnl)}
                    </span>
                  </div>
                )}
              </div>

              {/* Closed vs settled breakdown */}
              {settlementPnL.settledPositions.length > 0 && (
                <div className="flex items-center gap-3 pt-1.5 border-t border-t-stroke-sub">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-t-fg-label">Closed before settlement:</span>
                    <span className={`text-[10px] font-mono ${settlementPnL.closedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {settlementPnL.closedPnl >= 0 ? '+' : ''}${formatPrice(settlementPnL.closedPnl)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-t-fg-label">Settled at price:</span>
                    <span className={`text-[10px] font-mono ${settlementPnL.openLotsPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {settlementPnL.openLotsPnl >= 0 ? '+' : ''}${formatPrice(settlementPnL.openLotsPnl)}
                    </span>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* Closed Position Summary */}
        {closedPositions.length > 0 && (
          <div className="bg-t-card rounded-md border border-t-stroke">
            <button
              onClick={() => setShowClosedSummary(!showClosedSummary)}
              className="w-full flex items-center justify-between p-2 hover:bg-t-elevated transition-colors rounded-md"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Closed Positions</h4>
                <span className="text-[10px] text-t-fg-label bg-t-skeleton px-1.5 py-0.5 rounded">{closedPositions.length}</span>
                {(() => {
                  const totalPnl = closedPositions.reduce((sum, p) => sum + p.pnl, 0);
                  const liquidatedCount = closedPositions.filter(p => p.wasLiquidated).length;
                  return (
                    <>
                      <span className={`text-[10px] font-medium font-mono ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {totalPnl >= 0 ? '+' : ''}{formatPrice(totalPnl)} USD
                      </span>
                      {liquidatedCount > 0 && (
                        <span className="text-[9px] font-medium text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded border border-red-400/20">
                          {liquidatedCount} liquidated
                        </span>
                      )}
                    </>
                  );
                })()}
              </div>
              <svg
                className={`w-3 h-3 text-t-fg-label transition-transform duration-200 ${showClosedSummary ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showClosedSummary && (
              <div className="overflow-auto scrollbar-hide max-h-60 border-t border-t-stroke">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-t-stroke">
                      <th className="text-left px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Dir</th>
                      <th className="text-right px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Size</th>
                      <th className="hidden sm:table-cell text-right px-2.5 py-2 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Entry</th>
                      <th className="hidden sm:table-cell text-right px-2.5 py-2 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Exit</th>
                      <th className="text-right px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">PnL</th>
                      <th className="hidden md:table-cell text-right px-2.5 py-2 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Fees</th>
                      <th className="hidden md:table-cell text-right px-2.5 py-2 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedPositions.map((pos, i) => {
                      const durationMs = Math.abs(pos.exitTime - pos.entryTime);
                      const durationMin = Math.floor(durationMs / 60_000);
                      const durationHr = Math.floor(durationMin / 60);
                      const durationDay = Math.floor(durationHr / 24);
                      const durationStr = durationDay > 0
                        ? `${durationDay}d ${durationHr % 24}h`
                        : durationHr > 0
                          ? `${durationHr}h ${durationMin % 60}m`
                          : `${durationMin}m`;
                      
                      // For liquidated positions, PnL should always display as negative/loss
                      const displayPnl = pos.wasLiquidated ? -Math.abs(pos.pnl) : pos.pnl;
                      const displayPnlPercent = pos.wasLiquidated ? -Math.abs(pos.pnlPercent) : pos.pnlPercent;
                      const isProfit = !pos.wasLiquidated && displayPnl >= 0;
                      
                      return (
                        <tr key={`cp-${i}`} className={`hover:bg-t-card-hover transition-colors duration-200 ${pos.wasLiquidated ? 'bg-red-950/20' : ''} ${i !== closedPositions.length - 1 ? 'border-b border-t-stroke-sub' : ''}`}>
                          <td className="px-1.5 sm:px-2.5 py-1.5 sm:py-2">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className={`text-[10px] sm:text-[11px] font-medium ${pos.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                                {pos.direction}
                              </span>
                              {pos.wasLiquidated && (
                                <span className="text-[7px] sm:text-[8px] font-medium text-red-400 bg-red-400/20 px-1 py-px rounded border border-red-400/30">
                                  LIQUIDATED
                                </span>
                              )}
                              {pos.settledViaSettlement && (
                                <span className="text-[7px] sm:text-[8px] font-medium text-amber-400 bg-amber-400/10 px-1 py-px rounded">
                                  SETTLED
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-right">
                            <span className="text-[10px] sm:text-[11px] text-t-fg font-mono">{pos.size.toFixed(4)}</span>
                          </td>
                          <td className="hidden sm:table-cell px-2.5 py-2 text-right">
                            <span className="text-[11px] text-t-fg font-mono">${formatPrice(pos.entryPrice)}</span>
                          </td>
                          <td className="hidden sm:table-cell px-2.5 py-2 text-right">
                            <div className="flex flex-col items-end">
                              <span className="text-[11px] text-t-fg font-mono">${formatPrice(pos.exitPrice)}</span>
                              {pos.wasLiquidated && (
                                <span className="text-[8px] text-red-400/70">liq. price</span>
                              )}
                            </div>
                          </td>
                          <td className="px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-right">
                            <div className="flex flex-col items-end">
                              <span className={`text-[10px] sm:text-[11px] font-medium font-mono ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                                {isProfit ? '+' : ''}{displayPnl < 0 ? '-' : ''}${formatPrice(Math.abs(displayPnl))}
                              </span>
                              <span className={`text-[8px] sm:text-[9px] font-mono ${isProfit ? 'text-green-400/60' : 'text-red-400/60'}`}>
                                {isProfit ? '+' : ''}{displayPnlPercent.toFixed(2)}%
                              </span>
                              {pos.wasLiquidated && pos.marginLocked !== undefined && (
                                <span className="text-[7px] text-red-400/50">
                                  margin: ${formatPrice(pos.marginLocked)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="hidden md:table-cell px-2.5 py-2 text-right">
                            <span className="text-[11px] text-t-fg-label font-mono">
                              {pos.wasLiquidated ? '-' : `$${pos.totalFees.toFixed(4)}`}
                            </span>
                          </td>
                          <td className="hidden md:table-cell px-2.5 py-2 text-right">
                            <span className="text-[11px] text-t-fg-label">{durationStr}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Trade History Table */}
        <div className="overflow-auto scrollbar-hide max-h-96">
          <table className="w-full">
            <thead>
              <tr className="border-b border-t-stroke">
                <th className="text-left px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Side</th>
                <th className="text-right px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Price</th>
                <th className="text-right px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Size</th>
                <th className="hidden sm:table-cell text-right px-2.5 py-2 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Value</th>
                <th className="text-right px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Realized P&L</th>
                <th className="hidden md:table-cell text-right px-2.5 py-2 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Fee</th>
                <th className="hidden lg:table-cell text-right px-2.5 py-2 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Type</th>
                <th className="text-right px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Time</th>
              </tr>
            </thead>
            <tbody>
              {trades
                .filter((trade) => {
                  if (tradeFilter === 'ALL') return true;
                  const isBuyer = trade.buyer.toLowerCase() === walletAddress?.toLowerCase();
                  return tradeFilter === 'BUY' ? isBuyer : !isBuyer;
                })
                .map((trade, index, filtered) => {
                const isBuyer = trade.buyer.toLowerCase() === walletAddress?.toLowerCase();
                const side = isBuyer ? 'BUY' : 'SELL';
                const fee = isBuyer ? trade.buyerFee : trade.sellerFee;
                const isMargin = isBuyer ? trade.buyerIsMargin : trade.sellerIsMargin;
                const isLiquidation = Boolean(trade.isLiquidation);
                
                // Get realized PnL for this trade
                const realizedData = tradeRealizedPnL.get(trade.tradeId);
                const hasRealizedPnL = realizedData && realizedData.closedSize > 0;
                const realizedPnL = realizedData?.pnl || 0;
                const wasLiquidated = realizedData?.wasLiquidated || false;

                return (
                  <tr key={`${trade.tradeId}-${index}`} className={`hover:bg-t-card-hover transition-colors duration-200 ${isLiquidation || wasLiquidated ? 'bg-red-950/20' : ''} ${index !== filtered.length - 1 ? 'border-b border-t-stroke-sub' : ''}`}>
                    <td className="px-1.5 sm:px-2.5 py-2 sm:py-2.5">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className={`text-[10px] sm:text-[11px] font-medium ${side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{side}</span>
                        {(isLiquidation || wasLiquidated) && (
                          <span className="text-[7px] sm:text-[8px] font-medium text-red-400 bg-red-400/20 px-1 py-px rounded border border-red-400/30">
                            LIQ
                          </span>
                        )}
                        {hasRealizedPnL && !wasLiquidated && (
                          <span className="text-[7px] sm:text-[8px] font-medium text-blue-400 bg-blue-400/10 px-1 py-px rounded">
                            CLOSE
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-1.5 sm:px-2.5 py-2 sm:py-2.5 text-right">
                      <span className="text-[10px] sm:text-[11px] text-t-fg font-mono">${trade.price.toFixed(2)}</span>
                    </td>
                    <td className="px-1.5 sm:px-2.5 py-2 sm:py-2.5 text-right">
                      <span className="text-[10px] sm:text-[11px] text-t-fg font-mono">{trade.amount.toFixed(4)}</span>
                    </td>
                    <td className="hidden sm:table-cell px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-t-fg font-mono">${trade.tradeValue.toFixed(2)}</span>
                    </td>
                    <td className="px-1.5 sm:px-2.5 py-2 sm:py-2.5 text-right">
                      {hasRealizedPnL ? (
                        <span className={`text-[10px] sm:text-[11px] font-medium font-mono ${realizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {realizedPnL >= 0 ? '+' : ''}{realizedPnL < 0 ? '-' : ''}${formatPrice(Math.abs(realizedPnL))}
                        </span>
                      ) : (
                        <span className="text-[10px] sm:text-[11px] text-t-fg-muted font-mono">—</span>
                      )}
                    </td>
                    <td className="hidden md:table-cell px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-t-fg font-mono">${fee.toFixed(4)}</span>
                    </td>
                    <td className="hidden lg:table-cell px-2.5 py-2.5 text-right">
                      <span className={`text-[11px] ${isLiquidation || wasLiquidated ? 'text-red-400' : 'text-t-fg-label'}`}>
                        {isLiquidation || wasLiquidated ? 'Liquidation' : isMargin ? 'Margin' : 'Spot'}
                      </span>
                    </td>
                    <td className="px-1.5 sm:px-2.5 py-2 sm:py-2.5 text-right">
                      <span className="text-[10px] sm:text-[11px] text-t-fg-label">{formatTime(trade.timestamp)}</span>
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
              className="px-2 py-1 text-[11px] text-t-fg hover:text-t-fg disabled:text-t-dot disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setTradeOffset(tradeOffset + tradeLimit)}
              disabled={!hasMoreTrades}
              className="px-2 py-1 text-[11px] text-t-fg hover:text-t-fg disabled:text-t-dot disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>

        {/* Legend */}
        {/* <div className="text-[10px] text-t-fg-muted pt-2">
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
      return <ActivityEmptyState message="No order history" />;
    }

    return (
                  <table className="w-full table-fixed">
                    <thead>
                      <tr className="border-b border-t-stroke">
                        <th className="w-[clamp(100px,24%,260px)] text-left px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Market</th>
                        <th className="text-left px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Side</th>
                        <th className="hidden md:table-cell text-left px-2.5 py-2 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Type</th>
                        <th className="text-right px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Price</th>
                        <th className="hidden sm:table-cell text-right px-2.5 py-2 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Size</th>
                        <th className="hidden sm:table-cell text-right px-2.5 py-2 text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Value</th>
                        <th className="text-right px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium text-t-fg-label uppercase tracking-wide">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderHistory.map((order, index) => (
                        <tr key={`${order.id}-${index}`} className={`hover:bg-t-card-hover transition-colors duration-200 ${index !== orderHistory.length - 1 ? 'border-b border-t-stroke-sub' : ''}`}>
                          <td className="px-1.5 sm:px-2.5 py-2 sm:py-2.5 w-[clamp(100px,24%,260px)] max-w-0">
                            <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                              <Link
                                href={getTokenHref(order.symbol)}
                                className="group/link flex min-w-0 flex-1 max-w-full items-center gap-1 sm:gap-2 hover:opacity-90 transition-opacity"
                                title={`Open ${order.symbol} market`}
                              >
                                <img
                                  src={(marketSymbolMap.get(order.symbol)?.icon as string) || FALLBACK_TOKEN_ICON}
                                  alt={`${order.symbol} logo`}
                                  className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 rounded-full border border-t-stroke-hover object-cover"
                                />
                                <div className="min-w-0">
                                  <span className="block truncate text-[10px] sm:text-[11px] font-medium text-t-fg">
                                    {truncateMarketName(marketSymbolMap.get(order.symbol)?.name || order.symbol)}
                                  </span>
                                  <span className="hidden md:block truncate text-[10px] text-t-fg-label">
                                    {marketSymbolMap.get(order.symbol)?.identifier || order.symbol}
                                  </span>
                                </div>
                              </Link>

                              {order.txHash && (
                                <a
                                  href={`https://hyperevmscan.io/tx/${encodeURIComponent(order.txHash)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hidden sm:inline-flex shrink-0 items-center justify-center rounded border border-t-stroke-hover bg-t-elevated px-1 py-0.5 text-[#6B7280] hover:text-t-fg hover:border-[#4B5563] transition-colors"
                                  title="View transaction on HyperEVMScan"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <svg
                                    aria-hidden="true"
                                    viewBox="0 0 24 24"
                                    className="h-3 w-3"
                                    fill="none"
                                  >
                                    <path
                                      d="M14 3h7v7m0-7L10 14"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M10 7H7a4 4 0 0 0-4 4v6a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4v-3"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="px-1.5 sm:px-2.5 py-2 sm:py-2.5">
                            <span className={`text-[10px] sm:text-[11px] font-medium ${order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{order.side}</span>
                          </td>
                          <td className="hidden md:table-cell px-2.5 py-2.5">
                            <span className="text-[11px] text-t-fg">{order.type}</span>
                          </td>
                          <td className="px-1.5 sm:px-2.5 py-2 sm:py-2.5 text-right">
                            <span className="text-[10px] sm:text-[11px] text-t-fg font-mono">${formatPrice(order.price)}</span>
                          </td>
                          <td className="hidden sm:table-cell px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-t-fg font-mono">{formatAmount(order.size, 4)}</span>
                          </td>
                          <td className="hidden sm:table-cell px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-t-fg font-mono">
                              ${formatPrice(order.price * order.size)}
                            </span>
                          </td>
                          <td className="px-1.5 sm:px-2.5 py-2 sm:py-2.5 text-right">
                            <span className="text-[10px] sm:text-[11px] text-t-fg-label whitespace-nowrap">{formatDate(order.timestamp)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
    );
  };

  return (
    <div className={`group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 flex flex-col ${className}`}>
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
        /* Subtle highlight animation for newly arrived orders */
        @keyframes orderNewArrival {
          0% {
            background-color: rgba(59, 130, 246, 0.15);
          }
          100% {
            background-color: transparent;
          }
        }
        .order-row-new-arrival {
          animation: orderNewArrival 600ms ease-out forwards;
        }
      `}</style>

      <OrderFillLoadingModal
        isOpen={orderFillModal.isOpen}
        progress={orderFillModal.progress}
        status={orderFillModal.status}
        allowClose={orderFillModal.allowClose}
        onClose={() => setOrderFillModal((cur) => ({ ...cur, isOpen: false, kind: null, headlineText: undefined, detailText: undefined, showProgressLabel: undefined }))}
        headlineText={orderFillModal.headlineText ?? (orderFillModal.kind === 'cancel' ? 'Cancelling order,' : 'Processing,')}
        detailText={orderFillModal.detailText}
        showProgressLabel={orderFillModal.showProgressLabel}
      />
      
      <div className="flex items-center justify-between border-b border-t-stroke px-1.5 sm:px-2.5 py-1.5 sm:py-2.5 flex-shrink-0">
        <div className="flex items-center w-full sm:w-auto gap-0 sm:gap-1.5 overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === 'orders') {
                  logGoddMat(26, 'Orders tab clicked', { activeTab: tab.id });
                }
              }}
              className={`flex-1 sm:flex-none px-1.5 sm:px-2.5 py-1 sm:py-1.5 text-[10px] sm:text-[11px] font-medium rounded transition-all duration-200 flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'text-t-fg bg-t-inset border border-t-stroke-hover'
                  : 'text-t-fg hover:text-t-fg hover:bg-t-card-hover border border-transparent hover:border-t-stroke'
              }`}
            >
              <span className="sm:hidden">{tab.shortLabel}</span>
              <span className="hidden sm:inline">{tab.label}</span>
              <div className="text-[9px] sm:text-[10px] text-t-fg-label bg-t-skeleton px-1 sm:px-1.5 py-0.5 rounded">
                {tab.count}
              </div>
            </button>
          ))}
        </div>
        
        <div className="hidden sm:flex items-center gap-2">
          {isLoading ? (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[10px] text-t-fg-label">Loading...</span>
            </>
          ) : (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-[10px] text-t-fg-label">Live</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto scrollbar-hide">
        {!walletAddress ? (
          <ActivityEmptyState message={`Connect wallet to view ${activeTab}`} />
                ) : (
          <div className="min-w-full h-full">
            {activeTab === 'positions' && renderPositionsTable()}
            {activeTab === 'orders' && renderOpenOrdersTable()}
            {activeTab === 'trades' && renderTradesTable()}
            {activeTab === 'history' && renderOrderHistoryTable()}
          </div>
        )}
      </div>

      {showCloseModal && portalMounted && (() => {
        const currentPosition = positions.find(p => p.id === closePositionId) ?? null;
        const closeSizeValue = parseFloat(closeSize) || 0;
        const exitPrice = resolveExitPrice(currentPosition);
        const payoutData = calculateExpectedPayout(currentPosition, closeSizeValue, exitPrice);
        const marketIcon = marketSymbolMap.get(closeSymbol)?.icon || FALLBACK_TOKEN_ICON;

        return createPortal(
          <div 
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
            onClick={() => {
              setShowCloseModal(false);
              setCloseSize('');
              setRawCloseSize('');
              setCloseError(null);
              setCloseExitPrice(null);
            }}
          >
            <div 
              className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
              onClick={() => {
                setShowCloseModal(false);
                setCloseSize('');
                setRawCloseSize('');
                setCloseError(null);
                setCloseExitPrice(null);
              }}
            />
            <div 
              className="relative z-10 w-full bg-t-card rounded-md border border-t-stroke transition-all duration-200"
              style={{ maxWidth: '600px', padding: '24px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)', margin: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header row */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <MarketIconBadge 
                    iconUrl={marketIcon} 
                    alt={`${closeSymbol} icon`} 
                    sizePx={32} 
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-t-fg text-sm font-medium tracking-tight">Close Position</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-t-inset border border-t-stroke text-t-fg-sub">{closeSymbol}</span>
                      {currentPosition && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          currentPosition.side === 'LONG' 
                            ? 'bg-green-400/10 text-green-400' 
                            : 'bg-red-400/10 text-red-400'
                        }`}>
                          {currentPosition.side}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-t-fg-muted">
                      {currentPosition?.side === 'LONG' 
                        ? 'Sell at best bid price' 
                        : 'Buy to cover at best ask price'
                      }
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowCloseModal(false);
                    setCloseSize('');
                    setRawCloseSize('');
                    setCloseError(null);
                    setCloseExitPrice(null);
                  }}
                  className="p-1.5 rounded-full hover:bg-t-card-hover text-t-fg-muted hover:text-t-fg-sub transition-all duration-200"
                  aria-label="Close"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {/* Position details row */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                    <span className="text-[10px] text-t-fg-muted">Entry Price</span>
                  </div>
                  <div className="text-[13px] font-mono text-t-fg">${formatPrice4(currentPosition?.entryPrice ?? 0)}</div>
                </div>
                <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${exitPrice > 0 ? 'bg-green-400' : 'bg-t-dot'}`} />
                    <span className="text-[10px] text-t-fg-muted">
                      {currentPosition?.side === 'LONG' ? 'Best Bid' : 'Best Ask'}
                    </span>
                  </div>
                  <div className={`text-[13px] font-mono ${exitPrice > 0 ? 'text-t-fg' : 'text-t-fg-muted'}`}>
                    {exitPrice > 0 ? `$${formatPrice4(exitPrice)}` : 'Loading...'}
                  </div>
                </div>
                <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                    <span className="text-[10px] text-t-fg-muted">Position Size</span>
                  </div>
                  <div className="text-[13px] font-mono text-t-fg">{formatSize(maxSize)}</div>
                </div>
              </div>

              {/* Close size input */}
              <div className="mb-4">
                <div className="relative">
                  <input
                    type="number"
                    value={closeSize}
                    onChange={(e) => {
                      setCloseSize(e.target.value);
                      setCloseError(null);
                    }}
                    className={`w-full bg-t-inset hover:bg-t-card-hover border rounded-md transition-all duration-200 focus:outline-none text-t-fg text-sm font-mono pl-3 pr-16 py-2.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                      closeError
                        ? 'border-red-500/50 focus:border-red-400'
                        : 'border-t-stroke hover:border-t-stroke-hover focus:border-t-stroke-hover'
                    }`}
                    placeholder="Enter close size..."
                    min="0"
                    max={maxSize}
                    step="0.0001"
                  />
                  <button
                    onClick={() => {
                      setCloseSize(toDecimalString(maxSize));
                      setCloseError(null);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-2 py-1 rounded bg-t-card border border-t-stroke text-t-fg-sub hover:text-t-fg hover:border-t-stroke-hover transition-all duration-200"
                  >
                    MAX
                  </button>
                </div>
                {closeError && (
                  <div className="mt-2 bg-t-card border border-t-stroke rounded-md p-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                      <span className="text-[11px] font-medium text-red-400">{closeError}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Realized P&L result */}
              {exitPrice > 0 && closeSizeValue > 0 && (
                <div className={`rounded-md border p-3 mb-4 ${
                  payoutData.pnl >= 0 
                    ? 'border-green-400/20 bg-green-400/5' 
                    : 'border-red-400/20 bg-red-400/5'
                }`}>
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${payoutData.pnl >= 0 ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span className="text-[11px] font-medium text-t-fg-sub">You will receive</span>
                    </div>
                    <span className="text-sm font-mono font-semibold text-t-fg">
                      ${formatPnlAmount(payoutData.payout)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${payoutData.pnl >= 0 ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span className="text-[11px] font-medium text-t-fg-sub">Realized P&L</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-mono font-semibold ${
                        payoutData.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {payoutData.pnl >= 0 ? '+' : '-'}${formatPnlAmount(Math.abs(payoutData.pnl))}
                      </span>
                      <div className={`text-[10px] px-1.5 py-0.5 rounded ${
                        payoutData.pnl >= 0 
                          ? 'bg-green-400/10 text-green-400' 
                          : 'bg-red-400/10 text-red-400'
                      }`}>
                        {payoutData.pnl >= 0 ? '+' : '-'}{formatPnlPercent(Math.abs(payoutData.pnlPercent))}%
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowCloseModal(false);
                    setCloseSize('');
                    setRawCloseSize('');
                    setCloseError(null);
                    setCloseExitPrice(null);
                  }}
                  className="px-4 py-2 rounded-md text-[11px] font-medium border border-t-stroke text-t-fg-sub hover:border-t-stroke-hover hover:bg-t-card-hover hover:text-t-fg transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCloseSubmit}
                  disabled={!closeSize || parseFloat(closeSize) <= 0 || parseFloat(closeSize) > maxSize}
                  className={`px-4 py-2 rounded-md text-[11px] font-medium border transition-all duration-200 flex items-center gap-2 ${
                    !closeSize || parseFloat(closeSize) <= 0 || parseFloat(closeSize) > maxSize
                      ? 'border-t-stroke text-t-fg-muted cursor-not-allowed'
                      : 'border-red-500/20 text-red-400 hover:border-red-500/30 hover:bg-red-500/5'
                  }`}
                >
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                  Confirm Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {showModifyModal && modifyOrder && portalMounted && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
          onClick={() => {
            if (!isModifying) {
              setShowModifyModal(false);
              setModifyOrder(null);
              setModifyPrice('');
              setModifySize('');
              setModifyError(null);
            }
          }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
          <div
            className="relative z-10 w-full bg-t-card rounded-md border border-t-stroke transition-all duration-200"
            style={{ maxWidth: '520px', padding: '24px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)', margin: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <MarketIconBadge
                  iconUrl={(marketSymbolMap.get(modifyOrder.symbol)?.icon as string) || FALLBACK_TOKEN_ICON}
                  alt={`${modifyOrder.symbol} icon`}
                  sizePx={32}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-t-fg text-sm font-medium tracking-tight">Modify Order</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-t-inset border border-t-stroke text-t-fg-sub">{modifyOrder.symbol}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      modifyOrder.side === 'BUY'
                        ? 'bg-green-400/10 text-green-400'
                        : 'bg-red-400/10 text-red-400'
                    }`}>
                      {modifyOrder.side}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-t-fg-muted">
                    Cancel existing order and place a new one with updated values
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!isModifying) {
                    setShowModifyModal(false);
                    setModifyOrder(null);
                    setModifyPrice('');
                    setModifySize('');
                    setModifyError(null);
                  }
                }}
                className="p-1.5 rounded-full hover:bg-t-card-hover text-t-fg-muted hover:text-t-fg-sub transition-all duration-200"
                aria-label="Close"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            {/* Current order details */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-t-card rounded-md border border-t-stroke p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                  <span className="text-[10px] text-t-fg-muted">Current Price</span>
                </div>
                <div className="text-[13px] font-mono text-t-fg">${formatPrice4(modifyOrder.price)}</div>
              </div>
              <div className="bg-t-card rounded-md border border-t-stroke p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                  <span className="text-[10px] text-t-fg-muted">Current Size</span>
                </div>
                <div className="text-[13px] font-mono text-t-fg">{formatAmount(modifyOrder.size, 4)}</div>
              </div>
              <div className="bg-t-card rounded-md border border-t-stroke p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                  <span className="text-[10px] text-t-fg-muted">Order Value</span>
                </div>
                <div className="text-[13px] font-mono text-t-fg">${formatPrice(modifyOrder.price * modifyOrder.size)}</div>
              </div>
            </div>

            {/* New price input */}
            <div className="mb-3">
              <label className="block text-[10px] text-t-fg-muted mb-1.5">New Price (USD)</label>
              <div className="relative">
                <input
                  type="number"
                  value={modifyPrice}
                  onChange={(e) => { setModifyPrice(e.target.value); setModifyError(null); }}
                  disabled={isModifying}
                  className="w-full bg-t-inset hover:bg-t-card-hover border border-t-stroke hover:border-t-stroke-hover focus:border-t-stroke-hover rounded-md transition-all duration-200 focus:outline-none text-t-fg text-sm font-mono pl-3 pr-16 py-2.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
                  placeholder="Enter new price..."
                  min="0"
                  step="0.01"
                />
                <button
                  onClick={() => { setModifyPrice(String(modifyOrder.price)); setModifyError(null); }}
                  disabled={isModifying}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-2 py-1 rounded bg-t-card border border-t-stroke text-t-fg-sub hover:text-t-fg hover:border-t-stroke-hover transition-all duration-200 disabled:opacity-50"
                >
                  RESET
                </button>
              </div>
            </div>

            {/* New size input */}
            <div className="mb-4">
              <label className="block text-[10px] text-t-fg-muted mb-1.5">New Size</label>
              <div className="relative">
                <input
                  type="number"
                  value={modifySize}
                  onChange={(e) => { setModifySize(e.target.value); setModifyError(null); }}
                  disabled={isModifying}
                  className="w-full bg-t-inset hover:bg-t-card-hover border border-t-stroke hover:border-t-stroke-hover focus:border-t-stroke-hover rounded-md transition-all duration-200 focus:outline-none text-t-fg text-sm font-mono pl-3 pr-16 py-2.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
                  placeholder="Enter new size..."
                  min="0"
                  step="0.0001"
                />
                <button
                  onClick={() => { setModifySize(String(modifyOrder.size)); setModifyError(null); }}
                  disabled={isModifying}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-2 py-1 rounded bg-t-card border border-t-stroke text-t-fg-sub hover:text-t-fg hover:border-t-stroke-hover transition-all duration-200 disabled:opacity-50"
                >
                  RESET
                </button>
              </div>
            </div>

            {/* Change preview */}
            {(() => {
              const newP = parseFloat(modifyPrice) || 0;
              const newS = parseFloat(modifySize) || 0;
              const newValue = newP * newS;
              const oldValue = modifyOrder.price * modifyOrder.size;
              const priceDelta = newP - modifyOrder.price;
              const sizeDelta = newS - modifyOrder.size;
              const hasChanges = Math.abs(priceDelta) > 0.001 || Math.abs(sizeDelta) > 0.00001;

              if (!hasChanges || newP <= 0 || newS <= 0) return null;

              return (
                <div className="rounded-md border border-blue-400/20 bg-blue-400/5 p-3 mb-4">
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                    <span className="text-[11px] font-medium text-t-fg-sub">Change Preview</span>
                  </div>
                  <div className="space-y-1.5">
                    {Math.abs(priceDelta) > 0.001 && (
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-t-fg-muted">Price</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono text-t-fg-sub">${formatPrice4(modifyOrder.price)}</span>
                          <span className="text-[10px] text-t-fg-muted">→</span>
                          <span className="text-[11px] font-mono text-t-fg">${formatPrice4(newP)}</span>
                          <span className={`text-[10px] font-mono ${priceDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            ({priceDelta >= 0 ? '+' : ''}{formatPrice4(priceDelta)})
                          </span>
                        </div>
                      </div>
                    )}
                    {Math.abs(sizeDelta) > 0.00001 && (
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-t-fg-muted">Size</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono text-t-fg-sub">{formatAmount(modifyOrder.size, 4)}</span>
                          <span className="text-[10px] text-t-fg-muted">→</span>
                          <span className="text-[11px] font-mono text-t-fg">{formatAmount(newS, 4)}</span>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1 border-t border-blue-400/10">
                      <span className="text-[10px] text-t-fg-muted">Order Value</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono text-t-fg-sub">${formatPrice(oldValue)}</span>
                        <span className="text-[10px] text-t-fg-muted">→</span>
                        <span className="text-[11px] font-mono font-medium text-t-fg">${formatPrice(newValue)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Error display */}
            {modifyError && (
              <div className="mb-4 bg-t-card border border-t-stroke rounded-md p-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                  <span className="text-[11px] font-medium text-red-400">{modifyError}</span>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  if (!isModifying) {
                    setShowModifyModal(false);
                    setModifyOrder(null);
                    setModifyPrice('');
                    setModifySize('');
                    setModifyError(null);
                  }
                }}
                disabled={isModifying}
                className="px-4 py-2 rounded-md text-[11px] font-medium border border-t-stroke text-t-fg-sub hover:border-t-stroke-hover hover:bg-t-card-hover hover:text-t-fg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleModifySubmit}
                disabled={isModifying || !modifyPrice || parseFloat(modifyPrice) <= 0 || !modifySize || parseFloat(modifySize) <= 0}
                className={`px-4 py-2 rounded-md text-[11px] font-medium border transition-all duration-200 flex items-center gap-2 ${
                  isModifying || !modifyPrice || parseFloat(modifyPrice) <= 0 || !modifySize || parseFloat(modifySize) <= 0
                    ? 'border-t-stroke text-t-fg-muted cursor-not-allowed'
                    : 'border-blue-500/20 text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/5'
                }`}
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                {isModifying ? 'Modifying...' : 'Confirm Modify'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showTopUpModal && portalMounted && (() => {
        const topUpIcon = marketSymbolMap.get(topUpSymbol)?.icon || FALLBACK_TOKEN_ICON;
        const newMargin = currentMargin + (parseFloat(topUpAmount) || 0);
        const topUpValue = parseFloat(topUpAmount) || 0;

        return createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
            onClick={() => {
              if (!isToppingUp) {
                setShowTopUpModal(false);
                setTopUpAmount('');
                setTopUpError(null);
              }
            }}
          >
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
              onClick={() => {
                if (!isToppingUp) {
                  setShowTopUpModal(false);
                  setTopUpAmount('');
                  setTopUpError(null);
                }
              }}
            />
            <div
              className="relative z-10 w-full bg-t-card rounded-md border border-t-stroke transition-all duration-200"
              style={{ maxWidth: '600px', padding: '24px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)', margin: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header row */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <MarketIconBadge
                    iconUrl={topUpIcon as string}
                    alt={`${topUpSymbol} icon`}
                    sizePx={32}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-t-fg text-sm font-medium tracking-tight">Top Up Position</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-t-inset border border-t-stroke text-t-fg-sub">{topUpSymbol}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        topUpSide === 'LONG'
                          ? 'bg-green-400/10 text-green-400'
                          : 'bg-red-400/10 text-red-400'
                      }`}>
                        {topUpSide}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-t-fg-muted">
                      Add margin to reduce liquidation risk
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!isToppingUp) {
                      setShowTopUpModal(false);
                      setTopUpAmount('');
                      setTopUpError(null);
                    }
                  }}
                  className="p-1.5 rounded-full hover:bg-t-card-hover text-t-fg-muted hover:text-t-fg-sub transition-all duration-200"
                  aria-label="Close"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {/* Position details row */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                    <span className="text-[10px] text-t-fg-muted">Entry Price</span>
                  </div>
                  <div className="text-[13px] font-mono text-t-fg">${formatPrice4(topUpEntryPrice)}</div>
                </div>
                <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                    <span className="text-[10px] text-t-fg-muted">Leverage</span>
                  </div>
                  <div className="text-[13px] font-mono text-t-fg">{topUpLeverage.toFixed(1)}x</div>
                </div>
                <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${topUpLiqPrice > 0 ? 'bg-yellow-400' : 'bg-t-dot'}`} />
                    <span className="text-[10px] text-t-fg-muted">Liq. Price</span>
                  </div>
                  <div className="text-[13px] font-mono text-t-fg">${formatPrice4(topUpLiqPrice)}</div>
                </div>
              </div>

              {/* Top-up amount input */}
              <div className="mb-4">
                <div className="relative">
                  <input
                    type="number"
                    value={topUpAmount}
                    onChange={(e) => {
                      setTopUpAmount(e.target.value);
                      setTopUpError(null);
                    }}
                    className={`w-full bg-t-inset hover:bg-t-card-hover border rounded-md transition-all duration-200 focus:outline-none text-t-fg text-sm font-mono pl-3 pr-20 py-2.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                      topUpError
                        ? 'border-red-500/50 focus:border-red-400'
                        : 'border-t-stroke hover:border-t-stroke-hover focus:border-t-stroke-hover'
                    }`}
                    placeholder="Enter additional margin (USDC)..."
                    min="0"
                    step="0.01"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
                    <span className="text-[10px] text-t-fg-muted font-mono mr-1">USDC</span>
                  </div>
                </div>
                {topUpError && (
                  <div className="mt-2 bg-t-card border border-t-stroke rounded-md p-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                      <span className="text-[11px] font-medium text-red-400">{topUpError}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Margin summary */}
              {topUpValue > 0 && (
                <div className="rounded-md border border-green-400/20 bg-green-400/5 p-3 mb-4">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                      <span className="text-[11px] font-medium text-t-fg-sub">Current Margin</span>
                    </div>
                    <span className="text-sm font-mono text-t-fg">
                      ${currentMargin.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                      <span className="text-[11px] font-medium text-t-fg-sub">Adding</span>
                    </div>
                    <span className="text-sm font-mono font-semibold text-green-400">
                      +${topUpValue.toFixed(2)}
                    </span>
                  </div>
                  <div className="border-t border-t-stroke pt-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                        <span className="text-[11px] font-medium text-t-fg-sub">New Margin</span>
                      </div>
                      <span className="text-sm font-mono font-semibold text-t-fg">
                        ${newMargin.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowTopUpModal(false);
                    setTopUpAmount('');
                    setTopUpError(null);
                  }}
                  disabled={isToppingUp}
                  className="px-4 py-2 rounded-md text-[11px] font-medium border border-t-stroke text-t-fg-sub hover:border-t-stroke-hover hover:bg-t-card-hover hover:text-t-fg transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTopUpSubmit}
                  disabled={!topUpAmount || parseFloat(topUpAmount) <= 0 || isToppingUp}
                  className={`px-4 py-2 rounded-md text-[11px] font-medium border transition-all duration-200 flex items-center gap-2 ${
                    !topUpAmount || parseFloat(topUpAmount) <= 0 || isToppingUp
                      ? 'border-t-stroke text-t-fg-muted cursor-not-allowed'
                      : 'border-green-500/20 text-green-400 hover:border-green-500/30 hover:bg-green-500/5'
                  }`}
                >
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                  {isToppingUp ? 'Submitting...' : 'Confirm Top-Up'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
  );
}