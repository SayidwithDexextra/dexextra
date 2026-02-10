'use client'

import { useMemo } from 'react'
import { useOnchainOrders } from '@/contexts/OnchainOrdersContextV2'

export type PortfolioSidebarOpenOrder = {
  id: string
  symbol: string
  side: 'BUY' | 'SELL'
  price: number
  size: number
  timestamp: number
}

/**
 * Hook for portfolio sidebar open orders.
 *
 * Reads from the global OnchainOrdersContextV2 (single V2 API fetch + 24h localStorage cache).
 * No per-market contract calls, no sessionStorage, no separate fetch logic.
 */
export function usePortfolioSidebarOpenOrders(opts: {
  enabled: boolean
  walletAddress: string | null | undefined
  positionSymbols?: string[]
}) {
  const enabled = Boolean(opts.enabled)
  const { orders: globalOrders, isLoading, hasHydrated, lastFetchedAt, refresh } = useOnchainOrders()

  const orders: PortfolioSidebarOpenOrder[] = useMemo(() => {
    if (!enabled) return []
    if (!opts.walletAddress) return []

    // Map from OnchainOrder -> PortfolioSidebarOpenOrder
    return globalOrders
      .filter((o) => {
        // Only active orders with positive size and price
        if (o.status === 'CANCELLED' || o.status === 'FILLED') return false
        if (!(Number(o.size) > 0)) return false
        if (o.type === 'LIMIT' && !(Number(o.price) > 0)) return false
        return true
      })
      .map((o): PortfolioSidebarOpenOrder => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        price: o.price,
        size: o.size,
        timestamp: o.timestamp,
      }))
      .slice(0, 200) // keep bounded
  }, [enabled, opts.walletAddress, globalOrders])

  return {
    orders,
    isLoading: !hasHydrated && isLoading,
    isHydrating: false,
    isRefreshing: isLoading,
    hasLoadedOnce: hasHydrated,
    lastUpdated: lastFetchedAt,
    hydrateFromLocal: refresh,
    refreshOnchain: refresh,
  }
}
