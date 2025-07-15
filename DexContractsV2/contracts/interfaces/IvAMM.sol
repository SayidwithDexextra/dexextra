// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IvAMM
 * @dev Enhanced interface for the virtual Automated Market Maker with multiple position support
 */
interface IvAMM {
    struct Position {
        uint256 positionId; // Unique position identifier
        int256 size; // Position size in USD (always positive, direction determined by isLong)
        bool isLong; // True for long, false for short
        uint256 entryPrice;
        uint256 entryFundingIndex;
        uint256 lastInteractionTime;
        bool isActive; // Whether position is currently active
    }

    struct FundingState {
        int256 fundingRate; // Current funding rate (per hour)
        uint256 fundingIndex; // Cumulative funding index
        uint256 lastFundingTime;
        int256 premiumFraction; // Premium/discount relative to index price
    }

    /**
     * @dev Opens a new position
     */
    function openPosition(
        uint256 collateralAmount,
        bool isLong,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external returns (uint256 positionId);

    /**
     * @dev Adds to an existing position
     */
    function addToPosition(
        uint256 positionId,
        uint256 collateralAmount,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external returns (uint256 newSize);

    /**
     * @dev Closes a position partially or fully
     */
    function closePosition(
        uint256 positionId,
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
     * @dev Gets position data by position ID
     */
    function getPosition(uint256 positionId) external view returns (Position memory);

    /**
     * @dev Gets position data by user and position ID
     */
    function getUserPosition(address user, uint256 positionId) external view returns (Position memory);

    /**
     * @dev Gets all active positions for a user
     */
    function getUserPositions(address user) external view returns (Position[] memory);

    /**
     * @dev Gets all active position IDs for a user
     */
    function getUserPositionIds(address user) external view returns (uint256[] memory);

    /**
     * @dev Gets funding state
     */
    function getFundingState() external view returns (FundingState memory);

    /**
     * @dev Calculates unrealized PnL for a specific position
     */
    function getUnrealizedPnL(uint256 positionId) external view returns (int256);

    /**
     * @dev Calculates total unrealized PnL for a user across all positions
     */
    function getTotalUnrealizedPnL(address user) external view returns (int256);

    /**
     * @dev Gets the price impact for a trade
     */
    function getPriceImpact(uint256 size, bool isLong) external view returns (uint256);

    /**
     * @dev Gets user's trading summary
     */
    function getUserSummary(address user) external view returns (
        uint256 totalLongSize,
        uint256 totalShortSize,
        int256 totalPnL,
        uint256 activePositionsCount
    );

    /**
     * @dev Gets effective virtual reserves (for dynamic reserves)
     */
    function getEffectiveReserves() external view returns (uint256 baseReserves, uint256 quoteReserves);

    /**
     * @dev Gets reserve information including multiplier
     */
    function getReserveInfo() external view returns (
        uint256 baseReserves,
        uint256 quoteReserves,
        uint256 multiplier,
        uint256 totalVolume
    );
} 