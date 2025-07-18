// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISimpleVAMM
 * @dev Simple interface for VAMM operations (testing only)
 */
interface ISimpleVAMM {
    struct Position {
        uint256 positionId;
        int256 size;
        bool isLong;
        uint256 entryPrice;
        uint256 entryFundingIndex;
        uint256 lastInteractionTime;
        bool isActive;
    }

    function openPosition(
        uint256 collateralAmount,
        bool isLong,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external returns (uint256 positionId);

    function closePosition(
        uint256 positionId,
        uint256 sizeToClose,
        uint256 minPrice,
        uint256 maxPrice
    ) external returns (int256 pnl);

    function getMarkPrice() external view returns (uint256);
    function getPriceImpact(uint256 size, bool isLong) external view returns (uint256);
    function getUserPositions(address user) external view returns (Position[] memory);
    function getUnrealizedPnL(uint256 positionId) external view returns (int256);
    function getPosition(uint256 positionId) external view returns (Position memory);
} 