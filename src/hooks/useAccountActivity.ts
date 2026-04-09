'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useWallet } from '@/hooks/useWallet'

export type ActivityType = 
  | 'deposit' 
  | 'withdraw' 
  | 'trade_fee' 
  | 'trade_pnl' 
  | 'bond_lock' 
  | 'bond_release' 
  | 'collateral_lock' 
  | 'collateral_release'
  | 'liquidation'
  | 'settlement'

export interface ActivityRecord {
  id: string
  type: ActivityType
  amount: number
  timestamp: string
  marketId?: string
  marketSymbol?: string
  txHash?: string
  description?: string
  side?: 'credit' | 'debit'
  balanceAfter?: number
}

export interface TradeRecord {
  id: string
  marketId: string
  marketSymbol: string
  side: 'BUY' | 'SELL'
  price: number
  quantity: number
  notional: number
  fee: number
  feeRole: 'taker' | 'maker'
  counterparty?: string
  txHash?: string
  timestamp: string
}

export interface ActivitySummary {
  totalDeposits: number
  totalWithdrawals: number
  totalFeesPaid: number
  totalBondsLocked: number
  totalBondsReleased: number
  totalCollateralLocked: number
  totalCollateralReleased: number
  totalRealizedPnl: number
  totalUnrealizedPnl: number
  totalSettlementPnl: number
  settledPositionsCount: number
  netPnl: number
  tradesCount: number
  avgFeePerTrade: number
}

export interface DailyActivityData {
  date: string
  deposits: number
  withdrawals: number
  fees: number
  pnl: number
  bonds: number
  collateral: number
}

export interface ActivityBreakdown {
  category: string
  value: number
  percentage: number
  color: string
}

export interface UseAccountActivityOptions {
  enabled?: boolean
  limit?: number
  refreshInterval?: number
  dateRange?: {
    from: Date
    to: Date
  }
}

export interface UseAccountActivityResult {
  activities: ActivityRecord[]
  trades: TradeRecord[]
  summary: ActivitySummary
  dailyData: DailyActivityData[]
  breakdown: ActivityBreakdown[]
  feesByMarket: Array<{ market: string; fees: number; trades: number }>
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const defaultSummary: ActivitySummary = {
  totalDeposits: 0,
  totalWithdrawals: 0,
  totalFeesPaid: 0,
  totalBondsLocked: 0,
  totalBondsReleased: 0,
  totalCollateralLocked: 0,
  totalCollateralReleased: 0,
  totalRealizedPnl: 0,
  totalUnrealizedPnl: 0,
  totalSettlementPnl: 0,
  settledPositionsCount: 0,
  netPnl: 0,
  tradesCount: 0,
  avgFeePerTrade: 0,
}

export function useAccountActivity(options: UseAccountActivityOptions = {}): UseAccountActivityResult {
  const {
    enabled = true,
    limit = 100,
    refreshInterval = 30000,
    dateRange,
  } = options

  const { walletData } = useWallet() as any
  const walletAddress = walletData?.address?.toLowerCase() || null
  const isConnected = Boolean(walletData?.isConnected && walletAddress)

  const [activities, setActivities] = useState<ActivityRecord[]>([])
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [summary, setSummary] = useState<ActivitySummary>(defaultSummary)
  const [dailyData, setDailyData] = useState<DailyActivityData[]>([])
  const [feesByMarket, setFeesByMarket] = useState<Array<{ market: string; fees: number; trades: number }>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  const fetchAccountActivity = useCallback(async () => {
    if (!walletAddress || !isConnected || !enabled) {
      setActivities([])
      setTrades([])
      setSummary(defaultSummary)
      setDailyData([])
      setFeesByMarket([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const results = await Promise.allSettled([
        // [0] trading_fees - all fees for this user
        supabase
          .from('trading_fees')
          .select('*')
          .ilike('user_address', walletAddress)
          .order('created_at', { ascending: false })
          .limit(limit),
        
        // [1] vault_transactions - deposits/withdrawals
        supabase
          .from('vault_transactions')
          .select('*')
          .ilike('wallet_address', walletAddress)
          .order('created_at', { ascending: false })
          .limit(limit),
        
        // [2] user_settlements - pre-computed settlement P&L
        supabase
          .from('user_settlements')
          .select('*')
          .ilike('wallet_address', walletAddress)
          .order('settlement_timestamp', { ascending: false }),
        
        // [3] userOrderHistory - for trade side information
        supabase
          .from('userOrderHistory')
          .select('market_metric_id, side, price, quantity, tx_hash, occurred_at, event_type')
          .ilike('trader_wallet_address', walletAddress)
          .order('occurred_at', { ascending: false })
          .limit(limit * 2),
      ])

      const allActivities: ActivityRecord[] = []
      let totalFees = 0
      let totalTrades = 0
      let totalDeposits = 0
      let totalWithdrawals = 0
      let totalRealizedPnl = 0
      let totalUnrealizedPnl = 0
      let totalSettlementPnl = 0
      let settledPositionsCount = 0
      const marketFees = new Map<string, { fees: number; trades: number }>()

      // Process trading fees
      if (results[0].status === 'fulfilled' && !results[0].value.error) {
        const fees = results[0].value.data || []
        for (const fee of fees) {
          const feeAmount = Number(fee.fee_amount_usdc) || 0
          totalFees += feeAmount
          totalTrades++

          const marketSymbol = String(fee.market_symbol || fee.market_id || 'Unknown').toUpperCase()
          const existing = marketFees.get(marketSymbol) || { fees: 0, trades: 0 }
          marketFees.set(marketSymbol, {
            fees: existing.fees + feeAmount,
            trades: existing.trades + 1,
          })

          allActivities.push({
            id: `fee-${fee.id}`,
            type: 'trade_fee',
            amount: -feeAmount,
            timestamp: fee.created_at,
            marketId: fee.market_id,
            marketSymbol,
            txHash: fee.tx_hash,
            description: `${fee.fee_role === 'taker' ? 'Taker' : 'Maker'} fee for ${marketSymbol}`,
            side: 'debit',
          })
        }
      }

      // Process vault transactions (deposits, withdrawals)
      if (results[1].status === 'fulfilled' && !results[1].value.error) {
        const transactions = results[1].value.data || []
        for (const tx of transactions) {
          const amount = Number(tx.amount) || 0
          const txType = String(tx.tx_type || tx.type || '').toLowerCase()

          let activityType: ActivityType = 'deposit'
          let side: 'credit' | 'debit' = 'credit'
          let description = ''

          switch (txType) {
            case 'deposit':
              activityType = 'deposit'
              side = 'credit'
              totalDeposits += amount
              description = 'Deposited USDC'
              break
            case 'withdraw':
            case 'withdrawal':
              activityType = 'withdraw'
              side = 'debit'
              totalWithdrawals += amount
              description = 'Withdrew USDC'
              break
            case 'bond_lock':
              activityType = 'bond_lock'
              side = 'debit'
              description = 'Bond locked for market'
              break
            case 'bond_release':
              activityType = 'bond_release'
              side = 'credit'
              description = 'Bond released'
              break
            case 'collateral_lock':
              activityType = 'collateral_lock'
              side = 'debit'
              description = 'Collateral locked for position'
              break
            case 'collateral_release':
              activityType = 'collateral_release'
              side = 'credit'
              description = 'Collateral released'
              break
            case 'liquidation':
              activityType = 'liquidation'
              side = 'debit'
              description = 'Position liquidated'
              break
            case 'settlement':
              activityType = 'settlement'
              side = amount >= 0 ? 'credit' : 'debit'
              totalRealizedPnl += amount
              description = `Settlement ${amount >= 0 ? 'profit' : 'loss'}`
              break
            case 'trade_pnl':
            case 'realized_pnl':
              activityType = 'trade_pnl'
              side = amount >= 0 ? 'credit' : 'debit'
              totalRealizedPnl += amount
              description = `Realized P&L: ${amount >= 0 ? '+' : ''}${amount.toFixed(2)}`
              break
            default:
              description = tx.description || txType
          }

          allActivities.push({
            id: `vault-${tx.id}`,
            type: activityType,
            amount: side === 'credit' ? Math.abs(amount) : -Math.abs(amount),
            timestamp: tx.created_at,
            marketId: tx.market_id,
            marketSymbol: tx.market_symbol,
            txHash: tx.tx_hash,
            description,
            side,
            balanceAfter: Number(tx.balance_after) || undefined,
          })
        }
      }

      // Process settlements from user_settlements table
      if (results[2].status === 'fulfilled' && !results[2].value.error) {
        const settlements = results[2].value.data || []
        
        for (const settlement of settlements) {
          const netPnl = Number(settlement.net_pnl) || 0
          const grossPnl = Number(settlement.gross_pnl) || 0
          const quantity = Number(settlement.quantity) || 0
          const entryPrice = Number(settlement.entry_price) || 0
          const settlementPrice = Number(settlement.settlement_price) || 0
          const feesPaid = Number(settlement.fees_paid) || 0
          
          totalSettlementPnl += netPnl
          settledPositionsCount++
          totalRealizedPnl += netPnl

          const marketSymbol = settlement.market_symbol || settlement.market_identifier || 'Unknown'
          const side = settlement.side || 'LONG'

          allActivities.push({
            id: `settlement-${settlement.id}`,
            type: 'settlement',
            amount: netPnl,
            timestamp: settlement.settlement_timestamp || settlement.created_at,
            marketId: settlement.market_identifier,
            marketSymbol,
            description: `${side} ${quantity.toFixed(4)} @ $${entryPrice.toFixed(2)} → $${settlementPrice.toFixed(2)}`,
            side: netPnl >= 0 ? 'credit' : 'debit',
          })
        }
      }

      // Build trade records by combining trading_fees with order side info
      const allTrades: TradeRecord[] = []
      
      // Build a lookup map from userOrderHistory for side information
      const orderSideMap = new Map<string, 'BUY' | 'SELL'>()
      if (results[3].status === 'fulfilled' && !results[3].value.error) {
        const orders = results[3].value.data || []
        for (const order of orders) {
          if (order.side && order.tx_hash) {
            orderSideMap.set(order.tx_hash.toLowerCase(), order.side as 'BUY' | 'SELL')
          }
        }
      }
      
      // Process trading_fees into TradeRecord format
      if (results[0].status === 'fulfilled' && !results[0].value.error) {
        const fees = results[0].value.data || []
        for (const fee of fees) {
          const txHash = fee.tx_hash?.toLowerCase() || ''
          const side = orderSideMap.get(txHash) || 'BUY' // Default to BUY if unknown
          
          allTrades.push({
            id: `trade-${fee.id}`,
            marketId: fee.market_id || '',
            marketSymbol: String(fee.market_symbol || fee.market_id || 'Unknown').toUpperCase(),
            side,
            price: Number(fee.trade_price) || 0,
            quantity: Number(fee.trade_amount) || 0,
            notional: Number(fee.trade_notional) || (Number(fee.trade_price) * Number(fee.trade_amount)) || 0,
            fee: Number(fee.fee_amount_usdc) || 0,
            feeRole: fee.fee_role === 'maker' ? 'maker' : 'taker',
            counterparty: fee.counterparty_address,
            txHash: fee.tx_hash,
            timestamp: fee.created_at,
          })
        }
      }
      
      // Sort trades by timestamp (newest first)
      allTrades.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )

      // Sort activities by timestamp
      allActivities.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )

      // Calculate daily aggregates for charts
      const dailyAggregates = new Map<string, DailyActivityData>()
      for (const activity of allActivities) {
        const date = new Date(activity.timestamp).toISOString().split('T')[0]
        const existing = dailyAggregates.get(date) || {
          date,
          deposits: 0,
          withdrawals: 0,
          fees: 0,
          pnl: 0,
          bonds: 0,
          collateral: 0,
        }

        switch (activity.type) {
          case 'deposit':
            existing.deposits += Math.abs(activity.amount)
            break
          case 'withdraw':
            existing.withdrawals += Math.abs(activity.amount)
            break
          case 'trade_fee':
            existing.fees += Math.abs(activity.amount)
            break
          case 'trade_pnl':
          case 'settlement':
            existing.pnl += activity.amount
            break
          case 'bond_lock':
          case 'bond_release':
            existing.bonds += activity.amount
            break
          case 'collateral_lock':
          case 'collateral_release':
            existing.collateral += activity.amount
            break
        }

        dailyAggregates.set(date, existing)
      }

      const sortedDailyData = Array.from(dailyAggregates.values())
        .sort((a, b) => a.date.localeCompare(b.date))

      const netPnl = totalRealizedPnl + totalUnrealizedPnl

      setActivities(allActivities.slice(0, limit))
      setTrades(allTrades.slice(0, limit))
      setSummary({
        totalDeposits,
        totalWithdrawals,
        totalFeesPaid: totalFees,
        totalBondsLocked: 0,
        totalBondsReleased: 0,
        totalCollateralLocked: 0,
        totalCollateralReleased: 0,
        totalRealizedPnl,
        totalUnrealizedPnl,
        totalSettlementPnl,
        settledPositionsCount,
        netPnl,
        tradesCount: totalTrades,
        avgFeePerTrade: totalTrades > 0 ? totalFees / totalTrades : 0,
      })
      setDailyData(sortedDailyData)
      setFeesByMarket(
        Array.from(marketFees.entries())
          .map(([market, data]) => ({ market, ...data }))
          .sort((a, b) => b.fees - a.fees)
      )

    } catch (e: any) {
      console.error('Error fetching account activity:', e)
      setError(e?.message || 'Failed to load account activity')
    } finally {
      setIsLoading(false)
    }
  }, [walletAddress, isConnected, enabled, limit])

  useEffect(() => {
    fetchAccountActivity()
  }, [fetchAccountActivity, tick])

  useEffect(() => {
    if (!enabled || !isConnected || refreshInterval <= 0) return

    const interval = setInterval(fetchAccountActivity, refreshInterval)
    return () => clearInterval(interval)
  }, [enabled, isConnected, refreshInterval, fetchAccountActivity])

  const breakdown = useMemo<ActivityBreakdown[]>(() => {
    const total = Math.abs(summary.totalFeesPaid) + 
                  Math.abs(summary.totalDeposits) + 
                  Math.abs(summary.totalWithdrawals) +
                  Math.abs(summary.totalRealizedPnl)

    if (total === 0) return []

    const items: ActivityBreakdown[] = []
    
    if (summary.totalFeesPaid > 0) {
      items.push({
        category: 'Fees',
        value: summary.totalFeesPaid,
        percentage: (summary.totalFeesPaid / total) * 100,
        color: '#fb5c60',
      })
    }

    if (summary.totalDeposits > 0) {
      items.push({
        category: 'Deposits',
        value: summary.totalDeposits,
        percentage: (summary.totalDeposits / total) * 100,
        color: '#75bb75',
      })
    }

    if (summary.totalWithdrawals > 0) {
      items.push({
        category: 'Withdrawals',
        value: summary.totalWithdrawals,
        percentage: (summary.totalWithdrawals / total) * 100,
        color: '#9CA3AF',
      })
    }

    if (Math.abs(summary.totalRealizedPnl) > 0) {
      items.push({
        category: 'Realized P&L',
        value: Math.abs(summary.totalRealizedPnl),
        percentage: (Math.abs(summary.totalRealizedPnl) / total) * 100,
        color: summary.totalRealizedPnl >= 0 ? '#22c55e' : '#ef4444',
      })
    }

    return items.sort((a, b) => b.value - a.value)
  }, [summary])

  return {
    activities,
    trades,
    summary,
    dailyData,
    breakdown,
    feesByMarket,
    isLoading,
    error,
    refetch,
  }
}
