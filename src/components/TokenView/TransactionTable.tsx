'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { SmartContractEvent, PositionOpenedEvent, PositionClosedEvent, PositionLiquidatedEvent } from '@/types/events';
import { queryVAMMEvents } from '@/lib/blockchainEventQuerier';

interface Transaction {
  id: string;
  type: 'buy' | 'sell';
  fee: number; // Fee amount in USDC
  amount: string; // Position size
  transaction: string;
  wallet: string;
  fullWallet: string; // Store full wallet address for Polyscan links
  age: string;
  eventType?: string;
}

interface TransactionTableProps {
  vammAddress?: string;
}



// Utility functions for data transformation
function formatAddress(address: string): string {
  if (!address || address.length < 8) return address;
  return `${address.slice(0, 3)}...${address.slice(-3)}`;
}

function formatTimeAgo(timestamp: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - timestamp.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d`;
  if (diffHours > 0) return `${diffHours}h`;
  if (diffMins > 0) return `${diffMins}m`;
  return `${diffSecs}s`;
}

function formatTransactionHash(hash: string): string {
  if (!hash || hash.length < 8) return hash;
  return hash.slice(-4).toUpperCase();
}

function formatTokenAmount(amount: string, decimals: number = 18): string {
  try {
    const num = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    const wholePart = num / divisor;
    const fractionalPart = num % divisor;
    
    // Convert to number for easier formatting
    const wholeNum = Number(wholePart);
    const fractionalNum = Number(fractionalPart) / Number(divisor);
    const total = wholeNum + fractionalNum;
    
    if (total >= 1000000) {
      return `${(total / 1000000).toFixed(1)}M`;
    } else if (total >= 1000) {
      return `${(total / 1000).toFixed(1)}k`;
    } else {
      return total.toFixed(2);
    }
  } catch (error) {
    console.error('Error formatting token amount:', error);
    return '0';
  }
}

function formatUSDAmount(amount: string, decimals: number = 18): number {
  try {
    const num = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    const wholePart = num / divisor;
    const fractionalPart = num % divisor;
    
    // Convert to number for display
    const wholeNum = Number(wholePart);
    const fractionalNum = Number(fractionalPart) / Number(divisor);
    return wholeNum + fractionalNum;
  } catch (error) {
    console.error('Error formatting USD amount:', error);
    return 0;
  }
}

function transformEventToTransaction(event: SmartContractEvent): Transaction | null {
  try {
    // Handle both nested event structure (blockchain) and flat structure (database)
    const eventData = event as any;
    const fullWalletAddress = eventData.user ?? eventData.trader ?? '';
    const baseTransaction = {
      id: `${event.transactionHash}-${event.logIndex}`,
      transaction: formatTransactionHash(event.transactionHash),
      wallet: formatAddress(fullWalletAddress),
      fullWallet: fullWalletAddress,
      age: formatTimeAgo(new Date(event.timestamp)),
    };

    switch (event.eventType) {
      case 'PositionOpened': {
        return {
          ...baseTransaction,
          type: eventData.isLong ? 'buy' : 'sell',
          fee: formatUSDAmount(eventData.fee || '0', 6), // Fix: Use 18 decimals for fees
          amount: `${formatTokenAmount(eventData.size || '0', 6)} USD`, // Fix: Use formatTokenAmount with 18 decimals
          eventType: 'PositionOpened',
        };
      }
      
      case 'PositionClosed': {
        // For closed positions, we can't determine if it was originally long/short
        // So we use PnL to suggest the direction - positive PnL suggests profitable close
        const pnl = BigInt(eventData.pnl || '0');
        return {
          ...baseTransaction,
          type: pnl >= 0 ? 'buy' : 'sell', // Rough approximation
          fee: formatUSDAmount(eventData.fee || '0', 6), // Fix: Use 18 decimals for fees
          amount: `${formatTokenAmount(eventData.size || '0', 6)} USD`, // Fix: Use consistent formatting
          eventType: 'PositionClosed',
        };
      }
      
      case 'PositionLiquidated': {
        return {
          ...baseTransaction,
          type: 'sell', // Liquidations are typically represented as sells
          fee: formatUSDAmount(eventData.fee || '0', 6), // Fix: Use 18 decimals for fees
          amount: `${formatTokenAmount(eventData.size || '0', 6)} USD`, // Fix: Use consistent formatting
          eventType: 'PositionLiquidated',
        };
      }
      
      default:
        return null;
    }
  } catch (error) {
    console.error('Error transforming event to transaction:', error);
    return null;
  }
}

export default function TransactionTable({ vammAddress }: TransactionTableProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'database' | 'blockchain' | null>(null);
  const [isStoringToDatabase, setIsStoringToDatabase] = useState(false);
  const [newTransactionIds, setNewTransactionIds] = useState<Set<string>>(new Set());
  const previousTransactionIds = useRef<Set<string>>(new Set());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoad = useRef<boolean>(true);

  // Fetch function with fallback support
  const fetchTransactions = useCallback(async (showLoading = true) => {
    if (!vammAddress) return;

    if (showLoading) {
      setIsLoading(true);
    }
    setIsFetching(true);
    setError(null);

    try {
       console.log('📦 Fetching transactions for:', vammAddress);
      
      // APPROACH 1: Try database first (primary approach)
       console.log('📊 Attempting database query...');
      const response = await fetch(`/api/events?contractAddress=${vammAddress.toLowerCase()}&limit=100`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch events');
      }

       console.log('✅ Fetched', data.events.length, 'events from database');

      // Transform database events to transactions
      const dbTransactions = data.events
        .filter((event: any) => 
          ['PositionOpened', 'PositionClosed', 'PositionLiquidated'].includes(event.eventType)
        )
        .map(transformEventToTransaction)
        .filter((tx: Transaction | null): tx is Transaction => tx !== null)
        .sort((a: Transaction, b: Transaction) => {
          // Sort by most recent first
          const parseAge = (age: string) => {
            const match = age.match(/(\d+)([smhd])/);
            if (!match) return 0;
            const [, num, unit] = match;
            const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
            return parseInt(num) * (multipliers[unit as keyof typeof multipliers] || 0);
          };
          
          return parseAge(a.age) - parseAge(b.age);
        })
        .slice(0, 10);

      // If database returned transactions, use them
      if (dbTransactions.length > 0) {
        setTransactions(dbTransactions);
        setDataSource('database');
         console.log('✅ Using database transactions:', dbTransactions.length);
        return;
      }

      // APPROACH 2: Fallback to blockchain query if no database results
       console.log('📡 Database returned no transactions, falling back to blockchain query...');
      
      const blockchainResult = await queryVAMMEvents(vammAddress, {
        eventTypes: ['PositionOpened', 'PositionClosed', 'PositionLiquidated'],
        limit: 100,
        maxBlockRange: 10000 // Reasonable range for fallback
      });

      if (blockchainResult.error) {
        throw new Error(`Blockchain query failed: ${blockchainResult.error}`);
      }

       console.log('✅ Fetched', blockchainResult.events.length, 'events from blockchain');

      // Transform blockchain events to transactions
      const blockchainTransactions = blockchainResult.events
        .map(transformEventToTransaction)
        .filter((tx: Transaction | null): tx is Transaction => tx !== null)
        .sort((a: Transaction, b: Transaction) => {
          // Sort by most recent first
          const parseAge = (age: string) => {
            const match = age.match(/(\d+)([smhd])/);
            if (!match) return 0;
            const [, num, unit] = match;
            const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
            return parseInt(num) * (multipliers[unit as keyof typeof multipliers] || 0);
          };
          
          return parseAge(a.age) - parseAge(b.age);
        })
        .slice(0, 10);

      // ENHANCEMENT: Store blockchain events to database for future use
      if (blockchainResult.events.length > 0) {
         console.log('💾 Storing blockchain events to database for future use...');
        setIsStoringToDatabase(true);
        
        try {
          const storeResponse = await fetch('/api/events/store', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              events: blockchainResult.events,
              source: 'blockchain-fallback',
              contractAddress: vammAddress,
            }),
          });

          const storeResult = await storeResponse.json();
          
          if (storeResult.success) {
             console.log('✅ Stored blockchain events to database:', storeResult.summary);
          } else {
            console.warn('⚠️ Failed to store blockchain events:', storeResult.error);
            // Don't fail the main operation if storage fails
          }
        } catch (storeError) {
          console.warn('⚠️ Error storing blockchain events:', storeError);
          // Don't fail the main operation if storage fails
        } finally {
          setIsStoringToDatabase(false);
        }
      }

      setTransactions(blockchainTransactions);
      setDataSource('blockchain');
       console.log('✅ Using blockchain transactions:', blockchainTransactions.length);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('❌ Failed to fetch transactions:', errorMessage);
      setError(errorMessage);
      setDataSource(null);
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
      setIsFetching(false);
    }
  }, [vammAddress]);

  // Fetch on mount and when vammAddress changes
  useEffect(() => {
    fetchTransactions(true);
  }, [fetchTransactions]);

  // Set up live updates polling
  useEffect(() => {
    if (!vammAddress) return;

    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Set up new interval for live updates
    intervalRef.current = setInterval(() => {
      fetchTransactions(false); // Background fetch without loading spinner
    }, 10000); // Every 10 seconds for more frequent updates

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [vammAddress]);

  // Also add a manual refresh function
  const handleManualRefresh = useCallback(() => {
    fetchTransactions(true);
  }, [fetchTransactions]);

  // Track new transactions for animations
  useEffect(() => {
    const currentTransactionIds = new Set(transactions.map(tx => tx.id));
    const newIds = new Set<string>();
    
    // On initial load, animate all transactions
    if (isInitialLoad.current && transactions.length > 0) {
       console.log('🎬 Initial load - animating all', transactions.length, 'transactions');
      setNewTransactionIds(currentTransactionIds);
      isInitialLoad.current = false;
      
      // Clear animation classes after animation completes
      const timer = setTimeout(() => {
        setNewTransactionIds(new Set());
      }, 1600); // Match total animation duration (0.8s slide + 0.8s fade)
      
      // Update previous transaction IDs for next comparison
      previousTransactionIds.current = currentTransactionIds;
      
      return () => clearTimeout(timer);
    }
    
    // For subsequent updates, only animate genuinely new transactions
    if (!isInitialLoad.current && previousTransactionIds.current.size > 0) {
      currentTransactionIds.forEach(id => {
        if (!previousTransactionIds.current.has(id)) {
          newIds.add(id);
        }
      });

      // Only animate if there are genuinely new transactions
      if (newIds.size > 0) {
         console.log('🎬 Animating', newIds.size, 'new transactions:', Array.from(newIds));
        setNewTransactionIds(newIds);
        
        // Clear animation classes after animation completes
        const timer = setTimeout(() => {
          setNewTransactionIds(new Set());
        }, 1600); // Match total animation duration (0.8s slide + 0.8s fade)
        
        // Update previous transaction IDs for next comparison
        previousTransactionIds.current = currentTransactionIds;
        
        return () => clearTimeout(timer);
      }
    }

    // Update previous transaction IDs for next comparison (for non-animated updates)
    previousTransactionIds.current = currentTransactionIds;
  }, [transactions]);

  return (
    <div className="flex-1 flex flex-col">
      <div className="rounded-md bg-[#0A0A0A] border border-[#333333] p-3 flex flex-col" style={{ height: '100%' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">Recent Transactions</h3>
          {vammAddress && (
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                !isLoading && !isStoringToDatabase && transactions.length > 0 ? 'bg-green-500' : 
                isLoading || isFetching ? 'bg-yellow-500' : 
                isStoringToDatabase ? 'bg-blue-500' :
                'bg-gray-500'
              }`}></div>
              <span className="text-xs text-zinc-400">
                {isLoading ? 'Loading...' : 
                 isFetching ? 'Updating...' : 
                 isStoringToDatabase ? 'Saving to database...' :
                 transactions.length > 0 ? `LIVE (${dataSource})` : 'No data'}
              </span>
              {!isLoading && (
                <button
                  onClick={handleManualRefresh}
                  disabled={isFetching}
                  className="text-xs text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
                  title="Refresh transactions"
                >
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
        
        {error && (
          <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-red-400 hover:text-red-300"
            >
              ×
            </button>
          </div>
        )}
        
        {/* Transaction Table */}
        <div className="overflow-y-auto transaction-table-scroll" style={{ height: '250px' }}>
          {isLoading && transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-6 h-6 border-2 border-[#22C55E] border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-[#6B7280] text-sm">Loading transactions...</p>
              <p className="text-[#6B7280] text-xs mt-2">Fetching from database and blockchain...</p>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-[#1F1F1F] flex items-center justify-center mb-4">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-[#6B7280]">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <path d="M12 8v8M8 12h8"/>
                </svg>
              </div>
              <h4 className="text-[#9CA3AF] font-medium mb-2">No transactions found</h4>
              <p className="text-[#6B7280] text-sm max-w-[200px]">
                This market doesn't have any trading history yet
              </p>
              <button 
                onClick={() => fetchTransactions(true)}
                disabled={isLoading}
                className="mt-3 px-3 py-1 text-xs bg-[#22C55E]/20 hover:bg-[#22C55E]/30 text-[#22C55E] rounded border border-[#22C55E]/40 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1F1F1F]">
                    <th className="text-left py-2 px-2 text-[#9CA3AF] font-medium text-sm">
                      Age
                      {isFetching && !isLoading && (
                        <span className="ml-2 inline-block w-3 h-3 border border-[#22C55E] border-t-transparent rounded-full animate-spin"></span>
                      )}
                    </th>
                    <th className="text-left py-2 px-2 text-[#9CA3AF] font-medium text-sm">Type</th>
                    <th className="text-left py-2 px-2 text-[#9CA3AF] font-medium text-sm">Fee (USDC)</th>
                    <th className="text-left py-2 px-2 text-[#9CA3AF] font-medium text-sm">Position Size</th>
                    <th className="text-left py-2 px-2 text-[#9CA3AF] font-medium text-sm">Transaction</th>
                    <th className="text-left py-2 px-2 text-[#9CA3AF] font-medium text-sm">Wallet</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, index) => {
                    const isNewTransaction = newTransactionIds.has(tx.id);
                    return (
                      <tr 
                        key={tx.id} 
                        className={`
                          border-b border-[#1F1F1F] hover:bg-[rgba(255,255,255,0.02)] transition-colors duration-150
                          ${index === transactions.length - 1 ? 'border-b-0' : ''}
                          ${isNewTransaction ? 'transaction-slide-in' : ''}
                                                `}
                      >
                        <td className="py-2 px-2 text-[#6B7280] text-sm">
                          {tx.age}
                        </td>
                        <td className="py-2 px-2">
                          <span className={`
                            inline-block px-2 py-1 rounded text-xs font-medium
                            ${tx.type === 'buy' 
                              ? 'bg-[rgba(34,197,94,0.1)] text-[#22C55E]' 
                              : 'bg-[rgba(239,68,68,0.1)] text-[#EF4444]'
                            }
                          `}>
                            {tx.type}
                            {tx.eventType && tx.eventType !== 'PositionOpened' && (
                              <span className="ml-1 text-xs opacity-60">
                                {tx.eventType === 'PositionClosed' ? 'C' : 'L'}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-white font-mono text-sm">
                          <div className="flex items-center gap-1">
                            <span className="text-[#22C55E]">$</span>
                            {tx.fee === 0 ? '0' : tx.fee.toFixed(2)}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-white text-sm font-medium">
                          {tx.amount}
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            <a 
                              href={`https://polygonscan.com/tx/${tx.id.split('-')[0]}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#22C55E] text-sm hover:text-[#16A34A] transition-colors cursor-pointer"
                            >
                              {tx.transaction}
                            </a>
                            <a 
                              href={`https://polygonscan.com/tx/${tx.id.split('-')[0]}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#6B7280] hover:text-white transition-colors"
                            >
                              <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M10 6v2H5v11h11v-5h2v6a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1h6zM21 3v8h-2V6.413l-7.793 7.794-1.414-1.414L17.585 5H13V3h8z"/>
                              </svg>
                            </a>
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[#6B7280] text-sm">{tx.wallet}</span>
                            <a 
                              href={`https://polygonscan.com/address/${tx.fullWallet}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#6B7280] hover:text-white transition-colors"
                            >
                              <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M10 6v2H5v11h11v-5h2v6a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1h6zM21 3v8h-2V6.413l-7.793 7.794-1.414-1.414L17.585 5H13V3h8z"/>
                              </svg>
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      
      {/* Animation styles and custom scrollbar */}
      <style jsx>{`
        /* Webkit scrollbar styles */
        :global(.transaction-table-scroll::-webkit-scrollbar) {
          width: 2px;
        }
        
        :global(.transaction-table-scroll::-webkit-scrollbar-track) {
          background: transparent;
        }
        
        :global(.transaction-table-scroll::-webkit-scrollbar-thumb) {
          background: #22C55E;
          border-radius: 2px;
        }
        
        :global(.transaction-table-scroll::-webkit-scrollbar-thumb:hover) {
          background: #16A34A;
        }
        
        /* Firefox scrollbar styles */
        :global(.transaction-table-scroll) {
          scrollbar-width: thin;
          scrollbar-color: #22C55E transparent;
        }
        
        @keyframes slideInFromRight {
          0% {
            transform: translateX(100%);
            opacity: 0;
            background: rgba(34, 197, 94, 0.08);
            border-left: 2px solid #22C55E;
          }
          50% {
            opacity: 0.5;
            background: rgba(34, 197, 94, 0.08);
            border-left: 2px solid #22C55E;
          }
          100% {
            transform: translateX(0);
            opacity: 1;
            background: rgba(34, 197, 94, 0.08);
            border-left: 2px solid #22C55E;
          }
        }
        
        @keyframes fadeToNormal {
          0% {
            background: rgba(34, 197, 94, 0.08);
            border-left: 2px solid #22C55E;
          }
          100% {
            background: transparent;
            border-left: 2px solid transparent;
          }
        }
        
        .transaction-slide-in {
          animation: slideInFromRight 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
                     fadeToNormal 0.8s 0.8s ease-out forwards;
        }
      `}</style>
    </div>
  );
} 