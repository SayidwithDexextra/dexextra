import { SupabaseClient } from '@supabase/supabase-js';

interface Trade {
  id: number;
  market_id: string;
  user_address: string;
  fee_role: string;
  fee_amount_usdc: string;
  trade_price: string;
  trade_amount: string;
  tx_hash: string | null;
  created_at: string;
}

interface Order {
  trader_wallet_address: string;
  market_metric_id: string;
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
}

interface OpenLot {
  isBuy: boolean;
  price: number;
  remaining: number;
}

interface SettlementResult {
  ok: boolean;
  inserted: number;
  errors: number;
  details?: string;
}

/**
 * Calculate and insert user settlements for a specific market that just settled.
 * This is called from the settlement-engine after a market is marked as SETTLED.
 */
export async function calculateAndInsertUserSettlements(
  supabase: SupabaseClient,
  marketId: string,
  marketIdentifier: string,
  settlementPrice: number,
  settlementTimestamp: string
): Promise<SettlementResult> {
  // 1. Get all trades for this market
  const { data: trades, error: tradesError } = await supabase
    .from('trading_fees')
    .select('*')
    .ilike('market_id', marketIdentifier)
    .order('created_at', { ascending: true });

  if (tradesError) {
    console.error('[user-settlements] Error fetching trades:', tradesError);
    return { ok: false, inserted: 0, errors: 1, details: tradesError.message };
  }

  if (!trades || trades.length === 0) {
    return { ok: true, inserted: 0, errors: 0, details: 'no trades found' };
  }

  // 2. Get orders for this market to determine buy/sell side
  const { data: orders, error: ordersError } = await supabase
    .from('userOrderHistory')
    .select('trader_wallet_address, market_metric_id, side, price, quantity')
    .ilike('market_metric_id', marketIdentifier);

  if (ordersError) {
    console.error('[user-settlements] Error fetching orders:', ordersError);
  }

  // Build orders lookup: user -> orders[]
  const ordersLookup = new Map<string, Order[]>();
  for (const order of orders || []) {
    if (!order.side) continue;
    const userKey = order.trader_wallet_address.toLowerCase();
    if (!ordersLookup.has(userKey)) {
      ordersLookup.set(userKey, []);
    }
    ordersLookup.get(userKey)!.push(order);
  }

  // Helper to find trade side from orders
  const findTradeSide = (userKey: string, tradePrice: number): 'BUY' | 'SELL' | null => {
    const userOrders = ordersLookup.get(userKey);
    if (!userOrders || userOrders.length === 0) return null;

    const tolerance = 0.01;
    
    // Try exact price match
    for (const order of userOrders) {
      const orderPrice = parseFloat(order.price);
      if (Math.abs(orderPrice - tradePrice) < tolerance) {
        return order.side;
      }
    }
    
    // Fallback: use dominant side
    let buyCount = 0, sellCount = 0;
    for (const order of userOrders) {
      if (order.side === 'BUY') buyCount++;
      else sellCount++;
    }
    
    return buyCount >= sellCount ? 'BUY' : 'SELL';
  };

  // Group trades by user
  const tradesByUser = new Map<string, Trade[]>();
  for (const trade of trades) {
    const userKey = trade.user_address.toLowerCase();
    if (!tradesByUser.has(userKey)) {
      tradesByUser.set(userKey, []);
    }
    tradesByUser.get(userKey)!.push(trade);
  }

  // Get market symbol for display
  const { data: marketData } = await supabase
    .from('markets')
    .select('symbol')
    .eq('id', marketId)
    .single();
  
  const marketSymbol = marketData?.symbol || marketIdentifier;

  // Process each user
  const settlements: any[] = [];

  for (const [userKey, userTrades] of tradesByUser) {
    // Sort trades by time
    userTrades.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Process trades using FIFO
    const openLots: OpenLot[] = [];
    let totalFees = 0;
    let firstTradeAt: string | null = null;
    let lastTradeAt: string | null = null;
    let tradeCount = 0;
    let hasValidSide = false;

    for (const trade of userTrades) {
      const tradePrice = parseFloat(trade.trade_price);
      const tradeAmount = parseFloat(trade.trade_amount);
      const tradeFee = parseFloat(trade.fee_amount_usdc) || 0;

      totalFees += tradeFee;
      tradeCount++;
      
      if (!firstTradeAt) firstTradeAt = trade.created_at;
      lastTradeAt = trade.created_at;

      const side = findTradeSide(userKey, tradePrice);
      if (!side) continue;
      
      hasValidSide = true;
      const isBuy = side === 'BUY';
      let remaining = tradeAmount;

      // FIFO matching
      while (remaining > 0 && openLots.length > 0) {
        const matchIdx = openLots.findIndex(lot => lot.isBuy !== isBuy);
        if (matchIdx === -1) break;

        const lot = openLots[matchIdx];
        const matched = Math.min(lot.remaining, remaining);
        lot.remaining -= matched;
        remaining -= matched;
        if (lot.remaining <= 0) {
          openLots.splice(matchIdx, 1);
        }
      }

      // Add remaining as new open lot
      if (remaining > 0) {
        openLots.push({
          isBuy,
          price: tradePrice,
          remaining,
        });
      }
    }

    // Skip if no valid trades
    if (!hasValidSide) continue;

    // Calculate settlement P&L for remaining open lots
    let grossPnl = 0;
    let totalQuantity = 0;
    let weightedEntryPrice = 0;
    let netSide: 'LONG' | 'SHORT' = 'LONG';

    for (const lot of openLots) {
      if (lot.remaining <= 0) continue;
      
      totalQuantity += lot.remaining;
      weightedEntryPrice += lot.price * lot.remaining;
      netSide = lot.isBuy ? 'LONG' : 'SHORT';
      
      const pnl = lot.isBuy
        ? (settlementPrice - lot.price) * lot.remaining
        : (lot.price - settlementPrice) * lot.remaining;
      grossPnl += pnl;
    }

    // Skip if no open position at settlement
    if (totalQuantity <= 0) continue;

    const avgEntryPrice = weightedEntryPrice / totalQuantity;
    const netPnl = grossPnl - totalFees;

    settlements.push({
      wallet_address: userKey,
      market_id: marketId,
      market_identifier: marketIdentifier,
      market_symbol: marketSymbol,
      side: netSide,
      entry_price: avgEntryPrice,
      settlement_price: settlementPrice,
      quantity: totalQuantity,
      gross_pnl: grossPnl,
      fees_paid: totalFees,
      net_pnl: netPnl,
      settlement_timestamp: settlementTimestamp,
      trade_count: tradeCount,
      first_trade_at: firstTradeAt,
      last_trade_at: lastTradeAt,
    });
  }

  if (settlements.length === 0) {
    return { ok: true, inserted: 0, errors: 0, details: 'no open positions at settlement' };
  }

  // Insert settlements
  const { error: insertError, count } = await supabase
    .from('user_settlements')
    .upsert(settlements, { 
      onConflict: 'wallet_address,market_id',
      ignoreDuplicates: false,
      count: 'exact'
    });

  if (insertError) {
    console.error('[user-settlements] Error inserting settlements:', insertError);
    return { ok: false, inserted: 0, errors: 1, details: insertError.message };
  }

  return { ok: true, inserted: count || settlements.length, errors: 0 };
}
