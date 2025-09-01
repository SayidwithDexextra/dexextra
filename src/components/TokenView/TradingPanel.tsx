'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TokenData } from '@/types/token';
import { useWallet } from '@/hooks/useWallet';
import { useOrders, useUserOrders, useUserMarketOrders } from '@/hooks/useOrders';
import { useOrderbookMarket } from '@/hooks/useOrderbookMarket';
import { ErrorModal, SuccessModal } from '@/components/StatusModals';
import { formatEther } from 'viem';
import { orderService } from '@/lib/orderService';
import { CHAIN_CONFIG, CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import { ORDER_ROUTER_ABI } from '@/lib/orderRouterAbi';
import { publicClient } from '@/lib/viemClient';
import type { Address } from 'viem';
import { createWalletClient, custom } from 'viem';
import { polygon } from 'viem/chains';
import { signOrder as signOrderHelper } from '@/lib/order-signing';

interface TradingPanelProps {
  tokenData: TokenData;
  vammMarket?: any; // Legacy compatibility, keeping for now
  initialAction?: 'long' | 'short' | null;
  marketData?: {
    markPrice: number;
    fundingRate: number;
    currentPrice: number;
    priceChange24h: number;
    priceChangePercent24h: number;
    dataSource: string;
    lastUpdated?: string;
  };
}

export default function TradingPanel({ tokenData, vammMarket, initialAction, marketData }: TradingPanelProps) {
  const { walletData, connect } = useWallet();
  
  // Order submission state
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  
  // Memoize vammMarket to prevent unnecessary re-renders
  const memoizedVammMarket = useMemo(() => vammMarket, [
    vammMarket?.vamm_address,
    vammMarket?.vault_address,
    vammMarket?.symbol,
    vammMarket?.initial_price,
    vammMarket?.deployment_status
  ]);

  // Get the metric ID for orderbook queries
  const metricId = memoizedVammMarket?.metric_id || tokenData.symbol;
  
  // Use orderbook system
  const { 
    orders: allOrders, 
    isLoading: ordersLoading, 
    error: ordersError,
    refetch: refetchOrders 
  } = useOrders({ 
    metricId, 
    autoRefresh: true 
  });
  
  // Get user-specific orders for this market only
  const { 
    orders: userOrders, 
    isLoading: userOrdersLoading 
  } = useUserMarketOrders(walletData.address, metricId, true);

  // Debug logging for user orders
  useEffect(() => {
    console.log('🔍 TradingPanel Debug - User Orders State:', {
      walletAddress: walletData.address,
      isConnected: walletData.isConnected,
      metricId,
      userOrdersCount: userOrders.length,
      userOrdersLoading,
      userOrders: userOrders.slice(0, 3), // Log first 3 orders for debugging
      activeOrdersCount: userOrders.filter(order => 
        order.status === 'pending' || order.status === 'partially_filled'
      ).length
    });
  }, [userOrders, userOrdersLoading, walletData.address, walletData.isConnected, metricId]);
  
  // Get orderbook market data
  const { 
    market: orderbookMarket, 
    orders: marketOrders,
    positions: marketPositions,
    isLoading: marketLoading 
  } = useOrderbookMarket(metricId, { autoRefresh: true });
  
  // Derived state for backward compatibility
  const activeOrders = userOrders.filter(order => 
    order.status === 'pending' || order.status === 'partially_filled'
  );
  
  // Security: Filter filled orders for this specific market only
  // This ensures we only show filled orders for the current token/market
  const filledOrdersForThisMarket = useMemo(() => {
    if (!walletData.isConnected || !metricId) return [];
    
    return userOrders.filter(order => {
      const isFilledOrder = order.status === 'filled';
      const isCorrectMarket = order.metricId === metricId;
      
      // Additional safety check - ensure order belongs to connected wallet
      const isUserOrder = walletData.address && 
        order.trader.toLowerCase() === walletData.address.toLowerCase();
      
      return isFilledOrder && isCorrectMarket && isUserOrder;
    });
  }, [userOrders, metricId, walletData.isConnected, walletData.address]);
  
  const isOrderbookEnabled = true; // Always use orderbook system
  const isSystemReady = !ordersLoading && !userOrdersLoading;
  
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');
  const [selectedOption, setSelectedOption] = useState<'long' | 'short' | null>(initialAction || 'long');
  const [amount, setAmount] = useState(0);
  const [leverage, setLeverage] = useState(1);
  const [slippage] = useState(0.5); // eslint-disable-line @typescript-eslint/no-unused-vars
  
  // Limit Order States
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [triggerPrice, setTriggerPrice] = useState(0);
  const [limitOrderType, setLimitOrderType] = useState<'LIMIT' | 'MARKET_IF_TOUCHED' | 'STOP_LOSS' | 'TAKE_PROFIT'>('LIMIT');
  const [orderExpiry, setOrderExpiry] = useState(24); // hours from now
  const [maxSlippage, setMaxSlippage] = useState(100); // basis points (1%)
  const [isContractInfoExpanded, setIsContractInfoExpanded] = useState(false);
  const [isAdvancedSetupExpanded, setIsAdvancedSetupExpanded] = useState(false);
  const [isTrading, setIsTrading] = useState(false);
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

  // Helper functions
  const formatNumber = (value: number | string | null | undefined) => {
    // Convert to number if it's a string
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    
    if (numValue === null || numValue === undefined || isNaN(numValue)) return '0.00';
    if (numValue < 0.01) return numValue.toFixed(6);
    if (numValue < 1) return numValue.toFixed(4);
    if (numValue < 100) return numValue.toFixed(2);
    return Math.round(numValue).toLocaleString();
  };

  // Format bigint or number values safely
  const formatBigIntOrNumber = (value: bigint | number | string, decimals: number = 6): string => {
    if (typeof value === 'string') {
      const numValue = parseFloat(value);
      return isNaN(numValue) ? '0.00' : formatNumber(numValue);
    }
    if (typeof value === 'bigint') {
      // Convert bigint to number with proper decimal handling
      const divisor = BigInt(10 ** decimals);
      const wholePart = Number(value / divisor);
      const fractionalPart = Number(value % divisor) / (10 ** decimals);
      return formatNumber(wholePart + fractionalPart);
    }
    return formatNumber(value);
  };

  // Format number for input display with commas (no forced decimals)
  const formatInputNumber = (num: number) => {
    if (!num || num === 0) return '';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  // Parse comma-formatted string back to number
  const parseInputNumber = (value: string) => {
    const cleanValue = value.replace(/,/g, '');
    const parsed = parseFloat(cleanValue);
    return isNaN(parsed) ? 0 : parsed;
  };

  // Format price from raw value
  const formatPrice = (rawPrice: string | number) => {
    if (!rawPrice) return '0.00';
    const numPrice = typeof rawPrice === 'string' ? parseFloat(rawPrice) : rawPrice;
    return numPrice.toFixed(2);
  };

  const clearMessages = () => {
    setSuccessModal({ isOpen: false, title: '', message: '' });
    setErrorModal({ isOpen: false, title: '', message: '' });
  };

  const showSuccess = (message: string, title: string = 'Success') => {
    setSuccessModal({ isOpen: true, title, message });
  };

  const showError = (message: string, title: string = 'Error') => {
    setErrorModal({ isOpen: true, title, message });
  };

  // Navigation helper
  const navigateToTab = (tab: 'buy' | 'sell', option: 'long' | 'short') => {
    setActiveTab(tab);
    setSelectedOption(option);
  };

  // Quick amount buttons
  const quickAmounts = [100, 500, 1000];

  const handleQuickAmount = (value: number) => {
    setAmount(prev => prev + value);
  };

  const handleMaxAmount = () => {
    const walletBalance = parseFloat(dexV2.formattedBalances?.totalCollateral || '0');
    const availableMargin = parseFloat(availableCash || '0');
    
    // Calculate maximum safe amount based on available funds
    const totalAvailableFunds = walletBalance + availableMargin;
    
    if (totalAvailableFunds > 0) {
      // Account for trading fees (0.3%) and set a safe maximum
      const maxSafeAmount = totalAvailableFunds * leverage * 0.97; // 97% to account for fees and buffer
      setAmount(Math.floor(maxSafeAmount));
    }
  };

  // Token data access with safety checks
  const getSymbol = () => memoizedVammMarket?.symbol || tokenData?.symbol || 'Unknown';
  const getStartPrice = () => {
    if (memoizedVammMarket?.initial_price) {
      const price = typeof memoizedVammMarket.initial_price === 'string' 
        ? parseFloat(memoizedVammMarket.initial_price)
        : memoizedVammMarket.initial_price;
      return price;
    }
    if (marketData?.currentPrice) return marketData.currentPrice;
    return 1.0; // Fallback
  };

  // Legacy compatibility - remove unused position management code
  // Orderbook systems handle positions differently through filled orders

  // =====================
  // 💰 PRICE CALCULATIONS (Updated from test script - Ultra Aggressive)
  // =====================

  const calculateMinPrice = (isLong: boolean, slippageBps: number): bigint => {
    const currentPrice = marketData?.currentPrice || 1; // Default to 1 if no market data
    const slippagePercent = slippageBps / 10000; // Convert basis points to percentage
    
    // Use ultra-aggressive slippage for VAMM compatibility (from test script)
    // Start with 99% slippage as the minimum for VAMM
    const ultraAggressiveSlippage = Math.max(slippagePercent, 0.99); // Minimum 99% slippage for VAMM
    
    if (isLong) {
      // For long positions, we're willing to pay at least currentPrice * (1 - slippage)
      // Use ultra-aggressive approach: allow up to 99% below current price
      const minPrice = currentPrice * (1 - ultraAggressiveSlippage);
      return BigInt(Math.floor(Math.max(minPrice, 0.0001) * 1e6)); // Convert to USDC 6-decimal format
    } else {
      // For short positions, we're willing to sell at least currentPrice * (1 + slippage)
      // Use ultra-aggressive approach: allow up to 99% above current price
      const minPrice = currentPrice * (1 + ultraAggressiveSlippage);
      return BigInt(Math.floor(minPrice * 1e6)); // Convert to USDC 6-decimal format
    }
  };

  const calculateMaxPrice = (isLong: boolean, slippageBps: number): bigint => {
    const currentPrice = marketData?.currentPrice || 1; // Default to 1 if no market data
    const slippagePercent = slippageBps / 10000; // Convert basis points to percentage
    
    // Use ultra-aggressive slippage for VAMM compatibility (from test script)
    // Start with 99% slippage as the minimum for VAMM
    const ultraAggressiveSlippage = Math.max(slippagePercent, 0.99); // Minimum 99% slippage for VAMM
    
    if (isLong) {
      // For long positions, we're willing to pay up to currentPrice * (1 + slippage)
      // Use ultra-aggressive approach: allow up to 100x above current price
      const maxPrice = currentPrice * (1 + ultraAggressiveSlippage);
      return BigInt(Math.floor(maxPrice * 1e6)); // Convert to USDC 6-decimal format
    } else {
      // For short positions, we're willing to sell down to currentPrice * (1 - slippage)
      // Use ultra-aggressive approach: allow down to 99% below current price
      const maxPrice = currentPrice * (1 - ultraAggressiveSlippage);
      return BigInt(Math.floor(Math.max(maxPrice, 0.0001) * 1e6)); // Convert to USDC 6-decimal format
    }
  };

  // Ultra-aggressive price range calculation for fallback strategies (from test script)
  const calculateUltraWidePriceRange = (isLong: boolean): { minPrice: bigint; maxPrice: bigint } => {
    const currentPrice = marketData?.currentPrice || 1;
    
    // Strategy 1: Ultra Wide Range (99% slippage) - from test script
    const ultraWideMinPrice = BigInt(Math.floor(currentPrice * 0.01 * 1e6)); // 99% below current price
    const ultraWideMaxPrice = BigInt(Math.floor(currentPrice * 100 * 1e6)); // 100x above current price
    
    // Strategy 2: Extremely Wide Range (99.9% slippage) - from test script
    const extremelyWideMinPrice = BigInt(Math.floor(currentPrice * 0.001 * 1e6)); // 99.9% below current price
    const extremelyWideMaxPrice = BigInt(Math.floor(currentPrice * 1000 * 1e6)); // 1000x above current price
    
    // Strategy 3: Maximum Range (99.99% slippage) - from test script
    const maximumMinPrice = BigInt(1); // Minimum possible price
    const maximumMaxPrice = BigInt(Math.floor(currentPrice * 10000 * 1e6)); // 10000x above current price
    
    // Strategy 4: Zero to Maximum - from test script
    const zeroToMaxMinPrice = BigInt(0); // Zero minimum
    const zeroToMaxMaxPrice = BigInt(Number.MAX_SAFE_INTEGER); // Maximum possible
    
    // Return the most aggressive range for maximum compatibility
    return {
      minPrice: zeroToMaxMinPrice,
      maxPrice: zeroToMaxMaxPrice
    };
  };

  // =====================
  // 💰 SIMPLE VALIDATION FOR ORDERBOOK
  // =====================

  const validateOrderAmount = (): { isValid: boolean; message?: string } => {
    if (!amount || amount <= 0) {
      return { isValid: false, message: 'Enter an amount' };
    }
    
    if (amount < 1) {
      return { isValid: false, message: 'Minimum $1 required' };
    }
    
    if (amount > 1000000) {
      return { isValid: false, message: 'Maximum $1M per order' };
    }
    
    return { isValid: true };
  };

  const canExecuteTrade = () => {
    if (!selectedOption) return false;
    if (orderType === 'limit' && triggerPrice <= 0) return false;
    
    // Require wallet connection for orderbook system
    if (!walletData.isConnected) return false;
    
    // Check if orderbook system is ready
    if (!isOrderbookEnabled || !isSystemReady) return false;
    
    // Validate amount
    const validation = validateOrderAmount();
    return validation.isValid;
  };

  // Helper function to abbreviate long market names for button display
  const abbreviateMarketName = (symbol: string, maxLength: number = 12): string => {
    if (symbol.length <= maxLength) return symbol;
    
    // For very long symbols, show first few characters + "..." + last few characters
    const startChars = Math.floor((maxLength - 3) / 2);
    const endChars = maxLength - 3 - startChars;
    
    return `${symbol.slice(0, startChars)}...${symbol.slice(-endChars)}`;
  };

  const getTradeButtonText = () => {
    if (!walletData.isConnected) return 'Connect Wallet';
    
    // Check if orderbook system is available
    if (!isOrderbookEnabled) return 'Orderbook Not Available';
    if (!isSystemReady) return 'Loading...';
    
    if (isTrading || isSubmittingOrder) {
      return orderType === 'limit' ? 'Signing & Creating Order...' : 'Signing & Placing Order...';
    }
    
    if (!selectedOption) return 'Select Buy or Sell';
    
    const validation = validateOrderAmount();
    if (!validation.isValid) return validation.message || 'Invalid Amount';
    
    if (orderType === 'limit' && triggerPrice <= 0) return 'Set Trigger Price';
    
    if (orderType === 'limit') {
      return `Create ${selectedOption === 'long' ? 'Buy' : 'Sell'} Limit Order`;
    }
    
    const abbreviatedSymbol = abbreviateMarketName(tokenData.symbol);
    return `${selectedOption === 'long' ? 'Buy' : 'Sell'} ${abbreviatedSymbol}`;
  };

  const OrderValidationComponent = () => {
    if (!amount || amount <= 0) return null;
    
    const validation = validateOrderAmount();
    
    if (!validation.isValid) {
      return (
        <div className="text-[10px] text-red-400 mt-1">
          <div className="font-semibold">
            ❌ {validation.message}
          </div>
        </div>
      );
    }
    
    return (
      <div className="text-[10px] text-green-400 mt-1">
        <div className="font-semibold">
          ✅ Order amount valid
        </div>
        <div className="opacity-75 mt-0.5">
          Ready to place order
        </div>
      </div>
    );
  };

  // =====================
  // 🔍 SIMPLE ORDER VALIDATION
  // =====================

  const validateOrder = (): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    if (!walletData.isConnected) {
      errors.push('Wallet not connected');
    }
    
    if (!selectedOption) {
      errors.push('Select buy or sell');
    }
    
    const amountValidation = validateOrderAmount();
    if (!amountValidation.isValid) {
      errors.push(amountValidation.message || 'Invalid amount');
    }
    
    if (orderType === 'limit' && triggerPrice <= 0) {
      errors.push('Set trigger price for limit orders');
    }
    
    // Check for unrealistic leverage
    if (leverage > 100) {
      errors.push('Leverage too high - maximum 100x');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  };

  // =====================
  // 🔐 ORDER SIGNING (EIP-712)
  // =====================

  const prepareAndSignOrder = async (params: {
    metricId: string;
    orderType: 'MARKET' | 'LIMIT';
    side: 'BUY' | 'SELL';
    quantity: string;
    price?: string;
    postOnly?: boolean;
  }): Promise<{ signature: `0x${string}`; nonce: bigint }> => {
    if (!walletData.isConnected || !walletData.address) {
      throw new Error('Wallet not connected');
    }

    const ethereum = (window as any)?.ethereum;
    if (!ethereum) {
      throw new Error('No ethereum provider found');
    }

    const walletClient = createWalletClient({
      chain: polygon,
      transport: custom(ethereum),
      account: walletData.address as Address,
    });

    // Ensure the injected wallet's selected account matches the address we intend to use
    try {
      const selectedAccounts: string[] = await ethereum.request({ method: 'eth_accounts' });
      const selected = (selectedAccounts && selectedAccounts[0]) ? selectedAccounts[0] : null;
      if (!selected || selected.toLowerCase() !== (walletData.address as string).toLowerCase()) {
        throw new Error(`Connected wallet account (${selected || 'none'}) does not match selected account ${walletData.address}. Switch accounts in your wallet and try again.`);
      }
    } catch (e) {
      // If the provider call fails, proceed; signOrder will still verify and throw if mismatch
      console.warn('Could not verify selected account via provider. Proceeding to sign with runtime verification.', e);
    }

    const currentNonce = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.orderRouter as Address,
      abi: ORDER_ROUTER_ABI,
      functionName: 'getNonce',
      args: [walletData.address as Address],
    }) as bigint;

    const { signature, nonce } = await signOrderHelper(
      {
        metricId: params.metricId,
        orderType: params.orderType,
        side: params.side,
        quantity: params.quantity,
        price: params.price,
        // Ensure postOnly used for signing equals the flag submitted later
        postOnly: Boolean(params.postOnly || false),
      },
      walletClient,
      CONTRACT_ADDRESSES.orderRouter as Address,
      currentNonce
    );

    return { signature, nonce };
  };

  // Legacy functions removed - orderbook system uses simpler order placement

  // =====================
  // 📈 TRADING EXECUTION
  // =====================

  const executeMarketOrder = async () => {
    console.log('🚀 Starting market order execution with orderbook system...');

    // Validate USDC balance
    // if (!walletData.balance || amount > parseFloat(walletData.balance)) {
    //   showError('Insufficient USDC balance'+walletData.balance);
    //   return;
    // }
    
    // Validate orderbook system availability
    if (!isOrderbookEnabled) {
      showError('Orderbook system is not available. Please try again later.', 'Service Unavailable');
      return;
    }
    
    if (!isSystemReady) {
      showError('Orderbook system is still loading. Please wait and try again.', 'System Loading');
      return;
    }
    
    if (!walletData.isConnected || !walletData.address) {
      showError('Please connect your wallet to place orders.', 'Wallet Required');
      return;
    }
    
    clearMessages();
    setIsTrading(true);
    setIsSubmittingOrder(true);

    try {
      // For market orders in orderbook system, we create market orders that execute immediately
      // Get current market price
      const currentPrice = marketData?.currentPrice;
      if (!currentPrice) {
        throw new Error('Cannot execute trade: Current price not available');
      }
      
      // Calculate quantity of units based on USDC amount and current price
      // Example: $100 USDC at $20 per unit = 5 units
      const quantity = amount / currentPrice;
      
      console.log('💰 Calculating order quantity:', {
        usdcAmount: amount,
        currentPrice,
        calculatedQuantity: quantity,
        explanation: `${amount} USDC / $${currentPrice} per unit = ${quantity} units`
      });

      const orderParams = {
        metricId,
        orderType: 'MARKET' as const,
        side: selectedOption === 'long' ? 'BUY' : 'SELL' as const,
        quantity: quantity.toString(), // Number of units to buy/sell
        price: Number(currentPrice).toFixed(2), // Use current price with 2-decimal tick alignment
        timeInForce: 'IOC' as const, // Immediate or Cancel for market orders
        walletAddress: walletData.address,
        timestamp: Date.now()
      };

      console.log('📋 Creating market order with params:', orderParams);
      showSuccess('Signing and placing market order...', 'Processing');
      
      // Sign the order with EIP-712 using the shared helper
      const { signature, nonce } = await prepareAndSignOrder({
        metricId,
        orderType: 'MARKET',
        side: selectedOption === 'long' ? 'BUY' : 'SELL',
        quantity: quantity.toString(), // Number of units to buy/sell
        price: Number(currentPrice).toFixed(2),
      });
      
      // Submit to API
      const requestPayload = {
        ...orderParams,
        signature,
        nonce: Number(nonce),
        metadataHash: `0x${'0'.repeat(64)}` // Default metadata hash
      };
      
      console.log('📤 Sending market order request to API:', requestPayload);
      
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      });

      console.log('📥 Market order API Response status:', response.status);
      const result = await response.json();
      console.log('📥 Market order API Response body:', result);
      
      if (!response.ok) {
        // Handle different error types
        if (result.errorType === 'BLOCKCHAIN_ERROR') {
          throw new Error(`Blockchain Error: ${result.details || 'Transaction failed'}`);
        } else {
          throw new Error(result.error || 'Failed to place market order');
        }
      }

      if (result.success) {
        const matchText = result.matches && result.matches.length > 0 
          ? ` Matched ${result.matches.length} order(s).`
          : '';
        
        const blockchainText = result.blockchainTxHash 
          ? ` Blockchain TX: ${result.blockchainTxHash.slice(0, 10)}...`
          : '';
          
        showSuccess(
          `Market order placed successfully! Order ID: ${result.orderId}.${matchText}${blockchainText}`,
          'Order Confirmed On-Chain'
        );
        
        // Reset form
        setAmount(0);
        refetchOrders(); // Refresh orders list
        
        // Log successful submission
        console.log('✅ Market order submitted successfully:', {
          orderId: result.orderId,
          matches: result.matches?.length || 0,
          processingTime: result.processingTime
        });
      } else {
        throw new Error(result.error || 'Order submission failed');
      }
      
    } catch (error: any) {
      console.error('💥 Market order execution failed:', error);
      
      let errorMessage = 'Order placement failed. Please try again.';
      let errorTitle = 'Order Failed';
      const errorStr = error?.message || error?.toString() || '';
      
      if (errorStr.includes('Blockchain Error')) {
        errorMessage = 'Blockchain transaction failed. Your order was not placed and no database changes were made. This protects you from inconsistent state.';
        errorTitle = 'Blockchain Transaction Failed';
      } else if (errorStr.includes('Market not deployed') || errorStr.includes('missing contract addresses')) {
        errorMessage = 'This market has not been deployed to the blockchain yet. Orders cannot be placed until deployment is complete.';
        errorTitle = 'Market Not Deployed';
      } else if (errorStr.includes('insufficient') || errorStr.includes('Insufficient')) {
        errorMessage = 'Insufficient funds. Please check your balance and try again.';
        errorTitle = 'Insufficient Funds';
      } else if (errorStr.includes('cancelled') || errorStr.includes('denied') || errorStr.includes('User denied')) {
        errorMessage = 'Transaction was cancelled. Please try again if you want to proceed.';
        errorTitle = 'Transaction Cancelled';
      } else if (errorStr.includes('Wallet') || errorStr.includes('provider')) {
        errorMessage = 'Wallet connection issue. Please disconnect and reconnect your wallet, then try again.';
        errorTitle = 'Wallet Connection Error';
      } else if (errorStr.includes('Market not') || errorStr.includes('not found')) {
        errorMessage = 'Market not available for trading. Please check if the market is deployed.';
        errorTitle = 'Market Not Available';
      } else if (errorStr.includes('Rate limit')) {
        errorMessage = 'Too many requests. Please wait a moment and try again.';
        errorTitle = 'Rate Limited';
      }
      
      showError(errorMessage, errorTitle);
    } finally {
      setIsTrading(false);
      setIsSubmittingOrder(false);
    }
  };

  const executeLimitOrder = async () => {
    if (!selectedOption || orderType !== 'limit') return;
    
    if (!walletData.isConnected || !walletData.address) {
      showError('Please connect your wallet to place orders.', 'Wallet Required');
      return;
    }
    
    if (triggerPrice <= 0) {
      showError('Please enter a valid limit price.', 'Invalid Price');
      return;
    }
    
    console.log('📋 Creating limit order with orderbook system...');
    setIsTrading(true);
    setIsSubmittingOrder(true);
    clearMessages();

    try {
      const expiryTimestamp = orderExpiry > 0 ? Math.floor(Date.now() / 1000) + (orderExpiry * 3600) : 0;
      
      // Convert USDC amount to asset units using the limit price
      const quantity = amount / triggerPrice;
      console.log('💰 Calculating limit order quantity:', {
        usdcAmount: amount,
        triggerPrice,
        calculatedQuantity: quantity,
        explanation: `${amount} USDC / $${triggerPrice} per unit = ${quantity} units`
      });

      const orderParams = {
        metricId,
        orderType: 'LIMIT' as const,
        side: selectedOption === 'long' ? 'BUY' : 'SELL' as const,
        quantity: quantity.toString(),
        price: triggerPrice.toString(),
        timeInForce: expiryTimestamp > 0 ? 'GTD' : 'GTC' as const,
        expiryTime: expiryTimestamp > 0 ? expiryTimestamp : undefined,
        postOnly: false,
        reduceOnly: false,
        walletAddress: walletData.address,
        timestamp: Date.now()
      };

      console.log('📋 Creating limit order with params:', orderParams);
      showSuccess('Signing and creating limit order...', 'Processing');
      
      // Sign the order with EIP-712 using the shared helper
      const { signature, nonce } = await prepareAndSignOrder({
        metricId,
        orderType: 'LIMIT',
        side: selectedOption === 'long' ? 'BUY' : 'SELL',
        quantity: quantity.toString(),
        price: triggerPrice.toString(),
        postOnly: false,
      });
      
      // Submit to API
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...orderParams,
          signature,
          nonce: Number(nonce),
          metadataHash: `0x${'0'.repeat(64)}` // Default metadata hash
        }),
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to place limit order');
      }

      if (result.success) {
        const matchText = result.matches && result.matches.length > 0 
          ? ` Immediately matched ${result.matches.length} order(s).`
          : ' Added to order book.';
          
        showSuccess(
          `Limit order created successfully! ${orderParams.side} ${orderParams.quantity} ${tokenData.symbol} @ $${formatNumber(triggerPrice)}.${matchText}`,
          'Limit Order Created'
        );
        
        // Reset form
        setAmount(0);
        setTriggerPrice(0);
        refetchOrders(); // Refresh orders list
        
        // Log successful submission
        console.log('✅ Limit order submitted successfully:', {
          orderId: result.orderId,
          matches: result.matches?.length || 0,
          processingTime: result.processingTime
        });
      } else {
        throw new Error(result.error || 'Order submission failed');
      }
      
    } catch (error: any) {
      console.error('❌ Limit order creation failed:', error);
      
      let errorMessage = 'Failed to create limit order. Please try again.';
      let errorTitle = 'Limit Order Failed';
      const errorStr = error?.message || error?.toString() || '';
      
      if (errorStr.includes('insufficient') || errorStr.includes('Insufficient')) {
        errorMessage = 'Insufficient funds. Please check your balance and try again.';
        errorTitle = 'Insufficient Funds';
      } else if (errorStr.includes('cancelled') || errorStr.includes('denied') || errorStr.includes('User denied')) {
        errorMessage = 'Order signature was cancelled. Please try again if you want to proceed.';
        errorTitle = 'Signature Cancelled';
      } else if (errorStr.includes('Invalid price') || errorStr.includes('tick size')) {
        errorMessage = 'Invalid price. Please check the price format and tick size requirements.';
        errorTitle = 'Invalid Price';
      } else if (errorStr.includes('minimum') || errorStr.includes('below')) {
        errorMessage = 'Order size below minimum. Please increase the order amount.';
        errorTitle = 'Order Too Small';
      }
      
      showError(errorMessage, errorTitle);
    } finally {
      setIsTrading(false);
      setIsSubmittingOrder(false);
    }
  };

  // =====================
  // 🎯 EVENT HANDLERS
  // =====================

  const handleLongClick = () => {
    navigateToTab('buy', 'long');
  };

  const handleShortClick = () => {
    navigateToTab('sell', 'short');
  };

  const handleTradeClick = async () => {
    if (!walletData.isConnected) {
      await connect();
      return;
    }

    if (orderType === 'limit') {
      await executeLimitOrder();
    } else {
      await executeMarketOrder();
    }
  };

  // Position closing not applicable to orderbook system
  // Orders are cancelled rather than positions closed

  // =====================
  // 🔄 EFFECTS
  // =====================

  useEffect(() => {
    if (initialAction) {
      setSelectedOption(initialAction);
      setActiveTab(initialAction === 'long' ? 'buy' : 'sell');
    }
  }, [initialAction]);

  return (
    <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 flex flex-col min-h-0 h-full">
      {/* Status Modals */}
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
      
      <div className="rounded-md bg-[#0A0A0A] border border-[#333333] p-3 h-full overflow-y-auto flex flex-col">


        {/* Header section */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('buy')}
              className="transition-all duration-150 outline-none border-none cursor-pointer rounded-md"
              style={{
                padding: '6px 16px',
                fontSize: '14px',
                fontWeight: '600',
                backgroundColor: activeTab === 'buy' ? '#22C55E' : '#2A2A2A',
                color: activeTab === 'buy' ? '#000000' : '#9CA3AF'
              }}
            >
              Buy
            </button>
            <button
              onClick={() => setActiveTab('sell')}
              className="transition-all duration-150 outline-none border-none cursor-pointer rounded-md"
              style={{
                padding: '6px 16px',
                fontSize: '14px',
                fontWeight: '600',
                backgroundColor: activeTab === 'sell' ? '#22C55E' : '#2A2A2A',
                color: activeTab === 'sell' ? '#000000' : '#9CA3AF'
              }}
            >
              Sell
            </button>
          </div>
          
          {/* Order Type Toggle - Compact Design */}
          <div className="bg-[#0F0F0F] rounded-md border border-[#222222] p-0.5">
            <div className="flex">
              <button
                onClick={() => setOrderType('market')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-200 ${
                  orderType === 'market'
                    ? 'bg-[#1A1A1A] text-white'
                    : 'text-[#808080] hover:text-[#9CA3AF]'
                }`}
              >
                <div className={`w-1 h-1 rounded-full ${
                  orderType === 'market' ? 'bg-green-400' : 'bg-[#404040]'
                }`} />
                Market
              </button>
              <button
                onClick={() => setOrderType('limit')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-200 ${
                  orderType === 'limit'
                    ? 'bg-[#1A1A1A] text-white'
                    : 'text-[#808080] hover:text-[#9CA3AF]'
                }`}
              >
                <div className={`w-1 h-1 rounded-full ${
                  orderType === 'limit' ? 'bg-blue-400' : 'bg-[#404040]'
                }`} />
                Limit
              </button>
            </div>
          </div>
        </div>

        {/* Trading Content Area - Fixed height exactly like ThreadPanel messages */}
        <div className="h-[235px] overflow-y-auto mb-3 space-y-2 trading-panel-scroll">
          {/* Sell Tab - Current Positions */}
          {activeTab === 'sell' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-white">Current Positions</h4>
                <button
                  onClick={() => {
                    refetchOrders();
                  }}
                  disabled={ordersLoading}
                  className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                >
                  {ordersLoading ? '⟳ Loading...' : '⟳ Refresh'}
                </button>
              </div>
              
              {/* Filled Orders Summary (Positions) */}
              {!ordersLoading && userOrders.filter(o => o.status === 'filled').length > 0 && (
                <div className="mb-3 p-2 bg-[#1A1A1A] rounded-lg border border-[#333333]">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Filled Orders:</span>
                      <span className="text-white font-medium">{userOrders.filter(o => o.status === 'filled').length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Total Volume:</span>
                      <span className="text-white font-medium">
                        ${formatNumber(userOrders.filter(o => o.status === 'filled').reduce((sum, order) => sum + (order.quantity * order.price), 0))}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Buy Orders:</span>
                      <span className="text-green-400 font-medium">
                        {userOrders.filter(o => o.status === 'filled' && o.side === 'buy').length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Sell Orders:</span>
                      <span className="text-red-400 font-medium">
                        {userOrders.filter(o => o.status === 'filled' && o.side === 'sell').length}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              
              {ordersLoading && (
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Trade History</h4>
                    <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                      •••
                    </div>
                  </div>
                  
                  <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                    <div className="flex items-center justify-between p-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {/* Side indicator - animated for loading */}
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
                        
                        {/* Loading state info */}
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="text-[11px] font-medium text-[#808080]">
                            Loading orders...
                          </span>
                        </div>
                      </div>
                      
                      {/* Status and visual consistency */}
                      <div className="flex items-center gap-2">
                        {/* Animated progress indicator */}
                        <div className="w-8 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 animate-pulse" style={{ width: '60%' }} />
                        </div>
                        
                        {/* Status dot - animated */}
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        
                        {/* Loading icon */}
                        <svg className="w-3 h-3 text-blue-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </div>
                    </div>
                    
                    {/* Expandable details on hover/focus */}
                    <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                      <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                        <div className="text-[9px] pt-1.5">
                          <span className="text-[#606060]">Fetching your trade history and positions...</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {!ordersLoading && filledOrdersForThisMarket.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-white mb-2">Filled Orders (Trade History)</h4>
                  {filledOrdersForThisMarket.slice(0, 10).map((order) => (
                    <div key={order.id} className="mb-3 p-2 bg-[#1A1A1A] rounded-lg border border-[#333333]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${order.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                            {order.side === 'buy' ? 'BOUGHT' : 'SOLD'}
                          </span>
                          <span className="text-xs text-[#808080]">
                            {order.quantity.toFixed(4)} @ {order.price ? `$${order.price.toFixed(4)}` : 'MARKET'}
                          </span>
                          <span className="text-xs text-[#606060]">
                            ID: {order.id.slice(0, 8)}...
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white">
                            {order.price ? `$${(order.quantity * order.price).toFixed(2)}` : 'PENDING'}
                          </span>
                          <span className="text-xs text-[#606060]">
                            {new Date(order.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Sell Tab - No Orders Message */}
              {!ordersLoading && filledOrdersForThisMarket.length === 0 && (
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Trade History</h4>
                    <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                      0
                    </div>
                  </div>
                  
                  <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                    <div className="flex items-center justify-between p-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {/* Side indicator */}
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                        
                        {/* Empty state info */}
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="text-[11px] font-medium text-[#808080]">
                            No filled orders for {tokenData.symbol}
                          </span>
                        </div>
                      </div>
                      
                      {/* Status and visual consistency */}
                      <div className="flex items-center gap-2">
                        {/* Status dot */}
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                        
                        {/* Subtle icon */}
                        <svg className="w-3 h-3 text-[#404040]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                    </div>
                    
                    {/* Expandable details on hover/focus */}
                    <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                      <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                        <div className="text-[9px] pt-1.5">
                          <span className="text-[#606060]">Your trade history will appear here after placing orders</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sell Tab - Active Limit Orders */}
          {activeTab === 'sell' && (
            <div className="space-y-1.5 mb-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Active Orders</h4>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                  {activeOrders.length}
                </div>
              </div>
              
              {activeOrders.map((order) => (
                <div key={order.id} className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                  {/* Main order row - compact single line */}
                  <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* Side indicator */}
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${order.side === 'buy' ? 'bg-green-400' : 'bg-red-400'}`} />
                      
                      {/* Order info */}
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className={`text-[11px] font-medium ${order.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                          {order.side.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-[#808080]">
                          {order.quantity.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-[#606060]">@</span>
                        <span className="text-[10px] text-white font-mono">
                          ${order.price.toFixed(4)}
                        </span>
                      </div>
                    </div>
                    
                    {/* Status and actions */}
                    <div className="flex items-center gap-2">
                      {/* Progress indicator for partially filled */}
                      {order.filledQuantity > 0 && (
                        <div className="w-8 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-400 transition-all duration-300"
                            style={{ width: `${(order.filledQuantity / order.quantity) * 100}%` }}
                          />
                        </div>
                      )}
                      
                      {/* Status dot */}
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        order.status === 'pending' ? 'bg-yellow-400' : 
                        order.status === 'partially_filled' ? 'bg-blue-400' :
                        'bg-gray-400'
                      }`} />
                      
                      {/* Cancel button */}
                      <button
                        onClick={async () => {
                          try {
                            console.log('Cancelling order:', order.id);
                            await refetchOrders();
                          } catch (error) {
                            console.error('Failed to cancel order:', error);
                          }
                        }}
                        disabled={ordersLoading}
                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-red-500/10 rounded text-red-400 hover:text-red-300 disabled:opacity-50"
                        title="Cancel order"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  
                  {/* Expandable details on hover/focus */}
                  <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                    <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px] pt-1.5">
                        <div className="flex justify-between">
                          <span className="text-[#606060]">Total:</span>
                          <span className="text-[#9CA3AF] font-mono">${(order.quantity * order.price).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#606060]">Filled:</span>
                          <span className="text-[#9CA3AF]">{((order.filledQuantity / order.quantity) * 100).toFixed(1)}%</span>
                        </div>
                        {order.expiryTime && (
                          <div className="flex justify-between col-span-2">
                            <span className="text-[#606060]">Expires:</span>
                            <span className="text-[#9CA3AF]">{new Date(order.expiryTime).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              
              {/* No Active Orders Message */}
              {activeOrders.length === 0 && !ordersLoading && (
                <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                  <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* Side indicator */}
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      
                      {/* Empty state info */}
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="text-[11px] font-medium text-[#808080]">
                          No active orders for {tokenData.symbol}
                        </span>
                      </div>
                    </div>
                    
                    {/* Status and visual consistency */}
                    <div className="flex items-center gap-2">
                      {/* Status dot */}
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                      
                      {/* Subtle icon */}
                      <svg className="w-3 h-3 text-[#404040]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                  </div>
                  
                  {/* Expandable details on hover/focus */}
                  <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                    <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                      <div className="text-[9px] pt-1.5">
                        <span className="text-[#606060]">Create limit orders in the Buy tab to get started</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {activeOrders.length > 0 && (
                <div className="mt-3 p-2 bg-[#0F0F0F] rounded text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Active Orders:</span>
                    <span className="text-white">{activeOrders.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Buy Orders:</span>
                    <span className="text-green-400">{activeOrders.filter(o => o.side === 'buy').length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Sell Orders:</span>
                    <span className="text-red-400">{activeOrders.filter(o => o.side === 'sell').length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Total Value:</span>
                    <span className="text-white">
                      ${activeOrders.reduce((sum, order) => sum + (order.quantity * order.price), 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Buy Tab - Trading Interface */}
          {activeTab === 'buy' && (
            <>
              {/* Wallet Balance Info */}
              {/* {walletData.isConnected && (
                <div className="mb-3 p-2 bg-[#1A1A1A] rounded-lg text-xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[#808080]">Wallet USDC:</span>
                    <span className="text-white">${formatNumber(vammTrading.collateralBalance)}</span>
                  </div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[#808080]">Available Margin:</span>
                    <span className="text-white">${formatNumber(vammTrading.marginAccount?.availableBalance || '0')}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#808080]">Total Margin:</span>
                                    <span className={`${(parseFloat(vammTrading.marginAccount?.balance || '0') + parseFloat(vammTrading.marginAccount?.unrealizedPnL || '0')) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${formatNumber(((parseFloat(vammTrading.marginAccount?.balance || '0') + parseFloat(vammTrading.marginAccount?.unrealizedPnL || '0'))).toString())}
                    </span>
                  </div>
                </div>
              )} */}

              {/* VAMM Contract Info - Sophisticated Design */}
              {memoizedVammMarket && (
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Contract & Market Info</h4>
                    <div className={`text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded ${
                      memoizedVammMarket.deployment_status === 'deployed' ? 'text-green-400' : 
                      memoizedVammMarket.deployment_status === 'failed' ? 'text-red-400' : 
                      'text-yellow-400'
                    }`}>
                      {memoizedVammMarket.deployment_status}
                    </div>
                  </div>
                  
                  <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                    <div 
                      className="flex items-center justify-between p-2.5 cursor-pointer"
                      onClick={() => setIsContractInfoExpanded(!isContractInfoExpanded)}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          memoizedVammMarket.deployment_status === 'deployed' ? 'bg-green-400' : 
                          memoizedVammMarket.deployment_status === 'failed' ? 'bg-red-400' : 
                          'bg-yellow-400'
                        }`} />
                        <span className="text-[11px] font-medium text-[#808080]">
                          Market Data & Contracts
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <svg 
                          className={`w-3 h-3 text-[#404040] transition-transform duration-200 ${isContractInfoExpanded ? 'rotate-180' : ''}`} 
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                    
                    {/* Expandable details section */}
                    <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-40 overflow-hidden transition-all duration-200">
                      <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                        <div className="text-[9px] pt-1.5 space-y-1">
                          <div className="flex justify-between">
                            <span className="text-[#606060]">Mark Price:</span>
                            <span className="text-[#9CA3AF] font-mono">
                              ${marketData?.markPrice ? formatNumber(marketData.markPrice.toString()) : formatNumber(tokenData.price?.toString() || '0')}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#606060]">24h Change:</span>
                            <span className={`${(marketData?.priceChangePercent24h || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {marketData?.priceChangePercent24h ? (marketData.priceChangePercent24h >= 0 ? '+' : '') + marketData.priceChangePercent24h.toFixed(2) : '0.00'}%
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#606060]">Data Source:</span>
                            <span className="text-green-400">
                              {marketData?.dataSource || 'static'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Expanded details when clicked */}
                  {isContractInfoExpanded && (
                    <div className="bg-[#0F0F0F] rounded-md border border-[#222222] p-2.5">
                      <div className="space-y-1 text-[9px]">
                        <div className="flex justify-between">
                          <span className="text-[#606060]">Oracle:</span>
                          <span className="text-white font-mono">
                            {memoizedVammMarket.oracle_address.slice(0, 6)}...{memoizedVammMarket.oracle_address.slice(-4)}
                          </span>
                        </div>
                        {memoizedVammMarket.vamm_address && (
                          <div className="flex justify-between">
                            <span className="text-[#606060]">vAMM:</span>
                            <span className="text-white font-mono">
                              {memoizedVammMarket.vamm_address.slice(0, 6)}...{memoizedVammMarket.vamm_address.slice(-4)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-[#606060]">Initial Price:</span>
                          <span className="text-white">
                            ${formatNumber(memoizedVammMarket.initial_price?.toString() || '0')}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#606060]">Funding Rate:</span>
                          <span className="text-white">
                            {marketData?.fundingRate ? (marketData.fundingRate * 100).toFixed(4) : '0.0000'}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

          {/* Long/Short Option Buttons - Sophisticated Design */}
          <div className="space-y-1.5 mb-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Position Direction</h4>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                {selectedOption || 'Select'}
              </div>
            </div>
            
            <div className="flex gap-1.5">
              <button
                onClick={() => setSelectedOption('long')}
                className={`group flex-1 bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border transition-all duration-200 ${
                  selectedOption === 'long' 
                    ? 'border-green-400 bg-green-400/10' 
                    : 'border-[#222222] hover:border-[#333333]'
                }`}
              >
                <div className="flex items-center justify-center p-2.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      selectedOption === 'long' ? 'bg-green-400' : 'bg-[#404040]'
                    }`} />
                    <span className={`text-xs font-medium ${
                      selectedOption === 'long' ? 'text-green-400' : 'text-[#808080]'
                    }`}>
                      Long
                    </span>
                    {selectedOption === 'long' && (
                      <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
              
              <button
                onClick={() => setSelectedOption('short')}
                className={`group flex-1 bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border transition-all duration-200 ${
                  selectedOption === 'short' 
                    ? 'border-red-400 bg-red-400/10' 
                    : 'border-[#222222] hover:border-[#333333]'
                }`}
              >
                <div className="flex items-center justify-center p-2.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      selectedOption === 'short' ? 'bg-red-400' : 'bg-[#404040]'
                    }`} />
                    <span className={`text-xs font-medium ${
                      selectedOption === 'short' ? 'text-red-400' : 'text-[#808080]'
                    }`}>
                      Short
                    </span>
                    {selectedOption === 'short' && (
                      <svg className="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Limit Order Configuration - Sophisticated Design */}
          {orderType === 'limit' && (
            <div className="space-y-1.5 mb-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Limit Order Settings</h4>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                  Advanced
                </div>
              </div>
              
              {/* Trigger Price Section */}
              <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                <div className="p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${triggerPrice > 0 ? 'bg-blue-400' : 'bg-[#404040]'}`} />
                      <span className="text-[11px] font-medium text-[#808080]">Trigger Price</span>
                    </div>
                    <span className="text-[10px] text-[#606060]">USDC</span>
                  </div>
                  <div className="relative">
                    <div className="absolute left-2 top-1/2 transform -translate-y-1/2 text-[#606060] text-xs pointer-events-none">$</div>
                    <input
                      type="text"
                      value={triggerPrice > 0 ? triggerPrice.toString() : ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTriggerPrice(parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1.5 pl-6 text-xs font-medium text-white placeholder-[#606060] focus:outline-none focus:border-blue-400 transition-colors duration-200"
                    />
                  </div>
                </div>
              </div>

              {/* Order Type Section */}
              <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                <div className="p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                      <span className="text-[11px] font-medium text-[#808080]">Order Type</span>
                    </div>
                    <span className="text-[10px] text-[#606060]">{limitOrderType}</span>
                  </div>
                  <select
                    value={limitOrderType}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setLimitOrderType(e.target.value as typeof limitOrderType)}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded px-2 py-1.5 text-xs font-medium text-white focus:outline-none focus:border-blue-400 transition-colors duration-200 cursor-pointer"
                  >
                    <option value="LIMIT">Limit Order</option>
                    <option value="MARKET_IF_TOUCHED">Market If Touched</option>
                    <option value="STOP_LOSS">Stop Loss</option>
                    <option value="TAKE_PROFIT">Take Profit</option>
                  </select>
                </div>
              </div>

              {/* Order Expiry Section */}
              {/* <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                <div className="p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400" />
                      <span className="text-[11px] font-medium text-[#808080]">Order Expires</span>
                    </div>
                    <span className="text-[10px] text-[#606060]">
                      {orderExpiry === 1 ? '1h' : orderExpiry === 6 ? '6h' : orderExpiry === 24 ? '1d' : orderExpiry === 72 ? '3d' : '1w'}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {[1, 6, 24, 72, 168].map((hours) => (
                      <button
                        key={hours}
                        onClick={() => setOrderExpiry(hours)}
                        className={`flex-1 py-1.5 px-2 text-[10px] font-medium rounded transition-all duration-200 ${
                          orderExpiry === hours
                            ? 'bg-blue-400 text-black'
                            : 'bg-[#1A1A1A] text-[#808080] hover:text-[#9CA3AF] border border-[#333333] hover:border-[#444444]'
                        }`}
                      >
                        {hours === 1 ? '1h' : hours === 6 ? '6h' : hours === 24 ? '1d' : hours === 72 ? '3d' : '1w'}
                      </button>
                    ))}
                  </div>
                </div>
              </div> */}

              {/* Max Slippage Section */}
              <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                <div className="p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                      <span className="text-[11px] font-medium text-[#808080]">Max Slippage</span>
                    </div>
                    <span className="text-[10px] text-white font-mono">
                      {(maxSlippage / 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="10"
                      max="500"
                      value={maxSlippage}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxSlippage(parseInt(e.target.value))}
                      className="flex-1 h-1 bg-[#2A2A2A] rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div className="flex justify-between text-[8px] text-[#606060] mt-1">
                    <span>0.1%</span>
                    <span>Conservative</span>
                    <span>Aggressive</span>
                    <span>5.0%</span>
                  </div>
                </div>
              </div>

              {/* Limit Order Summary */}
              <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                <div className="p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-purple-400" />
                      <span className="text-[11px] font-medium text-[#808080]">Order Summary</span>
                    </div>
                  </div>
                  <div className="space-y-1 text-[9px]">
                    <div className="flex justify-between">
                      <span className="text-[#606060]">Order Type:</span>
                      <span className="text-white font-mono">{limitOrderType.replace('_', ' ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#606060]">Trigger Price:</span>
                      <span className="text-white font-mono">${triggerPrice > 0 ? formatNumber(triggerPrice) : 'Not set'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#606060]">Expires:</span>
                      <span className="text-white font-mono text-[8px]">{new Date(Date.now() + orderExpiry * 60 * 60 * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="border-t border-[#1A1A1A] my-1"></div>
                    <div className="flex justify-between">
                      <span className="text-[#606060]">Automation Fee:</span>
                      <span className="text-white font-mono">$2.00</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#606060]">Execution Fee:</span>
                      <span className="text-white font-mono">$3.00</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Amount Section */}
          <div>
            <div className="uppercase text-xs font-medium mb-2 text-[#9CA3AF]">
              Position Size (USD)
            </div>
            
            {/* Amount Input Container */}
            <div className="relative mb-3">
              <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-zinc-400 text-2xl font-bold pointer-events-none">
                $
              </div>
              <input
                type="text"
                value={formatInputNumber(amount)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(parseInputNumber(e.target.value))}
                placeholder="1,000"
                className="w-full rounded-lg px-3 py-3 pl-8 text-right text-2xl font-bold transition-all duration-150 focus:outline-none focus:ring-0 focus:border-none"
                style={{
                  backgroundColor: '#0F0F0F',
                  border: 'none',
                  color: amount > 0 ? '#FFFFFF' : '#6B7280',
                  fontSize: '24px',
                  fontWeight: '700',
                  WebkitAppearance: 'none',
                  MozAppearance: 'textfield',
                  outline: 'none',
                  boxShadow: 'none'
                }}
              />
            </div>

            {/* Quick Amount Buttons - Sophisticated Design */}
            <div className="space-y-1.5 mb-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Quick Amounts</h4>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                  USD
                </div>
              </div>
              
              <div className="flex gap-1">
                {quickAmounts.map((value) => (
                  <button
                    key={value}
                    onClick={() => handleQuickAmount(value)}
                    className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded border border-[#222222] hover:border-[#333333] transition-all duration-200 flex-1"
                  >
                    <div className="flex items-center justify-center py-1.5 px-2">
                      <div className="flex items-center gap-1">
                        <div className="w-1 h-1 rounded-full bg-[#404040] group-hover:bg-blue-400" />
                        <span className="text-[10px] font-medium text-[#808080] group-hover:text-[#9CA3AF]">
                          +${value}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
                <button
                  onClick={handleMaxAmount}
                  className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded border border-[#222222] hover:border-blue-400 transition-all duration-200"
                >
                  <div className="flex items-center justify-center py-1.5 px-3">
                    <div className="flex items-center gap-1">
                      <div className="w-1 h-1 rounded-full bg-blue-400" />
                      <span className="text-[10px] font-medium text-blue-400">
                        Max
                      </span>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Advanced Setup - Sophisticated Design */}
            <div className="space-y-1.5 mb-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Advanced Setup</h4>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                  {leverage}x
                </div>
              </div>
              
              <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                <div 
                  className="flex items-center justify-between p-2.5 cursor-pointer"
                  onClick={() => setIsAdvancedSetupExpanded(!isAdvancedSetupExpanded)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                    <span className="text-[11px] font-medium text-[#808080]">
                      Leverage & Risk Settings
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white font-mono">{leverage}x</span>
                    <svg 
                      className={`w-3 h-3 text-[#404040] transition-transform duration-200 ${isAdvancedSetupExpanded ? 'rotate-180' : ''}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                
                {/* Expandable details on hover */}
                <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                  <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                    <div className="text-[9px] pt-1.5">
                      <span className="text-[#606060]">Adjust leverage multiplier and risk parameters</span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Expanded leverage controls */}
              {isAdvancedSetupExpanded && (
                <div className="bg-[#0F0F0F] rounded-md border border-[#222222] p-2.5">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[9px] font-medium text-[#606060] uppercase tracking-wide">Leverage</span>
                    <span className="text-xs font-bold text-white">{leverage}x</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="50"
                    value={leverage}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLeverage(parseInt(e.target.value))}
                    className="w-full h-1 bg-[#2A2A2A] rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[8px] text-[#606060] mt-1">
                    <span>1x</span>
                    <span>Safe</span>
                    <span>Risky</span>
                    <span>50x</span>
                  </div>
                </div>
              )}
            </div>

            {/* Trade Summary - Sophisticated Design */}
            {amount > 0 && (
              <div className="space-y-1.5 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Order Summary</h4>
                  <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                    {orderType.toUpperCase()}
                  </div>
                </div>
                
                <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                  <div className="p-2.5">
                    <div className="space-y-1 text-[9px]">
                      <div className="flex justify-between">
                        <span className="text-[#606060]">Order Amount:</span>
                        <span className="text-white font-mono">${formatNumber(amount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#606060]">Leverage:</span>
                        <span className="text-white font-mono">{leverage}x</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#606060]">Position Size:</span>
                        <span className="text-white font-mono">${formatNumber(amount * leverage)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#606060]">Trading Fee:</span>
                        <span className="text-white font-mono">${formatNumber(amount * 0.001)}</span>
                      </div>
                      {orderType === 'limit' && (
                        <>
                          <div className="border-t border-[#1A1A1A] my-1"></div>
                          <div className="flex justify-between">
                            <span className="text-[#606060]">Trigger Price:</span>
                            <span className="text-white font-mono">${triggerPrice > 0 ? formatNumber(triggerPrice) : 'Not set'}</span>
                          </div>
                        </>
                      )}
                    </div>
                    
                    {/* Order validation messages */}
                    <div className="mt-2">
                      <OrderValidationComponent />
                    </div>
                  </div>
                  
                  {/* Hover details */}
                  <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                    <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                      <div className="text-[9px] pt-1.5">
                        <span className="text-[#606060]">
                          {selectedOption === 'long' ? 'Betting on price increase' : 'Betting on price decrease'} with {leverage}x leverage
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}


          </div>
            </>
          )}
        </div>

        {/* Trade Button */}
        <div className="flex gap-2">
          {!walletData.isConnected ? (
            <button 
              onClick={() => connect()}
              className="flex-1 transition-all duration-150 border-none cursor-pointer rounded-md bg-[#3B82F6] text-white"
              style={{
                padding: '12px',
                fontSize: '16px',
                fontWeight: '600'
              }}
            >
              Connect Wallet
            </button>
          ) : (
            <button 
              onClick={handleTradeClick}
              disabled={!canExecuteTrade() || isTrading || isSubmittingOrder}
              className="flex-1 transition-all duration-150 border-none cursor-pointer rounded-md"
              style={{
                padding: '12px',
                fontSize: '16px',
                fontWeight: '600',
                backgroundColor: (!canExecuteTrade() || isTrading || isSubmittingOrder) ? '#1A1A1A' : '#3B82F6',
                color: (!canExecuteTrade() || isTrading || isSubmittingOrder) ? '#6B7280' : '#FFFFFF',
                cursor: (!canExecuteTrade() || isTrading || isSubmittingOrder) ? 'not-allowed' : 'pointer'
              }}
            >
              {getTradeButtonText()}
            </button>
          )}
        </div>
      </div>
      
      {/* Custom scrollbar and slider styles */}
      <style jsx>{`
        :global(.trading-panel-scroll::-webkit-scrollbar) {
          width: 2px;
        }
        
        :global(.trading-panel-scroll::-webkit-scrollbar-track) {
          background: transparent;
        }
        
        :global(.trading-panel-scroll::-webkit-scrollbar-thumb) {
          background: #22C55E;
          border-radius: 2px;
        }
        
        :global(.trading-panel-scroll::-webkit-scrollbar-thumb:hover) {
          background: #16A34A;
        }
        
        :global(.trading-panel-scroll) {
          scrollbar-width: thin;
          scrollbar-color: #22C55E transparent;
        }
        
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        
        input[type="number"]:focus,
        input[type="number"] {
          outline: none !important;
          box-shadow: none !important;
          border: none !important;
        }

        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #22C55E;
          cursor: pointer;
        }

        .slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #22C55E;
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  );
} 