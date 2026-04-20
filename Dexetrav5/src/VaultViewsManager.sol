// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "./CoreVaultStorage.sol";
import "./VaultAnalytics.sol";
import "./PositionManager.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./diamond/interfaces/IOBPricingFacet.sol";

contract VaultViewsManager is CoreVaultStorage {
    uint256 public constant DECIMAL_SCALE = 1e12;
    uint256 public constant TICK_PRECISION = 1e6;

    constructor() {}

    function getUnifiedMarginSummary(address user) external view returns (
        uint256 totalCollateral,
        uint256 marginUsedInPositions,
        uint256 marginReservedForOrders,
        uint256 availableMargin,
        int256 realizedPnL,
        int256 unrealizedPnL,
        uint256 totalMarginCommitted,
        bool isMarginHealthy
    ) {
        totalCollateral = userCollateral[user] + userCrossChainCredit[user];
        realizedPnL = userRealizedPnL[user];

        marginUsedInPositions = 0;
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            marginUsedInPositions += userPositions[user][i].marginLocked;
        }

        marginReservedForOrders = 0;
        for (uint256 i = 0; i < userPendingOrders[user].length; i++) {
            marginReservedForOrders += userPendingOrders[user][i].marginReserved;
        }

        unrealizedPnL = 0;
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            uint256 markPrice = getMarkPrice(userPositions[user][i].marketId);
            if (markPrice > 0) {
                int256 priceDiff = int256(markPrice) - int256(userPositions[user][i].entryPrice);
                unrealizedPnL += (priceDiff * userPositions[user][i].size) / int256(TICK_PRECISION);
            }
        }

        totalMarginCommitted = marginUsedInPositions + marginReservedForOrders;
        {
            bool hasOpenPositions = userPositions[user].length > 0;
            bool anyUnderLiquidation = false;
            if (hasOpenPositions) {
                for (uint256 i = 0; i < userPositions[user].length; i++) {
                    if (isUnderLiquidationPosition[user][userPositions[user][i].marketId]) {
                        anyUnderLiquidation = true;
                        break;
                    }
                }
            }
            int256 realizedPnLAdj = realizedPnL;
            if (!hasOpenPositions && realizedPnLAdj < 0) {
                realizedPnLAdj = 0;
            }
            if (anyUnderLiquidation && realizedPnLAdj < 0) {
                realizedPnLAdj = 0;
            }
            if (realizedPnLAdj < 0) {
                realizedPnLAdj = 0;
            }
            int256 realizedPnL6 = realizedPnLAdj / int256(DECIMAL_SCALE);
            int256 baseWithRealized = int256(totalCollateral) + realizedPnL6;
            uint256 availableBeforeReserved = baseWithRealized > 0 ? uint256(baseWithRealized) : 0;
            availableMargin = availableBeforeReserved > totalMarginCommitted
                ? (availableBeforeReserved - totalMarginCommitted)
                : 0;

            if (availableMargin > 0) {
                uint256 outstandingHaircut6 = 0;
                for (uint256 i = 0; i < userPositions[user].length; i++) {
                    outstandingHaircut6 += userPositions[user][i].socializedLossAccrued6;
                }
                if (outstandingHaircut6 > 0) {
                    availableMargin = availableMargin > outstandingHaircut6
                        ? (availableMargin - outstandingHaircut6)
                        : 0;
                }
            }
        }

        isMarginHealthy = (int256(totalCollateral) + realizedPnL + unrealizedPnL) > int256(totalMarginCommitted);
    }

    function getMarginUtilization(address user) external view returns (uint256 utilizationBps) {
        uint256 totalCollateral = userCollateral[user] + userCrossChainCredit[user];
        if (totalCollateral == 0) return 0;

        uint256 totalMarginUsed = 0;
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            totalMarginUsed += userPositions[user][i].marginLocked;
        }
        for (uint256 i = 0; i < userPendingOrders[user].length; i++) {
            totalMarginUsed += userPendingOrders[user][i].marginReserved;
        }

        utilizationBps = (totalMarginUsed * 10000) / totalCollateral;
        if (utilizationBps > 10000) utilizationBps = 10000;
    }

    function getMarginSummary(address user) external view returns (VaultAnalytics.MarginSummary memory) {
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[user].length);
        uint256[] memory markPrices = new uint256[](userPositions[user].length);

        for (uint256 i = 0; i < userPositions[user].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[user][i].marketId,
                size: userPositions[user][i].size,
                entryPrice: userPositions[user][i].entryPrice,
                marginLocked: userPositions[user][i].marginLocked
            });
            markPrices[i] = getMarkPrice(userPositions[user][i].marketId);
        }

        int256 realizedAdj = userRealizedPnL[user];
        if (userPositions[user].length == 0 && realizedAdj < 0) {
            realizedAdj = 0;
        } else if (realizedAdj < 0) {
            bool anyUnderLiquidation = false;
            for (uint256 i = 0; i < userPositions[user].length; i++) {
                if (isUnderLiquidationPosition[user][userPositions[user][i].marketId]) {
                    anyUnderLiquidation = true;
                    break;
                }
            }
            if (anyUnderLiquidation) {
                realizedAdj = 0;
            }
        }

        VaultAnalytics.MarginSummary memory summary = VaultAnalytics.getMarginSummary(
            userCollateral[user],
            realizedAdj,
            positions,
            userPendingOrders[user],
            markPrices
        );

        if (userCrossChainCredit[user] > 0) {
            summary.availableCollateral += userCrossChainCredit[user];
        }

        if (summary.availableCollateral > 0) {
            uint256 outstandingHaircut6 = 0;
            for (uint256 i = 0; i < userPositions[user].length; i++) {
                outstandingHaircut6 += userPositions[user][i].socializedLossAccrued6;
            }
            if (outstandingHaircut6 > 0) {
                summary.availableCollateral = summary.availableCollateral > outstandingHaircut6
                    ? (summary.availableCollateral - outstandingHaircut6)
                    : 0;
            }
        }

        return summary;
    }

    function getCollateralBreakdown(address user)
        external
        view
        returns (
            uint256 depositedCollateral,
            uint256 crossChainCredit,
            uint256 withdrawableCollateral,
            uint256 availableForTrading
        )
    {
        depositedCollateral = userCollateral[user];
        crossChainCredit = userCrossChainCredit[user];
        withdrawableCollateral = getWithdrawableCollateral(user);
        availableForTrading = getAvailableCollateral(user);
    }

    function getAvailableCollateral(address user) public view returns (uint256) {
        uint256 total = userCollateral[user] + userCrossChainCredit[user];
        
        // Add positive realized PnL (converted from 18d to 6d)
        int256 realizedPnL18 = userRealizedPnL[user];
        if (userPositions[user].length == 0 && realizedPnL18 < 0) {
            realizedPnL18 = 0;
        }
        if (realizedPnL18 > 0) {
            total += uint256(realizedPnL18) / DECIMAL_SCALE;
        }
        
        // Use cached totals for committed margin (O(1) instead of O(N))
        uint256 committed = userTotalMarginLocked[user] + userTotalMarginReserved[user];
        
        uint256 available = total > committed ? total - committed : 0;
        
        // Subtract haircut (still needs loop, but positions are typically few)
        if (available > 0) {
            uint256 outstandingHaircut6 = 0;
            for (uint256 i = 0; i < userPositions[user].length; i++) {
                outstandingHaircut6 += userPositions[user][i].socializedLossAccrued6;
            }
            if (outstandingHaircut6 > 0) {
                available = available > outstandingHaircut6 ? (available - outstandingHaircut6) : 0;
            }
        }
        
        return available;
    }

    function getWithdrawableCollateral(address user) public view returns (uint256) {
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[user].length);
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[user][i].marketId,
                size: userPositions[user][i].size,
                entryPrice: userPositions[user][i].entryPrice,
                marginLocked: userPositions[user][i].marginLocked
            });
        }
        uint256 baseAvailable = VaultAnalytics.getAvailableCollateral(userCollateral[user], positions);
        int256 realizedPnL18 = userRealizedPnL[user];
        if (userPositions[user].length == 0 && realizedPnL18 < 0) {
            realizedPnL18 = 0;
        }
        int256 realizedPnL6 = realizedPnL18 / int256(DECIMAL_SCALE);
        int256 baseWithRealized = int256(baseAvailable) + realizedPnL6;
        uint256 availableWithRealized = baseWithRealized > 0 ? uint256(baseWithRealized) : 0;
        if (availableWithRealized > 0) {
            uint256 outstandingHaircut6 = 0;
            for (uint256 i = 0; i < userPositions[user].length; i++) {
                outstandingHaircut6 += userPositions[user][i].socializedLossAccrued6;
            }
            if (outstandingHaircut6 > 0) {
                availableWithRealized = availableWithRealized > outstandingHaircut6
                    ? (availableWithRealized - outstandingHaircut6)
                    : 0;
            }
        }
        uint256 reserved = 0;
        VaultAnalytics.PendingOrder[] storage pending = userPendingOrders[user];
        for (uint256 i = 0; i < pending.length; i++) {
            reserved += pending[i].marginReserved;
        }
        return availableWithRealized > reserved ? availableWithRealized - reserved : 0;
    }

    function getTotalMarginUsed(address user) public view returns (uint256) {
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[user].length);
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[user][i].marketId,
                size: userPositions[user][i].size,
                entryPrice: userPositions[user][i].entryPrice,
                marginLocked: userPositions[user][i].marginLocked
            });
        }
        return VaultAnalytics.getTotalMarginUsed(positions);
    }

    function getTotalMarginLockedInMarket(bytes32 marketId) external view returns (uint256 totalLocked6) {
        address[] memory usersWithPositions = _getUsersWithPositionsInMarket(marketId);
        for (uint256 u = 0; u < usersWithPositions.length; u++) {
            PositionManager.Position[] storage positions = userPositions[usersWithPositions[u]];
            for (uint256 i = 0; i < positions.length; i++) {
                if (positions[i].marketId == marketId && positions[i].size != 0) {
                    totalLocked6 += positions[i].marginLocked;
                }
            }
        }
        return totalLocked6;
    }

    function getUserPositions(address user) external view returns (PositionManager.Position[] memory) {
        return userPositions[user];
    }

    function getMarkPrice(bytes32 marketId) public view returns (uint256) {
        return marketMarkPrices[marketId];
    }

    function getPositionSummary(
        address user,
        bytes32 marketId
    ) external view returns (int256 size, uint256 entryPrice, uint256 marginLocked) {
        // O(1) position lookup
        uint256 indexPlusOne = userPositionIndex[user][marketId];
        if (indexPlusOne == 0) return (0, 0, 0);
        
        PositionManager.Position storage pos = userPositions[user][indexPlusOne - 1];
        return (pos.size, pos.entryPrice, pos.marginLocked);
    }

    function getLiquidationPrice(
        address user,
        bytes32 marketId
    ) external view returns (uint256 liquidationPrice, bool hasPosition) {
        // O(1) position lookup
        uint256 indexPlusOne = userPositionIndex[user][marketId];
        if (indexPlusOne == 0) return (0, false);
        
        PositionManager.Position storage pos = userPositions[user][indexPlusOne - 1];
        if (pos.size == 0) return (0, false);
        
        hasPosition = true;
        if (isUnderLiquidationPosition[user][marketId]) {
            return (0, true);
        }
        return (pos.liquidationPrice, true);
    }

    function getPositionEquity(
        address user,
        bytes32 marketId
    ) external view returns (int256 equity6, uint256 notional6, bool hasPosition) {
        // O(1) position lookup
        uint256 indexPlusOne = userPositionIndex[user][marketId];
        if (indexPlusOne == 0) return (0, 0, false);
        
        PositionManager.Position storage pos = userPositions[user][indexPlusOne - 1];
        if (pos.size == 0) return (0, 0, false);
        
        hasPosition = true;
        uint256 markPrice = getMarkPrice(marketId);
        uint256 absSize = uint256(pos.size >= 0 ? pos.size : -pos.size);
        notional6 = (absSize * markPrice) / (10**18);

        int256 priceDiff = int256(markPrice) - int256(pos.entryPrice);
        int256 pnl18 = (priceDiff * pos.size) / int256(TICK_PRECISION);
        int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
        equity6 = int256(pos.marginLocked) + pnl6;
        return (equity6, notional6, true);
    }

    function getPositionFreeMargin(
        address user,
        bytes32 marketId
    ) external view returns (uint256 freeMargin6, uint256 maintenance6, bool hasPosition) {
        // O(1) position lookup
        uint256 indexPlusOne = userPositionIndex[user][marketId];
        if (indexPlusOne == 0) return (0, 0, false);
        
        PositionManager.Position storage pos = userPositions[user][indexPlusOne - 1];
        if (pos.size == 0) return (0, 0, false);
        
        hasPosition = true;
        uint256 markPrice = getMarkPrice(marketId);
        uint256 absSize = uint256(pos.size >= 0 ? pos.size : -pos.size);
        uint256 notional6 = (absSize * markPrice) / (10**18);
        (uint256 mmrBps, ) = _computeEffectiveMMRBps(user, marketId, pos.size);
        maintenance6 = (notional6 * mmrBps) / 10000;

        int256 priceDiff = int256(markPrice) - int256(pos.entryPrice);
        int256 pnl18 = (priceDiff * pos.size) / int256(TICK_PRECISION);
        int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
        int256 equity6 = int256(pos.marginLocked) + pnl6;

        if (equity6 > int256(maintenance6)) {
            freeMargin6 = uint256(equity6 - int256(maintenance6));
        } else {
            freeMargin6 = 0;
        }
        return (freeMargin6, maintenance6, true);
    }

    function getEffectiveMaintenanceMarginBps(
        address user,
        bytes32 marketId
    ) external view returns (uint256 mmrBps, uint256 fillRatio1e18, bool hasPosition) {
        // O(1) position lookup
        uint256 indexPlusOne = userPositionIndex[user][marketId];
        if (indexPlusOne == 0) return (0, 0, false);
        
        PositionManager.Position storage pos = userPositions[user][indexPlusOne - 1];
        if (pos.size == 0) return (0, 0, false);
        
        hasPosition = true;
        (mmrBps, fillRatio1e18) = _computeEffectiveMMRBps(user, marketId, pos.size);
        return (mmrBps, fillRatio1e18, true);
    }

    function getEffectiveMaintenanceDetails(
        address user,
        bytes32 marketId
    ) external view returns (uint256 mmrBps, uint256 fillRatio1e18, uint256 gapRatio1e18, bool hasPosition) {
        // O(1) position lookup
        uint256 indexPlusOne = userPositionIndex[user][marketId];
        if (indexPlusOne == 0) return (0, 0, 0, false);
        
        PositionManager.Position storage pos = userPositions[user][indexPlusOne - 1];
        if (pos.size == 0) return (0, 0, 0, false);
        
        hasPosition = true;
        (mmrBps, fillRatio1e18, gapRatio1e18) = _computeEffectiveMMRMetrics(user, marketId, pos.size);
        return (mmrBps, fillRatio1e18, gapRatio1e18, true);
    }

    function maintenanceMarginBps(bytes32 marketId) external view returns (uint256) {
        marketId;
        uint256 floorBps = baseMmrBps + penaltyMmrBps;
        return floorBps > maxMmrBps ? maxMmrBps : floorBps;
    }

    function getUsersWithPositionsInMarket(bytes32 marketId) external view returns (address[] memory) {
        return _getUsersWithPositionsInMarket(marketId);
    }

    function _getUsersWithPositionsInMarket(bytes32 marketId) internal view returns (address[] memory) {
        address[] memory tempUsers = new address[](allKnownUsers.length);
        uint256 count = 0;

        for (uint256 i = 0; i < allKnownUsers.length; i++) {
            address user = allKnownUsers[i];
            PositionManager.Position[] storage positions = userPositions[user];

            for (uint256 j = 0; j < positions.length; j++) {
                if (positions[j].marketId == marketId && positions[j].size != 0) {
                    tempUsers[count] = user;
                    count++;
                    break;
                }
            }
        }

        address[] memory usersWithPositions = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            usersWithPositions[i] = tempUsers[i];
        }

        return usersWithPositions;
    }

    function _computeEffectiveMMRMetrics(
        address,
        bytes32 marketId,
        int256 positionSize
    ) internal view returns (uint256 mmrBps, uint256 fillRatio1e18, uint256 gapRatio1e18) {
        marketId; positionSize;
        uint256 mmr = baseMmrBps + penaltyMmrBps;
        if (mmr > maxMmrBps) mmr = maxMmrBps;
        return (mmr, 0, 0);
    }

    function _computeEffectiveMMRBps(
        address user,
        bytes32 marketId,
        int256 positionSize
    ) internal view returns (uint256 mmrBps, uint256 fillRatio1e18) {
        (uint256 m, uint256 f, ) = _computeEffectiveMMRMetrics(user, marketId, positionSize);
        return (m, f);
    }

    function _getCloseLiquidity(bytes32 marketId, uint256) internal view returns (uint256 liquidity18) {
        address obAddr = marketToOrderBook[marketId];
        if (obAddr == address(0)) return 0;
        (, uint256[] memory bidAmounts, , uint256[] memory askAmounts) =
            IOBPricingFacet(obAddr).getOrderBookDepth(mmrLiquidityDepthLevels);

        uint256 sumBids;
        for (uint256 i = 0; i < bidAmounts.length; i++) {
            sumBids += bidAmounts[i];
        }
        uint256 sumAsks;
        for (uint256 j = 0; j < askAmounts.length; j++) {
            sumAsks += askAmounts[j];
        }
        liquidity18 = sumBids > sumAsks ? sumBids : sumAsks;
        return liquidity18;
    }
    
    // ============ Gas Optimization Migration ============
    
    /**
     * @dev Initializes the new O(1) index mappings and margin caches for existing users.
     *      Call this after upgrading to populate the new storage mappings.
     *      Can be called in batches if there are many users.
     */
    function initializeMarginCaches(address[] calldata users) external {
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            
            uint256 locked;
            uint256 pLen = userPositions[user].length;
            for (uint256 j = 0; j < pLen; j++) {
                locked += userPositions[user][j].marginLocked;
                userPositionIndex[user][userPositions[user][j].marketId] = j + 1;
            }
            userTotalMarginLocked[user] = locked;
            
            uint256 reserved;
            uint256 oLen = userPendingOrders[user].length;
            for (uint256 k = 0; k < oLen; k++) {
                reserved += userPendingOrders[user][k].marginReserved;
                userPendingOrderIndex[user][userPendingOrders[user][k].orderId] = k + 1;
            }
            userTotalMarginReserved[user] = reserved;
            
            uint256 mLen = userMarketIds[user].length;
            for (uint256 m = 0; m < mLen; m++) {
                userMarketIdIndex[user][userMarketIds[user][m]] = m + 1;
            }
        }
    }
    
    /**
     * @dev Returns all known users for batch initialization.
     */
    function getAllKnownUsers() external view returns (address[] memory) {
        return allKnownUsers;
    }
}
