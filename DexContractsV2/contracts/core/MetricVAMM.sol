// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IMetricVAMM.sol";
import "../interfaces/IvAMM.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/IMetricRegistry.sol";
import "../uma/IOptimisticOracleV3.sol";

/**
 * @title MetricVAMM
 * @dev Virtual AMM for custom metrics futures with UMA settlement integration
 */
contract MetricVAMM is IMetricVAMM, IvAMM {
    address public owner;
    IVault public vault;
    IPriceOracle public oracle;
    IMetricRegistry public metricRegistry;
    IOptimisticOracleV3 public umaOracle;
    
    // Trading parameters
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant FUNDING_PRECISION = 1e8;
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MAX_LEVERAGE = 100;
    uint256 public constant MIN_LEVERAGE = 1;
    
    // Fee structure
    uint256 public tradingFeeRate = 30; // 0.3% in basis points
    uint256 public liquidationFeeRate = 500; // 5% in basis points
    uint256 public maintenanceMarginRatio = 500; // 5% in basis points
    uint256 public initialMarginRatio = 1000; // 10% in basis points
    
    // Dynamic Virtual reserves
    uint256 public baseVirtualBaseReserves = 1e4 * PRICE_PRECISION;
    uint256 public baseVirtualQuoteReserves = 1e4 * PRICE_PRECISION;
    
    // Dynamic reserves parameters
    uint256 public volumeScaleFactor = 1000;
    uint256 public minReserveMultiplier = 1e18;
    uint256 public maxReserveMultiplier = 100e18;
    
    // Funding mechanism
    FundingState public globalFundingState;
    uint256 public constant FUNDING_INTERVAL = 1 hours;
    uint256 public constant MAX_FUNDING_RATE = 1e6; // 1% per hour
    uint256 public constant DATA_FRESHNESS_PENALTY_RATE = 5e4; // 0.05% per hour
    uint256 public constant SETTLEMENT_RISK_RATE = 1e5; // 0.1% per day
    
    // Position tracking (supports both traditional and metric positions)
    mapping(uint256 => MetricPosition) public metricPositions;
    mapping(address => uint256[]) public userPositionIds;
    mapping(uint256 => address) public positionOwner;
    uint256 public globalPositionId;
    
    // Metric-specific state
    mapping(bytes32 => MetricMarket) public metricMarkets;
    mapping(bytes32 => FundingState) public metricFundingStates;
    mapping(bytes32 => uint256) public totalMetricLongSize;
    mapping(bytes32 => uint256) public totalMetricShortSize;
    
    // UMA integration
    mapping(bytes32 => bytes32) public umaRequestIds; // metricId => UMA request ID
    mapping(bytes32 => bool) public settlementRequested;
    IERC20 public umaCollateralToken;
    uint256 public umaReward = 100e18; // 100 USDC reward for data providers
    
    // Global state
    int256 public totalLongSize;
    int256 public totalShortSize;
    uint256 public totalTradingFees;
    bool public paused = false;
    
    // Events
    event MetricPositionOpened(
        address indexed user,
        uint256 indexed positionId,
        bytes32 indexed metricId,
        bool isLong,
        uint256 size,
        uint256 targetValue,
        PositionType positionType
    );
    
    event MetricPositionClosed(
        address indexed user,
        uint256 indexed positionId,
        bytes32 indexed metricId,
        uint256 size,
        int256 pnl
    );
    
    event MetricMarketCreated(
        bytes32 indexed metricId,
        uint256 settlementDate,
        address indexed creator
    );
    
    event MetricMarketSettled(
        bytes32 indexed metricId,
        uint256 settlementValue,
        uint256 timestamp
    );
    
    event UMASettlementRequested(
        bytes32 indexed metricId,
        uint256 timestamp,
        bytes ancillaryData
    );
    
    modifier onlyOwner() {
        require(msg.sender == owner, "MetricVAMM: not owner");
        _;
    }
    
    modifier whenNotPaused() {
        require(!paused, "MetricVAMM: paused");
        _;
    }
    
    modifier validMetricPosition(uint256 positionId) {
        require(metricPositions[positionId].isActive, "MetricVAMM: position not active");
        _;
    }
    
    modifier onlyPositionOwner(uint256 positionId) {
        require(positionOwner[positionId] == msg.sender, "MetricVAMM: not position owner");
        _;
    }
    
    constructor(
        address _vault,
        address _oracle,
        address _metricRegistry,
        address _umaOracle,
        address _umaCollateralToken,
        uint256 _initialPrice
    ) {
        owner = msg.sender;
        vault = IVault(_vault);
        oracle = IPriceOracle(_oracle);
        metricRegistry = IMetricRegistry(_metricRegistry);
        umaOracle = IOptimisticOracleV3(_umaOracle);
        umaCollateralToken = IERC20(_umaCollateralToken);
        
        // Initialize base virtual reserves
        baseVirtualQuoteReserves = (_initialPrice * baseVirtualBaseReserves) / PRICE_PRECISION;
        
        // Initialize funding state
        globalFundingState.lastFundingTime = block.timestamp;
        globalFundingState.fundingIndex = FUNDING_PRECISION;
        
        globalPositionId = 1;
    }
    
    /**
     * @dev Creates a new metric market for settlement-based trading
     */
    function createMetricMarket(
        bytes32 metricId,
        uint256 settlementPeriodDays
    ) external override returns (bytes32 marketId) {
        require(metricRegistry.isMetricActive(metricId), "MetricVAMM: metric not active");
        require(!_metricMarketExists(metricId), "MetricVAMM: market already exists");
        require(settlementPeriodDays >= 1 && settlementPeriodDays <= 365, "MetricVAMM: invalid period");
        
        uint256 settlementDate = block.timestamp + (settlementPeriodDays * 1 days);
        marketId = metricId; // Use metric ID as market ID for simplicity
        
        metricMarkets[metricId] = MetricMarket({
            metricId: metricId,
            settlementDate: settlementDate,
            settlementValue: 0,
            isSettled: false,
            totalLongStake: 0,
            totalShortStake: 0,
            status: MarketStatus.ACTIVE,
            createdAt: block.timestamp,
            creator: msg.sender
        });
        
        // Initialize funding state for this metric
        metricFundingStates[metricId] = FundingState({
            fundingRate: 0,
            fundingIndex: FUNDING_PRECISION,
            lastFundingTime: block.timestamp,
            premiumFraction: 0,
            dataFreshnessPenalty: 0,
            settlementRiskAdjustment: 0
        });
        
        emit MetricMarketCreated(metricId, settlementDate, msg.sender);
        return marketId;
    }
    
    /**
     * @dev Opens a metric position (settlement-based or continuous)
     */
    function openMetricPosition(
        bytes32 metricId,
        uint256 collateralAmount,
        bool isLong,
        uint256 leverage,
        uint256 targetValue,
        PositionType positionType,
        uint256 minPrice,
        uint256 maxPrice
    ) external override whenNotPaused returns (uint256 positionId) {
        require(collateralAmount > 0, "MetricVAMM: invalid collateral");
        require(leverage >= MIN_LEVERAGE && leverage <= MAX_LEVERAGE, "MetricVAMM: invalid leverage");
        require(metricRegistry.isMetricActive(metricId), "MetricVAMM: metric not active");
        
        // For settlement positions, require market to exist
        if (positionType == PositionType.SETTLEMENT) {
            require(_metricMarketExists(metricId), "MetricVAMM: market not found");
            require(metricMarkets[metricId].status == MarketStatus.ACTIVE, "MetricVAMM: market not active");
        }
        
        // Update funding before position change
        updateMetricFunding(metricId);
        
        uint256 positionSize = collateralAmount * leverage;
        uint256 currentPrice = _getMetricMarkPrice(metricId);
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "MetricVAMM: price slippage");
        
        // Calculate trading fee
        uint256 tradingFee = (positionSize * tradingFeeRate) / BASIS_POINTS;
        uint256 totalCost = collateralAmount + tradingFee;
        
        // Reserve margin in vault
        vault.reserveMargin(msg.sender, totalCost);
        
        // Create position ID and update tracking
        positionId = globalPositionId++;
        
        // Update position tracking
        if (isLong) {
            totalLongSize += int256(positionSize);
            totalMetricLongSize[metricId] += positionSize;
        } else {
            totalShortSize += int256(positionSize);
            totalMetricShortSize[metricId] += positionSize;
        }
        
        // Determine settlement date
        uint256 settlementDate = positionType == PositionType.SETTLEMENT 
            ? metricMarkets[metricId].settlementDate 
            : 0;
        
        // Create position
        metricPositions[positionId] = MetricPosition({
            positionId: positionId,
            metricId: metricId,
            size: int256(positionSize),
            isLong: isLong,
            entryPrice: currentPrice,
            targetValue: targetValue,
            settlementDate: settlementDate,
            entryFundingIndex: metricFundingStates[metricId].fundingIndex,
            lastInteractionTime: block.timestamp,
            isActive: true,
            isSettlementBased: positionType == PositionType.SETTLEMENT,
            positionType: positionType
        });
        
        // Update mappings
        positionOwner[positionId] = msg.sender;
        userPositionIds[msg.sender].push(positionId);
        
        // Update market tracking
        if (positionType == PositionType.SETTLEMENT) {
            if (isLong) {
                metricMarkets[metricId].totalLongStake += positionSize;
            } else {
                metricMarkets[metricId].totalShortStake += positionSize;
            }
        }
        
        totalTradingFees += tradingFee;
        
        emit MetricPositionOpened(msg.sender, positionId, metricId, isLong, positionSize, targetValue, positionType);
        
        return positionId;
    }
    
    /**
     * @dev Adds to an existing metric position
     */
    function addToMetricPosition(
        uint256 positionId,
        uint256 collateralAmount,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external override whenNotPaused validMetricPosition(positionId) onlyPositionOwner(positionId) returns (uint256 newSize) {
        require(collateralAmount > 0, "MetricVAMM: invalid collateral");
        require(leverage >= MIN_LEVERAGE && leverage <= MAX_LEVERAGE, "MetricVAMM: invalid leverage");
        
        MetricPosition storage pos = metricPositions[positionId];
        
        // Check if settlement-based position hasn't settled yet
        if (pos.isSettlementBased) {
            require(!metricMarkets[pos.metricId].isSettled, "MetricVAMM: market already settled");
        }
        
        // Update funding
        updateMetricFunding(pos.metricId);
        _applyFundingToMetricPosition(positionId);
        
        uint256 additionalSize = collateralAmount * leverage;
        uint256 currentPrice = _getMetricMarkPrice(pos.metricId);
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "MetricVAMM: price slippage");
        
        uint256 tradingFee = (additionalSize * tradingFeeRate) / BASIS_POINTS;
        uint256 totalCost = collateralAmount + tradingFee;
        
        vault.reserveMargin(msg.sender, totalCost);
        
        // Update position tracking
        if (pos.isLong) {
            totalLongSize += int256(additionalSize);
            totalMetricLongSize[pos.metricId] += additionalSize;
        } else {
            totalShortSize += int256(additionalSize);
            totalMetricShortSize[pos.metricId] += additionalSize;
        }
        
        // Calculate weighted average entry price
        uint256 existingNotional = uint256(pos.size) * pos.entryPrice / PRICE_PRECISION;
        uint256 newNotional = additionalSize * currentPrice / PRICE_PRECISION;
        uint256 totalNotional = existingNotional + newNotional;
        
        pos.entryPrice = (totalNotional * PRICE_PRECISION) / (uint256(pos.size) + additionalSize);
        pos.size = pos.size + int256(additionalSize);
        pos.lastInteractionTime = block.timestamp;
        
        newSize = uint256(pos.size);
        totalTradingFees += tradingFee;
        
        return newSize;
    }
    
    /**
     * @dev Closes a metric position partially or fully
     */
    function closeMetricPosition(
        uint256 positionId,
        uint256 sizeToClose,
        uint256 minPrice,
        uint256 maxPrice
    ) external override whenNotPaused validMetricPosition(positionId) onlyPositionOwner(positionId) returns (int256 pnl) {
        MetricPosition storage pos = metricPositions[positionId];
        uint256 positionSize = uint256(pos.size);
        require(sizeToClose <= positionSize, "MetricVAMM: invalid size");
        
        // Check settlement status for settlement positions
        if (pos.isSettlementBased && metricMarkets[pos.metricId].isSettled) {
            return _settlePosition(positionId, sizeToClose);
        }
        
        // Update funding
        updateMetricFunding(pos.metricId);
        _applyFundingToMetricPosition(positionId);
        
        uint256 currentPrice = _getMetricMarkPrice(pos.metricId);
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "MetricVAMM: price slippage");
        
        // Calculate PnL
        if (pos.isLong) {
            pnl = int256(sizeToClose * (currentPrice - pos.entryPrice) / PRICE_PRECISION);
        } else {
            pnl = int256(sizeToClose * (pos.entryPrice - currentPrice) / PRICE_PRECISION);
        }
        
        uint256 tradingFee = (sizeToClose * tradingFeeRate) / BASIS_POINTS;
        
        // Update position tracking
        if (pos.isLong) {
            totalLongSize -= int256(sizeToClose);
            totalMetricLongSize[pos.metricId] -= sizeToClose;
        } else {
            totalShortSize -= int256(sizeToClose);
            totalMetricShortSize[pos.metricId] -= sizeToClose;
        }
        
        // Update position
        if (sizeToClose == positionSize) {
            pos.isActive = false;
            _removePositionFromUser(msg.sender, positionId);
        } else {
            pos.size = pos.size - int256(sizeToClose);
            pos.lastInteractionTime = block.timestamp;
        }
        
        // Update vault
        vault.updatePnL(msg.sender, pnl - int256(tradingFee));
        
        uint256 marginToRelease = (vault.getMarginAccount(msg.sender).reservedMargin * sizeToClose) / positionSize;
        vault.releaseMargin(msg.sender, marginToRelease);
        
        totalTradingFees += tradingFee;
        
        emit MetricPositionClosed(msg.sender, positionId, pos.metricId, sizeToClose, pnl);
        
        return pnl;
    }
    
    /**
     * @dev Requests UMA settlement for a metric market
     */
    function requestUMASettlement(bytes32 metricId) external override {
        require(_metricMarketExists(metricId), "MetricVAMM: market not found");
        require(block.timestamp >= metricMarkets[metricId].settlementDate, "MetricVAMM: settlement not due");
        require(!settlementRequested[metricId], "MetricVAMM: settlement already requested");
        
        IMetricRegistry.MetricDefinition memory metric = metricRegistry.getMetric(metricId);
        
        // Construct ancillary data for UMA
        bytes memory ancillaryData = abi.encodePacked(
            "Metric: ", metric.name,
            ", Source: ", metric.dataSource,
            ", Method: ", metric.calculationMethod,
            ", Cutoff: ", _toString(metricMarkets[metricId].settlementDate)
        );
        
        // Request price from UMA
        umaOracle.requestPrice(
            metric.umaIdentifier,
            metricMarkets[metricId].settlementDate,
            ancillaryData,
            umaCollateralToken,
            umaReward
        );
        
        metricMarkets[metricId].status = MarketStatus.SETTLING;
        settlementRequested[metricId] = true;
        
        emit UMASettlementRequested(metricId, block.timestamp, ancillaryData);
    }
    
    /**
     * @dev Settles a metric market using UMA oracle result
     */
    function settleMetricMarket(bytes32 metricId) external override {
        require(_metricMarketExists(metricId), "MetricVAMM: market not found");
        require(settlementRequested[metricId], "MetricVAMM: settlement not requested");
        require(!metricMarkets[metricId].isSettled, "MetricVAMM: already settled");
        
        IMetricRegistry.MetricDefinition memory metric = metricRegistry.getMetric(metricId);
        
        bytes memory ancillaryData = abi.encodePacked(
            "Metric: ", metric.name,
            ", Source: ", metric.dataSource,
            ", Method: ", metric.calculationMethod,
            ", Cutoff: ", _toString(metricMarkets[metricId].settlementDate)
        );
        
        // Get settled price from UMA
        (bool hasPrice, int256 price, uint256 settlementTime) = umaOracle.settledPrice(
            metric.umaIdentifier,
            metricMarkets[metricId].settlementDate,
            ancillaryData
        );
        
        require(hasPrice, "MetricVAMM: UMA price not settled");
        require(price >= 0, "MetricVAMM: invalid settlement value");
        
        // Execute settlement
        uint256 settlementValue = uint256(price);
        metricMarkets[metricId].settlementValue = settlementValue;
        metricMarkets[metricId].isSettled = true;
        metricMarkets[metricId].status = MarketStatus.SETTLED;
        
        emit MetricMarketSettled(metricId, settlementValue, settlementTime);
    }
    
    /**
     * @dev Claims settlement payout for a settled position
     */
    function claimSettlement(uint256 positionId) external override validMetricPosition(positionId) onlyPositionOwner(positionId) returns (uint256 payout) {
        MetricPosition storage pos = metricPositions[positionId];
        require(pos.isSettlementBased, "MetricVAMM: not settlement position");
        require(metricMarkets[pos.metricId].isSettled, "MetricVAMM: market not settled");
        
        return uint256(_settlePosition(positionId, uint256(pos.size)));
    }
    
    /**
     * @dev Updates funding rate for a specific metric
     */
    function updateMetricFunding(bytes32 metricId) public override {
        FundingState storage funding = metricFundingStates[metricId];
        
        if (block.timestamp < funding.lastFundingTime + FUNDING_INTERVAL) {
            return; // Not time for funding update yet
        }
        
        // Calculate data freshness penalty
        funding.dataFreshnessPenalty = calculateDataFreshnessPenalty(metricId);
        
        // Calculate settlement risk adjustment
        funding.settlementRiskAdjustment = calculateSettlementRisk(metricId);
        
        // Calculate imbalance-based funding
        uint256 longSize = totalMetricLongSize[metricId];
        uint256 shortSize = totalMetricShortSize[metricId];
        int256 imbalance = 0;
        
        if (longSize + shortSize > 0) {
            imbalance = int256((longSize * FUNDING_PRECISION) / (longSize + shortSize)) - int256(FUNDING_PRECISION / 2);
        }
        
        // Combine all funding components
        funding.fundingRate = imbalance + funding.dataFreshnessPenalty + funding.settlementRiskAdjustment;
        
        // Cap funding rate
        if (funding.fundingRate > int256(MAX_FUNDING_RATE)) {
            funding.fundingRate = int256(MAX_FUNDING_RATE);
        } else if (funding.fundingRate < -int256(MAX_FUNDING_RATE)) {
            funding.fundingRate = -int256(MAX_FUNDING_RATE);
        }
        
        funding.lastFundingTime = block.timestamp;
        funding.fundingIndex = uint256(int256(funding.fundingIndex) + funding.fundingRate);
        
        emit MetricFundingUpdated(metricId, funding.fundingRate, funding.dataFreshnessPenalty, funding.settlementRiskAdjustment);
    }
    
    /**
     * @dev Calculates data freshness penalty
     */
    function calculateDataFreshnessPenalty(bytes32 metricId) public view override returns (int256) {
        // For metrics, we penalize based on how long since the last data update
        // This encourages frequent data submissions
        return int256(DATA_FRESHNESS_PENALTY_RATE); // Simplified implementation
    }
    
    /**
     * @dev Calculates settlement risk adjustment
     */
    function calculateSettlementRisk(bytes32 metricId) public view override returns (int256) {
        if (!_metricMarketExists(metricId) || metricMarkets[metricId].isSettled) {
            return 0;
        }
        
        uint256 timeToSettlement = metricMarkets[metricId].settlementDate > block.timestamp 
            ? metricMarkets[metricId].settlementDate - block.timestamp 
            : 0;
        
        if (timeToSettlement == 0) {
            return int256(SETTLEMENT_RISK_RATE * 10); // High risk when settlement is due
        }
        
        // Risk increases as settlement approaches (inversely proportional to time remaining)
        uint256 daysToSettlement = timeToSettlement / 1 days;
        if (daysToSettlement == 0) daysToSettlement = 1;
        
        return int256(SETTLEMENT_RISK_RATE / daysToSettlement);
    }
    
    // Internal helper functions
    function _applyFundingToMetricPosition(uint256 positionId) internal {
        MetricPosition storage pos = metricPositions[positionId];
        if (!pos.isActive || pos.size == 0) return;
        
        FundingState storage funding = metricFundingStates[pos.metricId];
        uint256 fundingIndexDelta = funding.fundingIndex - pos.entryFundingIndex;
        if (fundingIndexDelta == 0) return;
        
        uint256 positionSize = uint256(pos.size);
        int256 fundingPayment = int256(positionSize * fundingIndexDelta / FUNDING_PRECISION);
        
        if (pos.isLong) {
            fundingPayment = -fundingPayment; // Longs pay positive funding
        }
        
        address user = positionOwner[positionId];
        vault.applyFunding(user, fundingPayment, funding.fundingIndex);
        
        pos.entryFundingIndex = funding.fundingIndex;
    }
    
    function getMetricReserves(bytes32 metricId) public view returns (uint256 baseReserves, uint256 quoteReserves) {
        // Get metric-specific trading volume for dynamic scaling
        uint256 metricVolume = totalMetricLongSize[metricId] + totalMetricShortSize[metricId];
        
        // Calculate dynamic multiplier based on trading activity
        uint256 dynamicMultiplier = minReserveMultiplier;
        if (metricVolume > 0) {
            uint256 volumeMultiplier = (metricVolume * PRICE_PRECISION) / volumeScaleFactor;
            dynamicMultiplier = volumeMultiplier > minReserveMultiplier ? volumeMultiplier : minReserveMultiplier;
            dynamicMultiplier = dynamicMultiplier < maxReserveMultiplier ? dynamicMultiplier : maxReserveMultiplier;
        }
        
        // Scale base reserves with dynamic multiplier
        baseReserves = (baseVirtualBaseReserves * dynamicMultiplier) / PRICE_PRECISION;
        
        // For metrics, use a base price ratio to create tokenization
        // This creates the tokenization: metric value becomes token price
        // For now, use 1:1 scaling (1 unit = $1.00) - can be customized per metric
        uint256 baseTokenPrice = 8 * PRICE_PRECISION; // Example: 8 billion people = $8.00
        quoteReserves = (baseReserves * baseTokenPrice) / PRICE_PRECISION;
        
        // Adjust reserves based on net position imbalance to reflect trading activity
        int256 netLongSize = int256(totalMetricLongSize[metricId]) - int256(totalMetricShortSize[metricId]);
        if (netLongSize > 0) {
            // More longs than shorts: reduce base reserves (increase price)
            uint256 reduction = (uint256(netLongSize) * PRICE_PRECISION) / (10 * baseReserves);
            baseReserves = baseReserves > reduction ? baseReserves - reduction : baseReserves / 2;
        } else if (netLongSize < 0) {
            // More shorts than longs: increase base reserves (decrease price)
            uint256 increase = (uint256(-netLongSize) * PRICE_PRECISION) / (10 * baseReserves);
            baseReserves = baseReserves + increase;
        }
    }

    function _getMetricMarkPrice(bytes32 metricId) internal view returns (uint256) {
        // Get metric-specific reserves for AMM price calculation
        (uint256 baseReserves, uint256 quoteReserves) = getMetricReserves(metricId);
        
        // Constant product formula: price = quoteReserves / baseReserves
        return (quoteReserves * PRICE_PRECISION) / baseReserves;
    }
    
    function _metricMarketExists(bytes32 metricId) internal view returns (bool) {
        return metricMarkets[metricId].createdAt > 0;
    }
    
    function _removePositionFromUser(address user, uint256 positionId) internal {
        uint256[] storage userPositions = userPositionIds[user];
        for (uint256 i = 0; i < userPositions.length; i++) {
            if (userPositions[i] == positionId) {
                userPositions[i] = userPositions[userPositions.length - 1];
                userPositions.pop();
                break;
            }
        }
    }
    
    function _settlePosition(uint256 positionId, uint256 sizeToClose) internal returns (int256 pnl) {
        MetricPosition storage pos = metricPositions[positionId];
        MetricMarket storage market = metricMarkets[pos.metricId];
        
        require(market.isSettled, "MetricVAMM: market not settled");
        
        // Calculate settlement PnL based on target value vs actual settlement value
        uint256 settlementValue = market.settlementValue;
        
        if (pos.positionType == PositionType.PREDICTION) {
            // For prediction positions, calculate based on accuracy
            uint256 accuracy = pos.targetValue > settlementValue 
                ? settlementValue * PRICE_PRECISION / pos.targetValue
                : pos.targetValue * PRICE_PRECISION / settlementValue;
            
            // Reward accuracy (simplified - could be more sophisticated)
            pnl = int256(sizeToClose * accuracy / PRICE_PRECISION);
        } else {
            // For regular settlement positions, use standard PnL calculation
            if (pos.isLong) {
                pnl = int256(sizeToClose * (settlementValue - pos.entryPrice) / PRICE_PRECISION);
            } else {
                pnl = int256(sizeToClose * (pos.entryPrice - settlementValue) / PRICE_PRECISION);
            }
        }
        
        // Apply settlement fee
        uint256 settlementFee = (sizeToClose * tradingFeeRate) / BASIS_POINTS;
        pnl -= int256(settlementFee);
        
        // Update position
        uint256 positionSize = uint256(pos.size);
        if (sizeToClose == positionSize) {
            pos.isActive = false;
            _removePositionFromUser(positionOwner[positionId], positionId);
        } else {
            pos.size = pos.size - int256(sizeToClose);
        }
        
        // Update vault
        address user = positionOwner[positionId];
        vault.updatePnL(user, pnl);
        
        uint256 marginToRelease = (vault.getMarginAccount(user).reservedMargin * sizeToClose) / positionSize;
        vault.releaseMargin(user, marginToRelease);
        
        totalTradingFees += settlementFee;
        
        return pnl;
    }
    
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
    
    // =================================
    // IvAMM Compatibility Functions
    // =================================
    
    function openPosition(
        uint256 collateralAmount,
        bool isLong,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external override returns (uint256 positionId) {
        // Use global funding state for traditional positions
        updateFunding();
        
        uint256 positionSize = collateralAmount * leverage;
        uint256 currentPrice = getMarkPrice();
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "MetricVAMM: price slippage");
        
        uint256 tradingFee = (positionSize * tradingFeeRate) / BASIS_POINTS;
        uint256 totalCost = collateralAmount + tradingFee;
        
        vault.reserveMargin(msg.sender, totalCost);
        
        positionId = globalPositionId++;
        
        // Create traditional position (no metric ID)
        metricPositions[positionId] = MetricPosition({
            positionId: positionId,
            metricId: bytes32(0), // No metric for traditional positions
            size: int256(positionSize),
            isLong: isLong,
            entryPrice: currentPrice,
            targetValue: 0,
            settlementDate: 0,
            entryFundingIndex: globalFundingState.fundingIndex,
            lastInteractionTime: block.timestamp,
            isActive: true,
            isSettlementBased: false,
            positionType: PositionType.CONTINUOUS
        });
        
        positionOwner[positionId] = msg.sender;
        userPositionIds[msg.sender].push(positionId);
        
        if (isLong) {
            totalLongSize += int256(positionSize);
        } else {
            totalShortSize += int256(positionSize);
        }
        
        totalTradingFees += tradingFee;
        
        return positionId;
    }
    
    function addToPosition(
        uint256 positionId,
        uint256 collateralAmount,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external override returns (uint256 newSize) {
        require(collateralAmount > 0, "MetricVAMM: invalid collateral");
        require(leverage >= MIN_LEVERAGE && leverage <= MAX_LEVERAGE, "MetricVAMM: invalid leverage");
        require(metricPositions[positionId].isActive, "MetricVAMM: position not active");
        require(positionOwner[positionId] == msg.sender, "MetricVAMM: not position owner");
        
        MetricPosition storage pos = metricPositions[positionId];
        
        // Update funding
        if (pos.metricId == bytes32(0)) {
            updateFunding();
        } else {
            updateMetricFunding(pos.metricId);
            _applyFundingToMetricPosition(positionId);
        }
        
        uint256 additionalSize = collateralAmount * leverage;
        uint256 currentPrice = pos.metricId == bytes32(0) ? getMarkPrice() : _getMetricMarkPrice(pos.metricId);
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "MetricVAMM: price slippage");
        
        uint256 tradingFee = (additionalSize * tradingFeeRate) / BASIS_POINTS;
        uint256 totalCost = collateralAmount + tradingFee;
        
        vault.reserveMargin(msg.sender, totalCost);
        
        // Update position tracking
        if (pos.isLong) {
            totalLongSize += int256(additionalSize);
            if (pos.metricId != bytes32(0)) {
                totalMetricLongSize[pos.metricId] += additionalSize;
            }
        } else {
            totalShortSize += int256(additionalSize);
            if (pos.metricId != bytes32(0)) {
                totalMetricShortSize[pos.metricId] += additionalSize;
            }
        }
        
        // Calculate weighted average entry price
        uint256 existingNotional = uint256(pos.size) * pos.entryPrice / PRICE_PRECISION;
        uint256 newNotional = additionalSize * currentPrice / PRICE_PRECISION;
        uint256 totalNotional = existingNotional + newNotional;
        
        pos.entryPrice = (totalNotional * PRICE_PRECISION) / (uint256(pos.size) + additionalSize);
        pos.size = pos.size + int256(additionalSize);
        pos.lastInteractionTime = block.timestamp;
        
        newSize = uint256(pos.size);
        totalTradingFees += tradingFee;
        
        return newSize;
    }
    
    function closePosition(
        uint256 positionId,
        uint256 sizeToClose,
        uint256 minPrice,
        uint256 maxPrice
    ) external override returns (int256 pnl) {
        require(metricPositions[positionId].isActive, "MetricVAMM: position not active");
        require(positionOwner[positionId] == msg.sender, "MetricVAMM: not position owner");
        
        MetricPosition storage pos = metricPositions[positionId];
        uint256 positionSize = uint256(pos.size);
        require(sizeToClose <= positionSize, "MetricVAMM: invalid size");
        
        // Check settlement status for settlement positions
        if (pos.isSettlementBased && pos.metricId != bytes32(0) && metricMarkets[pos.metricId].isSettled) {
            return _settlePosition(positionId, sizeToClose);
        }
        
        // Update funding
        if (pos.metricId == bytes32(0)) {
            updateFunding();
        } else {
            updateMetricFunding(pos.metricId);
            _applyFundingToMetricPosition(positionId);
        }
        
        uint256 currentPrice = pos.metricId == bytes32(0) ? getMarkPrice() : _getMetricMarkPrice(pos.metricId);
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "MetricVAMM: price slippage");
        
        // Calculate PnL
        if (pos.isLong) {
            pnl = int256(sizeToClose * (currentPrice - pos.entryPrice) / PRICE_PRECISION);
        } else {
            pnl = int256(sizeToClose * (pos.entryPrice - currentPrice) / PRICE_PRECISION);
        }
        
        uint256 tradingFee = (sizeToClose * tradingFeeRate) / BASIS_POINTS;
        
        // Update position tracking
        if (pos.isLong) {
            totalLongSize -= int256(sizeToClose);
            if (pos.metricId != bytes32(0)) {
                totalMetricLongSize[pos.metricId] -= sizeToClose;
            }
        } else {
            totalShortSize -= int256(sizeToClose);
            if (pos.metricId != bytes32(0)) {
                totalMetricShortSize[pos.metricId] -= sizeToClose;
            }
        }
        
        // Update position
        if (sizeToClose == positionSize) {
            pos.isActive = false;
            _removePositionFromUser(msg.sender, positionId);
        } else {
            pos.size = pos.size - int256(sizeToClose);
            pos.lastInteractionTime = block.timestamp;
        }
        
        // Update vault
        vault.updatePnL(msg.sender, pnl - int256(tradingFee));
        
        uint256 marginToRelease = (vault.getMarginAccount(msg.sender).reservedMargin * sizeToClose) / positionSize;
        vault.releaseMargin(msg.sender, marginToRelease);
        
        totalTradingFees += tradingFee;
        
        return pnl;
    }
    
    function getMarkPrice() public view override returns (uint256) {
        return oracle.getPrice();
    }
    
    function getFundingRate() external view override returns (int256) {
        return globalFundingState.fundingRate;
    }
    
    function updateFunding() public override {
        if (block.timestamp < globalFundingState.lastFundingTime + FUNDING_INTERVAL) {
            return;
        }
        
        uint256 markPrice = getMarkPrice();
        uint256 indexPrice = oracle.getPrice();
        
        int256 premiumFraction = int256((markPrice * FUNDING_PRECISION) / indexPrice) - int256(FUNDING_PRECISION);
        int256 fundingRate = premiumFraction / 24; // Hourly rate
        
        if (fundingRate > int256(MAX_FUNDING_RATE)) {
            fundingRate = int256(MAX_FUNDING_RATE);
        } else if (fundingRate < -int256(MAX_FUNDING_RATE)) {
            fundingRate = -int256(MAX_FUNDING_RATE);
        }
        
        globalFundingState.fundingRate = fundingRate;
        globalFundingState.premiumFraction = premiumFraction;
        globalFundingState.lastFundingTime = block.timestamp;
        globalFundingState.fundingIndex = uint256(int256(globalFundingState.fundingIndex) + fundingRate);
    }
    
    // Query functions
    function getPosition(uint256 positionId) external view override returns (Position memory) {
        MetricPosition storage metricPos = metricPositions[positionId];
        require(metricPos.isActive, "MetricVAMM: position not found");
        
        return Position({
            positionId: metricPos.positionId,
            size: metricPos.size,
            isLong: metricPos.isLong,
            entryPrice: metricPos.entryPrice,
            entryFundingIndex: metricPos.entryFundingIndex,
            lastInteractionTime: metricPos.lastInteractionTime,
            isActive: metricPos.isActive
        });
    }
    
    function getMetricMarket(bytes32 metricId) external view override returns (MetricMarket memory) {
        require(_metricMarketExists(metricId), "MetricVAMM: market not found");
        return metricMarkets[metricId];
    }
    
    function getMetricPosition(uint256 positionId) external view override returns (MetricPosition memory) {
        require(metricPositions[positionId].isActive, "MetricVAMM: position not found");
        return metricPositions[positionId];
    }
    
    function getMetricMarkPrice(bytes32 metricId) external view override returns (uint256) {
        return _getMetricMarkPrice(metricId);
    }
    
    function getMetricFundingRate(bytes32 metricId) external view override returns (int256) {
        return metricFundingStates[metricId].fundingRate;
    }
    
    function getMetricPositionsByUser(address user, bytes32 metricId) external view override returns (uint256[] memory) {
        uint256[] memory userPosIds = userPositionIds[user];
        uint256 count = 0;
        
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (metricPositions[userPosIds[i]].metricId == metricId && metricPositions[userPosIds[i]].isActive) {
                count++;
            }
        }
        
        uint256[] memory result = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (metricPositions[userPosIds[i]].metricId == metricId && metricPositions[userPosIds[i]].isActive) {
                result[index] = userPosIds[i];
                index++;
            }
        }
        
        return result;
    }
    
    // Additional IvAMM compatibility functions
    function getUserPosition(address user, uint256 positionId) external view override returns (Position memory) {
        require(positionOwner[positionId] == user, "MetricVAMM: not position owner");
        return this.getPosition(positionId);
    }
    
    function getUserPositions(address user) external view override returns (Position[] memory) {
        uint256[] memory userPosIds = userPositionIds[user];
        uint256 activeCount = 0;
        
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (metricPositions[userPosIds[i]].isActive) {
                activeCount++;
            }
        }
        
        Position[] memory result = new Position[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (metricPositions[userPosIds[i]].isActive) {
                result[index] = this.getPosition(userPosIds[i]);
                index++;
            }
        }
        
        return result;
    }
    
    function getUserPositionIds(address user) external view override returns (uint256[] memory) {
        uint256[] memory userPosIds = userPositionIds[user];
        uint256 activeCount = 0;
        
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (metricPositions[userPosIds[i]].isActive) {
                activeCount++;
            }
        }
        
        uint256[] memory result = new uint256[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (metricPositions[userPosIds[i]].isActive) {
                result[index] = userPosIds[i];
                index++;
            }
        }
        
        return result;
    }
    
    function getFundingState() external view override returns (FundingState memory) {
        return globalFundingState;
    }
    
    function getUnrealizedPnL(uint256 positionId) external view override returns (int256) {
        MetricPosition storage pos = metricPositions[positionId];
        if (!pos.isActive || pos.size == 0) return 0;
        
        uint256 currentPrice;
        if (pos.metricId == bytes32(0)) {
            currentPrice = getMarkPrice(); // Traditional position
        } else {
            currentPrice = _getMetricMarkPrice(pos.metricId); // Metric position
        }
        
        uint256 positionSize = uint256(pos.size);
        
        if (pos.isLong) {
            return int256(positionSize * (currentPrice - pos.entryPrice) / PRICE_PRECISION);
        } else {
            return int256(positionSize * (pos.entryPrice - currentPrice) / PRICE_PRECISION);
        }
    }
    
    function getTotalUnrealizedPnL(address user) external view override returns (int256) {
        uint256[] memory userPosIds = userPositionIds[user];
        int256 totalPnL = 0;
        
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (metricPositions[userPosIds[i]].isActive) {
                totalPnL += this.getUnrealizedPnL(userPosIds[i]);
            }
        }
        
        return totalPnL;
    }
    
    function getPriceImpact(uint256 size, bool isLong) external view override returns (uint256) {
        // Simplified price impact calculation
        return size / 1000; // 0.1% impact per 1000 units
    }
    
    function getUserSummary(address user) external view override returns (
        uint256 totalLongSize,
        uint256 totalShortSize,
        int256 totalPnL,
        uint256 activePositionsCount
    ) {
        uint256[] memory userPosIds = userPositionIds[user];
        
        for (uint256 i = 0; i < userPosIds.length; i++) {
            MetricPosition storage pos = metricPositions[userPosIds[i]];
            if (pos.isActive) {
                activePositionsCount++;
                totalPnL += this.getUnrealizedPnL(userPosIds[i]);
                
                if (pos.isLong) {
                    totalLongSize += uint256(pos.size);
                } else {
                    totalShortSize += uint256(pos.size);
                }
            }
        }
        
        return (totalLongSize, totalShortSize, totalPnL, activePositionsCount);
    }
    
    function getEffectiveReserves() external view override returns (uint256 baseReserves, uint256 quoteReserves) {
        uint256 totalVolume = uint256(totalLongSize >= 0 ? totalLongSize : -totalLongSize) + 
                              uint256(totalShortSize >= 0 ? totalShortSize : -totalShortSize);
        
        uint256 dynamicMultiplier = minReserveMultiplier;
        if (totalVolume > 0) {
            uint256 volumeMultiplier = (totalVolume * PRICE_PRECISION) / volumeScaleFactor;
            dynamicMultiplier = volumeMultiplier > minReserveMultiplier ? volumeMultiplier : minReserveMultiplier;
            dynamicMultiplier = dynamicMultiplier < maxReserveMultiplier ? dynamicMultiplier : maxReserveMultiplier;
        }
        
        baseReserves = (baseVirtualBaseReserves * dynamicMultiplier) / PRICE_PRECISION;
        quoteReserves = (baseVirtualQuoteReserves * dynamicMultiplier) / PRICE_PRECISION;
    }
    
    function getReserveInfo() external view override returns (
        uint256 baseReserves,
        uint256 quoteReserves,
        uint256 multiplier,
        uint256 totalVolume
    ) {
        (baseReserves, quoteReserves) = this.getEffectiveReserves();
        
        totalVolume = uint256(totalLongSize >= 0 ? totalLongSize : -totalLongSize) + 
                      uint256(totalShortSize >= 0 ? totalShortSize : -totalShortSize);
        
        if (totalVolume > 0) {
            uint256 volumeMultiplier = (totalVolume * PRICE_PRECISION) / volumeScaleFactor;
            multiplier = volumeMultiplier > minReserveMultiplier ? volumeMultiplier : minReserveMultiplier;
            multiplier = multiplier < maxReserveMultiplier ? multiplier : maxReserveMultiplier;
        } else {
            multiplier = minReserveMultiplier;
        }
    }
} 