import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from './contractConfig';

// ABI definitions - these should be imported from JSON files generated during compilation
// For now we'll define minimal ABIs needed for the deposit functionality
// Core contract ABIs
const CoreVaultABI = [
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

// Diamond OrderBook Facet ABIs
const OBViewFacetABI = [
  "function getBestPrices() external view returns (uint256, uint256)",
  "function bestBid() external view returns (uint256)",
  "function bestAsk() external view returns (uint256)",
  "function getActiveOrdersCount() external view returns (uint256, uint256)",
  // Leverage and margin configuration for pre-trade checks
  "function getLeverageInfo() external view returns (bool enabled, uint256 maxLev, uint256 marginReq, address controller)",
  // Orders/views
  "function getUserOrders(address user) external view returns (uint256[])",
  "function getOrder(uint256 orderId) external view returns (uint256,address,uint256,uint256,bool,uint256,uint256,uint256,bool)",
  "function getFilledAmount(uint256 orderId) external view returns (uint256)"
];

const OBPricingFacetABI = [
  "function calculateMarkPrice() external view returns (uint256)",
  "function getOrderBookDepth(uint256 depth) external view returns (tuple(uint256 price, uint256 size)[] memory bids, tuple(uint256 price, uint256 size)[] memory asks)",
  "function getMarketPriceData() external view returns (uint256 markPrice, uint256 indexPrice, int256 fundingRate)"
];

const OBOrderPlacementFacetABI = [
  "function placeMarginLimitOrder(uint256 price, uint256 size, bool isBuy) external returns (uint256)",
  "function placeMarginMarketOrder(uint256 size, bool isBuy) external returns (uint256)",
  "function placeMarginMarketOrderWithSlippage(uint256 size, bool isBuy, uint256 maxSlippageBps) external returns (uint256)",
  "function cancelOrder(uint256 orderId) external"
];

const OBTradeExecutionFacetABI = [
  "function getUserTradeCount(address user) external view returns (uint256)",
  "function getUserTrades(address user, uint256 offset, uint256 limit) external view returns (tuple(uint256 id, uint256 price, uint256 size, bool isBuy, uint256 timestamp)[])",
  "function getTradeStatistics() external view returns (uint256 volume24h, uint256 trades24h, uint256 openInterest)",
  "function getRecentTrades(uint256 limit) external view returns (tuple(uint256 id, uint256 price, uint256 size, bool isBuy, uint256 timestamp)[])",
  "function lastTradePrice() external view returns (uint256)"
];

const MockUSDCABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)"
];

// Export contract addresses in a format compatible with the DepositModal component
export const CONTRACTS = {
  CoreVault: {
    address: CONTRACT_ADDRESSES.CORE_VAULT,
    abi: CoreVaultABI
  },
  MockUSDC: {
    address: CONTRACT_ADDRESSES.MOCK_USDC,
    abi: MockUSDCABI
  },
  AluminumOrderBook: {
    address: CONTRACT_ADDRESSES.ALUMINUM_ORDERBOOK
  }
};

export interface ContractInstances {
  vault: ethers.Contract;
  mockUSDC: ethers.Contract;
  obView: ethers.Contract;
  obPricing: ethers.Contract;
  obOrderPlacement: ethers.Contract;
  obTradeExecution: ethers.Contract;
  orderBookAddress: string;
}

/**
 * Initialize core contract instances
 * @param signer Ethers signer
 * @returns Object containing contract instances
 */
export async function initializeContracts(
  runner: ethers.Signer | ethers.AbstractProvider,
  options?: { orderBookAddressOverride?: string }
): Promise<ContractInstances> {
  // Initialize core contracts
  const vault = new ethers.Contract(
    CONTRACT_ADDRESSES.CORE_VAULT,
    CoreVaultABI,
    runner
  );
  
  const mockUSDC = new ethers.Contract(
    CONTRACT_ADDRESSES.MOCK_USDC,
    MockUSDCABI,
    runner
  );

  // Initialize Diamond OrderBook facets
  const orderBookAddress = options?.orderBookAddressOverride || CONTRACT_ADDRESSES.ALUMINUM_ORDERBOOK;
  
  const obView = new ethers.Contract(
    orderBookAddress,
    OBViewFacetABI,
    runner
  );
  
  const obPricing = new ethers.Contract(
    orderBookAddress,
    OBPricingFacetABI,
    runner
  );
  
  const obOrderPlacement = new ethers.Contract(
    orderBookAddress,
    OBOrderPlacementFacetABI,
    runner
  );
  
  const obTradeExecution = new ethers.Contract(
    orderBookAddress,
    OBTradeExecutionFacetABI,
    runner
  );
  
  return {
    vault,
    mockUSDC,
    obView,
    obPricing,
    obOrderPlacement,
    obTradeExecution,
    orderBookAddress
  };
}

/**
 * Format token amount to human-readable string
 * @param amount BigInt token amount
 * @param decimals Number of decimals
 * @returns Formatted string with 2 decimal places
 */
export function formatTokenAmount(amount: bigint, decimals: number = 6): string {
  return ethers.formatUnits(amount, decimals);
}

/**
 * Parse token amount from string to BigInt
 * @param amount String token amount
 * @param decimals Number of decimals
 * @returns BigInt value
 */
export function parseTokenAmount(amount: string, decimals: number = 6): bigint {
  return ethers.parseUnits(amount, decimals);
}