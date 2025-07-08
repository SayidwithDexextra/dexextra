// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IvAMM
 * @dev Interface for the virtual Automated Market Maker
 */
interface IvAMM {
    struct Position {
        int256 size; // Positive = LONG, Negative = SHORT
        uint256 entryPrice;
        uint256 entryFundingIndex;
        uint256 lastInteractionTime;
    }

    struct FundingState {
        int256 fundingRate; // Current funding rate (per hour)
        uint256 fundingIndex; // Cumulative funding index
        uint256 lastFundingTime;
        int256 premiumFraction; // Premium/discount relative to index price
    }

    /**
     * @dev Opens or modifies a position
     */
    function openPosition(
        uint256 collateralAmount,
        bool isLong,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external returns (uint256 positionSize);

    /**
     * @dev Closes a position partially or fully
     */
    function closePosition(
        uint256 sizeToClose,
        uint256 minPrice,
        uint256 maxPrice
    ) external returns (int256 pnl);

    /**
     * @dev Gets current mark price
     */
    function getMarkPrice() external view returns (uint256);

    /**
     * @dev Gets current funding rate
     */
    function getFundingRate() external view returns (int256);

    /**
     * @dev Updates funding rate
     */
    function updateFunding() external;

    /**
     * @dev Gets position data for a user
     */
    function getPosition(address user) external view returns (Position memory);

    /**
     * @dev Gets funding state
     */
    function getFundingState() external view returns (FundingState memory);

    /**
     * @dev Calculates unrealized PnL for a position
     */
    function getUnrealizedPnL(address user) external view returns (int256);

    /**
     * @dev Gets the price impact for a trade
     */
    function getPriceImpact(uint256 size, bool isLong) external view returns (uint256);

    /**
     * @dev Emergency pause trading
     */
    function pause() external;

    /**
     * @dev Resume trading
     */
    function unpause() external;
} 