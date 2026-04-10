'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useWallet } from '@/hooks/useWallet'

export interface UserOrder {
  orderId: string
  marketId: string
  marketSymbol: string
  traderAddress: string
  orderType: 'LIMIT' | 'MARKET'
  side: 'BUY' | 'SELL'
  price: number | null
  quantity: number
  filledQuantity: number
  status: string
  eventType: string
  txHash: string | null
  createdAt: Date
  occurredAt: Date
}

export interface OrderSummary {
  totalOrders: number
  openOrders: number
  filledOrders: number
  cancelledOrders: number
  buyOrders: number
  sellOrders: number
  limitOrders: number
  marketOrders: number
}

export interface UseUserOrderHistoryResult {
  orders: UserOrder[]
  summary: OrderSummary
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useUserOrderHistory(): UseUserOrderHistoryResult {
  const { walletData } = useWallet() as any
  const walletAddress = walletData?.address || null
  const isConnected = Boolean(walletData?.isConnected && walletAddress)

  const [orders, setOrders] = useState<UserOrder[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  const fetchOrders = useCallback(async () => {
    if (!walletAddress || !isConnected) {
      setOrders([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Query userOrderHistory table directly
      const { data: orderHistory, error: orderError } = await supabase
        .from('userOrderHistory')
        .select(`
          order_id,
          market_metric_id,
          trader_wallet_address,
          order_type,
          side,
          price,
          quantity,
          filled_quantity,
          tx_hash,
          status,
          event_type,
          created_at,
          occurred_at
        `)
        .ilike('trader_wallet_address', walletAddress)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)

      if (orderError) {
        throw orderError
      }

      if (!orderHistory || orderHistory.length === 0) {
        setOrders([])
        setIsLoading(false)
        return
      }

      // Get market symbols for display
      const marketIds = [...new Set(orderHistory.map(o => o.market_metric_id).filter(Boolean))]
      
      let marketMap = new Map<string, string>()
      if (marketIds.length > 0) {
        const { data: markets } = await supabase
          .from('markets')
          .select('market_identifier, symbol')
          .in('market_identifier', marketIds)

        if (markets) {
          for (const m of markets) {
            marketMap.set(m.market_identifier, m.symbol || m.market_identifier)
          }
        }
      }

      const transformedOrders: UserOrder[] = orderHistory.map((order) => ({
        orderId: order.order_id,
        marketId: order.market_metric_id || '',
        marketSymbol: marketMap.get(order.market_metric_id) || order.market_metric_id || 'Unknown',
        traderAddress: order.trader_wallet_address,
        orderType: (order.order_type || 'LIMIT').toUpperCase() as 'LIMIT' | 'MARKET',
        side: (order.side || 'BUY').toUpperCase() as 'BUY' | 'SELL',
        price: order.price ? parseFloat(order.price) : null,
        quantity: parseFloat(order.quantity || '0'),
        filledQuantity: parseFloat(order.filled_quantity || '0'),
        status: order.status || 'UNKNOWN',
        eventType: order.event_type || '',
        txHash: order.tx_hash,
        createdAt: new Date(order.created_at),
        occurredAt: new Date(order.occurred_at || order.created_at),
      }))

      setOrders(transformedOrders)
    } catch (e: any) {
      console.error('[useUserOrderHistory] Error:', e)
      setError(e?.message || 'Failed to fetch order history')
    } finally {
      setIsLoading(false)
    }
  }, [walletAddress, isConnected])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders, tick])

  const summary = useMemo<OrderSummary>(() => {
    if (orders.length === 0) {
      return {
        totalOrders: 0,
        openOrders: 0,
        filledOrders: 0,
        cancelledOrders: 0,
        buyOrders: 0,
        sellOrders: 0,
        limitOrders: 0,
        marketOrders: 0,
      }
    }

    const openStatuses = ['PENDING', 'OPEN', 'PARTIALLY_FILLED', 'NEW']
    const filledStatuses = ['FILLED', 'COMPLETED']
    const cancelledStatuses = ['CANCELLED', 'CANCELED', 'EXPIRED', 'REJECTED']

    return {
      totalOrders: orders.length,
      openOrders: orders.filter(o => openStatuses.includes(o.status.toUpperCase())).length,
      filledOrders: orders.filter(o => filledStatuses.includes(o.status.toUpperCase())).length,
      cancelledOrders: orders.filter(o => cancelledStatuses.includes(o.status.toUpperCase())).length,
      buyOrders: orders.filter(o => o.side === 'BUY').length,
      sellOrders: orders.filter(o => o.side === 'SELL').length,
      limitOrders: orders.filter(o => o.orderType === 'LIMIT').length,
      marketOrders: orders.filter(o => o.orderType === 'MARKET').length,
    }
  }, [orders])

  return {
    orders,
    summary,
    isLoading,
    error,
    refetch,
  }
}
