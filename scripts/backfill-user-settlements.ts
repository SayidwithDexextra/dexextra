/**
 * Backfill script to calculate and insert settlement P&L for all users
 * in all settled markets.
 * 
 * Logic:
 * 1. Get all settled markets
 * 2. For each settled market, get all trades (from trading_fees)
 * 3. Group trades by user
 * 4. For each user, match with their orders (from userOrderHistory) to determine buy/sell side
 * 5. Calculate net position using FIFO
 * 6. Compute settlement P&L
 * 7. Insert into user_settlements table
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

interface Trade {
  id: number
  market_id: string
  user_address: string
  fee_role: string
  fee_amount_usdc: string
  trade_price: string
  trade_amount: string
  tx_hash: string | null
  created_at: string
}

interface Order {
  trader_wallet_address: string
  market_metric_id: string
  side: 'BUY' | 'SELL'
  price: string
  quantity: string
}

interface SettledMarket {
  id: string
  market_identifier: string
  symbol: string
  settlement_value: string
  settlement_timestamp: string
}

interface OpenLot {
  isBuy: boolean
  price: number
  remaining: number
}

async function backfillSettlements() {
  console.log('Starting settlement backfill...')
  console.log('Supabase URL:', supabaseUrl)

  // 1. Get all settled markets
  const { data: settledMarkets, error: marketsError } = await supabase
    .from('markets')
    .select('id, market_identifier, symbol, settlement_value, settlement_timestamp')
    .eq('market_status', 'SETTLED')
    .not('settlement_value', 'is', null)

  if (marketsError) {
    console.error('Error fetching settled markets:', marketsError)
    return
  }

  console.log(`Found ${settledMarkets?.length || 0} settled markets with settlement values`)

  // 2. Get all trades for settled markets
  const marketIds = settledMarkets?.map(m => m.market_identifier) || []
  
  const { data: allTrades, error: tradesError } = await supabase
    .from('trading_fees')
    .select('*')
    .in('market_id', marketIds)
    .order('created_at', { ascending: true })

  if (tradesError) {
    console.error('Error fetching trades:', tradesError)
    return
  }

  console.log(`Found ${allTrades?.length || 0} trades in settled markets`)

  // 3. Get all user orders for reference
  const { data: allOrders, error: ordersError } = await supabase
    .from('userOrderHistory')
    .select('trader_wallet_address, market_metric_id, side, price, quantity')
    .in('market_metric_id', marketIds)

  if (ordersError) {
    console.error('Error fetching orders:', ordersError)
    return
  }

  console.log(`Found ${allOrders?.length || 0} orders for reference`)

  // Build lookup maps
  const marketMap = new Map<string, SettledMarket>()
  for (const m of settledMarkets || []) {
    marketMap.set(m.market_identifier.toUpperCase(), m)
  }

  // Build orders lookup: market -> user -> orders[]
  const ordersLookup = new Map<string, Map<string, Order[]>>()
  for (const order of allOrders || []) {
    if (!order.side) continue
    const marketKey = order.market_metric_id.toUpperCase()
    const userKey = order.trader_wallet_address.toLowerCase()
    
    if (!ordersLookup.has(marketKey)) {
      ordersLookup.set(marketKey, new Map())
    }
    const userOrders = ordersLookup.get(marketKey)!
    if (!userOrders.has(userKey)) {
      userOrders.set(userKey, [])
    }
    userOrders.get(userKey)!.push(order)
  }

  // Group trades by market and user
  const tradesByMarketUser = new Map<string, Map<string, Trade[]>>()
  for (const trade of allTrades || []) {
    const marketKey = trade.market_id.toUpperCase()
    const userKey = trade.user_address.toLowerCase()
    
    if (!tradesByMarketUser.has(marketKey)) {
      tradesByMarketUser.set(marketKey, new Map())
    }
    const userTrades = tradesByMarketUser.get(marketKey)!
    if (!userTrades.has(userKey)) {
      userTrades.set(userKey, [])
    }
    userTrades.get(userKey)!.push(trade)
  }

  // Helper to find trade side from orders
  const findTradeSide = (
    marketKey: string, 
    userKey: string, 
    tradePrice: number
  ): 'BUY' | 'SELL' | null => {
    const userOrders = ordersLookup.get(marketKey)?.get(userKey)
    if (!userOrders || userOrders.length === 0) return null

    const tolerance = 0.01
    
    // Try exact price match
    for (const order of userOrders) {
      const orderPrice = parseFloat(order.price)
      if (Math.abs(orderPrice - tradePrice) < tolerance) {
        return order.side
      }
    }
    
    // Fallback: use dominant side
    let buyCount = 0, sellCount = 0
    for (const order of userOrders) {
      if (order.side === 'BUY') buyCount++
      else sellCount++
    }
    
    return buyCount >= sellCount ? 'BUY' : 'SELL'
  }

  // Process each market-user combination
  const settlements: any[] = []
  let processed = 0
  let skipped = 0

  for (const [marketKey, userTradesMap] of tradesByMarketUser) {
    const market = marketMap.get(marketKey)
    if (!market) {
      console.log(`Skipping market ${marketKey} - not found in settled markets`)
      continue
    }

    const settlementPrice = parseFloat(market.settlement_value)
    if (!settlementPrice || settlementPrice <= 0) {
      console.log(`Skipping market ${marketKey} - no settlement value`)
      continue
    }

    for (const [userKey, trades] of userTradesMap) {
      // Sort trades by time
      trades.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      // Process trades using FIFO to calculate net position
      const openLots: OpenLot[] = []
      let totalFees = 0
      let firstTradeAt: string | null = null
      let lastTradeAt: string | null = null
      let tradeCount = 0
      let hasValidSide = false

      for (const trade of trades) {
        const tradePrice = parseFloat(trade.trade_price)
        const tradeAmount = parseFloat(trade.trade_amount)
        const tradeFee = parseFloat(trade.fee_amount_usdc) || 0

        totalFees += tradeFee
        tradeCount++
        
        if (!firstTradeAt) firstTradeAt = trade.created_at
        lastTradeAt = trade.created_at

        // Determine if this trade was a buy or sell
        const side = findTradeSide(marketKey, userKey, tradePrice)
        if (!side) {
          // If we can't determine side, skip this trade
          continue
        }
        hasValidSide = true
        const isBuy = side === 'BUY'

        let remaining = tradeAmount

        // FIFO matching against opposite-side lots
        while (remaining > 0 && openLots.length > 0) {
          const matchIdx = openLots.findIndex(lot => lot.isBuy !== isBuy)
          if (matchIdx === -1) break

          const lot = openLots[matchIdx]
          const matched = Math.min(lot.remaining, remaining)
          lot.remaining -= matched
          remaining -= matched
          if (lot.remaining <= 0) {
            openLots.splice(matchIdx, 1)
          }
        }

        // Add remaining as new open lot
        if (remaining > 0) {
          openLots.push({
            isBuy,
            price: tradePrice,
            remaining,
          })
        }
      }

      // Skip if no valid trades with determinable side
      if (!hasValidSide) {
        skipped++
        continue
      }

      // Calculate settlement P&L for remaining open lots
      let grossPnl = 0
      let totalQuantity = 0
      let weightedEntryPrice = 0
      let netSide: 'LONG' | 'SHORT' = 'LONG'

      for (const lot of openLots) {
        if (lot.remaining <= 0) continue
        
        totalQuantity += lot.remaining
        weightedEntryPrice += lot.price * lot.remaining
        netSide = lot.isBuy ? 'LONG' : 'SHORT'
        
        const pnl = lot.isBuy
          ? (settlementPrice - lot.price) * lot.remaining
          : (lot.price - settlementPrice) * lot.remaining
        grossPnl += pnl
      }

      // Skip if no open position at settlement
      if (totalQuantity <= 0) {
        skipped++
        continue
      }

      const avgEntryPrice = weightedEntryPrice / totalQuantity
      const netPnl = grossPnl - totalFees

      settlements.push({
        wallet_address: userKey,
        market_id: market.id,
        market_identifier: market.market_identifier,
        market_symbol: market.symbol,
        side: netSide,
        entry_price: avgEntryPrice,
        settlement_price: settlementPrice,
        quantity: totalQuantity,
        gross_pnl: grossPnl,
        fees_paid: totalFees,
        net_pnl: netPnl,
        settlement_timestamp: market.settlement_timestamp,
        trade_count: tradeCount,
        first_trade_at: firstTradeAt,
        last_trade_at: lastTradeAt,
      })

      processed++
    }
  }

  console.log(`\nProcessed ${processed} user-market combinations`)
  console.log(`Skipped ${skipped} (no determinable position)`)
  console.log(`Generated ${settlements.length} settlement records`)

  if (settlements.length === 0) {
    console.log('No settlements to insert')
    return
  }

  // Insert settlements in batches
  const batchSize = 100
  let inserted = 0
  let errors = 0

  for (let i = 0; i < settlements.length; i += batchSize) {
    const batch = settlements.slice(i, i + batchSize)
    
    const { error: insertError } = await supabase
      .from('user_settlements')
      .upsert(batch, { 
        onConflict: 'wallet_address,market_id',
        ignoreDuplicates: false 
      })

    if (insertError) {
      console.error(`Error inserting batch ${i / batchSize + 1}:`, insertError)
      errors++
    } else {
      inserted += batch.length
      console.log(`Inserted batch ${i / batchSize + 1}: ${batch.length} records`)
    }
  }

  console.log(`\nBackfill complete!`)
  console.log(`Successfully inserted: ${inserted}`)
  console.log(`Errors: ${errors}`)

  // Show sample results
  const { data: sample } = await supabase
    .from('user_settlements')
    .select('*')
    .limit(5)

  console.log('\nSample settlements:')
  console.table(sample?.map(s => ({
    wallet: s.wallet_address.slice(0, 10) + '...',
    market: s.market_symbol,
    side: s.side,
    qty: parseFloat(s.quantity).toFixed(4),
    entry: parseFloat(s.entry_price).toFixed(2),
    settle: parseFloat(s.settlement_price).toFixed(2),
    pnl: parseFloat(s.net_pnl).toFixed(2),
  })))
}

backfillSettlements().catch(console.error)
