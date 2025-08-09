/**
 * 🚀 DexContractsV2 Trading Hook
 * 
 * Modern trading hook using the MetricVAMMRouter and CentralizedVault system.
 * Supports specialized VAMMs (Population, Weather, Economic) via unified router interface.
 * 
 * 🔧 Key Features:
 * - Router-based trading (openPosition, closePosition, addToPosition)
 * - Centralized collateral management
 * - Portfolio dashboard & analytics
 * - Real-time position tracking
 * - Specialized VAMM support (Population, Weather, Economic)
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPublicClient, createWalletClient, custom, getContract, formatEther, parseEther } from 'viem';
import { polygon } from 'viem/chains';

// Import ABIs from dedicated ABI loader
import { 
  METRIC_VAMM_ROUTER_ABI,
  CENTRALIZED_VAULT_ABI,
  ERC20_ABI
} from '@/lib/contractABIs';

// Import contract addresses
import { getContractAddresses } from '@/lib/contracts';

// ==========================================
// 🏷️ INTERFACES & TYPES
// ==========================================

export interface Position {
  positionId: bigint;
  size: bigint;
  isLong: boolean;
  entryPrice: bigint;
  entryFundingIndex: bigint;
  lastInteractionTime: bigint;
  isActive: boolean;
  unrealizedPnL: bigint;
}

export interface MarketSummary {
  vammAddress: string;
  markPrice: bigint;
  totalLongSize: bigint;
  totalShortSize: bigint;
  netPosition: bigint;
  fundingRate: bigint;
  isActive: boolean;
}

export interface PortfolioDashboard {
  totalCollateral: bigint;
  totalReservedMargin: bigint;
  totalUnrealizedPnL: bigint;
  availableCollateral: bigint;
  totalPositions: bigint;
  activeMarkets: bigint;
  vammAddresses: string[];
  positionCounts: bigint[];
}

export interface TokenData {
  symbol: string;
  name: string;
  icon?: string;
  category: 'POPULATION' | 'WEATHER' | 'ECONOMIC';
}

export interface VAMMTradingState {
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  positions: Position[];
  portfolioDashboard: PortfolioDashboard | null;
  marketSummary: MarketSummary | null;
  currentVAMMAddress: string | null;
  currentTokenData: TokenData | null;
  collateralBalance: bigint;
  allowance: bigint;
}

// ==========================================
// 🎣 MAIN HOOK
// ==========================================

export function useVAMMTrading() {
  // ==========================================
  // 📊 STATE MANAGEMENT
  // ==========================================
  
  const [state, setState] = useState<VAMMTradingState>({
    isInitialized: false,
    isLoading: false,
    error: null,
    positions: [],
    portfolioDashboard: null,
    marketSummary: null,
    currentVAMMAddress: null,
    currentTokenData: null,
    collateralBalance: 0n,
    allowance: 0n,
  });

  // ==========================================
  // 🔗 VIEM CLIENT SETUP
  // ==========================================
  
  const publicClient = useRef<any>(null);
  const walletClient = useRef<any>(null);
  const routerContract = useRef<any>(null);
  const vaultContract = useRef<any>(null);
  const usdcContract = useRef<any>(null);

  // ==========================================
  // 📋 CONTRACT ADDRESSES
  // ==========================================

  const addresses = useMemo(() => getContractAddresses('polygon'), []);

  // ==========================================
  // 🏭 SPECIALIZED VAMM ADDRESSES
  // ==========================================

  const specializedVAMMs = useMemo(() => ({
    POPULATION: addresses.POPULATION_VAMM,
    WEATHER: addresses.WEATHER_VAMM,
    ECONOMIC: addresses.ECONOMIC_VAMM,
  }), [addresses]);

  // ==========================================
  // 🔧 CONTRACT INITIALIZATION
  // ==========================================

  const initializeContracts = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      console.log('🚀 Initializing DexContractsV2 system...');

      // Initialize viem clients
      if (typeof globalThis !== 'undefined' && globalThis.window?.ethereum) {
        publicClient.current = createPublicClient({
          chain: polygon,
          transport: custom(globalThis.window.ethereum)
        });

        walletClient.current = createWalletClient({
          chain: polygon,
          transport: custom(globalThis.window.ethereum)
        });

        console.log('✅ Viem clients initialized');
      } else {
        throw new Error('No Ethereum provider found. Please install MetaMask.');
      }

      // Initialize MetricVAMMRouter
      routerContract.current = getContract({
        address: addresses.DEXV2_ROUTER as `0x${string}`,
        abi: METRIC_VAMM_ROUTER_ABI,
        client: {
          public: publicClient.current,
          wallet: walletClient.current
        }
      });

      // Initialize CentralizedVault
      vaultContract.current = getContract({
        address: addresses.DEXV2_VAULT as `0x${string}`,
        abi: CENTRALIZED_VAULT_ABI,
        client: {
          public: publicClient.current,
          wallet: walletClient.current
        }
      });

      // Initialize USDC contract
      usdcContract.current = getContract({
        address: addresses.DEXV2_USDC as `0x${string}`,
        abi: ERC20_ABI,
        client: {
          public: publicClient.current,
          wallet: walletClient.current
        }
      });

      console.log('✅ DexV2 contracts initialized successfully');
      console.log('📋 Router:', addresses.DEXV2_ROUTER);
      console.log('📋 Vault:', addresses.DEXV2_VAULT);
      console.log('📋 USDC:', addresses.DEXV2_USDC);

      setState(prev => ({ 
        ...prev, 
        isInitialized: true, 
        isLoading: false,
        error: null 
      }));

    } catch (error: any) {
      console.error('❌ Failed to initialize contracts:', error);
      setState(prev => ({ ...prev, isLoading: false, error: `Contract initialization failed: ${error.message || 'Unknown error'}` }));
    }
  }, [addresses]);

  // ==========================================
  // 🎯 SPECIALIZED VAMM SELECTION
  // ==========================================

  const selectSpecializedVAMM = useCallback(async (tokenData: TokenData) => {
    if (!state.isInitialized) {
      throw new Error('Contracts not initialized');
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      console.log('🔍 Selecting specialized VAMM for:', tokenData.symbol);

      // Get VAMM address based on category
      let vammAddress: string;
      switch (tokenData.category) {
        case 'POPULATION':
          vammAddress = specializedVAMMs.POPULATION;
          break;
        case 'WEATHER':
          vammAddress = specializedVAMMs.WEATHER;
          break;
        case 'ECONOMIC':
          vammAddress = specializedVAMMs.ECONOMIC;
          break;
        default:
          throw new Error(`Unknown token category: ${tokenData.category}`);
      }

      console.log('✅ VAMM selected:', vammAddress);

      // Validate VAMM exists and get market summary
      const metricId = tokenData.symbol; // Use symbol directly as string
      console.log('📊 Getting market summary for metric:', metricId);
      
      // Convert string to bytes32 and use getMetricPriceComparison
      const metricIdBytes32 = keccak256(stringToBytes(metricId));
      const marketSummary = await routerContract.current.read.getMetricPriceComparison([metricIdBytes32]);
      console.log('✅ Market summary retrieved:', marketSummary);

      setState(prev => ({
        ...prev,
        currentVAMMAddress: vammAddress,
        currentTokenData: tokenData,
        marketSummary: {
          vammAddress: marketSummary[0],
          markPrice: marketSummary[1],
          totalLongSize: marketSummary[2],
          totalShortSize: marketSummary[3],
          netPosition: marketSummary[4], // Changed from totalVolume24h
          fundingRate: marketSummary[5],
          isActive: marketSummary[6],
        },
        isLoading: false,
        error: null
      }));

    } catch (error: any) {
      console.error('❌ VAMM selection failed:', error);
      setState(prev => ({ 
        ...prev, 
        isLoading: false, 
        error: `VAMM selection failed: ${error.message || 'Unknown error'}` 
      }));
      throw error;
    }
  }, [state.isInitialized, specializedVAMMs]);

  // ==========================================
  // 💰 COLLATERAL MANAGEMENT
  // ==========================================

  const refreshCollateralData = useCallback(async () => {
    if (!walletClient.current || !state.isInitialized) return;

    try {
      const [account] = await walletClient.current.getAddresses();
      
      const [balance, allowance] = await Promise.all([
        usdcContract.current.read.balanceOf([account]),
        usdcContract.current.read.allowance([account, addresses.DEXV2_VAULT])
      ]);

      setState(prev => ({
        ...prev,
        collateralBalance: balance,
        allowance: allowance,
      }));

    } catch (error: any) {
      console.warn('⚠️ Could not refresh collateral data:', error);
    }
  }, [state.isInitialized, addresses.DEXV2_VAULT]);

  const approveCollateral = useCallback(async (amount: bigint) => {
    if (!walletClient.current || !state.isInitialized) {
      throw new Error('Wallet not connected or contracts not initialized');
    }

    try {
      console.log('🔐 Approving USDC for vault...');
      
      const [account] = await walletClient.current.getAddresses();
      const hash = await usdcContract.current.write.approve([addresses.DEXV2_VAULT, amount], {
        account
      });

      console.log('⏳ Waiting for approval transaction...', hash);
      await publicClient.current.waitForTransactionReceipt({ hash });
      
      console.log('✅ USDC approved successfully');
      await refreshCollateralData();
      
      return hash;
    } catch (error: any) {
      console.error('❌ Approval failed:', error);
      throw error;
    }
  }, [state.isInitialized, addresses.DEXV2_VAULT, refreshCollateralData]);

  const depositCollateral = useCallback(async (amount: bigint) => {
    if (!walletClient.current || !state.isInitialized) {
      throw new Error('Wallet not connected or contracts not initialized');
    }

    try {
      console.log('💰 Depositing collateral to vault...');
      
      const [account] = await walletClient.current.getAddresses();
      const hash = await vaultContract.current.write.depositCollateral([amount], {
        account
      });

      console.log('⏳ Waiting for deposit transaction...', hash);
      await publicClient.current.waitForTransactionReceipt({ hash });
      
      console.log('✅ Collateral deposited successfully');
      await refreshCollateralData();
      
      return hash;
    } catch (error: any) {
      console.error('❌ Deposit failed:', error);
      throw error;
    }
  }, [state.isInitialized, refreshCollateralData]);

  // ==========================================
  // 📈 PORTFOLIO & POSITION MANAGEMENT
  // ==========================================

  const refreshPortfolio = useCallback(async () => {
    if (!walletClient.current || !state.isInitialized) return;

    try {
      const [account] = await walletClient.current.getAddresses();
      
      const portfolioDashboard = await routerContract.current.read.getPortfolioDashboard([account]);
      
      setState(prev => ({
        ...prev,
        portfolioDashboard: {
          totalCollateral: portfolioDashboard[0],
          totalReservedMargin: portfolioDashboard[1],
          totalUnrealizedPnL: portfolioDashboard[2],
          availableCollateral: portfolioDashboard[3],
          totalPositions: portfolioDashboard[4],
          activeMarkets: portfolioDashboard[5],
          vammAddresses: portfolioDashboard[6],
          positionCounts: portfolioDashboard[7],
        }
      }));

    } catch (error: any) {
      console.warn('⚠️ Could not refresh portfolio:', error);
    }
  }, [state.isInitialized]);

  const refreshPositions = useCallback(async () => {
    if (!walletClient.current || !state.isInitialized || !state.currentVAMMAddress) return;

    try {
      const [account] = await walletClient.current.getAddresses();
      
      const userPositions = await routerContract.current.read.getUserPositions([
        account, 
        state.currentVAMMAddress
      ]);

      const positions: Position[] = userPositions.map((pos: any) => ({
        positionId: pos[0],
        size: pos[1],
        isLong: pos[2],
        entryPrice: pos[3],
        entryFundingIndex: pos[4],
        lastInteractionTime: pos[5],
        isActive: pos[6],
        unrealizedPnL: pos[7],
      }));

      setState(prev => ({ ...prev, positions }));

    } catch (error: any) {
      console.warn('⚠️ Could not refresh positions:', error);
    }
  }, [state.isInitialized, state.currentVAMMAddress]);

  // ==========================================
  // 🎯 TRADING OPERATIONS
  // ==========================================

  const openPosition = useCallback(async (
    collateralAmount: bigint,
    isLong: boolean,
    leverage: bigint,
    minPrice: bigint = 0n,
    maxPrice: bigint = parseEther('1000000') // Very high max price
  ) => {
    if (!walletClient.current || !state.isInitialized || !state.currentVAMMAddress) {
      throw new Error('Wallet not connected or VAMM not selected');
    }

    try {
      console.log('🎯 Opening position via router...');
      console.log('📊 Parameters:', {
        vamm: state.currentVAMMAddress,
        collateral: formatEther(collateralAmount),
        isLong,
        leverage: leverage.toString(),
      });

      const [account] = await walletClient.current.getAddresses();
      
      const hash = await routerContract.current.write.openPosition([
        state.currentVAMMAddress,
        collateralAmount,
        isLong,
        leverage,
        minPrice,
        maxPrice
      ], { account });

      console.log('⏳ Waiting for position open transaction...', hash);
      const receipt = await publicClient.current.waitForTransactionReceipt({ hash });
      
      console.log('✅ Position opened successfully');
      
      // Refresh data
      await Promise.all([
        refreshPositions(),
        refreshPortfolio(),
        refreshCollateralData()
      ]);
      
      return hash;
    } catch (error: any) {
      console.error('❌ Open position failed:', error);
      throw error;
    }
  }, [state.isInitialized, state.currentVAMMAddress, refreshPositions, refreshPortfolio, refreshCollateralData]);

  const closePosition = useCallback(async (
    positionId: bigint,
    sizeToClose: bigint,
    minPrice: bigint = 0n,
    maxPrice: bigint = parseEther('1000000')
  ) => {
    if (!walletClient.current || !state.isInitialized || !state.currentVAMMAddress) {
      throw new Error('Wallet not connected or VAMM not selected');
    }

    try {
      console.log('🎯 Closing position via router...');
      
      const [account] = await walletClient.current.getAddresses();
      
      const hash = await routerContract.current.write.closePosition([
        state.currentVAMMAddress,
        positionId,
        sizeToClose,
        minPrice,
        maxPrice
      ], { account });

      console.log('⏳ Waiting for position close transaction...', hash);
      await publicClient.current.waitForTransactionReceipt({ hash });
      
      console.log('✅ Position closed successfully');
      
      // Refresh data
      await Promise.all([
        refreshPositions(),
        refreshPortfolio(),
        refreshCollateralData()
      ]);
      
      return hash;
    } catch (error: any) {
      console.error('❌ Close position failed:', error);
      throw error;
    }
  }, [state.isInitialized, state.currentVAMMAddress, refreshPositions, refreshPortfolio, refreshCollateralData]);

  // ==========================================
  // 🔄 LIFECYCLE & EFFECTS
  // ==========================================

  useEffect(() => {
    initializeContracts();
  }, [initializeContracts]);

  useEffect(() => {
    if (state.isInitialized) {
      refreshCollateralData();
      refreshPortfolio();
    }
  }, [state.isInitialized]);

  useEffect(() => {
    if (state.isInitialized && state.currentVAMMAddress) {
      refreshPositions();
    }
  }, [state.isInitialized, state.currentVAMMAddress]);

  // ==========================================
  // 📤 RETURN HOOK INTERFACE
  // ==========================================

  return {
    // State
    ...state,
    
    // Contract references
    routerContract: routerContract.current,
    vaultContract: vaultContract.current,
    usdcContract: usdcContract.current,
    
    // VAMM selection
    selectSpecializedVAMM,
    specializedVAMMs,
    
    // Collateral management
    approveCollateral,
    depositCollateral,
    refreshCollateralData,
    
    // Trading operations
    openPosition,
    closePosition,
    
    // Data refresh
    refreshPortfolio,
    refreshPositions,
    
    // Utilities
    initializeContracts,
  };
} 