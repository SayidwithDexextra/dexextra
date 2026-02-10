'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Address } from 'viem'
import { CHAIN_CONFIG, CONTRACT_ADDRESSES, populateMarketInfoClient } from '@/lib/contractConfig'
import { OrderService } from '@/lib/orderService'
import type { Order as OnchainOrder } from '@/types/orders'

export type PortfolioSidebarOpenOrder = {
  id: string
  symbol: string
  side: 'BUY' | 'SELL'
  price: number
  size: number
  timestamp: number
}

type OrdersCachePayloadV1 = {
  version: 1
  chainId: string | number
  walletAddress: string
  ts: number
  orders: PortfolioSidebarOpenOrder[]
}

const ORDERBOOK_SESSION_PREFIX = 'orderbook:activeOrders:v1:'
const STORAGE_PREFIX = 'portfolioSidebar:openOrders:v1'

const orderServiceSingleton = new OrderService()

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value)
}

function normalizeStatus(raw: any): string {
  return String(raw || '').trim().toLowerCase()
}

function isActiveOrderStatus(raw: any): boolean {
  const s = normalizeStatus(raw)
  if (!s) return true
  return !['filled', 'cancelled', 'canceled', 'expired', 'rejected'].includes(s)
}

function normalizeTs(raw: any): number {
  if (raw instanceof Date) return raw.getTime()
  const n = typeof raw === 'string' ? Date.parse(raw) : Number(raw)
  if (!Number.isFinite(n)) return Date.now()
  // if it looks like seconds, convert to ms
  return n < 1_000_000_000_000 ? n * 1000 : n
}

function safeNumber(raw: any, fallback = 0): number {
  const n = typeof raw === 'string' ? Number(raw) : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function getCacheKey(walletAddress: string): string {
  const chainId = String((CHAIN_CONFIG as any)?.chainId ?? 'unknown')
  return `${STORAGE_PREFIX}:${chainId}:${walletAddress.toLowerCase()}`
}

function readCacheFromStorage(storage: Storage, walletAddress: string): OrdersCachePayloadV1 | null {
  try {
    const raw = storage.getItem(getCacheKey(walletAddress))
    if (!raw) return null
    const parsed = JSON.parse(raw) as OrdersCachePayloadV1
    if (!parsed || parsed.version !== 1) return null
    if (String(parsed.walletAddress || '').toLowerCase() !== walletAddress.toLowerCase()) return null
    if (!Array.isArray(parsed.orders)) return null
    return parsed
  } catch {
    return null
  }
}

function persistCacheToStorage(storage: Storage, walletAddress: string, orders: PortfolioSidebarOpenOrder[]): void {
  try {
    const payload: OrdersCachePayloadV1 = {
      version: 1,
      chainId: String((CHAIN_CONFIG as any)?.chainId ?? 'unknown'),
      walletAddress,
      ts: Date.now(),
      orders,
    }
    storage.setItem(getCacheKey(walletAddress), JSON.stringify(payload))
  } catch {
    // ignore
  }
}

function mapCachedSessionOrderToSidebarOrder(order: any, marketId: string): PortfolioSidebarOpenOrder | null {
  if (!order) return null
  const id = String(order?.id || order?.order_id || order?.orderId || '').trim()
  if (!id) return null

  const status = order?.status ?? order?.order_status
  if (!isActiveOrderStatus(status)) return null

  const sideRaw = order?.side ?? (order?.isBuy ? 'buy' : 'sell')
  const side = String(sideRaw || '').toLowerCase() === 'sell' ? 'SELL' : 'BUY'

  const price = safeNumber(order?.price, 0)

  const qty = safeNumber(order?.size ?? order?.quantity ?? order?.amount, 0)
  const filled = safeNumber(order?.filledQuantity ?? order?.filled_quantity ?? order?.filled, 0)
  const remaining = Math.max(0, qty - filled)
  if (!(remaining > 0)) return null

  const ts = normalizeTs(order?.timestamp ?? order?.updated_at ?? order?.created_at ?? order?.ts)

  return {
    id,
    symbol: String(marketId || 'UNKNOWN').toUpperCase(),
    side,
    price: Number.isFinite(price) ? price : 0,
    size: Number.isFinite(remaining) ? remaining : 0,
    timestamp: Number.isFinite(ts) ? ts : Date.now(),
  }
}

function readPrimaryFromSessionStorage(walletAddress: string): PortfolioSidebarOpenOrder[] {
  if (typeof window === 'undefined') return []
  const out: PortfolioSidebarOpenOrder[] = []
  const chainId = String((CHAIN_CONFIG as any)?.chainId ?? 'unknown')
  const addrLower = walletAddress.toLowerCase()
  const prefix = `${ORDERBOOK_SESSION_PREFIX}${chainId}:${addrLower}:`

  try {
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i)
      if (!key || !key.startsWith(prefix)) continue
      const raw = window.sessionStorage.getItem(key)
      if (!raw) continue
      try {
        const payload = JSON.parse(raw) as any
        if (!payload || Number(payload.version) !== 1) continue
        if (String(payload.walletAddress || '').toLowerCase() !== addrLower) continue
        const marketId = String(payload.marketId || '').toUpperCase()
        const orders = Array.isArray(payload.orders) ? payload.orders : []
        for (const o of orders) {
          const mapped = mapCachedSessionOrderToSidebarOrder(o, marketId)
          if (mapped) out.push(mapped)
        }
      } catch {
        // ignore malformed payloads
      }
    }
  } catch {
    // ignore
  }

  // newest first
  out.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))

  // dedupe by (symbol,id)
  const seen = new Set<string>()
  const deduped: PortfolioSidebarOpenOrder[] = []
  for (const o of out) {
    const k = `${o.symbol}::${o.id}`
    if (seen.has(k)) continue
    seen.add(k)
    deduped.push(o)
  }
  return deduped
}

function mapOnchainOrderToSidebar(order: OnchainOrder): PortfolioSidebarOpenOrder | null {
  if (!order || !order.id) return null
  if (!isActiveOrderStatus(order.status)) return null
  const remaining = Math.max(0, safeNumber(order.quantity, 0) - safeNumber(order.filledQuantity, 0))
  if (!(remaining > 0)) return null
  return {
    id: String(order.id),
    symbol: String(order.metricId || 'UNKNOWN').toUpperCase(),
    side: String(order.side || '').toLowerCase() === 'sell' ? 'SELL' : 'BUY',
    price: safeNumber(order.price, 0),
    size: remaining,
    timestamp: normalizeTs(order.timestamp),
  }
}

export function usePortfolioSidebarOpenOrders(opts: {
  enabled: boolean
  walletAddress: string | null | undefined
  // Optional hints to decide which markets to onchain-backfill when cache is empty.
  positionSymbols?: string[]
}) {
  const enabled = Boolean(opts.enabled)
  const walletAddress = opts.walletAddress || null
  const positionSymbols = opts.positionSymbols || []

  const [orders, setOrders] = useState<PortfolioSidebarOpenOrder[]>([])
  const [isHydrating, setIsHydrating] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const lastUpdatedRef = useRef<number>(0)
  const inflightRef = useRef<Promise<void> | null>(null)
  const ordersRef = useRef<PortfolioSidebarOpenOrder[]>([])
  const positionSymbolsRef = useRef<string[]>(positionSymbols)

  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

  useEffect(() => {
    positionSymbolsRef.current = positionSymbols
  }, [positionSymbols])

  const hydrateFromLocal = useCallback(() => {
    if (!enabled) return
    if (!walletAddress || !isHexAddress(walletAddress)) return
    if (typeof window === 'undefined') return

    setIsHydrating(true)
    try {
      // Prefer newest sessionStorage-derived snapshot (per-market orderbook caches)
      const fromSessionKeys = readPrimaryFromSessionStorage(walletAddress)

      // Fallback to our aggregated cache in sessionStorage/localStorage (fast render on non-token pages)
      const cachedSession = readCacheFromStorage(window.sessionStorage, walletAddress)
      const cachedLocal = readCacheFromStorage(window.localStorage, walletAddress)
      const cached = cachedSession || cachedLocal
      const cachedOrders = Array.isArray(cached?.orders) ? cached!.orders : []

      const merged = [...fromSessionKeys, ...cachedOrders]

      // Dedupe by (symbol,id), keep newest timestamp
      const bestByKey = new Map<string, PortfolioSidebarOpenOrder>()
      for (const o of merged) {
        if (!o?.id || !o?.symbol) continue
        const k = `${String(o.symbol).toUpperCase()}::${String(o.id)}`
        const prev = bestByKey.get(k)
        if (!prev || Number(o.timestamp || 0) > Number(prev.timestamp || 0)) {
          bestByKey.set(k, { ...o, symbol: String(o.symbol).toUpperCase() })
        }
      }

      const next = Array.from(bestByKey.values()).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
      setOrders(next.slice(0, 200)) // keep bounded
      setHasLoadedOnce(true)
      lastUpdatedRef.current = Date.now()
    } finally {
      setIsHydrating(false)
    }
  }, [enabled, walletAddress])

  const refreshOnchain = useCallback(async () => {
    if (!enabled) return
    if (!walletAddress || !isHexAddress(walletAddress)) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    // Dedupe concurrent refreshes
    if (inflightRef.current) return inflightRef.current

    const run = (async () => {
      setIsRefreshing(true)
      try {
        // Ensure MARKET_INFO has data for orderBook resolution (best-effort).
        // This fetches market metadata only (not order history tables).
        try {
          const entries = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {}) as any[]
          if (!entries || entries.length === 0) {
            await populateMarketInfoClient()
          }
        } catch {
          // ignore
        }

        // Decide which markets to sweep:
        // - first choice: markets already present in the local snapshot (cheap + relevant)
        // - fallback: markets hinted by open positions (bounded)
        const snapshot = ordersRef.current || []
        const posHints = positionSymbolsRef.current || []
        const marketsFromSnapshot = Array.from(new Set(snapshot.map((o) => String(o.symbol || '').toUpperCase()).filter(Boolean)))
        const marketsFromPositions = Array.from(new Set(posHints.map((s) => String(s || '').toUpperCase()).filter(Boolean)))

        const marketCandidates = (marketsFromSnapshot.length > 0 ? marketsFromSnapshot : marketsFromPositions).slice(0, 10)
        if (marketCandidates.length === 0) return

        const trader = walletAddress as Address
        const results = await Promise.allSettled(
          marketCandidates.map(async (metricId) => {
            const active = await orderServiceSingleton.getUserActiveOrders(trader, metricId)
            return active
          })
        )

        const mapped: PortfolioSidebarOpenOrder[] = []
        for (const r of results) {
          if (r.status !== 'fulfilled') continue
          const arr = Array.isArray(r.value) ? r.value : []
          for (const o of arr) {
            const m = mapOnchainOrderToSidebar(o as any)
            if (m) mapped.push(m)
          }
        }

        // Merge into state + persist
        setOrders((prev) => {
          const bestByKey = new Map<string, PortfolioSidebarOpenOrder>()
          for (const o of [...prev, ...mapped]) {
            if (!o?.id || !o?.symbol) continue
            const symbol = String(o.symbol).toUpperCase()
            const k = `${symbol}::${String(o.id)}`
            const existing = bestByKey.get(k)
            if (!existing || Number(o.timestamp || 0) > Number(existing.timestamp || 0)) {
              bestByKey.set(k, { ...o, symbol })
            }
          }
          const next = Array.from(bestByKey.values()).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).slice(0, 200)
          try {
            if (typeof window !== 'undefined') {
              persistCacheToStorage(window.sessionStorage, walletAddress, next)
              persistCacheToStorage(window.localStorage, walletAddress, next)
            }
          } catch {
            // ignore
          }
          lastUpdatedRef.current = Date.now()
          return next
        })

        setHasLoadedOnce(true)
      } finally {
        setIsRefreshing(false)
        inflightRef.current = null
      }
    })()

    inflightRef.current = run
    return run
  }, [enabled, walletAddress])

  // Hydrate immediately when enabled/address changes.
  useEffect(() => {
    if (!enabled) return
    if (!walletAddress) return
    hydrateFromLocal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, walletAddress])

  // When the sidebar opens, do an on-chain backfill (secondary fetch).
  useEffect(() => {
    if (!enabled) return
    if (!walletAddress) return
    // Let the local snapshot paint first, then backfill.
    const t = setTimeout(() => {
      void refreshOnchain()
    }, 50)
    return () => clearTimeout(t)
  }, [enabled, walletAddress, refreshOnchain])

  // If other parts of the app update sessionStorage orders, reflect them quickly.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!enabled || !walletAddress) return
    const handler = () => hydrateFromLocal()
    window.addEventListener('ordersUpdated', handler as EventListener)
    return () => window.removeEventListener('ordersUpdated', handler as EventListener)
  }, [enabled, walletAddress, hydrateFromLocal])

  const isLoading = useMemo(() => {
    // For UI skeletons: only show "loading" before the first local hydrate completes.
    return !hasLoadedOnce && (isHydrating || isRefreshing)
  }, [hasLoadedOnce, isHydrating, isRefreshing])

  return {
    orders,
    isLoading,
    isHydrating,
    isRefreshing,
    hasLoadedOnce,
    lastUpdated: lastUpdatedRef.current || null,
    hydrateFromLocal,
    refreshOnchain,
  }
}

