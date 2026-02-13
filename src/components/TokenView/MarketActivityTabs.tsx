'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ethers } from 'ethers';
import { useWallet } from '@/hooks/useWallet';
import { useMarketData } from '@/contexts/MarketDataContext';
import { initializeContracts } from '@/lib/contracts';
import { ensureHyperliquidWallet } from '@/lib/network';
import { ErrorModal } from '@/components/StatusModals';
import { useMarkets } from '@/hooks/useMarkets';
import { cancelOrderForMarket } from '@/hooks/useOrderBook';
import { usePositions as usePositionsHook } from '@/hooks/usePositions';
import type { Address } from 'viem';
import { signAndSubmitGasless, submitSessionTrade, isSessionErrorMessage } from '@/lib/gasless';
import { CHAIN_CONFIG, CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import { gaslessTopUpPosition } from '@/lib/gaslessTopup';
import { parseUnits } from 'viem';
import { useSession } from '@/contexts/SessionContext';
import { normalizeBytes32Hex } from '@/lib/hex';
import { useWalkthrough } from '@/contexts/WalkthroughContext';
import { useOnchainOrders } from '@/contexts/OnchainOrdersContextV2';
import { OrderFillLoadingModal, type OrderFillStatus } from '@/components/TokenView/OrderFillLoadingModal';

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
}

type TabType = 'positions' | 'orders' | 'trades' | 'history';

interface MarketActivityTabsProps {
  symbol: string;
  className?: string;
}

export default function MarketActivityTabs({ symbol, className = '' }: MarketActivityTabsProps) {
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
  // Order cancel modal (subtle "cup fill" loader)
  const [orderFillModal, setOrderFillModal] = useState<{
    isOpen: boolean;
    progress: number; // 0..1
    status: OrderFillStatus;
    allowClose: boolean;
    startedAt: number;
    kind: 'cancel' | null;
  }>({
    isOpen: false,
    progress: 0,
    status: 'submitting',
    allowClose: false,
    startedAt: 0,
    kind: null,
  });

  const startCancelModal = useCallback(() => {
    setOrderFillModal({
      isOpen: true,
      progress: 0.06,
      status: 'submitting',
      allowClose: false,
      startedAt: Date.now(),
      kind: 'cancel',
    });
  }, []);

  const markCancelModalError = useCallback(() => {
    setOrderFillModal((cur) => ({
      ...cur,
      isOpen: true,
      status: 'error',
      progress: 1,
      allowClose: true,
    }));
  }, []);

  const finishCancelModal = useCallback(() => {
    setOrderFillModal((cur) => ({
      ...cur,
      status: 'filled',
      progress: 1,
      allowClose: false,
    }));
    window.setTimeout(() => {
      setOrderFillModal((cur) => ({ ...cur, isOpen: false, kind: null }));
    }, 750);
  }, []);

  // Smooth progress while submitting/filling (purely visual)
  useEffect(() => {
    if (!orderFillModal.isOpen) return;
    if (orderFillModal.status === 'filled' || orderFillModal.status === 'error') return;

    const id = window.setInterval(() => {
      setOrderFillModal((cur) => {
        if (!cur.isOpen) return cur;
        if (cur.status === 'filled' || cur.status === 'error') return cur;
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
    if (orderFillModal.status === 'filled' || orderFillModal.status === 'error') return;
    const startedAt = orderFillModal.startedAt;
    const id = window.setInterval(() => {
      setOrderFillModal((cur) => {
        if (!cur.isOpen || cur.kind !== 'cancel') return cur;
        if (cur.status === 'filled' || cur.status === 'error') return cur;
        if (Date.now() - startedAt > 18_000) {
          return { ...cur, allowClose: true };
        }
        return cur;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [orderFillModal.isOpen, orderFillModal.kind, orderFillModal.startedAt, orderFillModal.status]);
  const [optimisticallyRemovedOrderIds, setOptimisticallyRemovedOrderIds] = useState<Set<string>>(new Set());
  /** Keys of orders currently playing slide-out animation (still visible until animation ends) */
  const [animatingOutOrderKeys, setAnimatingOutOrderKeys] = useState<Set<string>>(new Set());
  // Global on-chain orders from OnchainOrdersContextV2
  const {
    orders: globalOnchainOrders,
    isLoading: isLoadingSitewideOrders,
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
  const { markets } = useMarkets({ limit: 500, autoRefresh: false });
  const { positions: allPositions, isLoading: positionsIsLoading } = usePositionsHook(undefined, {
    enabled: !!walletAddress,
    pollIntervalMs: 0, // disable polling; fetch on demand / events
  });
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
  const {
    sessionId: globalSessionId,
    sessionActive: globalSessionActive,
    clear: clearSession,
  } = useSession();

  const getTokenHref = useCallback((sym?: string | null) => {
    const s = String(sym || '').trim();
    if (!s) return '/';
    return `/token/${encodeURIComponent(s)}`;
  }, []);
  
  // Optimistic overlay for positions on trade events (prevents "revert" when vault reads lag a block).
  // We keep small deltas for a short TTL and render basePositions + deltas.
  const posOverlayRef = useRef<
    Map<string, { delta: number; baseSigned: number; appliedAt: number; expiresAt: number }>
  >(new Map());
  const appliedTraceRef = useRef<Map<string, number>>(new Map());
  const [posOverlayTick, setPosOverlayTick] = useState(0); // re-render trigger
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
          if (!o || !Number.isFinite(o.delta) || o.delta === 0 || o.expiresAt <= now) {
            overlay.delete(sym);
            changed = true;
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
      if (!Number.isFinite(o.delta) || o.delta === 0 || o.expiresAt <= now) {
        overlay.delete(sym);
        changed = true;
        continue;
      }

      const baseNow = signedBySym.get(sym) ?? 0;
      const baseSigned = Number.isFinite(o.baseSigned) ? o.baseSigned : 0;
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
      const ttlMs = 8_000;

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
        shouldRefreshSessionOrders = true;
      }

      // Treat as an order placement only when we have enough fields to render a real row.
      // IMPORTANT: don't treat empty eventType as "placed" (it can be a partial/unknown payload) or we may add 0/0/0 rows.
      if (!shouldRefreshSessionOrders && isPlacementEvent) {
        // Some producers (notably gasless UI) emit `orderId: "tx:<hash>"` as a placeholder.
        // That is NOT cancelable (can't be parsed as bigint) and will show as a duplicate once the real numeric id arrives.
        // We still want to re-hydrate session orders (handled above), but we must NOT add an optimistic Open Orders row.
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
  }, [walletAddress, activeTab, metricId, fetchOrderHistory]);

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
      const ttlMs = 8_000; // keep overlay long enough for vault to catch up
      const existing = posOverlayRef.current.get(sym);
      const nextDelta = (existing?.delta || 0) + signedDelta;
      const baseSigned = existing?.baseSigned ?? getBaseSignedSize(sym);
      posOverlayRef.current.set(sym, { delta: nextDelta, baseSigned, appliedAt: now, expiresAt: now + ttlMs });
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

  // Success modal intentionally disabled in this component (use `OrderFillLoadingModal` UX instead)
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });

  // Helper functions for showing messages
  // `showSuccess` intentionally no-ops (SuccessModal disabled)
  const showSuccess = (_message: string, _title: string = 'Success') => {};
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
        let signer: ethers.Signer | undefined;
        if (typeof window !== 'undefined' && (window as any).ethereum) {
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
            amountWei: amountWei as unknown as bigint,
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
    return Array.from(dedup.values())
      .filter((o) => {
        const removalKey = getOrderCompositeKey(o.symbol, o.id);
        return o.status !== 'CANCELLED' && o.status !== 'FILLED' && !optimisticallyRemovedOrderIds.has(removalKey);
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
  }, [sitewideActiveOrders, optimisticallyRemovedOrderIds]);
  const openOrdersIsLoading = Boolean(isLoadingSitewideOrders && activeTab === 'orders');

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
  useEffect(() => {
    const overlay = openOrdersOverlayRef.current;
    if (!overlay) return;
    if (overlay.added.size === 0 && overlay.removed.size === 0) return;

    const base = Array.isArray(openOrders) ? openOrders : [];
    const baseKeys = new Set<string>();
    for (const o of base) {
      baseKeys.add(getOrderCompositeKey(o.symbol, o.id));
    }

    let changed = false;
    // If an optimistic "added" order is now in base, drop it early.
    for (const [k] of overlay.added.entries()) {
      if (baseKeys.has(k)) {
        overlay.added.delete(k);
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

  // Format P&L percent with grouping for large values (e.g. 7,002,137.00%)
  const formatPnlPercent = (value: number) =>
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);

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

  const renderPositionsTable = () => {
    if (displayedPositions.length === 0) {
  return (
                  <div className="flex items-center justify-center p-8" data-walkthrough="token-activity-empty-positions">
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
                  <table className="w-full table-fixed">
                    <thead>
                      <tr className="border-b border-[#222222]">
                        <th className="w-1/3 text-left px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Symbol</th>
                        <th className="text-left px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Side</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Size</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Mark</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Value</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">PnL</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Liq Price</th>
                        <th className="text-right px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedPositions.map((position, index) => {
                        // When positions hydrate before markets metadata resolves, the symbol can briefly be "UNKNOWN".
                        // Instead of flashing UNKNOWN, render a subtle skeleton loader (matching the token header mark-price loader style).
                        const showSkeleton =
                          String(position.symbol || '').toUpperCase() === 'UNKNOWN' &&
                          (positionsIsLoading || (markets || []).length === 0);

                        const rowClass = `mat-slide-rtl group/row transition-colors duration-200 ${
                          position.isUnderLiquidation
                            ? 'bg-yellow-400/5 hover:bg-yellow-400/10 border-yellow-400/20'
                            : 'hover:bg-[#1A1A1A]'
                        } ${index !== displayedPositions.length - 1 ? 'border-b border-[#1A1A1A]' : ''}`;

                        if (showSkeleton) {
                          return (
                            <tr
                              key={`${position.id}-${index}`}
                              className={rowClass}
                              style={{ animationDelay: `${index * 50}ms` }}
                            >
                              <td className="pl-2 pr-1 py-1.5 w-1/3 max-w-0">
                                <div className="flex items-center gap-1 min-w-0">
                                  <span className="w-4 h-4 shrink-0 rounded-full border border-[#333333] bg-[#1A1A1A] animate-pulse" />
                                  <div className="min-w-0 flex-1">
                                    <span className="block w-[120px] h-[12px] bg-[#1A1A1A] rounded animate-pulse" />
                                    <span className="block mt-1 w-[84px] h-[10px] bg-[#141414] rounded animate-pulse" />
                                  </div>
                                </div>
                              </td>
                              <td className="pl-1 pr-2 py-1.5">
                                <span className="inline-block w-[44px] h-[12px] bg-[#1A1A1A] rounded animate-pulse" />
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <span className="inline-block w-[64px] h-[12px] bg-[#1A1A1A] rounded animate-pulse" />
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <span className="inline-block w-[72px] h-[12px] bg-[#1A1A1A] rounded animate-pulse" />
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <span className="inline-block w-[78px] h-[12px] bg-[#1A1A1A] rounded animate-pulse" />
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <span className="inline-block w-[72px] h-[12px] bg-[#1A1A1A] rounded animate-pulse" />
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <span className="inline-block w-[78px] h-[12px] bg-[#1A1A1A] rounded animate-pulse" />
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <span className="inline-block w-[52px] h-[12px] bg-[#1A1A1A] rounded animate-pulse" />
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <React.Fragment key={`${position.id}-${index}`}>
                            <tr className={rowClass} style={{ animationDelay: `${index * 50}ms` }}>
                              <td className="pl-2 pr-1 py-1.5 w-1/3 max-w-0">
                                <div className="flex items-center gap-1 min-w-0">
                                  <Link
                                    href={getTokenHref(position.symbol)}
                                    className="group/link flex min-w-0 max-w-full items-center gap-1 hover:opacity-90 transition-opacity"
                                    title={`Open ${position.symbol} market`}
                                  >
                                    <img
                                      src={(marketSymbolMap.get(position.symbol)?.icon as string) || FALLBACK_TOKEN_ICON}
                                      alt={`${position.symbol} logo`}
                                      className="w-4 h-4 shrink-0 rounded-full border border-[#333333] object-cover"
                                    />
                                    <div className="min-w-0 flex-1">
                                      <span className="block truncate text-[11px] font-medium text-white">
                                        {truncateMarketName(marketSymbolMap.get(position.symbol)?.name || position.symbol)}
                                      </span>
                                      <span className="block truncate text-[10px] text-[#9CA3AF]">
                                        {marketSymbolMap.get(position.symbol)?.identifier || position.symbol}
                                      </span>
                                    </div>
                                    {position.isUnderLiquidation && (
                                      <div className="shrink-0 px-1 py-0.5 bg-yellow-400/10 rounded">
                                        <span className="text-[8px] font-medium text-yellow-400">LIQUIDATING</span>
                                      </div>
                                    )}
                                  </Link>
                                </div>
                              </td>
                              <td className="pl-1 pr-2 py-1.5">
                                <span
                                  className={`text-[11px] font-medium ${
                                    position.side === 'LONG' ? 'text-green-400' : 'text-red-400'
                                  }`}
                                >
                                  {position.side}
                                </span>
                              </td>
                          <td className="px-2 py-1.5 text-right">
                            <span className="text-[11px] text-white font-mono">{formatSize(position.size)}</span>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <span className="text-[11px] text-white font-mono">${formatPrice(position.markPrice)}</span>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <span className="text-[11px] text-white font-mono">
                              $
                              {formatPrice(
                                position.size *
                                  (Number.isFinite(position.markPrice) && position.markPrice > 0
                                    ? position.markPrice
                                    : Number.isFinite(position.entryPrice) && position.entryPrice > 0
                                      ? position.entryPrice
                                      : 0)
                              )}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <div className="flex justify-end">
                              <span className="relative inline-block pr-4">
                                <span
                                  className={`text-[11px] font-medium font-mono ${
                                    position.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                                  }`}
                                >
                                  {position.pnl >= 0 ? '+' : ''}
                                  {formatPnlAmount(position.pnl)}
                                </span>
                                <span
                                  className={`absolute -top-2 -right-0 text-[9px] font-mono ${
                                    position.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                                  }`}
                                >
                                  {position.pnlPercent >= 0 ? '+' : ''}
                                  {formatPnlPercent(position.pnlPercent)}%
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
                    data-walkthrough="token-activity-manage"
                    className={`${forcePositionManageVisible ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'} transition-opacity duration-200 px-1.5 py-0.5 text-[9px] text-[#E5E7EB] hover:text-white hover:bg-[#2A2A2A] rounded`}
                  >
                    {expandedPositionId === position.id ? 'Hide' : 'Manage'}
                            </button>
                          </td>
                        </tr>
              {expandedPositionId === position.id && (
                <tr className="bg-[#1A1A1A]">
                  <td colSpan={8} className="px-0">
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
                              data-walkthrough="token-activity-close-position"
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
                        );
                      })}
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
                  <div className="w-full overflow-x-hidden">
                    <table className="w-full table-fixed">
                    <thead>
                      <tr className="border-b border-[#222222]">
                        <th className="w-1/3 text-left px-2 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Symbol</th>
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
                      {displayedOpenOrders.map((order, index) => {
                        const uiKey = getOrderUiKey(order);
                        const removalKey = getOrderCompositeKey(order.symbol, order.id);
                        const isAnimatingOut = animatingOutOrderKeys.has(removalKey);
                        const isExpanded = expandedOrderKey === uiKey;
                        return (
                        <React.Fragment key={uiKey}>
                          <tr
                            className={`mat-slide-rtl group/row hover:bg-[#1A1A1A] transition-colors duration-200 ${index !== displayedOpenOrders.length - 1 ? 'border-b border-[#1A1A1A]' : ''} ${isAnimatingOut ? 'order-row-slide-out' : ''}`}
                            style={{ animationDelay: `${index * 50}ms` }}
                            onAnimationEnd={(e) => {
                              if (e.animationName !== 'order-row-slide-out' || !animatingOutOrderKeys.has(removalKey)) return;
                              setAnimatingOutOrderKeys(prev => { const n = new Set(prev); n.delete(removalKey); return n; });
                              setOptimisticallyRemovedOrderIds(prev => { const n = new Set(prev); n.add(removalKey); return n; });
                            }}
                          >
                            <td className="pl-2 pr-1 py-1.5 w-1/3 max-w-0">
                              <div className="flex items-center gap-1 min-w-0">
                                <Link
                                  href={getTokenHref(order.symbol)}
                                  className="group/link flex min-w-0 max-w-full items-center gap-2 hover:opacity-90 transition-opacity"
                                  title={`Open ${order.symbol} market`}
                                >
                                  <img
                                    src={(marketSymbolMap.get(order.symbol)?.icon as string) || FALLBACK_TOKEN_ICON}
                                    alt={`${order.symbol} logo`}
                                    className="w-4 h-4 shrink-0 rounded-full border border-[#333333] object-cover"
                                  />
                                  <div className="min-w-0">
                                    <span className="block truncate text-[11px] font-medium text-white">
                                      {truncateMarketName(marketSymbolMap.get(order.symbol)?.name || order.symbol)}
                                    </span>
                                    <span className="block truncate text-[10px] text-[#9CA3AF]">
                                      {marketSymbolMap.get(order.symbol)?.identifier || order.symbol}
                                    </span>
                                  </div>
                                </Link>
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
                                onClick={() => setExpandedOrderKey(isExpanded ? null : uiKey)}
                                className="opacity-0 group-hover/row:opacity-100 transition-opacity duration-200 px-1.5 py-0.5 text-[9px] text-[#E5E7EB] hover:text-white hover:bg-[#2A2A2A] rounded"
                              >
                                {isExpanded ? 'Hide' : 'Manage'}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className={`bg-[#1A1A1A] ${isAnimatingOut ? 'order-row-slide-out' : ''}`}>
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
                                            const removalKey = getOrderCompositeKey(order.symbol, order.id);
                                            const revertOrder = () => {
                                              setOptimisticallyRemovedOrderIds(prev => {
                                                const next = new Set(prev);
                                                next.delete(removalKey);
                                                return next;
                                              });
                                              setAnimatingOutOrderKeys(prev => {
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
                                                await new Promise((r) => setTimeout(r, 400));
                                                setOrderFillModal((cur) => ({ ...cur, status: 'filling' }));
                                                setAnimatingOutOrderKeys(prev => { const next = new Set(prev); next.add(removalKey); return next; });
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
                                                await new Promise((r) => setTimeout(r, 400));
                                                setOrderFillModal((cur) => ({ ...cur, status: 'filling' }));
                                                setAnimatingOutOrderKeys(prev => { const next = new Set(prev); next.add(removalKey); return next; });
                                                const ok = await cancelOrderForMarket(order.id, metric);
                                                if (!ok) {
                                                  revertOrder();
                                                  showError('Failed to cancel order. Please try again.');
                                                  markCancelModalError();
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
                                              showError(e?.message || 'Cancellation failed. Please try again.');
                                              markCancelModalError();
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
                  <table className="w-full table-fixed">
                    <thead>
                      <tr className="border-b border-[#222222]">
                        <th className="w-1/3 text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Market</th>
                        <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Side</th>
                        <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Type</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Price</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Size</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderHistory.map((order, index) => (
                        <tr key={`${order.id}-${index}`} className={`hover:bg-[#1A1A1A] transition-colors duration-200 ${index !== orderHistory.length - 1 ? 'border-b border-[#1A1A1A]' : ''}`}>
                          <td className="px-2.5 py-2.5 w-1/3 max-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <Link
                                href={getTokenHref(order.symbol)}
                                className="group/link flex min-w-0 flex-1 max-w-full items-center gap-2 hover:opacity-90 transition-opacity"
                                title={`Open ${order.symbol} market`}
                              >
                                <img
                                  src={(marketSymbolMap.get(order.symbol)?.icon as string) || FALLBACK_TOKEN_ICON}
                                  alt={`${order.symbol} logo`}
                                  className="w-4 h-4 shrink-0 rounded-full border border-[#333333] object-cover"
                                />
                                <div className="min-w-0">
                                  <span className="block truncate text-[11px] font-medium text-white">
                                    {truncateMarketName(marketSymbolMap.get(order.symbol)?.name || order.symbol)}
                                  </span>
                                  <span className="block truncate text-[10px] text-[#9CA3AF]">
                                    {marketSymbolMap.get(order.symbol)?.identifier || order.symbol}
                                  </span>
                                </div>
                              </Link>

                              {order.txHash && (
                                <a
                                  href={`https://hyperevmscan.io/tx/${encodeURIComponent(order.txHash)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="shrink-0 inline-flex items-center justify-center rounded border border-[#333333] bg-[#141414] px-1 py-0.5 text-[#6B7280] hover:text-[#E5E7EB] hover:border-[#4B5563] transition-colors"
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
                            <span className="text-[11px] text-[#9CA3AF] whitespace-nowrap">{formatDate(order.timestamp)}</span>
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

      <OrderFillLoadingModal
        isOpen={orderFillModal.isOpen}
        progress={orderFillModal.progress}
        status={orderFillModal.status}
        allowClose={orderFillModal.allowClose}
        onClose={() => setOrderFillModal((cur) => ({ ...cur, isOpen: false, kind: null }))}
        headlineText="Cancelling order,"
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

      <div className="flex-1 min-h-0 overflow-auto scrollbar-hide">
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
                  {formatSize(maxSize)}
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