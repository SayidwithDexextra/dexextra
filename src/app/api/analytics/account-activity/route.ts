import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

interface ActivityRecord {
  id: string
  type: string
  amount: number
  timestamp: string
  marketId?: string
  marketSymbol?: string
  txHash?: string
  description?: string
  side?: 'credit' | 'debit'
}

interface DailyAggregate {
  date: string
  deposits: number
  withdrawals: number
  fees: number
  pnl: number
  bonds: number
  collateral: number
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const walletAddress = searchParams.get('wallet')?.toLowerCase()
  const limit = Math.min(Number(searchParams.get('limit')) || 100, 500)
  const fromDate = searchParams.get('from')
  const toDate = searchParams.get('to')

  if (!walletAddress) {
    return NextResponse.json(
      { success: false, error: 'Wallet address is required' },
      { status: 400 }
    )
  }

  try {
    const supabase = createServerSupabase()
    const allActivities: ActivityRecord[] = []
    let totalFees = 0
    let totalTrades = 0
    let totalDeposits = 0
    let totalWithdrawals = 0
    let totalRealizedPnl = 0
    let totalUnrealizedPnl = 0
    const marketFees = new Map<string, { fees: number; trades: number }>()

    const queries: Promise<any>[] = []

    // Query trading fees
    let feesQuery = supabase
      .from('trading_fees')
      .select('*')
      .eq('user_address', walletAddress)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (fromDate) feesQuery = feesQuery.gte('created_at', fromDate)
    if (toDate) feesQuery = feesQuery.lte('created_at', toDate)
    queries.push(feesQuery)

    // Query vault transactions
    let vaultQuery = supabase
      .from('vault_transactions')
      .select('*')
      .eq('user_address', walletAddress)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (fromDate) vaultQuery = vaultQuery.gte('created_at', fromDate)
    if (toDate) vaultQuery = vaultQuery.lte('created_at', toDate)
    queries.push(vaultQuery)

    // Query fee summary
    queries.push(
      supabase
        .from('user_fee_summary')
        .select('*')
        .eq('user_address', walletAddress)
    )

    // Query positions for P&L
    queries.push(
      supabase
        .from('positions')
        .select('market_id, symbol, pnl, realized_pnl')
        .eq('user_address', walletAddress)
    )

    const results = await Promise.allSettled(queries)

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

    // Process vault transactions
    if (results[1].status === 'fulfilled' && !results[1].value.error) {
      const transactions = results[1].value.data || []
      for (const tx of transactions) {
        const amount = Number(tx.amount) || 0
        const txType = String(tx.type || '').toLowerCase()

        let activityType = 'deposit'
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
        })
      }
    }

    // Process positions for unrealized P&L
    if (results[3].status === 'fulfilled' && !results[3].value.error) {
      const positions = results[3].value.data || []
      for (const pos of positions) {
        totalUnrealizedPnl += Number(pos.pnl) || 0
        totalRealizedPnl += Number(pos.realized_pnl) || 0
      }
    }

    // Sort by timestamp
    allActivities.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    // Calculate daily aggregates
    const dailyAggregates = new Map<string, DailyAggregate>()
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

    const dailyData = Array.from(dailyAggregates.values())
      .sort((a, b) => a.date.localeCompare(b.date))

    const netPnl = totalRealizedPnl + totalUnrealizedPnl

    const summary = {
      totalDeposits,
      totalWithdrawals,
      totalFeesPaid: totalFees,
      totalBondsLocked: 0,
      totalBondsReleased: 0,
      totalCollateralLocked: 0,
      totalCollateralReleased: 0,
      totalRealizedPnl,
      totalUnrealizedPnl,
      netPnl,
      tradesCount: totalTrades,
      avgFeePerTrade: totalTrades > 0 ? totalFees / totalTrades : 0,
    }

    const feesByMarket = Array.from(marketFees.entries())
      .map(([market, data]) => ({ market, ...data }))
      .sort((a, b) => b.fees - a.fees)

    return NextResponse.json({
      success: true,
      data: {
        activities: allActivities.slice(0, limit),
        summary,
        dailyData,
        feesByMarket,
      },
    })

  } catch (error: any) {
    console.error('Error fetching account activity:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch account activity' },
      { status: 500 }
    )
  }
}
