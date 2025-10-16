'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
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
        const hlProvider = new ethers.JsonRpcProvider(env.RPC_URL, env.CHAIN_ID);
        let runner: ethers.Signer | ethers.AbstractProvider = hlProvider;

        if (env.PRIVATE_KEY) {
          runner = new ethers.Wallet(env.PRIVATE_KEY, hlProvider);
        } else if (typeof window !== 'undefined' && (window as any).ethereum) {
          try {
            const browserProvider = new ethers.BrowserProvider((window as any).ethereum)
            const injectedSigner = await browserProvider.getSigner()
            const net = await browserProvider.getNetwork()
            const chainOk = Number(net.chainId) === env.CHAIN_ID
            if (!chainOk) {
              setError(new Error(`Wrong network. Showing read-only data for chainId ${env.CHAIN_ID}.`))
            } else {
              runner = injectedSigner
            }
          } catch {
            setError(new Error('Using read-only provider'))
          }
        }

        setIsLoading(true);
        const contractInstances = await initializeContracts(runner);
        setContracts(contractInstances);
        setIsInitialized(true);
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
      const contractInstances = await initializeContracts(writeSigner || hlProvider);
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
      
      // Calculate realized PnL using 24 decimals (price 6d * size 18d)
      let realizedPnLStr = '0';
      try {
        const realizedPnLBig = BigInt(realizedPnL.toString());
        realizedPnLStr = ethers.formatUnits(realizedPnLBig, 24);
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
          unrealizedPnLStr = ethers.formatUnits(unrealizedPnLBig, 24);
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

  // Set up event listeners for contract events to refresh data
  useEffect(() => {
    if (!isInitialized || !contracts || !userAddress) return;

    const vault = contracts.vault;
    const handleDeposit = (user: string, amount: bigint) => {
      if (user.toLowerCase() === userAddress.toLowerCase()) {
        console.log('Deposit event detected, refreshing balances');
        scheduleRefresh();
      }
    };

    const handleWithdraw = (user: string, amount: bigint) => {
      if (user.toLowerCase() === userAddress.toLowerCase()) {
        console.log('Withdraw event detected, refreshing balances');
        scheduleRefresh();
      }
    };

    const handlePositionUpdate = (user: string, marketId: string, oldSize: bigint, newSize: bigint, entryPrice: bigint, marginLocked: bigint) => {
      if (user.toLowerCase() === userAddress.toLowerCase()) {
        console.log('Position update event detected, refreshing balances');
        scheduleRefresh();
      }
    };

    const handleMarginLocked = (user: string) => {
      if (user.toLowerCase() === userAddress.toLowerCase()) {
        console.log('MarginLocked event detected, refreshing balances');
        scheduleRefresh();
      }
    };

    const handleMarginReleased = (user: string) => {
      if (user.toLowerCase() === userAddress.toLowerCase()) {
        console.log('MarginReleased event detected, refreshing balances');
        scheduleRefresh();
      }
    };

    const handleMarginReserved = (user: string) => {
      if (user.toLowerCase() === userAddress.toLowerCase()) {
        console.log('MarginReserved event detected, refreshing balances');
        scheduleRefresh();
      }
    };

    const handleMarginUnreserved = (user: string) => {
      if (user.toLowerCase() === userAddress.toLowerCase()) {
        console.log('MarginUnreserved event detected, refreshing balances');
        scheduleRefresh();
      }
    };

    const handleLiquidationExecuted = (user: string) => {
      if (user.toLowerCase() === userAddress.toLowerCase()) {
        console.log('LiquidationExecuted event detected, refreshing balances');
        scheduleRefresh();
      }
    };

    const handleAvailableCollateralConfiscated = (user: string) => {
      if (user.toLowerCase() === userAddress.toLowerCase()) {
        console.log('AvailableCollateralConfiscated event detected, refreshing balances');
        scheduleRefresh();
      }
    };

    const handleUserLossSocialized = (user: string) => {
      if (user.toLowerCase() === userAddress.toLowerCase()) {
        console.log('UserLossSocialized event detected, refreshing balances');
        scheduleRefresh();
      }
    };

    const handleHaircutApplied = (user: string) => {
      if (user.toLowerCase() === userAddress.toLowerCase()) {
        console.log('HaircutApplied event detected, refreshing balances');
        scheduleRefresh();
      }
    };

    // Assuming events like 'DepositCollateral', 'WithdrawCollateral', 'PositionUpdated' exist in your contract
    vault.on('CollateralDeposited', handleDeposit);
    vault.on('CollateralWithdrawn', handleWithdraw);
    vault.on('PositionUpdated', handlePositionUpdate);
    vault.on('MarginLocked', handleMarginLocked);
    vault.on('MarginReleased', handleMarginReleased);
    vault.on('MarginReserved', handleMarginReserved);
    vault.on('MarginUnreserved', handleMarginUnreserved);
    vault.on('LiquidationExecuted', handleLiquidationExecuted);
    vault.on('AvailableCollateralConfiscated', handleAvailableCollateralConfiscated);
    vault.on('UserLossSocialized', handleUserLossSocialized);
    vault.on('HaircutApplied', handleHaircutApplied);

    // USDC balance changes outside the vault (transfers)
    const usdc = contracts.mockUSDC;
    const handleUsdcTransfer = (from: string, to: string) => {
      const fromMatch = from && from.toLowerCase() === userAddress.toLowerCase();
      const toMatch = to && to.toLowerCase() === userAddress.toLowerCase();
      if (fromMatch || toMatch) {
        console.log('USDC Transfer involving user detected, refreshing balances');
        scheduleRefresh();
      }
    };
    usdc.on('Transfer', handleUsdcTransfer);

    return () => {
      vault.off('CollateralDeposited', handleDeposit);
      vault.off('CollateralWithdrawn', handleWithdraw);
      vault.off('PositionUpdated', handlePositionUpdate);
      vault.off('MarginLocked', handleMarginLocked);
      vault.off('MarginReleased', handleMarginReleased);
      vault.off('MarginReserved', handleMarginReserved);
      vault.off('MarginUnreserved', handleMarginUnreserved);
      vault.off('LiquidationExecuted', handleLiquidationExecuted);
      vault.off('AvailableCollateralConfiscated', handleAvailableCollateralConfiscated);
      vault.off('UserLossSocialized', handleUserLossSocialized);
      vault.off('HaircutApplied', handleHaircutApplied);
      contracts.mockUSDC.off('Transfer', handleUsdcTransfer);
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
    socializedLoss,
    depositCollateral,
    withdrawCollateral,
    vaultAddress,
    mockUSDCAddress,
    fetchBalances
  };
}