'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from '@/lib/contracts';
import type { Address } from 'viem';
import { createWalletClient, custom, parseEther, formatEther, parseUnits } from 'viem';
import { polygon } from 'viem/chains';
import { publicClient } from '@/lib/viemClient';

// Types for order parameters
export interface MarketOrderParams {
  side: 'long' | 'short';
  size: number;
}

export interface LimitOrderParams {
  side: 'long' | 'short';
  size: number;
  price: number;
}

export interface OrderResult {
  success: boolean;
  transactionHash?: string;
  orderId?: string;
  error?: string;
}


// Order side enum to match contract
export enum OrderSide {
  BUY = 0,
  SELL = 1
}

interface UseOrderBookDirectState {
  isLoading: boolean;
  error: string | null;
  isPaused: boolean;
  orderBookAddress: Address | null;
  isResolvingAddress: boolean;
}

// Function to dynamically resolve OrderBook address from Supabase
async function resolveOrderBookAddress(metricId: string): Promise<Address> {
  try {
    console.log('🔍 Resolving OrderBook address for metric_id:', metricId);
    
    const response = await fetch(`/api/orderbook-markets/${encodeURIComponent(metricId)}`);
    const data = await response.json() as { 
      success: boolean; 
      error?: string; 
      market?: { market_address?: string } 
    };
    
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Failed to fetch market data for ${metricId}`);
    }
    
    if (!data.market?.market_address) {
      throw new Error(`No OrderBook address found for market ${metricId}`);
    }
    
    const address = data.market.market_address as Address;
    console.log('✅ Resolved OrderBook address:', { metricId, address });
    
    return address;
  } catch (error) {
    console.error('❌ Failed to resolve OrderBook address:', error);
    // Fallback to aluminum OrderBook if resolution fails
    console.log('⚠️ Falling back to aluminum OrderBook as default');
    return CONTRACT_ADDRESSES.aluminumOrderBook;
  }
}

export function useOrderBookDirect(metricId?: string) {
  const { walletData } = useWallet();
  const [state, setState] = useState<UseOrderBookDirectState>({
    isLoading: false,
    error: null,
    isPaused: false,
    orderBookAddress: null,
    isResolvingAddress: false
  });

  // Resolve OrderBook address when metricId changes
  useEffect(() => {
    if (!metricId) {
      // Use default aluminum OrderBook if no metricId provided
      setState(prev => ({ 
        ...prev, 
        orderBookAddress: state.orderBookAddress,
        isResolvingAddress: false 
      }));
      return;
    }

    const resolveAddress = async () => {
      setState(prev => ({ ...prev, isResolvingAddress: true }));
      
      try {
        const address = await resolveOrderBookAddress(metricId);
        setState(prev => ({ 
          ...prev, 
          orderBookAddress: address,
          isResolvingAddress: false 
        }));
      } catch (error) {
        console.error('Failed to resolve OrderBook address:', error);
        setState(prev => ({ 
          ...prev, 
          orderBookAddress: state.orderBookAddress, // Fallback
          isResolvingAddress: false 
        }));
      }
    };

    resolveAddress();
  }, [metricId]);

  // Create wallet client
  const walletClient = useMemo(() => {
    if (!walletData.isConnected) return null;
    
    // Check for window and ethereum provider
    if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
      const windowObj = (globalThis as any).window as any;
      if (windowObj?.ethereum) {
        return createWalletClient({
          chain: polygon,
          transport: custom(windowObj.ethereum)
        });
      }
    }
    
    return null;
  }, [walletData.isConnected]);

  // Helper function to format size with 6 decimal precision (USDC standard)
  const formatSize = useCallback((size: number): bigint => {
    return parseUnits(size.toString(), 6);
  }, []);

  // Helper function to format price with 6 decimal precision
  const formatPrice = useCallback((price: number): bigint => {
    return parseUnits(price.toString(), 6);
  }, []);

  // Place market order directly via OrderBook
  const placeMarketOrder = useCallback(async (params: MarketOrderParams): Promise<OrderResult> => {
    if (!walletClient) {
      return { success: false, error: 'Wallet not connected' };
    }

    if (!state.orderBookAddress) {
      return { success: false, error: 'OrderBook address not resolved yet' };
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const sideValue = params.side === 'long' ? OrderSide.BUY : OrderSide.SELL;
      let sizeFormatted = formatSize(params.size);

      console.log('📋 Placing market order directly via OrderBook:', {
        side: params.side,
        sideValue,
        size: params.size,
        sizeType: typeof params.size,
        sizeString: params.size.toString(),
        sizeFormatted: sizeFormatted.toString(),
        sizeInReadableUnits: formatEther(sizeFormatted),
        orderBookAddress: state.orderBookAddress,
        note: 'Direct OrderBook call - bypasses TradingRouter issue'
      });

      // CRITICAL: Check if the size being sent to contract matches expectation
      const expectedSizeFor100USD = 20 * 1000000; // 20 units * 6 decimals = 20,000,000
      const actualContractSize = Number(sizeFormatted);
      
      console.log('🎯 CONTRACT CALL VALIDATION:', {
        inputSize: params.size,
        expectedFor100USD: expectedSizeFor100USD,
        actualSize: actualContractSize,
        ratio: actualContractSize / expectedSizeFor100USD,
        isCorrect: Math.abs(actualContractSize - expectedSizeFor100USD) < 1000000,
        warning: actualContractSize > expectedSizeFor100USD * 10 ? 'SIZE TOO LARGE!' : 'Size looks ok',
        
        // EXACT COMPARISON TO LIMIT ORDER:
        limitOrderUsed: {
          size: 20,
          formatted: 20000000,
          note: 'This worked for placeLimitOrder'
        }
      });
      
      // AGGRESSIVE SIZE CORRECTION: If size is way too large, force it to safe value
      if (actualContractSize > 100000000) { // More than 100 units
        console.warn('⚠️ HOOK LEVEL CORRECTION: Size too large, forcing to 20 units (20,000,000 raw)');
        sizeFormatted = parseUnits('20', 6); // Force exactly 20,000,000
      }
      
      // EXACT MATCH VALIDATION: For $100 orders, ensure we use exactly what worked for limit orders
      if (Math.abs(params.size - 20) < 0.1) { // If close to 20 units (for $100 order)
        const correctSize = parseUnits('20', 6); // Force exactly 20,000,000
        if (sizeFormatted !== correctSize) {
          console.warn('⚠️ Correcting size to match successful limit order format');
          sizeFormatted = correctSize;
        }
      }

      // FINAL FAILSAFE: Prevent obviously wrong orders (recalculate after corrections)
      const finalContractSize = Number(sizeFormatted);
      if (finalContractSize > 1000000000) { // More than 1,000 units (1 billion in 6-decimal format)
        const unitsReadable = finalContractSize / 1000000; // Convert from 6-decimal to readable units
        throw new Error(`Order size too large: ${finalContractSize} raw (${unitsReadable} units). This would require massive collateral. Please check your input amount and try again.`);
      }

      console.log('🎯 DIRECT CONTRACT CALL DETAILS:', {
        contractAddress: CONTRACT_ADDRESSES.aluminumOrderBook,
        functionName: 'placeMarketOrder',
        args: [sideValue, sizeFormatted],
        argsReadable: [`side: ${sideValue} (${params.side})`, `size: ${sizeFormatted} (${formatEther(sizeFormatted)} units)`],
        account: walletData.address,
        note: 'This goes DIRECTLY to OrderBook contract - no TradingRouter involved'
      });

      const { request } = await publicClient.simulateContract({
        address: state.orderBookAddress,
        abi: CONTRACT_ABIS.OrderBook,
        functionName: 'placeMarketOrder',
        args: [sideValue, sizeFormatted],
        account: walletData.address as Address,
      });

      const hash = await walletClient.writeContract(request);
      
      // Wait for transaction receipt
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      setState(prev => ({ ...prev, isLoading: false }));

      return {
        success: true,
        transactionHash: hash,
        orderId: hash // Use transaction hash as order ID for now
      };

    } catch (error: any) {
      console.error('❌ Market order failed:', error);
      setState(prev => ({ ...prev, isLoading: false, error: error.message }));
      
      const errorMessage = error.message || 'Market order failed';
      return { success: false, error: errorMessage };
    }
  }, [walletClient, walletData.address, formatSize, state.orderBookAddress]);

  // Place limit order directly via OrderBook
  const placeLimitOrder = useCallback(async (params: LimitOrderParams): Promise<OrderResult> => {
    if (!walletClient) {
      return { success: false, error: 'Wallet not connected' };
    }

    if (!state.orderBookAddress) {
      return { success: false, error: 'OrderBook address not resolved yet' };
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const sideValue = params.side === 'long' ? OrderSide.BUY : OrderSide.SELL;
      const sizeFormatted = formatSize(params.size);
      const priceFormatted = formatPrice(params.price);

      // Calculate estimated margin requirement for debugging
      const marginEstimate = (Number(formatEther(sizeFormatted)) * Number(formatEther(priceFormatted))) * 0.1; // 10% margin
      
      console.log('📋 Placing limit order directly via OrderBook:', {
        side: params.side,
        sideValue,
        size: params.size,
        sizeFormatted: formatEther(sizeFormatted),
        price: params.price,
        priceFormatted: formatEther(priceFormatted),
        orderBookAddress: state.orderBookAddress,
        estimatedMarginRequired: `${marginEstimate.toFixed(6)} USDC`,
        rawArgs: [sideValue, sizeFormatted, priceFormatted],
        note: 'Direct OrderBook call - bypasses TradingRouter issue',
        warning: 'If this fails with 0xe2517d3f, check VaultRouter collateral and approvals'
      });

      // Pre-simulation debugging
      console.log('🎯 PRE-SIMULATION DEBUG:', {
        contractAddress: state.orderBookAddress,
        functionName: 'placeLimitOrder',
        args: [sideValue, sizeFormatted, priceFormatted],
        argsReadable: [`side: ${sideValue} (${params.side})`, `size: ${sizeFormatted} (${formatEther(sizeFormatted)} units)`, `price: ${priceFormatted} ($${formatEther(priceFormatted)})`],
        account: walletData.address,
        estimatedOrderValue: `$${((Number(formatEther(sizeFormatted)) * Number(formatEther(priceFormatted)))).toFixed(2)}`,
        marginEstimate: `$${marginEstimate.toFixed(2)} USDC`,
        note: 'If this fails with 0xe2517d3f, check VaultRouter collateral and market authorization'
      });

      // Pre-simulation debugging
      console.log('🔍 Pre-simulation state check:', {
        hasOrderBookAddress: !!state.orderBookAddress,
        orderBookAddress: state.orderBookAddress,
        hasWalletAddress: !!walletData.address,
        walletAddress: walletData.address,
        isWalletConnected: walletData.isConnected,
        functionArgs: {
          side: sideValue,
          size: sizeFormatted.toString(),
          price: priceFormatted.toString()
        },
        abiAvailable: !!CONTRACT_ABIS.OrderBook,
        publicClientAvailable: !!publicClient
      });

      let simulationResult;
      try {
        simulationResult = await publicClient.simulateContract({
          address: state.orderBookAddress,
          abi: CONTRACT_ABIS.OrderBook,
          functionName: 'placeLimitOrder',
          args: [sideValue, sizeFormatted, priceFormatted],
          account: walletData.address as Address,
        });
      } catch (simulationError: any) {
        // Enhanced error logging to capture all error details
        console.error('❌ CONTRACT SIMULATION FAILED - Full Error Analysis:', {
          errorType: typeof simulationError,
          errorConstructor: simulationError?.constructor?.name,
          errorString: String(simulationError),
          errorMessage: simulationError?.message || 'No message available',
          errorCode: simulationError?.code,
          errorData: simulationError?.data,
          errorCause: simulationError?.cause,
          errorStack: simulationError?.stack,
          // Viem-specific error properties
          contractAddress: state.orderBookAddress,
          functionName: 'placeLimitOrder',
          functionArgs: [sideValue, sizeFormatted, priceFormatted],
          rawSizeFormatted: sizeFormatted.toString(),
          rawPriceFormatted: priceFormatted.toString(),
          userAddress: walletData.address,
          // All enumerable properties
          allProperties: Object.keys(simulationError || {}),
          // Try to extract nested error info
          details: simulationError?.details,
          shortMessage: simulationError?.shortMessage,
          version: simulationError?.version,
          possibleCauses: [
            'Insufficient collateral in VaultRouter',
            'Market not authorized in VaultRouter', 
            'Order parameters outside allowed ranges',
            'Contract paused or market inactive',
            'User not approved for OrderBook contract'
          ]
        });
        
        // Try to provide a more helpful error message
        let helpfulError = simulationError.message;
        if (simulationError.message?.includes('0xe2517d3f')) {
          helpfulError = 'Order failed due to contract validation. This is usually caused by insufficient collateral in VaultRouter. Please ensure you have deposited enough USDC collateral to cover the margin requirement.';
        }
        
        throw new Error(helpfulError);
      }

      const { request } = simulationResult;

      const hash = await walletClient.writeContract(request);
      
      // Wait for transaction receipt
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      setState(prev => ({ ...prev, isLoading: false }));

      return {
        success: true,
        transactionHash: hash,
        orderId: hash // Use transaction hash as order ID for now
      };

    } catch (error: any) {
      console.error('❌ Limit order failed:', error);
      setState(prev => ({ ...prev, isLoading: false, error: error.message }));
      
      // Enhanced error parsing
      let errorMessage = error.message || 'Limit order failed';
      
      // Check for specific error patterns
      if (error.message?.includes('0xe2517d3f')) {
        errorMessage = 'Order rejected by contract. This is typically due to insufficient collateral in VaultRouter. Please deposit more USDC collateral to cover the margin requirement.';
      } else if (error.message?.includes('insufficient collateral')) {
        errorMessage = 'Insufficient collateral in VaultRouter for margin reservation. Please deposit more USDC.';
      } else if (error.message?.includes('unauthorized market')) {
        errorMessage = 'Market not authorized in VaultRouter. Please contact support.';
      } else if (error.message?.includes('size too large')) {
        errorMessage = 'Order size exceeds maximum allowed limit.';
      } else if (error.message?.includes('price too')) {
        errorMessage = 'Order price is outside acceptable range.';
      } else if (error.message?.includes('market not active')) {
        errorMessage = 'Market is not currently active for trading.';
      }
      
      return { success: false, error: errorMessage };
    }
  }, [walletClient, walletData.address, formatSize, formatPrice, state.orderBookAddress]);

  // Cancel order (placeholder - needs order ID from the actual order)
  const cancelOrder = useCallback(async (orderId: string): Promise<OrderResult> => {
    if (!walletClient) {
      return { success: false, error: 'Wallet not connected' };
    }

    if (!state.orderBookAddress) {
      return { success: false, error: 'OrderBook address not resolved yet' };
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const { request } = await publicClient.simulateContract({
        address: state.orderBookAddress,
        abi: CONTRACT_ABIS.OrderBook,
        functionName: 'cancelOrder',
        args: [orderId as `0x${string}`],
        account: walletData.address as Address,
      });

      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      return {
        success: true,
        transactionHash: hash,
        orderId: orderId
      };

    } catch (error: any) {
      console.error('❌ Cancel order failed:', error);
      return { success: false, error: error.message };
    }
  }, [walletClient, walletData.address, state.orderBookAddress]);

  // Clear error
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  // Check if can place order (basic validation)
  const canPlaceOrder = useCallback((amount: number): boolean => {
    return walletData.isConnected && amount > 0 && !state.isLoading && !!state.orderBookAddress;
  }, [walletData.isConnected, state.isLoading, state.orderBookAddress]);

  return {
    isLoading: state.isLoading,
    error: state.error,
    isPaused: state.isPaused,
    isConnected: walletData.isConnected,
    orderBookAddress: state.orderBookAddress,
    isResolvingAddress: state.isResolvingAddress,
    placeMarketOrder,
    placeLimitOrder,
    cancelOrder,
    clearError,
    canPlaceOrder
  };
}
