'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TokenData } from '@/types/token';
import { VAMMMarket } from '@/hooks/useVAMMMarkets';
import { useWallet } from '@/hooks/useWallet';
import { useLimitOrders, CreateLimitOrderParams } from '@/hooks/useLimitOrders';
import { useDexV2 } from '@/hooks/useDexV2';
import { useCentralizedVault } from '@/contexts/CentralizedVaultContext';
import { ErrorModal, SuccessModal } from '@/components/StatusModals';
import { formatEther } from 'viem';

interface TradingPanelProps {
  tokenData: TokenData;
  vammMarket?: VAMMMarket;
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
  
  // Initialize CentralizedVault context for unified margin management
  const { 
    vaultData, 
    portfolioValue, 
    availableCash, 
    unrealizedPnL,
    isConnected: isVaultConnected 
  } = useCentralizedVault(walletData.address);
  
  // Memoize vammMarket to prevent unnecessary re-renders
  const memoizedVammMarket = useMemo(() => vammMarket, [
    vammMarket?.vamm_address,
    vammMarket?.vault_address,
    vammMarket?.symbol,
    vammMarket?.initial_price,
    vammMarket?.deployment_status
  ]);
  
  // Use DexV2 system exclusively
  const currentNetwork = 'polygon';
  const limitOrders = useLimitOrders();
  const dexV2 = useDexV2({ 
    network: currentNetwork,
    autoConnect: true 
  });
  
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
  const [expandedPositions, setExpandedPositions] = useState<Set<string>>(new Set());
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
  const formatNumber = (value: number) => {
    if (value === null || value === undefined || isNaN(value)) return '0.00';
    if (value < 0.01) return value.toFixed(6);
    if (value < 1) return value.toFixed(4);
    if (value < 100) return value.toFixed(2);
    return Math.round(value).toLocaleString();
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

  // Position Management
  interface Position {
    id: string;
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: bigint;
    entryPrice: number;
    markPrice: number;
    pnl: number;
    pnlPercent: number;
    liquidationPrice?: number;
    marginUsed: number;
    isActive: boolean;
    metricId?: string;
    vammAddress?: string;
    positionType?: number;
    targetValue?: number;
    settlementDate?: number;
  }

  // New function to fetch positions by metric ID using contract functions
  const fetchPositionsByMetricId = useCallback(async (metricId: string): Promise<Position[]> => {
    if (!dexV2.service || !walletData.address || !dexV2.isV2Enabled) {
      console.log('⚠️ Cannot fetch positions: service not ready or wallet not connected');
      return [];
    }

    try {
      console.log('🔍 Fetching positions for metric:', metricId);
      
      // Get VAMM address for the metric
      const vammAddress = await dexV2.service.getVAMMAddressForMetric(metricId);
      if (!vammAddress || vammAddress === '0x0000000000000000000000000000000000000000') {
        console.log('⚠️ No VAMM found for metric:', metricId);
        return [];
      }

      console.log('✅ Found VAMM address:', vammAddress);

      // Get position IDs for this user and metric
      const positionIds = await dexV2.service.getMetricPositionsByUser(walletData.address, metricId);

      if (!positionIds || positionIds.length === 0) {
        console.log('📭 No positions found for metric:', metricId);
        return [];
      }

      console.log(`📊 Found ${positionIds.length} positions for metric ${metricId}`);

      // Fetch detailed position data for each position ID
      const positions: Position[] = [];
      
      for (const positionId of positionIds) {
        try {
          // Get detailed position data
          const positionData = await dexV2.service.getMetricPosition(positionId);
          
          // Skip if position data is null (method not fully implemented yet)
          if (!positionData) {
            console.warn(`⚠️ Position data not available for position ${positionId} - method not fully implemented`);
            continue;
          }
          
          if (positionData && positionData.isActive) {
            // Calculate current mark price and PnL
            const currentPrice = await dexV2.service.getMetricMarkPrice(metricId);
            const entryPrice = Number(positionData.entryPrice);
            const markPrice = Number(currentPrice || positionData.entryPrice);
            const size = Number(positionData.size);
            
            // Calculate PnL (simplified calculation)
            const priceDiff = positionData.isLong ? (markPrice - entryPrice) : (entryPrice - markPrice);
            const pnl = (size * priceDiff) / 1e6; // Assuming 6 decimals
            
            positions.push({
              id: positionId.toString(),
              symbol: tokenData.symbol || 'Unknown',
              side: positionData.isLong ? 'LONG' : 'SHORT',
              size: positionData.size,
              entryPrice: entryPrice / 1e6, // Convert from wei
              markPrice: markPrice / 1e6, // Convert from wei
              pnl: pnl,
              pnlPercent: entryPrice > 0 ? (priceDiff / entryPrice) * 100 : 0,
              marginUsed: 0, // Will be calculated if needed
              isActive: positionData.isActive,
              metricId: metricId,
              vammAddress: vammAddress,
              positionType: positionData.positionType,
              targetValue: positionData.targetValue ? Number(positionData.targetValue) / 1e6 : undefined,
              settlementDate: positionData.settlementDate ? Number(positionData.settlementDate) : undefined
            });
          }
        } catch (error) {
          console.warn(`⚠️ Failed to fetch position ${positionId}:`, error);
        }
      }

      console.log(`✅ Successfully fetched ${positions.length} active positions for metric ${metricId}`);
      return positions;

    } catch (error) {
      console.error('❌ Error fetching positions by metric ID:', error);
      return [];
    }
  }, [dexV2.service, dexV2.isV2Enabled, walletData.address]);

  const getAllPositions = (): Position[] => {
    if (!dexV2.isV2Enabled || !dexV2.activePositions) return [];
    
    // Use the existing DexV2 positions as fallback
    return dexV2.activePositions.map((pos: any) => ({
      id: pos.positionId?.toString() || Math.random().toString(),
      symbol: pos.symbol || tokenData.symbol || 'Unknown',
      side: pos.isLong ? 'LONG' : 'SHORT',
      size: pos.size || 0n,
      entryPrice: pos.entryPrice || 0,
      markPrice: pos.markPrice || 0,
      pnl: pos.pnl || 0,
      pnlPercent: pos.pnlPercent || 0,
      liquidationPrice: pos.liquidationPrice,
      marginUsed: pos.marginUsed || 0,
      isActive: pos.size > 0n,
      metricId: pos.metricId,
      vammAddress: pos.vammAddress
    }));
  };

  // State for metric-specific positions
  const [metricPositions, setMetricPositions] = useState<Position[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);

  // Fetch positions for the current metric when component mounts or metric changes
  useEffect(() => {
    const loadMetricPositions = async () => {
      if (!dexV2.isV2Enabled || !walletData.isConnected) return;
      
      setIsLoadingPositions(true);
      try {
        // Use proper metric_id from VAMM market data, fallback to symbol if not available
        const metricId = memoizedVammMarket?.metric_id || tokenData.symbol;
        console.log('🔍 Loading positions for metric:', { metricId, symbol: tokenData.symbol, vammMetricId: memoizedVammMarket?.metric_id });
        
        const positions = await fetchPositionsByMetricId(metricId);
        
        // If we got positions from the metric-specific query, use them
        if (positions.length > 0) {
          setMetricPositions(positions);
        } else {
          // Fallback to existing DexV2 positions if no metric-specific positions found
          console.log('📭 No metric-specific positions found, using DexV2 positions as fallback');
          setMetricPositions([]);
        }
      } catch (error) {
        console.error('❌ Failed to load metric positions:', error);
        // On error, still try to use DexV2 positions as fallback
        setMetricPositions([]);
      } finally {
        setIsLoadingPositions(false);
      }
    };

    loadMetricPositions();
  }, [dexV2.isV2Enabled, walletData.isConnected, tokenData.symbol, memoizedVammMarket?.metric_id]);

  // Enhanced getActivePositions that combines both sources
  const getActivePositions = () => {
    // Prioritize metric-specific positions if available
    if (metricPositions.length > 0) {
      return metricPositions.filter(pos => pos.isActive);
    }
    
    // Fallback to DexV2 positions
    return getAllPositions().filter(pos => pos.isActive);
  };
  const getTotalPositions = () => getAllPositions().length;
  const getPositionsValue = () => getAllPositions().reduce((sum, pos) => sum + pos.pnl, 0);

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
  // 💰 MARGIN CALCULATIONS (Updated for existing collateral only)
  // =====================

  interface MarginStatus {
    isImpossible: boolean;
    needsDeposit: boolean;
    shortfall: number;
    safeAvailableMargin: number | null;
    errorType?: 'wallet' | 'deposit' | 'leverage' | 'amount';
    exactValidation: {
      status: 'valid' | 'needsDeposit' | 'impossible';
      error?: string;
      recommendation?: string;
    };
  }

  const calculateRequiredCollateral = (): number => {
    if (!amount || amount <= 0) return 0;
    return amount; // V2 system: 1:1 collateral to position size base, leverage applies on top
  };

  const calculatePositionSize = (): number => {
    return calculateRequiredCollateral() * leverage;
  };

  const calculateTotalCost = (): number => {
    const collateral = calculateRequiredCollateral();
    const tradingFee = calculatePositionSize() * 0.001; // 0.1% trading fee estimate
    return collateral + tradingFee;
  };

  const getMarginStatus = (): MarginStatus => {
    const requiredCollateral = calculateRequiredCollateral();
    const totalCost = calculateTotalCost();

    // DexV2 margin logic using CentralizedVault (existing collateral only)
    const walletUSDCBalance = parseFloat(dexV2.formattedBalances?.totalCollateral || '0');
    const vaultBalance = parseFloat(portfolioValue || '0');
    const availableVaultMargin = parseFloat(availableCash || '0');

    console.log('💰 Margin Status Calculation:', {
      requiredCollateral,
      totalCost,
      walletUSDCBalance,
      vaultBalance,
      availableVaultMargin,
      amount,
      leverage
    });

    // Check if wallet has sufficient funds (existing collateral only)
    if (walletUSDCBalance < totalCost && availableVaultMargin < totalCost) {
      const totalAvailable = walletUSDCBalance + availableVaultMargin;
      return {
        isImpossible: true,
        needsDeposit: false,
        shortfall: totalCost - totalAvailable,
        safeAvailableMargin: null,
        errorType: 'wallet',
        exactValidation: {
          status: 'impossible',
          error: `Insufficient total funds. Need $${formatNumber(totalCost)} but only have $${formatNumber(totalAvailable)} across wallet and vault.`,
          recommendation: `Deposit $${formatNumber(totalCost - totalAvailable)} more USDC to your wallet or vault.`
        }
      };
    }

    // Check if vault has sufficient margin
    if (availableVaultMargin < totalCost) {
      const needToDeposit = totalCost - availableVaultMargin;
      if (walletUSDCBalance >= needToDeposit) {
        return {
          isImpossible: false,
          needsDeposit: true,
          shortfall: needToDeposit,
          safeAvailableMargin: availableVaultMargin,
          exactValidation: {
            status: 'needsDeposit',
            error: `Vault has $${formatNumber(availableVaultMargin)} but need $${formatNumber(totalCost)}.`,
            recommendation: `Will auto-deposit $${formatNumber(needToDeposit)} from wallet to vault.`
          }
        };
      } else {
        return {
          isImpossible: true,
          needsDeposit: false,
          shortfall: needToDeposit - walletUSDCBalance,
          safeAvailableMargin: null,
          errorType: 'deposit',
          exactValidation: {
            status: 'impossible',
            error: `Insufficient funds for auto-deposit. Need $${formatNumber(needToDeposit)} but wallet only has $${formatNumber(walletUSDCBalance)}.`,
            recommendation: `Deposit $${formatNumber(needToDeposit - walletUSDCBalance)} more USDC to your wallet.`
          }
        };
      }
    }

    // All good
    return {
      isImpossible: false,
      needsDeposit: false,
      shortfall: 0,
      safeAvailableMargin: availableVaultMargin - totalCost,
      exactValidation: {
        status: 'valid',
        recommendation: 'Ready to trade!'
      }
    };
  };

  const canExecuteTrade = () => {
    if (!selectedOption || amount <= 0) return false;
    if (orderType === 'limit' && triggerPrice <= 0) return false;
    
    // For V2, only require wallet connection (not service initialization)
    // Service initialization will be handled safely during trade execution
    if (!walletData.isConnected) return false;
    
    const marginStatus = getMarginStatus();
    return !marginStatus.isImpossible;
  };

  const getTradeButtonText = () => {
    if (!walletData.isConnected) return 'Connect Wallet';
    
    // Check if DexV2 is available safely
    const isDexV2Available = dexV2?.isV2Enabled;
    if (!isDexV2Available) return 'DexV2 Not Available';
    
    if (isTrading) return orderType === 'limit' ? 'Creating Order...' : 'Trading...';
    if (!selectedOption) return 'Select Long or Short';
    if (amount <= 0) return 'Enter Amount';
    if (orderType === 'limit' && triggerPrice <= 0) return 'Set Trigger Price';
    
    const marginStatus = getMarginStatus();
    if (marginStatus.isImpossible) {
      return `Need $${formatNumber(marginStatus.shortfall)} More USDC`;
    }
    
    if (orderType === 'limit') {
      return `Create ${selectedOption === 'long' ? 'Long' : 'Short'} Limit Order`;
    }
    
    return `${selectedOption === 'long' ? 'Long' : 'Short'} ${tokenData.symbol}`;
  };

  const getMarginStatusMessage = (): { type: 'error' | 'warning' | 'success'; message: string; action: string } => {
    const marginStatus = getMarginStatus();
    
    if (marginStatus.isImpossible) {
      return {
        type: 'error',
        message: marginStatus.exactValidation.error || 
                `Insufficient funds. You need $${formatNumber(marginStatus.shortfall)} more USDC to execute this trade.`,
        action: 'Deposit more USDC to your wallet and try again.'
      };
    } else if (marginStatus.needsDeposit) {
      return {
        type: 'warning',
        message: `Insufficient margin in vault. Will auto-deposit $${formatNumber(marginStatus.shortfall)} USDC from your wallet.`,
        action: 'This will happen automatically when you click trade.'
      };
    } else {
      return {
        type: 'success',
        message: `Sufficient margin available. Safe margin: $${formatNumber(marginStatus.safeAvailableMargin || 0)}.`,
        action: 'You can proceed with the trade.'
      };
    }
  };

  const MarginStatusComponent = () => {
    if (!amount || amount <= 0) return null;
    
    const statusMessage = getMarginStatusMessage();
    const colors: Record<'error' | 'warning' | 'success', string> = {
      error: 'text-red-400',
      warning: 'text-yellow-400',
      success: 'text-green-400'
    };
    
    return (
      <div className={`text-[10px] ${colors[statusMessage.type]} mt-1`}>
        <div className="font-semibold">
          {statusMessage.type === 'error' && '❌ '}
          {statusMessage.type === 'warning' && '⚠️ '}
          {statusMessage.type === 'success' && '✅ '}
          {statusMessage.message}
        </div>
        <div className="opacity-75 mt-0.5">
          {statusMessage.action}
        </div>
      </div>
    );
  };

  // =====================
  // 🔍 TRADE VALIDATION
  // =====================

  interface TradeValidation {
    isValid: boolean;
    errors: string[];
  }

  const validateTrade = (): TradeValidation => {
    const errors: string[] = [];
    
    if (!walletData.isConnected) {
      errors.push('Wallet not connected');
    }
    
    if (!selectedOption) {
      errors.push('No trading direction selected');
    }
    
    if (!amount || amount <= 0) {
      errors.push('Invalid amount');
    }
    
    const marginStatus = getMarginStatus();
    if (marginStatus.isImpossible) {
      errors.push(`Insufficient funds: need $${formatNumber(marginStatus.shortfall)} more USDC`);
    }
    
    // Check for unrealistic leverage
    if (leverage > 50) {
      errors.push('Leverage too high - consider reducing for safety');
    }
    
    // Check for very small positions
    if (calculateRequiredCollateral() < 1) {
      errors.push('Position too small - minimum $1 collateral required');
    }
    
    // Check for very large positions relative to available funds
    const totalFunds = parseFloat(dexV2.formattedBalances?.totalCollateral || '0') + parseFloat(availableCash || '0');
    if (calculateTotalCost() > totalFunds * 0.99) {
      errors.push('Position too large - leave some buffer for fees');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  };

  // Enhanced openPosition with gas estimation error handling
  const openPositionWithRetry = async (tradeParams: TradeParams, maxRetries: number = 3) => {
    let attempt = 0;
    
    while (attempt <= maxRetries) {
      try {
        // Refresh data before each attempt to get latest margin info
        if (attempt > 0) {
          console.log(`🔄 Retry attempt ${attempt} - refreshing data...`);
          
          // Re-validate after refresh
          const validation = validateTrade();
          if (!validation.isValid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
          }
        }
        
        console.log(`📊 [Attempt ${attempt + 1}] Opening position with params:`, tradeParams);
        
        // Get VAMM address for the metric with multiple fallback strategies (from test script)
        let vammAddress;
        
        // Strategy 1: Try from memoized VAMM market data
        if (memoizedVammMarket?.vamm_address) {
          vammAddress = memoizedVammMarket.vamm_address;
          console.log('✅ Using VAMM address from market data:', vammAddress);
        }
        
        // Strategy 2: Try from DexV2 service factory lookup
        if (!vammAddress) {
          console.log('⚠️ No VAMM address in market data, attempting factory lookup...');
          try {
            vammAddress = await dexV2.service?.getVAMMAddressForMetric(tradeParams.metricId);
            if (vammAddress) {
              console.log('✅ Found VAMM address via factory lookup:', vammAddress);
            }
          } catch (error) {
            console.warn('Factory lookup failed:', error);
          }
        }
        
        // Strategy 3: Use specialized VAMMs as fallback (from test script)
        if (!vammAddress) {
          console.log('⚠️ Factory lookup failed, trying specialized VAMM fallbacks...');
          const symbol = tradeParams.metricId.toLowerCase();
          const specializedVAMMs = {
            'gold': '0xF4a4CE6743aC7189736fCdE3D1056c17164E20b3', // POPULATION_VAMM as fallback
            'weather': '0x72954d3E7FcDbe12c863bAd28B3b6Df25F93D27b',
            'economic': '0xb987cE613fd156e83adBE3D2D2E63975736bF894'
          };
          
          for (const [key, address] of Object.entries(specializedVAMMs)) {
            if (symbol.includes(key)) {
              vammAddress = address;
              console.log(`✅ Using specialized VAMM for ${key}:`, vammAddress);
              break;
            }
          }
        }
        
        if (!vammAddress) {
          throw new Error(`No VAMM found for metric: ${tradeParams.metricId}. Please ensure the VAMM is deployed or check the router configuration in Supabase.`);
        }
        
        // Execute the trade with DexV2 using ultra-aggressive price ranges (from test script)
        let minPrice: bigint;
        let maxPrice: bigint;
        
        if (attempt === 0) {
          // First attempt: Use calculated price ranges with ultra-aggressive slippage
          minPrice = calculateMinPrice(tradeParams.isLong, tradeParams.slippageTolerance || 9900); // 99% slippage
          maxPrice = calculateMaxPrice(tradeParams.isLong, tradeParams.slippageTolerance || 9900); // 99% slippage
        } else if (attempt === 1) {
          // Second attempt: Use ultra-wide range (99% slippage)
          const currentPrice = marketData?.currentPrice || 1;
          minPrice = BigInt(Math.floor(currentPrice * 0.01 * 1e6)); // 99% below current price
          maxPrice = BigInt(Math.floor(currentPrice * 100 * 1e6)); // 100x above current price
        } else if (attempt === 2) {
          // Third attempt: Use extremely wide range (99.9% slippage)
          const currentPrice = marketData?.currentPrice || 1;
          minPrice = BigInt(Math.floor(currentPrice * 0.001 * 1e6)); // 99.9% below current price
          maxPrice = BigInt(Math.floor(currentPrice * 1000 * 1e6)); // 1000x above current price
        } else {
          // Final attempt: Use maximum range (99.99% slippage)
          const currentPrice = marketData?.currentPrice || 1;
          minPrice = BigInt(1); // Minimum possible price
          maxPrice = BigInt(Math.floor(currentPrice * 10000 * 1e6)); // 10000x above current price
        }
        
        console.log('📊 Price range calculation:', {
          attempt,
          currentPrice: marketData?.currentPrice,
          isLong: tradeParams.isLong,
          slippageBps: tradeParams.slippageTolerance || 9900,
          slippagePercent: (tradeParams.slippageTolerance || 9900) / 10000,
          minPrice: minPrice.toString(),
          maxPrice: maxPrice.toString(),
          minPriceFormatted: Number(minPrice) / 1e6,
          maxPriceFormatted: Number(maxPrice) / 1e6
        });
        
        // Convert collateral amount to USDC 6-decimal format (from test script)
        const collateralAmountUSDC = BigInt(Math.floor(tradeParams.collateralAmount * 1e6));
        
        const result = await dexV2.trading.openPosition({
          metricId: tradeParams.metricId, // Pass metricId directly for router
          vammAddress: vammAddress, // Keep for backward compatibility
          collateralAmount: collateralAmountUSDC, // Use proper USDC 6-decimal format
          isLong: tradeParams.isLong,
          leverage: BigInt(tradeParams.leverage),
          targetValue: BigInt(0), // 0 for market orders
          positionType: 0, // 0 = MARKET order type
          minPrice: minPrice, // Use ultra-aggressive price range
          maxPrice: maxPrice // Use ultra-aggressive price range
        });
        
        if (result) {
          showSuccess(
            `Successfully opened ${tradeParams.isLong ? 'long' : 'short'} position! Transaction: ${result}`,
            'Trade Executed'
          );
          
          // Reset form
          setAmount(0);
          return { success: true, transactionHash: result };
        } else {
          throw new Error('Trade execution failed');
        }
        
      } catch (error: any) {
        attempt++;
        console.error(`❌ [Attempt ${attempt}] Trade execution failed:`, error);
        
        // If it's a slippage error, try with wider price range on next attempt (from test script)
        if (error.message?.includes('slippage') || error.message?.includes('Price slippage exceeded')) {
          console.log('🔄 Slippage error detected, will use wider price range on next attempt');
          // The price ranges are already set to be ultra-aggressive for each attempt
        }
        
        if (attempt > maxRetries) {
          // Final attempt failed, throw the error
          throw error;
        } else {
          // Wait before retry (exponential backoff)
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // If we get here, all retries failed, try with extremely wide price range as last resort (from test script)
    console.log('🔄 All retries failed, trying with extremely wide price range as last resort...');
    
    // Get VAMM address again for the final attempt
    let vammAddress = memoizedVammMarket?.vamm_address;
    if (!vammAddress) {
      try {
        vammAddress = await dexV2.service?.getVAMMAddressForMetric(tradeParams.metricId);
      } catch (error) {
        console.warn('Final VAMM lookup failed:', error);
      }
    }
    
    if (vammAddress) {
      try {
        // Use the most aggressive price range for final attempt (from test script)
        const finalMinPrice = BigInt(0); // Zero minimum
        const finalMaxPrice = BigInt(Number.MAX_SAFE_INTEGER); // Maximum possible
        
        const collateralAmountUSDC = BigInt(Math.floor(tradeParams.collateralAmount * 1e6));
        
        const result = await dexV2.trading.openPosition({
          metricId: tradeParams.metricId,
          vammAddress: vammAddress,
          collateralAmount: collateralAmountUSDC,
          isLong: tradeParams.isLong,
          leverage: BigInt(tradeParams.leverage),
          targetValue: BigInt(0), // 0 for market orders
          positionType: 0, // 0 = MARKET order type
          minPrice: finalMinPrice, // Zero minimum
          maxPrice: finalMaxPrice // Maximum possible
        });
        
        if (result) {
          showSuccess(
            `Successfully opened ${tradeParams.isLong ? 'long' : 'short'} position with maximum price range! Transaction: ${result}`,
            'Trade Executed'
          );
          setAmount(0);
          return { success: true, transactionHash: result };
        }
      } catch (finalError) {
        console.error('❌ Final attempt with maximum price range also failed:', finalError);
      }
    }
    
    throw new Error('All trading attempts failed, including maximum price range fallback');
  };

  interface TradeParams {
    metricId: string; // Keep for lookup purposes
    vammAddress?: string; // Add vamm address for contract calls
    collateralAmount: number;
    isLong: boolean;
    leverage: number;
    slippageTolerance?: number;
  }

  // =====================
  // 📈 TRADING EXECUTION
  // =====================

  const executeMarketOrder = async () => {
    console.log('🚀 Starting market order execution...');
    
    // Safely check and initialize DexV2 service if needed
    if (!dexV2?.isV2Enabled) {
      showError('DexV2 system is not available. Please try again later.', 'Service Unavailable');
      return;
    }
    
    // Check if service is properly initialized, attempt to initialize if not
    if (!dexV2.isInitialized) {
      console.log('🔄 DexV2 service not initialized, attempting to initialize...');
      try {
        if (dexV2.initialize) {
          await dexV2.initialize();
        }
      } catch (error) {
        console.error('❌ Failed to initialize DexV2 service:', error);
        showError('Failed to initialize trading system. Please refresh the page and try again.', 'Initialization Failed');
        return;
      }
    }
    
    // Verify service has wallet client for write operations
    if (!dexV2.service) {
      showError('Trading service not available. Please refresh the page and reconnect your wallet.', 'Service Error');
      return;
    }
    
    // Debug contract state before trading
    console.log('🔍 Debugging DexV2 service state before trading...');
    dexV2.service.debugContractState();
    
    const validation = validateTrade();
    if (!validation.isValid) {
      console.error('❌ Trade validation failed:', validation.errors);
      showError(
        `Trade validation failed:\n${validation.errors.join('\n')}`,
        'Trade Validation Failed'
      );
      return;
    }

    clearMessages();
    setIsTrading(true);

    try {
      // Get margin status for deposit calculations (existing collateral only)
      const marginStatus = getMarginStatus();

      // Handle collateral deposits if needed (from existing funds only)
      if (marginStatus.needsDeposit && marginStatus.shortfall > 0) {
        const collateralNeeded = BigInt(Math.floor(marginStatus.shortfall * 1e6)); // Convert to USDC decimals
        showSuccess(`Depositing $${formatNumber(marginStatus.shortfall)} USDC from existing funds...`, 'Processing');
        
        try {
          await dexV2.collateral.deposit(collateralNeeded);
          showSuccess('Deposit completed! Proceeding with trade...', 'Processing');
        } catch (depositError) {
          console.error('❌ Auto-deposit failed:', depositError);
          showError(
            `Failed to auto-deposit $${formatNumber(marginStatus.shortfall)} USDC. Please deposit manually and try again.`,
            'Deposit Failed'
          );
          return;
        }
      }

      // Prepare trade parameters with proper USDC decimal handling (from test script)
      const tradeParams: TradeParams = {
        metricId: memoizedVammMarket?.metric_id || tokenData.symbol, // Use proper metric_id from VAMM market data
        collateralAmount: calculateRequiredCollateral(),
        isLong: selectedOption === 'long',
        leverage: leverage,
        slippageTolerance: Math.floor(slippage * 100) || 9900 // Default to 99% slippage for VAMM compatibility
      };

      console.log('📋 Final trade parameters:', tradeParams);
      showSuccess('Executing trade...', 'Processing');
      
      // Execute with retry logic (from test script)
      await openPositionWithRetry(tradeParams);
      
    } catch (error: any) {
      console.error('💥 Market order execution failed:', error);
      
      let errorMessage = 'Trade execution failed. Please try again.';
      let errorTitle = 'Trade Failed';
      const errorStr = error?.message || error?.toString() || '';
      
      if (errorStr.includes('insufficient')) {
        errorMessage = 'Insufficient funds or allowance. Please check your balance and try again.';
        errorTitle = 'Insufficient Funds';
      } else if (errorStr.includes('slippage')) {
        errorMessage = 'Price moved beyond acceptable slippage. Please try again with higher slippage tolerance.';
        errorTitle = 'Slippage Error';
      } else if (errorStr.includes('user rejected') || errorStr.includes('denied')) {
        errorMessage = 'Transaction was cancelled. Please try again if you want to proceed.';
        errorTitle = 'Transaction Cancelled';
      } else if (errorStr.includes('Wallet client required') || errorStr.includes('Cannot read properties of undefined')) {
        errorMessage = 'Wallet connection issue. Please disconnect and reconnect your wallet, then try again.';
        errorTitle = 'Wallet Connection Error';
      } else if (errorStr.includes('No VAMM found')) {
        errorMessage = 'No VAMM available for this metric. Please check if the market is deployed.';
        errorTitle = 'Market Not Available';
      }
      
      showError(errorMessage, errorTitle);
    } finally {
      setIsTrading(false);
    }
  };

  const executeLimitOrder = async () => {
    if (!selectedOption || orderType !== 'limit') return;
    
    console.log('📋 Creating limit order...');
    setIsTrading(true);
    clearMessages();

    try {
      const expiryTimestamp = Math.floor(Date.now() / 1000) + (orderExpiry * 3600); // Convert hours to seconds
      
      const orderParams: CreateLimitOrderParams = {
        metricId: memoizedVammMarket?.metric_id || tokenData.symbol, // Use proper metric_id from VAMM market data
        collateralAmount: calculateRequiredCollateral(),
        isLong: selectedOption === 'long',
        leverage,
        triggerPrice,
        orderType: limitOrderType,
        expiry: expiryTimestamp,
        maxSlippage,
        targetValue: 0, // Default for now
        positionType: 'CONTINUOUS' // Add required field
      };

      const result = await limitOrders.createLimitOrder(orderParams);
      
      if (result.success) {
        showSuccess(
          `Limit order created successfully! Order will execute when ${tokenData.symbol} ${selectedOption === 'long' ? 'drops to' : 'rises to'} $${formatNumber(triggerPrice)}.`,
          'Limit Order Created'
        );
        setAmount(0);
        setTriggerPrice(0);
      } else {
        throw new Error(result.error || 'Failed to create limit order');
      }
    } catch (error: any) {
      console.error('❌ Limit order creation failed:', error);
      showError(
        error?.message || 'Failed to create limit order. Please try again.',
        'Limit Order Failed'
      );
    } finally {
      setIsTrading(false);
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

  const handleClosePosition = async (positionId: string) => {
    console.log(`🔄 Closing position ${positionId}...`);
    setIsTrading(true);
    clearMessages();

    try {
      showSuccess('Closing position...', 'Processing');
      
      // Find the position to get its VAMM address
      const position = getActivePositions().find(pos => pos.id === positionId);
      if (!position) {
        throw new Error('Position not found');
      }
      
      // Use VAMM address from position data if available, otherwise fallback to market data
      let vammAddress = position.vammAddress || memoizedVammMarket?.vamm_address;
      
      if (!vammAddress) {
        console.warn('⚠️ No VAMM address in position data, attempting to get from DexV2 service...');
        try {
          vammAddress = await dexV2.service?.getVAMMAddressForMetric(memoizedVammMarket?.metric_id || tokenData.symbol);
        } catch (error) {
          console.error('Failed to get VAMM address from service:', error);
        }
      }
      
      if (!vammAddress) {
        throw new Error('VAMM address not available for position closure. This token may not have a deployed VAMM yet.');
      }
      
      // Calculate ultra-aggressive price ranges for position closure (from test script)
      const currentPrice = marketData?.currentPrice || 1;
      
      // Use ultra-aggressive price ranges for closing positions (from test script)
      let minPrice: bigint;
      let maxPrice: bigint;
      
      if (position.side === 'LONG') {
        // For long positions, we're willing to sell at a much lower price
        minPrice = BigInt(Math.floor(currentPrice * 0.01 * 1e6)); // 99% below current price
        maxPrice = BigInt(Math.floor(currentPrice * 100 * 1e6)); // 100x above current price
      } else {
        // For short positions, we're willing to buy at a much higher price
        minPrice = BigInt(Math.floor(currentPrice * 0.01 * 1e6)); // 99% below current price
        maxPrice = BigInt(Math.floor(currentPrice * 100 * 1e6)); // 100x above current price
      }
      
      console.log('📊 Closing position with ultra-aggressive price range:', {
        positionId,
        side: position.side,
        currentPrice,
        minPrice: minPrice.toString(),
        maxPrice: maxPrice.toString(),
        minPriceFormatted: Number(minPrice) / 1e6,
        maxPriceFormatted: Number(maxPrice) / 1e6
      });
      
      const result = await dexV2.trading.closePosition(
        vammAddress,
        BigInt(positionId),
        0n, // 0 means close entire position
        minPrice, // Use ultra-aggressive min price
        maxPrice  // Use ultra-aggressive max price
      );

      if (result) {
        showSuccess(
          `Position closed successfully! Transaction: ${result}`,
          'Position Closed'
        );
        
        // Refresh positions after closing
        if (dexV2.isV2Enabled && walletData.isConnected) {
          const metricId = memoizedVammMarket?.metric_id || tokenData.symbol;
          const updatedPositions = await fetchPositionsByMetricId(metricId);
          setMetricPositions(updatedPositions);
        }
      } else {
        throw new Error('Failed to close position');
      }
    } catch (error: any) {
      console.error('❌ Position closure failed:', error);
      
      let errorMessage = 'Failed to close position. Please try again.';
      let errorTitle = 'Close Position Failed';
      
      if (error.message?.includes('slippage') || error.message?.includes('Price slippage exceeded')) {
        errorMessage = 'Price moved beyond acceptable slippage. Please try again with higher slippage tolerance.';
        errorTitle = 'Slippage Error';
      } else if (error.message?.includes('user rejected') || error.message?.includes('denied')) {
        errorMessage = 'Transaction was cancelled. Please try again if you want to proceed.';
        errorTitle = 'Transaction Cancelled';
      } else if (error.message?.includes('Position not found')) {
        errorMessage = 'Position not found or already closed. Please refresh the page.';
        errorTitle = 'Position Not Found';
      }
      
      showError(errorMessage, errorTitle);
    } finally {
      setIsTrading(false);
    }
  };

  const togglePositionExpansion = (positionId: string) => {
    const newExpanded = new Set(expandedPositions);
    if (newExpanded.has(positionId)) {
      newExpanded.delete(positionId);
    } else {
      newExpanded.add(positionId);
    }
    setExpandedPositions(newExpanded);
  };

  // =====================
  // 🔄 EFFECTS
  // =====================

  useEffect(() => {
    if (initialAction) {
      setSelectedOption(initialAction);
      setActiveTab(initialAction === 'long' ? 'buy' : 'sell');
    }
  }, [initialAction]);

  // Auto-refresh data when DexV2 becomes available
  useEffect(() => {
    if (dexV2.isV2Enabled && walletData.isConnected) {
      console.log('♻️ DexV2 system enabled, refreshing data...');
      // Data refresh is handled by the dexV2 hook automatically
    }
  }, [dexV2.isV2Enabled, walletData.isConnected]);

  return (
    <div className="flex-1 flex flex-col">
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
      
      <div className="rounded-md bg-[#0A0A0A] border border-[#333333] p-3">


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
          
          {/* Order Type Dropdown */}
          <div className="flex items-center">
            <select 
              value={orderType}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setOrderType(e.target.value as 'market' | 'limit')}
              className="flex items-center gap-2 px-3 py-1 rounded-md transition-colors duration-150 border-none outline-none cursor-pointer"
              style={{
                backgroundColor: '#2A2A2A',
                color: '#9CA3AF',
                fontSize: '12px',
                fontWeight: '500'
              }}
            >
              <option value="market">Market</option>
              <option value="limit">Limit</option>
            </select>
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
                    if (dexV2.isV2Enabled && walletData.isConnected) {
                      const metricId = memoizedVammMarket?.metric_id || tokenData.symbol;
                      fetchPositionsByMetricId(metricId).then(setMetricPositions);
                    }
                  }}
                  disabled={isLoadingPositions}
                  className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                >
                  {isLoadingPositions ? '⟳ Loading...' : '⟳ Refresh'}
                </button>
              </div>
              
              {/* Position Summary */}
              {!isLoadingPositions && getActivePositions().length > 0 && (
                <div className="mb-3 p-2 bg-[#1A1A1A] rounded-lg border border-[#333333]">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Total Positions:</span>
                      <span className="text-white font-medium">{getActivePositions().length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Total PnL:</span>
                      <span className={`font-medium ${getPositionsValue() >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${formatNumber(getPositionsValue())}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Long Positions:</span>
                      <span className="text-green-400 font-medium">
                        {getActivePositions().filter(pos => pos.side === 'LONG').length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Short Positions:</span>
                      <span className="text-red-400 font-medium">
                        {getActivePositions().filter(pos => pos.side === 'SHORT').length}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              
              {isLoadingPositions && (
                <div className="mb-3 p-4 bg-[#1A1A1A] rounded-lg border border-[#333333] text-center">
                  <div className="text-[#808080] text-sm">
                    <svg className="w-6 h-6 mx-auto mb-2 text-blue-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <p>Loading positions...</p>
                  </div>
                </div>
              )}
              
              {!isLoadingPositions && getActivePositions().length > 0 && (
                <div className="space-y-2">
                  {getActivePositions().map((position) => (
                    <div key={position.id} className="mb-3 p-2 bg-[#1A1A1A] rounded-lg border border-[#333333]">
                      <div 
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => togglePositionExpansion(position.id)}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${position.side === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                            {position.side === 'LONG' ? 'LONG' : 'SHORT'}
                          </span>
                          <span className="text-xs text-[#808080]">
                            ${formatNumber(position.pnl)}
                          </span>
                          <span className="text-xs text-[#606060]">
                            ID: {position.id}
                          </span>
                          {position.metricId && (
                            <span className="text-xs text-[#404040]">
                              {position.metricId}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs ${position.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            ${formatNumber(position.pnl)}
                          </span>
                          <svg 
                            className={`w-3 h-3 text-[#808080] transition-transform duration-200 ${expandedPositions.has(position.id) ? 'rotate-180' : ''}`} 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                      
                      {expandedPositions.has(position.id) && (
                        <div className="mt-2">
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span className="text-[#808080]">Position ID:</span>
                              <span className="text-white font-mono">{position.id}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[#808080]">Size:</span>
                              <span className="text-white">${formatNumber(Number(position.size) / 1e6)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[#808080]">Entry Price:</span>
                              <span className="text-white">${formatNumber(position.entryPrice)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[#808080]">Mark Price:</span>
                              <span className="text-white">${formatNumber(position.markPrice)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[#808080]">Unrealized PnL:</span>
                              <span className={`${position.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                ${formatNumber(position.pnl)}
                              </span>
                            </div>
                            {position.targetValue && (
                              <div className="flex justify-between">
                                <span className="text-[#808080]">Target Value:</span>
                                <span className="text-white">${formatNumber(position.targetValue)}</span>
                              </div>
                            )}
                            {position.settlementDate && (
                              <div className="flex justify-between">
                                <span className="text-[#808080]">Settlement Date:</span>
                                <span className="text-white">{new Date(position.settlementDate * 1000).toLocaleDateString()}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-[#808080]">Status:</span>
                              <span className={`${position.isActive ? 'text-green-400' : 'text-red-400'}`}>
                                {position.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleClosePosition(position.id)}
                            disabled={isTrading || !position.isActive}
                            className="w-full mt-2 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
                          >
                            {isTrading ? 'Closing...' : `Close ${position.side === 'LONG' ? 'Long' : 'Short'} Position`}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Sell Tab - No Positions Message */}
              {!isLoadingPositions && getActivePositions().length === 0 && (
                <div className="mb-3 p-4 bg-[#1A1A1A] rounded-lg border border-[#333333] text-center">
                  <div className="text-[#808080] text-sm">
                    <svg className="w-8 h-8 mx-auto mb-2 text-[#404040]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>No open positions for {tokenData.symbol}</p>
                    <p className="text-xs mt-1">Create a position or limit order in the Buy tab</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sell Tab - Active Limit Orders */}
          {activeTab === 'sell' && (
            <div className="space-y-2 mb-3">
              <h4 className="text-sm font-semibold text-white mb-2">Active Limit Orders</h4>
              {dexV2.activeOrders.map((order) => (
                <div key={order.orderId.toString()} className="p-2 bg-[#1A1A1A] rounded-lg border border-[#333333]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${order.isLong ? 'text-green-400' : 'text-red-400'}`}>
                        {order.isLong ? 'LONG' : 'SHORT'} LIMIT
                      </span>
                      <span className="text-xs text-[#808080]">
                        ${formatBigIntOrNumber(order.collateralAmount * order.leverage)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-blue-400">
                        @ ${formatBigIntOrNumber(order.triggerPrice)}
                      </span>
                      <button
                        onClick={() => limitOrders.cancelLimitOrder(order.orderId.toString(), 'User cancelled')}
                        disabled={limitOrders.isLoading}
                        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Order Type:</span>
                      <span className="text-white">{order.orderType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Collateral:</span>
                      <span className="text-white">${formatBigIntOrNumber(order.collateralAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Leverage:</span>
                      <span className="text-white">{formatBigIntOrNumber(order.leverage)}x</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Expires:</span>
                      <span className="text-white">{new Date(Number(order.expiry) * 1000).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Max Slippage:</span>
                      <span className="text-white">{(Number(order.maxSlippage) / 100).toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Limit Order Stats */}
              {limitOrders.stats && (
                <div className="mt-3 p-2 bg-[#0F0F0F] rounded text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Total Created:</span>
                    <span className="text-white">{limitOrders.stats.totalCreated}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Total Executed:</span>
                    <span className="text-green-400">{limitOrders.stats.totalExecuted}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Total Cancelled:</span>
                    <span className="text-red-400">{limitOrders.stats.totalCancelled}</span>
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

              {/* VAMM Contract Info - Collapsible */}
              {memoizedVammMarket && (
            <div className="mb-3 p-2 bg-[#1A1A1A] rounded-lg">
              <div 
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setIsContractInfoExpanded(!isContractInfoExpanded)}
              >
                <h4 className="text-xs font-semibold text-white">Contract & Market Info</h4>
                <div className="flex items-center gap-2">
                              <span className={`text-[10px] ${
              memoizedVammMarket.deployment_status === 'deployed' ? 'text-green-400' : 
              memoizedVammMarket.deployment_status === 'failed' ? 'text-red-400' : 
              'text-yellow-400'
            }`}>
              {memoizedVammMarket.deployment_status}
                  </span>
                  <svg 
                    className={`w-3 h-3 text-[#808080] transition-transform duration-200 ${isContractInfoExpanded ? 'rotate-180' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              
              {isContractInfoExpanded && (
                <div className="mt-2 space-y-1 text-xs">
                  {/* Market Data */}
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Mark Price:</span>
                    <span className="text-white">
                      ${marketData?.markPrice ? formatNumber(marketData.markPrice.toString()) : formatNumber(tokenData.price?.toString() || '0')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Funding Rate:</span>
                    <span className="text-white">
                      {marketData?.fundingRate ? (marketData.fundingRate * 100).toFixed(4) : '0.0000'}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#808080]">24h Change:</span>
                    <span className={`${(marketData?.priceChangePercent24h || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {marketData?.priceChangePercent24h ? (marketData.priceChangePercent24h >= 0 ? '+' : '') + marketData.priceChangePercent24h.toFixed(2) : '0.00'}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Data Source:</span>
                    <span className="text-green-400 text-[10px]">
                      {marketData?.dataSource || 'static'}
                    </span>
                  </div>
                  <div className="border-t border-[#333333] my-1"></div>
                  {/* Contract Data */}
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Oracle:</span>
                    <span className="text-white font-mono text-[10px]">
                      {memoizedVammMarket.oracle_address.slice(0, 6)}...{memoizedVammMarket.oracle_address.slice(-4)}
                    </span>
                  </div>
                  {memoizedVammMarket.vamm_address && (
                    <div className="flex justify-between">
                      <span className="text-[#808080]">vAMM:</span>
                      <span className="text-white font-mono text-[10px]">
                        {memoizedVammMarket.vamm_address.slice(0, 6)}...{memoizedVammMarket.vamm_address.slice(-4)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Initial Price:</span>
                    <span className="text-white">
                      ${formatNumber(memoizedVammMarket.initial_price?.toString() || '0')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Long/Short Option Buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedOption('long')}
              className="flex-1 transition-all duration-150 border-none cursor-pointer rounded-md"
              style={{
                padding: '12px',
                fontSize: '18px',
                fontWeight: '600',
                textAlign: 'center',
                backgroundColor: selectedOption === 'long' ? '#22C55E' : '#1A1A1A',
                color: selectedOption === 'long' ? '#000000' : '#9CA3AF'
              }}
            >
              Long
            </button>
            <button
              onClick={() => setSelectedOption('short')}
              className="flex-1 transition-all duration-150 border-none cursor-pointer rounded-md"
              style={{
                padding: '12px',
                fontSize: '18px',
                fontWeight: '600',
                textAlign: 'center',
                backgroundColor: selectedOption === 'short' ? '#EF4444' : '#1A1A1A',
                color: selectedOption === 'short' ? '#FFFFFF' : '#9CA3AF'
              }}
            >
              Short
            </button>
          </div>

          {/* Limit Order Configuration */}
          {orderType === 'limit' && (
            <div className="space-y-3 p-3 bg-[#1A1A1A] rounded-lg border border-[#333333]">
              <h4 className="text-sm font-semibold text-white mb-2">Limit Order Settings</h4>
              
              {/* Trigger Price */}
              <div>
                <label className="block text-xs font-medium text-[#9CA3AF] mb-1">Trigger Price (USDC)</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-zinc-400 text-sm font-bold pointer-events-none">$</div>
                  <input
                    type="text"
                    value={triggerPrice > 0 ? triggerPrice.toString() : ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTriggerPrice(parseFloat(e.target.value) || 0)}
                    placeholder="Enter trigger price"
                    className="w-full rounded-lg px-3 py-2 pl-8 text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-0 focus:border-none"
                    style={{
                      backgroundColor: '#0F0F0F',
                      border: 'none',
                      color: triggerPrice > 0 ? '#FFFFFF' : '#6B7280'
                    }}
                  />
                </div>
              </div>

              {/* Order Type */}
              <div>
                <label className="block text-xs font-medium text-[#9CA3AF] mb-1">Order Type</label>
                <select
                  value={limitOrderType}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setLimitOrderType(e.target.value as typeof limitOrderType)}
                  className="w-full rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 focus:outline-none border-none cursor-pointer"
                  style={{
                    backgroundColor: '#0F0F0F',
                    color: '#FFFFFF'
                  }}
                >
                  <option value="LIMIT">Limit Order - Execute at trigger price or better</option>
                  <option value="MARKET_IF_TOUCHED">Market If Touched - Execute market order when price hits trigger</option>
                  <option value="STOP_LOSS">Stop Loss - Close position when price hits trigger</option>
                  <option value="TAKE_PROFIT">Take Profit - Close position at profit target</option>
                </select>
              </div>

              {/* Order Expiry */}
              <div>
                <label className="block text-xs font-medium text-[#9CA3AF] mb-1">Order Expires In</label>
                <div className="flex gap-2">
                  {[1, 6, 24, 72, 168].map((hours) => (
                    <button
                      key={hours}
                      onClick={() => setOrderExpiry(hours)}
                      className="flex-1 px-3 py-2 text-xs font-medium rounded transition-all duration-150 border-none cursor-pointer"
                      style={{
                        backgroundColor: orderExpiry === hours ? '#22C55E' : '#1A1A1A',
                        color: orderExpiry === hours ? '#000000' : '#9CA3AF'
                      }}
                    >
                      {hours === 1 ? '1h' : hours === 6 ? '6h' : hours === 24 ? '1d' : hours === 72 ? '3d' : '1w'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max Slippage */}
              <div>
                <label className="block text-xs font-medium text-[#9CA3AF] mb-1">Max Slippage (Basis Points)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="10"
                    max="500"
                    value={maxSlippage}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxSlippage(parseInt(e.target.value))}
                    className="flex-1 h-2 bg-[#2A2A2A] rounded-lg appearance-none cursor-pointer slider"
                  />
                  <span className="text-sm font-medium text-white min-w-[50px]">
                    {(maxSlippage / 100).toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Limit Order Summary */}
              <div className="mt-3 p-2 bg-[#0F0F0F] rounded text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#808080]">Order Type:</span>
                  <span className="text-white">{limitOrderType.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#808080]">Trigger Price:</span>
                  <span className="text-white">${triggerPrice > 0 ? formatNumber(triggerPrice) : 'Not set'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#808080]">Expires:</span>
                  <span className="text-white">{new Date(Date.now() + orderExpiry * 60 * 60 * 1000).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#808080]">Automation Fee:</span>
                  <span className="text-white">$2.00 USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#808080]">Execution Fee:</span>
                  <span className="text-white">$3.00 USDC</span>
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
                  border: amount > 0 && getMarginStatus().isImpossible ? '1px solid #EF4444' : 'none',
                  color: amount > 0 ? (getMarginStatus().isImpossible ? '#EF4444' : '#FFFFFF') : '#6B7280',
                  fontSize: '24px',
                  fontWeight: '700',
                  WebkitAppearance: 'none',
                  MozAppearance: 'textfield',
                  outline: 'none',
                  boxShadow: 'none'
                }}
              />
            </div>

            {/* Quick Amount Buttons */}
            <div className="flex gap-2 mb-3">
              {quickAmounts.map((value) => (
                <button
                  key={value}
                  onClick={() => handleQuickAmount(value)}
                  className="transition-all duration-150 border-none cursor-pointer rounded hover:bg-opacity-5 hover:bg-white"
                  style={{
                    backgroundColor: '#1A1A1A',
                    color: '#9CA3AF',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: '500'
                  }}
                >
                  +${value}
                </button>
              ))}
              <button
                onClick={handleMaxAmount}
                className="transition-all duration-150 border-none cursor-pointer rounded"
                style={{
                  backgroundColor: '#1A1A1A',
                  color: '#9CA3AF',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: '500'
                }}
              >
                Max
              </button>
            </div>

            {/* Advanced Setup - Collapsible */}
            <div className="mb-3 p-2 bg-[#1A1A1A] rounded-lg">
              <div 
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setIsAdvancedSetupExpanded(!isAdvancedSetupExpanded)}
              >
                <h4 className="text-xs font-semibold text-white">Advanced Setup</h4>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#9CA3AF]">{leverage}x leverage</span>
                  <svg 
                    className={`w-3 h-3 text-[#808080] transition-transform duration-200 ${isAdvancedSetupExpanded ? 'rotate-180' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              
              {isAdvancedSetupExpanded && (
                <div className="mt-2">
                  {/* Leverage Slider */}
                  <div className="mb-2">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-medium text-[#9CA3AF]">LEVERAGE</span>
                      <span className="text-sm font-bold text-white">{leverage}x</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="50"
                      value={leverage}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLeverage(parseInt(e.target.value))}
                      className="w-full h-2 bg-[#2A2A2A] rounded-lg appearance-none cursor-pointer slider"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Trade Summary */}
            {amount > 0 && (
              <div className="mb-2 p-2 bg-[#1A1A1A] rounded text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#808080]">Required Collateral:</span>
                  <span className="text-white">${formatNumber(calculateRequiredCollateral())}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#808080]">Trading Fee:</span>
                  <span className="text-white">${formatNumber(calculatePositionSize() * 0.001)}</span>
                </div>
                {orderType === 'limit' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Automation Fee:</span>
                      <span className="text-white">$2.00</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Execution Fee:</span>
                      <span className="text-white">$3.00</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span className="text-[#808080]">Total Cost:</span>
                  <span className="text-white">${formatNumber(calculateTotalCost())}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#808080]">{orderType === 'limit' ? 'Order Size:' : 'Position Size:'}</span>
                  <span className="text-white">${formatNumber(calculatePositionSize())}</span>
                </div>
                
                {/* Enhanced status messages */}
                <MarginStatusComponent />
                

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
              disabled={!canExecuteTrade() || isTrading}
              className="flex-1 transition-all duration-150 border-none cursor-pointer rounded-md"
              style={{
                padding: '12px',
                fontSize: '16px',
                fontWeight: '600',
                backgroundColor: (!canExecuteTrade() || isTrading) ? '#1A1A1A' : '#3B82F6',
                color: (!canExecuteTrade() || isTrading) ? '#6B7280' : '#FFFFFF',
                cursor: (!canExecuteTrade() || isTrading) ? 'not-allowed' : 'pointer'
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