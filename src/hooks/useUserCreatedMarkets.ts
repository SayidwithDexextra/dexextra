'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

export interface CreatedMarketRow {
  id: string
  symbol: string
  name: string | null
  market_identifier: string
  market_address: string | null
  market_status: string
  is_active: boolean
  created_at: string
  deployed_at: string | null
  creation_fee: number
  initial_order_value: number
  total_volume: number
  total_trades: number
}

export interface UseUserCreatedMarketsResult {
  markets: CreatedMarketRow[]
  totals: {
    totalCreationFees: number
    totalInitialOrderValue: number
    totalInvested: number
    marketCount: number
    activeMarkets: number
    settledMarkets: number
    totalVolume: number
    totalTrades: number
  }
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useUserCreatedMarkets(walletAddress: string | null): UseUserCreatedMarketsResult {
  const [markets, setMarkets] = useState<CreatedMarketRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const normalizedAddr = useMemo(
    () => (walletAddress ? walletAddress.toLowerCase() : null),
    [walletAddress]
  )

  const refetch = () => setTick((t) => t + 1)

  useEffect(() => {
    if (!normalizedAddr) {
      setMarkets([])
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    ;(async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('markets')
          .select(`
            id,
            symbol,
            name,
            market_identifier,
            market_address,
            market_status,
            is_active,
            created_at,
            deployed_at,
            market_config,
            initial_order,
            total_volume,
            total_trades
          `)
          .ilike('creator_wallet_address', normalizedAddr)
          .order('created_at', { ascending: false })

        if (cancelled) return
        if (fetchError) throw fetchError

        const processed: CreatedMarketRow[] = (data || []).map((row: any) => {
          const creationFee = Number(row.market_config?.creation_fee) || 0
          
          // Calculate initial order value if present
          let initialOrderValue = 0
          if (row.initial_order) {
            const price = Number(row.initial_order.price) || Number(row.initial_order.startPrice) || 0
            const quantity = Number(row.initial_order.quantity) || 0
            initialOrderValue = price * quantity
          }

          return {
            id: row.id,
            symbol: row.symbol || '',
            name: row.name || null,
            market_identifier: row.market_identifier || '',
            market_address: row.market_address || null,
            market_status: row.market_status || 'UNKNOWN',
            is_active: row.is_active ?? false,
            created_at: row.created_at,
            deployed_at: row.deployed_at || null,
            creation_fee: creationFee,
            initial_order_value: initialOrderValue,
            total_volume: Number(row.total_volume) || 0,
            total_trades: Number(row.total_trades) || 0,
          }
        })

        setMarkets(processed)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load created markets')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [normalizedAddr, tick])

  const totals = useMemo(() => {
    if (markets.length === 0) {
      return {
        totalCreationFees: 0,
        totalInitialOrderValue: 0,
        totalInvested: 0,
        marketCount: 0,
        activeMarkets: 0,
        settledMarkets: 0,
        totalVolume: 0,
        totalTrades: 0,
      }
    }

    return markets.reduce(
      (acc, m) => ({
        totalCreationFees: acc.totalCreationFees + m.creation_fee,
        totalInitialOrderValue: acc.totalInitialOrderValue + m.initial_order_value,
        totalInvested: acc.totalInvested + m.creation_fee + m.initial_order_value,
        marketCount: acc.marketCount + 1,
        activeMarkets: acc.activeMarkets + (m.is_active && m.market_status !== 'SETTLED' ? 1 : 0),
        settledMarkets: acc.settledMarkets + (m.market_status === 'SETTLED' ? 1 : 0),
        totalVolume: acc.totalVolume + m.total_volume,
        totalTrades: acc.totalTrades + m.total_trades,
      }),
      {
        totalCreationFees: 0,
        totalInitialOrderValue: 0,
        totalInvested: 0,
        marketCount: 0,
        activeMarkets: 0,
        settledMarkets: 0,
        totalVolume: 0,
        totalTrades: 0,
      }
    )
  }, [markets])

  return { markets, totals, isLoading, error, refetch }
}
