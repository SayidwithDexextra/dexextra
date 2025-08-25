'use client';

import React, { useState, useMemo } from 'react';
import { useMarketOrders } from '@/hooks/useOrders';
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
  const [filter, setFilter] = useState<'all' | 'open' | 'closed' | 'liquidated'>('all');
  const [sortBy, setSortBy] = useState<'timestamp' | 'pnl' | 'amount'>('timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Fetch real orders using the new hook
  const { 
    transactions, 
    marketDepth, 
    isLoading, 
    error 
  } = useMarketOrders(metricId, true);

  // Transform market depth to order book entries
  const orderBook = useMemo(() => {
    if (!marketDepth) return [];
    return transformMarketDepthToOrderBook(marketDepth.bids, marketDepth.asks);
  }, [marketDepth]);

  const filteredAndSortedTransactions = useMemo(() => {
    let filtered = transactions;

    // Apply filter
    if (filter !== 'all') {
      filtered = filtered.filter(tx => tx.status === filter);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue, bValue;
      
      switch (sortBy) {
        case 'timestamp':
          aValue = a.timestamp;
          bValue = b.timestamp;
          break;
        case 'pnl':
          aValue = a.pnl || 0;
          bValue = b.pnl || 0;
          break;
        case 'amount':
          aValue = a.amount;
          bValue = b.amount;
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
  }, [transactions, filter, sortBy, sortOrder]);

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
          <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-[10px] text-gray-500">LIVE</span>
        </div>
      </div>

      {/* Filters - Ultra Compact */}
      {view === 'transactions' && (
        <div className="mb-2">
          {/* Loading/Error States */}
          {isLoading ? (
            <div className="text-[10px] text-gray-500 text-center py-2">
              Loading orders...
            </div>
          ) : error ? (
            <div className="text-[10px] text-red-500 text-center py-2">
              {error}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-0.5 mb-1">
                {(['all', 'open', 'closed', 'liquidated'] as const).map((filterOption) => (
                  <button
                    key={filterOption}
                    onClick={() => setFilter(filterOption)}
                    className={`py-0.5 px-1 rounded text-[10px] font-medium transition-colors uppercase ${
                      filter === filterOption
                        ? 'bg-[#333333] text-white'
                        : 'bg-[#1A1A1A] text-gray-500 hover:text-white'
                    }`}
                  >
                    {filterOption === 'liquidated' ? 'LIQ' : filterOption}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-gray-500 text-center">
                {filteredAndSortedTransactions.length}
                {!metricId && (
                  <span className="block text-[9px] text-gray-600">
                    Connect wallet to see orders
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Order Book Column Headers - Ultra Compact */}
      {view === 'orderbook' && (
        <div className="mb-1">
          <div className="grid grid-cols-3 gap-1 text-[10px] font-medium text-gray-500 px-1">
            <div>SIZE</div>
            <div className="text-center">PRICE</div>
            <div className="text-right">MINE</div>
          </div>
        </div>
      )}

      {/* Transactions Table */}
      {view === 'transactions' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="overflow-x-auto flex-1">
            <div className="min-h-full">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#0A0A0A] z-10">
                  <tr className="border-b border-[#333333]">
                    <th className="text-left py-0.5 text-gray-500 font-medium text-[10px]">SIDE</th>
                    <th className="text-right py-0.5 text-gray-500 font-medium text-[10px]">SIZE</th>
                    <th className="text-right py-0.5 text-gray-500 font-medium text-[10px]">PRICE</th>
                  </tr>
                </thead>
                <tbody className="transaction-table-scroll">
                  {filteredAndSortedTransactions.map((tx, index) => (
                    <tr 
                      key={tx.id} 
                      className="hover:bg-[#1A1A1A] transition-colors"
                    >
                      <td className="py-0.5">
                        <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                          tx.type === 'long' 
                            ? 'bg-[#00D084]/20 text-[#00D084]' 
                            : 'bg-[#FF4747]/20 text-[#FF4747]'
                        }`}>
                          {tx.type === 'long' ? 'L' : 'S'}
                        </span>
                      </td>
                      <td className="py-0.5 text-right text-gray-300 font-mono text-[11px]">
                        {(tx.amount / 1000).toFixed(0)}K
                      </td>
                      <td className="py-0.5 text-right text-gray-300 font-mono text-[11px]">
                        {tx.price.toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Order Book Table */}
      {view === 'orderbook' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="overflow-y-auto order-book-scroll">
            {(() => {
              if (isLoading) {
                return (
                  <div className="text-[10px] text-gray-500 text-center py-4">
                    Loading order book...
                  </div>
                );
              }

              if (error) {
                return (
                  <div className="text-[10px] text-red-500 text-center py-4">
                    Error loading order book
                  </div>
                );
              }

              if (!marketDepth || (marketDepth.asks.length === 0 && marketDepth.bids.length === 0)) {
                return (
                  <div className="text-[10px] text-gray-500 text-center py-4">
                    No orders found
                    {!metricId && (
                      <div className="text-[9px] text-gray-600 mt-1">
                        Market data unavailable
                      </div>
                    )}
                  </div>
                );
              }

              const asks = marketDepth.asks.slice().reverse(); // Highest ask first
              const bids = marketDepth.bids; // Already sorted highest first
              const maxTotal = Math.max(...orderBook.map(o => o.total));
              const lastPrice = marketDepth.midPrice || currentPrice || 0;
              const spread = marketDepth.spread;

              return (
                <div className="space-y-0">
                  {/* Asks Section */}
                  <div>
                    {asks.map((order, index) => {
                      const maxQuantity = Math.max(...[...asks, ...bids].map(o => o.quantity));
                      const fillPercentage = (order.quantity / maxQuantity) * 100;
                      const mySize = null; // Would be calculated from user's orders
                      
                      return (
                        <div 
                          key={order.id} 
                          className="relative hover:bg-[#1A1A1A] transition-colors group cursor-pointer"
                        >
                          {/* Background depth bar */}
                          <div 
                            className="absolute left-0 top-0 h-full bg-[#FF4747] opacity-12 rounded-xl"
                            style={{ width: `${fillPercentage}%` }}
                          />
                          
                          {/* Content */}
                          <div className="relative grid grid-cols-3 gap-1 py-0.5 px-1 text-[11px]">
                            <div className="text-gray-300 font-mono">
                              {(order.quantity / 1000).toFixed(0)}K
                            </div>
                            <div className="text-[#FF4747] font-mono text-center font-medium">
                              {order.price.toFixed(0)}
                            </div>
                            <div className="text-gray-300 font-mono text-right">
                              {mySize || '-'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Spread Section */}
                  <div className="py-1 px-1 bg-[#1A1A1A] border-y border-[#333333]">
                    <div className="grid grid-cols-3 gap-1 text-[10px]">
                      <div className="text-gray-500 font-mono">SPR</div>
                      <div className="text-gray-300 font-mono text-center">
                        {spread.toFixed(0)}
                      </div>
                      <div className="text-gray-300 font-mono text-right">
                        {((spread / lastPrice) * 100).toFixed(2)}%
                      </div>
                    </div>
                  </div>

                  {/* Bids Section */}
                  <div>
                    {bids.map((order, index) => {
                      const maxQuantity = Math.max(...[...asks, ...bids].map(o => o.quantity));
                      const fillPercentage = (order.quantity / maxQuantity) * 100;
                      const mySize = null; // Would be calculated from user's orders
                      
                      return (
                        <div 
                          key={order.id} 
                          className="relative hover:bg-[#1A1A1A] transition-colors group cursor-pointer"
                        >
                          {/* Background depth bar */}
                          <div 
                            className="absolute left-0 top-0 h-full bg-[#00D084] opacity-12 rounded-xl"
                            style={{ width: `${fillPercentage}%` }}
                          />
                          
                          {/* Content */}
                          <div className="relative grid grid-cols-3 gap-1 py-0.5 px-1 text-[11px]">
                            <div className="text-gray-300 font-mono">
                              {(order.quantity / 1000).toFixed(0)}K
                            </div>
                            <div className="text-[#00D084] font-mono text-center font-medium">
                              {order.price.toFixed(0)}
                            </div>
                            <div className="text-gray-300 font-mono text-right">
                              {mySize || '-'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}



      {/* Hidden Scrollbar Styles */}
      <style jsx>{`
        /* Hide scrollbars for all scrollable areas */
        :global(.transaction-table-container::-webkit-scrollbar),
        :global(.transaction-table-scroll::-webkit-scrollbar),
        :global(.order-book-scroll::-webkit-scrollbar) {
          display: none;
        }
        
        :global(.transaction-table-container),
        :global(.transaction-table-scroll),
        :global(.order-book-scroll) {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
