'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

export interface OwnerEarningsRow {
  market_owner_address: string
  market_id: string
  market_address: string
  total_fee_events: number
  total_owner_earnings_usdc: number
  total_protocol_earnings_usdc: number
  total_fees_collected_usdc: number
  total_volume_usdc: number
  first_fee_at: string | null
  last_fee_at: string | null
}

export interface OwnerEarningsTotals {
  totalOwnerEarningsUsdc: number
  totalProtocolEarningsUsdc: number
  totalFeesCollectedUsdc: number
  totalVolumeUsdc: number
  totalFeeEvents: number
  marketCount: number
}

export interface UseOwnerEarningsResult {
  markets: OwnerEarningsRow[]
  totals: OwnerEarningsTotals
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useOwnerEarnings(walletAddress: string | null): UseOwnerEarningsResult {
  const [markets, setMarkets] = useState<OwnerEarningsRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const normalizedAddr = useMemo(
    () => (walletAddress ? walletAddress.toLowerCase() : null),
    [walletAddress]
  )

  const refetch = useCallback(() => setTick((t) => t + 1), [])

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
        const { data, error: err } = await supabase
          .from('market_owner_earnings')
          .select('*')
          .eq('market_owner_address', normalizedAddr)

        if (cancelled) return
        if (err) throw err

        setMarkets(
          (data || []).map((r: any) => ({
            ...r,
            total_fee_events: Number(r.total_fee_events) || 0,
            total_owner_earnings_usdc: Number(r.total_owner_earnings_usdc) || 0,
            total_protocol_earnings_usdc: Number(r.total_protocol_earnings_usdc) || 0,
            total_fees_collected_usdc: Number(r.total_fees_collected_usdc) || 0,
            total_volume_usdc: Number(r.total_volume_usdc) || 0,
          }))
        )
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load owner earnings')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [normalizedAddr, tick])

  const totals = useMemo<OwnerEarningsTotals>(() => {
    if (markets.length === 0)
      return { totalOwnerEarningsUsdc: 0, totalProtocolEarningsUsdc: 0, totalFeesCollectedUsdc: 0, totalVolumeUsdc: 0, totalFeeEvents: 0, marketCount: 0 }

    return markets.reduce<OwnerEarningsTotals>(
      (acc, r) => ({
        totalOwnerEarningsUsdc: acc.totalOwnerEarningsUsdc + r.total_owner_earnings_usdc,
        totalProtocolEarningsUsdc: acc.totalProtocolEarningsUsdc + r.total_protocol_earnings_usdc,
        totalFeesCollectedUsdc: acc.totalFeesCollectedUsdc + r.total_fees_collected_usdc,
        totalVolumeUsdc: acc.totalVolumeUsdc + r.total_volume_usdc,
        totalFeeEvents: acc.totalFeeEvents + r.total_fee_events,
        marketCount: acc.marketCount + 1,
      }),
      { totalOwnerEarningsUsdc: 0, totalProtocolEarningsUsdc: 0, totalFeesCollectedUsdc: 0, totalVolumeUsdc: 0, totalFeeEvents: 0, marketCount: 0 }
    )
  }, [markets])

  return { markets, totals, isLoading, error, refetch }
}
