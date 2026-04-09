'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { ethers } from 'ethers'
import { supabase } from '@/lib/supabase'
import { useWallet } from '@/hooks/useWallet'
import { getRpcUrl, getChainId } from '@/lib/network'
import { OBTradeExecutionFacetABI } from '@/lib/contracts'

export interface OnChainTrade {
  tradeId: string
  marketAddress: string
  marketSymbol: string
  marketId: string
  buyer: string
  seller: string
  price: number
  quantity: number
  timestamp: Date
  buyOrderId: string
  sellOrderId: string
  buyerIsMargin: boolean
  sellerIsMargin: boolean
  tradeValue: number
  buyerFee: number
  sellerFee: number
  side: 'BUY' | 'SELL'
  fee: number
}

export interface DailyPnlData {
  date: string
  pnl: number
  fees: number
  trades: number
  volume: number
  buys: number
  sells: number
}

export interface TradeSummary {
  totalTrades: number
  totalVolume: number
  totalFees: number
  buyCount: number
  sellCount: number
  avgTradeSize: number
}

export interface UseOnChainTradesResult {
  trades: OnChainTrade[]
  uniqueMarkets: Array<{ marketId: string; marketAddress: string; symbol: string }>
  dailyPnl: DailyPnlData[]
  summary: TradeSummary
  isLoading: boolean
  error: string | null
  refetch: () => void
  progress: { current: number; total: number }
}

export function useOnChainTrades(): UseOnChainTradesResult {
  const { walletData } = useWallet() as any
  // Use lowercase like useAccountActivity does
  const walletAddress = walletData?.address?.toLowerCase() || null
  const isConnected = Boolean(walletData?.isConnected && walletAddress)

  const [trades, setTrades] = useState<OnChainTrade[]>([])
  const [uniqueMarkets, setUniqueMarkets] = useState<Array<{ marketId: string; marketAddress: string; symbol: string }>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  const fetchTrades = useCallback(async () => {
    if (!walletAddress || !isConnected) {
      setTrades([])
      setUniqueMarkets([])
      return
    }

    setIsLoading(true)
    setError(null)
    setProgress({ current: 0, total: 0 })

    try {
      // Step 1: Query userOrderHistory to find markets where user has submitted orders
      const { data: orderHistory, error: orderError } = await supabase
        .from('userOrderHistory')
        .select('market_metric_id')
        .ilike('trader_wallet_address', walletAddress)

      if (orderError) {
        console.error('[useOnChainTrades] Error fetching userOrderHistory:', orderError)
      }

      // Extract unique market IDs from all submitted orders
      let uniqueMarketIds = [...new Set(
        (orderHistory || []).map(o => o.market_metric_id).filter(Boolean)
      )]

      // Also check trading_fees for any additional markets
      const { data: tradingFees, error: feesError } = await supabase
        .from('trading_fees')
        .select('market_id')
        .ilike('user_address', walletAddress)

      if (!feesError && tradingFees) {
        const feeMarketIds = tradingFees.map(f => f.market_id).filter(Boolean)
        uniqueMarketIds = [...new Set([...uniqueMarketIds, ...feeMarketIds])]
      }

      if (uniqueMarketIds.length === 0) {
        setTrades([])
        setUniqueMarkets([])
        setIsLoading(false)
        return
      }

      // Step 2: Get market addresses and symbols from the markets table
      const { data: markets, error: marketsError } = await supabase
        .from('markets')
        .select('market_identifier, market_address, symbol')
        .in('market_identifier', uniqueMarketIds)

      if (marketsError) {
        console.error('[useOnChainTrades] Error fetching markets:', marketsError)
        throw marketsError
      }

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

      setUniqueMarkets(marketsWithAddresses)
      setProgress({ current: 0, total: marketsWithAddresses.length })

      if (marketsWithAddresses.length === 0) {
        setTrades([])
        setIsLoading(false)
        return
      }

      // Step 3: Query each market's smart contract for user trades
      const provider = new ethers.JsonRpcProvider(getRpcUrl(), getChainId())
      const allTrades: OnChainTrade[] = []

      for (let i = 0; i < marketsWithAddresses.length; i++) {
        const market = marketsWithAddresses[i]
        setProgress({ current: i + 1, total: marketsWithAddresses.length })

        try {
          const contract = new ethers.Contract(
            market.marketAddress,
            OBTradeExecutionFacetABI,
            provider
          )

          // Get user's trade count first
          let tradeCount = 0
          try {
            tradeCount = Number(await contract.getUserTradeCount(walletAddress))
          } catch (e: any) {
            // Contract may not support getUserTradeCount, skip this market
            continue
          }

          if (tradeCount === 0) continue

          // Fetch trades in batches
          const batchSize = 50
          let offset = 0

          while (offset < tradeCount) {
            try {
              const result = await contract.getUserTrades(walletAddress, offset, batchSize)
              const tradeData = result[0] || result.tradeData || result
              const hasMore = result[1] ?? result.hasMore ?? (offset + batchSize < tradeCount)

              if (!tradeData || !Array.isArray(tradeData)) {
                console.warn(`[useOnChainTrades] Invalid tradeData for ${market.symbol}`)
                break
              }

              for (const trade of tradeData) {
                const walletLower = walletAddress.toLowerCase()
                const isBuyer = trade.buyer.toLowerCase() === walletLower

                // Price uses 6 decimals, quantity/amount uses 18 decimals
                const price = Number(ethers.formatUnits(trade.price, 6))
                const quantity = Number(ethers.formatUnits(trade.amount, 18))
                const tradeValue = Number(ethers.formatUnits(trade.tradeValue, 6))
                const buyerFee = Number(ethers.formatUnits(trade.buyerFee, 6))
                const sellerFee = Number(ethers.formatUnits(trade.sellerFee, 6))

                allTrades.push({
                  tradeId: `${market.marketAddress}-${trade.tradeId.toString()}`,
                  marketAddress: market.marketAddress,
                  marketSymbol: market.symbol,
                  marketId: market.marketId,
                  buyer: trade.buyer,
                  seller: trade.seller,
                  price,
                  quantity,
                  timestamp: new Date(Number(trade.timestamp) * 1000),
                  buyOrderId: trade.buyOrderId.toString(),
                  sellOrderId: trade.sellOrderId.toString(),
                  buyerIsMargin: trade.buyerIsMargin,
                  sellerIsMargin: trade.sellerIsMargin,
                  tradeValue,
                  buyerFee,
                  sellerFee,
                  side: isBuyer ? 'BUY' : 'SELL',
                  fee: isBuyer ? buyerFee : sellerFee,
                })
              }

              if (!hasMore) break
              offset += batchSize
            } catch (e: any) {
              console.error(`[useOnChainTrades] Error fetching trades batch for ${market.symbol}:`, e?.message || e)
              break
            }
          }
        } catch (e: any) {
          console.error(`[useOnChainTrades] Error querying market ${market.symbol}:`, e?.message || e)
        }
      }

      console.log(`[useOnChainTrades] Total on-chain trades found: ${allTrades.length}`)

      // If no on-chain trades found, fall back to trading_fees
      if (allTrades.length === 0) {
        console.log('[useOnChainTrades] No on-chain trades, falling back to trading_fees...')
        
        const { data: allFees, error: allFeesError } = await supabase
          .from('trading_fees')
          .select('*')
          .ilike('user_address', walletAddress)
          .order('created_at', { ascending: false })
          .limit(500)

        if (!allFeesError && allFees && allFees.length > 0) {
          const fallbackTrades: OnChainTrade[] = allFees.map((fee, idx) => {
            const marketInfo = marketMap.get(fee.market_id) || { address: '', symbol: fee.market_symbol || fee.market_id || 'Unknown' }
            const isMaker = fee.fee_role === 'maker'
            
            return {
              tradeId: `fee-${fee.id || idx}`,
              marketAddress: marketInfo.address,
              marketSymbol: marketInfo.symbol,
              marketId: fee.market_id || '',
              buyer: isMaker ? fee.counterparty_address || '' : fee.user_address || '',
              seller: isMaker ? fee.user_address || '' : fee.counterparty_address || '',
              price: Number(fee.trade_price) || 0,
              quantity: Number(fee.trade_amount) || 0,
              timestamp: new Date(fee.created_at),
              buyOrderId: '',
              sellOrderId: '',
              buyerIsMargin: false,
              sellerIsMargin: false,
              tradeValue: Number(fee.trade_notional) || (Number(fee.trade_price) * Number(fee.trade_amount)) || 0,
              buyerFee: isMaker ? 0 : Number(fee.fee_amount_usdc) || 0,
              sellerFee: isMaker ? Number(fee.fee_amount_usdc) || 0 : 0,
              side: fee.fee_role === 'taker' ? 'BUY' : 'SELL',
              fee: Number(fee.fee_amount_usdc) || 0,
            }
          })

          setTrades(fallbackTrades)
          setIsLoading(false)
          return
        }
      }

      // Sort by timestamp (newest first)
      allTrades.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      setTrades(allTrades)

    } catch (e: any) {
      console.error('[useOnChainTrades] Error:', e)
      setError(e?.message || 'Failed to fetch trades')
    } finally {
      setIsLoading(false)
    }
  }, [walletAddress, isConnected])

  useEffect(() => {
    fetchTrades()
  }, [fetchTrades, tick])

  // Calculate daily P&L from trades
  // For each day: sum of (sell value - buy value - fees)
  const dailyPnl = useMemo<DailyPnlData[]>(() => {
    if (trades.length === 0) return []

    const dailyMap = new Map<string, DailyPnlData>()

    for (const trade of trades) {
      const date = trade.timestamp.toISOString().split('T')[0]
      const existing = dailyMap.get(date) || {
        date,
        pnl: 0,
        fees: 0,
        trades: 0,
        volume: 0,
        buys: 0,
        sells: 0,
      }

      // P&L calculation:
      // - SELL: you receive tradeValue (positive)
      // - BUY: you pay tradeValue (negative)
      // - Fee is always subtracted
      const tradePnl = trade.side === 'SELL' ? trade.tradeValue : -trade.tradeValue
      
      existing.pnl += tradePnl - trade.fee
      existing.fees += trade.fee
      existing.trades += 1
      existing.volume += trade.tradeValue
      if (trade.side === 'BUY') {
        existing.buys += 1
      } else {
        existing.sells += 1
      }

      dailyMap.set(date, existing)
    }

    // Sort by date ascending for cumulative chart
    return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [trades])

  // Calculate summary statistics
  const summary = useMemo<TradeSummary>(() => {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        totalVolume: 0,
        totalFees: 0,
        buyCount: 0,
        sellCount: 0,
        avgTradeSize: 0,
      }
    }

    const totalVolume = trades.reduce((sum, t) => sum + t.tradeValue, 0)
    const totalFees = trades.reduce((sum, t) => sum + t.fee, 0)
    const buyCount = trades.filter(t => t.side === 'BUY').length
    const sellCount = trades.filter(t => t.side === 'SELL').length

    return {
      totalTrades: trades.length,
      totalVolume,
      totalFees,
      buyCount,
      sellCount,
      avgTradeSize: totalVolume / trades.length,
    }
  }, [trades])

  return {
    trades,
    uniqueMarkets,
    dailyPnl,
    summary,
    isLoading,
    error,
    refetch,
    progress,
  }
}
