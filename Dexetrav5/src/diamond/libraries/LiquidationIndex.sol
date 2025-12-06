// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./OrderBookStorage.sol";

/**
 * @title LiquidationIndex
 * @dev Gas-optimized data structures for liquidation scanning
 * 
 * Key optimizations:
 * 1. Market-specific user set with O(1) operations
 * 2. Position cache to avoid cross-contract calls
 * 3. Min-heap priority queue for at-risk users
 * 4. Bitmap for dirty/needs-check tracking
 * 5. Liquidation price bounds for quick filtering
 */
library LiquidationIndex {
    
    // ============ CONSTANTS ============
    uint256 internal constant HEALTH_FACTOR_PRECISION = 1e18;
    uint256 internal constant AT_RISK_THRESHOLD = 1.5e18;  // 150% health = at risk
    uint256 internal constant LIQUIDATABLE_THRESHOLD = 1e18; // 100% health = liquidatable
    
    // ============ EVENTS ============
    event UserAddedToMarket(address indexed user, uint256 index);
    event UserRemovedFromMarket(address indexed user);
    event PositionCacheUpdated(address indexed user, int256 size, uint256 liquidationPrice, uint256 healthFactor);
    event AtRiskUserAdded(address indexed user, uint256 healthFactor);
    event AtRiskUserRemoved(address indexed user);
    event LiquidationBoundsUpdated(uint256 highestLongLiqPrice, uint256 lowestShortLiqPrice);
    
    // ============ MARKET USER SET OPERATIONS ============
    
    /**
     * @dev Add user to market user set. O(1) operation.
     */
    function addUserToMarket(OrderBookStorage.State storage s, address user) internal {
        if (user == address(0)) return;
        if (s.marketUserIndex[user] != 0) return; // Already in set
        
        s.marketUsers.push(user);
        s.marketUserIndex[user] = s.marketUsers.length; // Store index+1
        s.marketUserCount++;
        s.hasActivePosition[user] = true;
        
        emit UserAddedToMarket(user, s.marketUsers.length - 1);
    }
    
    /**
     * @dev Remove user from market user set using swap-and-pop. O(1) operation.
     */
    function removeUserFromMarket(OrderBookStorage.State storage s, address user) internal {
        if (user == address(0)) return;
        uint256 indexPlusOne = s.marketUserIndex[user];
        if (indexPlusOne == 0) return; // Not in set
        
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = s.marketUsers.length - 1;
        
        if (index != lastIndex) {
            // Swap with last element
            address lastUser = s.marketUsers[lastIndex];
            s.marketUsers[index] = lastUser;
            s.marketUserIndex[lastUser] = indexPlusOne;
        }
        
        s.marketUsers.pop();
        s.marketUserIndex[user] = 0;
        s.marketUserCount--;
        s.hasActivePosition[user] = false;
        
        // Also remove from at-risk heap if present
        removeFromAtRiskHeap(s, user);
        
        // Clear position cache
        delete s.positionCache[user];
        
        emit UserRemovedFromMarket(user);
    }
    
    /**
     * @dev Check if user has position in this market. O(1) operation.
     */
    function hasPosition(OrderBookStorage.State storage s, address user) internal view returns (bool) {
        return s.hasActivePosition[user];
    }
    
    /**
     * @dev Get count of users with positions. O(1) operation.
     */
    function getUserCount(OrderBookStorage.State storage s) internal view returns (uint256) {
        return s.marketUserCount;
    }
    
    // ============ POSITION CACHE OPERATIONS ============
    
    /**
     * @dev Update position cache for a user. Call after any position change.
     * @param user The user address
     * @param size Position size (+ long, - short)
     * @param entryPrice Entry price (6 decimals)
     * @param marginLocked Margin locked (6 decimals)
     * @param markPrice Current mark price for health calculation
     */
    function updatePositionCache(
        OrderBookStorage.State storage s,
        address user,
        int256 size,
        uint256 entryPrice,
        uint256 marginLocked,
        uint256 markPrice
    ) internal {
        if (user == address(0)) return;
        
        OrderBookStorage.CachedPosition storage cache = s.positionCache[user];
        bool fullUpdate = s.positionCacheUpdatesEnabled;
        
        if (size == 0) {
            // Position closed - remove from market
            removeUserFromMarket(s, user);
            return;
        }
        
        // Ensure user is in market set
        if (s.marketUserIndex[user] == 0) {
            addUserToMarket(s, user);
        }
        
        cache.size = size;
        cache.entryPrice = entryPrice;
        cache.marginLocked = marginLocked;
        cache.lastUpdateBlock = block.number;
        cache.isActive = true;
        
        // Compute liquidation price
        cache.liquidationPrice = computeLiquidationPrice(size, entryPrice, marginLocked);
        
        if (fullUpdate) {
            cache.healthFactor = computeHealthFactor(size, entryPrice, marginLocked, markPrice);
            updateAtRiskStatus(s, user, cache.healthFactor);
            updateLiquidationBounds(s, size, cache.liquidationPrice);
            markUserDirty(s, user);
        } else {
            cache.healthFactor = type(uint256).max;
        }
        
        emit PositionCacheUpdated(user, size, cache.liquidationPrice, cache.healthFactor);
    }
    
    /**
     * @dev Get cached position data. O(1) operation - no cross-contract call!
     */
    function getCachedPosition(
        OrderBookStorage.State storage s,
        address user
    ) internal view returns (
        int256 size,
        uint256 entryPrice,
        uint256 marginLocked,
        uint256 liquidationPrice,
        uint256 healthFactor,
        bool isActive
    ) {
        OrderBookStorage.CachedPosition storage cache = s.positionCache[user];
        return (
            cache.size,
            cache.entryPrice,
            cache.marginLocked,
            cache.liquidationPrice,
            cache.healthFactor,
            cache.isActive
        );
    }
    
    /**
     * @dev Check if user is liquidatable based on cached data. O(1) operation!
     */
    function isLiquidatableFromCache(
        OrderBookStorage.State storage s,
        address user,
        uint256 currentMarkPrice
    ) internal view returns (bool) {
        OrderBookStorage.CachedPosition storage cache = s.positionCache[user];
        if (!cache.isActive || cache.size == 0) return false;
        
        uint256 liqPrice = cache.liquidationPrice;
        if (liqPrice == 0) return false;
        
        if (cache.size > 0) {
            // Long: liquidatable if mark <= liqPrice
            return currentMarkPrice <= liqPrice;
        } else {
            // Short: liquidatable if mark >= liqPrice
            return currentMarkPrice >= liqPrice;
        }
    }
    
    /**
     * @dev Batch refresh health factors when mark price changes significantly.
     *      Only updates users whose positions are affected by the price move.
     */
    function refreshHealthFactorsOnPriceChange(
        OrderBookStorage.State storage s,
        uint256 newMarkPrice
    ) internal {
        uint256 oldMark = s.lastCachedMarkPrice;
        if (oldMark == 0) oldMark = newMarkPrice;
        
        // Quick check: if price didn't change much, skip refresh
        uint256 priceDelta = newMarkPrice > oldMark ? newMarkPrice - oldMark : oldMark - newMarkPrice;
        if (priceDelta * 1000 / oldMark < 5) return; // Less than 0.5% change
        
        s.lastCachedMarkPrice = newMarkPrice;
        
        // Only refresh at-risk users (they're the ones that matter)
        uint256 heapSize = s.atRiskHeap.length;
        for (uint256 i = 0; i < heapSize && i < 50; i++) { // Cap at 50 for gas
            address user = s.atRiskHeap[i];
            OrderBookStorage.CachedPosition storage cache = s.positionCache[user];
            if (cache.isActive) {
                cache.healthFactor = computeHealthFactor(
                    cache.size,
                    cache.entryPrice,
                    cache.marginLocked,
                    newMarkPrice
                );
            }
        }
    }
    
    // ============ AT-RISK PRIORITY QUEUE (MIN-HEAP) ============
    
    /**
     * @dev Update user's at-risk status based on health factor.
     */
    function updateAtRiskStatus(
        OrderBookStorage.State storage s,
        address user,
        uint256 healthFactor
    ) internal {
        bool isAtRisk = healthFactor < AT_RISK_THRESHOLD;
        bool inHeap = s.atRiskHeapIndex[user] != 0;
        
        if (isAtRisk && !inHeap) {
            // Add to heap
            insertIntoAtRiskHeap(s, user, healthFactor);
        } else if (!isAtRisk && inHeap) {
            // Remove from heap
            removeFromAtRiskHeap(s, user);
        } else if (isAtRisk && inHeap) {
            // Update position in heap
            updateAtRiskHeapPosition(s, user, healthFactor);
        }
    }
    
    /**
     * @dev Insert user into at-risk min-heap. O(log n) operation.
     */
    function insertIntoAtRiskHeap(
        OrderBookStorage.State storage s,
        address user,
        uint256 healthFactor
    ) internal {
        s.atRiskHeap.push(user);
        uint256 index = s.atRiskHeap.length - 1;
        s.atRiskHeapIndex[user] = index + 1;
        
        // Bubble up
        while (index > 0) {
            uint256 parentIndex = (index - 1) / 2;
            address parentUser = s.atRiskHeap[parentIndex];
            uint256 parentHealth = s.positionCache[parentUser].healthFactor;
            
            if (healthFactor >= parentHealth) break;
            
            // Swap
            s.atRiskHeap[index] = parentUser;
            s.atRiskHeap[parentIndex] = user;
            s.atRiskHeapIndex[parentUser] = index + 1;
            s.atRiskHeapIndex[user] = parentIndex + 1;
            
            index = parentIndex;
        }
        
        emit AtRiskUserAdded(user, healthFactor);
    }
    
    /**
     * @dev Remove user from at-risk min-heap. O(log n) operation.
     */
    function removeFromAtRiskHeap(OrderBookStorage.State storage s, address user) internal {
        uint256 indexPlusOne = s.atRiskHeapIndex[user];
        if (indexPlusOne == 0) return;
        
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = s.atRiskHeap.length - 1;
        
        if (index != lastIndex) {
            address lastUser = s.atRiskHeap[lastIndex];
            s.atRiskHeap[index] = lastUser;
            s.atRiskHeapIndex[lastUser] = index + 1;
            
            // Restore heap property
            heapifyDown(s, index);
        }
        
        s.atRiskHeap.pop();
        s.atRiskHeapIndex[user] = 0;
        
        emit AtRiskUserRemoved(user);
    }
    
    /**
     * @dev Update user's position in heap after health factor change.
     */
    function updateAtRiskHeapPosition(
        OrderBookStorage.State storage s,
        address user,
        uint256 newHealthFactor
    ) internal {
        uint256 indexPlusOne = s.atRiskHeapIndex[user];
        if (indexPlusOne == 0) return;
        
        uint256 index = indexPlusOne - 1;
        
        // Try bubble up first
        while (index > 0) {
            uint256 parentIndex = (index - 1) / 2;
            address parentUser = s.atRiskHeap[parentIndex];
            uint256 parentHealth = s.positionCache[parentUser].healthFactor;
            
            if (newHealthFactor >= parentHealth) break;
            
            // Swap
            s.atRiskHeap[index] = parentUser;
            s.atRiskHeap[parentIndex] = user;
            s.atRiskHeapIndex[parentUser] = index + 1;
            s.atRiskHeapIndex[user] = parentIndex + 1;
            
            index = parentIndex;
        }
        
        // Then try heapify down
        heapifyDown(s, index);
    }
    
    /**
     * @dev Restore heap property by bubbling down.
     */
    function heapifyDown(OrderBookStorage.State storage s, uint256 index) internal {
        uint256 heapSize = s.atRiskHeap.length;
        
        while (true) {
            uint256 smallest = index;
            uint256 left = 2 * index + 1;
            uint256 right = 2 * index + 2;
            
            address currentUser = s.atRiskHeap[index];
            uint256 currentHealth = s.positionCache[currentUser].healthFactor;
            
            if (left < heapSize) {
                address leftUser = s.atRiskHeap[left];
                uint256 leftHealth = s.positionCache[leftUser].healthFactor;
                if (leftHealth < currentHealth) {
                    smallest = left;
                    currentHealth = leftHealth;
                }
            }
            
            if (right < heapSize) {
                address rightUser = s.atRiskHeap[right];
                uint256 rightHealth = s.positionCache[rightUser].healthFactor;
                if (rightHealth < currentHealth) {
                    smallest = right;
                }
            }
            
            if (smallest == index) break;
            
            // Swap
            address smallestUser = s.atRiskHeap[smallest];
            s.atRiskHeap[index] = smallestUser;
            s.atRiskHeap[smallest] = currentUser;
            s.atRiskHeapIndex[smallestUser] = index + 1;
            s.atRiskHeapIndex[currentUser] = smallest + 1;
            
            index = smallest;
        }
    }
    
    /**
     * @dev Get the most at-risk user (lowest health factor). O(1) operation!
     */
    function getMostAtRiskUser(OrderBookStorage.State storage s) internal view returns (address user, uint256 healthFactor) {
        if (s.atRiskHeap.length == 0) return (address(0), type(uint256).max);
        
        user = s.atRiskHeap[0];
        healthFactor = s.positionCache[user].healthFactor;
    }
    
    /**
     * @dev Get count of at-risk users. O(1) operation.
     */
    function getAtRiskCount(OrderBookStorage.State storage s) internal view returns (uint256) {
        return s.atRiskHeap.length;
    }
    
    // ============ DIRTY USER BITMAP ============
    
    /**
     * @dev Mark user as needing liquidation check. O(1) operation.
     */
    function markUserDirty(OrderBookStorage.State storage s, address user) internal {
        uint256 userIndex = s.marketUserIndex[user];
        if (userIndex == 0) return;
        
        uint256 index = userIndex - 1;
        uint256 slot = index / 256;
        uint256 bit = index % 256;
        
        uint256 oldBitmap = s.dirtyUserBitmap[slot];
        uint256 newBitmap = oldBitmap | (1 << bit);
        
        if (newBitmap != oldBitmap) {
            s.dirtyUserBitmap[slot] = newBitmap;
            s.dirtyUserCount++;
        }
    }
    
    /**
     * @dev Clear dirty flag for user. O(1) operation.
     */
    function clearUserDirty(OrderBookStorage.State storage s, address user) internal {
        uint256 userIndex = s.marketUserIndex[user];
        if (userIndex == 0) return;
        
        uint256 index = userIndex - 1;
        uint256 slot = index / 256;
        uint256 bit = index % 256;
        
        uint256 oldBitmap = s.dirtyUserBitmap[slot];
        uint256 newBitmap = oldBitmap & ~(1 << bit);
        
        if (newBitmap != oldBitmap) {
            s.dirtyUserBitmap[slot] = newBitmap;
            if (s.dirtyUserCount > 0) s.dirtyUserCount--;
        }
    }
    
    /**
     * @dev Check if user is dirty. O(1) operation.
     */
    function isUserDirty(OrderBookStorage.State storage s, address user) internal view returns (bool) {
        uint256 userIndex = s.marketUserIndex[user];
        if (userIndex == 0) return false;
        
        uint256 index = userIndex - 1;
        uint256 slot = index / 256;
        uint256 bit = index % 256;
        
        return (s.dirtyUserBitmap[slot] & (1 << bit)) != 0;
    }
    
    // ============ LIQUIDATION BOUNDS ============
    
    /**
     * @dev Update liquidation price bounds for quick filtering.
     */
    function updateLiquidationBounds(
        OrderBookStorage.State storage s,
        int256 size,
        uint256 liquidationPrice
    ) internal {
        if (liquidationPrice == 0) return;
        
        if (size > 0) {
            // Long position
            if (liquidationPrice > s.highestLongLiqPrice) {
                s.highestLongLiqPrice = liquidationPrice;
            }
        } else if (size < 0) {
            // Short position
            if (s.lowestShortLiqPrice == 0 || liquidationPrice < s.lowestShortLiqPrice) {
                s.lowestShortLiqPrice = liquidationPrice;
            }
        }
        
        emit LiquidationBoundsUpdated(s.highestLongLiqPrice, s.lowestShortLiqPrice);
    }
    
    /**
     * @dev Quick check if ANY liquidations might be possible at current price.
     *      O(1) operation - avoids scanning if no positions are at risk.
     */
    function mightHaveLiquidations(
        OrderBookStorage.State storage s,
        uint256 markPrice
    ) internal view returns (bool) {
        // Check if mark price crosses any liquidation bounds
        if (s.highestLongLiqPrice > 0 && markPrice <= s.highestLongLiqPrice) {
            return true;
        }
        if (s.lowestShortLiqPrice > 0 && markPrice >= s.lowestShortLiqPrice) {
            return true;
        }
        return false;
    }
    
    // ============ COMPUTATION HELPERS ============
    
    /**
     * @dev Compute liquidation price for a position.
     * Long:  liqPrice = entryPrice - (margin / absSize) * (1 - MMR)
     * Short: liqPrice = entryPrice + (margin / absSize) * (1 - MMR)
     */
    function computeLiquidationPrice(
        int256 size,
        uint256 entryPrice,
        uint256 marginLocked
    ) internal pure returns (uint256) {
        if (size == 0 || marginLocked == 0) return 0;
        
        uint256 absSize = uint256(size >= 0 ? size : -size);
        
        // marginPerUnit = marginLocked * 1e18 / absSize (result in 6 decimals)
        uint256 marginPerUnit = (marginLocked * 1e18) / absSize;
        
        // MMR buffer (10% = 1000 bps)
        uint256 mmrBuffer = marginPerUnit / 10; // 10% of margin as buffer
        uint256 effectiveMargin = marginPerUnit > mmrBuffer ? marginPerUnit - mmrBuffer : 0;
        
        if (size > 0) {
            // Long: liq price below entry
            return entryPrice > effectiveMargin ? entryPrice - effectiveMargin : 1;
        } else {
            // Short: liq price above entry
            return entryPrice + effectiveMargin;
        }
    }
    
    /**
     * @dev Compute health factor for a position.
     * healthFactor = equity / maintenanceMargin
     * Returns value scaled by 1e18 (1e18 = 100% = liquidatable)
     */
    function computeHealthFactor(
        int256 size,
        uint256 entryPrice,
        uint256 marginLocked,
        uint256 markPrice
    ) internal pure returns (uint256) {
        if (size == 0 || marginLocked == 0 || markPrice == 0) return type(uint256).max;
        
        uint256 absSize = uint256(size >= 0 ? size : -size);
        
        // Compute PnL
        int256 priceDiff = int256(markPrice) - int256(entryPrice);
        int256 pnl = (priceDiff * size) / 1e6; // Adjust for price decimals
        pnl = pnl / 1e12; // Convert to 6 decimals
        
        // Equity = margin + pnl
        int256 equity = int256(marginLocked) + pnl;
        if (equity <= 0) return 0; // Underwater
        
        // Maintenance margin = 10% of notional
        uint256 notional = (absSize * markPrice) / 1e18;
        uint256 maintenanceMargin = notional / 10; // 10% MMR
        if (maintenanceMargin == 0) maintenanceMargin = 1;
        
        // Health factor = equity / maintenance (scaled by 1e18)
        return (uint256(equity) * HEALTH_FACTOR_PRECISION) / maintenanceMargin;
    }
}


