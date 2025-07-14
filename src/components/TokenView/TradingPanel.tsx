'use client';

import React, { useState, useEffect } from 'react';
import { TokenData } from '@/types/token';
import { VAMMMarket } from '@/hooks/useVAMMMarkets';
import { useVAMMTrading, TradeParams } from '@/hooks/useVAMMTrading';
import { useWallet } from '@/hooks/useWallet';
import { ErrorModal, SuccessModal } from '@/components/StatusModals';
import { ethers } from 'ethers';

interface TradingPanelProps {
  tokenData: TokenData;
  vammMarket?: VAMMMarket;
  initialAction?: 'long' | 'short' | null;
}

export default function TradingPanel({ tokenData, vammMarket, initialAction }: TradingPanelProps) {
  const { walletData, connect } = useWallet();
  const vammTrading = useVAMMTrading(vammMarket);
  
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');
  const [selectedOption, setSelectedOption] = useState<'long' | 'short' | null>(initialAction || 'long');
  const [amount, setAmount] = useState(0);
  const [leverage, setLeverage] = useState(1);
  const [slippage] = useState(0.5); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [isContractInfoExpanded, setIsContractInfoExpanded] = useState(false);
  const [isAdvancedSetupExpanded, setIsAdvancedSetupExpanded] = useState(false);
  const [isCurrentPositionExpanded, setIsCurrentPositionExpanded] = useState(false);
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
  const clearMessages = () => {
    setSuccessModal({ isOpen: false, title: '', message: '' });
    setErrorModal({ isOpen: false, title: '', message: '' });
  };

  const showSuccess = (message: string, title: string = 'Success!') => {
    setSuccessModal({
      isOpen: true,
      title,
      message
    });
  };

  const showError = (message: string, title: string = 'Trading Error') => {
    setErrorModal({
      isOpen: true,
      title,
      message
    });
  };

  const formatNumber = (num: string | number, decimals = 2) => {
    const value = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(value)) return '0';
    return value.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  // Format price from raw 18-decimal precision to human-readable format
  const formatPrice = (rawPrice: string | number) => {
    if (!rawPrice) return '0.00';
    
    try {
      // If it's already a reasonable number (less than 1000), assume it's already formatted
      const numPrice = typeof rawPrice === 'string' ? parseFloat(rawPrice) : rawPrice;
      if (numPrice < 1000) {
        return numPrice.toFixed(2);
      }
      
      // Otherwise, format from raw 18-decimal precision
      const formattedPrice = ethers.formatEther(rawPrice.toString());
      return parseFloat(formattedPrice).toFixed(2);
    } catch (error) {
      console.error('Error formatting price:', error, 'Raw price:', rawPrice);
      return '0.00';
    }
  };

  // Margin and collateral calculations
  const calculateRequiredCollateral = () => {
    if (!amount || !leverage) return 0;
    return amount / leverage;
  };

  const calculatePositionSize = () => {
    if (!amount || !leverage) return 0;
    return amount * leverage;
  };

  // Enhanced margin calculations with trading fees
  const calculateTradingFee = () => {
    if (!amount || !leverage) return 0;
    const positionSize = calculatePositionSize();
    const feeRate = 0.003; // 0.3% trading fee (from vAMM contract)
    return positionSize * feeRate;
  };

  const calculateTotalCost = () => {
    const collateral = calculateRequiredCollateral();
    const tradingFee = calculateTradingFee();
    return collateral + tradingFee;
  };

  // Exact smart contract validation logic
  const validateMarginExactly = (totalCostRequired: number) => {
    const collateral = parseFloat(vammTrading.marginAccount?.collateral || '0');
    const unrealizedPnL = parseFloat(vammTrading.marginAccount?.unrealizedPnL || '0');
    const reservedMargin = parseFloat(vammTrading.marginAccount?.reservedMargin || '0');
    
    // Exact contract logic from Vault.sol
    const totalMargin = collateral + unrealizedPnL;
    
    if (totalMargin <= 0) {
      return {
        isValid: false,
        error: 'Total margin is negative or zero',
        totalMargin,
        availableMargin: 0
      };
    }
    
    if (totalMargin <= reservedMargin) {
      return {
        isValid: false,
        error: 'Total margin is less than or equal to reserved margin',
        totalMargin,
        availableMargin: 0
      };
    }
    
    const exactAvailableMargin = totalMargin - reservedMargin;
    
    // Add safety buffer for price movements and funding changes
    const safetyBuffer = Math.max(5, totalCostRequired * 0.02); // $5 or 2% of cost
    const safeAvailableMargin = exactAvailableMargin - safetyBuffer;
    
    return {
      isValid: safeAvailableMargin >= totalCostRequired,
      error: safeAvailableMargin < totalCostRequired ? 
        `Insufficient margin: need ${totalCostRequired.toFixed(2)} but only have ${safeAvailableMargin.toFixed(2)} (after safety buffer)` : 
        null,
      totalMargin,
      availableMargin: exactAvailableMargin,
      safeAvailableMargin
    };
  };

  const getMarginStatus = () => {
    const totalCost = calculateTotalCost();
    const availableMargin = parseFloat(vammTrading.marginAccount?.availableMargin || '0');
    const walletBalance = parseFloat(vammTrading.collateralBalance || '0');
    const totalMargin = parseFloat(vammTrading.marginAccount?.totalMargin || '0');
    
    // Use exact contract validation
    const exactValidation = validateMarginExactly(totalCost);
    
    // Check if user has enough margin in vault using exact logic
    const hasEnoughMargin = exactValidation.isValid;
    
    // Check if user has enough funds in wallet to cover the shortfall
    const shortfall = Math.max(0, totalCost - (exactValidation.safeAvailableMargin || 0));
    const canCoverShortfall = walletBalance >= shortfall;
    
    return {
      hasEnoughMargin,
      shortfall,
      canCoverShortfall,
      wouldBeHealthy: exactValidation.totalMargin >= totalCost,
      totalCost,
      availableMargin: exactValidation.availableMargin,
      safeAvailableMargin: exactValidation.safeAvailableMargin,
      walletBalance,
      needsDeposit: !hasEnoughMargin,
      isImpossible: !hasEnoughMargin && !canCoverShortfall,
      exactValidation
    };
  };

  const hasInsufficientCollateral = () => {
    const marginStatus = getMarginStatus();
    return marginStatus.needsDeposit;
  };

  const canExecuteTrade = () => {
    if (!selectedOption || amount <= 0 || !vammMarket?.vamm_address) return false;
    
    const marginStatus = getMarginStatus();
    return !marginStatus.isImpossible;
  };

  const getTradeButtonText = () => {
    if (!walletData.isConnected) return 'Connect Wallet';
    if (isTrading) return 'Trading...';
    if (!selectedOption) return 'Select Long or Short';
    if (amount <= 0) return 'Enter Amount';
    if (!vammMarket?.vamm_address) return 'Market Not Available';
    
    const marginStatus = getMarginStatus();
    if (marginStatus.isImpossible) {
      return `Need $${formatNumber(marginStatus.shortfall)} More USDC`;
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

  // Debug component for margin calculations
  const MarginDebugComponent = () => {
    if (!amount || amount <= 0) return null;
    
    const marginStatus = getMarginStatus();
    const [showDebug, setShowDebug] = useState(false);
    
    return (
      <div className="mb-2 p-2 bg-[#1A1A1A] rounded text-xs">
        <div 
          className="flex items-center justify-between cursor-pointer mb-1"
          onClick={() => setShowDebug(!showDebug)}
        >
          <span className="text-[#808080]">Margin Details</span>
          <svg 
            className={`w-3 h-3 text-[#808080] transition-transform duration-200 ${showDebug ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        
        {showDebug && (
          <div className="space-y-1 text-[10px] border-t border-[#333333] pt-1">
            <div className="flex justify-between">
              <span className="text-[#808080]">Collateral:</span>
              <span className="text-white">${formatNumber(vammTrading.marginAccount?.collateral || '0')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#808080]">Unrealized PnL:</span>
              <span className={`${parseFloat(vammTrading.marginAccount?.unrealizedPnL || '0') >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${formatNumber(vammTrading.marginAccount?.unrealizedPnL || '0')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#808080]">Reserved Margin:</span>
              <span className="text-white">${formatNumber(vammTrading.marginAccount?.reservedMargin || '0')}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span className="text-[#808080]">Available Margin:</span>
              <span className="text-white">${formatNumber(marginStatus.availableMargin)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#808080]">Safe Available (with buffer):</span>
              <span className="text-white">${formatNumber(marginStatus.safeAvailableMargin || 0)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span className="text-[#808080]">Total Cost Required:</span>
              <span className="text-white">${formatNumber(marginStatus.totalCost)}</span>
            </div>
            {marginStatus.exactValidation.error && (
              <div className="text-red-400 text-[9px] mt-1">
                {marginStatus.exactValidation.error}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const validateTrade = () => {
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
    
    if (!vammMarket?.vamm_address) {
      errors.push('Market not available');
    }
    
    if (!vammTrading.isActive) {
      errors.push('Oracle is inactive');
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
    const totalFunds = parseFloat(vammTrading.collateralBalance || '0') + parseFloat(vammTrading.marginAccount?.availableMargin || '0');
    if (calculateTotalCost() > totalFunds * 0.99) {
      errors.push('Position too large - leave some buffer for fees');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  };

  const needsApproval = () => {
    if (!amount) return false;
    const allowance = parseFloat(vammTrading.collateralAllowance);
    const marginStatus = getMarginStatus();
    return marginStatus.shortfall > allowance;
  };

  // Enhanced openPosition with gas estimation error handling
  const openPositionWithRetry = async (tradeParams: TradeParams, maxRetries: number = 2) => {
    let attempt = 0;
    
    while (attempt <= maxRetries) {
      try {
        // Refresh data before each attempt to get latest margin info
        if (attempt > 0) {
          console.log(`🔄 Retry attempt ${attempt} - refreshing data...`);
          await vammTrading.refreshData();
          
          // Re-validate after refresh
          const validation = validateTrade();
          if (!validation.isValid) {
            throw new Error(`Re-validation failed: ${validation.errors.join('. ')}`);
          }
        }
        
        const result = await vammTrading.openPosition(tradeParams);
        return result;
        
      } catch (error) {
        console.error(`❌ Position attempt ${attempt + 1} failed:`, error);
        
        if (error instanceof Error) {
          const errorMessage = error.message.toLowerCase();
          
          // Check for gas estimation failure with insufficient margin
          if (errorMessage.includes('execution reverted') && errorMessage.includes('insufficient margin')) {
            if (attempt < maxRetries) {
              console.log(`🔄 Gas estimation failed due to insufficient margin, retrying...`);
              attempt++;
              
              // Add a small delay before retry
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            } else {
              // Final attempt failed, provide detailed error
              const marginStatus = getMarginStatus();
              const detailedError = `
                Margin insufficient at contract level. 
                Available margin: $${marginStatus.availableMargin.toFixed(2)}
                Safe available margin: $${marginStatus.safeAvailableMargin?.toFixed(2) || '0'}
                Required: $${marginStatus.totalCost.toFixed(2)}
                Shortfall: $${marginStatus.shortfall.toFixed(2)}
                
                This could be due to:
                - Price movements affecting unrealized PnL
                - Funding payments applied
                - Concurrent transactions
                
                Please try depositing more collateral or reducing position size.
              `;
              throw new Error(detailedError);
            }
          }
        }
        
        // For other errors, don't retry
        throw error;
      }
    }
    
    throw new Error('Max retries exceeded');
  };

  // Trading functions
  const handleTrade = async () => {
    if (!walletData.isConnected) {
      await connect();
      return;
    }

    // Comprehensive trade validation
    const validation = validateTrade();
    if (!validation.isValid) {
      showError(
        validation.errors.join('. '),
        'Trade Validation Failed'
      );
      return;
    }

    clearMessages();
    setIsTrading(true);

    try {
      // Check oracle status before proceeding
      console.log("🔮 Checking oracle status...");
      console.log("isActive:", vammTrading.isActive);
      console.log("maxPriceAge:", vammTrading.maxPriceAge);
      console.log("owner:", vammTrading.owner);
      console.log("markPrice:", vammTrading.markPrice);

      if (!vammTrading.isActive) {
        throw new Error('Oracle is inactive. Please refresh the oracle price.');
      }

      // Get margin status for deposit calculations
      const marginStatus = getMarginStatus();

      // Check if we need to approve first
      if (needsApproval()) {
        showSuccess('Approving collateral...', 'Processing');
        const approveAmount = Math.max(marginStatus.shortfall, amount * 2); // Approve enough for this trade
        const approveResult = await vammTrading.approveCollateral(approveAmount);
        if (!approveResult.success) {
          throw new Error('Approval failed: ' + approveResult.error);
        }
      }

      // Check if we have enough collateral in the vault
      const totalCost = calculateTotalCost();
      const availableMargin = parseFloat(vammTrading.marginAccount?.availableMargin || '0');
      
      if (totalCost > availableMargin) {
        // Need to deposit more collateral with proper buffer
        const depositAmount = marginStatus.shortfall + 30; // Add $30 buffer for safety
        showSuccess(`Depositing $${formatNumber(depositAmount)} USDC...`, 'Processing');
        const depositResult = await vammTrading.depositCollateral(depositAmount);
        if (!depositResult.success) {
          throw new Error('Deposit failed: ' + depositResult.error);
        }
      }

      // Open the position with retry mechanism
      showSuccess('Opening position...', 'Processing');
      const tradeParams: TradeParams = {
        amount: calculateRequiredCollateral(),
        isLong: selectedOption === 'long',
        leverage,
        slippageTolerance: slippage,
      };

      // Debug price bounds for short positions
      if (selectedOption === 'short') {
        console.log("🩳 Short position debug:");
        console.log("markPrice:", vammTrading.markPrice);
        console.log("slippage:", slippage);
        console.log("amount:", calculateRequiredCollateral());
        console.log("leverage:", leverage);
        
        // Calculate what the bounds should be
        const markPriceWei = parseFloat(vammTrading.markPrice);
        const slippageAmount = markPriceWei * (slippage / 100);
        console.log("minPrice: 0");
        console.log("maxPrice:", markPriceWei + slippageAmount);
      }

      const result = await openPositionWithRetry(tradeParams);
      
      if (result.success) {
        showSuccess(
          `${selectedOption === 'long' ? 'Long' : 'Short'} position opened successfully!`,
          'Trade Success'
        );
        setAmount(0);
      } else {
        throw new Error('Position failed: ' + result.error);
      }

    } catch (error) {
      console.error('Trading error:', error);
      
      // Provide more specific error messages
      let errorMessage = 'Trade failed';
      let errorTitle = 'Trade Error';
      
      if (error instanceof Error) {
        const errorStr = error.message.toLowerCase();
        
        if (errorStr.includes('oracle: inactive')) {
          errorMessage = 'Oracle is inactive. The price oracle needs to be refreshed.';
          errorTitle = 'Oracle Error';
        } else if (errorStr.includes('oracle: price too old')) {
          errorMessage = 'Oracle price is stale. The price oracle needs to be updated.';
          errorTitle = 'Oracle Error';
        } else if (errorStr.includes('price slippage')) {
          errorMessage = 'Price slippage exceeded tolerance. Try increasing slippage tolerance or refreshing the page.';
          errorTitle = 'Slippage Error';
        } else if (errorStr.includes('insufficient margin')) {
          errorMessage = error.message; // Use the detailed error message
          errorTitle = 'Margin Error';
        } else if (errorStr.includes('paused')) {
          errorMessage = 'Trading is currently paused on this market.';
          errorTitle = 'Trading Paused';
        } else if (errorStr.includes('invalid leverage')) {
          errorMessage = 'Invalid leverage amount. Please use leverage between 1x and 100x.';
          errorTitle = 'Invalid Leverage';
        } else {
          errorMessage = error.message || 'Unknown error occurred';
        }
      }
      
      showError(errorMessage, errorTitle);
    } finally {
      setIsTrading(false);
    }
  };

  const handleClosePosition = async () => {
    if (!vammTrading.position) return;
    
    setIsTrading(true);
    clearMessages();
    
    try {
      showSuccess('Closing position...', 'Processing');
      const result = await vammTrading.closePosition(100, slippage); // Close 100% of position
      
      if (result.success) {
        showSuccess(
          'Position closed successfully',
          'Trade Success'
        );
      } else {
        throw new Error('Close failed');
      }
    } catch (error) {
      console.error('Close position error:', error);
      showError(error instanceof Error ? error.message : 'Close failed', 'Close Failed');
    } finally {
      setIsTrading(false);
    }
  };

  const handleCloseSpecificPosition = async (positionIndex: number) => {
    if (!vammTrading.positions || !vammTrading.positions[positionIndex]) return;
    
    setIsTrading(true);
    clearMessages();
    
    try {
      const position = vammTrading.positions[positionIndex];
      showSuccess(`Closing ${position.isLong ? 'long' : 'short'} position...`, 'Processing');
      const result = await vammTrading.closeSpecificPosition(positionIndex, 100, slippage); // Close 100% of position
      
      if (result.success) {
        showSuccess(
          `${position.isLong ? 'Long' : 'Short'} position closed successfully`,
          'Trade Success'
        );
      } else {
        throw new Error('Close failed');
      }
    } catch (error) {
      console.error('Close specific position error:', error);
      showError(error instanceof Error ? error.message : 'Close failed', 'Close Failed');
    } finally {
      setIsTrading(false);
    }
  };

  const quickAmounts = [100, 500, 1000];

  const handleQuickAmount = (value: number) => {
    setAmount(prev => prev + value);
  };

  const handleMaxAmount = () => {
    const walletBalance = parseFloat(vammTrading.collateralBalance || '0');
    const availableMargin = parseFloat(vammTrading.marginAccount?.availableMargin || '0');
    
    // Calculate maximum safe amount based on available funds
    const totalAvailableFunds = walletBalance + availableMargin;
    
    if (totalAvailableFunds > 0) {
      // Account for trading fees (0.3%) and set a safe maximum
      const maxSafeAmount = totalAvailableFunds * leverage * 0.97; // 97% to account for fees and buffer
      setAmount(Math.floor(maxSafeAmount));
    }
  };



  useEffect(() => {
    clearMessages();
  }, [amount, leverage, selectedOption]);

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
          
          {/* Market Dropdown placeholder */}
          <div className="flex items-center">
            <button 
              className="flex items-center gap-2 px-3 py-1 rounded-md transition-colors duration-150 border-none outline-none"
              style={{
                backgroundColor: '#2A2A2A',
                color: '#9CA3AF',
                fontSize: '12px',
                fontWeight: '500'
              }}
            >
              Market
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Trading Content Area - Fixed height exactly like ThreadPanel messages */}
        <div className="h-[235px] overflow-y-auto mb-3 space-y-2 trading-panel-scroll">
          {/* Sell Tab - Current Positions */}
          {activeTab === 'sell' && vammTrading.positions && vammTrading.positions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-white mb-2">Current Positions</h4>
              {vammTrading.positions.map((position, index) => (
                <div key={index} className="mb-3 p-2 bg-[#1A1A1A] rounded-lg border border-[#333333]">
                  <div 
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => setIsCurrentPositionExpanded(!isCurrentPositionExpanded)}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${position.isLong ? 'text-green-400' : 'text-red-400'}`}>
                        {position.isLong ? 'LONG' : 'SHORT'}
                      </span>
                      <span className="text-xs text-[#808080]">
                        ${formatNumber(position.positionSizeUsd)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${parseFloat(position.unrealizedPnL) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${formatNumber(position.unrealizedPnL)}
                      </span>
                      <svg 
                        className={`w-3 h-3 text-[#808080] transition-transform duration-200 ${isCurrentPositionExpanded ? 'rotate-180' : ''}`} 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                  
                  {isCurrentPositionExpanded && (
                    <div className="mt-2">
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[#808080]">Size:</span>
                          <span className="text-white">${formatNumber(position.positionSizeUsd)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#808080]">Entry Price:</span>
                          <span className="text-white">${formatPrice(position.entryPrice)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#808080]">Unrealized PnL:</span>
                          <span className={`${parseFloat(position.unrealizedPnL) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            ${formatNumber(position.unrealizedPnL)}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleCloseSpecificPosition(index)}
                        disabled={isTrading}
                        className="w-full mt-2 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
                      >
                        {isTrading ? 'Closing...' : `Close ${position.isLong ? 'Long' : 'Short'} Position`}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Sell Tab - No Positions Message */}
          {activeTab === 'sell' && (!vammTrading.positions || vammTrading.positions.length === 0) && (
            <div className="mb-3 p-4 bg-[#1A1A1A] rounded-lg border border-[#333333] text-center">
              <div className="text-[#808080] text-sm">
                <svg className="w-8 h-8 mx-auto mb-2 text-[#404040]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p>No open positions</p>
                <p className="text-xs mt-1">Open a position in the Buy tab to see it here</p>
              </div>
            </div>
          )}

          {/* Buy Tab - Trading Interface */}
          {activeTab === 'buy' && (
            <>
              {/* Wallet Balance Info */}
              {walletData.isConnected && (
                <div className="mb-3 p-2 bg-[#1A1A1A] rounded-lg text-xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[#808080]">Wallet USDC:</span>
                    <span className="text-white">${formatNumber(vammTrading.collateralBalance)}</span>
                  </div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[#808080]">Available Margin:</span>
                    <span className="text-white">${formatNumber(vammTrading.marginAccount?.availableMargin || '0')}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#808080]">Total Margin:</span>
                    <span className={`${parseFloat(vammTrading.marginAccount?.totalMargin || '0') >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${formatNumber(vammTrading.marginAccount?.totalMargin || '0')}
                    </span>
                  </div>
                </div>
              )}

              {/* VAMM Contract Info - Collapsible */}
              {vammMarket && (
            <div className="mb-3 p-2 bg-[#1A1A1A] rounded-lg">
              <div 
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setIsContractInfoExpanded(!isContractInfoExpanded)}
              >
                <h4 className="text-xs font-semibold text-white">Contract & Market Info</h4>
                <div className="flex items-center gap-2">
                              <span className={`text-[10px] ${
              vammMarket.deployment_status === 'deployed' ? 'text-green-400' : 
              vammMarket.deployment_status === 'failed' ? 'text-red-400' : 
              'text-yellow-400'
            }`}>
              {vammMarket.deployment_status}
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
                    <span className="text-white">${formatNumber(vammTrading.markPrice)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Funding Rate:</span>
                    <span className="text-white">{(parseFloat(vammTrading.fundingRate || '0') * 100).toFixed(4)}%</span>
                  </div>
                  <div className="border-t border-[#333333] my-1"></div>
                  {/* Contract Data */}
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Oracle:</span>
                    <span className="text-white font-mono text-[10px]">
                      {vammMarket.oracle_address.slice(0, 6)}...{vammMarket.oracle_address.slice(-4)}
                    </span>
                  </div>
                  {vammMarket.vamm_address && (
                    <div className="flex justify-between">
                      <span className="text-[#808080]">vAMM:</span>
                      <span className="text-white font-mono text-[10px]">
                        {vammMarket.vamm_address.slice(0, 6)}...{vammMarket.vamm_address.slice(-4)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Initial Price:</span>
                    <span className="text-white">${vammMarket.initial_price}</span>
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
                type="number"
                value={amount || ''}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
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
                      onChange={(e) => setLeverage(parseInt(e.target.value))}
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
                  <span className="text-white">${formatNumber(calculateTradingFee())}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#808080]">Total Cost:</span>
                  <span className="text-white">${formatNumber(calculateTotalCost())}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#808080]">Position Size:</span>
                  <span className="text-white">${formatNumber(calculatePositionSize())}</span>
                </div>
                
                {/* Enhanced status messages */}
                <MarginStatusComponent />
                
                {needsApproval() && (
                  <div className="text-blue-400 text-[10px]">
                    ℹ️ Requires token approval
                  </div>
                )}
              </div>
            )}

            {/* Margin Debug Component */}
            <MarginDebugComponent />
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
              onClick={handleTrade}
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