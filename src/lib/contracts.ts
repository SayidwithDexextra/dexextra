import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from './contractConfig';
import { env } from './env';

// ABI definitions - these should be imported from JSON files generated during compilation
// For now we'll define minimal ABIs needed for the deposit functionality
// Core contract ABIs
const CoreVaultABI = [
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
  // Helper mapping in CoreVault to find OrderBook for market
  "function marketToOrderBook(bytes32) external view returns (address)"
];

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
const OBViewFacetABI = [
  "function getMarketId() external view returns (bytes32)",
  "function getOrderBook() external view returns (tuple(uint256 price, uint256 quantity)[] bids, tuple(uint256 price, uint256 quantity)[] asks)",
  "function getUserOrders(address user) external view returns (uint256[])",
  "function getOrder(uint256 orderId) external view returns (tuple(uint256 orderId, address trader, uint256 price, uint256 amount, bool isBuy, uint256 timestamp, uint256 nextOrderId, uint256 marginRequired, bool isMarginOrder) order)",
  "function getFilledAmount(uint256 orderId) external view returns (uint256)",
  "function getOrderInfo(bytes32 orderId) external view returns (tuple(bytes32 id, bool isBuy, uint256 price, uint256 quantity, uint256 filledAmount, uint256 timestamp, bool active, address user))",
  "function getActiveOrders() external view returns (bytes32[])",
  "function getActiveOrdersCount() external view returns (uint256)",
  "function getOrdersForUser(address user) external view returns (bytes32[])",
  "function getOrderStatusByID(bytes32 orderId) external view returns (bool active, uint256 filledAmount, uint256 price, uint256 remainingQuantity, address user)"
];

// OBPricingFacet - read-only functions for pricing
const OBPricingFacetABI = [
  "function getBestBid() external view returns (uint256)",
  "function getBestAsk() external view returns (uint256)",
  "function getMid() external view returns (uint256)",
  "function getLastTradePrice() external view returns (uint256)",
  "function getPriceInfo() external view returns (uint256 bestBid, uint256 bestAsk, uint256 mid, uint256 lastTrade)",
  "function getMarketPriceData() external view returns (uint256 markPrice, uint256 indexPrice, int256 fundingRate)"
];

// OBOrderPlacementFacet - order placement functions
const OBOrderPlacementFacetABI = [
  "function placeMarketOrder(bool isBuy, uint256 quantity) external returns (bytes32)",
  "function placeLimitOrder(bool isBuy, uint256 price, uint256 quantity) external returns (bytes32)",
  "function batchCancelOrders(bytes32[] calldata orderIds) external",
  "function cancelOrder(bytes32 orderId) external",
  "function cancelAllOrders() external",
  "event OrderPlaced(bytes32 indexed orderId, address indexed user, bool isBuy, uint256 price, uint256 quantity, uint256 timestamp)",
  "event OrderCancelled(bytes32 indexed orderId, address indexed user, uint256 timestamp, uint256 quantity)"
];

// OBSettlementFacet - settlement/expiry functions
const OBSettlementFacetABI = [
  "function settleMarket(uint256 finalPrice) external",
  "function isSettled() external view returns (bool)",
  "function adminCancelAllRestingOrders() external"
];

// OBTradeExecutionFacet - trade execution functions
const OBTradeExecutionFacetABI = [
  "function executeMarketOrder(address user, bool isBuy, uint256 quantity) external returns (uint256)",
  "function executeLimitOrder(address user, bool isBuy, uint256 price, uint256 quantity) external returns (bytes32)",
  "function getUserTradeCount(address user) external view returns (uint256)",
  "function getTradeById(uint256 tradeId) external view returns (tuple(uint256 tradeId, address buyer, address seller, uint256 price, uint256 amount, uint256 timestamp, uint256 buyOrderId, uint256 sellOrderId, bool buyerIsMargin, bool sellerIsMargin, uint256 tradeValue, uint256 buyerFee, uint256 sellerFee) trade)",
  "function getUserTrades(address user, uint256 offset, uint256 limit) external view returns (tuple(uint256 tradeId, address buyer, address seller, uint256 price, uint256 amount, uint256 timestamp, uint256 buyOrderId, uint256 sellOrderId, bool buyerIsMargin, bool sellerIsMargin, uint256 tradeValue, uint256 buyerFee, uint256 sellerFee)[] tradeData, bool hasMore)",
  "event OrderFilled(bytes32 indexed orderId, address indexed user, bool isBuy, uint256 price, uint256 quantity, uint256 timestamp, uint256 fees, address indexed feeRecipient)",
  "event TradeExecuted(bytes32 indexed orderId, address indexed maker, address indexed taker, bool isBuyOrder, uint256 price, uint256 quantity, uint256 timestamp)"
];

// OBLiquidityProvisionFacet - MM/LP specific functions
const OBLiquidityProvisionFacetABI = [
  "function placeBidAskPair(uint256 bidPrice, uint256 askPrice, uint256 quantity) external returns (bytes32, bytes32)",
  "function placeLiquidityOrder(bool isBuy, uint256 price, uint256 quantity) external returns (bytes32)",
  "function updateLiquidityOrder(bytes32 orderId, uint256 newPrice, uint256 newQuantity) external returns (bytes32)",
  "event LiquidityProvided(address indexed user, bytes32 indexed bidOrderId, bytes32 indexed askOrderId, uint256 bidPrice, uint256 askPrice, uint256 quantity, uint256 timestamp)",
  "event LiquidityWithdrawn(address indexed user, bytes32 indexed bidOrderId, bytes32 indexed askOrderId, uint256 timestamp)"
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
}

// Options for contract initialization
export interface ContractInitOptions {
  chainId?: number;
  orderBookAddressOverride?: string;
  providerOrSigner?: ethers.Provider | ethers.Signer;
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
export function initializeContracts(options?: ContractInitOptions): DexContracts {
  try {
    console.log("CONTRACT_ADDRESSES:", {
      CORE_VAULT: CONTRACT_ADDRESSES.CORE_VAULT,
      MOCK_USDC: CONTRACT_ADDRESSES.MOCK_USDC,
      LIQUIDATION_MANAGER: CONTRACT_ADDRESSES.LIQUIDATION_MANAGER,
      orderBook: CONTRACT_ADDRESSES.orderBook
    });
    
    // Use provided signer/provider or fallback to read-only provider
    const fallbackRpc = env.RPC_URL || 'https://testnet-rpc.hyperliquid.xyz/v1';
    const runner = options?.providerOrSigner || new ethers.JsonRpcProvider(fallbackRpc);
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
    console.log("Creating vault contract...");
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
    // Use fallback address if orderBookAddress is null or undefined
    const DEFAULT_ORDER_BOOK_ADDRESS = "0xFC27fc4786BE01510c3564117becD13fdB077bb3";
    const orderBookAddress = options?.orderBookAddressOverride || CONTRACT_ADDRESSES.orderBook || DEFAULT_ORDER_BOOK_ADDRESS;
    
    // Log the address being used to help with debugging
    console.log('Using OrderBook address:', orderBookAddress);
    
    // Ensure we have a valid address before creating contracts
    if (!orderBookAddress || orderBookAddress === '0x' || !ethers.isAddress(orderBookAddress)) {
      console.error('Invalid OrderBook address:', orderBookAddress);
      throw new Error(`Invalid OrderBook address: ${orderBookAddress}`);
    }
    
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
      vault: coreVault // Add vault alias for coreVault
    };
  } catch (error) {
    console.error("Error initializing contracts:", error);
    throw error; // Re-throw to be handled by caller
  }
}

export default initializeContracts;