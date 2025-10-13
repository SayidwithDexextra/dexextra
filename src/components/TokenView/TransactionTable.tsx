'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Transaction, OrderBookEntry } from '@/types/orders';
import { useSupabaseRealtimeOrders } from '@/hooks/useSupabaseRealtimeOrders';
import { AnimatedOrderRow } from '@/components/ui/AnimatedOrderRow';
import { useOrderAnimations } from '@/hooks/useOrderAnimations';
import { OrderBookAnimatedQuantity } from '@/components/ui/AnimatedQuantity';

interface TransactionTableProps {
  metricId?: string;
  currentPrice?: number;
  height?: string | number;
}

// Helper function to transform market depth to order book entries
const transformMarketDepthToOrderBook = (bids: OrderBookEntry[], asks: OrderBookEntry[]): OrderBookEntry[] => {
  // Combine and sort all orders by price
  const allOrders = [...bids, ...asks];
  return allOrders.sort((a, b) => b.price - a.price); // Sort by price descending
};

interface OrderFromAPI {
  order_id: string;
  side: string;
  order_status: string;
  price: number | null;
  quantity: number;
  filled_quantity: number;
  created_at: string;
  trader_wallet_address: string;
}

export default function TransactionTable({ metricId, currentPrice, height = '100%' }: TransactionTableProps) {
  const [view, setView] = useState<'transactions' | 'orderbook'>('transactions');
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [sortBy, setSortBy] = useState<'timestamp' | 'price' | 'amount'>('timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  // Removed excessive render logging - only log when metricId changes
  const prevMetricId = React.useRef(metricId);
  useEffect(() => {
    if (prevMetricId.current !== metricId) {
      console.log('🔍 [TRANSACTION_TABLE] MetricId changed:', { from: prevMetricId.current, to: metricId });
      prevMetricId.current = metricId;
    }
  }, [metricId]);

  // 🚀 Use Supabase real-time subscriptions for instant database updates
  const {
    orders: dbOrders,
    isLoading,
    error,
    isConnected,
    refetch
  } = useSupabaseRealtimeOrders({
    metricId,
    autoRefresh: true
  });

  // Only log connection status changes, not every render
  const prevIsConnected = React.useRef(isConnected);
  const prevOrdersCount = React.useRef(dbOrders?.length || 0);
  
  useEffect(() => {
    if (prevIsConnected.current !== isConnected) {
      console.log('📡 [TRANSACTION_TABLE] Connection status changed:', isConnected);
      prevIsConnected.current = isConnected;
    }
  }, [isConnected]);

  useEffect(() => {
    const currentCount = dbOrders?.length || 0;
    if (prevOrdersCount.current !== currentCount) {
      console.log('📊 [TRANSACTION_TABLE] Orders count changed:', { from: prevOrdersCount.current, to: currentCount });
      prevOrdersCount.current = currentCount;
    }
  }, [dbOrders?.length]);

  // Transform database orders to the expected format
  const orders: OrderFromAPI[] = useMemo(() => {
    if (!dbOrders) return [];
    
    return dbOrders.map(order => ({
      order_id: order.order_id.toString(),
      side: order.side.toUpperCase(),
      order_status: order.status.toUpperCase(),
      price: order.price,
      quantity: order.quantity || order.size,
      filled_quantity: order.filled,
      created_at: order.created_at,
      trader_wallet_address: order.trader_address || order.user_address
    }));
  }, [dbOrders]);

  // 🎬 Animation management for smooth order transitions
  const { isOrderNew, getAnimationDelay } = useOrderAnimations(dbOrders || [], {
    staggerDelay: 75, // 75ms between each new order animation for clean cascading
    newOrderWindow: 5000 // Consider orders "new" if created within 5 seconds
  });

  // Only log state changes when significant changes occur
  const prevState = React.useRef<{ ordersCount: number; isLoading: boolean; error: string | null }>({ 
    ordersCount: 0, 
    isLoading: true, 
    error: null 
  });
  
  useEffect(() => {
    const currentState = {
      ordersCount: orders.length,
      isLoading,
      error
    };
    
    if (JSON.stringify(prevState.current) !== JSON.stringify(currentState)) {
      console.log('🔍 [TRANSACTION_TABLE] State changed:', {
        ...currentState,
        ordersWithPrice: orders.filter(o => o.price !== null).length,
        ordersWithoutPrice: orders.filter(o => o.price === null).length
      });
      prevState.current = currentState;
    }
  }, [orders.length, isLoading, error, orders]);

  // Get pending orders for BOOK tab (unfilled limit orders)
  const pendingOrders = useMemo(() => {
    const filtered = orders.filter(order => 
      (order.order_status === 'PENDING' || order.order_status === 'PARTIAL') &&
      order.price !== null // Only limit orders with prices for orderbook
    );
    
    console.log('🔍 [ORDERBOOK] Found', filtered.length, 'orders for orderbook:', 
      filtered.map(o => ({ side: o.side, price: o.price, status: o.order_status }))
    );
    return filtered;
  }, [orders]);

  // Get filled orders for TRADES tab (completed trades)
  // Include market orders even if pending since they execute immediately
  const filledOrders = useMemo(() => {
    const filtered = orders.filter(order => 
      order.order_status === 'FILLED' || 
      order.order_status === 'PARTIAL' ||
      (order.order_status === 'PENDING' && order.price === null) // Include market orders
    );
    console.log('🔍 [TRANSACTIONS] Found', filtered.length, 'orders for transactions');
    return filtered;
  }, [orders]);

  // Separate bids and asks for traditional orderbook display
  const { bids, asks } = useMemo(() => {
    const buyOrders = pendingOrders
      .filter(order => order.side.toLowerCase() === 'buy')
      .sort((a, b) => (b.price || 0) - (a.price || 0)); // Highest price first for bids
    
    const sellOrders = pendingOrders
      .filter(order => order.side.toLowerCase() === 'sell')
      .sort((a, b) => (a.price || 0) - (b.price || 0)); // Lowest price first for asks
    
    console.log('🔍 [ORDERBOOK] Bids:', buyOrders.length, 'Asks:', sellOrders.length);
    
    return { bids: buyOrders, asks: sellOrders };
  }, [pendingOrders]);

  // Filtered and sorted data based on current view
  const filteredAndSortedData = useMemo(() => {
    // Choose data source based on view
    let sourceData = view === 'orderbook' ? pendingOrders : filledOrders;
    let filtered = sourceData;

    // Apply filter
    if (filter !== 'all') {
      filtered = filtered.filter(item => {
        if (filter === 'buy') return item.side.toLowerCase() === 'buy';
        if (filter === 'sell') return item.side.toLowerCase() === 'sell';
        return true;
      });
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue, bValue;
      
      switch (sortBy) {
        case 'timestamp':
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        case 'price':
          aValue = a.price || 0;
          bValue = b.price || 0;
          break;
        case 'amount':
          aValue = a.quantity;
          bValue = b.quantity;
          break;
        default:
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
      }

      if (sortOrder === 'asc') {
        return aValue - bValue;
      } else {
        return bValue - aValue;
      }
    });

    return filtered;
  }, [view, pendingOrders, filledOrders, filter, sortBy, sortOrder]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const getStatusColor = (status: Transaction['status']) => {
    switch (status) {
      case 'open':
        return 'text-blue-400';
      case 'closed':
        return 'text-green-400';
      case 'liquidated':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const getPnLColor = (pnl?: number) => {
    if (!pnl) return 'text-gray-400';
    return pnl >= 0 ? 'text-[#00D084]' : 'text-[#FF4747]';
  };

  const handleSort = (newSortBy: typeof sortBy) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('desc');
    }
  };

  return (
    <div className="bg-[#0A0A0A] border border-[#333333] rounded-md p-3 flex flex-col overflow-y-auto transaction-table-container" style={{ height }}>
      {/* Header with View Toggle - Ultra Compact */}
      <div className="mb-2">
        <div className="flex bg-[#1A1A1A] rounded p-0.5 w-full">
          <button
            onClick={() => setView('transactions')}
            className={`flex-1 py-1 px-1.5 rounded text-[10px] font-medium transition-colors ${
              view === 'transactions'
                ? 'bg-[#333333] text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            TRADES
          </button>
          <button
            onClick={() => setView('orderbook')}
            className={`flex-1 py-1 px-1.5 rounded text-[10px] font-medium transition-colors ${
              view === 'orderbook'
                ? 'bg-[#333333] text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            BOOK
          </button>
        </div>

      </div>

      {/* Filters - Ultra Compact */}
      <div className="mb-2">
        {/* Loading/Error States */}
        {isLoading ? (
          <div className="text-[10px] text-gray-500 text-center py-2">
            Loading {view === 'orderbook' ? 'pending orders' : 'trades'}...
          </div>
        ) : error ? (
          <div className="text-[10px] text-red-500 text-center py-2">
            {error}
          </div>
        ) : view === 'transactions' ? (
          <>
            <div className="grid grid-cols-3 gap-0.5 mb-1">
              {(['all', 'buy', 'sell'] as const).map((filterOption) => (
                <button
                  key={filterOption}
                  onClick={() => setFilter(filterOption)}
                  className={`py-0.5 px-1 rounded text-[10px] font-medium transition-colors uppercase ${
                    filter === filterOption
                      ? 'bg-[#333333] text-white'
                      : 'bg-[#1A1A1A] text-gray-500 hover:text-white'
                  }`}
                >
                  {filterOption}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-gray-500 text-center">
              {filteredAndSortedData.length} filled
              {!metricId && (
                <span className="block text-[9px] text-gray-600">
                  Connect wallet to see orders
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="text-[10px] text-gray-500 text-center py-1">
            Order Book
            {!metricId && (
              <span className="block text-[9px] text-gray-600">
                Market data unavailable
              </span>
            )}
          </div>
        )}
      </div>

      {/* Table Headers */}
      <div className="mb-1">
        {view === 'orderbook' ? (
          <div className="grid grid-cols-3 gap-1 text-[10px] font-medium text-gray-500 px-1">
            <div>SIZE</div>
            <div className="text-center">PRICE</div>
            <div className="text-right">TOTAL</div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-1 text-[10px] font-medium text-gray-500 px-1">
            <div>SIDE</div>
            <div className="text-right">SIZE</div>
            <div className="text-right">PRICE</div>
            <div className="text-right">TIME</div>
          </div>
        )}
      </div>

      {/* Orders/Trades Table */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {view === 'orderbook' ? (
          /* Traditional OrderBook Display */
          <div className="flex-1 flex flex-col">
            {/* Ask Orders (Sell Orders) - Top half */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="text-[9px] text-gray-500 mb-1 px-1 flex items-center justify-between">
                <span>ASKS (SELL)</span>
                <span className="text-[#FF4747]">{asks.length} orders</span>
              </div>
              <div className="flex-1 overflow-y-auto orders-table-scroll">
                {asks.length === 0 ? (
                  <div className="text-[10px] text-gray-500 text-center py-2">
                    No sell orders
                  </div>
                ) : (
                  <div className="space-y-0">
                    {asks.slice(0, 10).map((order, index) => {
                      const remainingQuantity = order.quantity - order.filled_quantity;
                      const maxQuantity = Math.max(...asks.map(o => o.quantity - o.filled_quantity));
                      const fillPercentage = maxQuantity > 0 ? (remainingQuantity / maxQuantity) * 100 : 0;
                      
                      return (
                        <AnimatedOrderRow
                          key={order.order_id}
                          orderId={order.order_id}
                          side="SELL"
                          isNew={isOrderNew(order.order_id)}
                          animationDelay={getAnimationDelay(order.order_id)}
                          className="hover:bg-[#1A1A1A] transition-colors group cursor-pointer"
                        >
                          {/* Background depth bar */}
                          <div 
                            className="absolute right-0 top-0 h-full opacity-10 bg-[#FF4747]"
                            style={{ width: `${fillPercentage}%` }}
                          />
                          
                          {/* Content */}
                          <div className="relative grid grid-cols-3 gap-1 py-0.5 px-1 text-[11px]">
                            <div className="text-left text-gray-300 font-mono">
                              <OrderBookAnimatedQuantity
                                orderId={order.order_id}
                                quantity={remainingQuantity}
                                side="SELL"
                                isNewOrder={isOrderNew(order.order_id)}
                                className="text-gray-300"
                              />
                            </div>
                            <div className="text-center text-[#FF4747] font-mono font-medium">
                              ${order.price?.toFixed(2) || '0.00'}
                            </div>
                            <div className="text-right text-gray-400 font-mono text-[10px]">
                              {(remainingQuantity * (order.price || 0)).toFixed(0)}
                            </div>
                          </div>
                        </AnimatedOrderRow>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Spread Display */}
            <div className="py-1 px-1 bg-[#1A1A1A] border-y border-gray-700">
              <div className="text-[10px] text-gray-400 text-center font-mono">
                {asks.length > 0 && bids.length > 0 && asks[0].price && bids[0].price ? (
                  <>
                    Spread: ${(asks[0].price - bids[0].price).toFixed(2)}
                    <span className="text-[9px] text-gray-500 ml-2">
                      ({(((asks[0].price - bids[0].price) / bids[0].price) * 100).toFixed(2)}%)
                    </span>
                  </>
                ) : (
                  'No spread data'
                )}
              </div>
            </div>

            {/* Bid Orders (Buy Orders) - Bottom half */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="text-[9px] text-gray-500 mb-1 px-1 flex items-center justify-between">
                <span>BIDS (BUY)</span>
                <span className="text-[#00D084]">{bids.length} orders</span>
              </div>
              <div className="flex-1 overflow-y-auto orders-table-scroll">
                {bids.length === 0 ? (
                  <div className="text-[10px] text-gray-500 text-center py-2">
                    No buy orders
                  </div>
                ) : (
                  <div className="space-y-0">
                    {bids.slice(0, 10).map((order, index) => {
                      const remainingQuantity = order.quantity - order.filled_quantity;
                      const maxQuantity = Math.max(...bids.map(o => o.quantity - o.filled_quantity));
                      const fillPercentage = maxQuantity > 0 ? (remainingQuantity / maxQuantity) * 100 : 0;
                      
                      return (
                        <AnimatedOrderRow
                          key={order.order_id}
                          orderId={order.order_id}
                          side="BUY"
                          isNew={isOrderNew(order.order_id)}
                          animationDelay={getAnimationDelay(order.order_id)}
                          className="hover:bg-[#1A1A1A] transition-colors group cursor-pointer"
                        >
                          {/* Background depth bar */}
                          <div 
                            className="absolute left-0 top-0 h-full opacity-10 bg-[#00D084]"
                            style={{ width: `${fillPercentage}%` }}
                          />
                          
                          {/* Content */}
                          <div className="relative grid grid-cols-3 gap-1 py-0.5 px-1 text-[11px]">
                            <div className="text-left text-gray-300 font-mono">
                              <OrderBookAnimatedQuantity
                                orderId={order.order_id}
                                quantity={remainingQuantity}
                                side="BUY"
                                isNewOrder={isOrderNew(order.order_id)}
                                className="text-gray-300"
                              />
                            </div>
                            <div className="text-center text-[#00D084] font-mono font-medium">
                              ${order.price?.toFixed(2) || '0.00'}
                            </div>
                            <div className="text-right text-gray-400 font-mono text-[10px]">
                              {(remainingQuantity * (order.price || 0)).toFixed(0)}
                            </div>
                          </div>
                        </AnimatedOrderRow>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Traditional Trades Display */
          <div className="overflow-y-auto orders-table-scroll">
            {filteredAndSortedData.length === 0 ? (
              <div className="text-[10px] text-gray-500 text-center py-4">
                No filled orders found
                {!metricId && (
                  <div className="text-[9px] text-gray-600 mt-1">
                    Market data unavailable
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-0">
                {filteredAndSortedData.map((order, index) => {
                  const fillPercentage = Math.max(...filteredAndSortedData.map(o => o.quantity)) > 0 
                    ? (order.quantity / Math.max(...filteredAndSortedData.map(o => o.quantity))) * 100 
                    : 0;
                  
                  return (
                    <AnimatedOrderRow
                      key={order.order_id}
                      orderId={order.order_id}
                      side={order.side.toUpperCase() as 'BUY' | 'SELL'}
                      isNew={isOrderNew(order.order_id)}
                      animationDelay={getAnimationDelay(order.order_id)}
                      className="hover:bg-[#1A1A1A] transition-colors group cursor-pointer"
                    >
                      {/* Background depth bar */}
                      <div 
                        className={`absolute left-0 top-0 h-full opacity-12 rounded-xl ${
                                                      order.side.toLowerCase() === 'buy' ? 'bg-[#00D084]' : 'bg-[#FF4747]'
                        }`}
                        style={{ width: `${fillPercentage}%` }}
                      />
                      
                      {/* Content */}
                      <div className="relative grid grid-cols-4 gap-1 py-0.5 px-1 text-[11px]">
                        <div className="flex items-center">
                          <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                            order.side.toLowerCase() === 'buy' 
                              ? 'bg-[#00D084]/20 text-[#00D084]' 
                              : 'bg-[#FF4747]/20 text-[#FF4747]'
                          }`}>
                            {order.side.toLowerCase() === 'buy' ? 'B' : 'S'}
                          </span>
                        </div>
                        <div className="text-right text-gray-300 font-mono flex items-center justify-end">
                          <OrderBookAnimatedQuantity
                            orderId={order.order_id}
                            quantity={order.quantity}
                            side={order.side.toUpperCase() as 'BUY' | 'SELL'}
                            isNewOrder={isOrderNew(order.order_id)}
                            className="text-gray-300"
                          />
                        </div>
                        <div className={`text-right font-mono font-medium flex items-center justify-end ${
                                                      order.side.toLowerCase() === 'buy' ? 'text-[#00D084]' : 'text-[#FF4747]'
                        }`}>
                          {order.price ? `$${order.price.toFixed(2)}` : 'MARKET'}
                        </div>
                        <div className="text-right text-gray-400 font-mono text-[10px] flex items-center justify-end">
                          {formatTime(order.created_at)}
                        </div>
                      </div>
                    </AnimatedOrderRow>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>





      {/* Hidden Scrollbar Styles */}
      <style jsx>{`
        /* Hide scrollbars for all scrollable areas */
        :global(.transaction-table-container::-webkit-scrollbar),
        :global(.orders-table-scroll::-webkit-scrollbar) {
          display: none;
        }
        
        :global(.transaction-table-container),
        :global(.orders-table-scroll) {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
