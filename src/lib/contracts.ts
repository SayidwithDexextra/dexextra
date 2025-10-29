import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from './contractConfig';
import { getRunner, getRpcUrl, getChainId } from './network';
import { env } from './env'

// ABI definitions - prefer generated JSON where available, with fallback minimal ABI
import CoreVaultGenerated from '@/lib/abis/CoreVault.json';

// Core contract ABIs (fallback if generated not present)
const CoreVaultFallbackABI = [
  // Events needed for listener management
  "event CollateralDeposited(address indexed user, uint256 amount)",
  "event CollateralWithdrawn(address indexed user, uint256 amount)",
  "event PositionUpdated(address indexed user, bytes32 indexed marketId, int256 oldSize, int256 newSize, uint256 entryPrice, uint256 marginLocked)",
  // Additional events for comprehensive UI refresh
  "event MarginLocked(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLockedAfter)",
  "event MarginReleased(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLockedAfter)",
  "event MarginReserved(address indexed user, bytes32 indexed orderId, bytes32 indexed marketId, uint256 amount)",
  "event MarginUnreserved(address indexed user, bytes32 orderId, uint256 amount)",
  "event LiquidationExecuted(address indexed user, bytes32 indexed marketId, address indexed liquidator, uint256 totalLoss, uint256 remainingCollateral)",
  "event UserLossSocialized(address indexed user, uint256 lossAmount, uint256 remainingCollateral)",
  "event AvailableCollateralConfiscated(address indexed user, uint256 amount, uint256 remainingAvailable)",
  "event HaircutApplied(address indexed user, bytes32 indexed marketId, uint256 debitAmount, uint256 collateralAfter)",
  "event SocializedLossApplied(bytes32 indexed marketId, uint256 lossAmount, address indexed liquidatedUser)",
  // Core functions
  "function depositCollateral(uint256 amount) external",
  "function withdrawCollateral(uint256 amount) external",
  "function userCollateral(address user) external view returns (uint256)",
  "function getUnifiedMarginSummary(address user) external view returns (uint256, uint256, uint256, uint256, int256, int256, uint256, bool)",
  "function getAvailableCollateral(address user) external view returns (uint256)",
  // Margin management on existing positions
  "function topUpPositionMargin(bytes32 marketId, uint256 amount) external",
  "function releaseMargin(address user, bytes32 marketId, uint256 amount) external",
  // Align with InteractiveTrader: marketId first, signed size, 6-decimal entryPrice, marginLocked, etc
  "function getUserPositions(address user) external view returns (tuple(bytes32 marketId, int256 size, uint256 entryPrice, uint256 marginLocked, uint256 socializedLossAccrued6, uint256 haircutUnits18, uint256 liquidationPrice)[])",
  "function getPositionSummary(address user, bytes32 marketId) external view returns (uint256, uint256, uint256, bool)",
  // Returns (liqPrice, hasPosition)
  "function getLiquidationPrice(address user, bytes32 marketId) external view returns (uint256, bool)",
  "function getEffectiveMaintenanceMarginBps(address user, bytes32 marketId) external view returns (uint256)",
  // Liquidation status helpers
  "function isUnderLiquidationPosition(address user, bytes32 marketId) external view returns (bool)",
  // Helper mapping in CoreVault to find OrderBook for market
  "function marketToOrderBook(bytes32) external view returns (address)"
];

export const CoreVaultABI = (CoreVaultGenerated as any)?.abi || (CoreVaultGenerated as any) || CoreVaultFallbackABI;

const LiquidationManagerABI = [
  // Liquidation functions
  "function isAccountLiquidatable(address user) external view returns (bool)",
  "function getLiquidatablePosition(address user) external view returns (bool, bytes32, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256)"
];

// MockUSDC ABI
const MockUSDCABI = [
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address) external view returns (uint256)",
  "function approve(address, uint256) external returns (bool)",
  "function allowance(address, address) external view returns (uint256)",
  "function transfer(address, uint256) external returns (bool)",
  "function transferFrom(address, address, uint256) external returns (bool)",
  // Extra functions for mock
  "function mint(address, uint256) external",
  "function mintForMe(uint256) external",
  "function burn(address, uint256) external"
];

// Order Book ABIs - Diamond facets
// OBViewFacet - read-only functions for market data
export const OBViewFacetABI = [
  "function getMarketId() external view returns (bytes32)",
  "function getOrderBook() external view returns (tuple(uint256 price, uint256 quantity)[] bids, tuple(uint256 price, uint256 quantity)[] asks)",
  "function getUserOrders(address user) external view returns (uint256[])",
  "function getOrder(uint256 orderId) external view returns (tuple(uint256 orderId, address trader, uint256 price, uint256 amount, bool isBuy, uint256 timestamp, uint256 nextOrderId, uint256 marginRequired, bool isMarginOrder) order)",
  "function getFilledAmount(uint256 orderId) external view returns (uint256)",
  "function getOrderInfo(bytes32 orderId) external view returns (tuple(bytes32 id, bool isBuy, uint256 price, uint256 quantity, uint256 filledAmount, uint256 timestamp, bool active, address user))",
  "function getActiveOrders() external view returns (bytes32[])",
  "function getActiveOrdersCount() external view returns (uint256)",
  "function getOrdersForUser(address user) external view returns (bytes32[])",
  "function getOrderStatusByID(bytes32 orderId) external view returns (bool active, uint256 filledAmount, uint256 price, uint256 remainingQuantity, address user)",
  // Compatibility getters present on some view facet builds
  "function bestBid() external view returns (uint256)",
  "function bestAsk() external view returns (uint256)"
];

// OBPricingFacet - read-only functions for pricing (aligned with deployed facet)
export const OBPricingFacetABI = [
  "function getBestPrices() external view returns (uint256 bidPrice, uint256 askPrice)",
  "function getOrderBookDepth(uint256 levels) external view returns (uint256[] bidPrices, uint256[] bidAmounts, uint256[] askPrices, uint256[] askAmounts)",
  "function getOrderBookDepthFromPointers(uint256 levels) external view returns (uint256[] bidPrices, uint256[] bidAmounts, uint256[] askPrices, uint256[] askAmounts)",
  "function getSpread() external view returns (uint256)",
  "function calculateMarkPrice() external view returns (uint256)",
  "function getMarketPriceData() external view returns (uint256 midPrice, uint256 bestBidPrice, uint256 bestAskPrice, uint256 lastTradePriceReturn, uint256 markPrice, uint256 spread, uint256 spreadBps, bool isValid)",
  // Some deployments expose these on pricing facet
  "function bestBid() external view returns (uint256)",
  "function bestAsk() external view returns (uint256)"
];

// OBOrderPlacementFacet - order placement functions (aligned with Solidity facet)
export const OBOrderPlacementFacetABI = [
  "function placeLimitOrder(uint256 price, uint256 amount, bool isBuy) external returns (uint256)",
  "function placeMarginLimitOrder(uint256 price, uint256 amount, bool isBuy) external returns (uint256)",
  "function placeMarketOrder(uint256 amount, bool isBuy) external returns (uint256)",
  "function placeMarginMarketOrder(uint256 amount, bool isBuy) external returns (uint256)",
  "function placeMarketOrderWithSlippage(uint256 amount, bool isBuy, uint256 slippageBps) external returns (uint256)",
  "function placeMarginMarketOrderWithSlippage(uint256 amount, bool isBuy, uint256 slippageBps) external returns (uint256)",
  "function cancelOrder(uint256 orderId) external",
  "event OrderPlaced(uint256 indexed orderId, address indexed trader, uint256 price, uint256 amount, bool isBuy, bool isMarginOrder)",
  "event OrderCancelled(uint256 indexed orderId, address indexed trader)",
  "event OrderModified(uint256 indexed oldOrderId, uint256 indexed newOrderId, address indexed trader, uint256 newPrice, uint256 newAmount)"
];

// OBSettlementFacet - settlement/expiry functions
export const OBSettlementFacetABI = [
  "function settleMarket(uint256 finalPrice) external",
  "function isSettled() external view returns (bool)",
  "function adminCancelAllRestingOrders() external"
];

// OBTradeExecutionFacet - trade execution functions
export const OBTradeExecutionFacetABI = [
  "function executeMarketOrder(address user, bool isBuy, uint256 quantity) external returns (uint256)",
  "function executeLimitOrder(address user, bool isBuy, uint256 price, uint256 quantity) external returns (bytes32)",
  "function getUserTradeCount(address user) external view returns (uint256)",
  "function getTradeById(uint256 tradeId) external view returns (tuple(uint256 tradeId, address buyer, address seller, uint256 price, uint256 amount, uint256 timestamp, uint256 buyOrderId, uint256 sellOrderId, bool buyerIsMargin, bool sellerIsMargin, uint256 tradeValue, uint256 buyerFee, uint256 sellerFee) trade)",
  "function getUserTrades(address user, uint256 offset, uint256 limit) external view returns (tuple(uint256 tradeId, address buyer, address seller, uint256 price, uint256 amount, uint256 timestamp, uint256 buyOrderId, uint256 sellOrderId, bool buyerIsMargin, bool sellerIsMargin, uint256 tradeValue, uint256 buyerFee, uint256 sellerFee)[] tradeData, bool hasMore)",
  "event OrderFilled(bytes32 indexed orderId, address indexed user, bool isBuy, uint256 price, uint256 quantity, uint256 timestamp, uint256 fees, address indexed feeRecipient)",
  "event TradeExecuted(bytes32 indexed orderId, address indexed maker, address indexed taker, bool isBuyOrder, uint256 price, uint256 quantity, uint256 timestamp)"
];

// Minimal ABIs/addresses used by webhook processing and lightweight client reads
// Expose a centralized CONTRACTS object for consumers that need abi+address pairs
export const CONTRACTS = {
  MockUSDC: {
    address: CONTRACT_ADDRESSES.MOCK_USDC,
    abi: MockUSDCABI,
  },
  CentralVault: {
    address: CONTRACT_ADDRESSES.CORE_VAULT,
    abi: CoreVaultABI,
  },
  MetricsMarketFactory: {
    address: (env as any).METRICS_MARKET_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000',
    // Minimal ABI containing only the MarketCreated event needed by webhook parsing
    abi: [
      {
        type: 'event',
        name: 'MarketCreated',
        inputs: [
          { indexed: true, name: 'marketId', type: 'bytes32' },
          { indexed: false, name: 'symbol', type: 'string' },
          { indexed: false, name: 'vamm', type: 'address' },
          { indexed: false, name: 'vault', type: 'address' },
          { indexed: false, name: 'oracle', type: 'address' },
          { indexed: false, name: 'startingPrice', type: 'uint256' },
          { indexed: false, name: 'marketType', type: 'uint8' },
        ],
      },
    ] as const,
  },
} as const

// OBLiquidityProvisionFacet - MM/LP specific functions
export const OBLiquidityProvisionFacetABI = [
  "function placeBidAskPair(uint256 bidPrice, uint256 askPrice, uint256 quantity) external returns (bytes32, bytes32)",
  "function placeLiquidityOrder(bool isBuy, uint256 price, uint256 quantity) external returns (bytes32)",
  "function updateLiquidityOrder(bytes32 orderId, uint256 newPrice, uint256 newQuantity) external returns (bytes32)",
  "event LiquidityProvided(address indexed user, bytes32 indexed bidOrderId, bytes32 indexed askOrderId, uint256 bidPrice, uint256 askPrice, uint256 quantity, uint256 timestamp)",
  "event LiquidityWithdrawn(address indexed user, bytes32 indexed bidOrderId, bytes32 indexed askOrderId, uint256 timestamp)"
];

// Admin facet - owner-controlled configuration
export const OBAdminFacetABI = [
  "function updateTradingParameters(uint256 _marginRequirementBps, uint256 _tradingFee, address _feeRecipient) external",
  "function enableLeverage(uint256 _maxLeverage, uint256 _marginRequirementBps) external",
  "function disableLeverage() external",
  "function setMarginRequirement(uint256 _marginRequirementBps) external",
  "function setLeverageController(address _newController) external",
  "function updateMaxSlippage(uint256 _maxSlippageBps) external"
];

// Liquidation facet - operational controls and entrypoint
export const OBLiquidationFacetABI = [
  "function setConfigLiquidationScanOnTrade(bool enable) external",
  "function setConfigLiquidationDebug(bool enable) external",
  "function pokeLiquidations() external"
];

// OrderBook system V1 and V2 interfaces
export interface DexContracts {
  coreVault: ethers.Contract;
  liquidationManager: ethers.Contract;
  mockUSDC: ethers.Contract;
  obView: ethers.Contract;
  obPricing: ethers.Contract;
  obOrderPlacement: ethers.Contract;
  obTradeExecution: ethers.Contract;
  obLiquidityProvision: ethers.Contract;
  obSettlement: ethers.Contract;
  vault: ethers.Contract; // Alias for coreVault for compatibility
  isPlaceholderMode?: boolean; // Indicates if using placeholder contracts for UI
}

// Options for contract initialization
export interface ContractInitOptions {
  chainId?: number;
  orderBookAddressOverride?: string;
  providerOrSigner?: ethers.Provider | ethers.Signer;
  // New options for market-specific resolution
  marketIdentifier?: string;
  marketSymbol?: string;
  network?: string;
  // Stronger mapping: prefer bytes32 marketId for CoreVault lookup if provided
  marketIdBytes32?: string;
}

// Format a token amount from BigInt to decimal string
export function formatTokenAmount(amount: string | number | bigint): string {
  try {
    // Ensure amount is BigInt
    const amountBigInt = BigInt(amount.toString());
    // Format with 6 decimals (USDC standard)
    return ethers.formatUnits(amountBigInt, 6);
  } catch (e) {
    console.error('Error formatting token amount:', e);
    return '0';
  }
}

// Parse a decimal amount string to BigInt with 6 decimals
export function parseTokenAmount(amount: string): bigint {
  try {
    // Parse with 6 decimals (USDC standard)
    return ethers.parseUnits(amount, 6);
  } catch (e) {
    console.error('Error parsing token amount:', e);
    return 0n;
  }
}

// Initialize contract instances with provider or signer
export async function initializeContracts(options?: ContractInitOptions): Promise<DexContracts> {
  try {
    console.log("CONTRACT_ADDRESSES:", {
      CORE_VAULT: CONTRACT_ADDRESSES.CORE_VAULT,
      MOCK_USDC: CONTRACT_ADDRESSES.MOCK_USDC,
      LIQUIDATION_MANAGER: CONTRACT_ADDRESSES.LIQUIDATION_MANAGER,
      // No global orderBook - each market has its own OrderBook contract
    });
    
    // Use provided signer/provider or unified network runner
    const runner = options?.providerOrSigner || (new ethers.JsonRpcProvider(getRpcUrl(), getChainId()) as ethers.Provider);
    console.log("Using provider:", runner.constructor.name);
    
    if (!CONTRACT_ADDRESSES.CORE_VAULT || !ethers.isAddress(CONTRACT_ADDRESSES.CORE_VAULT)) {
      throw new Error(`Invalid CORE_VAULT address: ${CONTRACT_ADDRESSES.CORE_VAULT}`);
    }
    
    if (!CONTRACT_ADDRESSES.MOCK_USDC || !ethers.isAddress(CONTRACT_ADDRESSES.MOCK_USDC)) {
      throw new Error(`Invalid MOCK_USDC address: ${CONTRACT_ADDRESSES.MOCK_USDC}`);
    }
    
    if (!CONTRACT_ADDRESSES.LIQUIDATION_MANAGER || !ethers.isAddress(CONTRACT_ADDRESSES.LIQUIDATION_MANAGER)) {
      throw new Error(`Invalid LIQUIDATION_MANAGER address: ${CONTRACT_ADDRESSES.LIQUIDATION_MANAGER}`);
    }
    
    // Initialize core contracts
    console.log("Creating vault contract with address:", CONTRACT_ADDRESSES.CORE_VAULT, "(from .env.local)");
    const coreVault = new ethers.Contract(
      CONTRACT_ADDRESSES.CORE_VAULT,
      CoreVaultABI,
      runner
    );
    
    console.log("Creating liquidation manager contract...");
    const liquidationManager = new ethers.Contract(
      CONTRACT_ADDRESSES.LIQUIDATION_MANAGER,
      LiquidationManagerABI,
      runner
    );
    
    console.log("Creating mockUSDC contract...");
    const mockUSDC = new ethers.Contract(
      CONTRACT_ADDRESSES.MOCK_USDC,
      MockUSDCABI,
      runner
    );

    // Initialize Diamond OrderBook facets
    // Strictly use the provided market-specific orderBook address
    // No fallbacks to prevent cross-market contamination
    let orderBookAddress = options?.orderBookAddressOverride;
    
    // If no override provided but market identifiers are available, try to find the specific market
    if (!orderBookAddress && (options?.marketIdentifier || options?.marketSymbol)) {
      try {
        const entries = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {}) as any[];
        const currentChainId = getChainId();
        
        // Find market by identifier or symbol on current chain only
        const marketMatch = entries.find((m: any) => {
          // First check chain ID to prevent cross-chain contamination
          if (m?.chainId !== currentChainId) return false;
          
          // Then check identifiers
          const matchesIdentifier = options?.marketIdentifier && 
            (m?.marketIdentifier?.toLowerCase() === options.marketIdentifier.toLowerCase());
          const matchesSymbol = options?.marketSymbol && 
            (m?.symbol?.toLowerCase() === options.marketSymbol.toLowerCase());
            
          return matchesIdentifier || matchesSymbol;
        });
        
        if (marketMatch?.orderBook) {
          orderBookAddress = marketMatch.orderBook;
          console.log(`Using market-specific OrderBook for ${options?.marketIdentifier || options?.marketSymbol} on chain ${currentChainId}:`, orderBookAddress);
        } else {
          console.warn(`No market found for ${options?.marketIdentifier || options?.marketSymbol} on chain ${currentChainId}`);
        }
      } catch (e) {
        console.error('Error finding market-specific OrderBook:', e);
      }
    }
    
    // For market-specific contexts, we require a specific OrderBook address
    // For general contexts (like home page), we can use a dummy/placeholder contract
    const isMarketSpecificContext = options?.marketIdentifier || options?.marketSymbol;
    
    if (!orderBookAddress) {
      if (isMarketSpecificContext) {
        // In market-specific context, fail if no address is found
        throw new Error('No OrderBook address provided and no matching market found on current chain');
      } else {
        // For general contexts (like home page), use a placeholder address
        // This allows the home page to initialize without errors
        console.log('No specific market context - using placeholder contract for UI initialization only');
        orderBookAddress = "0x0000000000000000000000000000000000000001";
      }
    }
    
    // Validate chain ID if specified in options to prevent cross-chain contamination
    if (options?.chainId && options.chainId !== getChainId()) {
      throw new Error(`Chain ID mismatch: market is on chain ${options.chainId}, but current network is ${getChainId()}`);
    }
    
    // Log the address being used to help with debugging
    console.log('Using OrderBook address:', orderBookAddress);
    
    // Ensure we have a valid address before creating contracts
    if (!orderBookAddress || orderBookAddress === '0x' || !ethers.isAddress(orderBookAddress)) {
      console.error('Invalid OrderBook address:', orderBookAddress);
      throw new Error(`Invalid OrderBook address: ${orderBookAddress}`);
    }
    
    // Cross-check against CoreVault mapping if a bytes32 marketId is provided
    try {
      const idHex = options?.marketIdBytes32;
      const looksBytes32 = typeof idHex === 'string' && idHex.startsWith('0x') && idHex.length === 66;
      if (looksBytes32 && (coreVault as any)?.marketToOrderBook) {
        const mapped = await (coreVault as any).marketToOrderBook(idHex);
        if (mapped && typeof mapped === 'string' && mapped.startsWith('0x') && mapped.length === 42) {
          if (mapped.toLowerCase() !== orderBookAddress.toLowerCase()) {
            console.warn('[initializeContracts] CoreVault mapping differs from provided OrderBook address; using mapped address', {
              provided: orderBookAddress,
              mapped
            });
            orderBookAddress = mapped;
          }
        }
      }
    } catch (mapErr) {
      console.warn('[initializeContracts] Warning: CoreVault marketToOrderBook mapping check failed', mapErr);
    }
    
    // Check if we're using the placeholder address for non-market-specific contexts
    const isPlaceholderAddress = orderBookAddress === "0x0000000000000000000000000000000000000001";
    
    console.log("Creating OrderBook view facet...");
    const obView = new ethers.Contract(
      orderBookAddress,
      OBViewFacetABI,
      runner
    );
    
    console.log("Creating OrderBook pricing facet...");
    const obPricing = new ethers.Contract(
      orderBookAddress,
      OBPricingFacetABI,
      runner
    );
    
    console.log("Creating OrderBook order placement facet...");
    const obOrderPlacement = new ethers.Contract(
      orderBookAddress,
      OBOrderPlacementFacetABI,
      runner
    );
    
    console.log("Creating OrderBook trade execution facet...");
    const obTradeExecution = new ethers.Contract(
      orderBookAddress,
      OBTradeExecutionFacetABI,
      runner
    );
    
    console.log("Creating OrderBook liquidity provision facet...");
    const obLiquidityProvision = new ethers.Contract(
      orderBookAddress,
      OBLiquidityProvisionFacetABI,
      runner
    );

    console.log("Creating OrderBook settlement facet...");
    const obSettlement = new ethers.Contract(
      orderBookAddress,
      OBSettlementFacetABI,
      runner
    );

    console.log("All contracts initialized successfully");
    
    // For placeholder addresses, wrap contract methods in try/catch to prevent errors
    if (isPlaceholderAddress) {
      console.log("Using placeholder contracts - all methods will be no-ops");
      
      // Create proxy wrappers that catch all errors for placeholder contracts
      const createSafeProxy = (contract: any) => {
        return new Proxy(contract, {
          get(target, prop) {
            const original = target[prop];
            if (typeof original === 'function') {
              return async (...args: any[]) => {
                try {
                  return await original.apply(target, args);
                } catch (e) {
                  console.log(`Placeholder contract method ${String(prop)} called - ignoring error`);
                  return null;
                }
              };
            }
            return original;
          }
        });
      };
      
      return {
        coreVault,
        liquidationManager,
        mockUSDC,
        obView: createSafeProxy(obView),
        obPricing: createSafeProxy(obPricing),
        obOrderPlacement: createSafeProxy(obOrderPlacement),
        obTradeExecution: createSafeProxy(obTradeExecution),
        obLiquidityProvision: createSafeProxy(obLiquidityProvision),
        obSettlement: createSafeProxy(obSettlement),
        vault: coreVault, // Alias for compatibility
        isPlaceholderMode: true
      };
    }
    
    return {
      coreVault,
      liquidationManager,
      mockUSDC,
      obView,
      obPricing,
      obOrderPlacement,
      obTradeExecution,
      obLiquidityProvision,
      obSettlement,
      vault: coreVault, // Alias for compatibility
      isPlaceholderMode: false
    };
  } catch (error) {
    console.error("Error initializing contracts:", error);
    throw error; // Re-throw to be handled by caller
  }
}

export default initializeContracts;