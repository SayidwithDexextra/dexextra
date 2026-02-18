/**
 * Global portfolio snapshot cache.
 *
 * Goal: provide a single source of truth for portfolio metrics (Portfolio / Available Cash / Unrealized P&L)
 * across Header, PortfolioSidebar, and any other component.
 *
 * - Keeps an in-memory cache for fast reads within a session
 * - Persists to sessionStorage for tab-level continuity
 * - Uses a single hook instance (via Provider) to avoid race conditions / mismatched sources
 */
 
'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { useCoreVault } from '@/hooks/useCoreVault'
import { usePortfolioSummary } from '@/hooks/usePortfolioSummary'
import { usePositions } from '@/hooks/usePositions'
import { CHAIN_CONFIG } from '@/lib/contractConfig'

export type PortfolioSnapshot = {
  version: 1
  chainId: string
  walletAddress: string
  /**
   * Timestamp originating from `fetchPortfolioSummary` (ms since epoch).
   * This lets consumers reason about freshness.
   */
  updatedAt: number
  availableCash: number
  unrealizedPnl: number
  /**
   * Consistent value computation used in Header/Evaluation:
   * totalCollateral + max(0, realizedPnL) + unrealizedPnl
   */
  portfolioValue: number
  totalCollateral: number
  realizedPnl: number
}

export type CachedPosition = {
  id: string
  marketId: string
  symbol: string
  side: 'LONG' | 'SHORT'
  size: number
  entryPrice: number
  markPrice: number
  pnl: number
  pnlPercent: number
  liquidationPrice: number
  margin: number
  leverage: number
  timestamp: number
  isUnderLiquidation?: boolean
}

type PortfolioSnapshotState = {
  snapshot: PortfolioSnapshot | null
  isReady: boolean
  isLoading: boolean
  positions: CachedPosition[]
  positionsIsReady: boolean
  positionsIsLoading: boolean
  positionsError: string | null
  refresh: () => void
}

const PortfolioSnapshotContext = createContext<PortfolioSnapshotState | null>(null)

const memoryCache = new Map<string, PortfolioSnapshot>()
const memoryPositionsCache = new Map<string, { ts: number; positions: CachedPosition[] }>()

function cacheKey(chainId: string, walletAddress: string) {
  return `portfolio:snapshot:v1:${chainId}:${String(walletAddress).toLowerCase()}`
}

function positionsKey(chainId: string, walletAddress: string) {
  return `portfolio:positions:v1:${chainId}:${String(walletAddress).toLowerCase()}`
}

function safeParseNumber(n: any): number | null {
  const v = Number(n)
  return Number.isFinite(v) ? v : null
}

function loadFromSession(key: string): PortfolioSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as any
    if (!parsed || parsed.version !== 1) return null
    if (!parsed.walletAddress || !parsed.chainId) return null
    return parsed as PortfolioSnapshot
  } catch {
    return null
  }
}

function persistToSession(key: string, snapshot: PortfolioSnapshot) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, JSON.stringify(snapshot))
  } catch {
    // ignore
  }
}

type PositionsSessionPayload = {
  version: 1
  chainId: string
  walletAddress: string
  ts: number
  positions: CachedPosition[]
}

function loadPositionsFromSession(key: string): PositionsSessionPayload | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as any
    if (!parsed || parsed.version !== 1) return null
    if (!parsed.walletAddress || !parsed.chainId) return null
    if (!Array.isArray(parsed.positions)) return null
    return parsed as PositionsSessionPayload
  } catch {
    return null
  }
}

function persistPositionsToSession(key: string, payload: PositionsSessionPayload) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export function PortfolioSnapshotProvider({ children }: { children: React.ReactNode }) {
  const { walletData } = useWallet() as any
  const walletAddress: string | null = walletData?.address || null
  const isConnected = Boolean(walletData?.isConnected && walletAddress)

  // Single source hooks
  const core = useCoreVault(walletAddress || undefined)
  const summary = usePortfolioSummary(walletAddress, {
    enabled: isConnected,
    refreshIntervalMs: 15_000,
  })
  // Positions are also cached globally so token pages can render immediately.
  // Event-driven only: refreshes via `positionsRefreshRequested` / `ordersUpdated`.
  const positionsState = usePositions(undefined, {
    enabled: isConnected,
    pollIntervalMs: 0,
  })

  const chainId = String((CHAIN_CONFIG as any)?.chainId ?? 'unknown')
  const key = useMemo(() => (walletAddress ? cacheKey(chainId, walletAddress) : ''), [chainId, walletAddress])
  const posKey = useMemo(() => (walletAddress ? positionsKey(chainId, walletAddress) : ''), [chainId, walletAddress])

  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null)
  const [positions, setPositions] = useState<CachedPosition[]>([])
  const lastKeyRef = useRef<string>('')
  const lastPosKeyRef = useRef<string>('')

  // Hydrate from memory/session whenever wallet changes.
  useEffect(() => {
    if (!key || !walletAddress || !isConnected) {
      lastKeyRef.current = key
      setSnapshot(null)
      return
    }

    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key
      const mem = memoryCache.get(key) || null
      const sess = mem ? null : loadFromSession(key)
      setSnapshot(mem || sess || null)
    }
  }, [key, walletAddress, isConnected])

  // Hydrate positions from memory/session whenever wallet changes.
  useEffect(() => {
    if (!posKey || !walletAddress || !isConnected) {
      lastPosKeyRef.current = posKey
      setPositions([])
      return
    }

    if (lastPosKeyRef.current !== posKey) {
      lastPosKeyRef.current = posKey
      const mem = memoryPositionsCache.get(posKey) || null
      const sess = mem ? null : loadPositionsFromSession(posKey)
      setPositions(mem?.positions || sess?.positions || [])
    }
  }, [posKey, walletAddress, isConnected])

  const nextSnapshot = useMemo((): PortfolioSnapshot | null => {
    if (!isConnected || !walletAddress) return null
    const updatedAt = safeParseNumber((summary.summary as any)?.updatedAt)
    const availableCash = safeParseNumber((summary.summary as any)?.availableCash)
    const unrealizedPnl = safeParseNumber((summary.summary as any)?.unrealizedPnl)
    if (updatedAt === null || availableCash === null || unrealizedPnl === null) return null

    const totalCollateral = safeParseNumber(core.totalCollateral) ?? 0
    const realizedPnl = safeParseNumber(core.realizedPnL) ?? 0
    const portfolioValue = totalCollateral + Math.max(0, realizedPnl) + unrealizedPnl

    return {
      version: 1,
      chainId,
      walletAddress: String(walletAddress),
      updatedAt,
      availableCash,
      unrealizedPnl,
      portfolioValue,
      totalCollateral,
      realizedPnl,
    }
  }, [chainId, core.realizedPnL, core.totalCollateral, isConnected, summary.summary, walletAddress])

  // Persist fresh snapshots (and publish via context state).
  useEffect(() => {
    if (!nextSnapshot || !key) return
    memoryCache.set(key, nextSnapshot)
    persistToSession(key, nextSnapshot)
    setSnapshot(nextSnapshot)
  }, [key, nextSnapshot])

  // Persist fresh positions when the hook updates.
  useEffect(() => {
    if (!posKey || !isConnected || !walletAddress) return
    if (positionsState?.isLoading) return
    const next = Array.isArray(positionsState?.positions) ? (positionsState.positions as any[]) : []
    // The hook already returns a stable, JSON-serializable shape; just coerce to CachedPosition.
    const mapped: CachedPosition[] = next.map((p: any) => ({
      id: String(p?.id || ''),
      marketId: String(p?.marketId || ''),
      symbol: String(p?.symbol || '').toUpperCase(),
      side: (String(p?.side || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'),
      size: Number(p?.size || 0),
      entryPrice: Number(p?.entryPrice || 0),
      markPrice: Number(p?.markPrice || p?.entryPrice || 0),
      pnl: Number(p?.pnl || 0),
      pnlPercent: Number(p?.pnlPercent || 0),
      liquidationPrice: Number(p?.liquidationPrice || 0),
      margin: Number(p?.margin || 0),
      leverage: Number(p?.leverage || 1),
      timestamp: Number(p?.timestamp || Date.now()),
      isUnderLiquidation: Boolean(p?.isUnderLiquidation || false),
    }))
    const now = Date.now()
    memoryPositionsCache.set(posKey, { ts: now, positions: mapped })
    persistPositionsToSession(posKey, {
      version: 1,
      chainId,
      walletAddress: String(walletAddress),
      ts: now,
      positions: mapped,
    })
    setPositions(mapped)
  }, [posKey, chainId, isConnected, walletAddress, positionsState?.isLoading, positionsState?.positions])

  const refresh = useCallback(() => {
    try {
      summary.refresh()
    } catch {}
    try {
      core.refresh?.()
    } catch {}
    try {
      // Trigger a positions refresh window (usePositions listens to this event)
      if (typeof window !== 'undefined' && walletAddress) {
        window.dispatchEvent(new CustomEvent('positionsRefreshRequested', { detail: { traceId: `ui:positions:refresh:${Date.now()}` } }))
      }
    } catch {}
  }, [core, summary])

  const isReady = Boolean(isConnected && snapshot && snapshot.walletAddress?.toLowerCase() === String(walletAddress || '').toLowerCase())
  const isLoading = Boolean(isConnected && !isReady && (summary.isLoading || core.isLoading))

  const positionsIsReady = Boolean(
    isConnected &&
      walletAddress &&
      Array.isArray(positions) &&
      // ready if we have hydrated cached positions or the hook has completed at least once
      (!positionsState?.isLoading)
  )
  const positionsIsLoading = Boolean(isConnected && !positionsIsReady && positionsState?.isLoading)
  const positionsError = (positionsState as any)?.error ? String((positionsState as any).error) : null

  const value = useMemo(
    () => ({
      snapshot,
      isReady,
      isLoading,
      positions,
      positionsIsReady,
      positionsIsLoading,
      positionsError,
      refresh,
    }),
    [snapshot, isReady, isLoading, positions, positionsIsReady, positionsIsLoading, positionsError, refresh]
  )

  return <PortfolioSnapshotContext.Provider value={value}>{children}</PortfolioSnapshotContext.Provider>
}

export function usePortfolioSnapshot() {
  const ctx = useContext(PortfolioSnapshotContext)
  if (!ctx) throw new Error('usePortfolioSnapshot must be used within a PortfolioSnapshotProvider')
  return ctx
}

