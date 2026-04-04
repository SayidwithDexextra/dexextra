// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "./CoreVaultStorage.sol";
import "./PositionManager.sol";

contract SettlementManager is CoreVaultStorage {
    uint256 constant DECIMAL_SCALE = 1e12;
    uint256 constant TICK_PRECISION = 1e6;

    event HaircutApplied(bytes32 indexed marketId, uint256 scaleRay, uint256 totalMarginLocked, uint256 totalLiabilities);
    event VaultMarketSettled(bytes32 indexed marketId, uint256 finalPrice, uint256 totalProfit6, uint256 totalLoss6, uint256 badDebt6);
    event BadDebtRecorded(bytes32 indexed marketId, uint256 amount, address indexed liquidatedUser);

    constructor() {}

    function settleMarket(bytes32 marketId, uint256 finalPrice) external {
        require(marketToOrderBook[marketId] != address(0), "market!");
        require(!marketSettled[marketId], "settled");
        require(finalPrice > 0, "!price");

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

                if (i2 < positions.length - 1) {
                    positions[i2] = positions[positions.length - 1];
                }
                positions.pop();
            }

            PositionManager.removeMarketIdFromUser(userMarketIds[user2], marketId);
        }

        marketSettled[marketId] = true;
        emit VaultMarketSettled(marketId, finalPrice, totalProfit6, totalLoss6, badDebt6Total);
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
}
