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

export interface ProtocolEarningsRow {
  protocol_fee_recipient: string
  market_id: string
  market_address: string
  total_fee_events: number
  total_protocol_earnings_usdc: number
  total_owner_earnings_usdc: number
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
  protocolMarkets: ProtocolEarningsRow[]
  totals: OwnerEarningsTotals
  protocolTotals: OwnerEarningsTotals
  isMarketOwner: boolean
  isProtocolRecipient: boolean
  hasRevenue: boolean
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useOwnerEarnings(walletAddress: string | null): UseOwnerEarningsResult {
  const [markets, setMarkets] = useState<OwnerEarningsRow[]>([])
  const [protocolMarkets, setProtocolMarkets] = useState<ProtocolEarningsRow[]>([])
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
      setProtocolMarkets([])
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    ;(async () => {
      try {
        const [ownerRes, protoRes] = await Promise.all([
          supabase
            .from('market_owner_earnings')
            .select('*')
            .eq('market_owner_address', normalizedAddr),
          supabase
            .from('protocol_fee_earnings')
            .select('*')
            .eq('protocol_fee_recipient', normalizedAddr),
        ])

        if (cancelled) return
        if (ownerRes.error) throw ownerRes.error
        if (protoRes.error) throw protoRes.error

        setMarkets(
          (ownerRes.data || []).map((r: any) => ({
            ...r,
            total_fee_events: Number(r.total_fee_events) || 0,
            total_owner_earnings_usdc: Number(r.total_owner_earnings_usdc) || 0,
            total_protocol_earnings_usdc: Number(r.total_protocol_earnings_usdc) || 0,
            total_fees_collected_usdc: Number(r.total_fees_collected_usdc) || 0,
            total_volume_usdc: Number(r.total_volume_usdc) || 0,
          }))
        )

        setProtocolMarkets(
          (protoRes.data || []).map((r: any) => ({
            ...r,
            total_fee_events: Number(r.total_fee_events) || 0,
            total_protocol_earnings_usdc: Number(r.total_protocol_earnings_usdc) || 0,
            total_owner_earnings_usdc: Number(r.total_owner_earnings_usdc) || 0,
            total_fees_collected_usdc: Number(r.total_fees_collected_usdc) || 0,
            total_volume_usdc: Number(r.total_volume_usdc) || 0,
          }))
        )
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load earnings')
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

  const protocolTotals = useMemo<OwnerEarningsTotals>(() => {
    if (protocolMarkets.length === 0)
      return { totalOwnerEarningsUsdc: 0, totalProtocolEarningsUsdc: 0, totalFeesCollectedUsdc: 0, totalVolumeUsdc: 0, totalFeeEvents: 0, marketCount: 0 }

    return protocolMarkets.reduce<OwnerEarningsTotals>(
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
  }, [protocolMarkets])

  const isMarketOwner = markets.length > 0
  const isProtocolRecipient = protocolMarkets.length > 0
  const hasRevenue = isMarketOwner || isProtocolRecipient

  return { markets, protocolMarkets, totals, protocolTotals, isMarketOwner, isProtocolRecipient, hasRevenue, isLoading, error, refetch }
}
