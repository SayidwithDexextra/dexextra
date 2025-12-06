'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import type { Address } from 'viem';
import { createClientWithRPC } from '@/lib/viemClient';
import { useWallet } from '@/hooks/useWallet';
import { initializeContracts, formatTokenAmount, parseTokenAmount } from '@/lib/contracts';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import { env } from '@/lib/env';
import { getReadProvider, getRunner, getChainId, getWsProvider, getSnapshotBlockNumber } from '@/lib/network';

// Module-level singletons to avoid duplicate watchers across multiple hook instances
let coreVaultWatchersAttached = false;
let coreVaultLastEventTs = 0;
const ENABLE_VAULT_POLLING = false;

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
  const initStartedRef = useRef<boolean>(false);
  
  // Use provided wallet address or default to connected wallet
  const userAddress = walletAddress || address;
  
  // Contract addresses for the UI
  const vaultAddress = CONTRACT_ADDRESSES.CORE_VAULT;
  const mockUSDCAddress = CONTRACT_ADDRESSES.MOCK_USDC;
  
  // Log the CoreVault address to verify it's coming from environment variables
  console.log('CoreVault address from environment:', vaultAddress, '(source: .env.local)');

  // Initialize contracts when wallet is connected
  useEffect(() => {
    async function init() {
      try {
        if (isInitialized || contracts || initStartedRef.current) return;
        initStartedRef.current = true;
        console.log('Initializing contracts with RPC URL:', env.RPC_URL, 'Chain ID:', env.CHAIN_ID);
        console.log('Core contract addresses:', {
          CORE_VAULT: CONTRACT_ADDRESSES.CORE_VAULT,
          MOCK_USDC: CONTRACT_ADDRESSES.MOCK_USDC,
          LIQUIDATION_MANAGER: CONTRACT_ADDRESSES.LIQUIDATION_MANAGER
        });
        
        // Unified read-only provider
        const hlProvider = getReadProvider();
        
        // Default to read-only provider
        let runner: ethers.Signer | ethers.Provider = hlProvider;
        let usingSigner = false;

        // Try to connect with wallet signer if available
        if (typeof window !== 'undefined' && (window as any).ethereum && isConnected) {
          try {
            console.log('Attempting to connect with wallet signer...');
            const browserProvider = new ethers.BrowserProvider((window as any).ethereum)
            const injectedSigner = await browserProvider.getSigner()
            const net = await browserProvider.getNetwork()
            const chainOk = Number(net.chainId) === getChainId()
            if (!chainOk) {
              console.warn(`Wrong network: ${Number(net.chainId)}, expected: ${getChainId()}`);
              setError(new Error(`Wrong network. Showing read-only data for chainId ${getChainId()}.`))
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
        initStartedRef.current = false;
      }
    }

    init();
  }, [isConnected, isInitialized, contracts]);

  // Ensure we have signer-bound contracts for write operations
  const getWriteContracts = useCallback(async (): Promise<any> => {
    // Reuse existing signer-bound instances if available
    try {
      const runner: any = (contracts as any)?.vault?.runner;
      const hasSend = runner && typeof runner.sendTransaction === 'function';
      if (contracts && hasSend) return contracts;
    } catch {}

    const hlProvider = getReadProvider();
    let writeSigner: ethers.Signer | null = null;

    // Prefer injected wallet on correct chain
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const browserProvider = new ethers.BrowserProvider((window as any).ethereum)
        const net = await browserProvider.getNetwork()
        const chainOk = Number(net.chainId) === getChainId()
        if (!chainOk) {
          throw new Error(`Wrong network. Please switch to chainId ${getChainId()}.`)
        }
        writeSigner = await browserProvider.getSigner()
      } catch {}
    }

    // Fallback to PRIVATE_KEY if configured
    if (!writeSigner && env.PRIVATE_KEY) {
      try {
        writeSigner = new ethers.Wallet(env.PRIVATE_KEY, hlProvider)
      } catch {}
    }

    if (!writeSigner) {
      throw new Error('Wallet not connected. Please connect your wallet to perform this action.')
    }

    setIsLoading(true);
    try {
      const contractInstances = await initializeContracts({ providerOrSigner: writeSigner })
      if (!contractInstances?.mockUSDC || !contractInstances?.vault) {
        throw new Error('Essential contracts missing from initialization')
      }
      // Alias retained for compatibility
      (contractInstances as any).coreVault = contractInstances.vault;
      setContracts(contractInstances)
      setIsInitialized(true)
      setError(null)
      return contractInstances
    } catch (err) {
      setIsInitialized(false)
      setContracts(null)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [contracts])

  // Lazy initializer to ensure contracts before a write action
  const ensureInitialized = useCallback(async (): Promise<any | null> => {
    if (isInitialized && contracts) return contracts;
    try {
      console.log('Ensuring contracts are initialized...');
      const hlProvider = getReadProvider();
      let writeSigner: ethers.Signer | null = null;

      if (env.PRIVATE_KEY) {
        writeSigner = new ethers.Wallet(env.PRIVATE_KEY, hlProvider);
      } else if (typeof window !== 'undefined' && (window as any).ethereum) {
        const browserProvider = new ethers.BrowserProvider((window as any).ethereum)
        const injectedSigner = await browserProvider.getSigner()
        const net = await browserProvider.getNetwork()
        const chainOk = Number(net.chainId) === getChainId()
        if (!chainOk) {
          setIsInitialized(false)
          setContracts(null)
          setError(new Error(`Wrong network. Please switch to chainId ${getChainId()}.`))
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
  const isFetchingRef = useRef<boolean>(false);
  const backoffRef = useRef<number>(15000);
  const lastSuccessRef = useRef<number>(0);

  const fetchBalances = useCallback(async () => {
    // Visibility and in-flight guards
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (isFetchingRef.current) return;
    if (!isInitialized || !contracts || !userAddress) return;

    isFetchingRef.current = true;

    try {
      setIsLoading(true);
      // Use a consistent snapshot across all reads to avoid cross-block drift
      const snapshotBlock = await getSnapshotBlockNumber(false);
      try { console.log(`[AVBAL] Using snapshot block ${snapshotBlock}`); } catch {}

      // Verify contract instances are valid
      if (!contracts.mockUSDC || !contracts.vault) {
        throw new Error('Invalid contract instances');
      }

      // Use configured addresses to avoid re-resolving on every refresh
      const mockUsdcAddress = CONTRACT_ADDRESSES.MOCK_USDC;
      const vaultAddress = CONTRACT_ADDRESSES.CORE_VAULT;

      // Simple retry helper to avoid transient RPC inconsistencies
      const withRetry = async <T,>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 250): Promise<T> => {
        let lastErr: any = null;
        for (let i = 0; i < attempts; i++) {
          try { return await fn(); } catch (e) { lastErr = e; }
          const jitter = Math.floor(Math.random() * 100);
          await new Promise(res => setTimeout(res, baseDelayMs + jitter));
        }
        throw lastErr || new Error('RPC failed');
      };

      // Batch reads: balance, margin summary, socialized loss via Promise.all (socialized loss optional)
      const avbalStart = Date.now();
      try {
        console.log(`[AVBAL] Requesting vault summary (totalCollateral, availableCollateral) for ${userAddress.slice(0, 6)}...`);
      } catch {}
      const hasUserSocializedLoss = typeof (contracts.vault as any)?.userSocializedLoss === 'function';
      type MarginSummary = [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];
      const [usdcBalance, marginSummary, socializedLossRaw] = await Promise.all([
        withRetry<bigint>(() => contracts.mockUSDC.balanceOf(userAddress, { blockTag: snapshotBlock })),
        withRetry<MarginSummary>(() => contracts.vault.getUnifiedMarginSummary(userAddress, { blockTag: snapshotBlock })),
        hasUserSocializedLoss
          ? withRetry<bigint>(() => (contracts.vault as any).userSocializedLoss(userAddress, { blockTag: snapshotBlock }))
          : Promise.resolve(0n as bigint),
      ]);
      
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
      try {
        const duration = Date.now() - avbalStart;
        console.log(`[AVBAL] Received vault summary in ${duration}ms`, {
          totalCollateral: formatTokenAmount(totalCollateral),
          availableCollateral: formatTokenAmount(availableCollateral),
          isHealthy: Boolean(isHealthy)
        });
      } catch {}
      
      // Calculate realized PnL using 18 decimals (standard P&L scale)
      let realizedPnLStr = '0';
      try {
        const realizedPnLBig = BigInt(realizedPnL.toString());
        realizedPnLStr = ethers.formatUnits(realizedPnLBig, 18);
      } catch {}

      // Use unified summary PnL by default; do not recompute by fetching positions+prices each cycle
      // If we receive external price updates, we can trigger a targeted recompute elsewhere.
      let unrealizedPnLStr = '0';
      try {
        const unrealizedPnLBig = BigInt(unrealizedPnL.toString());
        unrealizedPnLStr = ethers.formatUnits(unrealizedPnLBig, 18);
      } catch {}

      // Fetch user socialized loss (haircut)
      const socializedLossStr = formatTokenAmount(BigInt(socializedLossRaw.toString()));
      setSocializedLoss(socializedLossStr);

      // Store margin values aligned to Interactive Trader formatting
      setMarginValues({
        marginUsed: formatTokenAmount(marginUsed), // 6 decimals
        marginReserved: formatTokenAmount(marginReserved), // 6 decimals
        realizedPnL: realizedPnLStr, // 24 -> decimal string
        unrealizedPnL: unrealizedPnLStr // 24 -> decimal string (real-time preferred)
      });
      
      lastSuccessRef.current = Date.now();
      backoffRef.current = 15000; // reset backoff on success
      setIsLoading(false);
      setError(null);

      // Dispatch UI event for other components (e.g., TradingPanel) to react without extra RPC
      try {
        if (typeof window !== 'undefined') {
          const detail = {
            availableCollateral: formatTokenAmount(availableCollateral),
            totalCollateral: formatTokenAmount(totalCollateral),
            marginUsed: formatTokenAmount(marginUsed),
            marginReserved: formatTokenAmount(marginReserved),
            realizedPnL: realizedPnLStr,
            unrealizedPnL: unrealizedPnLStr,
            isHealthy: Boolean(isHealthy),
            socializedLoss: socializedLossStr
          };
          console.log('[CCC] Dispatching coreVaultSummary', detail);
          const evt = new CustomEvent('coreVaultSummary', { detail });
          window.dispatchEvent(evt);
        }
      } catch {}
    } catch (err) {
      console.error('Failed to fetch balances:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch balances'));
      // Exponential backoff on error to reduce pressure on RPC
      backoffRef.current = Math.min(backoffRef.current * 2, 120000);
      setIsLoading(false);
    }
    finally {
      isFetchingRef.current = false;
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

  // Attach event-driven updates (Phase B) with module-level dedupe
  useEffect(() => {
    if (!isInitialized || !contracts || !userAddress) return;
    if (coreVaultWatchersAttached) return;

    try {
      // Prefer WebSocket provider for real-time subscriptions (no polling / no eth_newFilter)
      const wsProvider: any = getWsProvider();
      if (!wsProvider) {
        console.warn('[useCoreVault] WS provider not available; skipping event subscriptions (no polling mode)');
        return;
      }

      const attach = async () => {
        try {
          const vaultAddr = await contracts.vault.getAddress();
          const usdcAddr = await contracts.mockUSDC.getAddress();

          const addrLc = (userAddress || '').toLowerCase();
          const userTopic = '0x000000000000000000000000' + addrLc.slice(2);

          // Simple event filters (topic-only) to reduce decode overhead
          // We'll refresh on any event affecting balances or positions
          const onEvent = () => {
            const now = Date.now();
            // debounce multiple events in short burst
            if (now - coreVaultLastEventTs < 500) return;
            coreVaultLastEventTs = now;
            // Reset backoff for prompt freshness after event
            backoffRef.current = 15000;
            scheduleRefresh();
          };

          // Subscribe to USDC Transfer involving userAddress
          try {
            const topicTransfer = ethers.id('Transfer(address,address,uint256)');
            // from == user
            const usdcFilterFrom = { address: usdcAddr, topics: [topicTransfer, userTopic, null] } as any;
            // to == user
            const usdcFilterTo = { address: usdcAddr, topics: [topicTransfer, null, userTopic] } as any;

          const handler = () => onEvent();
          wsProvider.on(usdcFilterFrom, handler);
          wsProvider.on(usdcFilterTo, handler);

            // Store for cleanup
            (wsProvider as any).__cv_usdcHandler = handler;
            (wsProvider as any).__cv_usdcFilterFrom = usdcFilterFrom;
            (wsProvider as any).__cv_usdcFilterTo = usdcFilterTo;
          } catch {}

          // Subscribe to generic CoreVault events (batched via address-only)
          try {
            // Listen to specific user-indexed vault events to reduce noise
            const topicCollateralDeposited = ethers.id('CollateralDeposited(address,uint256)');
            const topicCollateralWithdrawn = ethers.id('CollateralWithdrawn(address,uint256)');
            const topicMarginLocked = ethers.id('MarginLocked(address,bytes32,uint256,uint256)');
            const topicMarginReleased = ethers.id('MarginReleased(address,bytes32,uint256,uint256)');
            const topicMarginReserved = ethers.id('MarginReserved(address,bytes32,bytes32,uint256)');
            const topicMarginUnreserved = ethers.id('MarginUnreserved(address,bytes32,uint256)');
            const topicPositionUpdated = ethers.id('PositionUpdated(address,bytes32,int256,int256,uint256,uint256)');
            const topicUserLossSocialized = ethers.id('UserLossSocialized(address,uint256,uint256)');

            const topicToName: Record<string, string> = {
              [topicCollateralDeposited.toLowerCase()]: 'CollateralDeposited',
              [topicCollateralWithdrawn.toLowerCase()]: 'CollateralWithdrawn',
              [topicMarginLocked.toLowerCase()]: 'MarginLocked',
              [topicMarginReleased.toLowerCase()]: 'MarginReleased',
              [topicMarginReserved.toLowerCase()]: 'MarginReserved',
              [topicMarginUnreserved.toLowerCase()]: 'MarginUnreserved',
              [topicPositionUpdated.toLowerCase()]: 'PositionUpdated',
              [topicUserLossSocialized.toLowerCase()]: 'UserLossSocialized',
            };

            // Subscribe to all CoreVault logs; filter to current user by topic in handler
            const vaultFilter = { address: vaultAddr } as any;
            const handler = (log: any) => {
              try {
                const topicsLower = (log?.topics || []).map((t: any) => (t?.toLowerCase?.() || ''));
                const top0 = topicsLower[0] || '';
                const ev = topicToName[top0] || 'UnknownEvent';
                const hasUser = topicsLower.includes(userTopic.toLowerCase());
                if (!hasUser) return;
                const tx = log?.transactionHash || '0x';
                const blk = log?.blockNumber;
                console.log(`[CCC] CoreVault event ${ev}`, { tx, blockNumber: blk, address: log?.address });
              } catch {}
              onEvent();
            };
            console.log('[CCC] Subscribing to CoreVault logs via WS', { address: vaultAddr });
            wsProvider.on(vaultFilter, handler);
            (wsProvider as any).__cv_vaultHandler = handler;
            (wsProvider as any).__cv_vaultFilter = vaultFilter;
          } catch {}

          coreVaultWatchersAttached = true;
        } catch {}
      };

      attach();
    } catch {}

    return () => {
      try {
        const wsProvider: any = getWsProvider();
        if (wsProvider) {
          const h1 = (wsProvider as any).__cv_usdcHandler;
          const f1 = (wsProvider as any).__cv_usdcFilterFrom;
          const f1b = (wsProvider as any).__cv_usdcFilterTo;
          if (h1 && f1) { try { wsProvider.off(f1, h1); } catch {} }
          if (h1 && f1b) { try { wsProvider.off(f1b, h1); } catch {} }
          (wsProvider as any).__cv_usdcHandler = undefined;
          (wsProvider as any).__cv_usdcFilterFrom = undefined;
          (wsProvider as any).__cv_usdcFilterTo = undefined;
          const h2 = (wsProvider as any).__cv_vaultHandler;
          const f2 = (wsProvider as any).__cv_vaultFilter;
          if (h2 && f2) {
            try { wsProvider.off(f2, h2); } catch {}
            (wsProvider as any).__cv_vaultHandler = undefined;
            (wsProvider as any).__cv_vaultFilter = undefined;
          }
        }
      } catch {}
      // Do not reset coreVaultWatchersAttached to avoid flapping in multi-mount scenarios
    };
  }, [isInitialized, contracts, userAddress, scheduleRefresh]);

  // Subscribe to new blocks to opportunistically refresh snapshot-based state
  useEffect(() => {
    if (!isInitialized || !contracts || !userAddress) return;
    const wsProvider: any = getWsProvider();
    if (!wsProvider || typeof wsProvider.on !== 'function') return;
    let lastBlockTs = 0;
    const onBlock = (_bn: number) => {
      const now = Date.now();
      if (now - lastBlockTs < 1500) return;
      lastBlockTs = now;
      // Reset backoff since we have new chain data
      backoffRef.current = 15000;
      scheduleRefresh();
    };
    try {
      wsProvider.on('block', onBlock);
    } catch {}
    return () => {
      try { wsProvider?.off?.('block', onBlock); } catch {}
    };
  }, [isInitialized, contracts, userAddress, scheduleRefresh]);

  // Replace fixed polling with adaptive, visibility-aware timer
  useEffect(() => {
    if (!ENABLE_VAULT_POLLING) return;
    if (!isInitialized || !contracts || !userAddress) return;

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      fetchBalances();
      const delay = backoffRef.current;
      pollingIntervalRef.current = setTimeout(tick, delay) as unknown as ReturnType<typeof setInterval>;
    };

    tick();

    return () => {
      if (pollingIntervalRef.current) {
        clearTimeout(pollingIntervalRef.current as unknown as number);
        pollingIntervalRef.current = null;
      }
    };
  }, [isInitialized, contracts, userAddress, fetchBalances]);

  // Deposit collateral - returns transaction hash for compatibility with DepositModal
  const depositCollateral = useCallback(async (amount: string): Promise<string> => {
    const currentContracts = await getWriteContracts();
    if (!currentContracts) throw new Error('Contracts not initialized or wallet not connected');
    if (!userAddress) throw new Error('Wallet address not available');

    try {
      console.log(`💰 [RPC] Starting collateral deposit for ${userAddress.slice(0, 6)}...`, { amount });
      // Parse amount to BigInt with 6 decimals (USDC standard)
      const amountWei = parseTokenAmount(amount);

      // Preflight: ensure sufficient USDC balance
      try {
        const balanceWei: bigint = await currentContracts.mockUSDC.balanceOf(userAddress);
        if (balanceWei < amountWei) {
          const have = formatTokenAmount(balanceWei);
          const need = formatTokenAmount(amountWei);
          throw new Error(`Insufficient USDC balance. You have ${have} USDC but need ${need} USDC. Use the Faucet to mint test USDC.`);
        }
      } catch (e) {
        // If balance read fails, surface a clear error before attempting writes
        if (e instanceof Error) throw e;
        throw new Error('Failed to read USDC balance. Please try again.');
      }

      // Get vault address
      let vaultAddress;
      try {
        console.log(`📡 [RPC] Getting vault address`);
        const startTimeVault = Date.now();
        vaultAddress = await currentContracts.vault.getAddress();
        const durationVault = Date.now() - startTimeVault;
        console.log(`✅ [RPC] Vault address fetched in ${durationVault}ms`, { vaultAddress });
      } catch (e) {
        console.error('❌ [RPC] Error getting vault address:', e);
        vaultAddress = CONTRACT_ADDRESSES.CORE_VAULT;
      }

      if (!vaultAddress) throw new Error('Vault address not found');

      // Ensure allowance is sufficient; approve only if needed
      try {
        const currentAllowance: bigint = await currentContracts.mockUSDC.allowance(userAddress, vaultAddress);
        if (currentAllowance < amountWei) {
          console.log(`📡 [RPC] Approving USDC transfer for vault (needed: ${formatTokenAmount(amountWei)})`);
          const startTimeApprove = Date.now();
          const approveTx = await currentContracts.mockUSDC.approve(vaultAddress, amountWei);
          const durationApprove = Date.now() - startTimeApprove;
          console.log(`✅ [RPC] USDC approval submitted in ${durationApprove}ms`, { txHash: approveTx.hash });
          await approveTx.wait();
        } else {
          console.log('✅ [RPC] Existing USDC allowance is sufficient; skipping approve');
        }
      } catch (e) {
        console.error('❌ [RPC] USDC approve failed:', e);
        throw new Error('USDC approval failed. Please try again.');
      }

      // Deposit collateral
      console.log(`📡 [RPC] Depositing collateral to vault`);
      let startTimeDeposit = Date.now();
      const depositTx = await currentContracts.vault.depositCollateral(amountWei);
      const durationDeposit = Date.now() - startTimeDeposit;
      console.log(`✅ [RPC] Collateral deposit submitted in ${durationDeposit}ms`, { txHash: depositTx.hash });
      const receipt = await depositTx.wait();
      
      // Refresh balances
      fetchBalances();
      
      return depositTx.hash;
    } catch (err) {
      console.error('Deposit failed:', err);
      const anyErr = err as any;
      // Provide a clearer message for common revert during gas estimation
      if (anyErr?.code === 'CALL_EXCEPTION' && anyErr?.action === 'estimateGas') {
        throw new Error('Deposit reverted during gas estimation. Common causes: insufficient USDC balance or allowance, or the vault is paused. Please verify and try again.');
      }
      throw err;
    }
  }, [userAddress, fetchBalances, getWriteContracts]);

  // Withdraw collateral
  const withdrawCollateral = useCallback(async (amount: string): Promise<string> => {
    const currentContracts = await getWriteContracts();
    if (!currentContracts) throw new Error('Contracts not initialized or wallet not connected');
    if (!userAddress) throw new Error('Wallet address not available');

    try {
      console.log(`💸 [RPC] Starting collateral withdrawal for ${userAddress.slice(0, 6)}...`, { amount });
      // Parse amount to BigInt with 6 decimals (USDC standard)
      const amountWei = parseTokenAmount(amount);

      // Withdraw collateral
      console.log(`📡 [RPC] Withdrawing collateral from vault`);
      let startTimeWithdraw = Date.now();
      const withdrawTx = await currentContracts.vault.withdrawCollateral(amountWei);
      const durationWithdraw = Date.now() - startTimeWithdraw;
      console.log(`✅ [RPC] Collateral withdrawal submitted in ${durationWithdraw}ms`, { txHash: withdrawTx.hash });
      const receipt = await withdrawTx.wait();
      
      // Refresh balances
      fetchBalances();
      
      return withdrawTx.hash;
    } catch (err) {
      console.error('Withdrawal failed:', err);
      throw err;
    }
  }, [userAddress, fetchBalances, getWriteContracts]);

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