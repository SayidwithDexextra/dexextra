'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import type { Address } from 'viem';
import { createClientWithRPC } from '@/lib/viemClient';
import { useWallet } from '@/hooks/useWallet';
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
  const wallet = useWallet() as any;
  const address = wallet?.walletData?.address || null;
  const isConnected = wallet?.walletData?.isConnected;
  const [contracts, setContracts] = useState<any>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [availableBalance, setAvailableBalance] = useState<string>('0');
  const [totalCollateralStr, setTotalCollateralStr] = useState<string>('0');
  const [healthy, setHealthy] = useState<boolean>(true);
  const [socializedLoss, setSocializedLoss] = useState<string>('0');
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Use provided wallet address or default to connected wallet
  const userAddress = walletAddress || address;
  
  // Contract addresses for the UI
  const vaultAddress = CONTRACT_ADDRESSES.CORE_VAULT;
  const mockUSDCAddress = CONTRACT_ADDRESSES.MOCK_USDC;

  // Initialize contracts when wallet is connected
  useEffect(() => {
    async function init() {
      try {
        console.log('Initializing contracts with RPC URL:', env.RPC_URL, 'Chain ID:', env.CHAIN_ID);
        console.log('Core contract addresses:', {
          CORE_VAULT: CONTRACT_ADDRESSES.CORE_VAULT,
          MOCK_USDC: CONTRACT_ADDRESSES.MOCK_USDC,
          LIQUIDATION_MANAGER: CONTRACT_ADDRESSES.LIQUIDATION_MANAGER
        });
        
        // Force using HTTP provider since it's more reliable
        const hlProvider = new ethers.JsonRpcProvider(env.RPC_URL || 'https://testnet-rpc.hyperliquid.xyz/v1');
        
        // Default to read-only provider
        let runner = hlProvider;
        let usingSigner = false;

        // Try to connect with wallet signer if available
        if (typeof window !== 'undefined' && (window as any).ethereum && isConnected) {
          try {
            console.log('Attempting to connect with wallet signer...');
            const browserProvider = new ethers.BrowserProvider((window as any).ethereum)
            const injectedSigner = await browserProvider.getSigner()
            const net = await browserProvider.getNetwork()
            const chainOk = Number(net.chainId) === env.CHAIN_ID
            if (!chainOk) {
              console.warn(`Wrong network: ${Number(net.chainId)}, expected: ${env.CHAIN_ID}`);
              setError(new Error(`Wrong network. Showing read-only data for chainId ${env.CHAIN_ID}.`))
            } else {
              runner = injectedSigner
              usingSigner = true;
              console.log('Successfully connected with wallet signer');
            }
          } catch (err) {
            console.warn('Failed to get wallet signer, falling back to read-only:', err);
            setError(new Error('Using read-only provider'))
          }
        } else if (env.PRIVATE_KEY) {
          try {
            console.log('Using private key signer');
            runner = new ethers.Wallet(env.PRIVATE_KEY, hlProvider);
            usingSigner = true;
          } catch (err) {
            console.warn('Failed to create private key wallet, falling back to read-only:', err);
          }
        }

        setIsLoading(true);
        console.log('Initializing contracts with', usingSigner ? 'signer' : 'read-only provider');
        
        const contractInstances = await initializeContracts({
          providerOrSigner: runner
        });
        
        // Verify if contracts were properly initialized
        if (!contractInstances) {
          throw new Error('Contract instances are null');
        }
        
        if (!contractInstances.mockUSDC || !contractInstances.vault) {
          throw new Error('Essential contracts missing from initialization');
        }
        
        // Add additional aliases for backward compatibility
        contractInstances.coreVault = contractInstances.vault;
        
        setContracts(contractInstances);
        setIsInitialized(true);
        console.log('Contracts initialized successfully');
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
  }, [isConnected]);

  // Lazy initializer to ensure contracts before a write action
  const ensureInitialized = useCallback(async (): Promise<any | null> => {
    if (isInitialized && contracts) return contracts;
    try {
      console.log('Ensuring contracts are initialized...');
      const hlProvider = new ethers.JsonRpcProvider(env.RPC_URL || 'https://testnet-rpc.hyperliquid.xyz/v1');
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
          return null
        }
        writeSigner = injectedSigner
      } else {
        setIsInitialized(false);
        setContracts(null);
        return null;
      }

      setIsLoading(true);
      const contractInstances = await initializeContracts({
        providerOrSigner: writeSigner || hlProvider
      });
      
      if (!contractInstances) {
        throw new Error('Contract instances are null');
      }
      
      if (!contractInstances.mockUSDC || !contractInstances.vault) {
        throw new Error('Essential contracts missing from initialization');
      }
      
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
  }, [isConnected]);

  // Fetch balances
  const fetchBalances = useCallback(async () => {
    if (!isInitialized || !contracts || !userAddress) {
      console.log('Skip fetching balances - conditions not met:', { isInitialized, hasContracts: !!contracts, hasAddress: !!userAddress });
      return;
    }

    try {
      setIsLoading(true);

      // Verify contract instances are valid
      if (!contracts.mockUSDC || !contracts.vault) {
        throw new Error('Invalid contract instances');
      }

      // Verify addresses exist
      let mockUsdcAddress;
      let vaultAddress;
      
      try {
        mockUsdcAddress = await contracts.mockUSDC.getAddress().catch(() => null);
        vaultAddress = await contracts.vault.getAddress().catch(() => null);
      } catch (e) {
        console.error('Error getting contract addresses:', e);
        mockUsdcAddress = CONTRACT_ADDRESSES.MOCK_USDC;
        vaultAddress = CONTRACT_ADDRESSES.CORE_VAULT;
      }
      
      if (!mockUsdcAddress || !vaultAddress) {
        throw new Error('Contract addresses are invalid');
      }
      
      console.log('Fetching balances for', { userAddress, mockUsdcAddress, vaultAddress });

      // Get USDC balance with error handling
      let usdcBalance;
      try {
        usdcBalance = await contracts.mockUSDC.balanceOf(userAddress);
      } catch (e) {
        console.error('Error fetching USDC balance:', e);
        usdcBalance = 0n;
      }
      
      // Get unified margin summary with error handling
      let marginSummary;
      try {
        marginSummary = await contracts.vault.getUnifiedMarginSummary(userAddress);
      } catch (e) {
        console.error('Error fetching margin summary:', e);
        marginSummary = [0n, 0n, 0n, 0n, 0n, 0n, 0n, true];
      }
      
      const [
        totalCollateral,
        marginUsed,
        marginReserved,
        availableCollateral,
        realizedPnL,
        unrealizedPnL,
        _totalCommitted,
        isHealthy
      ] = marginSummary;

      // Format the available balance for the UI
      setAvailableBalance(formatTokenAmount(availableCollateral));
      setTotalCollateralStr(formatTokenAmount(totalCollateral));
      setHealthy(Boolean(isHealthy));
      
      // Calculate realized PnL using 18 decimals (standard P&L scale)
      let realizedPnLStr = '0';
      try {
        const realizedPnLBig = BigInt(realizedPnL.toString());
        realizedPnLStr = ethers.formatUnits(realizedPnLBig, 18);
      } catch {}

      // Prefer real-time unrealized PnL using current mark price; fallback to summary (24d)
      let unrealizedPnLStr = '0';
      try {
        // Fetch open positions (defensive: ensure contract code exists to avoid CALL_EXCEPTION)
        let totalUnrealized24 = 0n;
        let positions: any[] = [];
        try {
          const provider: any = (contracts.vault as any)?.runner?.provider || (contracts.vault as any)?.provider;
          const vaultAddr = await (contracts.vault as any).getAddress();
          const code = provider && vaultAddr ? await provider.getCode(vaultAddr) : '0x';
          if (!code || code === '0x') {
            throw new Error('Vault contract code not found on current network');
          }
          positions = await contracts.vault.getUserPositions(userAddress);
        } catch (_e: any) {
          // If function is missing or call reverts without data, fall back gracefully
          const msg = _e?.message || '';
          const code = _e?.code || '';
          const isMissingSelector = msg.includes('missing revert data') || code === 'CALL_EXCEPTION';
          if (!isMissingSelector) {
            // Re-throw non-selector issues to be handled by outer catch
            throw _e;
          }
          positions = [];
        }

        // Get current mark price from OrderBook (single-market setup)
        // Returns (markPrice, indexPrice, fundingRate)
        const mpData = await contracts.obPricing.getMarketPriceData();
        // Support both array and named return values
        const markPrice6 = BigInt((mpData?.markPrice ?? mpData?.[0] ?? 0).toString());

        for (const pos of positions) {
          try {
            const size18 = BigInt(pos.size.toString());
            const entry6 = BigInt(pos.entryPrice.toString());
            // PnL in 24 decimals: (mark - entry) * size
            const pnl24 = (markPrice6 - entry6) * size18;
            totalUnrealized24 += pnl24;
          } catch {}
        }

        unrealizedPnLStr = ethers.formatUnits(totalUnrealized24, 24);
      } catch {
        try {
          const unrealizedPnLBig = BigInt(unrealizedPnL.toString());
          // Fallback path uses contract summary which returns 18d P&L
          unrealizedPnLStr = ethers.formatUnits(unrealizedPnLBig, 18);
        } catch {}
      }

      // Fetch user socialized loss (haircut)
      let socializedLossStr = '0';
      try {
        const haircut = await contracts.vault.userSocializedLoss(userAddress);
        socializedLossStr = formatTokenAmount(BigInt(haircut.toString()));
      } catch {}
      setSocializedLoss(socializedLossStr);

      // Store margin values aligned to Interactive Trader formatting
      setMarginValues({
        marginUsed: formatTokenAmount(marginUsed), // 6 decimals
        marginReserved: formatTokenAmount(marginReserved), // 6 decimals
        realizedPnL: realizedPnLStr, // 24 -> decimal string
        unrealizedPnL: unrealizedPnLStr // 24 -> decimal string (real-time preferred)
      });
      
      setIsLoading(false);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch balances:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch balances'));
      setIsLoading(false);
    }
  }, [isInitialized, contracts, userAddress]);

  // Debounced refresher to avoid event storms
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current && clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
      fetchBalances();
    }, 300);
  }, [fetchBalances]);

  // Fetch balances when initialized or address changes
  useEffect(() => {
    if (isInitialized && userAddress) {
      fetchBalances();
    }
  }, [isInitialized, userAddress, fetchBalances]);

  // Remove on-chain event watching to reduce RPC load; rely on timed polling
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [isInitialized, contracts, userAddress, scheduleRefresh]);

  // Block-based polling fallback (lightweight) to guarantee UI freshness
  useEffect(() => {
    if (!isInitialized || !contracts || !userAddress) return;
    if (pollingIntervalRef.current) return;

    // Poll every 15s
    pollingIntervalRef.current = setInterval(() => {
      scheduleRefresh();
    }, 15000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [isInitialized, contracts, userAddress, scheduleRefresh]);

  // Deposit collateral - returns transaction hash for compatibility with DepositModal
  const depositCollateral = useCallback(async (amount: string): Promise<string> => {
    const currentContracts = contracts || (await ensureInitialized());
    if (!currentContracts) throw new Error('Contracts not initialized or wallet not connected');
    if (!userAddress) throw new Error('Wallet address not available');

    try {
      // Parse amount to BigInt with 6 decimals (USDC standard)
      const amountWei = parseTokenAmount(amount);
      
      // Get vault address
      let vaultAddress;
      try {
        vaultAddress = await currentContracts.vault.getAddress();
      } catch (e) {
        console.error('Error getting vault address:', e);
        vaultAddress = CONTRACT_ADDRESSES.CORE_VAULT;
      }
      
      if (!vaultAddress) throw new Error('Vault address not found');
      
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
    socializedLoss,
    depositCollateral,
    withdrawCollateral,
    vaultAddress,
    mockUSDCAddress,
    fetchBalances,
    refresh: scheduleRefresh // Add a refresh function for external components
  };
}