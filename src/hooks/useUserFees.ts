'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

export interface FeeSummaryRow {
  user_address: string
  market_id: string
  market_address: string
  total_trades: number
  taker_trades: number
  maker_trades: number
  total_fees_usdc: number
  taker_fees_usdc: number
  maker_fees_usdc: number
  total_volume_usdc: number
  first_trade_at: string | null
  last_trade_at: string | null
}

export interface FeeDetailRow {
  id: number
  market_id: string
  market_address: string
  trade_id: number
  user_address: string
  fee_role: 'taker' | 'maker'
  fee_amount_usdc: number
  protocol_share: number
  owner_share: number
  trade_price: number
  trade_amount: number
  trade_notional: number
  counterparty_address: string | null
  tx_hash: string | null
  block_number: number | null
  created_at: string
}

export interface UserFeeTotals {
  totalFeesUsdc: number
  takerFeesUsdc: number
  makerFeesUsdc: number
  totalTrades: number
  takerTrades: number
  makerTrades: number
  totalVolumeUsdc: number
}

export interface UseUserFeesResult {
  summary: FeeSummaryRow[]
  recentFees: FeeDetailRow[]
  totals: UserFeeTotals
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useUserFees(walletAddress: string | null, opts?: { recentLimit?: number }): UseUserFeesResult {
  const recentLimit = opts?.recentLimit ?? 20
  const [summary, setSummary] = useState<FeeSummaryRow[]>([])
  const [recentFees, setRecentFees] = useState<FeeDetailRow[]>([])
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
      setSummary([])
      setRecentFees([])
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    ;(async () => {
      try {
        const [summaryRes, detailRes] = await Promise.all([
          supabase
            .from('user_fee_summary')
            .select('*')
            .eq('user_address', normalizedAddr),
          supabase
            .from('trading_fees')
            .select('*')
            .eq('user_address', normalizedAddr)
            .order('created_at', { ascending: false })
            .limit(recentLimit),
        ])

        if (cancelled) return

        if (summaryRes.error) throw summaryRes.error
        if (detailRes.error) throw detailRes.error

        setSummary(
          (summaryRes.data || []).map((r: any) => ({
            ...r,
            total_trades: Number(r.total_trades) || 0,
            taker_trades: Number(r.taker_trades) || 0,
            maker_trades: Number(r.maker_trades) || 0,
            total_fees_usdc: Number(r.total_fees_usdc) || 0,
            taker_fees_usdc: Number(r.taker_fees_usdc) || 0,
            maker_fees_usdc: Number(r.maker_fees_usdc) || 0,
            total_volume_usdc: Number(r.total_volume_usdc) || 0,
          }))
        )

        setRecentFees(
          (detailRes.data || []).map((r: any) => ({
            ...r,
            fee_amount_usdc: Number(r.fee_amount_usdc) || 0,
            protocol_share: Number(r.protocol_share) || 0,
            owner_share: Number(r.owner_share) || 0,
            trade_price: Number(r.trade_price) || 0,
            trade_amount: Number(r.trade_amount) || 0,
            trade_notional: Number(r.trade_notional) || 0,
          }))
        )
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load fee data')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [normalizedAddr, recentLimit, tick])

  const totals = useMemo<UserFeeTotals>(() => {
    if (summary.length === 0)
      return { totalFeesUsdc: 0, takerFeesUsdc: 0, makerFeesUsdc: 0, totalTrades: 0, takerTrades: 0, makerTrades: 0, totalVolumeUsdc: 0 }

    return summary.reduce<UserFeeTotals>(
      (acc, r) => ({
        totalFeesUsdc: acc.totalFeesUsdc + r.total_fees_usdc,
        takerFeesUsdc: acc.takerFeesUsdc + r.taker_fees_usdc,
        makerFeesUsdc: acc.makerFeesUsdc + r.maker_fees_usdc,
        totalTrades: acc.totalTrades + r.total_trades,
        takerTrades: acc.takerTrades + r.taker_trades,
        makerTrades: acc.makerTrades + r.maker_trades,
        totalVolumeUsdc: acc.totalVolumeUsdc + r.total_volume_usdc,
      }),
      { totalFeesUsdc: 0, takerFeesUsdc: 0, makerFeesUsdc: 0, totalTrades: 0, takerTrades: 0, makerTrades: 0, totalVolumeUsdc: 0 }
    )
  }, [summary])

  return { summary, recentFees, totals, isLoading, error, refetch }
}
