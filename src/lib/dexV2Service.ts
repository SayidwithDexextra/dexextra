/**
 * 🏗️ DexContractsV2 Service Layer
 * 
 * Unified service interface for all DexContractsV2 operations including:
 * - Trading & Position Management
 * - Portfolio & Analytics
 * - Limit Order Management
 * - Market Creation & Discovery
 * - Collateral Management
 * - Metric Registry Operations
 */

import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  PublicClient, 
  WalletClient, 
  getContract,
  Hash,
  Chain,
  GetContractReturnType,
  keccak256,
  stringToBytes
} from 'viem';
import { polygon } from 'viem/chains';

// Import ABIs from dedicated ABI loader
import { 
  METRIC_VAMM_ROUTER_ABI,
  CENTRALIZED_VAULT_ABI,
  METRIC_VAMM_FACTORY_ABI,
  METRIC_VAMM_ABI,
  METRIC_LIMIT_ORDER_MANAGER_ABI,
  METRIC_REGISTRY_ABI,
  AUTOMATION_FUNDING_MANAGER_ABI,
  LIMIT_ORDER_KEEPER_ABI,
  ERC20_ABI
} from './contractABIs';

// Import contract addresses
import { getContractAddresses } from './contracts';

// ==========================================
// 🏷️ TYPE DEFINITIONS
// ==========================================

export interface DexV2Config {
  network: string;
  publicClient: PublicClient;
  walletClient?: WalletClient;
}

export interface TransactionResult {
  success: boolean;
  hash: string;
  message: string;
  wait: () => Promise<any>;
}

export interface PortfolioDashboard {
  totalCollateral: bigint;
  totalReservedMargin: bigint;
  totalUnrealizedPnL: bigint;
  availableCollateral: bigint;
  totalPositions: bigint;
  activeMarkets: bigint;
}

export interface UserPosition {
  positionId: bigint;
  metricId: string;
  vammAddress: string;
  category: string;
  isLong: boolean;
  size: bigint;
  entryPrice: bigint;
  unrealizedPnL: bigint;
  positionType: number;
}

export interface MarketSummary {
  markPrice: bigint;
  totalLongSize: bigint;
  totalShortSize: bigint;
  netPosition: bigint;
  fundingRate: bigint;
  isActive: boolean;
}

export interface LimitOrder {
  orderId: bigint;
  user: string;
  metricId: string;
  collateralAmount: bigint;
  isLong: boolean;
  leverage: bigint;
  targetValue: bigint;
  positionType: number;
  triggerPrice: bigint;
  orderType: number;
  expiry: bigint;
  maxSlippage: bigint;
  keeperFee: bigint;
  status: number;
  createdAt: bigint;
  executedAt: bigint;
}

export interface MetricInfo {
  name: string;
  description: string;
  category: number;
  dataSource: string;
  updateFrequency: string;
  settlementPeriod: bigint;
  requiresOracle: boolean;
  isActive: boolean;
  registeredBy: string;
  registeredAt: bigint;
}

export interface OpenPositionParams {
  vammAddress?: string;        // Required for router calls
  metricId?: string;           // Optional - used to get vammAddress if not provided
  collateralAmount: bigint;
  isLong: boolean;
  leverage: bigint;
  minPrice: bigint;
  maxPrice: bigint;
  targetValue?: bigint; // For market orders
  positionType?: number; // 0 for market, 1 for prediction, 2 for continuous
}

export interface LimitOrderParams {
  metricId: string;
  collateralAmount: bigint;
  isLong: boolean;
  leverage: bigint;
  targetValue: bigint;
  positionType: number;
  triggerPrice: bigint;
  orderType: number;
  expiry: bigint;
  maxSlippage: bigint;
  keeperFee: bigint;
}

// ==========================================
// 🏗️ DEXV2 SERVICE CLASS
// ==========================================

export class DexV2Service {
  private config: DexV2Config;
  private contracts: {
    router?: any;
    vault?: any;
    factory?: any;
    limitOrderManager?: any;
    registry?: any;
    usdc?: any;
  } = {};
  
  // Add initialization promise to track async initialization
  private initializationPromise: Promise<void> | null = null;

  constructor(config: DexV2Config) {
    this.config = config;
    // Initialize contracts asynchronously and store the promise
    this.initializationPromise = this.initializeContracts().catch(error => {
      console.error('💥 Failed to initialize contracts in constructor:', error);
      throw error; // Re-throw to allow callers to handle the error
    });
  }

  /**
   * Wait for initialization to complete
   */
  private async waitForInitialization(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  /**
   * Ensure service is initialized before executing contract operations
   */
  private async ensureInitialized(): Promise<void> {
    console.log('🔍 Ensuring service is initialized...');
    await this.waitForInitialization();
    console.log('✅ Service initialization confirmed');
    
    // Debug: Log contract status
    console.log('🔍 Contract status after initialization:', {
      router: !!this.contracts.router,
      vault: !!this.contracts.vault,
      factory: !!this.contracts.factory,
      factoryRead: !!(this.contracts.factory && this.contracts.factory.read),
      limitOrderManager: !!this.contracts.limitOrderManager,
      registry: !!this.contracts.registry,
      usdc: !!this.contracts.usdc
    });
  }

  /**
   * Check if the service is properly initialized with all required contracts
   */
  async isFullyInitialized(): Promise<boolean> {
    try {
      await this.waitForInitialization();
      return !!(
        this.contracts.router &&
        this.contracts.vault &&
        this.contracts.factory &&
        this.contracts.limitOrderManager &&
        this.contracts.registry &&
        this.contracts.usdc
      );
    } catch (error) {
      console.error('❌ Service initialization failed:', error);
      return false;
    }
  }

  /**
   * Get initialization status for debugging
   */
  async getInitializationStatus(): Promise<Record<string, boolean>> {
    try {
      await this.waitForInitialization();
      return {
        router: !!this.contracts.router,
        vault: !!this.contracts.vault,
        factory: !!this.contracts.factory,
        limitOrderManager: !!this.contracts.limitOrderManager,
        registry: !!this.contracts.registry,
        usdc: !!this.contracts.usdc
      };
    } catch (error) {
      console.error('❌ Failed to get initialization status:', error);
      return {
        router: false,
        vault: false,
        factory: false,
        limitOrderManager: false,
        registry: false,
        usdc: false
      };
    }
  }

  private async initializeContracts(): Promise<void> {
    try {
      console.log('🚀 Initializing DexV2 contracts...');
      const addresses = getContractAddresses(this.config.network);
      console.log('📋 Contract addresses:', addresses);
      
      // Validate critical addresses
      if (!addresses.DEXV2_FACTORY || addresses.DEXV2_FACTORY === '0x0000000000000000000000000000000000000000') {
        throw new Error(`Invalid factory address: ${addresses.DEXV2_FACTORY}`);
      }
      if (!addresses.DEXV2_ROUTER || addresses.DEXV2_ROUTER === '0x0000000000000000000000000000000000000000') {
        throw new Error(`Invalid router address: ${addresses.DEXV2_ROUTER}`);
      }
      if (!addresses.DEXV2_VAULT || addresses.DEXV2_VAULT === '0x0000000000000000000000000000000000000000') {
        throw new Error(`Invalid vault address: ${addresses.DEXV2_VAULT}`);
      }

      // Create transport and clients
      const transport = this.config.publicClient.transport;
      const client = this.config.walletClient ? {
        public: this.config.publicClient,
        wallet: this.config.walletClient
      } : this.config.publicClient;

      // Initialize core contracts with individual error handling
      try {
        // Debug: Log ABI before contract creation
        console.log('🔍 Router ABI before contract creation:', {
          type: typeof METRIC_VAMM_ROUTER_ABI,
          length: METRIC_VAMM_ROUTER_ABI?.length,
          methods: METRIC_VAMM_ROUTER_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name)
        });

        // Check if contract exists on blockchain
        console.log('🔍 Checking if router contract exists at address:', addresses.DEXV2_ROUTER);
        
        // Create contract instance
        this.contracts.router = getContract({
          address: addresses.DEXV2_ROUTER as `0x${string}`,
          abi: METRIC_VAMM_ROUTER_ABI,
          client
        });
        
        console.log('✅ Router contract initialized:', addresses.DEXV2_ROUTER);
        
        // Debug: Log contract instance
        console.log('🔍 Router contract instance:', {
          hasRead: !!this.contracts.router.read,
          hasWrite: !!this.contracts.router.write,
          readMethods: this.contracts.router.read ? Object.keys(this.contracts.router.read) : [],
          writeMethods: this.contracts.router.write ? Object.keys(this.contracts.router.write) : [],
          abiLength: METRIC_VAMM_ROUTER_ABI?.length,
          abiMethods: METRIC_VAMM_ROUTER_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name)
        });
        
        // Verify critical methods exist in the ABI
        const requiredMethods = ['getAllUserPositions', 'getPortfolioDashboard', 'getMetricPriceComparison'];
        
        // Work around viem issue where read methods are not properly exposed
        // Instead of checking contract.read, we'll validate the ABI directly
        const abiMethods = METRIC_VAMM_ROUTER_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name) || [];
        const availableMethods = abiMethods;
        
        console.log('🔍 Validating MetricVAMMRouter ABI:', {
          totalItems: METRIC_VAMM_ROUTER_ABI?.length,
          functions: METRIC_VAMM_ROUTER_ABI?.filter((item: any) => item.type === 'function')?.length,
          availableMethods,
          requiredMethods
        });
        
        // Check for required methods
        const missingMethods = requiredMethods.filter(method => !availableMethods.includes(method));
        if (missingMethods.length > 0) {
          console.error('❌ Missing required methods in router contract:', {
            missing: missingMethods,
            available: availableMethods,
            abiMethods: METRIC_VAMM_ROUTER_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name)
          });
          
          // Try to get contract code to see if it exists
          try {
            const code = await this.config.publicClient.getBytecode({ address: addresses.DEXV2_ROUTER as `0x${string}` });
            if (!code || code === '0x') {
              throw new Error(`Router contract does not exist at address ${addresses.DEXV2_ROUTER}`);
            } else {
              throw new Error(`Router contract exists but ABI mismatch - contract may have different methods than expected`);
            }
          } catch (codeError) {
            throw new Error(`Router contract validation failed: ${codeError instanceof Error ? codeError.message : 'Unknown error'}`);
          }
        }
        
        console.log('✅ All required router methods found in ABI');
        
        // Fallback: If write methods are not available but we have wallet client, create manual contract
        if (!this.contracts.router.write && this.config.walletClient) {
          console.log('⚠️ Router write methods not available, using fallback approach...');
          this.contracts.router = this.createWriteEnabledContract(addresses.DEXV2_ROUTER, METRIC_VAMM_ROUTER_ABI);
          console.log('✅ Router contract recreated with write capabilities');
        }
      } catch (error) {
        console.error('❌ Failed to initialize router contract:', error);
        throw new Error(`Failed to initialize router contract: ${error}`);
      }

      try {
        this.contracts.vault = getContract({
          address: addresses.DEXV2_VAULT as `0x${string}`,
          abi: CENTRALIZED_VAULT_ABI,
          client
        });
        console.log('✅ Vault contract initialized:', addresses.DEXV2_VAULT);
        
        // Verify vault methods
        const vaultMethods = this.contracts.vault.read ? Object.keys(this.contracts.vault.read) : [];
        console.log('🔍 Vault available methods:', vaultMethods);
        
      } catch (error) {
        console.error('❌ Failed to initialize vault contract:', error);
        throw new Error(`Failed to initialize vault contract: ${error}`);
      }

      try {
        // Debug: Log ABI before contract creation
        console.log('🔍 Factory ABI before contract creation:', {
          type: typeof METRIC_VAMM_FACTORY_ABI,
          length: METRIC_VAMM_FACTORY_ABI?.length,
          methods: METRIC_VAMM_FACTORY_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name)
        });

        // Check if contract exists on blockchain
        console.log('🔍 Checking if factory contract exists at address:', addresses.DEXV2_FACTORY);
        
        // Create contract instance
        this.contracts.factory = getContract({
          address: addresses.DEXV2_FACTORY as `0x${string}`,
          abi: METRIC_VAMM_FACTORY_ABI,
          client
        });
        
        console.log('✅ Factory contract initialized:', addresses.DEXV2_FACTORY);
        
        // Debug: Log contract instance
        console.log('🔍 Factory contract instance:', {
          hasRead: !!this.contracts.factory.read,
          hasWrite: !!this.contracts.factory.write,
          readMethods: this.contracts.factory.read ? Object.keys(this.contracts.factory.read) : [],
          writeMethods: this.contracts.factory.write ? Object.keys(this.contracts.factory.write) : [],
          abiLength: METRIC_VAMM_FACTORY_ABI?.length,
          abiMethods: METRIC_VAMM_FACTORY_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name)
        });
        
        // Verify critical methods exist in the ABI
        const requiredFactoryMethods = ['getAllVAMMs', 'getVAMMByCategory', 'getVAMMInfo', 'getVAMMByMetric'];
        
        // Work around viem issue where read methods are not properly exposed
        // Instead of checking contract.read, we'll validate the ABI directly
        const abiMethods = METRIC_VAMM_FACTORY_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name) || [];
        const availableMethods = abiMethods;
        
        console.log('🔍 Validating MetricVAMMFactory ABI:', {
          totalItems: METRIC_VAMM_FACTORY_ABI?.length,
          functions: METRIC_VAMM_FACTORY_ABI?.filter((item: any) => item.type === 'function')?.length,
          availableMethods,
          requiredFactoryMethods
        });
        
        // Check for required methods
        const missingMethods = requiredFactoryMethods.filter(method => !availableMethods.includes(method));
        if (missingMethods.length > 0) {
          console.error('❌ Missing required methods in factory contract:', {
            missing: missingMethods,
            available: availableMethods,
            abiMethods: METRIC_VAMM_FACTORY_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name)
          });
          
          // Try to get contract code to see if it exists
          try {
            const code = await this.config.publicClient.getBytecode({ address: addresses.DEXV2_FACTORY as `0x${string}` });
            if (!code || code === '0x') {
              throw new Error(`Factory contract does not exist at address ${addresses.DEXV2_FACTORY}`);
            } else {
              throw new Error(`Factory contract exists but ABI mismatch - contract may have different methods than expected`);
            }
          } catch (codeError) {
            throw new Error(`Factory contract validation failed: ${codeError instanceof Error ? codeError.message : 'Unknown error'}`);
          }
        }
        
        console.log('✅ All required factory methods found in ABI');
        
        // Fallback: If read methods are not available, create manual contract
        if (!this.contracts.factory.read) {
          console.log('⚠️ Factory read methods not available, using fallback approach...');
          this.contracts.factory = this.createReadOnlyContract(addresses.DEXV2_FACTORY, METRIC_VAMM_FACTORY_ABI);
          console.log('✅ Factory contract recreated with read capabilities');
        }
        
      } catch (error) {
        console.error('❌ Failed to initialize factory contract:', error);
        throw new Error(`Failed to initialize factory contract: ${error}`);
      }

      try {
        this.contracts.limitOrderManager = getContract({
          address: addresses.DEXV2_LIMIT_ORDER_MANAGER as `0x${string}`,
          abi: METRIC_LIMIT_ORDER_MANAGER_ABI,
          client
        });
        console.log('✅ Limit Order Manager contract initialized:', addresses.DEXV2_LIMIT_ORDER_MANAGER);
      } catch (error) {
        console.error('❌ Failed to initialize limit order manager contract:', error);
        throw new Error(`Failed to initialize limit order manager contract: ${error}`);
      }

      try {
        this.contracts.registry = getContract({
          address: addresses.DEXV2_METRIC_REGISTRY as `0x${string}`,
          abi: METRIC_REGISTRY_ABI,
          client
        });
        console.log('✅ Registry contract initialized:', addresses.DEXV2_METRIC_REGISTRY);
      } catch (error) {
        console.error('❌ Failed to initialize registry contract:', error);
        throw new Error(`Failed to initialize registry contract: ${error}`);
      }

      try {
        this.contracts.usdc = getContract({
          address: addresses.DEXV2_USDC as `0x${string}`,
          abi: ERC20_ABI,
          client
        });
        console.log('✅ USDC contract initialized:', addresses.DEXV2_USDC);
      } catch (error) {
        console.error('❌ Failed to initialize USDC contract:', error);
        throw new Error(`Failed to initialize USDC contract: ${error}`);
      }

      console.log('✅ All DexV2 contracts initialized successfully');
      
    } catch (error) {
      console.error('💥 Failed to initialize DexV2 contracts:', error);
      throw error; // Re-throw to be caught by the service constructor caller
    }
  }

  /**
   * Manually create write-enabled contract as fallback
   */
  private createWriteEnabledContract(address: string, abi: any): any {
    if (!this.config.walletClient) {
      throw new Error('Wallet client required for write-enabled contract');
    }

    return {
      address: address as `0x${string}`,
      abi,
      read: {
        // Add read methods dynamically
        getPortfolioDashboard: async (args: any[]) => {
          return await this.config.publicClient.readContract({
            address: address as `0x${string}`,
            abi,
            functionName: 'getPortfolioDashboard',
            args
          });
        }
      },
      write: {
        // Add write methods dynamically
        openPosition: async (args: any[], options: any) => {
          return await this.config.walletClient!.writeContract({
            address: address as `0x${string}`,
            abi,
            functionName: 'openPosition',
            args,
            ...options
          });
        },
        closePosition: async (args: any[], options: any) => {
          return await this.config.walletClient!.writeContract({
            address: address as `0x${string}`,
            abi,
            functionName: 'closePosition',
            args,
            ...options
          });
        },
        addToPosition: async (args: any[], options: any) => {
          return await this.config.walletClient!.writeContract({
            address: address as `0x${string}`,
            abi,
            functionName: 'addToPosition',
            args,
            ...options
          });
        }
      }
    };
  }

  /**
   * Create read-only contract instance
   */
  private createReadOnlyContract(address: string, abi: any): any {
    return {
      address: address as `0x${string}`,
      abi,
      read: {
        // Add read methods dynamically based on ABI
        getMetricPositionsByUser: async (args: any[]) => {
          return await this.config.publicClient.readContract({
            address: address as `0x${string}`,
            abi,
            functionName: 'getMetricPositionsByUser',
            args
          });
        },
        getMetricPosition: async (args: any[]) => {
          return await this.config.publicClient.readContract({
            address: address as `0x${string}`,
            abi,
            functionName: 'getMetricPosition',
            args
          });
        },
        getMetricMarkPrice: async (args: any[]) => {
          return await this.config.publicClient.readContract({
            address: address as `0x${string}`,
            abi,
            functionName: 'getMetricMarkPrice',
            args
          });
        },
        // Factory methods
        getAllVAMMs: async (args: any[] = []) => {
          return await this.config.publicClient.readContract({
            address: address as `0x${string}`,
            abi,
            functionName: 'getAllVAMMs',
            args
          });
        },
        getVAMMsByCategory: async (args: any[]) => {
          return await this.config.publicClient.readContract({
            address: address as `0x${string}`,
            abi,
            functionName: 'getVAMMsByCategory',
            args
          });
        },
        getVAMMInfo: async (args: any[]) => {
          return await this.config.publicClient.readContract({
            address: address as `0x${string}`,
            abi,
            functionName: 'getVAMMInfo',
            args
          });
        },
        getVAMMByMetric: async (args: any[]) => {
          return await this.config.publicClient.readContract({
            address: address as `0x${string}`,
            abi,
            functionName: 'getVAMMByMetric',
            args
          });
        }
      }
    };
  }

  // ==========================================
  // 💰 COLLATERAL MANAGEMENT
  // ==========================================

  async depositCollateral(amount: bigint): Promise<TransactionResult> {
    await this.ensureInitialized();
    if (!this.contracts.vault) throw new Error('Vault contract not initialized');
    if (!this.config.walletClient) throw new Error('Wallet client required for writing');
    
    const [account] = await this.config.walletClient.getAddresses();
    const hash = await this.contracts.vault.write.depositCollateral([amount], { account });
    
    // Return a transaction object with wait method
    return {
      success: true,
      hash,
      message: 'Collateral deposit transaction submitted successfully',
      wait: async () => {
        return await this.config.publicClient.waitForTransactionReceipt({ hash });
      }
    };
  }

  async withdrawCollateral(amount: bigint): Promise<TransactionResult> {
    if (!this.contracts.vault) throw new Error('Vault contract not initialized');
    if (!this.config.walletClient) throw new Error('Wallet client required for writing');
    
    const [account] = await this.config.walletClient.getAddresses();
    const hash = await this.contracts.vault.write.withdrawCollateral([amount], { account });
    
    // Return a transaction object with wait method
    return {
      success: true,
      hash,
      message: 'Collateral withdrawal transaction submitted successfully',
      wait: async () => {
        return await this.config.publicClient.waitForTransactionReceipt({ hash });
      }
    };
  }

  async getCollateralBalance(userAddress: string): Promise<bigint> {
    await this.ensureInitialized();
    if (!this.contracts.vault) throw new Error('Vault contract not initialized');
    
    // Work around viem issue where read methods are not properly exposed
    // Check if the method exists in the ABI instead
    const abiMethods = CENTRALIZED_VAULT_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name) || [];
    if (!abiMethods.includes('getAvailableMargin')) {
      console.error('❌ getAvailableMargin method not found in vault ABI');
      console.error('Available methods:', abiMethods);
      throw new Error('getAvailableMargin method not available in vault ABI - this indicates an ABI mismatch');
    }

    try {
      console.log('🔍 Calling getAvailableMargin for user:', userAddress);
      const result = await this.contracts.vault.read.getAvailableMargin([userAddress as `0x${string}`]);
      
      console.log('✅ getAvailableMargin result:', result);
      return result;
    } catch (error) {
      console.error('❌ Error calling getAvailableMargin:', error);
      throw new Error(`Failed to get collateral balance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getUserCollateralData(userAddress: string): Promise<{
    totalCollateral: bigint;
    totalReservedMargin: bigint;
    totalUnrealizedPnL: bigint;
    availableCollateral: bigint;
  }> {
    if (!this.contracts.vault) throw new Error('Vault contract not initialized');
    
    // Work around viem issue where read methods are not properly exposed
    // Check if the method exists in the ABI instead
    const abiMethods = CENTRALIZED_VAULT_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name) || [];
    if (!abiMethods.includes('getMarginAccount')) {
      console.error('❌ getMarginAccount method not found in vault ABI');
      console.error('Available methods:', abiMethods);
      throw new Error('getMarginAccount method not available in vault ABI - this indicates an ABI mismatch');
    }

    try {
      console.log('🔍 Calling getMarginAccount for user:', userAddress);
      const result = await this.contracts.vault.read.getMarginAccount([userAddress as `0x${string}`]);
      
      console.log('✅ getMarginAccount result:', result);
      
      // Handle ABI format that returns a struct
      if (result && typeof result === 'object') {
        return {
          totalCollateral: result.totalCollateral || 0n,
          totalReservedMargin: result.reservedMargin || 0n,
          totalUnrealizedPnL: result.unrealizedPnL || 0n,
          availableCollateral: result.availableCollateral || 0n
        };
      } else {
        console.warn('⚠️ Unexpected result format from getMarginAccount:', result);
        // Return default values
        return {
          totalCollateral: 0n,
          totalReservedMargin: 0n,
          totalUnrealizedPnL: 0n,
          availableCollateral: 0n
        };
      }
    } catch (error) {
      console.error('❌ Error calling getMarginAccount:', error);
      throw new Error(`Failed to get user collateral data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ==========================================
  // 📊 TRADING & POSITION MANAGEMENT
  // ==========================================

  async openPosition(params: OpenPositionParams): Promise<TransactionResult> {
    await this.ensureInitialized();
    if (!this.contracts.router) throw new Error('Router contract not initialized');
    if (!this.config.walletClient) throw new Error('Wallet client required for writing');
    
    // Check if write capabilities are available
    if (!this.hasWriteCapabilities()) {
      const writeStatus = this.getWriteStatus();
      console.error('❌ Write capabilities not available. Status:', writeStatus);
      throw new Error(`Write operations not available. Status: ${JSON.stringify(writeStatus)}`);
    }
    
    // Ensure we have a metricId for the router call
    let metricId = params.metricId;
    if (!metricId && params.vammAddress) {
      // If no metricId provided but vammAddress is, try to get metricId from VAMM
      try {
        const vammMetricId = await this.getVammAddressFromMetricId(params.vammAddress);
        if (vammMetricId) {
          metricId = vammMetricId;
        }
      } catch (error) {
        console.warn('Could not get metricId from VAMM address:', error);
      }
    }
    
    if (!metricId) {
      throw new Error('MetricId is required for router position opening');
    }
    
    console.log('🎯 Opening position via router...', {
      metricId,
      collateralAmount: params.collateralAmount.toString(),
      isLong: params.isLong,
      leverage: params.leverage.toString(),
      targetValue: params.targetValue?.toString() || '0',
      positionType: params.positionType || 0
    });

    try {
      const [account] = await this.config.walletClient.getAddresses();
      
      if (!account) {
        throw new Error('No account found in wallet client. Please ensure wallet is connected.');
      }
      
      console.log('🔍 Using account for transaction:', account);
      
      // Call router with correct 8-parameter signature
      const hash = await this.contracts.router.write.openPosition([
        metricId,                    // bytes32 metricId
        params.collateralAmount,     // uint256 collateralAmount
        params.isLong,               // bool isLong
        params.leverage,             // uint256 leverage
        params.targetValue || 0n,    // uint256 targetValue (0 for market orders)
        params.positionType || 0,    // uint8 positionType (0 = MARKET)
        params.minPrice,             // uint256 minPrice
        params.maxPrice              // uint256 maxPrice
      ], { account });

      console.log('✅ Position opening transaction submitted:', hash);
      
      return {
        success: true,
        hash,
        message: 'Position opening transaction submitted successfully',
        wait: async () => {
          return await this.config.publicClient.waitForTransactionReceipt({ hash });
        }
      };
    } catch (error: any) {
      console.error('❌ Position opening failed:', error);
      
      // Provide helpful error messages for common issues
      if (error.message?.includes('Could not find an Account')) {
        throw new Error('Wallet account not found. Please ensure your wallet is connected and has an active account.');
      } else if (error.message?.includes('No VAMM available for metric')) {
        throw new Error('No VAMM is deployed for this metric. Please try a different metric or wait for VAMM deployment.');
      } else if (error.message?.includes('insufficient funds')) {
        throw new Error('Insufficient funds for position opening. Please check your balance and gas fees.');
      } else if (error.message?.includes('execution reverted')) {
        throw new Error('Transaction reverted. This could be due to insufficient liquidity, price impact, or contract restrictions.');
      }
      
      throw new Error(`Position opening failed: ${error.message || 'Unknown error'}`);
    }
  }

  // Helper method to get VAMM address from metricId
  private async getVammAddressFromMetricId(metricId?: string): Promise<string | null> {
    if (!metricId) return null;
    
    try {
      return await this.getVAMMAddressForMetric(metricId);
    } catch (error) {
      console.error('Failed to get VAMM address from metricId:', error);
      return null;
    }
  }

  async closePosition(
    vammAddress: string,
    positionId: bigint,
    sizeToClose: bigint,
    minPrice: bigint,
    maxPrice: bigint
  ): Promise<TransactionResult> {
    if (!this.contracts.router) throw new Error('Router contract not initialized');
    if (!this.config.walletClient) throw new Error('Wallet client required for writing');
    
    const [account] = await this.config.walletClient.getAddresses();
    const hash = await this.contracts.router.write.closePosition([vammAddress, positionId, sizeToClose, minPrice, maxPrice], { account });
    
    // Return a transaction object with wait method
    return {
      success: true,
      hash,
      message: 'Position closing transaction submitted successfully',
      wait: async () => {
        return await this.config.publicClient.waitForTransactionReceipt({ hash });
      }
    };
  }

  async addToPosition(
    vammAddress: string,
    positionId: bigint,
    additionalCollateral: bigint,
    minPrice: bigint,
    maxPrice: bigint
  ): Promise<TransactionResult> {
    if (!this.contracts.router) throw new Error('Router contract not initialized');
    if (!this.config.walletClient) throw new Error('Wallet client required for writing');
    
    const [account] = await this.config.walletClient.getAddresses();
    const hash = await this.contracts.router.write.addToPosition([
      vammAddress,                // address vammAddress
      positionId,                 // uint256 positionId
      additionalCollateral,       // uint256 additionalCollateral
      minPrice,                   // uint256 minPrice
      maxPrice                    // uint256 maxPrice
    ], { account });
    
    // Return a transaction object with wait method
    return {
      success: true,
      hash,
      message: 'Position addition transaction submitted successfully',
      wait: async () => {
        return await this.config.publicClient.waitForTransactionReceipt({ hash });
      }
    };
  }

  // ==========================================
  // 📊 PORTFOLIO & ANALYTICS
  // ==========================================

  async getPortfolioDashboard(userAddress: string): Promise<PortfolioDashboard> {
    await this.ensureInitialized();
    if (!this.contracts.router) {
      throw new Error('Router contract not initialized');
    }

    // Work around viem issue where read methods are not properly exposed
    // Check if the method exists in the ABI instead
    const abiMethods = METRIC_VAMM_ROUTER_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name) || [];
    if (!abiMethods.includes('getPortfolioDashboard')) {
      console.error('❌ getPortfolioDashboard method not found in router ABI');
      console.error('Available methods:', abiMethods);
      throw new Error('getPortfolioDashboard method not available in router ABI - this indicates an ABI mismatch');
    }

    try {
      console.log('🔍 Calling getPortfolioDashboard for user:', userAddress);
      const result = await this.contracts.router.read.getPortfolioDashboard([userAddress as `0x${string}`]);
      
      console.log('✅ getPortfolioDashboard result:', result);
      
      // Handle new ABI format that returns individual values
      if (Array.isArray(result) && result.length >= 6) {
        const [
          totalCollateral,
          totalReservedMargin,
          totalUnrealizedPnL,
          availableCollateral,
          totalPositions,
          activeMarkets
        ] = result;

        return {
          totalCollateral,
          totalReservedMargin,
          totalUnrealizedPnL,
          availableCollateral,
          totalPositions,
          activeMarkets
        };
      } else {
        console.warn('⚠️ Unexpected result format from getPortfolioDashboard:', result);
        // Return default values
        return {
          totalCollateral: 0n,
          totalReservedMargin: 0n,
          totalUnrealizedPnL: 0n,
          availableCollateral: 0n,
          totalPositions: 0n,
          activeMarkets: 0n
        };
      }
    } catch (error) {
      console.error('❌ Error calling getPortfolioDashboard:', error);
      throw new Error(`Failed to get portfolio dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getUserPositionsAcrossMarkets(userAddress: string): Promise<UserPosition[]> {
    await this.ensureInitialized();
    if (!this.contracts.router) {
      throw new Error('Router contract not initialized');
    }

    // Work around viem issue where read methods are not properly exposed
    // Check if the method exists in the ABI instead
    const abiMethods = METRIC_VAMM_ROUTER_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name) || [];
    if (!abiMethods.includes('getAllUserPositions')) {
      console.error('❌ getAllUserPositions method not found in router ABI');
      console.error('Available methods:', abiMethods);
      throw new Error('getAllUserPositions method not available in router ABI - this indicates an ABI mismatch');
    }

    try {
      console.log('🔍 Calling getAllUserPositions for user:', userAddress);
      const positionIds = await this.contracts.router.read.getAllUserPositions([userAddress as `0x${string}`]);
      
      console.log('✅ getAllUserPositions result:', positionIds);
      
      // Handle simplified ABI format that returns just position IDs
      if (Array.isArray(positionIds)) {
        // For now, return empty array since we only have position IDs
        // In a real implementation, you would need to fetch individual position details
        console.log(`Found ${positionIds.length} positions for user`);
        return [];
      } else {
        console.warn('⚠️ Unexpected result format from getAllUserPositions:', positionIds);
        return [];
      }
    } catch (error) {
      console.error('❌ Error calling getAllUserPositions:', error);
      throw new Error(`Failed to get user positions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getMarketSummary(metricId: string): Promise<MarketSummary> {
    await this.ensureInitialized();
    if (!this.contracts.router) throw new Error('Router contract not initialized');
    
    // Convert string metricId to bytes32
    const metricIdBytes32 = keccak256(stringToBytes(metricId));
    const result = await this.contracts.router.read.getMetricPriceComparison([metricIdBytes32]);
    
    return {
      markPrice: result[1], // currentPrice is at index 1
      totalLongSize: 0n, // Not available in getMetricPriceComparison, set to 0
      totalShortSize: 0n, // Not available in getMetricPriceComparison, set to 0
      netPosition: 0n, // Not available in getMetricPriceComparison, set to 0
      fundingRate: result[2], // fundingRate is at index 2
      isActive: result[0] !== '0x0000000000000000000000000000000000000000' // Check if vammAddress is not zero
    };
  }

  // ==========================================
  // 📋 LIMIT ORDER MANAGEMENT
  // ==========================================

  async createLimitOrder(params: LimitOrderParams): Promise<TransactionResult> {
    if (!this.contracts.limitOrderManager) throw new Error('Limit Order Manager contract not initialized');
    if (!this.config.walletClient) throw new Error('Wallet client required for writing');
    
    const [account] = await this.config.walletClient.getAddresses();
    const hash = await this.contracts.limitOrderManager.write.createOrder([
      params.metricId,
      params.collateralAmount,
      params.isLong,
      params.leverage,
      params.targetValue,
      params.positionType,
      params.triggerPrice,
      params.orderType,
      params.expiry,
      params.maxSlippage,
      params.keeperFee
    ], { account });
    
    // Return a transaction object with wait method
    return {
      success: true,
      hash,
      message: 'Limit order creation transaction submitted successfully',
      wait: async () => {
        return await this.config.publicClient.waitForTransactionReceipt({ hash });
      }
    };
  }

  async cancelLimitOrder(orderHash: string): Promise<TransactionResult> {
    if (!this.contracts.limitOrderManager) throw new Error('Limit Order Manager contract not initialized');
    if (!this.config.walletClient) throw new Error('Wallet client required for writing');
    
    const [account] = await this.config.walletClient.getAddresses();
    const hash = await this.contracts.limitOrderManager.write.cancelLimitOrder([orderHash as `0x${string}`, "User cancelled"], { account });
    
    // Return a transaction object with wait method
    return {
      success: true,
      hash,
      message: 'Limit order cancellation transaction submitted successfully',
      wait: async () => {
        return await this.config.publicClient.waitForTransactionReceipt({ hash });
      }
    };
  }

  async getUserOrders(userAddress: string): Promise<string[]> {
    if (!this.contracts.limitOrderManager) throw new Error('Limit Order Manager contract not initialized');
    return await this.contracts.limitOrderManager.read.getUserOrders([userAddress as `0x${string}`]);
  }

  async getOrderDetails(orderHash: string): Promise<LimitOrder> {
    if (!this.contracts.limitOrderManager) throw new Error('Limit Order Manager contract not initialized');
    const result = await this.contracts.limitOrderManager.read.getOrderDetails([orderHash as `0x${string}`]);
    return {
      orderId: BigInt(orderHash), // Convert hash to bigint for compatibility
      user: result.user,
      metricId: result.metricId,
      collateralAmount: result.collateralAmount,
      isLong: result.isLong,
      leverage: result.leverage,
      targetValue: result.targetValue,
      positionType: result.positionType,
      triggerPrice: result.triggerPrice,
      orderType: result.orderType,
      expiry: result.expiry,
      maxSlippage: result.maxSlippage,
      keeperFee: result.keeperFee,
      status: result.isActive ? 1 : 0, // Convert boolean to number
      createdAt: result.createdAt,
      executedAt: 0n // Not available in the contract
    };
  }

  async getExecutableOrders(maxOrders: bigint = 100n): Promise<string[]> {
    if (!this.contracts.limitOrderManager) throw new Error('Limit Order Manager contract not initialized');
    // Note: getExecutableOrders requires a metricId parameter, using empty bytes32 for all metrics
    return await this.contracts.limitOrderManager.read.getExecutableOrders(['0x0000000000000000000000000000000000000000000000000000000000000000', maxOrders]);
  }

  // ==========================================
  // 🏭 MARKET CREATION & DISCOVERY
  // ==========================================

  async deploySpecializedVAMM(
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
  ): Promise<TransactionResult> {
    if (!this.contracts.factory) throw new Error('Factory contract not initialized');
    if (!this.config.walletClient) throw new Error('Wallet client required for writing');
    
    const [account] = await this.config.walletClient.getAddresses();
    const hash = await this.contracts.factory.write.deploySpecializedVAMM([
      categoryId,
      metricId,
      [vammConfig.maxLeverage, vammConfig.tradingFee, vammConfig.fundingRate, vammConfig.minCollateral, vammConfig.isActive]
    ], { value: deploymentFee, account });
    
    // Return a transaction object with wait method
    return {
      success: true,
      hash,
      message: 'VAMM deployment transaction submitted successfully',
      wait: async () => {
        return await this.config.publicClient.waitForTransactionReceipt({ hash });
      }
    };
  }

  async getAllVAMMs(): Promise<string[]> {
    await this.ensureInitialized();
    if (!this.contracts.factory) throw new Error('Factory contract not initialized');
    
    try {
      console.log('🔍 Calling getAllVAMMs on factory contract...');
      const result = await this.contracts.factory.read.getAllVAMMs();
      console.log('✅ getAllVAMMs result:', result);
      return result;
    } catch (error) {
      console.error('❌ Failed to call getAllVAMMs:', error);
      
      // Check if the issue is with the contract instance
      if (!this.contracts.factory.read) {
        console.log('⚠️ Factory contract read methods not available, attempting to recreate...');
        const addresses = getContractAddresses(this.config.network);
        this.contracts.factory = this.createReadOnlyContract(addresses.DEXV2_FACTORY, METRIC_VAMM_FACTORY_ABI);
        
        // Retry the call
        const retryResult = await this.contracts.factory.read.getAllVAMMs();
        console.log('✅ getAllVAMMs retry result:', retryResult);
        return retryResult;
      }
      
      throw error;
    }
  }

  async getVAMMsByCategory(categoryId: number): Promise<string[]> {
    await this.ensureInitialized();
    if (!this.contracts.factory) throw new Error('Factory contract not initialized');
    return await this.contracts.factory.read.getVAMMsByCategory([categoryId]);
  }

  async getVAMMInfo(vammAddress: string): Promise<{
    metricId: string;
    category: number;
    config: {
      maxLeverage: bigint;
      tradingFee: bigint;
      fundingRate: bigint;
      minCollateral: bigint;
      isActive: boolean;
    };
    deployer: string;
    deployedAt: bigint;
  }> {
    await this.ensureInitialized();
    if (!this.contracts.factory) throw new Error('Factory contract not initialized');
    const result = await this.contracts.factory.read.getVAMMInfo([vammAddress as `0x${string}`]);
    return {
      metricId: result[0],
      category: result[1],
      config: {
        maxLeverage: result[2][0],
        tradingFee: result[2][1],
        fundingRate: result[2][2],
        minCollateral: result[2][3],
        isActive: result[2][4]
      },
      deployer: result[3],
      deployedAt: result[4]
    };
  }

  /**
   * Get VAMM address for a specific metric
   */
  async getVAMMAddressForMetric(metricId: string): Promise<string> {
    await this.ensureInitialized();
    if (!this.contracts.factory) throw new Error('Factory contract not initialized');
    
    // Convert metricId to bytes32 if it's a string
    const metricIdBytes32 = metricId.startsWith('0x') ? metricId : `0x${metricId.padEnd(64, '0')}`;
    
    try {
      const vammAddress = await this.contracts.factory.read.getVAMMByMetric([metricIdBytes32]);
      if (!vammAddress || vammAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error(`No VAMM deployed for metric: ${metricId}`);
      }
      return vammAddress;
    } catch (error) {
      console.error('Failed to get VAMM address for metric:', error);
      throw new Error(`Failed to find VAMM for metric: ${metricId}`);
    }
  }

  // ==========================================
  // 📊 POSITION QUERY METHODS
  // ==========================================

  async getMetricPositionsByUser(userAddress: string, metricId: string): Promise<bigint[]> {
    if (!this.contracts.router) throw new Error('Router contract not initialized');
    
    try {
      // Convert metricId to bytes32 if it's a string
      const metricIdBytes32 = metricId.startsWith('0x') ? metricId : `0x${metricId.padEnd(64, '0')}`;
      
      // Get VAMM address for the metric
      const vammAddress = await this.getVAMMAddressForMetric(metricId);
      
      // Create VAMM contract instance
      const vammContract = this.createReadOnlyContract(vammAddress, METRIC_VAMM_ABI);
      
      // Get position IDs for this user and metric
      const positionIds = await vammContract.read.getMetricPositionsByUser([
        userAddress as `0x${string}`,
        metricIdBytes32
      ]);
      
      return positionIds || [];
    } catch (error) {
      console.error('Failed to get metric positions by user:', error);
      return [];
    }
  }

  async getMetricPosition(positionId: bigint): Promise<any> {
    if (!this.contracts.router) throw new Error('Router contract not initialized');
    
    try {
      // Since we need to find which VAMM has this position, we'll need to iterate through VAMMs
      // For now, we'll use a simplified approach by trying to get the position from the router
      // This is a limitation - in a real implementation, you'd need to track which VAMM has which position
      
      // For now, return null to indicate this method needs enhancement
      console.warn('⚠️ getMetricPosition needs enhancement to find the correct VAMM for position ID');
      return null;
    } catch (error) {
      console.error('Failed to get metric position:', error);
      return null;
    }
  }

  async getMetricMarkPrice(metricId: string): Promise<bigint> {
    if (!this.contracts.router) throw new Error('Router contract not initialized');
    
    try {
      // Convert metricId to bytes32 if it's a string
      const metricIdBytes32 = metricId.startsWith('0x') ? metricId : `0x${metricId.padEnd(64, '0')}`;
      
      // Get VAMM address for the metric
      const vammAddress = await this.getVAMMAddressForMetric(metricId);
      
      // Create VAMM contract instance
      const vammContract = this.createReadOnlyContract(vammAddress, METRIC_VAMM_ABI);
      
      // Get mark price
      const markPrice = await vammContract.read.getMetricMarkPrice([metricIdBytes32]);
      
      return markPrice || 0n;
    } catch (error) {
      console.error('Failed to get metric mark price:', error);
      return 0n;
    }
  }

  // ==========================================
  // 📊 METRIC REGISTRY OPERATIONS
  // ==========================================

  async registerMetric(
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
  ): Promise<TransactionResult> {
    await this.ensureInitialized();
    if (!this.contracts.registry) throw new Error('Registry contract not initialized');
    if (!this.config.walletClient) throw new Error('Wallet client required for writing');
    
    const [account] = await this.config.walletClient.getAddresses();
    const hash = await this.contracts.registry.write.registerMetric([metricId, [
      metricInfo.name,
      metricInfo.description,
      metricInfo.category,
      metricInfo.dataSource,
      metricInfo.updateFrequency,
      metricInfo.settlementPeriod,
      metricInfo.requiresOracle
    ]], { account });
    
    // Return a transaction object with wait method
    return {
      success: true,
      hash,
      message: 'Metric registration transaction submitted successfully',
      wait: async () => {
        return await this.config.publicClient.waitForTransactionReceipt({ hash });
      }
    };
  }

  async isValidMetric(metricId: string): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.contracts.registry) throw new Error('Registry contract not initialized');
    return await this.contracts.registry.read.isMetricActive([metricId]);
  }

  async getMetricInfo(metricId: string): Promise<MetricInfo> {
    await this.ensureInitialized();
    if (!this.contracts.registry) throw new Error('Registry contract not initialized');
    
    // Convert metricId to bytes32 if it's a string
    const metricIdBytes32 = metricId.startsWith('0x') ? metricId : `0x${metricId.padEnd(64, '0')}`;
    
    const result = await this.contracts.registry.read.getMetric([metricIdBytes32]);
    
    // The contract returns: [metricId, name, description, dataSource, calculationMethod, creator, createdAt, settlementPeriodDays, minimumStake, isActive, umaIdentifier]
    return {
      name: result[1] || '',
      description: result[2] || '',
      category: 0, // Not available in contract, using 0 as default
      dataSource: result[3] || '',
      updateFrequency: '', // Not available in contract, using empty string
      settlementPeriod: BigInt(result[7] || 0),
      requiresOracle: true, // Default assumption
      isActive: result[9] || false,
      registeredBy: result[5] || '',
      registeredAt: BigInt(result[6] || 0)
    };
  }

  async getAllActiveMetrics(): Promise<string[]> {
    await this.ensureInitialized();
    if (!this.contracts.registry) throw new Error('Registry contract not initialized');
    const result = await this.contracts.registry.read.getActiveMetrics();
    return result.map((metricId: any) => metricId.toString());
  }

  async getMetricsByCategory(category: number): Promise<string[]> {
    await this.ensureInitialized();
    if (!this.contracts.registry) throw new Error('Registry contract not initialized');
    
    // Since the contract doesn't have getMetricsByCategory, we'll get all active metrics
    // and filter them based on available information
    console.warn('⚠️ getMetricsByCategory not available in contract, returning all active metrics');
    const result = await this.contracts.registry.read.getActiveMetrics();
    return result.map((metricId: any) => metricId.toString());
  }

  // ==========================================
  // 🔧 UTILITY FUNCTIONS
  // ==========================================

  async approveUSDC(spenderAddress: string, amount: bigint): Promise<TransactionResult> {
    if (!this.contracts.usdc) throw new Error('USDC contract not initialized');
    if (!this.config.walletClient) throw new Error('Wallet client required for writing');
    
    const [account] = await this.config.walletClient.getAddresses();
    const hash = await this.contracts.usdc.write.approve([spenderAddress as `0x${string}`, amount], { account });
    
    // Return a transaction object with wait method
    return {
      success: true,
      hash,
      message: 'USDC approval transaction submitted successfully',
      wait: async () => {
        return await this.config.publicClient.waitForTransactionReceipt({ hash });
      }
    };
  }

  async getUSDCBalance(userAddress: string): Promise<bigint> {
    if (!this.contracts.usdc) throw new Error('USDC contract not initialized');
    return await this.contracts.usdc.read.balanceOf([userAddress as `0x${string}`]);
  }

  async getUSDCAllowance(ownerAddress: string, spenderAddress: string): Promise<bigint> {
    if (!this.contracts.usdc) throw new Error('USDC contract not initialized');
    return await this.contracts.usdc.read.allowance([ownerAddress as `0x${string}`, spenderAddress as `0x${string}`]);
  }

  // Update wallet client (when user connects wallet)
  updateWalletClient(walletClient: WalletClient): void {
    this.config.walletClient = walletClient;
    this.initializeContracts().catch(error => {
      console.error('💥 Failed to reinitialize contracts with wallet client:', error);
    });
  }

  /**
   * Update service configuration with wallet client and reinitialize contracts
   */
  updateWithWalletClient(walletClient: any): void {
    console.log('🔄 Updating DexV2 service with wallet client...');
    this.config.walletClient = walletClient;
    
    // Reinitialize contracts with wallet client
    this.initializeContracts().catch(error => {
      console.error('❌ Failed to reinitialize contracts with wallet client:', error);
    });
  }

  // Get contract instances (for advanced usage)
  getContracts() {
    return this.contracts;
  }

  // Check if service is ready
  async isReady(): Promise<boolean> {
    try {
      await this.waitForInitialization();
      return Object.values(this.contracts).every(contract => contract !== undefined);
    } catch (error) {
      console.error('❌ Service not ready due to initialization error:', error);
      return false;
    }
  }

  /**
   * Check if write operations are available (wallet client connected)
   */
  hasWriteCapabilities(): boolean {
    return !!(
      this.config.walletClient &&
      this.contracts.router &&
      this.contracts.router.write
    );
  }

  /**
   * Get write capability status for debugging
   */
  getWriteStatus(): Record<string, boolean> {
    return {
      hasWalletClient: !!this.config.walletClient,
      hasRouterContract: !!this.contracts.router,
      hasRouterWrite: !!(this.contracts.router && this.contracts.router.write),
      hasVaultContract: !!this.contracts.vault,
      hasVaultWrite: !!(this.contracts.vault && this.contracts.vault.write)
    };
  }

  /**
   * Debug method to check contract state and write capabilities
   */
  debugContractState(): void {
    console.log('🔍 DexV2Service Debug Information:');
    console.log('Configuration:', {
      network: this.config.network,
      hasPublicClient: !!this.config.publicClient,
      hasWalletClient: !!this.config.walletClient,
      publicClientChain: this.config.publicClient?.chain?.name,
      walletClientChain: this.config.walletClient?.chain?.name
    });
    
    console.log('Contracts:', {
      router: {
        exists: !!this.contracts.router,
        hasRead: !!(this.contracts.router && this.contracts.router.read),
        hasWrite: !!(this.contracts.router && this.contracts.router.write),
        address: this.contracts.router?.address
      },
      vault: {
        exists: !!this.contracts.vault,
        hasRead: !!(this.contracts.vault && this.contracts.vault.read),
        hasWrite: !!(this.contracts.vault && this.contracts.vault.write)
      }
    });
    
    console.log('Write Status:', this.getWriteStatus());
    // Note: getInitializationStatus is now async, so we can't call it synchronously here
    console.log('Initialization Status: (check async getInitializationStatus() for details)');
  }

  // ==========================================
}

// ==========================================
// 🏗️ FACTORY FUNCTION
// ==========================================

/**
 * Create a new DexV2Service instance
 */
export function createDexV2Service(config: DexV2Config): DexV2Service {
  return new DexV2Service(config);
}

// ==========================================
// 🔧 UTILITY FUNCTIONS
// ==========================================

/**
 * Convert position type number to string
 */
export function getPositionTypeString(positionType: number): string {
  switch (positionType) {
    case 0: return 'SETTLEMENT';
    case 1: return 'PREDICTION';
    case 2: return 'CONTINUOUS';
    default: return 'UNKNOWN';
  }
}

/**
 * Convert order type number to string
 */
export function getOrderTypeString(orderType: number): string {
  switch (orderType) {
    case 0: return 'LIMIT';
    case 1: return 'MARKET_IF_TOUCHED';
    case 2: return 'STOP_LOSS';
    case 3: return 'TAKE_PROFIT';
    default: return 'UNKNOWN';
  }
}

/**
 * Convert order status number to string
 */
export function getOrderStatusString(status: number): string {
  switch (status) {
    case 0: return 'ACTIVE';
    case 1: return 'EXECUTED';
    case 2: return 'CANCELLED';
    case 3: return 'EXPIRED';
    default: return 'UNKNOWN';
  }
}

/**
 * Format BigInt to human readable string with decimals
 */
export function formatTokenAmount(amount: bigint, decimals: number = 18): string {
  const divisor = BigInt(10 ** decimals);
  const wholePart = amount / divisor;
  const fractionalPart = amount % divisor;
  
  if (fractionalPart === 0n) {
    return wholePart.toString();
  }
  
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '');
  
  return trimmedFractional ? `${wholePart}.${trimmedFractional}` : wholePart.toString();
}

/**
 * Parse human readable string to BigInt with decimals
 */
export function parseTokenAmount(amount: string, decimals: number = 18): bigint {
  const [wholePart, fractionalPart = ''] = amount.split('.');
  const paddedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(wholePart) * BigInt(10 ** decimals) + BigInt(paddedFractional);
}

export default DexV2Service;