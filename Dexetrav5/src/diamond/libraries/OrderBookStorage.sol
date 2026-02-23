// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ICoreVault.sol";

library OrderBookStorage {
    bytes32 internal constant STORAGE_SLOT = keccak256("hyperliquid.orderbook.storage.v1");

    struct Order { uint256 orderId; address trader; uint256 price; uint256 amount; bool isBuy; uint256 timestamp; uint256 nextOrderId; uint256 marginRequired; bool isMarginOrder; }
    struct PriceLevel { uint256 totalAmount; uint256 firstOrderId; uint256 lastOrderId; bool exists; }
    struct Trade { uint256 tradeId; address buyer; address seller; uint256 price; uint256 amount; uint256 timestamp; uint256 buyOrderId; uint256 sellOrderId; bool buyerIsMargin; bool sellerIsMargin; uint256 tradeValue; uint256 buyerFee; uint256 sellerFee; }

    // ============ GAS-OPTIMIZED LIQUIDATION STRUCTURES ============
    
    /// @dev Cached position data for O(1) liquidation checks
    struct CachedPosition {
        int256 size;              // Position size (+ long, - short)
        uint256 entryPrice;       // Entry price (6 decimals)
        uint256 marginLocked;     // Margin locked (6 decimals)
        uint256 liquidationPrice; // Pre-computed liquidation price (6 decimals)
        uint256 healthFactor;     // Health factor scaled by 1e18 (lower = more at risk)
        uint256 lastUpdateBlock;  // Block when cache was last updated
        bool isActive;            // Whether position exists
    }
    
    /// @dev Priority queue entry for at-risk users
    struct AtRiskUser {
        address user;
        uint256 healthFactor;     // Lower = more at risk, 0 = liquidatable
        uint256 heapIndex;        // Index in the heap array (for O(log n) updates)
    }

    struct State {
        // Core integration
        ICoreVault vault;
        bytes32 marketId;
        address feeRecipient;
        address leverageController;
        uint256 marginRequirementBps;
        uint256 tradingFee;
        bool leverageEnabled;
        uint256 maxLeverage;
        uint256 maxSlippageBps;
        // Unit-based margin parameters (USDC 6 decimals per 1e18 units)
        uint256 unitMarginLong6;   // e.g., 1_000_000
        uint256 unitMarginShort6;  // e.g., 1_500_000
        // Order book state
        mapping(uint256 => OrderBookStorage.Order) orders;
        mapping(uint256 => OrderBookStorage.PriceLevel) buyLevels;
        mapping(uint256 => OrderBookStorage.PriceLevel) sellLevels;
        mapping(address => uint256[]) userOrders;
        mapping(address => mapping(uint256 => uint256)) userOrderIndex; // user => orderId => index+1 (0 = absent)
        uint256 nextOrderId;
        uint256 bestBid;
        uint256 bestAsk;
        uint256[] buyPrices;
        uint256[] sellPrices;
        mapping(uint256 => bool) buyPriceExists;
        mapping(uint256 => bool) sellPriceExists;
        // Price-level linked-list pointers (descending for buys, ascending for sells)
        mapping(uint256 => uint256) buyPriceNext;
        mapping(uint256 => uint256) buyPricePrev;
        mapping(uint256 => uint256) sellPriceNext;
        mapping(uint256 => uint256) sellPricePrev;
        // Accounting
        mapping(uint256 => uint256) filledAmounts;
        mapping(uint256 => uint256) cumulativeMarginUsed;
        uint256 lastTradePrice;
        uint256 lastMarkPrice;
        bool useVWAPForMarkPrice;
        uint256 vwapTimeWindow;
        uint256 minVolumeForVWAP;
        // Trades
        mapping(uint256 => Trade) trades;
        uint256 nextTradeId;
        uint256 totalTradeCount;
        mapping(address => uint256[]) userTradeIds;
        // User tracking
        address[] allKnownUsers;
        mapping(address => bool) isKnownUser;
        // Liquidation settings and state
        bool liquidationScanOnTrade;
        bool positionCacheUpdatesEnabled;
        bool liquidationDebug;
        uint256 lastLiquidationCheck;
        uint256 lastCheckedIndex;
        // Recursion guards & modes
        bool liquidationInProgress;
        bool liquidationMode;
        bool pendingLiquidationRescan;
        address liquidationTarget;
        bool liquidationClosesShort;
        // Maker rewards tracking
        address[] liquidationMakers;
        uint256[] liquidationMakerNotionalScaled;
        uint256 liquidationTotalNotionalScaled;
        bool liquidationTrackingActive;
        uint256 liquidationRewardedRecipients;
        address liquidationLastRewardRecipient;
        uint256 liquidationScanGasTarget;
        uint256 liquidationScanGasReserve;
        // Execution tracking for liquidation
        uint256 liquidationExecutionTotalVolume;
        uint256 liquidationExecutionTotalValue;
        uint256 liquidationWorstPrice;
        uint256 liquidationExecutionCount;
        // Simple reentrancy guard for external calls from facets
        bool nonReentrantLock;
        // Last 20 trades ring buffer (trade IDs)
        uint256[20] lastTwentyTradeIds;
        uint8 lastTwentyIndex; // next write position
        uint8 lastTwentyCount; // number of valid entries (max 20)
        // Liquidation scanning configuration
        uint256 maxLiquidationChecksPerPoke;   // how many users to scan per poke
        uint256 maxLiquidationsPerPoke;        // cap number of liquidations executed per poke
        
        // ============ GAS-OPTIMIZED LIQUIDATION DATA ============
        
        // 1. Market-specific user tracking (replaces allKnownUsers for THIS market)
        //    O(1) lookup, O(1) add, O(1) remove via swap-and-pop
        address[] marketUsers;                              // Users with positions in THIS market
        mapping(address => uint256) marketUserIndex;        // user => index+1 (0 = not in array)
        uint256 marketUserCount;                            // Active count
        
        // 2. Cached position data - O(1) lookup instead of cross-contract calls
        mapping(address => CachedPosition) positionCache;   // user => cached position
        
        // 3. At-risk user priority queue (min-heap by health factor)
        //    Users with healthFactor < threshold are in this heap
        //    O(log n) insert/remove, O(1) peek at most at-risk
        address[] atRiskHeap;                               // Min-heap of at-risk users
        mapping(address => uint256) atRiskHeapIndex;        // user => heap index+1 (0 = not in heap)
        uint256 atRiskThreshold;                            // Health factor threshold (1e18 = 100%)
        
        // 4. Bitmap for users needing liquidation check (256 users per slot)
        //    Bit is set when position changes, cleared after check
        mapping(uint256 => uint256) dirtyUserBitmap;        // slot => bitmap
        uint256 dirtyUserCount;                             // Count of dirty users
        
        // 5. Direct position index for fast market->user->hasPosition lookup
        mapping(address => bool) hasActivePosition;         // user => has non-zero position
        
        // 6. Last known mark price for delta calculations
        uint256 lastCachedMarkPrice;
        
        // 7. Liquidation price bounds for quick filtering
        uint256 highestLongLiqPrice;                        // Highest liquidation price among longs
        uint256 lowestShortLiqPrice;                        // Lowest liquidation price among shorts
    }

    function state() internal pure returns (State storage s) {
        bytes32 slot = STORAGE_SLOT;
        assembly { s.slot := slot }
    }
}


