// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PositionManager
 * @dev Position management library - ALL position logic extracted from CentralizedVault
 * @notice Major bytecode reduction by moving position operations to library
 */
library PositionManager {
    
    // ============ Constants ============
    uint256 public constant TICK_PRECISION = 1e6;
    uint256 public constant DECIMAL_SCALE = 1e12;
    
    // ============ Events ============
    event PositionUpdated(address indexed user, bytes32 indexed marketId, int256 oldSize, int256 newSize, uint256 oldPrice, uint256 newPrice);
    event MarginAdjusted(address indexed user, bytes32 indexed marketId, uint256 oldMargin, uint256 newMargin, string reason);
    event PositionNettingExecuted(address indexed user, bytes32 indexed marketId, int256 sizeDelta, uint256 executionPrice, int256 realizedPnL);

    // ============ Structs ============
    struct Position {
        bytes32 marketId;
        int256 size;
        uint256 entryPrice;
        uint256 marginLocked;
        uint256 socializedLossAccrued6; // USDC (6 decimals) haircut accrued against this position's payout
        uint256 haircutUnits18; // Units (18 decimals) tagged at socialization time
        uint256 liquidationPrice; // Fixed trigger price (6 decimals)
    }

    struct NettingResult {
        bool positionExists;
        int256 oldSize;
        int256 newSize;
        uint256 oldEntryPrice;
        uint256 newEntryPrice;
        uint256 oldMargin;
        uint256 newMargin;
        int256 realizedPnL;
        uint256 marginToRelease;
        uint256 marginToLock;
        bool positionClosed;
        uint256 haircutToConfiscate6; // Portion of position-level haircut realized by this trade (USDC 6d)
    }

    /**
     * @dev Execute position netting with detailed calculations (legacy - O(N) lookup)
     */
    function executePositionNetting(
        Position[] storage positions,
        address /*user*/,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 executionPrice,
        uint256 requiredMargin
    ) external returns (NettingResult memory result) {
        // Find existing position (O(N) - legacy compatibility)
        uint256 positionIdx;
        bool found = false;
        
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                positionIdx = i;
                found = true;
                break;
            }
        }
        
        result.positionExists = found;
        
        if (found) {
            Position storage position = positions[positionIdx];
            result.oldSize = position.size;
            result.oldEntryPrice = position.entryPrice;
            result.oldMargin = position.marginLocked;
            uint256 oldHaircut6 = position.socializedLossAccrued6;
            uint256 oldHaircutUnits18 = position.haircutUnits18;
            
            result.newSize = position.size + sizeDelta;

            if ((position.size > 0 && sizeDelta < 0) || (position.size < 0 && sizeDelta > 0)) {
                uint256 absDelta = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta);
                uint256 posAbs = uint256(position.size > 0 ? position.size : -position.size);
                uint256 closedAbs = absDelta > posAbs ? posAbs : absDelta;
                int256 closingSizeSigned = position.size > 0 ? int256(closedAbs) : -int256(closedAbs);
                int256 priceDiff = int256(executionPrice) - int256(position.entryPrice);
                result.realizedPnL = (priceDiff * closingSizeSigned) / int256(TICK_PRECISION);
            }

            if (result.newSize == 0) {
                result.newEntryPrice = 0;
                result.positionClosed = true;
                result.marginToRelease = position.marginLocked;
                result.haircutToConfiscate6 = oldHaircut6;
                
                if (positionIdx < positions.length - 1) {
                    positions[positionIdx] = positions[positions.length - 1];
                }
                positions.pop();
                
            } else {
                bool sameDirection = (position.size > 0 && sizeDelta > 0) || (position.size < 0 && sizeDelta < 0);

                if (sameDirection) {
                    unchecked {
                        uint256 existingSize = uint256(position.size >= 0 ? position.size : -position.size);
                        uint256 newSize = uint256(sizeDelta >= 0 ? sizeDelta : -sizeDelta);
                        uint256 wholeExistingSize = existingSize / 1e18;
                        uint256 wholeNewSize = newSize / 1e18;
                        if (wholeExistingSize == 0) wholeExistingSize = 1;
                        if (wholeNewSize == 0) wholeNewSize = 1;
                        uint256 existingNotional = wholeExistingSize * position.entryPrice;
                        uint256 newNotional = wholeNewSize * executionPrice;
                        uint256 totalNotional = existingNotional + newNotional;
                        uint256 totalSize = wholeExistingSize + wholeNewSize;
                        result.newEntryPrice = totalSize > 0 ? (totalNotional / totalSize) : position.entryPrice;
                    }
                } else {
                    uint256 absDelta = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta);
                    uint256 posAbs = uint256(position.size > 0 ? position.size : -position.size);
                    if (absDelta < posAbs) {
                        result.newEntryPrice = position.entryPrice;
                        uint256 unitsToRelease18 = oldHaircutUnits18 == 0 ? 0 : (absDelta > oldHaircutUnits18 ? oldHaircutUnits18 : absDelta);
                        uint256 haircutClosed6 = (oldHaircut6 == 0 || oldHaircutUnits18 == 0) ? 0 : (oldHaircut6 * unitsToRelease18) / oldHaircutUnits18;
                        if (haircutClosed6 > 0) {
                            if (haircutClosed6 > position.socializedLossAccrued6) {
                                haircutClosed6 = position.socializedLossAccrued6;
                            }
                            position.socializedLossAccrued6 = position.socializedLossAccrued6 - haircutClosed6;
                            if (unitsToRelease18 > 0) {
                                position.haircutUnits18 = position.haircutUnits18 - unitsToRelease18;
                            }
                            result.haircutToConfiscate6 = haircutClosed6;
                        }
                    } else {
                        result.newEntryPrice = executionPrice;
                        result.haircutToConfiscate6 = oldHaircut6;
                    }
                }
                
                position.size = result.newSize;
                position.entryPrice = result.newEntryPrice;
                
                uint256 oldMarginLocal = position.marginLocked;
                if (requiredMargin > oldMarginLocal) {
                    result.marginToLock = requiredMargin - oldMarginLocal;
                    result.marginToRelease = 0;
                    position.marginLocked = requiredMargin;
                    result.newMargin = requiredMargin;
                } else if (requiredMargin < oldMarginLocal) {
                    result.marginToLock = 0;
                    result.marginToRelease = oldMarginLocal - requiredMargin;
                    position.marginLocked = requiredMargin;
                    result.newMargin = requiredMargin;
                } else {
                    result.marginToLock = 0;
                    result.marginToRelease = 0;
                    result.newMargin = oldMarginLocal;
                }
            }
            
        } else {
            result.newSize = sizeDelta;
            result.newEntryPrice = executionPrice;
            result.newMargin = requiredMargin;
            result.marginToLock = requiredMargin;
            
            positions.push(Position({
                marketId: marketId,
                size: sizeDelta,
                entryPrice: executionPrice,
                marginLocked: requiredMargin,
                socializedLossAccrued6: 0,
                haircutUnits18: 0,
                liquidationPrice: 0
            }));
        }
    }
    
    /**
     * @dev Execute position netting with O(1) index lookup (falls back to O(N) if index not set)
     */
    function executePositionNettingWithIndex(
        Position[] storage positions,
        mapping(bytes32 => uint256) storage positionIndex,
        address /*user*/,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 executionPrice,
        uint256 requiredMargin
    ) external returns (NettingResult memory result) {
        // O(1) position lookup
        uint256 indexPlusOne = positionIndex[marketId];
        bool found = indexPlusOne != 0;
        uint256 positionIdx = found ? indexPlusOne - 1 : 0;
        
        // Fallback: if index not set, do O(N) search for legacy positions
        if (!found) {
            for (uint256 i = 0; i < positions.length; i++) {
                if (positions[i].marketId == marketId) {
                    positionIdx = i;
                    found = true;
                    // Set the index for future O(1) lookups
                    positionIndex[marketId] = i + 1;
                    break;
                }
            }
        }
        
        result.positionExists = found;
        
        if (found) {
            Position storage position = positions[positionIdx];
            result.oldSize = position.size;
            result.oldEntryPrice = position.entryPrice;
            result.oldMargin = position.marginLocked;
            uint256 oldHaircut6 = position.socializedLossAccrued6;
            uint256 oldHaircutUnits18 = position.haircutUnits18;
            
            result.newSize = position.size + sizeDelta;

            if ((position.size > 0 && sizeDelta < 0) || (position.size < 0 && sizeDelta > 0)) {
                uint256 absDelta = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta);
                uint256 posAbs = uint256(position.size > 0 ? position.size : -position.size);
                uint256 closedAbs = absDelta > posAbs ? posAbs : absDelta;
                int256 closingSizeSigned = position.size > 0 ? int256(closedAbs) : -int256(closedAbs);
                int256 priceDiff = int256(executionPrice) - int256(position.entryPrice);
                result.realizedPnL = (priceDiff * closingSizeSigned) / int256(TICK_PRECISION);
            }

            if (result.newSize == 0) {
                result.newEntryPrice = 0;
                result.positionClosed = true;
                result.marginToRelease = position.marginLocked;
                result.haircutToConfiscate6 = oldHaircut6;
                
                // Swap-and-pop removal with index maintenance
                uint256 lastIndex = positions.length - 1;
                if (positionIdx != lastIndex) {
                    Position storage lastPos = positions[lastIndex];
                    positions[positionIdx] = lastPos;
                    positionIndex[lastPos.marketId] = indexPlusOne;  // Update moved position's index
                }
                positions.pop();
                positionIndex[marketId] = 0;  // Clear removed position's index
                
            } else {
                bool sameDirection = (position.size > 0 && sizeDelta > 0) || (position.size < 0 && sizeDelta < 0);

                if (sameDirection) {
                    unchecked {
                        uint256 existingSize = uint256(position.size >= 0 ? position.size : -position.size);
                        uint256 newSize = uint256(sizeDelta >= 0 ? sizeDelta : -sizeDelta);
                        uint256 wholeExistingSize = existingSize / 1e18;
                        uint256 wholeNewSize = newSize / 1e18;
                        if (wholeExistingSize == 0) wholeExistingSize = 1;
                        if (wholeNewSize == 0) wholeNewSize = 1;
                        uint256 existingNotional = wholeExistingSize * position.entryPrice;
                        uint256 newNotional = wholeNewSize * executionPrice;
                        uint256 totalNotional = existingNotional + newNotional;
                        uint256 totalSize = wholeExistingSize + wholeNewSize;
                        result.newEntryPrice = totalSize > 0 ? (totalNotional / totalSize) : position.entryPrice;
                    }
                } else {
                    uint256 absDelta = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta);
                    uint256 posAbs = uint256(position.size > 0 ? position.size : -position.size);
                    if (absDelta < posAbs) {
                        result.newEntryPrice = position.entryPrice;
                        uint256 unitsToRelease18 = oldHaircutUnits18 == 0 ? 0 : (absDelta > oldHaircutUnits18 ? oldHaircutUnits18 : absDelta);
                        uint256 haircutClosed6 = (oldHaircut6 == 0 || oldHaircutUnits18 == 0) ? 0 : (oldHaircut6 * unitsToRelease18) / oldHaircutUnits18;
                        if (haircutClosed6 > 0) {
                            if (haircutClosed6 > position.socializedLossAccrued6) {
                                haircutClosed6 = position.socializedLossAccrued6;
                            }
                            position.socializedLossAccrued6 = position.socializedLossAccrued6 - haircutClosed6;
                            if (unitsToRelease18 > 0) {
                                position.haircutUnits18 = position.haircutUnits18 - unitsToRelease18;
                            }
                            result.haircutToConfiscate6 = haircutClosed6;
                        }
                    } else {
                        result.newEntryPrice = executionPrice;
                        result.haircutToConfiscate6 = oldHaircut6;
                    }
                }
                
                position.size = result.newSize;
                position.entryPrice = result.newEntryPrice;
                
                uint256 oldMarginLocal = position.marginLocked;
                if (requiredMargin > oldMarginLocal) {
                    result.marginToLock = requiredMargin - oldMarginLocal;
                    result.marginToRelease = 0;
                    position.marginLocked = requiredMargin;
                    result.newMargin = requiredMargin;
                } else if (requiredMargin < oldMarginLocal) {
                    result.marginToLock = 0;
                    result.marginToRelease = oldMarginLocal - requiredMargin;
                    position.marginLocked = requiredMargin;
                    result.newMargin = requiredMargin;
                } else {
                    result.marginToLock = 0;
                    result.marginToRelease = 0;
                    result.newMargin = oldMarginLocal;
                }
            }
            
        } else {
            result.newSize = sizeDelta;
            result.newEntryPrice = executionPrice;
            result.newMargin = requiredMargin;
            result.marginToLock = requiredMargin;
            
            positions.push(Position({
                marketId: marketId,
                size: sizeDelta,
                entryPrice: executionPrice,
                marginLocked: requiredMargin,
                socializedLossAccrued6: 0,
                haircutUnits18: 0,
                liquidationPrice: 0
            }));
            
            // Set index for new position
            positionIndex[marketId] = positions.length;
        }
    }

    /**
     * @dev Recalculate position margin based on new requirements
     */
    function recalculatePositionMargin(
        Position[] storage positions,
        address /*user*/,
        bytes32 marketId,
        uint256 newRequiredMargin
    ) external returns (uint256 oldMargin, uint256 marginDelta, bool isIncrease) {
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                Position storage position = positions[i];
                oldMargin = position.marginLocked;
                
                if (newRequiredMargin > oldMargin) {
                    marginDelta = newRequiredMargin - oldMargin;
                    isIncrease = true;
                } else {
                    marginDelta = oldMargin - newRequiredMargin;
                    isIncrease = false;
                }
                
                position.marginLocked = newRequiredMargin;
                // Margin now tracked exclusively in Position struct
                
                return (oldMargin, marginDelta, isIncrease);
            }
        }
        
        revert("Position not found");
    }

    /**
     * @dev Update position entry price and size
     */
    function updatePosition(
        Position[] storage positions,
        address /*user*/,
        bytes32 marketId,
        int256 newSize,
        uint256 newEntryPrice,
        uint256 newMargin
    ) external returns (int256 oldSize, uint256 oldEntryPrice) {
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                Position storage position = positions[i];
                oldSize = position.size;
                oldEntryPrice = position.entryPrice;
                
                if (newSize == 0) {
                    // Close position
                    if (i < positions.length - 1) {
                        positions[i] = positions[positions.length - 1];
                    }
                    positions.pop();
                    // Margin tracking removed from position - no separate mapping needed
                } else {
                    // Update position
                    position.size = newSize;
                    position.entryPrice = newEntryPrice;
                    position.marginLocked = newMargin;
                    // Margin now tracked exclusively in Position struct
                }
                
                return (oldSize, oldEntryPrice);
            }
        }
        
        // Create new position if not found
        if (newSize != 0) {
            positions.push(Position({
                marketId: marketId,
                size: newSize,
                entryPrice: newEntryPrice,
                marginLocked: newMargin,
                socializedLossAccrued6: 0,
                haircutUnits18: 0,
                liquidationPrice: 0
            }));
            // Margin now tracked exclusively in Position struct
        }
        
        return (0, 0);
    }

    /**
     * @dev Remove market ID from user's market list (legacy - O(N))
     */
    function removeMarketIdFromUser(
        bytes32[] storage userMarketIds,
        bytes32 marketId
    ) external {
        for (uint256 j = 0; j < userMarketIds.length; j++) {
            if (userMarketIds[j] == marketId) {
                if (j < userMarketIds.length - 1) {
                    userMarketIds[j] = userMarketIds[userMarketIds.length - 1];
                }
                userMarketIds.pop();
                break;
            }
        }
    }
    
    /**
     * @dev Remove market ID from user's market list with O(1) index lookup
     */
    function removeMarketIdFromUserWithIndex(
        bytes32[] storage userMarketIds,
        mapping(bytes32 => uint256) storage marketIdIndex,
        bytes32 marketId
    ) external {
        uint256 indexPlusOne = marketIdIndex[marketId];
        if (indexPlusOne == 0) return;  // Not found
        
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = userMarketIds.length - 1;
        
        if (index != lastIndex) {
            bytes32 lastId = userMarketIds[lastIndex];
            userMarketIds[index] = lastId;
            marketIdIndex[lastId] = indexPlusOne;  // Update moved ID's index
        }
        userMarketIds.pop();
        marketIdIndex[marketId] = 0;  // Clear removed ID's index
    }

    /**
     * @dev Add market ID to user's market list (legacy - O(N))
     */
    function addMarketIdToUser(
        bytes32[] storage userMarketIds,
        bytes32 marketId
    ) external {
        for (uint256 i = 0; i < userMarketIds.length; i++) {
            if (userMarketIds[i] == marketId) {
                return;
            }
        }
        userMarketIds.push(marketId);
    }
    
    /**
     * @dev Add market ID to user's market list with O(1) duplicate check
     */
    function addMarketIdToUserWithIndex(
        bytes32[] storage userMarketIds,
        mapping(bytes32 => uint256) storage marketIdIndex,
        bytes32 marketId
    ) external {
        if (marketIdIndex[marketId] != 0) return;  // Already exists (O(1) check)
        
        userMarketIds.push(marketId);
        marketIdIndex[marketId] = userMarketIds.length;  // index + 1
    }

    /**
     * @dev Calculate detailed position netting preview
     */
    function calculateDetailedPositionNetting(
        Position memory existingPosition,
        int256 sizeDelta,
        uint256 executionPrice
    ) external pure returns (
        int256 newSize,
        uint256 newEntryPrice,
        uint256 newMarginRequired,
        int256 realizedPnL,
        bool positionWillClose
    ) {
        newSize = existingPosition.size + sizeDelta;
        positionWillClose = (newSize == 0);
        newMarginRequired = 0;
        
        if (positionWillClose) {
            newEntryPrice = 0;
            newMarginRequired = 0;
            
            // Calculate realized P&L for full close using original signed size
            int256 priceDiff = int256(executionPrice) - int256(existingPosition.entryPrice);
            realizedPnL = (priceDiff * existingPosition.size) / int256(TICK_PRECISION);
        } else {
            // Calculate weighted entry price for same-direction adds, otherwise flip
            bool sameDirection = (existingPosition.size > 0 && sizeDelta > 0) ||
                                 (existingPosition.size < 0 && sizeDelta < 0);

            if (sameDirection && existingPosition.size != 0) {
                // Compute weighted average entry with minimal intermediates
                uint256 existingAbs = uint256(existingPosition.size >= 0 ? existingPosition.size : -existingPosition.size);
                uint256 deltaAbs = uint256(sizeDelta >= 0 ? sizeDelta : -sizeDelta);
                uint256 totalAbs = uint256(newSize >= 0 ? newSize : -newSize);
                uint256 totalNotional = existingAbs * existingPosition.entryPrice + deltaAbs * executionPrice;
                newEntryPrice = totalNotional / totalAbs;
            } else {
                // Opposite direction: flip price to execution and realize PnL on old size
                newEntryPrice = executionPrice;
                int256 priceDiffFlip = int256(executionPrice) - int256(existingPosition.entryPrice);
                realizedPnL = (priceDiffFlip * existingPosition.size) / int256(TICK_PRECISION);
            }

            // If this trade closes part of the position (opposite direction), realize proportional PnL
            if ((existingPosition.size > 0 && sizeDelta < 0) || (existingPosition.size < 0 && sizeDelta > 0)) {
                uint256 closedAbs;
                {
                    uint256 absDelta = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta);
                    uint256 posAbs = uint256(existingPosition.size > 0 ? existingPosition.size : -existingPosition.size);
                    closedAbs = absDelta > posAbs ? posAbs : absDelta;
                }
                int256 closingSizeSigned = existingPosition.size > 0 ? int256(closedAbs) : -int256(closedAbs);
                int256 priceDiff = int256(executionPrice) - int256(existingPosition.entryPrice);
                int256 realizedPartial = (priceDiff * closingSizeSigned) / int256(TICK_PRECISION);
                realizedPnL += realizedPartial;
            }
        }
    }

    /**
     * @dev Get position count for user
     */
    function getPositionCount(Position[] storage positions) external view returns (uint256) {
        return positions.length;
    }

    /**
     * @dev Check if user has position in specific market
     */
    function hasPositionInMarket(
        Position[] storage positions,
        bytes32 marketId
    ) external view returns (bool) {
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                return true;
            }
        }
        return false;
    }
}

