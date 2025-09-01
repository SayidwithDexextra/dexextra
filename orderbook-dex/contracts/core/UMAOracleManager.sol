// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IUMAOracleIntegration.sol";

// UMA Oracle V3 interfaces
interface IOptimisticOracleV3 {
    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        IERC20 currency,
        uint256 reward
    ) external returns (bytes32 requestId);

    function proposePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice
    ) external returns (uint256 totalBond);

    function disputePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external returns (uint256 totalBond);

    function settle(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external returns (int256 price);

    function getRequest(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external view returns (
        bool disputed,
        bool resolved,
        bool payoutRequestToPusher,
        int256 resolvedPrice,
        uint256 expirationTime,
        uint256 reward,
        uint256 finalFee
    );

    function hasPrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external view returns (bool);
}

interface IFinder {
    function getImplementationAddress(bytes32 interfaceName)
        external
        view
        returns (address);
}

/**
 * @title UMAOracleManager
 * @dev Manages UMA Optimistic Oracle V3 integration for custom metrics
 * @notice Handles data requests, resolution, and metric configuration
 */
contract UMAOracleManager is 
    IUMAOracleIntegration, 
    AccessControl, 
    ReentrancyGuard, 
    Pausable 
{
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant ORACLE_ADMIN_ROLE = keccak256("ORACLE_ADMIN_ROLE");
    bytes32 public constant METRIC_MANAGER_ROLE = keccak256("METRIC_MANAGER_ROLE");
    bytes32 public constant REQUESTER_ROLE = keccak256("REQUESTER_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    // UMA Protocol contracts
    IOptimisticOracleV3 public optimisticOracle;
    IFinder public immutable finder;
    IERC20 public immutable bondCurrency;

    // State variables
    mapping(bytes32 => MetricConfig) public metricConfigs;
    mapping(bytes32 => DataRequest) public dataRequests;
    mapping(bytes32 => mapping(uint256 => int256)) public historicalValues;
    mapping(bytes32 => uint256[]) public metricTimestamps;
    mapping(bytes32 => bytes32[]) public pendingRequests;
    
    bytes32[] public activeMetrics;
    uint256 public constant DEFAULT_LIVENESS = 7200; // 2 hours
    uint256 public constant MIN_BOND = 1000 * 1e18; // 1000 tokens minimum
    
    // Events
    event OracleAddressUpdated(address indexed oldOracle, address indexed newOracle);
    event RequestSettled(bytes32 indexed requestId, int256 resolvedValue);

    /**
     * @dev Constructor
     * @param _finder UMA Finder contract address
     * @param _bondCurrency ERC20 token for bonds and fees
     * @param _admin Admin address
     */
    constructor(
        address _finder,
        address _bondCurrency,
        address _admin
    ) {
        require(_finder != address(0), "UMAOracleManager: Invalid finder");
        require(_bondCurrency != address(0), "UMAOracleManager: Invalid bond currency");
        require(_admin != address(0), "UMAOracleManager: Invalid admin");

        finder = IFinder(_finder);
        bondCurrency = IERC20(_bondCurrency);
        
        // Get OptimisticOracleV3 address from Finder
        optimisticOracle = IOptimisticOracleV3(
            finder.getImplementationAddress(bytes32("OptimisticOracleV3"))
        );

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ORACLE_ADMIN_ROLE, _admin);
        _grantRole(METRIC_MANAGER_ROLE, _admin);
    }

    /**
     * @dev Requests data from UMA Oracle for a specific metric
     */
    function requestMetricData(
        bytes32 identifier,
        uint256 timestamp,
        bytes calldata ancillaryData,
        uint256 reward,
        uint256 customLiveness
    ) external override nonReentrant whenNotPaused returns (bytes32 requestId) {
        MetricConfig storage config = metricConfigs[identifier];
        require(config.isActive, "UMAOracleManager: Metric not active");
        require(
            hasRole(REQUESTER_ROLE, msg.sender) || 
            _isAuthorizedRequester(identifier, msg.sender),
            "UMAOracleManager: Not authorized"
        );
        require(timestamp <= block.timestamp, "UMAOracleManager: Future timestamp");
        require(timestamp > 0, "UMAOracleManager: Invalid timestamp");

        // Calculate bond and reward with overflow protection
        uint256 bondAmount = reward > 0 ? reward : config.defaultReward;
        bondAmount = bondAmount < config.minBond ? config.minBond : bondAmount;
        uint256 liveness = customLiveness > 0 ? customLiveness : config.livenessPeriod;

        // Validate bond amount to prevent overflow
        require(bondAmount <= type(uint256).max / 2, "UMAOracleManager: Bond amount too large");

        // Generate unique request ID with additional entropy
        requestId = keccak256(
            abi.encodePacked(identifier, timestamp, msg.sender, block.timestamp, block.prevrandao)
        );
        
        // Ensure request ID is unique
        require(dataRequests[requestId].requester == address(0), "UMAOracleManager: Request ID collision");

        // Validate requester has sufficient balance before proceeding
        require(
            bondCurrency.balanceOf(msg.sender) >= bondAmount,
            "UMAOracleManager: Insufficient bond balance"
        );
        require(
            bondCurrency.allowance(msg.sender, address(this)) >= bondAmount,
            "UMAOracleManager: Insufficient bond allowance"
        );

        // Store request data
        dataRequests[requestId] = DataRequest({
            identifier: identifier,
            timestamp: timestamp,
            ancillaryData: ancillaryData,
            currency: bondCurrency,
            reward: reward,
            bond: bondAmount,
            customLiveness: liveness,
            requester: msg.sender,
            isResolved: false,
            resolvedValue: 0,
            requestTime: block.timestamp
        });

        // Add to pending requests with gas limit protection
        require(pendingRequests[identifier].length < 1000, "UMAOracleManager: Too many pending requests");
        pendingRequests[identifier].push(requestId);

        // Transfer bond from requester
        bondCurrency.safeTransferFrom(msg.sender, address(this), bondAmount);
        
        // Approve UMA Oracle to spend bond
        bondCurrency.safeApprove(address(optimisticOracle), bondAmount);

        // Make request to UMA Oracle
        optimisticOracle.requestPrice(
            identifier,
            timestamp,
            ancillaryData,
            bondCurrency,
            reward
        );

        emit DataRequested(identifier, timestamp, msg.sender, ancillaryData, reward, bondAmount);
    }

    /**
     * @dev Settles a resolved request and updates historical data
     */
    function settleRequest(bytes32 requestId) external nonReentrant {
        DataRequest storage request = dataRequests[requestId];
        require(request.requester != address(0), "UMAOracleManager: Request not found");
        require(!request.isResolved, "UMAOracleManager: Already resolved");

        // Check if UMA has resolved the request
        (bool disputed, bool resolved, , int256 resolvedPrice, , , ) = optimisticOracle.getRequest(
            address(this),
            request.identifier,
            request.timestamp,
            request.ancillaryData
        );

        require(resolved, "UMAOracleManager: Not yet resolved");

        // Settle with UMA Oracle
        int256 finalPrice = optimisticOracle.settle(
            address(this),
            request.identifier,
            request.timestamp,
            request.ancillaryData
        );

        // Update request
        request.isResolved = true;
        request.resolvedValue = finalPrice;

        // Store historical value
        historicalValues[request.identifier][request.timestamp] = finalPrice;
        metricTimestamps[request.identifier].push(request.timestamp);

        // Remove from pending requests
        _removePendingRequest(request.identifier, requestId);

        emit DataResolved(
            request.identifier,
            request.timestamp,
            request.requester,
            finalPrice,
            block.timestamp
        );
        emit RequestSettled(requestId, finalPrice);
    }

    /**
     * @dev Gets the status of a data request
     */
    function getRequestStatus(bytes32 requestId)
        external
        view
        override
        returns (bool isResolved, int256 resolvedValue)
    {
        DataRequest storage request = dataRequests[requestId];
        return (request.isResolved, request.resolvedValue);
    }

    /**
     * @dev Gets the latest resolved value for a metric
     */
    function getLatestMetricValue(bytes32 identifier)
        external
        view
        override
        returns (int256 value, uint256 timestamp)
    {
        uint256[] storage timestamps = metricTimestamps[identifier];
        if (timestamps.length == 0) {
            return (0, 0);
        }
        
        uint256 latestTimestamp = timestamps[timestamps.length - 1];
        return (historicalValues[identifier][latestTimestamp], latestTimestamp);
    }

    /**
     * @dev Gets historical values for a metric
     */
    function getHistoricalValues(
        bytes32 identifier,
        uint256 fromTimestamp,
        uint256 toTimestamp
    )
        external
        view
        override
        returns (uint256[] memory timestamps, int256[] memory values)
    {
        uint256[] storage allTimestamps = metricTimestamps[identifier];
        
        // Count valid timestamps
        uint256 count = 0;
        for (uint256 i = 0; i < allTimestamps.length; i++) {
            if (allTimestamps[i] >= fromTimestamp && allTimestamps[i] <= toTimestamp) {
                count++;
            }
        }

        // Create result arrays
        timestamps = new uint256[](count);
        values = new int256[](count);
        
        // Fill result arrays
        uint256 index = 0;
        for (uint256 i = 0; i < allTimestamps.length; i++) {
            if (allTimestamps[i] >= fromTimestamp && allTimestamps[i] <= toTimestamp) {
                timestamps[index] = allTimestamps[i];
                values[index] = historicalValues[identifier][allTimestamps[i]];
                index++;
            }
        }
    }

    /**
     * @dev Configures a new metric for UMA integration
     */
    function configureMetric(MetricConfig calldata config) 
        external 
        override 
    {
        require(
            hasRole(METRIC_MANAGER_ROLE, msg.sender) || hasRole(FACTORY_ROLE, msg.sender),
            "UMAOracleManager: Not authorized to configure metrics"
        );
        require(config.minBond >= MIN_BOND, "UMAOracleManager: Bond too low");
        require(config.livenessPeriod >= 3600, "UMAOracleManager: Liveness too short"); // Min 1 hour
        
        metricConfigs[config.identifier] = config;
        
        if (config.isActive && !_isActiveMetric(config.identifier)) {
            activeMetrics.push(config.identifier);
        }

        emit MetricConfigUpdated(
            config.identifier,
            config.description,
            config.minBond,
            config.defaultReward,
            config.isActive
        );
    }

    /**
     * @dev Updates an existing metric configuration
     */
    function updateMetricConfig(
        bytes32 identifier,
        uint256 minBond,
        uint256 defaultReward,
        uint256 livenessPeriod,
        bool isActive
    ) external override onlyRole(METRIC_MANAGER_ROLE) {
        require(metricConfigs[identifier].identifier == identifier, "UMAOracleManager: Metric not found");
        require(minBond >= MIN_BOND, "UMAOracleManager: Bond too low");
        require(livenessPeriod >= 3600, "UMAOracleManager: Liveness too short");

        MetricConfig storage config = metricConfigs[identifier];
        config.minBond = minBond;
        config.defaultReward = defaultReward;
        config.livenessPeriod = livenessPeriod;
        config.isActive = isActive;

        emit MetricConfigUpdated(identifier, config.description, minBond, defaultReward, isActive);
    }

    /**
     * @dev Gets metric configuration
     */
    function getMetricConfig(bytes32 identifier)
        external
        view
        override
        returns (MetricConfig memory config)
    {
        return metricConfigs[identifier];
    }

    /**
     * @dev Adds an authorized requester for a metric
     */
    function addAuthorizedRequester(bytes32 identifier, address requester)
        external
        override
    {
        require(
            hasRole(METRIC_MANAGER_ROLE, msg.sender) || hasRole(FACTORY_ROLE, msg.sender),
            "UMAOracleManager: Not authorized to add requesters"
        );
        require(requester != address(0), "UMAOracleManager: Invalid requester");
        metricConfigs[identifier].authorizedRequesters.push(requester);
    }

    /**
     * @dev Removes an authorized requester for a metric
     */
    function removeAuthorizedRequester(bytes32 identifier, address requester)
        external
        override
        onlyRole(METRIC_MANAGER_ROLE)
    {
        address[] storage requesters = metricConfigs[identifier].authorizedRequesters;
        for (uint256 i = 0; i < requesters.length; i++) {
            if (requesters[i] == requester) {
                requesters[i] = requesters[requesters.length - 1];
                requesters.pop();
                break;
            }
        }
    }

    /**
     * @dev Checks if an address is authorized to request data for a metric
     */
    function isAuthorizedRequester(bytes32 identifier, address requester)
        external
        view
        override
        returns (bool isAuthorized)
    {
        return _isAuthorizedRequester(identifier, requester);
    }

    /**
     * @dev Gets all active metrics
     */
    function getActiveMetrics() external view override returns (bytes32[] memory identifiers) {
        uint256 count = 0;
        for (uint256 i = 0; i < activeMetrics.length; i++) {
            if (metricConfigs[activeMetrics[i]].isActive) {
                count++;
            }
        }

        identifiers = new bytes32[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < activeMetrics.length; i++) {
            if (metricConfigs[activeMetrics[i]].isActive) {
                identifiers[index] = activeMetrics[i];
                index++;
            }
        }
    }

    /**
     * @dev Gets pending requests for a metric
     */
    function getPendingRequests(bytes32 identifier)
        external
        view
        override
        returns (bytes32[] memory requestIds)
    {
        return pendingRequests[identifier];
    }

    /**
     * @dev Emergency function to pause metric requests
     */
    function pauseMetric(bytes32 identifier) external override onlyRole(ORACLE_ADMIN_ROLE) {
        metricConfigs[identifier].isActive = false;
    }

    /**
     * @dev Emergency function to unpause metric requests
     */
    function unpauseMetric(bytes32 identifier) external override onlyRole(ORACLE_ADMIN_ROLE) {
        metricConfigs[identifier].isActive = true;
    }

    /**
     * @dev Sets the UMA Optimistic Oracle address
     */
    function setOptimisticOracle(address oracleAddress) 
        external 
        override 
        onlyRole(ORACLE_ADMIN_ROLE) 
    {
        require(oracleAddress != address(0), "UMAOracleManager: Invalid oracle address");
        address oldOracle = address(optimisticOracle);
        optimisticOracle = IOptimisticOracleV3(oracleAddress);
        emit OracleAddressUpdated(oldOracle, oracleAddress);
    }

    /**
     * @dev Gets the current UMA Optimistic Oracle address
     */
    function getOptimisticOracle() external view override returns (address oracleAddress) {
        return address(optimisticOracle);
    }

    /**
     * @dev Pauses the contract
     */
    function pause() external onlyRole(ORACLE_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses the contract
     */
    function unpause() external onlyRole(ORACLE_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @dev Grants factory role to allow automatic metric configuration
     */
    function grantFactoryRole(address factory) external onlyRole(ORACLE_ADMIN_ROLE) {
        require(factory != address(0), "UMAOracleManager: Invalid factory address");
        grantRole(FACTORY_ROLE, factory);
    }

    /**
     * @dev Revokes factory role
     */
    function revokeFactoryRole(address factory) external onlyRole(ORACLE_ADMIN_ROLE) {
        revokeRole(FACTORY_ROLE, factory);
    }

    // Internal functions

    function _isAuthorizedRequester(bytes32 identifier, address requester) internal view returns (bool) {
        address[] storage requesters = metricConfigs[identifier].authorizedRequesters;
        for (uint256 i = 0; i < requesters.length; i++) {
            if (requesters[i] == requester) {
                return true;
            }
        }
        return false;
    }

    function _isActiveMetric(bytes32 identifier) internal view returns (bool) {
        for (uint256 i = 0; i < activeMetrics.length; i++) {
            if (activeMetrics[i] == identifier) {
                return true;
            }
        }
        return false;
    }

    function _removePendingRequest(bytes32 identifier, bytes32 requestId) internal {
        bytes32[] storage requests = pendingRequests[identifier];
        for (uint256 i = 0; i < requests.length; i++) {
            if (requests[i] == requestId) {
                requests[i] = requests[requests.length - 1];
                requests.pop();
                break;
            }
        }
    }
}
