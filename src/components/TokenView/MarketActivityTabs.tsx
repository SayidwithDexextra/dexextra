'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '@/hooks/useWallet';
import { useOrderBook } from '@/hooks/useOrderBook';
import { usePositions } from '@/hooks/usePositions';
import { initializeContracts } from '@/lib/contracts';
import { ErrorModal, SuccessModal } from '@/components/StatusModals';

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
  tradeId: string;
  buyer: Address;
  seller: Address;
  price: number;
  amount: number;
  tradeValue: number;
  buyerFee: number;
  sellerFee: number;
  buyerIsMargin: boolean;
  sellerIsMargin: boolean;
  timestamp: number;
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
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [isCancelingOrder, setIsCancelingOrder] = useState(false);
  const wallet = useWallet() as any;
  const walletAddress = wallet?.walletData?.address ?? wallet?.address ?? null;
  const [orderBookState, orderBookActions] = useOrderBook(symbol);
  const positionsState = usePositions(symbol);
  
  // Throttle and in-flight guards for order history
  const isFetchingHistoryRef = useRef(false);
  const lastHistoryFetchTsRef = useRef(0);

  // Add success/error modal state
  const [successModal, setSuccessModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });
  
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });

  // Helper functions for showing success/error messages
  const showSuccess = (message: string, title: string = 'Success') => {
    setSuccessModal({ isOpen: true, title, message });
  };

  const showError = (message: string, title: string = 'Error') => {
    setErrorModal({ isOpen: true, title, message });
  };

  // Add top-up state and handler
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpPositionId, setTopUpPositionId] = useState<string | null>(null);
  const [topUpSymbol, setTopUpSymbol] = useState<string>('');
  const [topUpAmount, setTopUpAmount] = useState<string>('');
  const [currentMargin, setCurrentMargin] = useState<number>(0);

  // Add close position state and handler
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closePositionId, setClosePositionId] = useState<string | null>(null);
  const [closeSymbol, setCloseSymbol] = useState<string>('');
  const [closeSize, setCloseSize] = useState<string>('');
  const [maxSize, setMaxSize] = useState<number>(0);

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

  const [closeError, setCloseError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const validateCloseSize = (size: string): string | null => {
    if (!size) return 'Please enter a close size';
    const amount = parseFloat(size);
    if (isNaN(amount)) return 'Invalid number format';
    if (amount <= 0) return 'Close size must be greater than 0';
    if (amount > maxSize) return 'Close size cannot exceed position size';
    return null;
  };

  const handleCloseSubmit = async () => {
    if (!closePositionId || !closeSize || !walletAddress) return;
    
    const validationError = validateCloseSize(closeSize);
    if (validationError) {
      setCloseError(validationError);
      return;
    }

    setIsClosing(true);
    setCloseError(null);
    
    try {
      const closeAmount = parseFloat(closeSize);
      const success = await orderBookActions.closePosition(closePositionId, closeAmount);
      if (!success) {
        throw new Error('Failed to close position');
      }

      setCloseSize('');
      setClosePositionId(null);
      setCloseSymbol('');
      setShowCloseModal(false);
    } catch (error: any) {
      console.error('Error closing position:', error);
      setCloseError(error?.message || 'Failed to close position. Please try again.');
    } finally {
      setIsClosing(false);
    }
  };

  // Keep positions and open orders in sync with state (no network calls here)
  useEffect(() => {
    if (!walletAddress) return;
    try {
      setPositions(positionsState.positions);
      const activeOrders = orderBookState.activeOrders;
      const symbolUpper = symbol.toUpperCase();

      const mappedOrders: Order[] = activeOrders.map(order => ({
        id: order.id,
        symbol: symbolUpper,
        side: order.isBuy ? 'BUY' : 'SELL',
        type: order.price > 0 ? 'LIMIT' : 'MARKET',
        price: order.price,
        size: order.quantity,
        filled: order.filledQuantity,
        status: order.status === 'pending' ? 'PENDING' : 
                order.status === 'partially_filled' ? 'PARTIAL' : 'FILLED',
        timestamp: order.timestamp || Date.now()
      }));
      setOpenOrders(mappedOrders);
    } catch (error) {
      console.error('Error syncing order data:', error);
    }
  }, [walletAddress, symbol, orderBookState, positionsState]);

  // Fetch order history ONLY when History tab is active, throttle and skip when hidden
  useEffect(() => {
    if (activeTab !== 'history') return;
    if (!walletAddress) return;

    let isMounted = true;

    const fetchHistory = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (isFetchingHistoryRef.current) return;
      const now = Date.now();
      if (now - lastHistoryFetchTsRef.current < 10000) return; // 10s cooldown

      isFetchingHistoryRef.current = true;
      setIsLoading(true);
      try {
        console.log('[DBG][history][request]', { metricId: symbol, trader: walletAddress });
        const params = new URLSearchParams({
          metricId: symbol, // symbol prop should be the DB metric_id
          trader: walletAddress,
          limit: '50'
        });
        const res = await fetch(`/api/orders/query?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          console.log('[DBG][history][response]', { total: data?.orders?.length, resolvedMarketId: data?.resolvedMarketId });
          const symbolUpper = symbol.toUpperCase();
          const hist = (data.orders || []).map((o: any) => ({
            id: o.order_id,
            symbol: symbolUpper,
            side: (o.side || 'BUY') as 'BUY' | 'SELL',
            type: (o.order_type || 'LIMIT') as 'MARKET' | 'LIMIT',
            price: typeof o.price === 'number' ? o.price : (o.price ? parseFloat(o.price) : 0),
            size: typeof o.quantity === 'number' ? o.quantity : parseFloat(o.quantity || '0'),
            filled: typeof o.filled_quantity === 'number' ? o.filled_quantity : parseFloat(o.filled_quantity || '0'),
            status: (o.order_status || 'PENDING').replace('PARTIAL','PARTIAL') as any,
            timestamp: new Date(o.updated_at || o.created_at).getTime(),
          }));
          if (isMounted) setOrderHistory(hist);
        }
        else {
          console.warn('[DBG][history][error-status]', res.status);
        }
      } catch (e) {
        console.error('[DBG][history][exception]', e);
        // keep existing orderHistory on error
      } finally {
        lastHistoryFetchTsRef.current = Date.now();
        isFetchingHistoryRef.current = false;
        if (isMounted) setIsLoading(false);
      }
    };

    fetchHistory();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchHistory();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      isMounted = false;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [activeTab, walletAddress, symbol]);

  const tabs = [
    { id: 'positions' as TabType, label: 'Positions', count: positions.length },
    { id: 'orders' as TabType, label: 'Open Orders', count: openOrders.length },
    { id: 'trades' as TabType, label: 'Trade History', count: orderBookState.tradeCount },
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
                              onClick={() => {
                                setClosePositionId(position.id);
                                setCloseSymbol(position.symbol);
                                setMaxSize(position.size);
                                setCloseSize(position.size.toString());
                                setShowCloseModal(true);
                              }}
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
                        <React.Fragment key={`${order.id}-${index}`}>
                          <tr className={`hover:bg-[#1A1A1A] transition-colors duration-200 ${index !== openOrders.length - 1 ? 'border-b border-[#1A1A1A]' : ''}`}>
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
                            <td className="px-2.5 py-2.5 text-right">
                              <button
                                onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 px-2 py-1 text-[10px] text-[#808080] hover:text-white hover:bg-[#2A2A2A] rounded"
                              >
                                {expandedOrderId === order.id ? 'Hide' : 'Manage'}
                              </button>
                            </td>
                          </tr>
                          {expandedOrderId === order.id && (
                            <tr className="bg-[#1A1A1A]">
                              <td colSpan={8} className="px-0">
                                <div className="px-2.5 py-2 border-t border-[#222222]">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                      <div className="flex items-center gap-3">
                                        <div className="flex flex-col gap-1">
                                          <span className="text-[10px] text-[#606060]">Order Value</span>
                                          <span className="text-[11px] font-medium text-white font-mono">
                                            ${(order.price * order.size).toFixed(2)}
                                          </span>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                          <span className="text-[10px] text-[#606060]">Fill Progress</span>
                                          <span className="text-[11px] font-medium text-white font-mono">
                                            {((order.filled / order.size) * 100).toFixed(1)}%
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={async () => {
                                            try {
                                              setIsCancelingOrder(true);
                                              const ok = await orderBookActions.cancelOrder(order.id);
                                              if (!ok) {
                                                showError('Failed to cancel order. Please try again.');
                                              } else {
                                                showSuccess('Order cancelled successfully');
                                                await orderBookActions.refreshOrders();
                                              }
                                            } catch (e) {
                                              showError('Cancellation failed. Please try again.');
                                            } finally {
                                              setIsCancelingOrder(false);
                                            }
                                          }}
                                          disabled={isCancelingOrder}
                                          className="px-3 py-1.5 text-[11px] font-medium text-red-400 hover:text-red-300 bg-red-400/5 hover:bg-red-400/10 rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          {isCancelingOrder ? 'Canceling...' : 'Cancel Order'}
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

  // Trade history pagination state
  const [tradeOffset, setTradeOffset] = useState(0);
  const [tradeLimit, setTradeLimit] = useState(10);
  const [hasMoreTrades, setHasMoreTrades] = useState(false);
  const [isLoadingTrades, setIsLoadingTrades] = useState(false);

  // Do not reset trade offset on tab changes to avoid re-fetching on click

  // Prefetch trade count for badge whenever wallet or symbol changes
  useEffect(() => {
    const prefetch = async () => {
      try {
        await orderBookActions.getUserTradeCountOnly?.();
      } catch {}
    };
    if (walletAddress) prefetch();
  }, [walletAddress, symbol, orderBookActions.getUserTradeCountOnly]);

  // Load trade history when pagination changes (not on tab click)
  useEffect(() => {
    let isMounted = true;
    let loadingTimeout: NodeJS.Timeout;
    
    const loadTradeHistory = async () => {
      if (!walletAddress) {
        // Clear loading state if we switch away from trades tab
        setIsLoadingTrades(false);
        return;
      }
      
      // Set a minimum loading time to prevent flickering
      loadingTimeout = setTimeout(() => {
        if (isMounted) {
          setIsLoadingTrades(true);
        }
      }, 100); // Small delay before showing loading state

      try {
        const { getUserTradeHistory } = orderBookActions;
        if (!getUserTradeHistory) {
          return;
        }

        const { trades: newTrades, hasMore } = await getUserTradeHistory(tradeOffset, tradeLimit);
        
        // Ensure we keep loading state visible for at least 500ms to prevent flickering
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Only update state if component is still mounted and we have trades
        if (isMounted) {
          if (newTrades && newTrades.length > 0) {
            setTrades(newTrades);
            setHasMoreTrades(hasMore);
          }
          setIsLoadingTrades(false);
        }
      } catch (error) {
        console.error('Failed to load trade history:', error);
        if (isMounted) {
          // Don't clear trades on error, keep existing state
          setIsLoadingTrades(false);
        }
      }
    };

    loadTradeHistory();

    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
      clearTimeout(loadingTimeout);
    };
  }, [walletAddress, tradeOffset, tradeLimit, orderBookActions.getUserTradeHistory]);

  const renderTradesTable = () => {

    if (isLoadingTrades) {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-[11px] font-medium text-[#808080]">
              Loading trade history...
            </span>
          </div>
        </div>
      );
    }

    if (!walletAddress) {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
            <span className="text-[11px] font-medium text-[#808080]">
              Connect wallet to view trade history
            </span>
          </div>
        </div>
      );
    }

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

    // Trade statistics
    const stats = {
      totalVolume: orderBookState.totalVolume,
      totalFees: orderBookState.totalFees,
      buyCount: orderBookState.buyCount,
      sellCount: orderBookState.sellCount,
      avgTradeSize: orderBookState.totalVolume / (orderBookState.buyCount + orderBookState.sellCount),
      avgFee: orderBookState.totalFees / (orderBookState.buyCount + orderBookState.sellCount),
      feeRate: (orderBookState.totalFees / orderBookState.totalVolume) * 100
    };

    return (
      <div className="space-y-4">
        {/* Trade Statistics and Controls Header */}
        <div className="bg-[#0F0F0F] rounded-md border border-[#222222] p-2 flex items-center justify-between overflow-x-auto">
          <div className="flex items-center gap-4">
            <h4 className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide whitespace-nowrap">Trading Performance</h4>
            <div className="flex items-center gap-4 text-nowrap">
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-[#606060] whitespace-nowrap">Volume:</span>
                <span className="text-[10px] font-medium text-white font-mono">${stats.totalVolume.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-[#606060] whitespace-nowrap">Fees:</span>
                <span className="text-[10px] font-medium text-white font-mono">${stats.totalFees.toFixed(4)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-[#606060] whitespace-nowrap">Buy/Sell:</span>
                <span className="text-[10px] font-medium text-white font-mono">{stats.buyCount}/{stats.sellCount}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-[#606060] whitespace-nowrap">Avg Size:</span>
                <span className="text-[10px] font-medium text-white font-mono">${stats.avgTradeSize.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={tradeLimit}
              onChange={(e) => {
                setTradeLimit(Number(e.target.value));
                setTradeOffset(0);
              }}
              className="bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-blue-400"
            >
              <option value="10">10 trades</option>
              <option value="25">25 trades</option>
              <option value="50">50 trades</option>
              <option value="100">100 trades</option>
            </select>
            <span className="text-[10px] text-[#606060]">
              {orderBookState.tradeCount} total trades
            </span>
          </div>
        </div>

        {/* Trade History Table */}
        <div className="overflow-auto scrollbar-hide max-h-96">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#222222]">
                <th className="text-left px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Side</th>
                <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Price</th>
                <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Size</th>
                <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Value</th>
                <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Fee</th>
                <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Type</th>
                <th className="text-right px-2.5 py-2 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Time</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, index) => {
                const isBuyer = trade.buyer.toLowerCase() === walletAddress?.toLowerCase();
                const side = isBuyer ? 'BUY' : 'SELL';
                const fee = isBuyer ? trade.buyerFee : trade.sellerFee;
                const isMargin = isBuyer ? trade.buyerIsMargin : trade.sellerIsMargin;

                return (
                  <tr key={`${trade.tradeId}-${index}`} className={`hover:bg-[#1A1A1A] transition-colors duration-200 ${index !== trades.length - 1 ? 'border-b border-[#1A1A1A]' : ''}`}>
                    <td className="px-2.5 py-2.5">
                      <span className={`text-[11px] font-medium ${side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{side}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-white font-mono">${trade.price.toFixed(2)}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-white font-mono">{trade.amount.toFixed(4)}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-white font-mono">${trade.tradeValue.toFixed(2)}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-white font-mono">${fee.toFixed(4)}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-[#9CA3AF]">{isMargin ? 'Margin' : 'Spot'}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right">
                      <span className="text-[11px] text-[#9CA3AF]">{formatTime(trade.timestamp)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Navigation Controls */}
        <div className="flex items-center justify-end pt-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTradeOffset(Math.max(0, tradeOffset - tradeLimit))}
              disabled={tradeOffset === 0}
              className="px-2 py-1 text-[11px] text-[#808080] hover:text-white disabled:text-[#404040] disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setTradeOffset(tradeOffset + tradeLimit)}
              disabled={!hasMoreTrades}
              className="px-2 py-1 text-[11px] text-[#808080] hover:text-white disabled:text-[#404040] disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>

        {/* Legend */}
        {/* <div className="text-[10px] text-[#606060] pt-2">
          <div>• Side: Your perspective (BUY/SELL)</div>
          <div>• Type: Margin or Spot trade</div>
          <div>• Fees shown are what you paid</div>
          <div>• Times shown in your local timezone</div>
        </div> */}
      </div>
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
      {/* Status Modals */}
      <style jsx global>{`
        .scrollbar-hide {
          overflow-y: auto !important;
          scrollbar-width: none !important; /* Firefox */
          -ms-overflow-style: none !important; /* IE and Edge */
          -webkit-overflow-scrolling: touch !important;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
          background: transparent !important;
        }
      `}</style>
      <ErrorModal
        isOpen={errorModal.isOpen}
        onClose={() => setErrorModal({ isOpen: false, title: '', message: '' })}
        title={errorModal.title}
        message={errorModal.message}
      />
      
      <SuccessModal
        isOpen={successModal.isOpen}
        onClose={() => setSuccessModal({ isOpen: false, title: '', message: '' })}
        title={successModal.title}
        message={successModal.message}
      />
      
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

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
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
          <div className="min-w-full h-full">
            {activeTab === 'positions' && renderPositionsTable()}
            {activeTab === 'orders' && renderOpenOrdersTable()}
            {activeTab === 'trades' && renderTradesTable()}
            {activeTab === 'history' && renderOrderHistoryTable()}
          </div>
        )}
      </div>

      {showCloseModal && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => {
            setShowCloseModal(false);
            setCloseSize('');
            setCloseError(null);
          }}
        >
          <div 
            className="bg-[#1A1A1A] border border-[#333333] rounded-md p-6 w-96 max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <img 
                    src="/Dexicon/LOGO-Dexetera-01.svg" 
                    alt="Dexetra Logo" 
                    className="w-5 h-5"
                  />
                  <h3 className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                    Close Position - {closeSymbol}
                  </h3>
                </div>
                <button
                  onClick={() => setShowCloseModal(false)}
                  className="text-[#606060] hover:text-white transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="h-[1px] bg-gradient-to-r from-transparent via-[#333333] to-transparent" />
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-2 bg-[#0F0F0F] rounded">
                <span className="text-[10px] text-[#808080]">Position Size</span>
                <span className="text-[11px] font-medium text-white font-mono">
                  {maxSize.toFixed(4)}
                </span>
              </div>
              
              <div>
                <label className="block text-[10px] text-[#9CA3AF] mb-1">
                  Close Size
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={closeSize}
                    onChange={(e) => {
                      setCloseSize(e.target.value);
                      setCloseError(null);
                    }}
                    className={`w-full bg-[#0F0F0F] border rounded px-3 py-2 text-[11px] text-white font-mono focus:outline-none transition-colors ${
                      closeError 
                        ? 'border-red-500 focus:border-red-400' 
                        : 'border-[#333333] focus:border-blue-400'
                    }`}
                    placeholder="Enter amount"
                    min="0"
                    max={maxSize}
                    step="0.0001"
                    disabled={isClosing}
                  />
                  <button
                    onClick={() => {
                      setCloseSize(maxSize.toString());
                      setCloseError(null);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-blue-400 hover:text-blue-300"
                    disabled={isClosing}
                  >
                    MAX
                  </button>
                </div>
                {closeError && (
                  <div className="mt-1">
                    <span className="text-[10px] text-red-400">{closeError}</span>
                  </div>
                )}
              </div>
              
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowCloseModal(false);
                    setCloseSize('');
                    setCloseError(null);
                  }}
                  className="px-3 py-1.5 text-[11px] font-medium text-[#808080] hover:text-white bg-[#2A2A2A] hover:bg-[#333333] rounded transition-colors"
                  disabled={isClosing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCloseSubmit}
                  disabled={isClosing || !closeSize || parseFloat(closeSize) <= 0 || parseFloat(closeSize) > maxSize}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1.5 ${
                    isClosing || !closeSize || parseFloat(closeSize) <= 0 || parseFloat(closeSize) > maxSize
                      ? 'text-[#606060] bg-[#2A2A2A] cursor-not-allowed'
                      : 'text-white bg-red-500 hover:bg-red-600'
                  }`}
                >
                  {isClosing ? (
                    <>
                      <div className="w-3 h-3 border-2 border-t-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
                      <span>Closing...</span>
                    </>
                  ) : (
                    'Confirm Close'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTopUpModal && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => {
            setShowTopUpModal(false);
            setTopUpAmount('');
          }}
        >
          <div 
            className="bg-[#1A1A1A] border border-[#333333] rounded-md p-6 w-96 max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
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