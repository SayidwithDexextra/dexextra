// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IUMAOracleIntegration
 * @dev Interface for UMA Optimistic Oracle V3 integration
 * @notice Handles data requests and verification for custom metrics
 */
interface IUMAOracleIntegration {
    /**
     * @dev Data request structure for UMA Oracle
     */
    struct DataRequest {
        bytes32 identifier;          // Unique identifier for the metric (e.g., "WORLD_POPULATION")
        uint256 timestamp;           // Timestamp for the requested data
        bytes ancillaryData;         // Additional context and parameters
        IERC20 currency;            // ERC20 token for fees and bonds
        uint256 reward;             // Reward for the proposer
        uint256 bond;               // Bond amount required
        uint256 customLiveness;     // Custom liveness period in seconds
        address requester;          // Address that made the request
        bool isResolved;            // Whether the request has been resolved
        int256 resolvedValue;       // The resolved value from UMA
        uint256 requestTime;        // When the request was made
    }

    /**
     * @dev Metric configuration for UMA integration
     */
    struct MetricConfig {
        bytes32 identifier;         // UMA identifier
        string description;         // Human-readable description
        uint8 decimals;            // Decimal precision
        uint256 minBond;           // Minimum bond required
        uint256 defaultReward;     // Default reward amount
        uint256 livenessPeriod;    // Default liveness period
        bool isActive;             // Whether metric is active
        address[] authorizedRequesters; // Authorized addresses that can request data
    }

    /**
     * @dev Emitted when a data request is made to UMA
     */
    event DataRequested(
        bytes32 indexed identifier,
        uint256 indexed timestamp,
        address indexed requester,
        bytes ancillaryData,
        uint256 reward,
        uint256 bond
    );

    /**
     * @dev Emitted when UMA resolves a data request
     */
    event DataResolved(
        bytes32 indexed identifier,
        uint256 indexed timestamp,
        address indexed requester,
        int256 resolvedValue,
        uint256 resolutionTime
    );

    /**
     * @dev Emitted when a data request is disputed
     */
    event DataDisputed(
        bytes32 indexed identifier,
        uint256 indexed timestamp,
        address indexed disputer,
        uint256 disputeTime
    );

    /**
     * @dev Emitted when a metric configuration is updated
     */
    event MetricConfigUpdated(
        bytes32 indexed identifier,
        string description,
        uint256 minBond,
        uint256 defaultReward,
        bool isActive
    );

    /**
     * @dev Requests data from UMA Oracle for a specific metric
     * @param identifier The metric identifier
     * @param timestamp The timestamp for the requested data
     * @param ancillaryData Additional context for the request
     * @param reward Optional reward for the proposer
     * @param customLiveness Custom liveness period (0 for default)
     * @return requestId Unique identifier for this request
     */
    function requestMetricData(
        bytes32 identifier,
        uint256 timestamp,
        bytes calldata ancillaryData,
        uint256 reward,
        uint256 customLiveness
    ) external returns (bytes32 requestId);

    /**
     * @dev Checks if a data request has been resolved
     * @param requestId The request identifier
     * @return isResolved Whether the request is resolved
     * @return resolvedValue The resolved value (if resolved)
     */
    function getRequestStatus(bytes32 requestId)
        external
        view
        returns (bool isResolved, int256 resolvedValue);

    /**
     * @dev Gets the latest resolved value for a metric
     * @param identifier The metric identifier
     * @return value The latest resolved value
     * @return timestamp The timestamp of the resolution
     */
    function getLatestMetricValue(bytes32 identifier)
        external
        view
        returns (int256 value, uint256 timestamp);

    /**
     * @dev Gets historical values for a metric
     * @param identifier The metric identifier
     * @param fromTimestamp Start timestamp
     * @param toTimestamp End timestamp
     * @return timestamps Array of timestamps
     * @return values Array of corresponding values
     */
    function getHistoricalValues(
        bytes32 identifier,
        uint256 fromTimestamp,
        uint256 toTimestamp
    )
        external
        view
        returns (uint256[] memory timestamps, int256[] memory values);

    /**
     * @dev Configures a new metric for UMA integration
     * @param config Metric configuration parameters
     */
    function configureMetric(MetricConfig calldata config) external;

    /**
     * @dev Updates an existing metric configuration
     * @param identifier The metric identifier
     * @param minBond New minimum bond
     * @param defaultReward New default reward
     * @param livenessPeriod New liveness period
     * @param isActive New active status
     */
    function updateMetricConfig(
        bytes32 identifier,
        uint256 minBond,
        uint256 defaultReward,
        uint256 livenessPeriod,
        bool isActive
    ) external;

    /**
     * @dev Gets metric configuration
     * @param identifier The metric identifier
     * @return config Metric configuration
     */
    function getMetricConfig(bytes32 identifier)
        external
        view
        returns (MetricConfig memory config);

    /**
     * @dev Adds an authorized requester for a metric
     * @param identifier The metric identifier
     * @param requester Address to authorize
     */
    function addAuthorizedRequester(bytes32 identifier, address requester) external;

    /**
     * @dev Removes an authorized requester for a metric
     * @param identifier The metric identifier
     * @param requester Address to remove
     */
    function removeAuthorizedRequester(bytes32 identifier, address requester) external;

    /**
     * @dev Checks if an address is authorized to request data for a metric
     * @param identifier The metric identifier
     * @param requester Address to check
     * @return isAuthorized Whether the address is authorized
     */
    function isAuthorizedRequester(bytes32 identifier, address requester)
        external
        view
        returns (bool isAuthorized);

    /**
     * @dev Gets all active metrics
     * @return identifiers Array of active metric identifiers
     */
    function getActiveMetrics() external view returns (bytes32[] memory identifiers);

    /**
     * @dev Gets pending requests for a metric
     * @param identifier The metric identifier
     * @return requestIds Array of pending request IDs
     */
    function getPendingRequests(bytes32 identifier)
        external
        view
        returns (bytes32[] memory requestIds);

    /**
     * @dev Emergency function to pause metric requests
     * @param identifier The metric identifier
     */
    function pauseMetric(bytes32 identifier) external;

    /**
     * @dev Emergency function to unpause metric requests
     * @param identifier The metric identifier
     */
    function unpauseMetric(bytes32 identifier) external;

    /**
     * @dev Sets the UMA Optimistic Oracle address
     * @param oracleAddress New oracle address
     */
    function setOptimisticOracle(address oracleAddress) external;

    /**
     * @dev Gets the current UMA Optimistic Oracle address
     * @return oracleAddress Current oracle address
     */
    function getOptimisticOracle() external view returns (address oracleAddress);
}
