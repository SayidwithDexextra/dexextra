'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
  /** IDs of fee rows that arrived via realtime (for animation) */
  liveIds: Set<number>
  isLoading: boolean
  error: string | null
  refetch: () => void
}

function parseFeeDetail(r: any): FeeDetailRow {
  return {
    ...r,
    fee_amount_usdc: Number(r.fee_amount_usdc) || 0,
    protocol_share: Number(r.protocol_share) || 0,
    owner_share: Number(r.owner_share) || 0,
    trade_price: Number(r.trade_price) || 0,
    trade_amount: Number(r.trade_amount) || 0,
    trade_notional: Number(r.trade_notional) || 0,
  }
}

let _userFeesChannelCounter = 0

export function useUserFees(walletAddress: string | null, opts?: { recentLimit?: number }): UseUserFeesResult {
  const recentLimit = opts?.recentLimit ?? 20
  const channelIdRef = useRef(`user_fees_${++_userFeesChannelCounter}_${Date.now()}`)
  const [summary, setSummary] = useState<FeeSummaryRow[]>([])
  const [recentFees, setRecentFees] = useState<FeeDetailRow[]>([])
  const [liveIds, setLiveIds] = useState<Set<number>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const normalizedAddr = useMemo(
    () => (walletAddress ? walletAddress.toLowerCase() : null),
    [walletAddress]
  )

  const refetch = useCallback(() => setTick((t) => t + 1), [])
  const recentLimitRef = useRef(recentLimit)
  recentLimitRef.current = recentLimit

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

        setRecentFees((detailRes.data || []).map(parseFeeDetail))
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load fee data')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [normalizedAddr, recentLimit, tick])

  // Realtime: subscribe to new trading_fees rows for this user
  useEffect(() => {
    if (!normalizedAddr) return

    const channel = supabase
      .channel(`${channelIdRef.current}:${normalizedAddr}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'trading_fees',
          filter: `user_address=eq.${normalizedAddr}`,
        },
        (payload) => {
          const row = parseFeeDetail(payload.new)

          setRecentFees((prev) => [row, ...prev].slice(0, recentLimitRef.current))

          if (row.id) {
            setLiveIds((prev) => new Set([...prev, row.id]))
            setTimeout(() => setLiveIds((prev) => { const s = new Set(prev); s.delete(row.id); return s }), 1500)
          }

          // Incrementally update totals via summary-level accumulators
          setSummary((prev) => {
            const isTaker = row.fee_role === 'taker'
            const key = `${row.market_id}::${row.market_address}`
            const existing = prev.find(
              (s) => `${s.market_id}::${s.market_address}` === key
            )
            if (existing) {
              return prev.map((s) =>
                `${s.market_id}::${s.market_address}` === key
                  ? {
                      ...s,
                      total_trades: s.total_trades + 1,
                      taker_trades: s.taker_trades + (isTaker ? 1 : 0),
                      maker_trades: s.maker_trades + (isTaker ? 0 : 1),
                      total_fees_usdc: s.total_fees_usdc + row.fee_amount_usdc,
                      taker_fees_usdc: s.taker_fees_usdc + (isTaker ? row.fee_amount_usdc : 0),
                      maker_fees_usdc: s.maker_fees_usdc + (isTaker ? 0 : row.fee_amount_usdc),
                      total_volume_usdc: s.total_volume_usdc + row.trade_notional,
                      last_trade_at: row.created_at,
                    }
                  : s
              )
            }
            return [
              ...prev,
              {
                user_address: row.user_address,
                market_id: row.market_id,
                market_address: row.market_address,
                total_trades: 1,
                taker_trades: isTaker ? 1 : 0,
                maker_trades: isTaker ? 0 : 1,
                total_fees_usdc: row.fee_amount_usdc,
                taker_fees_usdc: isTaker ? row.fee_amount_usdc : 0,
                maker_fees_usdc: isTaker ? 0 : row.fee_amount_usdc,
                total_volume_usdc: row.trade_notional,
                first_trade_at: row.created_at,
                last_trade_at: row.created_at,
              },
            ]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [normalizedAddr])

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

  return { summary, recentFees, totals, liveIds, isLoading, error, refetch }
}
