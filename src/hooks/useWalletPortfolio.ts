'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from './useWallet';
import { CONTRACTS } from '@/lib/contracts';
import { env } from '@/lib/env';
import { getReadProvider } from '@/lib/network';

export interface Token {
  name: string;
  symbol: string;
  amount: string;
  value: string;
  contractAddress?: string;
  decimals: number;
  isLowBalance: boolean;
}

export interface PortfolioSummary {
  totalValue: string;
  totalBalance: string;
}

export interface UseWalletPortfolioResult {
  tokens: Token[];
  summary: PortfolioSummary;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useWalletPortfolio(walletAddress: string | null): UseWalletPortfolioResult {
  // Provider no longer exposed on context; use unified read provider for reads
  const [tokens, setTokens] = useState<Token[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary>({
    totalValue: '0.00',
    totalBalance: '0'
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchPortfolio = useCallback(async () => {
    if (!walletAddress) {
      setTokens([]);
      setSummary({ totalValue: '0.00', totalBalance: '0' });
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Always use unified Hyperliquid provider for reads
      const hlProvider = getReadProvider();

      // Create MockUSDC contract instance (address from hyperliquid deployment)
      const mockUSDC = new ethers.Contract(
        CONTRACTS.MockUSDC.address,
        CONTRACTS.MockUSDC.abi,
        hlProvider
      );

      // Get USDC balance
      const balance = await mockUSDC.balanceOf(walletAddress);
      const decimals = await mockUSDC.decimals();
      
      // Format balance
      const formattedBalance = ethers.formatUnits(balance, decimals);
      const numericBalance = parseFloat(formattedBalance);
      
      // Create token object
      const mockUSDCToken: Token = {
        name: 'HyperLiquid Mock USDC',
        symbol: 'MOCK_USDC',
        amount: `${formattedBalance} MOCK_USDC`,
        value: `$${numericBalance.toFixed(2)}`,
        contractAddress: CONTRACTS.MockUSDC.address,
        decimals: decimals,
        isLowBalance: numericBalance < 10 // Consider low if less than $10
      };

      // Update state
      setTokens([mockUSDCToken]);
      setSummary({
        totalValue: numericBalance.toFixed(2),
        totalBalance: formattedBalance
      });
      
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to fetch portfolio:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch portfolio'));
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  return {
    tokens,
    summary,
    isLoading,
    error,
    refetch: fetchPortfolio
  };
}

export default useWalletPortfolio;
