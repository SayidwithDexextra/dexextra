'use client';

import { useState, useCallback } from 'react';
import { parseUnits, Address } from 'viem';
import { useWallet } from './useWallet';
import { useAluminumOrderBook, useCoreVault, useMockUSDC } from './useContract';
import { getViemGasOverrides } from '@/lib/gas';

// Order types
export interface OrderParams {
  price?: string;
  size: string;
  isBuy: boolean;
}

export interface OrderResult {
  success: boolean;
  transactionHash?: string;
  orderId?: string;
  error?: string;
}

/**
 * Hook for trading operations using Dexeterav5 contracts
 */
export function useTrading(marketKey: string = 'ALUMINUM') {
  const [isLoading, setIsLoading] = useState(false);
  const [lastTransaction, setLastTransaction] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  
  // Get wallet and contracts
  const { walletData } = useWallet();
  const { contract: orderBookContract } = useAluminumOrderBook();
  const { contract: coreVaultContract } = useCoreVault();
  const { contract: mockUsdcContract } = useMockUSDC();

  /**
   * Check if user has enough collateral for an order
   */
  const checkCollateral = useCallback(async (
    size: string,
    price: string,
    isBuy: boolean
  ): Promise<boolean> => {
    if (!coreVaultContract || !walletData.address) return false;

    try {
      // Calculate required collateral (100% margin)
      const orderValue = Number(size) * Number(price);
      
      // Get user's available collateral
      const availableCollateral = await coreVaultContract.read.getAvailableCollateral([
        walletData.address as Address
      ]);
      
      const availableFormatted = Number(formatUnits(availableCollateral, 6));
      
      return availableFormatted >= orderValue;
    } catch (err) {
      console.error('Error checking collateral:', err);
      return false;
    }
  }, [coreVaultContract, walletData.address]);

  /**
   * Deposit collateral to CoreVault
   */
  const depositCollateral = useCallback(async (
    amount: string
  ): Promise<OrderResult> => {
    if (!coreVaultContract || !mockUsdcContract || !walletData.address) {
      return { success: false, error: 'Wallet not connected or contracts not loaded' };
    }

    setIsLoading(true);
    setError(null);

    try {
      // Convert amount to proper units (USDC has 6 decimals)
      const amountWei = parseUnits(amount, 6);

      // Check USDC balance
      const balance = await mockUsdcContract.read.balanceOf([walletData.address as Address]);
      if (balance < amountWei) {
        return { success: false, error: `Insufficient USDC balance. You have ${formatUnits(balance, 6)} USDC` };
      }

      // Check allowance
      const allowance = await mockUsdcContract.read.allowance([
        walletData.address as Address,
        coreVaultContract.address as Address
      ]);

      // Approve if needed
      if (allowance < amountWei) {
        const approveTx = await mockUsdcContract.write.approve([
          coreVaultContract.address as Address,
          parseUnits('1000000', 6) // 1M USDC approval
        ]);
        
        // Wait for approval transaction
        await approveTx.wait();
      }

      // Deposit collateral
      const depositTx = await coreVaultContract.write.depositCollateral([amountWei]);
      await depositTx.wait();

      setLastTransaction(depositTx.hash);
      setIsLoading(false);
      
      return {
        success: true,
        transactionHash: depositTx.hash
      };
    } catch (err) {
      console.error('Error depositing collateral:', err);
      setError(err instanceof Error ? err : new Error('Failed to deposit collateral'));
      setIsLoading(false);
      
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }, [coreVaultContract, mockUsdcContract, walletData.address]);

  /**
   * Place a limit order
   */
  const placeLimitOrder = useCallback(async (
    params: OrderParams
  ): Promise<OrderResult> => {
    if (!orderBookContract || !walletData.address) {
      return { success: false, error: 'Wallet not connected or contract not loaded' };
    }

    if (!params.price) {
      return { success: false, error: 'Price is required for limit orders' };
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check if user has enough collateral
      const hasCollateral = await checkCollateral(params.size, params.price, params.isBuy);
      if (!hasCollateral) {
        return { success: false, error: 'Insufficient collateral for this order' };
      }

      // Convert parameters to contract format
      const priceWei = parseUnits(params.price, 6); // USDC has 6 decimals
      const sizeWei = parseUnits(params.size, 18); // Size in standard 18 decimals

      // Place limit order
      const tx = await orderBookContract.write.placeMarginLimitOrder([
        priceWei,
        sizeWei,
        params.isBuy
      ], getViemGasOverrides());
      console.log('[Order TX][limit] submitted:', tx.hash);
      const receipt = await tx.wait();
      console.log('[Order TX][limit] confirmed:', tx.hash);

      setLastTransaction(tx.hash);
      setIsLoading(false);
      
      return {
        success: true,
        transactionHash: tx.hash,
        orderId: tx.hash // Use transaction hash as order ID for now
      };
    } catch (err) {
      console.error('Error placing limit order:', err);
      setError(err instanceof Error ? err : new Error('Failed to place limit order'));
      setIsLoading(false);
      
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }, [orderBookContract, walletData.address, checkCollateral]);

  /**
   * Place a market order
   */
  const placeMarketOrder = useCallback(async (
    params: OrderParams
  ): Promise<OrderResult> => {
    if (!orderBookContract || !walletData.address) {
      return { success: false, error: 'Wallet not connected or contract not loaded' };
    }

    setIsLoading(true);
    setError(null);

    try {
      // For market orders, we need to estimate the price
      let estimatedPrice = '0';
      
      try {
        // Get best bid/ask for price estimation
        if (params.isBuy) {
          const bestAsk = await orderBookContract.read.bestAsk();
          estimatedPrice = formatUnits(bestAsk, 6);
        } else {
          const bestBid = await orderBookContract.read.bestBid();
          estimatedPrice = formatUnits(bestBid, 6);
        }
      } catch (err) {
        console.warn('Could not get best price for estimation:', err);
        // Use provided price as fallback or reject if none
        if (!params.price) {
          return { success: false, error: 'Could not estimate price and no price provided' };
        }
        estimatedPrice = params.price;
      }

      // Check if user has enough collateral
      const hasCollateral = await checkCollateral(params.size, estimatedPrice, params.isBuy);
      if (!hasCollateral) {
        return { success: false, error: 'Insufficient collateral for this order' };
      }

      // Convert size to contract format
      const sizeWei = parseUnits(params.size, 18); // Size in standard 18 decimals

      // Place market order
      const tx = await orderBookContract.write.placeMarginMarketOrder([
        sizeWei,
        params.isBuy
      ], getViemGasOverrides());
      console.log('[Order TX][market] submitted:', tx.hash);
      const receipt = await tx.wait();
      console.log('[Order TX][market] confirmed:', tx.hash);

      setLastTransaction(tx.hash);
      setIsLoading(false);
      
      return {
        success: true,
        transactionHash: tx.hash,
        orderId: tx.hash // Use transaction hash as order ID for now
      };
    } catch (err) {
      console.error('Error placing market order:', err);
      setError(err instanceof Error ? err : new Error('Failed to place market order'));
      setIsLoading(false);
      
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }, [orderBookContract, walletData.address, checkCollateral]);

  /**
   * Cancel an order
   */
  const cancelOrder = useCallback(async (
    orderId: string
  ): Promise<OrderResult> => {
    if (!orderBookContract || !walletData.address) {
      return { success: false, error: 'Wallet not connected or contract not loaded' };
    }

    setIsLoading(true);
    setError(null);

    try {
      // Cancel order
      const tx = await orderBookContract.write.cancelOrder([orderId as `0x${string}`], getViemGasOverrides());
      await tx.wait();

      setLastTransaction(tx.hash);
      setIsLoading(false);
      
      return {
        success: true,
        transactionHash: tx.hash
      };
    } catch (err) {
      console.error('Error cancelling order:', err);
      setError(err instanceof Error ? err : new Error('Failed to cancel order'));
      setIsLoading(false);
      
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }, [orderBookContract, walletData.address]);

  return {
    depositCollateral,
    placeLimitOrder,
    placeMarketOrder,
    cancelOrder,
    checkCollateral,
    isLoading,
    lastTransaction,
    error
  };
}

// Helper function for formatting units (should be imported from viem)
function formatUnits(value: bigint, decimals: number): string {
  return (Number(value) / 10 ** decimals).toString();
}
