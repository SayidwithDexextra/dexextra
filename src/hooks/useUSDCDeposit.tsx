'use client';

import { useState, useCallback } from 'react';
import { parseUnits, formatUnits, Address } from 'viem';
import { useWallet } from './useWallet';
import { useMockUSDC, useCoreVault } from './useContract';

export interface DepositResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

/**
 * Hook for USDC deposit operations
 * This hook provides functionality to:
 * 1. Get USDC balance
 * 2. Request USDC from faucet
 * 3. Deposit USDC to CoreVault
 */
export function useUSDCDeposit() {
  const [isLoading, setIsLoading] = useState(false);
  const [lastTransaction, setLastTransaction] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  
  // Get wallet and contracts
  const { walletData } = useWallet();
  const { contract: mockUsdcContract, address: mockUsdcAddress } = useMockUSDC();
  const { contract: coreVaultContract, address: coreVaultAddress } = useCoreVault();

  /**
   * Get USDC balance for current wallet
   */
  const getUSDCBalance = useCallback(async (): Promise<string> => {
    if (!mockUsdcContract || !walletData.address) return '0';

    try {
      const balance = await mockUsdcContract.read.balanceOf([walletData.address as Address]);
      return formatUnits(balance, 6); // USDC has 6 decimals
    } catch (err) {
      console.error('Error getting USDC balance:', err);
      return '0';
    }
  }, [mockUsdcContract, walletData.address]);

  /**
   * Get vault collateral balance for current wallet
   */
  const getVaultBalance = useCallback(async (): Promise<string> => {
    if (!coreVaultContract || !walletData.address) return '0';

    try {
      const balance = await coreVaultContract.read.userCollateral([walletData.address as Address]);
      return formatUnits(balance, 6); // USDC has 6 decimals
    } catch (err) {
      console.error('Error getting vault balance:', err);
      return '0';
    }
  }, [coreVaultContract, walletData.address]);

  /**
   * Request USDC from faucet
   * @param amount Amount of USDC to request (in USDC units)
   */
  const requestFromFaucet = useCallback(async (amount: string): Promise<DepositResult> => {
    if (!mockUsdcContract || !walletData.address) {
      return { success: false, error: 'Wallet not connected or contract not loaded' };
    }

    setIsLoading(true);
    setError(null);

    try {
      // Convert amount to proper units (USDC has 6 decimals)
      const amountWei = parseUnits(amount, 6);

      // Call faucet function
      const tx = await mockUsdcContract.write.faucet([amountWei]);
      await tx.wait();

      setLastTransaction(tx.hash);
      setIsLoading(false);
      
      return {
        success: true,
        transactionHash: tx.hash
      };
    } catch (err) {
      console.error('Error requesting from faucet:', err);
      setError(err instanceof Error ? err : new Error('Failed to request from faucet'));
      setIsLoading(false);
      
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }, [mockUsdcContract, walletData.address]);

  /**
   * Deposit USDC to CoreVault
   * @param amount Amount of USDC to deposit (in USDC units)
   */
  const depositToVault = useCallback(async (amount: string): Promise<DepositResult> => {
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
        return { 
          success: false, 
          error: `Insufficient USDC balance. You have ${formatUnits(balance, 6)} USDC but need ${amount} USDC` 
        };
      }

      // Check allowance
      const allowance = await mockUsdcContract.read.allowance([
        walletData.address as Address,
        coreVaultContract.address as Address
      ]);

      // Approve if needed
      if (allowance < amountWei) {
        console.log('Approving USDC spend...');
        const approveTx = await mockUsdcContract.write.approve([
          coreVaultContract.address as Address,
          parseUnits('1000000', 6) // 1M USDC approval for convenience
        ]);
        
        // Wait for approval transaction
        await approveTx.wait();
        console.log('USDC approved successfully!');
      }

      // Deposit collateral
      console.log('Depositing to vault...');
      const depositTx = await coreVaultContract.write.depositCollateral([amountWei]);
      await depositTx.wait();
      console.log('Deposit successful!');

      setLastTransaction(depositTx.hash);
      setIsLoading(false);
      
      return {
        success: true,
        transactionHash: depositTx.hash
      };
    } catch (err) {
      console.error('Error depositing to vault:', err);
      setError(err instanceof Error ? err : new Error('Failed to deposit to vault'));
      setIsLoading(false);
      
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }, [coreVaultContract, mockUsdcContract, walletData.address]);

  return {
    // State
    isLoading,
    lastTransaction,
    error,
    
    // Contract addresses
    mockUsdcAddress,
    coreVaultAddress,
    
    // Functions
    getUSDCBalance,
    getVaultBalance,
    requestFromFaucet,
    depositToVault,
  };
}
