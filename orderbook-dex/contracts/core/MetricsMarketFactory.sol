// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IMetricsMarketFactory.sol";
import "../interfaces/IUMAOracleIntegration.sol";
import "../interfaces/IOrderBook.sol";
import "../interfaces/ISettlementMarket.sol";

/**
 * @title MetricsMarketFactory
 * @dev Factory contract for creating custom metrics trading markets with UMA Oracle integration
 * @notice Creates and manages orderbook-based markets for real-world metrics
 */
contract MetricsMarketFactory is 
    IMetricsMarketFactory, 
    AccessControl, 
    ReentrancyGuard, 
    Pausable 
{
    using SafeERC20 for IERC20;
    using Clones for address;

    // Roles
    bytes32 public constant FACTORY_ADMIN_ROLE = keccak256("FACTORY_ADMIN_ROLE");
    bytes32 public constant MARKET_CREATOR_ROLE = keccak256("MARKET_CREATOR_ROLE");
    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");

    // State variables
    IUMAOracleIntegration public immutable umaOracleManager;
    address public immutable orderBookImplementation;
    address public immutable centralVault;
    address public immutable orderRouter;
    
    mapping(string => address) public markets;
    mapping(string => MarketConfig) public marketConfigs;
    mapping(address => string[]) public creatorMarkets;
    
    address[] public allMarkets;
    string[] public allMetricIds;
    
    uint256 public defaultCreationFee;
    address public feeRecipient;
    
    // UMA specific mappings
    mapping(string => bytes32) public metricToUMAIdentifier;
    mapping(bytes32 => string) public umaIdentifierToMetric;
    
    // Settlement tracking
    struct SettlementInfo {
        bool isSettled;
        int256 settlementValue;
        uint256 settlementTimestamp;
        bytes32 umaRequestId;
    }
    
    mapping(string => SettlementInfo) public marketSettlements;
    mapping(string => bytes32) public settlementRequests;
    string[] public settledMarkets;

    // Events
    event MarketImplementationUpdated(address indexed oldImplementation, address indexed newImplementation);
    event CreationFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event UMAIdentifierMapped(string indexed metricId, bytes32 indexed umaIdentifier);
    event SettlementRequested(string indexed metricId, bytes32 indexed requestId, uint256 settlementDate);
    event MarketSettled(string indexed metricId, int256 settlementValue, uint256 timestamp);


    /**
     * @dev Constructor
     * @param _umaOracleManager UMA Oracle Manager contract address
     * @param _orderBookImplementation OrderBook implementation contract
     * @param _centralVault Central Vault contract address
     * @param _orderRouter Order Router contract address
     * @param _admin Admin address
     * @param _defaultCreationFee Default fee for creating markets
     * @param _feeRecipient Address to receive creation fees
     */
    constructor(
        address _umaOracleManager,
        address _orderBookImplementation,
        address _centralVault,
        address _orderRouter,
        address _admin,
        uint256 _defaultCreationFee,
        address _feeRecipient
    ) {
        require(_umaOracleManager != address(0), "MetricsMarketFactory: Invalid UMA oracle manager");
        require(_orderBookImplementation != address(0), "MetricsMarketFactory: Invalid implementation");
        require(_centralVault != address(0), "MetricsMarketFactory: Invalid vault");
        require(_orderRouter != address(0), "MetricsMarketFactory: Invalid router");
        require(_admin != address(0), "MetricsMarketFactory: Invalid admin");
        require(_feeRecipient != address(0), "MetricsMarketFactory: Invalid fee recipient");

        umaOracleManager = IUMAOracleIntegration(_umaOracleManager);
        orderBookImplementation = _orderBookImplementation;
        centralVault = _centralVault;
        orderRouter = _orderRouter;
        defaultCreationFee = _defaultCreationFee;
        feeRecipient = _feeRecipient;

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(FACTORY_ADMIN_ROLE, _admin);
        _grantRole(MARKET_CREATOR_ROLE, _admin);
        _grantRole(ORACLE_MANAGER_ROLE, _admin);
    }

    /**
     * @dev Creates a new market for a custom metric with UMA Oracle integration
     */
    function createMarket(MarketConfig calldata config)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        returns (address marketAddress)
    {
        require(
            hasRole(MARKET_CREATOR_ROLE, msg.sender) || 
            msg.value >= (config.creationFee > 0 ? config.creationFee : defaultCreationFee),
            "MetricsMarketFactory: Insufficient fee or not authorized"
        );
        require(bytes(config.metricId).length > 0, "MetricsMarketFactory: Empty metric ID");
        require(bytes(config.description).length > 0, "MetricsMarketFactory: Empty description");
        require(config.oracleProvider != address(0), "MetricsMarketFactory: Invalid oracle provider");
        require(markets[config.metricId] == address(0), "MetricsMarketFactory: Market exists");
        require(config.minimumOrderSize > 0, "MetricsMarketFactory: Invalid min order size");
        // Tick size validation removed - now using fixed 0.01 precision
        require(config.settlementDate > block.timestamp, "MetricsMarketFactory: Settlement date must be in future");
        require(config.tradingEndDate > block.timestamp, "MetricsMarketFactory: Trading end date must be in future");
        require(config.tradingEndDate <= config.settlementDate, "MetricsMarketFactory: Trading must end before settlement");
        require(config.dataRequestWindow > 0, "MetricsMarketFactory: Invalid data request window");

        // Validate initial order if enabled
        if (config.initialOrder.enabled) {
            _validateInitialOrder(config);
        }

        // Generate UMA identifier from metric ID
        bytes32 umaIdentifier = _generateUMAIdentifier(config.metricId);
        
        // Configure metric in UMA Oracle Manager
        IUMAOracleIntegration.MetricConfig memory umaConfig = IUMAOracleIntegration.MetricConfig({
            identifier: umaIdentifier,
            description: config.description,
            decimals: config.decimals,
            minBond: 1000 * 1e18, // 1000 tokens minimum bond
            defaultReward: 100 * 1e18, // 100 tokens default reward
            livenessPeriod: 7200, // 2 hours liveness
            isActive: true,
            authorizedRequesters: new address[](0)
        });
        
        umaOracleManager.configureMetric(umaConfig);
        
        // Create market using minimal proxy pattern
        marketAddress = orderBookImplementation.clone();
        
        // Initialize the market with settlement parameters
        IOrderBook(marketAddress).initialize(
            config.metricId,
            config.description,
            config.decimals,
            config.minimumOrderSize,
            1e16, // Fixed tick size: 0.01
            centralVault,
            orderRouter,
            address(umaOracleManager),
            umaIdentifier,
            config.settlementDate,
            config.tradingEndDate,
            config.dataRequestWindow,
            config.autoSettle
        );

        // Authorize the market to request UMA data
        umaOracleManager.addAuthorizedRequester(umaIdentifier, marketAddress);
        
        // Store market information
        markets[config.metricId] = marketAddress;
        marketConfigs[config.metricId] = config;
        creatorMarkets[msg.sender].push(config.metricId);
        allMarkets.push(marketAddress);
        allMetricIds.push(config.metricId);
        
        // Map UMA identifier
        metricToUMAIdentifier[config.metricId] = umaIdentifier;
        umaIdentifierToMetric[umaIdentifier] = config.metricId;

        // Handle creation fee
        uint256 feeAmount = config.creationFee > 0 ? config.creationFee : defaultCreationFee;
        if (msg.value > 0 && msg.value >= feeAmount) {
            payable(feeRecipient).transfer(feeAmount);
            
            // Refund excess
            if (msg.value > feeAmount) {
                payable(msg.sender).transfer(msg.value - feeAmount);
            }
        }

        emit MarketCreated(
            config.metricId,
            marketAddress,
            msg.sender,
            config.description,
            config.oracleProvider,
            config.settlementDate,
            config.tradingEndDate
        );
        emit UMAIdentifierMapped(config.metricId, umaIdentifier);

        // Place initial order if enabled
        if (config.initialOrder.enabled) {
            uint256 orderId = _placeInitialOrder(config, marketAddress, msg.sender);
            
            emit InitialOrderPlaced(
                config.metricId,
                marketAddress,
                msg.sender,
                config.initialOrder.side,
                config.initialOrder.quantity,
                config.initialOrder.price,
                orderId
            );
        }

        return marketAddress;
    }

    /**
     * @dev Returns the address of a market for a given metric ID
     */
    function getMarket(string calldata metricId)
        external
        view
        override
        returns (address marketAddress)
    {
        return markets[metricId];
    }

    /**
     * @dev Returns all active markets
     */
    function getAllMarkets() external view override returns (address[] memory marketAddresses) {
        return allMarkets;
    }

    /**
     * @dev Pauses/unpauses a market
     */
    function setMarketStatus(string calldata metricId, bool isActive)
        external
        override
        onlyRole(FACTORY_ADMIN_ROLE)
    {
        address marketAddress = markets[metricId];
        require(marketAddress != address(0), "MetricsMarketFactory: Market not found");
        
        IOrderBook(marketAddress).setPaused(!isActive);
        // Note: MarketConfig doesn't have isActive field, status managed by pause state
        
        // Also update UMA Oracle Manager
        bytes32 umaIdentifier = metricToUMAIdentifier[metricId];
        if (isActive) {
            umaOracleManager.unpauseMetric(umaIdentifier);
        } else {
            umaOracleManager.pauseMetric(umaIdentifier);
        }

        emit MarketStatusChanged(metricId, marketAddress, isActive);
    }

    /**
     * @dev Updates market parameters
     */
    function updateMarketParameters(
        string calldata metricId,
        uint256 minimumOrderSize,
        uint256 tickSize // Deprecated: tick size is now fixed at 0.01
    ) external override onlyRole(FACTORY_ADMIN_ROLE) {
        address marketAddress = markets[metricId];
        require(marketAddress != address(0), "MetricsMarketFactory: Market not found");
        require(minimumOrderSize > 0, "MetricsMarketFactory: Invalid min order size");
        // Tick size validation removed - now using fixed 0.01 precision

        IOrderBook(marketAddress).updateConfiguration(
            1e16, // Fixed tick size: 0.01
            minimumOrderSize,
            type(uint256).max // Keep max order size unchanged
        );

        // Update stored config
        marketConfigs[metricId].minimumOrderSize = minimumOrderSize;
        // marketConfigs[metricId].tickSize = tickSize; // Removed: tick size is now constant
    }

    /**
     * @dev Checks if a market exists for a given metric
     */
    function marketExists(string calldata metricId)
        external
        view
        override
        returns (bool exists)
    {
        return markets[metricId] != address(0);
    }

    /**
     * @dev Returns market configuration
     */
    function getMarketConfig(string calldata metricId)
        external
        view
        override
        returns (MarketConfig memory config)
    {
        return marketConfigs[metricId];
    }

    /**
     * @dev Gets UMA identifier for a metric
     */
    function getUMAIdentifier(string calldata metricId) 
        external 
        view 
        returns (bytes32 identifier) 
    {
        return metricToUMAIdentifier[metricId];
    }

    /**
     * @dev Gets metric ID from UMA identifier
     */
    function getMetricFromUMAIdentifier(bytes32 identifier) 
        external 
        view 
        returns (string memory metricId) 
    {
        return umaIdentifierToMetric[identifier];
    }

    /**
     * @dev Gets all markets created by an address
     */
    function getCreatorMarkets(address creator) 
        external 
        view 
        returns (string[] memory metricIds) 
    {
        return creatorMarkets[creator];
    }

    /**
     * @dev Gets all metric IDs
     */
    function getAllMetricIds() external view returns (string[] memory metricIds) {
        return allMetricIds;
    }

    /**
     * @dev Requests current data for a metric from UMA Oracle
     */
    function requestMetricUpdate(
        string calldata metricId,
        bytes calldata ancillaryData,
        uint256 reward
    ) external nonReentrant returns (bytes32 requestId) {
        require(markets[metricId] != address(0), "MetricsMarketFactory: Market not found");
        
        bytes32 umaIdentifier = metricToUMAIdentifier[metricId];
        require(umaIdentifier != bytes32(0), "MetricsMarketFactory: UMA identifier not found");

        // Request data from UMA Oracle Manager
        requestId = umaOracleManager.requestMetricData(
            umaIdentifier,
            block.timestamp,
            ancillaryData,
            reward,
            0 // Use default liveness
        );

        return requestId;
    }

    /**
     * @dev Gets the latest value for a metric from UMA
     */
    function getLatestMetricValue(string calldata metricId) 
        external 
        view 
        returns (int256 value, uint256 timestamp) 
    {
        bytes32 umaIdentifier = metricToUMAIdentifier[metricId];
        require(umaIdentifier != bytes32(0), "MetricsMarketFactory: UMA identifier not found");
        
        return umaOracleManager.getLatestMetricValue(umaIdentifier);
    }

    /**
     * @dev Gets historical values for a metric
     */
    function getHistoricalValues(
        string calldata metricId,
        uint256 fromTimestamp,
        uint256 toTimestamp
    ) external view returns (uint256[] memory timestamps, int256[] memory values) {
        bytes32 umaIdentifier = metricToUMAIdentifier[metricId];
        require(umaIdentifier != bytes32(0), "MetricsMarketFactory: UMA identifier not found");
        
        return umaOracleManager.getHistoricalValues(umaIdentifier, fromTimestamp, toTimestamp);
    }

    /**
     * @dev Updates the default creation fee
     */
    function setDefaultCreationFee(uint256 newFee) 
        external 
        onlyRole(FACTORY_ADMIN_ROLE) 
    {
        uint256 oldFee = defaultCreationFee;
        defaultCreationFee = newFee;
        emit CreationFeeUpdated(oldFee, newFee);
    }

    /**
     * @dev Updates the fee recipient
     */
    function setFeeRecipient(address newRecipient) 
        external 
        onlyRole(FACTORY_ADMIN_ROLE) 
    {
        require(newRecipient != address(0), "MetricsMarketFactory: Invalid recipient");
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /**
     * @dev Grants market creator role to an address
     */
    function grantMarketCreatorRole(address account) 
        external 
        onlyRole(FACTORY_ADMIN_ROLE) 
    {
        grantRole(MARKET_CREATOR_ROLE, account);
    }

    /**
     * @dev Revokes market creator role from an address
     */
    function revokeMarketCreatorRole(address account) 
        external 
        onlyRole(FACTORY_ADMIN_ROLE) 
    {
        revokeRole(MARKET_CREATOR_ROLE, account);
    }

    /**
     * @dev Emergency pause function
     */
    function pause() external onlyRole(FACTORY_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Emergency unpause function
     */
    function unpause() external onlyRole(FACTORY_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @dev Requests settlement data from UMA Oracle
     */
    function requestSettlementData(
        string calldata metricId,
        bytes calldata ancillaryData
    ) external override nonReentrant returns (bytes32 requestId) {
        require(markets[metricId] != address(0), "MetricsMarketFactory: Market not found");
        require(!marketSettlements[metricId].isSettled, "MetricsMarketFactory: Already settled");
        
        MarketConfig storage config = marketConfigs[metricId];
        require(block.timestamp >= config.settlementDate - config.dataRequestWindow, 
                "MetricsMarketFactory: Too early for settlement request");
        require(block.timestamp <= config.settlementDate + 86400, 
                "MetricsMarketFactory: Settlement request window expired");

        bytes32 umaIdentifier = metricToUMAIdentifier[metricId];
        require(umaIdentifier != bytes32(0), "MetricsMarketFactory: UMA identifier not found");

        // Request settlement data from UMA Oracle Manager
        requestId = umaOracleManager.requestMetricData(
            umaIdentifier,
            config.settlementDate,
            ancillaryData,
            0, // Use default reward
            0  // Use default liveness
        );

        settlementRequests[metricId] = requestId;
        
        emit SettlementRequested(metricId, requestId, config.settlementDate);
        return requestId;
    }

    /**
     * @dev Settles a market with final value from UMA
     */
    function settleMarket(string calldata metricId, int256 finalValue) 
        external 
        override 
        nonReentrant 
    {
        require(markets[metricId] != address(0), "MetricsMarketFactory: Market not found");
        require(!marketSettlements[metricId].isSettled, "MetricsMarketFactory: Already settled");
        
        bytes32 requestId = settlementRequests[metricId];
        require(requestId != bytes32(0), "MetricsMarketFactory: No settlement request");

        // Verify the request is resolved in UMA Oracle Manager
        (bool isResolved, int256 resolvedValue) = umaOracleManager.getRequestStatus(requestId);
        require(isResolved, "MetricsMarketFactory: Settlement not resolved by UMA");
        require(resolvedValue == finalValue, "MetricsMarketFactory: Value mismatch");

        // Update settlement info
        marketSettlements[metricId] = SettlementInfo({
            isSettled: true,
            settlementValue: finalValue,
            settlementTimestamp: block.timestamp,
            umaRequestId: requestId
        });

        // Add to settled markets list
        settledMarkets.push(metricId);

        // Trigger settlement in the market contract
        address marketAddress = markets[metricId];
        ISettlementMarket(marketAddress).settleMarket(finalValue);

        emit MarketSettled(metricId, finalValue, block.timestamp);
    }

    /**
     * @dev Gets market settlement information
     */
    function getMarketSettlement(string calldata metricId)
        external
        view
        override
        returns (
            bool isSettled,
            int256 settlementValue,
            uint256 settlementTimestamp
        )
    {
        SettlementInfo storage info = marketSettlements[metricId];
        return (info.isSettled, info.settlementValue, info.settlementTimestamp);
    }

    /**
     * @dev Gets markets approaching settlement
     */
    function getMarketsApproachingSettlement(uint256 timeWindow)
        external
        view
        override
        returns (string[] memory metricIds)
    {
        uint256 count = 0;
        uint256 currentTime = block.timestamp;
        
        // Count markets approaching settlement
        for (uint256 i = 0; i < allMetricIds.length; i++) {
            string memory metricId = allMetricIds[i];
            MarketConfig storage config = marketConfigs[metricId];
            
            if (!marketSettlements[metricId].isSettled && 
                config.settlementDate > currentTime &&
                config.settlementDate <= currentTime + timeWindow) {
                count++;
            }
        }

        // Create result array
        metricIds = new string[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allMetricIds.length; i++) {
            string memory metricId = allMetricIds[i];
            MarketConfig storage config = marketConfigs[metricId];
            
            if (!marketSettlements[metricId].isSettled && 
                config.settlementDate > currentTime &&
                config.settlementDate <= currentTime + timeWindow) {
                metricIds[index] = metricId;
                index++;
            }
        }
    }

    /**
     * @dev Gets all settled markets
     */
    function getSettledMarkets()
        external
        view
        override
        returns (string[] memory metricIds)
    {
        return settledMarkets;
    }

    /**
     * @dev Withdraws accumulated fees
     */
    function withdrawFees() external onlyRole(FACTORY_ADMIN_ROLE) {
        uint256 balance = address(this).balance;
        require(balance > 0, "MetricsMarketFactory: No fees to withdraw");
        payable(feeRecipient).transfer(balance);
    }

    // Internal functions

    /**
     * @dev Generates a UMA identifier from metric ID
     */
    function _generateUMAIdentifier(string memory metricId) 
        internal 
        pure 
        returns (bytes32) 
    {
        return keccak256(abi.encodePacked("METRIC_", metricId));
    }

    /**
     * @dev Validates initial order configuration
     */
    function _validateInitialOrder(MarketConfig calldata config) internal view {
        require(config.initialOrder.quantity >= config.minimumOrderSize, 
                "MetricsMarketFactory: Initial order below minimum size");
        require(config.initialOrder.price > 0, 
                "MetricsMarketFactory: Initial order price must be positive");
        require(config.initialOrder.price % 1e16 == 0, 
                "MetricsMarketFactory: Initial order price not aligned to 0.01 tick size");
        
        // Validate expiry time for GTD orders
        if (config.initialOrder.timeInForce == IOrderRouter.TimeInForce.GTD) {
            require(config.initialOrder.expiryTime > block.timestamp, 
                    "MetricsMarketFactory: Initial order expiry time must be in future");
            require(config.initialOrder.expiryTime <= config.tradingEndDate, 
                    "MetricsMarketFactory: Initial order expiry cannot exceed trading end date");
        }
    }

    /**
     * @dev Places initial order for a newly created market
     */
    function _placeInitialOrder(
        MarketConfig calldata config,
        address marketAddress,
        address creator
    ) internal returns (uint256 orderId) {
        // Create order struct
        IOrderRouter.Order memory initialOrder = IOrderRouter.Order({
            orderId: 0, // Will be assigned by router
            trader: creator,
            metricId: config.metricId,
            orderType: IOrderRouter.OrderType.LIMIT,
            side: config.initialOrder.side,
            quantity: config.initialOrder.quantity,
            price: config.initialOrder.price,
            filledQuantity: 0,
            timestamp: 0, // Will be set by router
            expiryTime: config.initialOrder.expiryTime,
            status: IOrderRouter.OrderStatus.PENDING,
            timeInForce: config.initialOrder.timeInForce,
            stopPrice: 0, // Not applicable for limit orders
            icebergQty: 0, // Not applicable
            postOnly: true, // Initial orders should be post-only
            metadataHash: keccak256("INITIAL_ORDER")
        });

        // Register market with router first
        IOrderRouter(orderRouter).registerMarket(config.metricId, marketAddress);

        // Place the order through the router
        orderId = IOrderRouter(orderRouter).placeOrder(initialOrder);

        return orderId;
    }

    /**
     * @dev Receives ETH for creation fees
     */
    receive() external payable {
        // Accept ETH for fees
    }
}
