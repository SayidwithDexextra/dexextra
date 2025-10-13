/**
 * Order Matching Client
 * 
 * A comprehensive client for interacting with the Supabase-based order matching system.
 * Provides both manual and automated order matching capabilities.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

export interface OrderMatchingConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceKey?: string
}

export interface Order {
  order_id: string
  market_id: string
  user_address: string
  order_type: string
  side: 'BUY' | 'SELL'
  size: number
  price: number | null
  filled: number
  status: string
  margin_reserved: number
  created_at: string
  updated_at: string
}

export interface TradeMatch {
  match_id: number
  market_id: string
  buy_order_id: string
  sell_order_id: string
  buy_trader_wallet_address: string
  sell_trader_wallet_address: string
  trade_price: number
  trade_quantity: number
  total_value: number
  settlement_status: string
  buy_trader_fee: number
  sell_trader_fee: number
  total_fees: number
  matched_by: string
  matched_at: string
}

export interface OrderBookLevel {
  price: number
  quantity: number
  orders: number
}

export interface OrderBookSnapshot {
  market_id: string
  best_bid_price: number | null
  best_ask_price: number | null
  spread: number | null
  total_bid_volume: number
  total_ask_volume: number
  bid_levels: OrderBookLevel[]
  ask_levels: OrderBookLevel[]
  last_trade_price: number | null
}

export interface MatchingStats {
  ordersProcessed: number
  matchesFound: number
  volumeMatched: number
  feesGenerated: number
  processingTimeMs: number
}

export interface MatchingResult {
  success: boolean
  stats: MatchingStats
  orderBook: OrderBookSnapshot
  matches: TradeMatch[]
  errors?: string[]
}

export class OrderMatchingClient {
  private supabase: SupabaseClient
  private serviceSupabase?: SupabaseClient
  private readonly functionsUrl: string

  constructor(config: OrderMatchingConfig) {
    this.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)
    
    if (config.supabaseServiceKey) {
      this.serviceSupabase = createClient(config.supabaseUrl, config.supabaseServiceKey)
    }
    
    this.functionsUrl = `${config.supabaseUrl}/functions/v1`
  }

  /**
   * Trigger manual order matching for a specific market
   */
  async matchOrdersManual(
    marketId: string, 
    options: {
      maxMatches?: number
      dryRun?: boolean
      batchSize?: number
    } = {}
  ): Promise<MatchingResult> {
    const client = this.serviceSupabase || this.supabase
    
    const { data, error } = await client.functions.invoke('advanced-order-matcher', {
      body: {
        marketId,
        maxMatches: options.maxMatches || 100,
        dryRun: options.dryRun || false,
        batchSize: options.batchSize || 50
      }
    })

    if (error) {
      throw new Error(`Order matching failed: ${error.message}`)
    }

    return data
  }

  /**
   * Run scheduled matching across all eligible markets
   */
  async runScheduledMatching(): Promise<{
    success: boolean
    jobsProcessed: number
    totalMatches: number
    totalVolume: number
    errors: string[]
    duration: number
  }> {
    const client = this.serviceSupabase || this.supabase
    
    const { data, error } = await client.functions.invoke('scheduled-order-matching', {
      body: {}
    })

    if (error) {
      throw new Error(`Scheduled matching failed: ${error.message}`)
    }

    return data
  }

  /**
   * Get current order book for a market
   */
  async getOrderBook(marketId: string, depth: number = 10): Promise<OrderBookSnapshot> {
    const { data, error } = await this.supabase.rpc('get_order_book_depth', {
      target_market_id: marketId,
      depth_levels: depth
    })

    if (error) {
      throw new Error(`Failed to get order book: ${error.message}`)
    }

    // Get spread information
    const spreadData = await this.supabase.rpc('get_market_spread', {
      target_market_id: marketId
    })

    return {
      market_id: marketId,
      best_bid_price: spreadData.data?.best_bid || null,
      best_ask_price: spreadData.data?.best_ask || null,
      spread: spreadData.data?.spread_absolute || null,
      total_bid_volume: data.bids?.reduce((sum: number, level: any) => sum + level.quantity, 0) || 0,
      total_ask_volume: data.asks?.reduce((sum: number, level: any) => sum + level.quantity, 0) || 0,
      bid_levels: data.bids || [],
      ask_levels: data.asks || [],
      last_trade_price: null
    }
  }

  /**
   * Get pending orders for a market
   */
  async getPendingOrders(marketId: string, limit: number = 100): Promise<Order[]> {
    const { data, error } = await this.supabase
      .from('orders')
      .select('*')
      .eq('market_id', marketId)
      .eq('status', 'PENDING')
      .not('price', 'is', null)
      .lt('filled', 'size')
      .order('created_at', { ascending: true })
      .limit(limit)

    if (error) {
      throw new Error(`Failed to get orders: ${error.message}`)
    }

    return data || []
  }

  /**
   * Get recent trade matches for a market
   */
  async getRecentMatches(marketId: string, limit: number = 50): Promise<TradeMatch[]> {
    const { data, error } = await this.supabase
      .from('trade_matches')
      .select('*')
      .eq('market_id', marketId)
      .order('matched_at', { ascending: false })
      .limit(limit)

    if (error) {
      throw new Error(`Failed to get matches: ${error.message}`)
    }

    return data || []
  }

  /**
   * Get market statistics
   */
  async getMarketStats(marketId: string): Promise<{
    spread: any
    orderBook: OrderBookSnapshot
    recentVolume: number
    totalMatches: number
    avgTradeSize: number
  }> {
    const [spreadData, orderBook, matches] = await Promise.all([
      this.supabase.rpc('get_market_spread', { target_market_id: marketId }),
      this.getOrderBook(marketId, 5),
      this.getRecentMatches(marketId, 100)
    ])

    const recentVolume = matches.reduce((sum, match) => sum + match.total_value, 0)
    const avgTradeSize = matches.length > 0 ? recentVolume / matches.length : 0

    return {
      spread: spreadData.data,
      orderBook,
      recentVolume,
      totalMatches: matches.length,
      avgTradeSize
    }
  }

  /**
   * Monitor order book changes (real-time)
   */
  subscribeToOrderBookChanges(
    marketId: string,
    callback: (payload: any) => void
  ): () => void {
    const subscription = this.supabase
      .channel(`order-book-${marketId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `market_id=eq.${marketId}`
        },
        callback
      )
      .subscribe()

    return () => subscription.unsubscribe()
  }

  /**
   * Monitor trade matches (real-time)
   */
  subscribeToTradeMatches(
    marketId: string,
    callback: (payload: any) => void
  ): () => void {
    const subscription = this.supabase
      .channel(`trades-${marketId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'trade_matches',
          filter: `market_id=eq.${marketId}`
        },
        callback
      )
      .subscribe()

    return () => subscription.unsubscribe()
  }

  /**
   * Test order matching with dummy data (development only)
   */
  async createTestOrders(marketId: string, count: number = 10): Promise<Order[]> {
    if (!this.serviceSupabase) {
      throw new Error('Service key required for creating test orders')
    }

    const testOrders = []
    const basePrice = 100
    
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 'BUY' : 'SELL'
      const priceVariation = (Math.random() - 0.5) * 10 // ±5 price variation
      const price = basePrice + priceVariation
      const size = Math.random() * 10 + 1 // 1-11 size

      const order = {
        order_id: `test-${Date.now()}-${i}`,
        market_id: marketId,
        user_address: `0x${Math.random().toString(16).substr(2, 40)}`,
        order_type: 'LIMIT',
        side,
        size,
        price,
        filled: 0,
        status: 'PENDING',
        margin_reserved: size * price * 0.1
      }

      testOrders.push(order)
    }

    const { data, error } = await this.serviceSupabase
      .from('orders')
      .insert(testOrders)
      .select()

    if (error) {
      throw new Error(`Failed to create test orders: ${error.message}`)
    }

    return data || []
  }

  /**
   * Validate order matching system health
   */
  async healthCheck(): Promise<{
    database: boolean
    functions: boolean
    matching: boolean
    errors: string[]
  }> {
    const errors: string[] = []
    let database = false
    let functions = false
    let matching = false

    try {
      // Test database connectivity
      const { error: dbError } = await this.supabase
        .from('markets')
        .select('market_id')
        .limit(1)
      
      database = !dbError
      if (dbError) errors.push(`Database: ${dbError.message}`)
    } catch (error) {
      errors.push(`Database: ${error.message}`)
    }

    try {
      // Test functions
      const response = await fetch(`${this.functionsUrl}/advanced-order-matcher`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.supabase.supabaseKey}`
        },
        body: JSON.stringify({
          marketId: 'health-check-market',
          dryRun: true
        })
      })
      
      functions = response.status === 400 || response.status === 200 // 400 is expected for invalid market
      if (!functions) errors.push(`Functions: HTTP ${response.status}`)
    } catch (error) {
      errors.push(`Functions: ${error.message}`)
    }

    // Overall matching system health
    matching = database && functions

    return { database, functions, matching, errors }
  }
}

/**
 * Utility functions for order matching
 */
export class OrderMatchingUtils {
  /**
   * Calculate potential match quantity between two orders
   */
  static calculateMatchQuantity(buyOrder: Order, sellOrder: Order): number {
    if (buyOrder.side !== 'BUY' || sellOrder.side !== 'SELL') {
      return 0
    }
    
    if (!buyOrder.price || !sellOrder.price || buyOrder.price < sellOrder.price) {
      return 0
    }
    
    const buyRemaining = buyOrder.size - buyOrder.filled
    const sellRemaining = sellOrder.size - sellOrder.filled
    
    return Math.min(buyRemaining, sellRemaining)
  }

  /**
   * Calculate order book imbalance
   */
  static calculateImbalance(orderBook: OrderBookSnapshot): number {
    const totalBids = orderBook.total_bid_volume
    const totalAsks = orderBook.total_ask_volume
    const total = totalBids + totalAsks
    
    if (total === 0) return 0
    
    return (totalBids - totalAsks) / total
  }

  /**
   * Estimate price impact of a market order
   */
  static estimatePriceImpact(
    orderBook: OrderBookSnapshot, 
    side: 'BUY' | 'SELL', 
    quantity: number
  ): {
    averagePrice: number
    priceImpact: number
    worstPrice: number
  } {
    const levels = side === 'BUY' ? orderBook.ask_levels : orderBook.bid_levels
    const bestPrice = side === 'BUY' ? orderBook.best_ask_price : orderBook.best_bid_price
    
    if (!bestPrice || levels.length === 0) {
      return { averagePrice: 0, priceImpact: 0, worstPrice: 0 }
    }
    
    let remainingQty = quantity
    let totalCost = 0
    let worstPrice = bestPrice
    
    for (const level of levels) {
      if (remainingQty <= 0) break
      
      const takeQty = Math.min(remainingQty, level.quantity)
      totalCost += takeQty * level.price
      remainingQty -= takeQty
      worstPrice = level.price
    }
    
    const averagePrice = totalCost / (quantity - remainingQty)
    const priceImpact = Math.abs((worstPrice - bestPrice) / bestPrice)
    
    return { averagePrice, priceImpact, worstPrice }
  }
}

export default OrderMatchingClient
