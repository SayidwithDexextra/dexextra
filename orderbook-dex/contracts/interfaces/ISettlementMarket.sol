// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ISettlementMarket
 * @dev Interface for settlement-based metric markets
 * @notice Handles market lifecycle, settlement, and position resolution
 */
interface ISettlementMarket {
    /**
     * @dev Market lifecycle states
     */
    enum MarketState {
        ACTIVE,           // Trading is active
        TRADING_ENDED,    // Trading has ended, awaiting settlement
        SETTLEMENT_REQUESTED, // Settlement data requested from UMA
        SETTLED,          // Market has been settled
        EXPIRED,          // Market expired without settlement
        PAUSED            // Market is paused
    }

    /**
     * @dev Settlement information
     */
    struct SettlementInfo {
        bool isSettled;
        int256 settlementValue;
        uint256 settlementTimestamp;
        bytes32 umaRequestId;
        uint256 totalPayouts;
        uint256 totalPositions;
    }

    /**
     * @dev Position information for settlement
     */
    struct Position {
        address trader;
        bool isLong;          // true for long, false for short
        uint256 quantity;     // Position size
        uint256 entryPrice;   // Average entry price
        uint256 collateral;   // Collateral posted
        bool isSettled;       // Whether position has been settled
        uint256 payout;       // Settlement payout amount
    }

    /**
     * @dev Emitted when market state changes
     */
    event MarketStateChanged(
        string indexed metricId,
        MarketState indexed oldState,
        MarketState indexed newState,
        uint256 timestamp
    );

    /**
     * @dev Emitted when settlement data is requested
     */
    event SettlementRequested(
        string indexed metricId,
        bytes32 indexed umaRequestId,
        uint256 settlementDate,
        bytes ancillaryData
    );

    /**
     * @dev Emitted when market is settled
     */
    event MarketSettled(
        string indexed metricId,
        int256 settlementValue,
        uint256 timestamp,
        uint256 totalPayouts
    );

    /**
     * @dev Emitted when position is settled
     */
    event PositionSettled(
        address indexed trader,
        string indexed metricId,
        uint256 positionId,
        uint256 payout,
        int256 pnl
    );

    /**
     * @dev Gets the current market state
     * @return state Current market state
     */
    function getMarketState() external view returns (MarketState state);

    /**
     * @dev Gets settlement information
     * @return info Settlement information struct
     */
    function getSettlementInfo() external view returns (SettlementInfo memory info);

    /**
     * @dev Gets market timing information
     * @return settlementDate When the market settles
     * @return tradingEndDate When trading ends
     * @return dataRequestWindow Window before settlement to request data
     */
    function getMarketTiming()
        external
        view
        returns (
            uint256 settlementDate,
            uint256 tradingEndDate,
            uint256 dataRequestWindow
        );

    /**
     * @dev Checks if trading is currently allowed
     * @return allowed Whether trading is allowed
     */
    function isTradingAllowed() external view returns (bool allowed);

    /**
     * @dev Checks if market is ready for settlement
     * @return ready Whether settlement can be initiated
     */
    function isReadyForSettlement() external view returns (bool ready);

    /**
     * @dev Requests settlement data from UMA Oracle
     * @param ancillaryData Additional context for the settlement request
     * @return requestId UMA request ID
     */
    function requestSettlement(bytes calldata ancillaryData)
        external
        returns (bytes32 requestId);

    /**
     * @dev Settles the market with final value from UMA
     * @param finalValue The settlement value from UMA Oracle
     */
    function settleMarket(int256 finalValue) external;

    /**
     * @dev Settles individual positions after market settlement
     * @param positionIds Array of position IDs to settle
     */
    function settlePositions(uint256[] calldata positionIds) external;

    /**
     * @dev Gets user's positions in the market
     * @param trader Trader address
     * @return positions Array of position structs
     */
    function getUserPositions(address trader)
        external
        view
        returns (Position[] memory positions);

    /**
     * @dev Gets all positions in the market
     * @param offset Offset for pagination
     * @param limit Maximum number of positions to return
     * @return positions Array of position structs
     */
    function getAllPositions(uint256 offset, uint256 limit)
        external
        view
        returns (Position[] memory positions);

    /**
     * @dev Calculates settlement payout for a position
     * @param positionId Position ID
     * @param settlementValue Final settlement value
     * @return payout Settlement payout amount
     * @return pnl Profit/loss for the position
     */
    function calculatePositionPayout(uint256 positionId, int256 settlementValue)
        external
        view
        returns (uint256 payout, int256 pnl);

    /**
     * @dev Gets total open interest (long and short)
     * @return longInterest Total long position value
     * @return shortInterest Total short position value
     */
    function getOpenInterest()
        external
        view
        returns (uint256 longInterest, uint256 shortInterest);

    /**
     * @dev Gets settlement statistics
     * @return totalPositions Number of positions at settlement
     * @return totalPayouts Total payout amount
     * @return averagePnL Average P&L across all positions
     * @return settledPositions Number of positions already settled
     */
    function getSettlementStats()
        external
        view
        returns (
            uint256 totalPositions,
            uint256 totalPayouts,
            int256 averagePnL,
            uint256 settledPositions
        );

    /**
     * @dev Emergency function to extend trading deadline
     * @param newTradingEndDate New trading end timestamp
     * @param newSettlementDate New settlement timestamp
     */
    function extendMarketDeadline(
        uint256 newTradingEndDate,
        uint256 newSettlementDate
    ) external;

    /**
     * @dev Emergency function to pause/unpause the market
     * @param isPaused New pause state
     */
    function setPaused(bool isPaused) external;

    /**
     * @dev Gets time until various market events
     * @return timeToTradingEnd Seconds until trading ends
     * @return timeToSettlement Seconds until settlement
     * @return timeToDataRequest Seconds until data request window
     */
    function getTimeToEvents()
        external
        view
        returns (
            uint256 timeToTradingEnd,
            uint256 timeToSettlement,
            uint256 timeToDataRequest
        );

    /**
     * @dev Checks if position can be modified
     * @param positionId Position ID to check
     * @return canModify Whether position can be modified
     * @return reason Reason if modification is not allowed
     */
    function canModifyPosition(uint256 positionId)
        external
        view
        returns (bool canModify, string memory reason);

    /**
     * @dev Gets market settlement deadline info
     * @return deadline Maximum time to complete settlement
     * @return isExpired Whether settlement deadline has passed
     */
    function getSettlementDeadline()
        external
        view
        returns (uint256 deadline, bool isExpired);
}
