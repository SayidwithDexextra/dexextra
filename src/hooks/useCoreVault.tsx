'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet, UseWalletResult } from '@/hooks/useWallet';
import { initializeContracts, formatTokenAmount, parseTokenAmount } from '@/lib/contracts';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import { env } from '@/lib/env';

export interface VaultBalances {
  usdcBalance: string;
  collateralDeposited: string;
  availableCollateral: string;
  marginUsed: string;
  marginReserved: string;
  realizedPnL: string;
  unrealizedPnL: string;
  isHealthy: boolean;
  isLoading: boolean;
  error: Error | null;
}

export function useCoreVault(walletAddress?: string) {
  const { walletData } = useWallet();
  const [contracts, setContracts] = useState<any>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [availableBalance, setAvailableBalance] = useState<string>('0');
  const [totalCollateralStr, setTotalCollateralStr] = useState<string>('0');
  const [healthy, setHealthy] = useState<boolean>(true);
  
  // Use provided wallet address or default to connected wallet
  const userAddress = walletAddress || walletData.address;
  
  // Contract addresses for the UI
  const vaultAddress = CONTRACT_ADDRESSES.CORE_VAULT;
  const mockUSDCAddress = CONTRACT_ADDRESSES.MOCK_USDC;

  // Initialize contracts when wallet is connected
  useEffect(() => {
    async function init() {
      try {
        // Always prepare Hyperliquid provider for writes
        const hlProvider = new ethers.JsonRpcProvider(env.RPC_URL, env.CHAIN_ID);

        // Determine signer: prefer env.PRIVATE_KEY, else injected signer on correct network
        let writeSigner: ethers.Signer | null = null;

        if (env.PRIVATE_KEY) {
          writeSigner = new ethers.Wallet(env.PRIVATE_KEY, hlProvider);
        } else if (typeof window !== 'undefined' && (window as any).ethereum) {
          // Use injected wallet directly if available (supports useWalletAddress flow)
          const browserProvider = new ethers.BrowserProvider((window as any).ethereum)
          const injectedSigner = await browserProvider.getSigner()
          const net = await browserProvider.getNetwork()
          const chainOk = Number(net.chainId) === env.CHAIN_ID
          if (!chainOk) {
            setIsInitialized(false)
            setContracts(null)
            setError(new Error(`Wrong network. Please switch to chainId ${env.CHAIN_ID}.`))
            return
          }
          writeSigner = injectedSigner
        } else if (isConnected && signer && provider) {
          try {
            const net = await provider.getNetwork();
            const chainOk = Number(net.chainId) === env.CHAIN_ID;
            if (!chainOk) {
              setIsInitialized(false);
              setContracts(null);
              setError(new Error(`Wrong network. Please switch to chainId ${env.CHAIN_ID}.`));
              return;
            }
            writeSigner = signer;
          } catch (e) {
            setIsInitialized(false);
            setContracts(null);
            setError(new Error('Unable to verify wallet network'));
            return;
          }
        } else {
          setIsInitialized(false);
          setContracts(null);
          return;
        }

        setIsLoading(true);
        const contractInstances = await initializeContracts(writeSigner);
        setContracts(contractInstances);
        setIsInitialized(true);
        setError(null);
      } catch (err) {
        console.error('Failed to initialize contracts:', err);
        setError(err instanceof Error ? err : new Error('Failed to initialize contracts'));
        setIsInitialized(false);
        setContracts(null);
      } finally {
        setIsLoading(false);
      }
    }

    init();
  }, [walletData.isConnected]);

  // Lazy initializer to ensure contracts before a write action
  const ensureInitialized = useCallback(async (): Promise<any | null> => {
    if (isInitialized && contracts) return contracts;
    try {
      const hlProvider = new ethers.JsonRpcProvider(env.RPC_URL, env.CHAIN_ID);
      let writeSigner: ethers.Signer | null = null;

      if (env.PRIVATE_KEY) {
        writeSigner = new ethers.Wallet(env.PRIVATE_KEY, hlProvider);
      } else if (typeof window !== 'undefined' && (window as any).ethereum) {
        const browserProvider = new ethers.BrowserProvider((window as any).ethereum)
        const injectedSigner = await browserProvider.getSigner()
        const net = await browserProvider.getNetwork()
        const chainOk = Number(net.chainId) === env.CHAIN_ID
        if (!chainOk) {
          setIsInitialized(false)
          setContracts(null)
          setError(new Error(`Wrong network. Please switch to chainId ${env.CHAIN_ID}.`))
          return false
        }
        writeSigner = injectedSigner
      } else {
        setIsInitialized(false);
        setContracts(null);
        return false;
      }

      setIsLoading(true);
      const contractInstances = await initializeContracts(writeSigner);
      setContracts(contractInstances);
      setIsInitialized(true);
      setError(null);
      return contractInstances;
    } catch (err) {
      console.error('ensureInitialized failed:', err);
      setError(err instanceof Error ? err : new Error('Failed to initialize contracts'));
      setIsInitialized(false);
      setContracts(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [walletData.isConnected]);

  // Fetch balances
  const fetchBalances = useCallback(async () => {
    if (!isInitialized || !contracts || !userAddress) return;

    try {
      setIsLoading(true);

      // Get USDC balance
      const usdcBalance = await contracts.mockUSDC.balanceOf(userAddress);
      
      // Get unified margin summary
      const [
        totalCollateral,
        marginUsed,
        marginReserved,
        availableCollateral,
        realizedPnL,
        unrealizedPnL,
        _totalCommitted,
        isHealthy
      ] = await contracts.vault.getUnifiedMarginSummary(userAddress);

      // Format the available balance for the UI
      setAvailableBalance(formatTokenAmount(availableCollateral));
      setTotalCollateralStr(formatTokenAmount(totalCollateral));
      setHealthy(Boolean(isHealthy));
      
      // Store margin values
      setMarginValues({
        marginUsed: formatTokenAmount(marginUsed),
        marginReserved: formatTokenAmount(marginReserved),
        realizedPnL: formatTokenAmount(realizedPnL),
        unrealizedPnL: formatTokenAmount(unrealizedPnL)
      });
      
      setIsLoading(false);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch balances:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch balances'));
      setIsLoading(false);
    }
  }, [isInitialized, contracts, userAddress]);

  // Fetch balances when initialized or address changes
  useEffect(() => {
    if (isInitialized && userAddress) {
      fetchBalances();
    }
  }, [isInitialized, userAddress, fetchBalances]);

  // Deposit collateral - returns transaction hash for compatibility with DepositModal
  const depositCollateral = useCallback(async (amount: string): Promise<string> => {
    const currentContracts = contracts || (await ensureInitialized());
    if (!currentContracts) throw new Error('Contracts not initialized or wallet not connected');
    if (!userAddress) throw new Error('Wallet address not available');

    try {
      // Parse amount to BigInt with 6 decimals (USDC standard)
      const amountWei = parseTokenAmount(amount);
      
      // Get vault address
      const vaultAddress = CONTRACT_ADDRESSES.CORE_VAULT;
      
      // Approve USDC transfer
      console.log(`Approving ${amount} USDC for vault...`);
      const approveTx = await currentContracts.mockUSDC.approve(vaultAddress, amountWei);
      await approveTx.wait();
      
      // Deposit collateral
      console.log(`Depositing ${amount} USDC to vault...`);
      const depositTx = await currentContracts.vault.depositCollateral(amountWei);
      const receipt = await depositTx.wait();
      
      // Refresh balances
      fetchBalances();
      
      return depositTx.hash;
    } catch (err) {
      console.error('Deposit failed:', err);
      throw err;
    }
  }, [contracts, userAddress, fetchBalances, ensureInitialized]);

  // Withdraw collateral
  const withdrawCollateral = useCallback(async (amount: string): Promise<string> => {
    const currentContracts = contracts || (await ensureInitialized());
    if (!currentContracts) throw new Error('Contracts not initialized or wallet not connected');
    if (!userAddress) throw new Error('Wallet address not available');

    try {
      // Parse amount to BigInt with 6 decimals (USDC standard)
      const amountWei = parseTokenAmount(amount);
      
      // Withdraw collateral
      console.log(`Withdrawing ${amount} USDC from vault...`);
      const withdrawTx = await currentContracts.vault.withdrawCollateral(amountWei);
      const receipt = await withdrawTx.wait();
      
      // Refresh balances
      fetchBalances();
      
      return withdrawTx.hash;
    } catch (err) {
      console.error('Withdrawal failed:', err);
      throw err;
    }
  }, [contracts, userAddress, fetchBalances, ensureInitialized]);

  // State for margin values
  const [marginValues, setMarginValues] = useState({
    marginUsed: '0',
    marginReserved: '0',
    realizedPnL: '0',
    unrealizedPnL: '0'
  });

  return {
    isConnected: isInitialized,
    isLoading,
    error,
    availableBalance,
    totalCollateral: totalCollateralStr,
    isHealthy: healthy,
    ...marginValues, // Expose margin values
    depositCollateral,
    withdrawCollateral,
    vaultAddress,
    mockUSDCAddress,
    fetchBalances
  };
}