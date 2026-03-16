'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
  /** Market keys (market_id::market_address) that just received a realtime update */
  liveMarketKeys: Set<string>
  isMarketOwner: boolean
  isProtocolRecipient: boolean
  hasRevenue: boolean
  isLoading: boolean
  error: string | null
  refetch: () => void
}

let _ownerEarningsChannelCounter = 0

export function useOwnerEarnings(walletAddress: string | null): UseOwnerEarningsResult {
  const channelIdRef = useRef(`owner_earnings_${++_ownerEarningsChannelCounter}_${Date.now()}`)
  const [markets, setMarkets] = useState<OwnerEarningsRow[]>([])
  const [protocolMarkets, setProtocolMarkets] = useState<ProtocolEarningsRow[]>([])
  const [liveMarketKeys, setLiveMarketKeys] = useState<Set<string>>(new Set())
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

  // Realtime: subscribe to new trading_fees rows and incrementally update
  // when the wallet is the market_owner or protocol_fee_recipient
  const normalizedAddrRef = useRef(normalizedAddr)
  normalizedAddrRef.current = normalizedAddr

  useEffect(() => {
    if (!normalizedAddr) return

    const channel = supabase
      .channel(`${channelIdRef.current}:${normalizedAddr}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trading_fees' },
        (payload) => {
          const row = payload.new as any
          const addr = normalizedAddrRef.current
          if (!addr) return

          const ownerAddr = (row.market_owner_address || '').toLowerCase()
          const protoAddr = (row.protocol_fee_recipient || '').toLowerCase()
          const ownerShare = Number(row.owner_share) || 0
          const protoShare = Number(row.protocol_share) || 0
          const feeUsdc = Number(row.fee_amount_usdc) || 0
          const volume = Number(row.trade_notional) || 0
          const mktId = row.market_id || ''
          const mktAddr = row.market_address || ''
          const key = `${mktId}::${mktAddr}`
          const ts = row.created_at || new Date().toISOString()

          const markLive = (k: string) => {
            setLiveMarketKeys((prev) => new Set([...prev, k]))
            setTimeout(() => setLiveMarketKeys((prev) => { const s = new Set(prev); s.delete(k); return s }), 1500)
          }

          if (ownerAddr === addr) {
            markLive(key)
            setMarkets((prev) => {
              const existing = prev.find((m) => `${m.market_id}::${m.market_address}` === key)
              if (existing) {
                return prev.map((m) =>
                  `${m.market_id}::${m.market_address}` === key
                    ? {
                        ...m,
                        total_fee_events: m.total_fee_events + 1,
                        total_owner_earnings_usdc: m.total_owner_earnings_usdc + ownerShare,
                        total_protocol_earnings_usdc: m.total_protocol_earnings_usdc + protoShare,
                        total_fees_collected_usdc: m.total_fees_collected_usdc + feeUsdc,
                        total_volume_usdc: m.total_volume_usdc + volume,
                        last_fee_at: ts,
                      }
                    : m
                )
              }
              return [...prev, {
                market_owner_address: ownerAddr,
                market_id: mktId,
                market_address: mktAddr,
                total_fee_events: 1,
                total_owner_earnings_usdc: ownerShare,
                total_protocol_earnings_usdc: protoShare,
                total_fees_collected_usdc: feeUsdc,
                total_volume_usdc: volume,
                first_fee_at: ts,
                last_fee_at: ts,
              }]
            })
          }

          if (protoAddr === addr) {
            markLive(`proto::${key}`)
            setProtocolMarkets((prev) => {
              const existing = prev.find((m) => `${m.market_id}::${m.market_address}` === key)
              if (existing) {
                return prev.map((m) =>
                  `${m.market_id}::${m.market_address}` === key
                    ? {
                        ...m,
                        total_fee_events: m.total_fee_events + 1,
                        total_protocol_earnings_usdc: m.total_protocol_earnings_usdc + protoShare,
                        total_owner_earnings_usdc: m.total_owner_earnings_usdc + ownerShare,
                        total_fees_collected_usdc: m.total_fees_collected_usdc + feeUsdc,
                        total_volume_usdc: m.total_volume_usdc + volume,
                        last_fee_at: ts,
                      }
                    : m
                )
              }
              return [...prev, {
                protocol_fee_recipient: protoAddr,
                market_id: mktId,
                market_address: mktAddr,
                total_fee_events: 1,
                total_protocol_earnings_usdc: protoShare,
                total_owner_earnings_usdc: ownerShare,
                total_fees_collected_usdc: feeUsdc,
                total_volume_usdc: volume,
                first_fee_at: ts,
                last_fee_at: ts,
              }]
            })
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [normalizedAddr])

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

  return { markets, protocolMarkets, totals, protocolTotals, liveMarketKeys, isMarketOwner, isProtocolRecipient, hasRevenue, isLoading, error, refetch }
}
