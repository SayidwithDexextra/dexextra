// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "./CoreVaultStorage.sol";
import "./PositionManager.sol";
import "./BatchSettlementStorage.sol";

/**
 * @title SettlementManager
 * @notice Handles market settlement via delegatecall from CoreVault.
 *         Supports both single-tx settlement (for small markets) and
 *         batch settlement (for large markets with thousands of positions).
 */
contract SettlementManager is CoreVaultStorage {
    using BatchSettlementStorage for BatchSettlementStorage.Layout;

    uint256 constant DECIMAL_SCALE = 1e12;
    uint256 constant TICK_PRECISION = 1e6;

    // ============ Events ============
    event HaircutApplied(bytes32 indexed marketId, uint256 scaleRay, uint256 totalMarginLocked, uint256 totalLiabilities);
    event VaultMarketSettled(bytes32 indexed marketId, uint256 finalPrice, uint256 totalProfit6, uint256 totalLoss6, uint256 badDebt6);
    event BadDebtRecorded(bytes32 indexed marketId, uint256 amount, address indexed liquidatedUser);
    
    // Batch settlement events
    event BatchSettlementInitialized(bytes32 indexed marketId, uint256 finalPrice, uint256 totalUsers);
    event BatchCalculationProgress(bytes32 indexed marketId, uint256 processed, uint256 total, uint8 phase);
    event BatchSettlementProgress(bytes32 indexed marketId, uint256 processed, uint256 total);
    event BatchSettlementComplete(bytes32 indexed marketId, uint256 profit6, uint256 loss6, uint256 badDebt6);

    // ============ Errors ============
    error MarketNotFound();
    error AlreadySettled();
    error InvalidPrice();
    error NotSettling();
    error WrongPhase(uint8 expected, uint8 actual);
    error MarketIsSettling();

    constructor() {}

    // ============ Single-TX Settlement (for small markets) ============

    function settleMarket(bytes32 marketId, uint256 finalPrice) external {
        if (marketToOrderBook[marketId] == address(0)) revert MarketNotFound();
        if (marketSettled[marketId]) revert AlreadySettled();
        if (finalPrice == 0) revert InvalidPrice();
        if (BatchSettlementStorage.isSettling(marketId)) revert MarketIsSettling();

        marketMarkPrices[marketId] = finalPrice;

        uint256 totalLiabilities6 = 0;
        uint256 losersCapacity6 = 0;
        uint256 marketTotalMarginLocked6 = 0;

        address[] memory users = _getUsersWithPositionsInMarket(marketId);
        for (uint256 u = 0; u < users.length; u++) {
            address user = users[u];
            PositionManager.Position[] storage positionsView = userPositions[user];
            for (uint256 i = 0; i < positionsView.length; i++) {
                PositionManager.Position storage p = positionsView[i];
                if (p.marketId != marketId) { continue; }

                int256 priceDiff = int256(finalPrice) - int256(p.entryPrice);
                int256 pnl18 = (priceDiff * p.size) / int256(TICK_PRECISION);
                int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);

                uint256 haircut6 = p.socializedLossAccrued6;
                int256 delta6 = pnl6 - int256(haircut6);

                marketTotalMarginLocked6 += p.marginLocked;

                if (delta6 > 0) {
                    totalLiabilities6 += uint256(delta6);
                } else if (delta6 < 0) {
                    uint256 loss6 = uint256(-delta6);
                    uint256 seizeCap6 = p.marginLocked;
                    uint256 balance = userCollateral[user] + userCrossChainCredit[user];
                    if (seizeCap6 > balance) { seizeCap6 = balance; }
                    uint256 debitPlanned6 = loss6 <= seizeCap6 ? loss6 : seizeCap6;
                    losersCapacity6 += debitPlanned6;
                }
            }
        }

        uint256 scaleRay = 1e18;
        if (totalLiabilities6 > 0 && totalLiabilities6 > losersCapacity6) {
            scaleRay = (losersCapacity6 * 1e18) / totalLiabilities6;
        }

        if (scaleRay < 1e18) {
            emit HaircutApplied(marketId, scaleRay, marketTotalMarginLocked6, totalLiabilities6);
        }

        uint256 totalProfit6 = 0;
        uint256 totalLoss6 = 0;
        uint256 badDebt6Total = 0;

        for (uint256 u2 = 0; u2 < users.length; u2++) {
            address user2 = users[u2];
            PositionManager.Position[] storage positions = userPositions[user2];

            uint256 i2 = 0;
            while (i2 < positions.length) {
                if (positions[i2].marketId != marketId) {
                    unchecked { i2++; }
                    continue;
                }

                PositionManager.Position storage pos = positions[i2];

                int256 priceDiff2 = int256(finalPrice) - int256(pos.entryPrice);
                int256 pnl18b = (priceDiff2 * pos.size) / int256(TICK_PRECISION);
                int256 pnl6b = pnl18b / int256(DECIMAL_SCALE);
                uint256 haircut6b = pos.socializedLossAccrued6;
                int256 delta6b = pnl6b - int256(haircut6b);

                if (delta6b > 0) {
                    uint256 profit6b = (uint256(delta6b) * scaleRay) / 1e18;
                    if (profit6b > 0) {
                        userCollateral[user2] += profit6b;
                        totalProfit6 += profit6b;

                        uint256 ledger = userSocializedLoss[user2];
                        if (ledger > 0) {
                            uint256 applied = haircut6b <= ledger ? haircut6b : ledger;
                            userSocializedLoss[user2] = ledger - applied;
                        }
                    }
                } else if (delta6b < 0) {
                    uint256 loss6b = uint256(-delta6b);
                    uint256 seizeCap6b = pos.marginLocked;
                    uint256 totalBalance2 = userCollateral[user2] + userCrossChainCredit[user2];
                    if (seizeCap6b > totalBalance2) { seizeCap6b = totalBalance2; }
                    uint256 debit6 = loss6b <= seizeCap6b ? loss6b : seizeCap6b;
                    if (debit6 > 0) {
                        uint256 extBal2 = userCrossChainCredit[user2];
                        uint256 useExt2 = debit6 <= extBal2 ? debit6 : extBal2;
                        if (useExt2 > 0) { userCrossChainCredit[user2] = extBal2 - useExt2; }
                        uint256 rem2 = debit6 - useExt2;
                        if (rem2 > 0) { userCollateral[user2] -= rem2; }
                        totalLoss6 += debit6;
                    }
                    uint256 shortfall2 = loss6b - debit6;
                    if (shortfall2 > 0) {
                        marketBadDebt[marketId] += shortfall2;
                        badDebt6Total += shortfall2;
                        emit BadDebtRecorded(marketId, shortfall2, user2);
                    }
                }

                uint256 locked2 = pos.marginLocked;
                if (locked2 > 0) {
                    if (totalMarginLocked >= locked2) {
                        totalMarginLocked -= locked2;
                    } else {
                        totalMarginLocked = 0;
                    }
                }

                // Update user's cached margin
                if (userTotalMarginLocked[user2] >= locked2) {
                    userTotalMarginLocked[user2] -= locked2;
                } else {
                    userTotalMarginLocked[user2] = 0;
                }

                // Clear position index before removal
                userPositionIndex[user2][marketId] = 0;

                if (i2 < positions.length - 1) {
                    positions[i2] = positions[positions.length - 1];
                    // Update index for moved position
                    userPositionIndex[user2][positions[i2].marketId] = i2 + 1;
                }
                positions.pop();
            }

            PositionManager.removeMarketIdFromUserWithIndex(userMarketIds[user2], userMarketIdIndex[user2], marketId);
            
            // Remove from per-market position tracking
            _removeUserFromMarketPositionsInternal(user2, marketId);
        }

        marketSettled[marketId] = true;
        emit VaultMarketSettled(marketId, finalPrice, totalProfit6, totalLoss6, badDebt6Total);
    }

    // ============ Batch Settlement (for large markets) ============

    /**
     * @notice Phase 0: Initialize batch settlement
     * @param marketId The market to settle
     * @param finalPrice The settlement price (6 decimals)
     */
    function initBatchSettlement(bytes32 marketId, uint256 finalPrice) external {
        if (marketToOrderBook[marketId] == address(0)) revert MarketNotFound();
        if (marketSettled[marketId]) revert AlreadySettled();
        if (finalPrice == 0) revert InvalidPrice();
        
        BatchSettlementStorage.BatchState storage state = BatchSettlementStorage.getState(marketId);
        if (state.phase != BatchSettlementStorage.PHASE_NONE) revert MarketIsSettling();

        // Set the mark price
        marketMarkPrices[marketId] = finalPrice;

        // Initialize batch state
        state.phase = BatchSettlementStorage.PHASE_CALCULATING;
        state.finalPrice = finalPrice;
        state.cursor = 0;
        state.totalLiabilities6 = 0;
        state.losersCapacity6 = 0;
        state.marketTotalMarginLocked6 = 0;
        state.scaleRay = 1e18;
        state.totalProfit6 = 0;
        state.totalLoss6 = 0;
        state.badDebt6 = 0;

        // Lock trading for this market
        BatchSettlementStorage.setSettling(marketId, true);

        uint256 totalUsers = marketPositionUsers[marketId].length;
        emit BatchSettlementInitialized(marketId, finalPrice, totalUsers);
    }

    /**
     * @notice Phase 1: Calculate totals in batches
     * @param marketId The market being settled
     * @param batchSize Number of users to process in this batch
     * @return complete True if all users have been processed
     */
    function batchCalculateTotals(bytes32 marketId, uint256 batchSize) external returns (bool complete) {
        BatchSettlementStorage.BatchState storage state = BatchSettlementStorage.getState(marketId);
        if (state.phase != BatchSettlementStorage.PHASE_CALCULATING) {
            revert WrongPhase(BatchSettlementStorage.PHASE_CALCULATING, state.phase);
        }

        address[] storage users = marketPositionUsers[marketId];
        uint256 totalUsers = users.length;
        uint256 cursor = state.cursor;
        uint256 endIdx = cursor + batchSize;
        if (endIdx > totalUsers) {
            endIdx = totalUsers;
        }

        uint256 finalPrice = state.finalPrice;

        for (uint256 u = cursor; u < endIdx; u++) {
            address user = users[u];
            PositionManager.Position[] storage positions = userPositions[user];
            
            for (uint256 i = 0; i < positions.length; i++) {
                PositionManager.Position storage p = positions[i];
                if (p.marketId != marketId) continue;

                int256 priceDiff = int256(finalPrice) - int256(p.entryPrice);
                int256 pnl18 = (priceDiff * p.size) / int256(TICK_PRECISION);
                int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);

                uint256 haircut6 = p.socializedLossAccrued6;
                int256 delta6 = pnl6 - int256(haircut6);

                state.marketTotalMarginLocked6 += p.marginLocked;

                if (delta6 > 0) {
                    state.totalLiabilities6 += uint256(delta6);
                } else if (delta6 < 0) {
                    uint256 loss6 = uint256(-delta6);
                    uint256 seizeCap6 = p.marginLocked;
                    uint256 balance = userCollateral[user] + userCrossChainCredit[user];
                    if (seizeCap6 > balance) { seizeCap6 = balance; }
                    uint256 debitPlanned6 = loss6 <= seizeCap6 ? loss6 : seizeCap6;
                    state.losersCapacity6 += debitPlanned6;
                }
            }
        }

        state.cursor = endIdx;
        emit BatchCalculationProgress(marketId, endIdx, totalUsers, state.phase);

        complete = (endIdx >= totalUsers);
    }

    /**
     * @notice Phase 2: Finalize haircut calculation
     * @param marketId The market being settled
     */
    function finalizeHaircutCalculation(bytes32 marketId) external {
        BatchSettlementStorage.BatchState storage state = BatchSettlementStorage.getState(marketId);
        if (state.phase != BatchSettlementStorage.PHASE_CALCULATING) {
            revert WrongPhase(BatchSettlementStorage.PHASE_CALCULATING, state.phase);
        }

        // Ensure all users have been processed in Phase 1
        uint256 totalUsers = marketPositionUsers[marketId].length;
        if (state.cursor < totalUsers) {
            revert WrongPhase(BatchSettlementStorage.PHASE_CALCULATING, state.phase);
        }

        // Calculate haircut scale
        if (state.totalLiabilities6 > 0 && state.totalLiabilities6 > state.losersCapacity6) {
            state.scaleRay = (state.losersCapacity6 * 1e18) / state.totalLiabilities6;
        } else {
            state.scaleRay = 1e18;
        }

        if (state.scaleRay < 1e18) {
            emit HaircutApplied(marketId, state.scaleRay, state.marketTotalMarginLocked6, state.totalLiabilities6);
        }

        // Reset cursor for Phase 3
        state.cursor = 0;
        state.phase = BatchSettlementStorage.PHASE_HAIRCUT_DONE;

        emit BatchCalculationProgress(marketId, totalUsers, totalUsers, state.phase);
    }

    /**
     * @notice Phase 3: Apply settlements in batches
     * @param marketId The market being settled
     * @param batchSize Number of users to process in this batch
     * @return complete True if all users have been processed
     */
    function batchApplySettlements(bytes32 marketId, uint256 batchSize) external returns (bool complete) {
        BatchSettlementStorage.BatchState storage state = BatchSettlementStorage.getState(marketId);
        if (state.phase != BatchSettlementStorage.PHASE_HAIRCUT_DONE && state.phase != BatchSettlementStorage.PHASE_APPLYING) {
            revert WrongPhase(BatchSettlementStorage.PHASE_HAIRCUT_DONE, state.phase);
        }
        
        // Transition to APPLYING phase on first call
        if (state.phase == BatchSettlementStorage.PHASE_HAIRCUT_DONE) {
            state.phase = BatchSettlementStorage.PHASE_APPLYING;
        }

        address[] storage users = marketPositionUsers[marketId];
        uint256 totalUsers = users.length;
        uint256 cursor = state.cursor;
        uint256 endIdx = cursor + batchSize;
        if (endIdx > totalUsers) {
            endIdx = totalUsers;
        }

        uint256 finalPrice = state.finalPrice;
        uint256 scaleRay = state.scaleRay;

        for (uint256 u = cursor; u < endIdx; u++) {
            address user = users[u];
            _applySettlementToUser(user, marketId, finalPrice, scaleRay, state);
        }

        state.cursor = endIdx;
        emit BatchSettlementProgress(marketId, endIdx, totalUsers);

        complete = (endIdx >= totalUsers);
    }

    /**
     * @notice Phase 4: Finalize batch settlement
     * @param marketId The market being settled
     */
    function finalizeBatchSettlement(bytes32 marketId) external {
        BatchSettlementStorage.BatchState storage state = BatchSettlementStorage.getState(marketId);
        if (state.phase != BatchSettlementStorage.PHASE_APPLYING) {
            revert WrongPhase(BatchSettlementStorage.PHASE_APPLYING, state.phase);
        }

        // Ensure all users have been processed
        uint256 totalUsers = marketPositionUsers[marketId].length;
        if (state.cursor < totalUsers) {
            revert WrongPhase(BatchSettlementStorage.PHASE_APPLYING, state.phase);
        }

        // Mark market as settled
        marketSettled[marketId] = true;
        state.phase = BatchSettlementStorage.PHASE_COMPLETE;

        // Unlock trading (though market is now settled)
        BatchSettlementStorage.setSettling(marketId, false);

        // Clear the marketPositionUsers array (users have been removed one by one during apply)
        // The array should already be empty since we remove users as we process them
        // but let's reset the length to be safe
        delete marketPositionUsers[marketId];

        emit VaultMarketSettled(marketId, state.finalPrice, state.totalProfit6, state.totalLoss6, state.badDebt6);
        emit BatchSettlementComplete(marketId, state.totalProfit6, state.totalLoss6, state.badDebt6);
    }

    /**
     * @notice Get batch settlement state for a market
     * @param marketId The market to query
     * @return phase Current phase
     * @return cursor Current cursor position
     * @return totalUsers Total users in market
     * @return scaleRay Haircut scale factor
     */
    function getBatchSettlementState(bytes32 marketId) external view returns (
        uint8 phase,
        uint256 cursor,
        uint256 totalUsers,
        uint256 scaleRay
    ) {
        BatchSettlementStorage.BatchState storage state = BatchSettlementStorage.getState(marketId);
        return (
            state.phase,
            state.cursor,
            marketPositionUsers[marketId].length,
            state.scaleRay
        );
    }

    /**
     * @notice Check if a market is currently being settled
     * @param marketId The market to check
     * @return True if settlement is in progress
     */
    function isMarketSettling(bytes32 marketId) external view returns (bool) {
        return BatchSettlementStorage.isSettling(marketId);
    }

    // ============ Internal Functions ============

    function _applySettlementToUser(
        address user,
        bytes32 marketId,
        uint256 finalPrice,
        uint256 scaleRay,
        BatchSettlementStorage.BatchState storage state
    ) internal {
        PositionManager.Position[] storage positions = userPositions[user];

        uint256 i = 0;
        while (i < positions.length) {
            if (positions[i].marketId != marketId) {
                unchecked { i++; }
                continue;
            }

            PositionManager.Position storage pos = positions[i];

            int256 priceDiff = int256(finalPrice) - int256(pos.entryPrice);
            int256 pnl18 = (priceDiff * pos.size) / int256(TICK_PRECISION);
            int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
            uint256 haircut6 = pos.socializedLossAccrued6;
            int256 delta6 = pnl6 - int256(haircut6);

            if (delta6 > 0) {
                uint256 profit6 = (uint256(delta6) * scaleRay) / 1e18;
                if (profit6 > 0) {
                    userCollateral[user] += profit6;
                    state.totalProfit6 += profit6;

                    uint256 ledger = userSocializedLoss[user];
                    if (ledger > 0) {
                        uint256 applied = haircut6 <= ledger ? haircut6 : ledger;
                        userSocializedLoss[user] = ledger - applied;
                    }
                }
            } else if (delta6 < 0) {
                uint256 loss6 = uint256(-delta6);
                uint256 seizeCap6 = pos.marginLocked;
                uint256 totalBalance = userCollateral[user] + userCrossChainCredit[user];
                if (seizeCap6 > totalBalance) { seizeCap6 = totalBalance; }
                uint256 debit6 = loss6 <= seizeCap6 ? loss6 : seizeCap6;
                
                if (debit6 > 0) {
                    uint256 extBal = userCrossChainCredit[user];
                    uint256 useExt = debit6 <= extBal ? debit6 : extBal;
                    if (useExt > 0) { userCrossChainCredit[user] = extBal - useExt; }
                    uint256 rem = debit6 - useExt;
                    if (rem > 0) { userCollateral[user] -= rem; }
                    state.totalLoss6 += debit6;
                }
                
                uint256 shortfall = loss6 - debit6;
                if (shortfall > 0) {
                    marketBadDebt[marketId] += shortfall;
                    state.badDebt6 += shortfall;
                    emit BadDebtRecorded(marketId, shortfall, user);
                }
            }

            // Release margin
            uint256 locked = pos.marginLocked;
            if (locked > 0) {
                if (totalMarginLocked >= locked) {
                    totalMarginLocked -= locked;
                } else {
                    totalMarginLocked = 0;
                }
                if (userTotalMarginLocked[user] >= locked) {
                    userTotalMarginLocked[user] -= locked;
                } else {
                    userTotalMarginLocked[user] = 0;
                }
            }

            // Clear position index
            userPositionIndex[user][marketId] = 0;

            // Remove position using swap-and-pop
            if (i < positions.length - 1) {
                positions[i] = positions[positions.length - 1];
                userPositionIndex[user][positions[i].marketId] = i + 1;
            }
            positions.pop();
            // Don't increment i since we swapped in a new element
        }

        // Remove market from user's market list
        PositionManager.removeMarketIdFromUserWithIndex(userMarketIds[user], userMarketIdIndex[user], marketId);
    }

    function _removeUserFromMarketPositionsInternal(address user, bytes32 marketId) internal {
        uint256 idx = marketPositionUserIndex[marketId][user];
        if (idx == 0) return;
        uint256 lastIdx = marketPositionUsers[marketId].length;
        if (idx != lastIdx) {
            address lastUser = marketPositionUsers[marketId][lastIdx - 1];
            marketPositionUsers[marketId][idx - 1] = lastUser;
            marketPositionUserIndex[marketId][lastUser] = idx;
        }
        marketPositionUsers[marketId].pop();
        marketPositionUserIndex[marketId][user] = 0;
    }

    function _getUsersWithPositionsInMarket(bytes32 marketId) internal view returns (address[] memory) {
        // First try to use the optimized marketPositionUsers array
        address[] storage optimizedUsers = marketPositionUsers[marketId];
        if (optimizedUsers.length > 0) {
            address[] memory result = new address[](optimizedUsers.length);
            for (uint256 i = 0; i < optimizedUsers.length; i++) {
                result[i] = optimizedUsers[i];
            }
            return result;
        }

        // Fallback to legacy method for backwards compatibility
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
}
