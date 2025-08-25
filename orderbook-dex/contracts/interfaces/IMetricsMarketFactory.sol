// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./IOrderRouter.sol";

/**
 * @title IMetricsMarketFactory
 * @dev Interface for the Metrics Market Factory contract
 * @notice Creates and manages custom metric trading markets
 */
interface IMetricsMarketFactory {
    /**
     * @dev Emitted when a new market is created
     */
    event MarketCreated(
        string indexed metricId,
        address indexed marketAddress,
        address indexed creator,
        string description,
        address oracleProvider,
        uint256 settlementDate,
        uint256 tradingEndDate
    );

    /**
     * @dev Emitted when a market is paused/unpaused
     */
    event MarketStatusChanged(
        string indexed metricId,
        address indexed marketAddress,
        bool isActive
    );

    /**
     * @dev Emitted when an initial order is placed during market creation
     */
    event InitialOrderPlaced(
        string indexed metricId,
        address indexed marketAddress,
        address indexed creator,
        IOrderRouter.Side side,
        uint256 quantity,
        uint256 price,
        uint256 orderId
    );

    /**
     * @dev Initial order configuration for market creation
     */
    struct InitialOrder {
        bool enabled;                    // Whether to place an initial order
        IOrderRouter.Side side;          // BUY or SELL
        uint256 quantity;               // Order quantity
        uint256 price;                  // Order price (must align with tickSize)
        IOrderRouter.TimeInForce timeInForce; // Time in force (GTC, GTD, etc.)
        uint256 expiryTime;             // Expiry time (for GTD orders)
    }

    /**
     * @dev Market configuration parameters
     */
    struct MarketConfig {
        string metricId;
        string description;
        address oracleProvider;
        uint8 decimals;
        uint256 minimumOrderSize;
        uint256 tickSize; // Deprecated: tick size is now fixed at 0.01
        uint256 creationFee;
        bool requiresKYC;
        uint256 settlementDate;      // Unix timestamp for market settlement
        uint256 tradingEndDate;      // When trading stops (before settlement)
        uint256 dataRequestWindow;   // How long before settlement to request data
        bool autoSettle;             // Whether market auto-settles or needs manual trigger
        InitialOrder initialOrder;   // Optional initial order to place
    }

    /**
     * @dev Creates a new market for a custom metric
     * @param config Market configuration parameters
     * @return marketAddress Address of the deployed market contract
     */
    function createMarket(MarketConfig calldata config)
        external
        payable
        returns (address marketAddress);

    /**
     * @dev Returns the address of a market for a given metric ID
     * @param metricId The unique identifier for the metric
     * @return marketAddress Address of the market contract
     */
    function getMarket(string calldata metricId)
        external
        view
        returns (address marketAddress);

    /**
     * @dev Returns all active markets
     * @return markets Array of market addresses
     */
    function getAllMarkets() external view returns (address[] memory markets);

    /**
     * @dev Pauses/unpauses a market
     * @param metricId The metric ID to pause/unpause
     * @param isActive New status for the market
     */
    function setMarketStatus(string calldata metricId, bool isActive) external;

    /**
     * @dev Updates market parameters
     * @param metricId The metric ID to update
     * @param minimumOrderSize New minimum order size
     * @param tickSize Deprecated: tick size is now fixed at 0.01
     */
    function updateMarketParameters(
        string calldata metricId,
        uint256 minimumOrderSize,
        uint256 tickSize
    ) external;

    /**
     * @dev Checks if a market exists for a given metric
     * @param metricId The metric ID to check
     * @return exists True if market exists
     */
    function marketExists(string calldata metricId)
        external
        view
        returns (bool exists);

    /**
     * @dev Returns market configuration
     * @param metricId The metric ID to query
     * @return config Market configuration struct
     */
    function getMarketConfig(string calldata metricId)
        external
        view
        returns (MarketConfig memory config);

    /**
     * @dev Triggers settlement for a market (when settlement date is reached)
     * @param metricId The metric ID to settle
     * @param finalValue The final settlement value from UMA
     */
    function settleMarket(string calldata metricId, int256 finalValue) external;

    /**
     * @dev Requests settlement data from UMA Oracle
     * @param metricId The metric ID to request settlement data for
     * @param ancillaryData Additional context for the settlement request
     * @return requestId The UMA request ID
     */
    function requestSettlementData(
        string calldata metricId,
        bytes calldata ancillaryData
    ) external returns (bytes32 requestId);

    /**
     * @dev Gets market settlement information
     * @param metricId The metric ID to query
     * @return isSettled Whether the market has been settled
     * @return settlementValue The final settlement value
     * @return settlementTimestamp When the market was settled
     */
    function getMarketSettlement(string calldata metricId)
        external
        view
        returns (
            bool isSettled,
            int256 settlementValue,
            uint256 settlementTimestamp
        );

    /**
     * @dev Gets markets approaching settlement
     * @param timeWindow Time window in seconds to look ahead
     * @return metricIds Array of metric IDs approaching settlement
     */
    function getMarketsApproachingSettlement(uint256 timeWindow)
        external
        view
        returns (string[] memory metricIds);

    /**
     * @dev Gets all settled markets
     * @return metricIds Array of settled market metric IDs
     */
    function getSettledMarkets()
        external
        view
        returns (string[] memory metricIds);
}
