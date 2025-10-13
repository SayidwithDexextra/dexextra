'use client';

import { useState, useCallback, useMemo } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import type { Address } from 'viem';
import { createWalletClient, custom, parseEther, formatEther, parseUnits } from 'viem';
import { polygon } from 'viem/chains';
import { publicClient } from '@/lib/viemClient';

// Import ABIs
const ORDERBOOK_ABI = [
  {
    inputs: [],
    name: 'getBestPrices',
    outputs: [
      { name: 'bestBidPrice', type: 'uint256' },
      { name: 'bestAskPrice', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
];

// Updated TradingRouter ABI for new scaled contracts (Sept 2, 2025)
const TRADING_ROUTER_ABI = [
  {
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'side', type: 'uint8' },
      { name: 'size', type: 'uint256' },
      { name: 'price', type: 'uint256' }
    ],
    name: 'placeLimitOrder',
    outputs: [{ name: 'orderId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'side', type: 'uint8' },
      { name: 'size', type: 'uint256' }
    ],
    name: 'placeMarketOrder',
    outputs: [{ name: 'orderId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'orderId', type: 'bytes32' }
    ],
    name: 'cancelOrder',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'size', type: 'uint256' }
    ],
    name: 'closePosition',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [],
    name: 'emergencyCloseAllPositions',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getUserOrderSummary',
    outputs: [
      { name: 'totalOrders', type: 'uint256' },
      { name: 'totalReservedMargin', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'marketIds', type: 'bytes32[]' }],
    name: 'getMultiMarketPrices',
    outputs: [
      { name: 'bestBids', type: 'uint256[]' },
      { name: 'bestAsks', type: 'uint256[]' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'isPaused',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'vaultRouter',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

export enum OrderSide {
  BUY = 0,
  SELL = 1
}

interface TradingRouterState {
  isLoading: boolean;
  error: string | null;
  isPaused: boolean;
}

interface MarketOrderParams {
  marketId: string;
  side: 'long' | 'short';
  size: number; // Size in tokens/units
}

interface LimitOrderParams {
  marketId: string;
  side: 'long' | 'short';
  size: number; // Size in tokens/units
  price: number; // Price per unit
}

interface OrderResult {
  success: boolean;
  orderId?: string;
  transactionHash?: string;
  error?: string;
}

interface UserOrderSummary {
  totalOrders: number;
  totalReservedMargin: number;
}

interface MarketPrices {
  bestBid: number;
  bestAsk: number;
}

export function useTradingRouter() {
  const { walletData } = useWallet();
  const [state, setState] = useState<TradingRouterState>({
    isLoading: false,
    error: null,
    isPaused: false
  });

  // Create wallet client for contract interactions
  const walletClient = useMemo(() => {
    if (!walletData.isConnected || !walletData.address || typeof window === 'undefined' || !window.ethereum) {
      return null;
    }

    return createWalletClient({
      chain: polygon,
      transport: custom(window.ethereum),
      account: walletData.address as Address,
    });
  }, [walletData.isConnected, walletData.address]);

  // Helper function to convert string to bytes32 (for direct market IDs)
  const stringToBytes32 = useCallback((str: string): `0x${string}` => {
    // If it's already a valid market ID (starts with 0x and 66 chars), return as-is
    if (str.startsWith('0x') && str.length === 66) {
      return str as `0x${string}`;
    }
    
    // Otherwise, encode as bytes32 for legacy compatibility
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `0x${hex.padEnd(64, '0')}` as `0x${string}`;
  }, []);

  // Helper function to resolve symbol to actual market ID
  const resolveMarketId = useCallback(async (symbol: string): Promise<string> => {
    try {
      // If already a market ID, return as-is
      if (symbol.startsWith('0x') && symbol.length === 66) {
        return symbol;
      }

      // For Aluminum V1, use the actual market ID from factory (discovered via debug)
      if (symbol === 'Aluminum V1' || symbol === 'ALUMINUM_V1_HYPERLIQUID') {
        return '0x41e77fd5318a7e3c379ff8fe985be494211c1b2a0a0fa1fa2f99ac7d5060892a';
      }

      // For other symbols, try to resolve via factory  
      const factoryAddress = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.tradingRouter,
        abi: TRADING_ROUTER_ABI,
        functionName: 'factory',
        args: [],
      });

      // Try to get market ID from factory
      const marketId = await publicClient.readContract({
        address: factoryAddress as Address,
        abi: [
          {
            inputs: [{ name: 'symbol', type: 'string' }],
            name: 'getMarketBySymbol',
            outputs: [{ name: '', type: 'bytes32' }],
            stateMutability: 'view',
            type: 'function'
          }
        ],
        functionName: 'getMarketBySymbol',
        args: [symbol],
      });

      return marketId as string;
    } catch (error) {
      console.error('❌ Failed to resolve market ID:', error);
      throw new Error(`Could not resolve market ID for symbol: ${symbol}`);
    }
  }, []);

  // Helper function to convert size and price to contract format
  const formatValue = useCallback((value: number): bigint => {
    return parseEther(value.toString());
  }, []);

  // Helper function to format size (quantity) for TradingRouter
  const formatSize = useCallback((quantity: number): bigint => {
    // Convert to 6-decimal precision (USDC format) as expected by contracts
    // MAX_ORDER_SIZE in contract is 1,000,000 units in 6-decimal format
    const contractSize = parseUnits(quantity.toString(), 6);
    
    // Validate against contract's MAX_ORDER_SIZE (1,000,000 units)
    const MAX_ORDER_SIZE = parseUnits('1000000', 6); // 1M units max
    if (contractSize > MAX_ORDER_SIZE) {
      throw new Error(`Order size too large. Maximum allowed: 1,000,000 units. You tried: ${quantity.toLocaleString()} units.`);
    }
    
    return contractSize;
  }, []);

  // Helper function to format price for TradingRouter  
  const formatPrice = useCallback((price: number): bigint => {
    // Convert to 6-decimal precision (USDC format) as expected by contracts
    // Validate price range (MIN: $0.01, MAX: $1000)
    const contractPrice = parseUnits(price.toString(), 6);
    
    const MIN_REASONABLE_PRICE = parseUnits('0.01', 6); // $0.01 min
    const MAX_REASONABLE_PRICE = parseUnits('1000', 6); // $1000 max
    
    if (contractPrice < MIN_REASONABLE_PRICE) {
      throw new Error(`Price too low. Minimum allowed: $0.01. You tried: $${price.toFixed(2)}.`);
    }
    
    if (contractPrice > MAX_REASONABLE_PRICE) {
      throw new Error(`Price too high. Maximum allowed: $1,000. You tried: $${price.toLocaleString()}.`);
    }
    
    return contractPrice;
  }, []);

  // Helper function to convert contract price back to display price
  const unscalePrice = useCallback((contractPrice: bigint): number => {
    // Convert contract price from 6-decimal precision back to user-facing dollar amounts
    // Contract price 5000000 → Display price $5.00 (divide by 1000000)
    const PRICE_PRECISION = 1e6;
    return Number(contractPrice) / PRICE_PRECISION;
  }, []);

  // Place market order
  const placeMarketOrder = useCallback(async (params: MarketOrderParams): Promise<OrderResult> => {
    if (!walletClient) {
      return { success: false, error: 'Wallet not connected' };
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // First resolve the symbol to actual market ID
      const resolvedMarketId = await resolveMarketId(params.marketId);
      const marketIdBytes32 = stringToBytes32(resolvedMarketId);
      const sideValue = params.side === 'long' ? OrderSide.BUY : OrderSide.SELL;
      const sizeFormatted = formatSize(params.size); // Direct conversion with 6-decimal precision
      
      console.log('🚀 Placing market order with new scaled contracts:', {
        originalSymbol: params.marketId,
        resolvedMarketId,
        marketIdBytes32,
        side: params.side,
        sideValue,
        userInputSize: params.size,
        contractSize: formatEther(sizeFormatted),
        note: 'Using new contracts with 6-decimal USDC precision'
      });

      const finalArgs = [marketIdBytes32, sideValue, sizeFormatted];

      const { request } = await publicClient.simulateContract({
        address: CONTRACT_ADDRESSES.tradingRouter,
        abi: TRADING_ROUTER_ABI,
        functionName: 'placeMarketOrder', // Use actual market order function
        args: finalArgs,
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
      let errorMessage = error?.shortMessage || error?.message || 'Failed to place market order';
      
      // Check for common errors with improved messaging for new contracts
      if (errorMessage.includes('Array index is out of bounds')) {
        errorMessage = 'Market order failed due to insufficient liquidity. Please try placing limit orders to create market depth.';
      } else if (errorMessage.includes('insufficient collateral')) {
        errorMessage = 'Insufficient collateral in VaultRouter. Please deposit more USDC or reduce order size.';
      } else if (errorMessage.includes('market not found')) {
        errorMessage = 'Market not available. Please ensure the market exists and is active.';
      }
      
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      
      return { success: false, error: errorMessage };
    }
  }, [walletClient, walletData.address, stringToBytes32, formatSize, resolveMarketId]);

  // Place limit order
  const placeLimitOrder = useCallback(async (params: LimitOrderParams): Promise<OrderResult> => {
    if (!walletClient) {
      return { success: false, error: 'Wallet not connected' };
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // First resolve the symbol to actual market ID
      const resolvedMarketId = await resolveMarketId(params.marketId);
      const marketIdBytes32 = stringToBytes32(resolvedMarketId);
      const sideValue = params.side === 'long' ? OrderSide.BUY : OrderSide.SELL;
      const sizeFormatted = formatSize(params.size); // Direct conversion with 6-decimal precision
      const priceFormatted = formatPrice(params.price); // Direct conversion with 6-decimal precision

      console.log('📋 Placing limit order with new scaled contracts:', {
        originalSymbol: params.marketId,
        resolvedMarketId,
        marketIdBytes32,
        side: params.side,
        sideValue,
        size: params.size,
        sizeFormatted: formatEther(sizeFormatted),
        price: params.price,
        priceFormatted: formatEther(priceFormatted),
        note: 'Using new contracts with 6-decimal USDC precision'
      });

      const { request } = await publicClient.simulateContract({
        address: CONTRACT_ADDRESSES.tradingRouter,
        abi: TRADING_ROUTER_ABI,
        functionName: 'placeLimitOrder',
        args: [marketIdBytes32, sideValue, sizeFormatted, priceFormatted],
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
      console.error('❌ Limit order failed:', error);
      const errorMessage = error?.shortMessage || error?.message || 'Failed to place limit order';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      
      return { success: false, error: errorMessage };
    }
  }, [walletClient, walletData.address, stringToBytes32, formatSize, formatPrice, resolveMarketId]);

  // Cancel order
  const cancelOrder = useCallback(async (marketId: string, orderId: string): Promise<OrderResult> => {
    if (!walletClient) {
      return { success: false, error: 'Wallet not connected' };
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const marketIdBytes32 = stringToBytes32(marketId);
      const orderIdBytes32 = stringToBytes32(orderId);

      const { request } = await publicClient.simulateContract({
        address: CONTRACT_ADDRESSES.tradingRouter,
        abi: TRADING_ROUTER_ABI,
        functionName: 'cancelOrder',
        args: [marketIdBytes32, orderIdBytes32],
        account: walletData.address as Address,
      });

      const hash = await walletClient.writeContract(request);
      
      // Wait for transaction receipt
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      setState(prev => ({ ...prev, isLoading: false }));

      return {
        success: true,
        transactionHash: hash
      };

    } catch (error: any) {
      console.error('❌ Cancel order failed:', error);
      const errorMessage = error?.shortMessage || error?.message || 'Failed to cancel order';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      
      return { success: false, error: errorMessage };
    }
  }, [walletClient, walletData.address, stringToBytes32]);

  // Close position
  const closePosition = useCallback(async (marketId: string, size?: number): Promise<OrderResult> => {
    if (!walletClient) {
      return { success: false, error: 'Wallet not connected' };
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const marketIdBytes32 = stringToBytes32(marketId);
      const sizeFormatted = size ? formatValue(size) : BigInt(0); // 0 means close entire position

      const { request } = await publicClient.simulateContract({
        address: CONTRACT_ADDRESSES.tradingRouter,
        abi: TRADING_ROUTER_ABI,
        functionName: 'closePosition',
        args: [marketIdBytes32, sizeFormatted],
        account: walletData.address as Address,
      });

      const hash = await walletClient.writeContract(request);
      
      // Wait for transaction receipt
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      setState(prev => ({ ...prev, isLoading: false }));

      return {
        success: true,
        transactionHash: hash
      };

    } catch (error: any) {
      console.error('❌ Close position failed:', error);
      const errorMessage = error?.shortMessage || error?.message || 'Failed to close position';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      
      return { success: false, error: errorMessage };
    }
  }, [walletClient, walletData.address, stringToBytes32, formatValue]);

  // Emergency close all positions
  const emergencyCloseAllPositions = useCallback(async (): Promise<OrderResult> => {
    if (!walletClient) {
      return { success: false, error: 'Wallet not connected' };
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const { request } = await publicClient.simulateContract({
        address: CONTRACT_ADDRESSES.tradingRouter,
        abi: TRADING_ROUTER_ABI,
        functionName: 'emergencyCloseAllPositions',
        args: [],
        account: walletData.address as Address,
      });

      const hash = await walletClient.writeContract(request);
      
      // Wait for transaction receipt
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      setState(prev => ({ ...prev, isLoading: false }));

      return {
        success: true,
        transactionHash: hash
      };

    } catch (error: any) {
      console.error('❌ Emergency close failed:', error);
      const errorMessage = error?.shortMessage || error?.message || 'Failed to close all positions';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      
      return { success: false, error: errorMessage };
    }
  }, [walletClient, walletData.address]);

  // Check if order can be placed - simplified for new contracts
  const canPlaceOrder = useCallback(async (marketId: string, size: number, price: number): Promise<boolean> => {
    if (!walletData.address) return false;

    try {
      // With new contracts, simple validation is sufficient
      // Main checks: wallet connected, valid size and price
      return size > 0 && price > 0 && walletData.isConnected;
    } catch (error) {
      console.error('❌ Error checking order eligibility:', error);
      return false;
    }
  }, [walletData.address, walletData.isConnected]);

  // Get user order summary
  const getUserOrderSummary = useCallback(async (): Promise<UserOrderSummary | null> => {
    if (!walletData.address) return null;

    try {
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.tradingRouter,
        abi: TRADING_ROUTER_ABI,
        functionName: 'getUserOrderSummary',
        args: [walletData.address as Address],
      });

      const [totalOrders, totalReservedMargin] = result as [bigint, bigint];

      return {
        totalOrders: Number(totalOrders),
        totalReservedMargin: Number(formatEther(totalReservedMargin))
      };
    } catch (error) {
      console.error('❌ Error getting user order summary:', error);
      return null;
    }
  }, [walletData.address]);

  // Get market prices
  const getMarketPrices = useCallback(async (marketIds: string[]): Promise<Record<string, MarketPrices>> => {
    try {
      const marketIdsBytes32 = marketIds.map(id => stringToBytes32(id));

      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.tradingRouter,
        abi: TRADING_ROUTER_ABI,
        functionName: 'getMultiMarketPrices',
        args: [marketIdsBytes32],
      });

      const [bestBids, bestAsks] = result as [bigint[], bigint[]];

      const prices: Record<string, MarketPrices> = {};
      marketIds.forEach((marketId, index) => {
        prices[marketId] = {
          bestBid: Number(formatEther(bestBids[index])),
          bestAsk: Number(formatEther(bestAsks[index]))
        };
      });

      return prices;
    } catch (error) {
      console.error('❌ Error getting market prices:', error);
      return {};
    }
  }, [stringToBytes32]);

  // Check if market order can be placed (requires liquidity on opposite side)
  const canPlaceMarketOrder = useCallback(async (marketId: string, side: 'long' | 'short'): Promise<{ canPlace: boolean; reason?: string }> => {
    try {
      const marketIdBytes32 = stringToBytes32(marketId);
      
      console.log('🔧 DEBUG: Contract call parameters:', {
        address: CONTRACT_ADDRESSES.aluminumOrderBook,
        functionName: 'getBestPrices',
        addressType: typeof CONTRACT_ADDRESSES.aluminumOrderBook,
        addressUndefined: CONTRACT_ADDRESSES.aluminumOrderBook === undefined
      });
      
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.aluminumOrderBook,
        abi: ORDERBOOK_ABI,
        functionName: 'getBestPrices',
        args: [],
      });

      const [bestBid, bestAsk] = result as [bigint, bigint];
      
      console.log('🔍 Order book liquidity check:', {
        side,
        bestBid: bestBid.toString(),
        bestAsk: bestAsk.toString(),
        needsForSell: 'buy orders (bestBid > 0)',
        needsForBuy: 'sell orders (bestAsk > 0)'
      });

      if (side === 'short') {
        // Market SELL needs BUY orders to match against
        if (bestBid === 0n) {
          return { 
            canPlace: false, 
            reason: 'No buy orders available in order book. Market sell orders need existing buy orders to match against. Place some buy limit orders first.' 
          };
        }
      } else {
        // Market BUY needs SELL orders to match against  
        if (bestAsk === 0n) {
          return { 
            canPlace: false, 
            reason: 'No sell orders available in order book. Market buy orders need existing sell orders to match against. Place some sell limit orders first.' 
          };
        }
      }

      return { canPlace: true };
    } catch (error) {
      console.error('❌ Error checking market order liquidity:', error);
      
      // Provide specific error messages for common issues
      const errorMessage = error?.message || '';
      if (errorMessage.includes('stack underflow') || errorMessage.includes('Missing or invalid parameters')) {
        return { 
          canPlace: false, 
          reason: 'Contract interface error. Please try limit orders instead of market orders for now.' 
        };
      }
      
      return { 
        canPlace: false, 
        reason: 'Could not check order book liquidity. Please try again.' 
      };
    }
  }, [stringToBytes32]);

  // Check if router is paused
  const checkPauseStatus = useCallback(async (): Promise<boolean> => {
    try {
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.tradingRouter,
        abi: TRADING_ROUTER_ABI,
        functionName: 'isPaused',
        args: [],
      });

      const isPaused = result as boolean;
      setState(prev => ({ ...prev, isPaused }));
      return isPaused;
    } catch (error) {
      console.error('❌ Error checking pause status:', error);
      return false;
    }
  }, []);

  return {
    // State
    isLoading: state.isLoading,
    error: state.error,
    isPaused: state.isPaused,
    isConnected: !!walletClient,

    // Order operations
    placeMarketOrder,
    placeLimitOrder,
    cancelOrder,
    closePosition,
    emergencyCloseAllPositions,

    // Query operations
    canPlaceOrder,
    // canPlaceMarketOrder, // Removed - not needed with new contracts
    getUserOrderSummary,
    getMarketPrices,
    checkPauseStatus,

    // Utils
    clearError: () => setState(prev => ({ ...prev, error: null })),
    resolveMarketId
  };
}

export type { 
  MarketOrderParams, 
  LimitOrderParams, 
  OrderResult, 
  UserOrderSummary, 
  MarketPrices 
};

