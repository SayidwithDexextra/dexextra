'use client';

import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '@/hooks/useWallet';
import { useOrderBook } from '@/hooks/useOrderBook';
import { usePositions } from '@/hooks/usePositions';
import { initializeContracts } from '@/lib/contracts';

interface Position {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  pnlPercent: number;
  liquidationPrice: number;
  margin: number;
  leverage: number;
  timestamp: number;
}

interface Order {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  price: number;
  size: number;
  filled: number;
  status: 'PENDING' | 'PARTIAL' | 'FILLED' | 'CANCELLED';
  timestamp: number;
}

interface Trade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  fee: number;
  timestamp: number;
  txHash?: string;
}

type TabType = 'positions' | 'orders' | 'trades' | 'history';

interface MarketActivityTabsProps {
  symbol: string;
  className?: string;
}

export default function MarketActivityTabs({ symbol, className = '' }: MarketActivityTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>('positions');
  const [positions, setPositions] = useState<Position[]>([]);
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedPositionId, setExpandedPositionId] = useState<string | null>(null);
  const wallet = useWallet() as any;
  const walletAddress = wallet?.walletData?.address ?? wallet?.address ?? null;
  const [orderBookState, orderBookActions] = useOrderBook(symbol);
  const positionsState = usePositions(symbol);

  // Add top-up state and handler
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpPositionId, setTopUpPositionId] = useState<string | null>(null);
  const [topUpSymbol, setTopUpSymbol] = useState<string>('');
  const [topUpAmount, setTopUpAmount] = useState<string>('');
  const [currentMargin, setCurrentMargin] = useState<number>(0);

  // Handle top-up action
  const handleTopUp = (positionId: string, symbol: string, currentMargin: number) => {
    setTopUpPositionId(positionId);
    setTopUpSymbol(symbol);
    setCurrentMargin(currentMargin);
    setShowTopUpModal(true);
  };

  const handleTopUpSubmit = async () => {
    if (!topUpPositionId || !topUpAmount || !walletAddress) return;
    
    try {
      console.log(`Topping up position ${topUpPositionId} for ${topUpSymbol} with amount ${topUpAmount}`);
      // Resolve signer from injected provider
      let signer: ethers.Signer | null = null;
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const browserProvider = new ethers.BrowserProvider((window as any).ethereum);
        signer = await browserProvider.getSigner();
      }
      if (!signer) {
        throw new Error('No signer available. Please connect your wallet.');
      }

      // Initialize contracts using shared config (includes CoreVault at configured address)
      const contracts = await initializeContracts(signer);

      // Use actual marketId from position id (already bytes32 hex)
      const marketId = topUpPositionId as string;
      const amount6 = ethers.parseUnits(topUpAmount, 6);

      // Optional: liquidation price before
      try {
        const [liqBefore] = await contracts.vault.getLiquidationPrice(walletAddress, marketId);
        console.log('Liq before:', String(liqBefore));
      } catch {}

      const tx = await contracts.vault.topUpPositionMargin(marketId, amount6);
      console.log('Transaction sent, waiting for confirmation...');
      await tx.wait();
      console.log('Top-up successful!');

      // Optional: liquidation price after
      try {
        const [liqAfter] = await contracts.vault.getLiquidationPrice(walletAddress, marketId);
        console.log('Liq after:', String(liqAfter));
      } catch {}

      setTopUpAmount('');
      setTopUpPositionId(null);
      setTopUpSymbol('');
      setShowTopUpModal(false);
      alert('Position topped up successfully!');
    } catch (error) {
      console.error('Error topping up position:', error);
      alert('Failed to top up position. Please try again.');
    }
  };

  // Fetch data based on active tab
  useEffect(() => {
    if (!walletAddress) return;
    
    const fetchData = async () => {
      setIsLoading(true);
      try {
        setPositions(positionsState.positions);
        const activeOrders = orderBookState.activeOrders;
        const symbolUpper = symbol.toUpperCase();

        const pendingOrders = activeOrders.filter(order => 
          order.status === 'pending' || order.status === 'partially_filled'
        );
        
        const mappedOrders: Order[] = pendingOrders.map(order => ({
          id: order.id,
          symbol: symbolUpper,
          side: order.isBuy ? 'BUY' : 'SELL',
          type: order.price > 0 ? 'LIMIT' : 'MARKET',
          price: order.price,
          size: order.quantity,
          filled: order.filledQuantity,
          status: order.status === 'pending' ? 'PENDING' : 'PARTIAL',
          timestamp: order.timestamp || Date.now()
        }));
        setOpenOrders(mappedOrders);

        const filledOrders = activeOrders.filter(order => 
          order.filledQuantity > 0 && order.status === 'filled'
        );
        
        const mappedTrades: Trade[] = filledOrders.map(order => ({
          id: order.id,
          symbol: symbolUpper,
          side: order.isBuy ? 'BUY' : 'SELL',
          price: order.price,
          size: order.filledQuantity,
          fee: 0,
          timestamp: order.timestamp || Date.now()
        }));
        setTrades(mappedTrades);

        const mappedHistory: Order[] = activeOrders.map(order => ({
          id: order.id,
          symbol: symbolUpper,
          side: order.isBuy ? 'BUY' : 'SELL',
          type: order.price > 0 ? 'LIMIT' : 'MARKET',
          price: order.price,
          size: order.quantity,
          filled: order.filledQuantity,
          status: order.status === 'filled' ? 'FILLED' : 
                 order.status === 'cancelled' ? 'CANCELLED' : 
                 order.status === 'partially_filled' ? 'PARTIAL' : 'PENDING',
          timestamp: order.timestamp || Date.now()
        }));
        setOrderHistory(mappedHistory);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [activeTab, walletAddress, symbol, orderBookState, positionsState]);

  const tabs = [
    { id: 'positions' as TabType, label: 'Positions', count: positions.length },
    { id: 'orders' as TabType, label: 'Open Orders', count: openOrders.length },
    { id: 'trades' as TabType, label: 'Trade History', count: trades.length },
    { id: 'history' as TabType, label: 'Order History', count: orderHistory.length },
  ];

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderPositionsTable = () => {
    if (positions.length === 0) {
  return (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">
                        No open positions
                      </span>
                    </div>
                  </div>
      );
    }

    return (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#222222]">
                        <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Symbol</th>
                        <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Side</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Size</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Entry</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Mark</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">PnL</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Liq Price</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((position, index) => (
            <React.Fragment key={`${position.id}-${index}`}>
              <tr className={`group/row hover:bg-[#1A1A1A] transition-colors duration-200 ${
                            index !== positions.length - 1 ? 'border-b border-[#1A1A1A]' : ''
              }`}>
                          <td className="px-2.5 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                position.side === 'LONG' ? 'bg-green-400' : 'bg-red-400'
                              }`} />
                              <span className="text-[11px] font-medium text-white">{position.symbol}</span>
                            </div>
                          </td>
                          <td className="px-2.5 py-2.5">
                            <span className={`text-[11px] font-medium ${
                              position.side === 'LONG' ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {position.side}
                            </span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">{position.size.toFixed(4)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">${position.entryPrice.toFixed(2)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">${position.markPrice.toFixed(2)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <div className="flex justify-end">
                              <span className="relative inline-block pr-4">
                                <span className={`text-[11px] font-medium font-mono ${
                                  position.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                                }`}>
                                  {position.pnl >= 0 ? '+' : ''}{position.pnl.toFixed(2)}
                                </span>
                                <span className={`absolute -top-2 -right-0 text-[10px] font-mono ${
                                  position.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                                }`}>
                                  {position.pnlPercent >= 0 ? '+' : ''}{position.pnlPercent.toFixed(2)}%
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">${position.liquidationPrice.toFixed(2)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                  <button 
                    onClick={() => setExpandedPositionId(expandedPositionId === position.id ? null : position.id)}
                    className="opacity-0 group-hover/row:opacity-100 transition-opacity duration-200 px-2 py-1 text-[10px] text-[#808080] hover:text-white hover:bg-[#2A2A2A] rounded"
                  >
                    {expandedPositionId === position.id ? 'Hide' : 'Manage'}
                            </button>
                          </td>
                        </tr>
              {expandedPositionId === position.id && (
                <tr className="bg-[#1A1A1A]">
                  <td colSpan={8} className="px-0">
                    <div className="px-2.5 py-2 border-t border-[#222222]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] text-[#606060]">Current Margin</span>
                              <span className="text-[11px] font-medium text-white font-mono">
                                ${position.margin.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] text-[#606060]">Leverage</span>
                              <span className="text-[11px] font-medium text-white font-mono">
                                {position.leverage}x
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleTopUp(position.id, position.symbol, position.margin)}
                              className="px-3 py-1.5 text-[11px] font-medium text-green-400 hover:text-green-300 bg-green-400/5 hover:bg-green-400/10 rounded transition-colors duration-200"
                            >
                              Top Up Position
                            </button>
                            <button
                              onClick={() => console.log('Close position', position.id)}
                              className="px-3 py-1.5 text-[11px] font-medium text-red-400 hover:text-red-300 bg-red-400/5 hover:bg-red-400/10 rounded transition-colors duration-200"
                            >
                              Close Position
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                          </td>
                        </tr>
              )}
            </React.Fragment>
                      ))}
                    </tbody>
                  </table>
    );
  };

  const renderOpenOrdersTable = () => {
    if (openOrders.length === 0) {
      return (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">
                        No open orders
                      </span>
                    </div>
                  </div>
      );
    }

    return (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#222222]">
                        <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Side</th>
                        <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Type</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Price</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Size</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Filled</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Status</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openOrders.map((order, index) => (
                        <tr key={`${order.id}-${index}`} className={`hover:bg-[#1A1A1A] transition-colors duration-200 ${index !== openOrders.length - 1 ? 'border-b border-[#1A1A1A]' : ''}`}>
                          <td className="px-2.5 py-2.5">
                            <span className={`text-[11px] font-medium ${order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{order.side}</span>
                          </td>
                          <td className="px-2.5 py-2.5">
                            <span className="text-[11px] text-white">{order.type}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">${order.price.toFixed(2)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">{order.size.toFixed(4)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">{order.filled.toFixed(4)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-[#9CA3AF]">{order.status}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-[#9CA3AF]">{formatTime(order.timestamp)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
    );
  };

  const renderTradesTable = () => {
    if (trades.length === 0) {
      return (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">
                        No trades yet
                      </span>
                    </div>
                  </div>
      );
    }

    return (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#222222]">
                        <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Side</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Price</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Size</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Fee</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((trade, index) => (
                        <tr key={`${trade.id}-${index}`} className={`hover:bg-[#1A1A1A] transition-colors duration-200 ${index !== trades.length - 1 ? 'border-b border-[#1A1A1A]' : ''}`}>
                          <td className="px-2.5 py-2.5">
                            <span className={`text-[11px] font-medium ${trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{trade.side}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">${trade.price.toFixed(2)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">{trade.size.toFixed(4)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">${trade.fee.toFixed(2)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-[#9CA3AF]">{formatTime(trade.timestamp)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
    );
  };

  const renderOrderHistoryTable = () => {
    if (orderHistory.length === 0) {
      return (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">
                        No order history
                      </span>
                    </div>
                  </div>
      );
    }

    return (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#222222]">
                        <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Side</th>
                        <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Type</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Price</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Size</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Filled</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Status</th>
                        <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderHistory.map((order, index) => (
                        <tr key={`${order.id}-${index}`} className={`hover:bg-[#1A1A1A] transition-colors duration-200 ${index !== orderHistory.length - 1 ? 'border-b border-[#1A1A1A]' : ''}`}>
                          <td className="px-2.5 py-2.5">
                            <span className={`text-[11px] font-medium ${order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{order.side}</span>
                          </td>
                          <td className="px-2.5 py-2.5">
                            <span className="text-[11px] text-white">{order.type}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">${order.price.toFixed(2)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">{order.size.toFixed(4)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-white font-mono">{order.filled.toFixed(4)}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-[#9CA3AF]">{order.status}</span>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            <span className="text-[11px] text-[#9CA3AF]">{formatDate(order.timestamp)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
    );
  };

  return (
    <div className={`group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 flex flex-col ${className}`}>
      <div className="flex items-center justify-between border-b border-[#222222] p-2.5 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-2.5 py-1.5 text-[11px] font-medium rounded transition-all duration-200 flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'text-white bg-[#1A1A1A] border border-[#333333]'
                  : 'text-[#808080] hover:text-white hover:bg-[#1A1A1A] border border-transparent hover:border-[#222222]'
              }`}
            >
              <span>{tab.label}</span>
              <div className="text-[10px] text-[#606060] bg-[#2A2A2A] px-1.5 py-0.5 rounded">
                {tab.count}
              </div>
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-2">
          {isLoading ? (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[10px] text-[#606060]">Loading...</span>
            </>
          ) : (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-[10px] text-[#606060]">Live</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {!walletAddress ? (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">
                Connect wallet to view {activeTab}
                      </span>
                    </div>
                  </div>
                ) : (
          <div className="min-w-full">
            {activeTab === 'positions' && renderPositionsTable()}
            {activeTab === 'orders' && renderOpenOrdersTable()}
            {activeTab === 'trades' && renderTradesTable()}
            {activeTab === 'history' && renderOrderHistoryTable()}
          </div>
        )}
      </div>

      {showTopUpModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1A1A1A] border border-[#333333] rounded-md p-6 w-96 max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                Top Up Position - {topUpSymbol}
              </h3>
              <button
                onClick={() => setShowTopUpModal(false)}
                className="text-[#606060] hover:text-white transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-2 bg-[#0F0F0F] rounded">
                <span className="text-[10px] text-[#808080]">Current Margin</span>
                <span className="text-[11px] font-medium text-white font-mono">
                  ${currentMargin.toFixed(2)}
                              </span>
                            </div>
              
              <div>
                <label className="block text-[10px] text-[#9CA3AF] mb-1">
                  Additional Margin (USDC)
                </label>
                <input
                  type="number"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="w-full bg-[#0F0F0F] border border-[#333333] rounded px-3 py-2 text-[11px] text-white font-mono focus:outline-none focus:border-blue-400 transition-colors"
                  placeholder="Enter amount"
                  min="0"
                  step="0.01"
                />
              </div>
              
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowTopUpModal(false);
                    setTopUpAmount('');
                  }}
                  className="px-3 py-1.5 text-[11px] font-medium text-[#808080] hover:text-white bg-[#2A2A2A] hover:bg-[#333333] rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTopUpSubmit}
                  disabled={!topUpAmount || parseFloat(topUpAmount) <= 0}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded transition-colors ${
                    !topUpAmount || parseFloat(topUpAmount) <= 0
                      ? 'text-[#606060] bg-[#2A2A2A] cursor-not-allowed'
                      : 'text-white bg-blue-500 hover:bg-blue-600'
                  }`}
                >
                  Confirm Top-Up
                </button>
              </div>
            </div>
          </div>
        </div>
        )}
    </div>
  );
}