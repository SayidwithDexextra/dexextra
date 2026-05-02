'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ethers } from 'ethers'
import { supabase } from '@/lib/supabase'
import { getRpcUrl, getChainId } from '@/lib/network'
import { OBTradeExecutionFacetABI } from '@/lib/contracts'

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
  // Gas fee fields
  gas_fee_events: number
  gas_fees_usdc: number
  total_volume_usdc: number
  first_trade_at: string | null
  last_trade_at: string | null
}

export type FeeRole = 'taker' | 'maker' | 'gas_fee' | 'gas_fee_maker' | 'gas_fee_taker'

export interface FeeDetailRow {
  id: number
  market_id: string
  market_address: string
  trade_id: number
  user_address: string
  fee_role: FeeRole
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
  // Trading fees
  totalFeesUsdc: number
  takerFeesUsdc: number
  makerFeesUsdc: number
  totalTrades: number
  takerTrades: number
  makerTrades: number
  totalVolumeUsdc: number
  // Gas fees
  gasFeesUsdc: number
  gasFeeEvents: number
  gasFeesMakerUsdc: number
  gasFeesTakerUsdc: number
  // Combined total
  grandTotalFeesUsdc: number
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
  /** True if fees were loaded from on-chain data */
  isOnChain: boolean
}

function isGasFeeRole(role: string): boolean {
  return role === 'gas_fee' || role === 'gas_fee_maker' || role === 'gas_fee_taker'
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

interface OnChainTrade {
  tradeId: string
  marketAddress: string
  marketSymbol: string
  marketId: string
  buyer: string
  seller: string
  price: number
  quantity: number
  timestamp: Date
  tradeValue: number
  buyerFee: number
  sellerFee: number
  side: 'BUY' | 'SELL'
  fee: number
}

async function fetchOnChainFees(
  walletAddress: string,
  recentLimit: number
): Promise<{ summary: FeeSummaryRow[]; recentFees: FeeDetailRow[] }> {
  const provider = new ethers.JsonRpcProvider(getRpcUrl(), getChainId())
  
  // Get markets from userOrderHistory and trading_fees
  const { data: orderHistory } = await supabase
    .from('userOrderHistory')
    .select('market_metric_id')
    .ilike('trader_wallet_address', walletAddress)

  let uniqueMarketIds = [...new Set(
    (orderHistory || []).map(o => o.market_metric_id).filter(Boolean)
  )]

  // Also check trading_fees for any additional markets
  const { data: tradingFees } = await supabase
    .from('trading_fees')
    .select('market_id')
    .ilike('user_address', walletAddress)

  if (tradingFees) {
    const feeMarketIds = tradingFees.map(f => f.market_id).filter(Boolean)
    uniqueMarketIds = [...new Set([...uniqueMarketIds, ...feeMarketIds])]
  }

  if (uniqueMarketIds.length === 0) {
    return { summary: [], recentFees: [] }
  }

  // Get market addresses and symbols from the markets table
  const { data: markets } = await supabase
    .from('markets')
    .select('market_identifier, market_address, symbol')
    .in('market_identifier', uniqueMarketIds)

  const marketMap = new Map<string, { address: string; symbol: string }>()
  for (const market of (markets || [])) {
    if (market.market_address) {
      marketMap.set(market.market_identifier, {
        address: market.market_address,
        symbol: market.symbol || market.market_identifier,
      })
    }
  }

  const marketsWithAddresses = uniqueMarketIds
    .filter(id => marketMap.has(id))
    .map(id => ({
      marketId: id,
      marketAddress: marketMap.get(id)!.address,
      symbol: marketMap.get(id)!.symbol,
    }))

  if (marketsWithAddresses.length === 0) {
    return { summary: [], recentFees: [] }
  }

  const allTrades: OnChainTrade[] = []
  const summaryByMarket = new Map<string, FeeSummaryRow>()

  for (const market of marketsWithAddresses) {
    try {
      const contract = new ethers.Contract(
        market.marketAddress,
        OBTradeExecutionFacetABI,
        provider
      )

      let tradeCount = 0
      try {
        tradeCount = Number(await contract.getUserTradeCount(walletAddress))
      } catch {
        continue
      }

      if (tradeCount === 0) continue

      const batchSize = 50
      let offset = 0
      let firstTradeAt: string | null = null
      let lastTradeAt: string | null = null

      while (offset < tradeCount) {
        try {
          const result = await contract.getUserTrades(walletAddress, offset, batchSize)
          const tradeData = result[0] || result.tradeData || result
          const hasMore = result[1] ?? result.hasMore ?? (offset + batchSize < tradeCount)

          if (!tradeData || !Array.isArray(tradeData)) break

          for (const trade of tradeData) {
            const walletLower = walletAddress.toLowerCase()
            const isBuyer = trade.buyer.toLowerCase() === walletLower

            const price = Number(ethers.formatUnits(trade.price, 6))
            const quantity = Number(ethers.formatUnits(trade.amount, 18))
            const tradeValue = Number(ethers.formatUnits(trade.tradeValue, 6))
            const buyerFee = Number(ethers.formatUnits(trade.buyerFee, 6))
            const sellerFee = Number(ethers.formatUnits(trade.sellerFee, 6))
            const timestamp = new Date(Number(trade.timestamp) * 1000)
            const timestampStr = timestamp.toISOString()

            if (!firstTradeAt || timestampStr < firstTradeAt) firstTradeAt = timestampStr
            if (!lastTradeAt || timestampStr > lastTradeAt) lastTradeAt = timestampStr

            const userFee = isBuyer ? buyerFee : sellerFee
            const counterpartyFee = isBuyer ? sellerFee : buyerFee
            
            // Determine role based on fee comparison (higher fee = taker)
            const isTaker = userFee > counterpartyFee || (userFee === counterpartyFee && isBuyer)

            allTrades.push({
              tradeId: `${market.marketAddress}-${trade.tradeId.toString()}`,
              marketAddress: market.marketAddress,
              marketSymbol: market.symbol,
              marketId: market.marketId,
              buyer: trade.buyer,
              seller: trade.seller,
              price,
              quantity,
              timestamp,
              tradeValue,
              buyerFee,
              sellerFee,
              side: isBuyer ? 'BUY' : 'SELL',
              fee: userFee,
            })

            // Update summary
            const key = `${market.marketId}::${market.marketAddress}`
            let summaryRow = summaryByMarket.get(key)
            if (!summaryRow) {
              summaryRow = {
                user_address: walletAddress.toLowerCase(),
                market_id: market.marketId,
                market_address: market.marketAddress,
                total_trades: 0,
                taker_trades: 0,
                maker_trades: 0,
                total_fees_usdc: 0,
                taker_fees_usdc: 0,
                maker_fees_usdc: 0,
                gas_fee_events: 0,
                gas_fees_usdc: 0,
                total_volume_usdc: 0,
                first_trade_at: null,
                last_trade_at: null,
              }
              summaryByMarket.set(key, summaryRow)
            }

            summaryRow.total_trades++
            summaryRow.total_fees_usdc += userFee
            summaryRow.total_volume_usdc += tradeValue
            
            if (isTaker) {
              summaryRow.taker_trades++
              summaryRow.taker_fees_usdc += userFee
            } else {
              summaryRow.maker_trades++
              summaryRow.maker_fees_usdc += userFee
            }

            summaryRow.first_trade_at = firstTradeAt
            summaryRow.last_trade_at = lastTradeAt
          }

          if (!hasMore) break
          offset += batchSize
        } catch (e: any) {
          console.error(`[useUserFees] Error fetching trades batch for ${market.symbol}:`, e?.message)
          break
        }
      }
    } catch (e: any) {
      console.error(`[useUserFees] Error querying market ${market.symbol}:`, e?.message)
    }
  }

  // Sort trades by timestamp (newest first)
  allTrades.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

  // Convert trades to FeeDetailRow format
  const recentFees: FeeDetailRow[] = allTrades.slice(0, recentLimit).map((trade, idx) => {
    const isTaker = trade.fee > 0 && trade.side === 'BUY' // simplified heuristic
    return {
      id: idx + 1,
      market_id: trade.marketId,
      market_address: trade.marketAddress,
      trade_id: parseInt(trade.tradeId.split('-')[1] || '0'),
      user_address: trade.side === 'BUY' ? trade.buyer.toLowerCase() : trade.seller.toLowerCase(),
      fee_role: (trade.buyerFee > trade.sellerFee) === (trade.side === 'BUY') ? 'taker' : 'maker',
      fee_amount_usdc: trade.fee,
      protocol_share: trade.fee * 0.8,
      owner_share: trade.fee * 0.2,
      trade_price: trade.price,
      trade_amount: trade.quantity,
      trade_notional: trade.tradeValue,
      counterparty_address: trade.side === 'BUY' ? trade.seller : trade.buyer,
      tx_hash: null,
      block_number: null,
      created_at: trade.timestamp.toISOString(),
    }
  })

  return {
    summary: Array.from(summaryByMarket.values()),
    recentFees,
  }
}

let _userFeesChannelCounter = 0

export function useUserFees(walletAddress: string | null, opts?: { recentLimit?: number; disableRealtime?: boolean }): UseUserFeesResult {
  const recentLimit = opts?.recentLimit ?? 20
  const disableRealtime = opts?.disableRealtime ?? false
  const channelIdRef = useRef(`user_fees_${++_userFeesChannelCounter}_${Date.now()}`)
  const [summary, setSummary] = useState<FeeSummaryRow[]>([])
  const [recentFees, setRecentFees] = useState<FeeDetailRow[]>([])
  const [liveIds, setLiveIds] = useState<Set<number>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isOnChain, setIsOnChain] = useState(false)
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
      setIsOnChain(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    ;(async () => {
      try {
        // First try database
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

        // Check if database has data
        const dbSummary = summaryRes.data || []
        const dbFees = detailRes.data || []
        const hasDbData = dbSummary.length > 0 || dbFees.length > 0

        if (hasDbData) {
          // Use database data
          setIsOnChain(false)
          setSummary(
            dbSummary.map((r: any) => ({
              ...r,
              total_trades: Number(r.total_trades) || 0,
              taker_trades: Number(r.taker_trades) || 0,
              maker_trades: Number(r.maker_trades) || 0,
              total_fees_usdc: Number(r.total_fees_usdc) || 0,
              taker_fees_usdc: Number(r.taker_fees_usdc) || 0,
              maker_fees_usdc: Number(r.maker_fees_usdc) || 0,
              gas_fee_events: Number(r.gas_fee_events) || 0,
              gas_fees_usdc: Number(r.gas_fees_usdc) || 0,
              total_volume_usdc: Number(r.total_volume_usdc) || 0,
            }))
          )
          setRecentFees(dbFees.map(parseFeeDetail))
        } else {
          // Fall back to on-chain data
          console.log('[useUserFees] No database data, fetching from on-chain...')
          const onChainData = await fetchOnChainFees(normalizedAddr, recentLimit)
          
          if (cancelled) return
          
          setIsOnChain(true)
          setSummary(onChainData.summary)
          setRecentFees(onChainData.recentFees)
          
          console.log(`[useUserFees] Loaded ${onChainData.summary.length} market summaries, ${onChainData.recentFees.length} recent fees from on-chain`)
        }
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
    if (!normalizedAddr || disableRealtime) return

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
            const isGasFee = isGasFeeRole(row.fee_role)
            const isTaker = row.fee_role === 'taker'
            const isMaker = row.fee_role === 'maker'
            const key = `${row.market_id}::${row.market_address}`
            const existing = prev.find(
              (s) => `${s.market_id}::${s.market_address}` === key
            )
            if (existing) {
              return prev.map((s) =>
                `${s.market_id}::${s.market_address}` === key
                  ? {
                      ...s,
                      total_trades: s.total_trades + (isGasFee ? 0 : 1),
                      taker_trades: s.taker_trades + (isTaker ? 1 : 0),
                      maker_trades: s.maker_trades + (isMaker ? 1 : 0),
                      total_fees_usdc: s.total_fees_usdc + (isGasFee ? 0 : row.fee_amount_usdc),
                      taker_fees_usdc: s.taker_fees_usdc + (isTaker ? row.fee_amount_usdc : 0),
                      maker_fees_usdc: s.maker_fees_usdc + (isMaker ? row.fee_amount_usdc : 0),
                      gas_fee_events: s.gas_fee_events + (isGasFee ? 1 : 0),
                      gas_fees_usdc: s.gas_fees_usdc + (isGasFee ? row.fee_amount_usdc : 0),
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
                total_trades: isGasFee ? 0 : 1,
                taker_trades: isTaker ? 1 : 0,
                maker_trades: isMaker ? 1 : 0,
                total_fees_usdc: isGasFee ? 0 : row.fee_amount_usdc,
                taker_fees_usdc: isTaker ? row.fee_amount_usdc : 0,
                maker_fees_usdc: isMaker ? 0 : row.fee_amount_usdc,
                gas_fee_events: isGasFee ? 1 : 0,
                gas_fees_usdc: isGasFee ? row.fee_amount_usdc : 0,
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
  }, [normalizedAddr, disableRealtime])

  const totals = useMemo<UserFeeTotals>(() => {
    if (summary.length === 0)
      return { 
        totalFeesUsdc: 0, takerFeesUsdc: 0, makerFeesUsdc: 0, 
        totalTrades: 0, takerTrades: 0, makerTrades: 0, 
        totalVolumeUsdc: 0,
        gasFeesUsdc: 0, gasFeeEvents: 0, gasFeesMakerUsdc: 0, gasFeesTakerUsdc: 0,
        grandTotalFeesUsdc: 0
      }

    const base = summary.reduce<UserFeeTotals>(
      (acc, r) => ({
        totalFeesUsdc: acc.totalFeesUsdc + r.total_fees_usdc,
        takerFeesUsdc: acc.takerFeesUsdc + r.taker_fees_usdc,
        makerFeesUsdc: acc.makerFeesUsdc + r.maker_fees_usdc,
        totalTrades: acc.totalTrades + r.total_trades,
        takerTrades: acc.takerTrades + r.taker_trades,
        makerTrades: acc.makerTrades + r.maker_trades,
        totalVolumeUsdc: acc.totalVolumeUsdc + r.total_volume_usdc,
        gasFeesUsdc: acc.gasFeesUsdc + r.gas_fees_usdc,
        gasFeeEvents: acc.gasFeeEvents + r.gas_fee_events,
        gasFeesMakerUsdc: 0, // Will compute from recentFees if needed
        gasFeesTakerUsdc: 0, // Will compute from recentFees if needed
        grandTotalFeesUsdc: 0,
      }),
      { 
        totalFeesUsdc: 0, takerFeesUsdc: 0, makerFeesUsdc: 0, 
        totalTrades: 0, takerTrades: 0, makerTrades: 0, 
        totalVolumeUsdc: 0,
        gasFeesUsdc: 0, gasFeeEvents: 0, gasFeesMakerUsdc: 0, gasFeesTakerUsdc: 0,
        grandTotalFeesUsdc: 0
      }
    )
    
    // Compute gas fee breakdown from recent fees (approximate)
    for (const fee of recentFees) {
      if (fee.fee_role === 'gas_fee_maker') {
        base.gasFeesMakerUsdc += fee.fee_amount_usdc
      } else if (fee.fee_role === 'gas_fee_taker') {
        base.gasFeesTakerUsdc += fee.fee_amount_usdc
      }
    }
    
    base.grandTotalFeesUsdc = base.totalFeesUsdc + base.gasFeesUsdc
    
    return base
  }, [summary, recentFees])

  return { summary, recentFees, totals, liveIds, isLoading, error, refetch, isOnChain }
}
