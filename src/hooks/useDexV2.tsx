/**
 * 🏗️ DexContractsV2 React Hook
 * 
 * Comprehensive React hook providing all DexV2 functionality:
 * - Trading & Position Management
 * - Portfolio & Analytics  
 * - Limit Order Management
 * - Market Creation & Discovery
 * - Collateral Management
 * - Real-time Updates via Events
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPublicClient, createWalletClient, custom, http } from 'viem';
import { polygon } from 'viem/chains';
import { 
  DexV2Service, 
  createDexV2Service,
  type DexV2Config,
  type PortfolioDashboard,
  type UserPosition,
  type MarketSummary,
  type LimitOrder,
  type MetricInfo,
  type OpenPositionParams,
  type LimitOrderParams,
  formatTokenAmount,
  parseTokenAmount,
  getPositionTypeString,
  getOrderTypeString,
  getOrderStatusString
} from '@/lib/dexV2Service';
import { useWallet } from './useWallet';
import { getDefaultNetwork, isDexV2Enabled } from '@/lib/contracts';

// Extend Window interface for ethereum provider
declare global {
  interface Window {
    ethereum?: any;
  }
}

// ==========================================
// 🏷️ HOOK INTERFACES
// ==========================================

export interface UseDexV2Options {
  network?: string;
  autoConnect?: boolean;
  enableEventListeners?: boolean;
}

export interface DexV2State {
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  isV2Enabled: boolean;
  network: string;
}

export interface CollateralState {
  balance: bigint;
  totalCollateral: bigint;
  totalReservedMargin: bigint;
  totalUnrealizedPnL: bigint;
  availableCollateral: bigint;
  isLoading: boolean;
}

export interface PositionsState {
  positions: UserPosition[];
  isLoading: boolean;
  totalPositions: number;
  activeMarkets: number;
}

export interface LimitOrdersState {
  orders: LimitOrder[];
  isLoading: boolean;
  executableOrders: bigint[];
}

export interface MarketsState {
  allVAMMs: string[];
  marketSummaries: Record<string, MarketSummary>;
  metrics: string[];
  metricInfo: Record<string, MetricInfo>;
  isLoading: boolean;
}

// ==========================================
// 🎣 MAIN HOOK
// ==========================================

export function useDexV2(options: UseDexV2Options = {}) {
  const {
    network = getDefaultNetwork(),
    autoConnect = true,
    enableEventListeners = true
  } = options;

  const { walletData } = useWallet();

  // ==========================================
  // 📊 STATE MANAGEMENT
  // ==========================================

  const [dexV2State, setDexV2State] = useState<DexV2State>({
    isInitialized: false,
    isLoading: false,
    error: null,
    isV2Enabled: isDexV2Enabled(network),
    network
  });

  const [service, setService] = useState<DexV2Service | null>(null);

  const [portfolioDashboard, setPortfolioDashboard] = useState<PortfolioDashboard>({
    totalCollateral: 0n,
    totalReservedMargin: 0n,
    totalUnrealizedPnL: 0n,
    availableCollateral: 0n,
    totalPositions: 0n,
    activeMarkets: 0n
  });

  const [collateralState, setCollateralState] = useState<CollateralState>({
    balance: 0n,
    totalCollateral: 0n,
    totalReservedMargin: 0n,
    totalUnrealizedPnL: 0n,
    availableCollateral: 0n,
    isLoading: false
  });

  const [positionsState, setPositionsState] = useState<PositionsState>({
    positions: [],
    isLoading: false,
    totalPositions: 0,
    activeMarkets: 0
  });

  const [limitOrdersState, setLimitOrdersState] = useState<LimitOrdersState>({
    orders: [],
    isLoading: false,
    executableOrders: []
  });

  const [marketsState, setMarketsState] = useState<MarketsState>({
    allVAMMs: [],
    marketSummaries: {},
    metrics: [],
    metricInfo: {},
    isLoading: false
  });

  // ==========================================
  // 🔧 SERVICE INITIALIZATION
  // ==========================================

  const initializeService = useCallback(async () => {
    if (!dexV2State.isV2Enabled) {
      return;
    }

    try {
      setDexV2State(prev => ({ ...prev, isLoading: true, error: null }));

      // Create basic public client for read-only operations
      const publicClient = createPublicClient({
        chain: polygon,
        transport: http()
      });

      const config: DexV2Config = {
        network,
        publicClient
      };

      // Add wallet client if wallet is connected and ethereum provider is available
      if (walletData.isConnected && typeof globalThis !== 'undefined' && globalThis.window && (globalThis.window as any).ethereum) {
        try {
          const walletClient = createWalletClient({
            chain: polygon,
            transport: custom((globalThis.window as any).ethereum)
          });
          config.walletClient = walletClient;
          console.log('✅ Wallet client added to DexV2 config');
        } catch (error) {
          console.warn('⚠️ Failed to create wallet client:', error);
          console.log('📖 Service will be read-only until wallet client is available');
        }
      }

      console.log('🚀 Initializing DexV2 service...');
      const newService = createDexV2Service(config);
      
      // Wait for the service to be properly initialized
      const isInitialized = await newService.isFullyInitialized();
      if (!isInitialized) {
        const status = await newService.getInitializationStatus();
        console.error('❌ Service not fully initialized. Status:', status);
        throw new Error(`Service initialization incomplete. Missing contracts: ${Object.entries(status).filter(([, initialized]) => !initialized).map(([name]) => name).join(', ')}`);
      }
      
      console.log('✅ DexV2 service initialized successfully');
      setService(newService);

      setDexV2State(prev => ({
        ...prev,
        isInitialized: true,
        isLoading: false
      }));

    } catch (error) {
      console.error('💥 Failed to initialize DexV2 service:', error);
      setDexV2State(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to initialize DexV2'
      }));
    }
  }, [network, dexV2State.isV2Enabled]);

  // ==========================================
  // 📊 DATA FETCHING FUNCTIONS
  // ==========================================

  const refreshPortfolio = useCallback(async () => {
    if (!service || !walletData.address) return;
    
    // Check if service is properly initialized before making calls
    const isInitialized = await service.isFullyInitialized();
    if (!isInitialized) {
      console.warn('⚠️ Skipping portfolio refresh - service not fully initialized');
      const status = await service.getInitializationStatus();
      console.warn('Service status:', status);
      return;
    }

    try {
      setDexV2State(prev => ({ ...prev, isLoading: true }));

      const [dashboard, positions, collateralData] = await Promise.all([
        service.getPortfolioDashboard(walletData.address),
        service.getUserPositionsAcrossMarkets(walletData.address),
        service.getUserCollateralData(walletData.address)
      ]);

      setPortfolioDashboard(dashboard);
      setPositionsState({
        positions,
        isLoading: false,
        totalPositions: Number(dashboard.totalPositions),
        activeMarkets: Number(dashboard.activeMarkets)
      });
      setCollateralState(prev => ({
        ...prev,
        ...collateralData,
        isLoading: false
      }));

    } catch (error) {
      console.error('💥 Failed to refresh portfolio:', error);
      setDexV2State(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to refresh portfolio'
      }));
    } finally {
      setDexV2State(prev => ({ ...prev, isLoading: false }));
    }
  }, [service, walletData.address, walletData.isConnected]);

  const refreshLimitOrders = useCallback(async () => {
    if (!service || !walletData.address) return;

    try {
      setLimitOrdersState(prev => ({ ...prev, isLoading: true }));

      const [orderHashes, executableOrders] = await Promise.all([
        service.getUserOrders(walletData.address),
        service.getExecutableOrders()
      ]);

      const orders = await Promise.all(
        orderHashes.map(hash => service.getOrderDetails(hash))
      );

      setLimitOrdersState({
        orders,
        isLoading: false,
        executableOrders: executableOrders.map(hash => BigInt(hash)) // Convert to bigint for compatibility
      });

    } catch (error) {
      console.error('Failed to refresh limit orders:', error);
      setDexV2State(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to refresh limit orders'
      }));
    }
  }, [service, walletData.address, walletData.isConnected]);

  const refreshMarkets = useCallback(async () => {
    if (!service) return;

    try {
      setMarketsState(prev => ({ ...prev, isLoading: true }));

      const [allVAMMs, metrics] = await Promise.all([
        service.getAllVAMMs(),
        service.getAllActiveMetrics()
      ]);

      // Fetch market summaries for each metric
      const marketSummaries: Record<string, MarketSummary> = {};
      const metricInfo: Record<string, MetricInfo> = {};

      await Promise.all([
        // Fetch market summaries
        ...metrics.map(async (metricId) => {
          try {
            const summary = await service.getMarketSummary(metricId);
            marketSummaries[metricId] = summary;
          } catch (error) {
            console.warn(`Failed to fetch market summary for ${metricId}:`, error);
          }
        }),
        // Fetch metric info
        ...metrics.map(async (metricId) => {
          try {
            const info = await service.getMetricInfo(metricId);
            metricInfo[metricId] = info;
          } catch (error) {
            console.warn(`Failed to fetch metric info for ${metricId}:`, error);
          }
        })
      ]);

      setMarketsState({
        allVAMMs,
        marketSummaries,
        metrics,
        metricInfo,
        isLoading: false
      });

    } catch (error) {
      console.error('Failed to refresh markets:', error);
      setDexV2State(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to refresh markets'
      }));
    }
  }, [service]);

  // ==========================================
  // 🏃‍♂️ TRADING ACTIONS
  // ==========================================

  const openPosition = useCallback(async (params: OpenPositionParams) => {
    if (!service) throw new Error('Service not initialized');

    try {
      setDexV2State(prev => ({ ...prev, isLoading: true }));
      const tx = await service.openPosition(params);
      await tx.wait();
      await refreshPortfolio();
      return tx;
    } catch (error) {
      console.error('Failed to open position:', error);
      throw error;
    } finally {
      setDexV2State(prev => ({ ...prev, isLoading: false }));
    }
  }, [service, refreshPortfolio]);

  const closePosition = useCallback(async (
    vammAddress: string,
    positionId: bigint,
    sizeToClose: bigint,
    minPrice: bigint,
    maxPrice: bigint
  ) => {
    if (!service) throw new Error('Service not initialized');

    try {
      setDexV2State(prev => ({ ...prev, isLoading: true }));
      const tx = await service.closePosition(vammAddress, positionId, sizeToClose, minPrice, maxPrice);
      await tx.wait();
      await refreshPortfolio();
      return tx;
    } catch (error) {
      console.error('Failed to close position:', error);
      throw error;
    } finally {
      setDexV2State(prev => ({ ...prev, isLoading: false }));
    }
  }, [service, refreshPortfolio]);

  const addToPosition = useCallback(async (
    vammAddress: string,
    positionId: bigint,
    additionalCollateral: bigint,
    minPrice: bigint,
    maxPrice: bigint
  ) => {
    if (!service) throw new Error('Service not initialized');

    try {
      setDexV2State(prev => ({ ...prev, isLoading: true }));
      const tx = await service.addToPosition(vammAddress, positionId, additionalCollateral, minPrice, maxPrice);
      await tx.wait();
      await refreshPortfolio();
      return tx;
    } catch (error) {
      console.error('Failed to add to position:', error);
      throw error;
    } finally {
      setDexV2State(prev => ({ ...prev, isLoading: false }));
    }
  }, [service, refreshPortfolio]);

  // ==========================================
  // 💰 COLLATERAL ACTIONS
  // ==========================================

  const depositCollateral = useCallback(async (amount: bigint) => {
    if (!service) throw new Error('Service not initialized');

    try {
      setCollateralState(prev => ({ ...prev, isLoading: true }));
      const tx = await service.depositCollateral(amount);
      await tx.wait();
      await refreshPortfolio();
      return tx;
    } catch (error) {
      console.error('Failed to deposit collateral:', error);
      throw error;
    } finally {
      setCollateralState(prev => ({ ...prev, isLoading: false }));
    }
  }, [service, refreshPortfolio]);

  const withdrawCollateral = useCallback(async (amount: bigint) => {
    if (!service) throw new Error('Service not initialized');

    try {
      setCollateralState(prev => ({ ...prev, isLoading: true }));
      const tx = await service.withdrawCollateral(amount);
      await tx.wait();
      await refreshPortfolio();
      return tx;
    } catch (error) {
      console.error('Failed to withdraw collateral:', error);
      throw error;
    } finally {
      setCollateralState(prev => ({ ...prev, isLoading: false }));
    }
  }, [service, refreshPortfolio]);

  // ==========================================
  // 📋 LIMIT ORDER ACTIONS
  // ==========================================

  const createLimitOrder = useCallback(async (params: LimitOrderParams) => {
    if (!service) throw new Error('Service not initialized');

    try {
      setLimitOrdersState(prev => ({ ...prev, isLoading: true }));
      const tx = await service.createLimitOrder(params);
      await tx.wait();
      await refreshLimitOrders();
      return tx;
    } catch (error) {
      console.error('Failed to create limit order:', error);
      throw error;
    } finally {
      setLimitOrdersState(prev => ({ ...prev, isLoading: false }));
    }
  }, [service, refreshLimitOrders]);

  const cancelLimitOrder = useCallback(async (orderId: bigint) => {
    if (!service) throw new Error('Service not initialized');

    try {
      setLimitOrdersState(prev => ({ ...prev, isLoading: true }));
      const tx = await service.cancelLimitOrder(orderId);
      await tx.wait();
      await refreshLimitOrders();
      return tx;
    } catch (error) {
      console.error('Failed to cancel limit order:', error);
      throw error;
    } finally {
      setLimitOrdersState(prev => ({ ...prev, isLoading: false }));
    }
  }, [service, refreshLimitOrders]);

  // ==========================================
  // 🏭 MARKET ACTIONS
  // ==========================================

  const deployVAMM = useCallback(async (
    categoryId: number,
    metricId: string,
    vammConfig: {
      maxLeverage: bigint;
      tradingFee: bigint;
      fundingRate: bigint;
      minCollateral: bigint;
      isActive: boolean;
    },
    deploymentFee: bigint = 0n
  ) => {
    if (!service) throw new Error('Service not initialized');

    try {
      setMarketsState(prev => ({ ...prev, isLoading: true }));
      const tx = await service.deploySpecializedVAMM(categoryId, metricId, vammConfig, deploymentFee);
      await tx.wait();
      await refreshMarkets();
      return tx;
    } catch (error) {
      console.error('Failed to deploy VAMM:', error);
      throw error;
    } finally {
      setMarketsState(prev => ({ ...prev, isLoading: false }));
    }
  }, [service, refreshMarkets]);

  const registerMetric = useCallback(async (
    metricId: string,
    metricInfo: {
      name: string;
      description: string;
      category: number;
      dataSource: string;
      updateFrequency: string;
      settlementPeriod: bigint;
      requiresOracle: boolean;
    }
  ) => {
    if (!service) throw new Error('Service not initialized');

    try {
      setMarketsState(prev => ({ ...prev, isLoading: true }));
      const tx = await service.registerMetric(metricId, metricInfo);
      await tx.wait();
      await refreshMarkets();
      return tx;
    } catch (error) {
      console.error('Failed to register metric:', error);
      throw error;
    } finally {
      setMarketsState(prev => ({ ...prev, isLoading: false }));
    }
  }, [service, refreshMarkets]);

  // ==========================================
  // 🔧 UTILITY FUNCTIONS
  // ==========================================

  const approveUSDC = useCallback(async (amount: bigint) => {
    if (!service) throw new Error('Service not initialized');
    const addresses = service.getContracts();
    if (!addresses.router) throw new Error('Router address not available');
    return await service.approveUSDC(addresses.router.target.toString(), amount);
  }, [service]);

  const getUSDCBalance = useCallback(async () => {
    if (!service || !walletData.address) return 0n;
    return await service.getUSDCBalance(walletData.address);
  }, [service, walletData.address]);

  const getMarketSummary = useCallback(async (metricId: string) => {
    if (!service) throw new Error('Service not initialized');
    return await service.getMarketSummary(metricId);
  }, [service]);

  // ==========================================
  // 🔄 EFFECTS
  // ==========================================

  // Initialize service when dependencies change
  useEffect(() => {
    if (autoConnect) {
      initializeService();
    }
  }, [initializeService, autoConnect]);

  // Refresh data when service or address changes
  useEffect(() => {
    if (service && walletData.address && walletData.isConnected) {
      refreshPortfolio();
      refreshLimitOrders();
      refreshMarkets();
    }
  }, [service, walletData.address, walletData.isConnected]);

  // Auto-refresh data when DexV2 becomes available
  useEffect(() => {
    if (dexV2State.isV2Enabled && walletData.isConnected) {
      console.log('♻️ DexV2 system enabled, refreshing data...');
      // Data refresh is handled by the dexV2 hook automatically
    }
  }, [dexV2State.isV2Enabled, walletData.isConnected]);

  // Reinitialize service when wallet connection changes to add wallet client
  useEffect(() => {
    if (dexV2State.isV2Enabled && service && walletData.isConnected) {
      console.log('🔄 Wallet connected, updating service with wallet client...');
      
      // Add wallet client to existing service instead of recreating
      if (typeof globalThis !== 'undefined' && globalThis.window && (globalThis.window as any).ethereum) {
        try {
          const walletClient = createWalletClient({
            chain: polygon,
            transport: custom((globalThis.window as any).ethereum)
          });
          
          service.updateWithWalletClient(walletClient);
          console.log('✅ Service updated with wallet client');
        } catch (error) {
          console.error('❌ Failed to update service with wallet client:', error);
        }
      }
    }
  }, [walletData.isConnected, dexV2State.isV2Enabled, service]);

  // ==========================================
  // 📤 COMPUTED VALUES
  // ==========================================

  const formattedBalances = useMemo(() => ({
    totalCollateral: formatTokenAmount(collateralState.totalCollateral, 6),
    availableCollateral: formatTokenAmount(collateralState.availableCollateral, 6),
    totalUnrealizedPnL: formatTokenAmount(collateralState.totalUnrealizedPnL, 6),
    totalReservedMargin: formatTokenAmount(collateralState.totalReservedMargin, 6)
  }), [collateralState]);

  const activePositions = useMemo(() => 
    positionsState.positions.filter(pos => pos.size > 0n),
    [positionsState.positions]
  );

  const activeOrders = useMemo(() => 
    limitOrdersState.orders.filter(order => order.status === 0), // ACTIVE status
    [limitOrdersState.orders]
  );

  // ==========================================
  // 📤 RETURN OBJECT
  // ==========================================

  return {
    // State
    ...dexV2State,
    service,
    
    // Portfolio & Collateral
    portfolioDashboard,
    collateralState,
    formattedBalances,
    
    // Positions
    positionsState,
    activePositions,
    
    // Limit Orders  
    limitOrdersState,
    activeOrders,
    
    // Markets
    marketsState,
    
    // Actions
    trading: {
      openPosition,
      closePosition,
      addToPosition
    },
    
    collateral: {
      deposit: depositCollateral,
      withdraw: withdrawCollateral,
      approveUSDC,
      getUSDCBalance
    },
    
    limitOrders: {
      create: createLimitOrder,
      cancel: cancelLimitOrder
    },
    
    markets: {
      deployVAMM,
      registerMetric,
      getMarketSummary
    },
    
    // Utilities
    utils: {
      formatTokenAmount,
      parseTokenAmount,
      getPositionTypeString,
      getOrderTypeString,
      getOrderStatusString
    },
    
    // Refresh functions
    refresh: {
      portfolio: refreshPortfolio,
      limitOrders: refreshLimitOrders,
      markets: refreshMarkets,
      all: useCallback(async () => {
        await Promise.all([
          refreshPortfolio(),
          refreshLimitOrders(),
          refreshMarkets()
        ]);
      }, [refreshPortfolio, refreshLimitOrders, refreshMarkets])
    },
    
    // Manual initialization
    initialize: initializeService
  };
}

export default useDexV2; 