'use client';

import React, { useState, useMemo } from 'react';
import { useRealtimeMarketOrders } from '@/hooks/useRealtimeOrders';
import { Transaction, OrderBookEntry } from '@/types/orders';

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

export default function TransactionTable({ metricId, currentPrice, height = '100%' }: TransactionTableProps) {
  const [view, setView] = useState<'transactions' | 'orderbook'>('transactions');
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [sortBy, setSortBy] = useState<'timestamp' | 'price' | 'amount'>('timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  console.log('🔍 [TRANSACTION_TABLE] Received metricId:', metricId);

  // Fetch real orders using the real-time hook
  const { 
    orders,
    transactions, 
    marketDepth, 
    isLoading, 
    isConnected,
    error 
  } = useRealtimeMarketOrders(metricId, true);

  console.log('🔍 [TRANSACTION_TABLE] Hook results:', {
    ordersCount: orders.length,
    transactionsCount: transactions.length,
    marketDepth: marketDepth ? { 
      bids: marketDepth.bids.length, 
      asks: marketDepth.asks.length,
      bidsSample: marketDepth.bids.slice(0, 2),
      asksSample: marketDepth.asks.slice(0, 2)
    } : null,
    isLoading,
    isConnected,
    error
  });

  // Get pending orders for BOOK tab (unfilled limit orders)
  const pendingOrders = useMemo(() => {
    return orders.filter(order => 
      order.status === 'pending' || order.status === 'partially_filled'
    );
  }, [orders]);

  // Get filled orders for TRADES tab (completed trades)
  const filledOrders = useMemo(() => {
    return orders.filter(order => 
      order.status === 'filled'
    );
  }, [orders]);

  // Transform market depth to order book entries (for legacy support)
  const orderBook = useMemo(() => {
    if (!marketDepth) return [];
    return transformMarketDepthToOrderBook(marketDepth.bids, marketDepth.asks);
  }, [marketDepth]);

  // Filtered and sorted data based on current view
  const filteredAndSortedData = useMemo(() => {
    // Choose data source based on view
    let sourceData = view === 'orderbook' ? pendingOrders : filledOrders;
    let filtered = sourceData;

    // Apply filter
    if (filter !== 'all') {
      filtered = filtered.filter(item => {
        if (filter === 'buy') return item.side === 'buy';
        if (filter === 'sell') return item.side === 'sell';
        return true;
      });
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue, bValue;
      
      switch (sortBy) {
        case 'timestamp':
          aValue = a.timestamp;
          bValue = b.timestamp;
          break;
        case 'price':
          aValue = a.price;
          bValue = b.price;
          break;
        case 'amount':
          aValue = a.quantity;
          bValue = b.quantity;
          break;
        default:
          aValue = a.timestamp;
          bValue = b.timestamp;
      }

      if (sortOrder === 'asc') {
        return aValue - bValue;
      } else {
        return bValue - aValue;
      }
    });

    return filtered;
  }, [view, pendingOrders, filledOrders, filter, sortBy, sortOrder]);

  const formatTime = (timestamp: number) => {
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
        <div className="flex items-center justify-center gap-1 mt-1">
          <div className={`w-1 h-1 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
          <span className="text-[10px] text-gray-500">{isConnected ? 'LIVE' : 'OFFLINE'}</span>
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
        ) : (
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
              {filteredAndSortedData.length} {view === 'orderbook' ? 'pending' : 'filled'}
              {!metricId && (
                <span className="block text-[9px] text-gray-600">
                  Connect wallet to see orders
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Table Headers */}
      <div className="mb-1">
        <div className="grid grid-cols-4 gap-1 text-[10px] font-medium text-gray-500 px-1">
          <div>SIDE</div>
          <div className="text-right">SIZE</div>
          <div className="text-right">PRICE</div>
          <div className="text-right">{view === 'orderbook' ? 'STATUS' : 'TIME'}</div>
        </div>
      </div>

      {/* Orders/Trades Table */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="overflow-y-auto orders-table-scroll">
          {filteredAndSortedData.length === 0 ? (
            <div className="text-[10px] text-gray-500 text-center py-4">
              No {view === 'orderbook' ? 'pending orders' : 'filled orders'} found
              {!metricId && (
                <div className="text-[9px] text-gray-600 mt-1">
                  Market data unavailable
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-0">
              {filteredAndSortedData.map((order, index) => {
                // Calculate fill percentage for visual depth bar
                const maxQuantity = Math.max(...filteredAndSortedData.map(o => 
                  view === 'orderbook' ? (o.quantity - o.filledQuantity) : o.quantity
                ));
                const currentQuantity = view === 'orderbook' 
                  ? (order.quantity - order.filledQuantity)
                  : order.quantity;
                const fillPercentage = maxQuantity > 0 ? (currentQuantity / maxQuantity) * 100 : 0;
                
                return (
                  <div 
                    key={order.id} 
                    className="relative hover:bg-[#1A1A1A] transition-colors group cursor-pointer"
                  >
                    {/* Background depth bar with curved border */}
                    <div 
                      className={`absolute left-0 top-0 h-full opacity-12 rounded-xl ${
                        order.side === 'buy' ? 'bg-[#00D084]' : 'bg-[#FF4747]'
                      }`}
                      style={{ width: `${fillPercentage}%` }}
                    />
                    
                    {/* Content */}
                    <div className="relative grid grid-cols-4 gap-1 py-0.5 px-1 text-[11px]">
                      <div className="flex items-center">
                        <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                          order.side === 'buy' 
                            ? 'bg-[#00D084]/20 text-[#00D084]' 
                            : 'bg-[#FF4747]/20 text-[#FF4747]'
                        }`}>
                          {order.side === 'buy' ? 'B' : 'S'}
                        </span>
                      </div>
                      <div className="text-right text-gray-300 font-mono flex items-center justify-end">
                        {(() => {
                          const quantity = view === 'orderbook' 
                            ? (order.quantity - order.filledQuantity)
                            : order.quantity;
                          
                          // Format based on size for better readability
                          if (quantity >= 1000000) {
                            return `${(quantity / 1000000).toFixed(1)}M`;
                          } else if (quantity >= 1000) {
                            return `${(quantity / 1000).toFixed(1)}K`;
                          } else {
                            return quantity.toFixed(0);
                          }
                        })()}
                      </div>
                      <div className={`text-right font-mono text-center font-medium flex items-center justify-end ${
                        order.side === 'buy' ? 'text-[#00D084]' : 'text-[#FF4747]'
                      }`}>
                        {order.price ? `$${order.price.toFixed(2)}` : 'MARKET'}
                      </div>
                      <div className="text-right text-gray-400 font-mono text-[10px] flex items-center justify-end">
                        {view === 'orderbook' ? (
                          <span className={`px-1 py-0.5 rounded text-[9px] ${
                            order.status === 'pending' 
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-blue-500/20 text-blue-400'
                          }`}>
                            {order.status === 'pending' ? 'OPEN' : 'PART'}
                          </span>
                        ) : (
                          formatTime(order.timestamp)
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
