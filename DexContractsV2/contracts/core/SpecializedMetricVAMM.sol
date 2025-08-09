// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IMetricVAMM.sol";
import "../interfaces/ICentralizedVault.sol";
import "../interfaces/IMetricRegistry.sol";
import "../interfaces/IMetricVAMMFactory.sol";

/**
 * @title SpecializedMetricVAMM
 * @dev Specialized VAMM for specific metric categories with centralized vault integration
 */
contract SpecializedMetricVAMM is IMetricVAMM {
    // Core contracts
    ICentralizedVault public immutable centralVault;
    IMetricRegistry public immutable metricRegistry;
    IMetricVAMMFactory public immutable factory;

    // Specialization parameters
    string public vammCategory;
    bytes32[] public allowedMetrics;
    mapping(bytes32 => bool) public isMetricAllowed;
    
    // Configuration from template
    uint256 public immutable maxLeverage;
    uint256 public immutable tradingFeeRate;
    uint256 public immutable liquidationFeeRate;
    uint256 public immutable maintenanceMarginRatio;
    uint256 public immutable initialMarginRatio;
    uint256 public immutable startPrice;

    // Virtual reserves configuration
    uint256 public immutable baseVirtualReserves;
    uint256 public immutable volumeScaleFactor;
    uint256 public constant minReserveMultiplier = 1e18;
    uint256 public constant maxReserveMultiplier = 100e18;

    // Constants
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant BASIS_POINTS = 10000;

    // Position tracking
    mapping(uint256 => MetricPosition) public metricPositions;
    mapping(address => uint256[]) public userPositionIds;
    mapping(uint256 => address) public positionOwner;
    uint256 public globalPositionId = 1;

    // Metric-specific state
    mapping(bytes32 => MetricMarket) public metricMarkets;
    mapping(bytes32 => FundingState) public metricFundingStates;
    mapping(bytes32 => uint256) public totalMetricLongSize;
    mapping(bytes32 => uint256) public totalMetricShortSize;

    // Global state for this VAMM
    bool public paused;
    uint256 public totalTradingFees;

    // Events already defined in IMetricVAMM interface

    modifier onlyFactory() {
        require(msg.sender == address(factory), "SpecializedVAMM: only factory");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "SpecializedVAMM: paused");
        _;
    }

    modifier onlyAllowedMetric(bytes32 metricId) {
        require(isMetricAllowed[metricId], "SpecializedVAMM: metric not allowed");
        _;
    }

    modifier validPosition(uint256 positionId) {
        require(metricPositions[positionId].isActive, "SpecializedVAMM: position not active");
        _;
    }

    modifier onlyPositionOwner(uint256 positionId) {
        require(positionOwner[positionId] == msg.sender, "SpecializedVAMM: not position owner");
        _;
    }

    constructor(
        address _centralVault,
        address _metricRegistry,
        address _factory,
        string memory _category,
        bytes32[] memory _allowedMetrics,
        IMetricVAMMFactory.VAMMTemplate memory _template,
        uint256 _startPrice
    ) {
        // VALIDATION: Central vault address must be a valid deployed contract
        // FAILS: When _centralVault is zero address (0x0000...0000)
        // SUCCEEDS: When _centralVault points to deployed CentralizedVault contract
        // REASONING: VAMM depends entirely on vault for margin management, collateral handling,
        // and position funding. Zero address cannot provide these services, making VAMM
        // completely non-functional. All trading operations would fail without vault integration.
        require(
            _centralVault != address(0), 
            "SpecializedVAMM: Central vault address cannot be zero - VAMM requires valid CentralizedVault for margin management and collateral handling"
        );
        
        // VALIDATION: Metric registry address must be a valid deployed contract
        // FAILS: When _metricRegistry is zero address (0x0000...0000)
        // SUCCEEDS: When _metricRegistry points to deployed MetricRegistry contract
        // REASONING: VAMM validates metric activity and compliance through registry before
        // allowing trades. Zero address prevents metric validation, blocking all trading
        // activity and market creation functionality.
        require(
            _metricRegistry != address(0), 
            "SpecializedVAMM: Metric registry address cannot be zero - VAMM requires MetricRegistry for metric validation and compliance checking"
        );
        
        // VALIDATION: Factory address must be a valid deployed contract
        // FAILS: When _factory is zero address (0x0000...0000)
        // SUCCEEDS: When _factory points to deployed MetricVAMMFactory contract
        // REASONING: Factory maintains VAMM authorization and system integration. VAMM
        // needs factory reference for administrative operations and system coordination.
        // Zero address breaks factory-VAMM relationship.
        require(
            _factory != address(0), 
            "SpecializedVAMM: Factory address cannot be zero - VAMM requires MetricVAMMFactory for system integration and authorization"
        );
        
        // VALIDATION: Category name cannot be empty for VAMM classification and discovery
        // FAILS: When _category is empty string ("")
        // SUCCEEDS: When _category has meaningful content for classification
        // REASONING: Categories enable users to find and understand VAMM purpose. Empty
        // categories create unclassified VAMMs that users cannot discover or comprehend.
        // Categories are essential for system organization and user experience.
        require(
            bytes(_category).length > 0, 
            "SpecializedVAMM: Category cannot be empty - VAMM requires meaningful category name for classification and user discovery"
        );
        
        // VALIDATION: VAMM must support at least one metric for trading functionality
        // FAILS: When _allowedMetrics array is empty (no tradeable metrics)
        // SUCCEEDS: When _allowedMetrics contains at least one valid metric ID
        // REASONING: VAMMs without metrics cannot facilitate any trading activity. Empty
        // metrics arrays create non-functional VAMMs that waste resources and confuse users.
        // Specialized VAMMs are defined by their supported metrics.
        require(
            _allowedMetrics.length > 0, 
            "SpecializedVAMM: No metrics specified - specialized VAMM must support at least one tradeable metric for purpose"
        );
        
        // VALIDATION: Template must be active and properly configured for VAMM deployment
        // FAILS: When _template.isActive = false (disabled or invalid template)
        // SUCCEEDS: When _template.isActive = true (validated template ready for use)
        // REASONING: Inactive templates may have invalid parameters that could break VAMM
        // functionality. Template activation ensures configuration has been validated
        // and approved for production deployment.
        require(
            _template.isActive, 
            "SpecializedVAMM: Template is inactive - VAMM requires active template with validated parameters for deployment"
        );

        centralVault = ICentralizedVault(_centralVault);
        metricRegistry = IMetricRegistry(_metricRegistry);
        factory = IMetricVAMMFactory(_factory);
        
        vammCategory = _category;
        allowedMetrics = _allowedMetrics;
        
        // Set allowed metrics mapping
        for (uint256 i = 0; i < _allowedMetrics.length; i++) {
            isMetricAllowed[_allowedMetrics[i]] = true;
        }

        // Set template parameters
        maxLeverage = _template.maxLeverage;
        tradingFeeRate = _template.tradingFeeRate;
        liquidationFeeRate = _template.liquidationFeeRate;
        maintenanceMarginRatio = _template.maintenanceMarginRatio;
        initialMarginRatio = maintenanceMarginRatio * 2; // 2x maintenance for initial
        baseVirtualReserves = _template.initialReserves;
        volumeScaleFactor = _template.volumeScaleFactor;
        startPrice = _startPrice;
    }

    // === MARKET CREATION ===

    function createMetricMarket(
        bytes32 metricId,
        uint256 settlementPeriodDays
    ) external override onlyAllowedMetric(metricId) whenNotPaused returns (bytes32 marketId) {
        // VALIDATION: Metric must be currently active in the registry for market creation
        // FAILS: When metric is deactivated or never registered in MetricRegistry
        // SUCCEEDS: When metric exists and is currently active for trading
        // REASONING: Markets for inactive metrics cannot be properly settled or traded.
        // Deactivated metrics may have compliance issues or data source problems.
        // Only active metrics ensure reliable price discovery and settlement processes.
        require(
            metricRegistry.isMetricActive(metricId),
            "SpecializedVAMM: Metric not active in registry - cannot create market for deactivated or non-existent metric (check MetricRegistry status)"
        );
        
        // VALIDATION: Settlement period must be reasonable timeframe (1 day to 1 year)
        // FAILS: When settlementPeriodDays < 1 (same-day settlement) or > 365 (over 1 year)
        // SUCCEEDS: When settlement period is between 1 and 365 days inclusive
        // REASONING: Settlement periods under 1 day don't allow sufficient price discovery
        // or metric data accumulation. Periods over 1 year create excessive uncertainty
        // and may outlive metric relevance or data source availability.
        require(
            settlementPeriodDays >= 1 && settlementPeriodDays <= 365,
            "SpecializedVAMM: Invalid settlement period - must be between 1 day (minimum for price discovery) and 365 days (maximum for data reliability)"
        );
        
        // VALIDATION: Market must not already exist for this metric to prevent duplicates
        // FAILS: When metricMarkets[metricId].createdAt > 0 (market already exists)
        // SUCCEEDS: When metricMarkets[metricId].createdAt == 0 (no existing market)
        // REASONING: Multiple markets for same metric create confusion, liquidity fragmentation,
        // and settlement conflicts. Each metric should have single authoritative market
        // to ensure clear price discovery and unified trading activity.
        require(
            metricMarkets[metricId].createdAt == 0,
            "SpecializedVAMM: Market already exists for this metric - cannot create duplicate markets (close existing market first)"
        );

        uint256 settlementDate = block.timestamp + (settlementPeriodDays * 1 days);
        
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

        // Initialize funding state
        metricFundingStates[metricId] = FundingState({
            fundingRate: 0,
            fundingIndex: PRICE_PRECISION,
            lastFundingTime: block.timestamp,
            premiumFraction: 0,
            dataFreshnessPenalty: 0,
            settlementRiskAdjustment: 0
        });

        emit MetricMarketCreated(metricId, settlementDate, msg.sender);
        
        return metricId; // Use metricId as marketId
    }

    // === POSITION MANAGEMENT ===

    function openMetricPosition(
        bytes32 metricId,
        uint256 collateralAmount,
        bool isLong,
        uint256 leverage,
        uint256 targetValue,
        PositionType positionType,
        uint256 minPrice,
        uint256 maxPrice
    ) external override onlyAllowedMetric(metricId) whenNotPaused returns (uint256 positionId) {
        // VALIDATION: Collateral amount must be greater than zero for position backing
        // FAILS: When collateralAmount = 0 (no collateral provided)
        // SUCCEEDS: When collateralAmount > 0 (positive collateral for position security)
        // REASONING: Zero collateral positions cannot cover any losses and create systemic
        // risk. All positions require collateral backing to ensure settlement ability.
        // Zero collateral attempts could be used to create phantom positions.
        require(
            collateralAmount > 0, 
            "SpecializedVAMM: Collateral amount must be greater than zero - positions require collateral backing for loss coverage and settlement security"
        );
        
        // VALIDATION: Leverage must be within permitted range for this VAMM template
        // FAILS: When leverage < 1 (sub-unity) or > maxLeverage (exceeds VAMM limit)
        // SUCCEEDS: When leverage is between 1x and maxLeverage inclusive
        // REASONING: Leverage below 1x provides no trading advantage and creates confusion.
        // Leverage above VAMM's maxLeverage violates risk parameters set by template
        // configuration and could destabilize this specialized market.
        require(
            leverage >= 1 && leverage <= maxLeverage, 
            "SpecializedVAMM: Leverage out of bounds - must be between 1x (minimum) and maxLeverage (VAMM maximum for this category)"
        );
        
        // For settlement positions, require market to exist
        if (positionType == PositionType.SETTLEMENT) {
            // VALIDATION: Settlement positions require existing market for the metric
            // FAILS: When no market exists for this metric (createdAt = 0)
            // SUCCEEDS: When market has been created for this metric (createdAt > 0)
            // REASONING: Settlement positions depend on specific market settlement dates
            // and parameters. Without existing market, settlement cannot occur properly.
            // CONTINUOUS positions don't need markets as they settle against live prices.
            require(
                metricMarkets[metricId].createdAt > 0,
                "SpecializedVAMM: Settlement position requires existing market - create market first or use CONTINUOUS position type"
            );
            
            // VALIDATION: Market must be actively accepting new positions
            // FAILS: When market status is SETTLING, SETTLED, DISPUTED, or CANCELLED
            // SUCCEEDS: When market status is ACTIVE (accepting new positions)
            // REASONING: Non-active markets cannot accept new positions as they may be
            // in settlement process, already settled, or have operational issues.
            // Only ACTIVE markets ensure proper position lifecycle management.
            require(
                metricMarkets[metricId].status == MarketStatus.ACTIVE,
                "SpecializedVAMM: Market not accepting new positions - market status must be ACTIVE (check market settlement status)"
            );
        }

        uint256 positionSize = collateralAmount * leverage;
        uint256 currentPrice = _getMetricMarkPrice(metricId);
        
        // VALIDATION: Current market price must be within user's acceptable slippage range
        // FAILS: When currentPrice < minPrice (price moved down too much) OR currentPrice > maxPrice (price moved up too much)
        // SUCCEEDS: When minPrice <= currentPrice <= maxPrice (price within acceptable range)
        // REASONING: Price slippage protection prevents users from getting filled at unexpected prices
        // due to other trades occurring between transaction submission and execution. Without
        // slippage protection, users could face significant losses from adverse price movements
        // during blockchain confirmation delays.
        require(
            currentPrice >= minPrice && currentPrice <= maxPrice,
            "SpecializedVAMM: Price slippage exceeded limits - current market price outside acceptable range (adjust slippage tolerance or wait for favorable pricing)"
        );

        // Calculate trading fee
        uint256 tradingFee = (positionSize * tradingFeeRate) / BASIS_POINTS;
        uint256 totalCost = collateralAmount + tradingFee;

        // VALIDATION: User must have sufficient margin capacity for this position
        // FAILS: When user lacks adequate available collateral for totalCost (collateral + fees)
        // SUCCEEDS: When user has enough free margin to cover position requirements
        // REASONING: Position opening requires collateral plus trading fees to be reserved.
        // Insufficient margin creates systemic risk as positions cannot be properly backed.
        // Vault validates total portfolio health including existing positions and PnL.
        require(
            centralVault.canOpenPosition(msg.sender, totalCost),
            "SpecializedVAMM: Insufficient margin capacity - user lacks available collateral for position size plus trading fees (check vault balance and existing positions)"
        );

        // Reserve margin in central vault
        centralVault.reserveMargin(msg.sender, totalCost);

        // Create position
        positionId = globalPositionId++;
        
        // Update position tracking
        if (isLong) {
            totalMetricLongSize[metricId] += positionSize;
        } else {
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

        // Update market tracking for settlement positions
        if (positionType == PositionType.SETTLEMENT) {
            if (isLong) {
                metricMarkets[metricId].totalLongStake += positionSize;
            } else {
                metricMarkets[metricId].totalShortStake += positionSize;
            }
        }

        totalTradingFees += tradingFee;

        emit MetricPositionOpened(
            msg.sender,
            positionId,
            metricId,
            isLong,
            positionSize,
            targetValue,
            positionType
        );

        return positionId;
    }

    function addToMetricPosition(
        uint256 positionId,
        uint256 collateralAmount,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external override validPosition(positionId) onlyPositionOwner(positionId) whenNotPaused returns (uint256 newSize) {
        require(collateralAmount > 0, "SpecializedVAMM: invalid collateral");
        require(leverage >= 1 && leverage <= maxLeverage, "SpecializedVAMM: invalid leverage");

        MetricPosition storage pos = metricPositions[positionId];
        
        uint256 additionalSize = collateralAmount * leverage;
        uint256 currentPrice = _getMetricMarkPrice(pos.metricId);
        
        require(
            currentPrice >= minPrice && currentPrice <= maxPrice,
            "SpecializedVAMM: price slippage"
        );

        uint256 tradingFee = (additionalSize * tradingFeeRate) / BASIS_POINTS;
        uint256 totalCost = collateralAmount + tradingFee;

        // Reserve additional margin
        centralVault.reserveMargin(msg.sender, totalCost);

        // Update position tracking
        if (pos.isLong) {
            totalMetricLongSize[pos.metricId] += additionalSize;
        } else {
            totalMetricShortSize[pos.metricId] += additionalSize;
        }

        // Calculate weighted average entry price
        uint256 existingNotional = uint256(pos.size) * pos.entryPrice / PRICE_PRECISION;
        uint256 newNotional = additionalSize * currentPrice / PRICE_PRECISION;
        uint256 totalNotional = existingNotional + newNotional;

        pos.entryPrice = (totalNotional * PRICE_PRECISION) / (uint256(pos.size) + additionalSize);
        pos.size = pos.size + int256(additionalSize);
        pos.lastInteractionTime = block.timestamp;

        totalTradingFees += tradingFee;

        return uint256(pos.size);
    }

    function closeMetricPosition(
        uint256 positionId,
        uint256 sizeToClose,
        uint256 minPrice,
        uint256 maxPrice
    ) external override validPosition(positionId) onlyPositionOwner(positionId) whenNotPaused returns (int256 pnl) {
        MetricPosition storage pos = metricPositions[positionId];
        uint256 positionSize = uint256(pos.size);
        
        // VALIDATION: Size to close cannot exceed current position size
        // FAILS: When sizeToClose > positionSize (attempting to close more than owned)
        // SUCCEEDS: When sizeToClose <= positionSize (closing valid portion of position)
        // REASONING: Cannot close more of a position than actually exists. Over-closing
        // would create negative position sizes and break accounting systems. Partial
        // closes allow position management while full closes exit completely.
        require(
            sizeToClose <= positionSize, 
            "SpecializedVAMM: Close size exceeds position - cannot close more than current position size (check position size and reduce close amount)"
        );

        // Check if this is a settled market
        if (pos.isSettlementBased && metricMarkets[pos.metricId].isSettled) {
            return _settlePosition(positionId, sizeToClose);
        }

        uint256 currentPrice = _getMetricMarkPrice(pos.metricId);
        require(
            currentPrice >= minPrice && currentPrice <= maxPrice,
            "SpecializedVAMM: price slippage"
        );

        // Calculate PnL
        if (pos.isLong) {
            pnl = int256(sizeToClose * (currentPrice - pos.entryPrice) / PRICE_PRECISION);
        } else {
            pnl = int256(sizeToClose * (pos.entryPrice - currentPrice) / PRICE_PRECISION);
        }

        uint256 tradingFee = (sizeToClose * tradingFeeRate) / BASIS_POINTS;

        // Update position tracking
        if (pos.isLong) {
            totalMetricLongSize[pos.metricId] -= sizeToClose;
        } else {
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

        // Update vault - PnL minus fees
        centralVault.updatePnL(msg.sender, pnl - int256(tradingFee));

        // Release margin proportionally
        uint256 marginToRelease = (centralVault.getVAMMAllocation(msg.sender, address(this)).reservedMargin * sizeToClose) / positionSize;
        centralVault.releaseMargin(msg.sender, marginToRelease);

        totalTradingFees += tradingFee;

        emit MetricPositionClosed(msg.sender, positionId, pos.metricId, sizeToClose, pnl);

        return pnl;
    }

    // === SETTLEMENT FUNCTIONS ===

    function requestUMASettlement(bytes32 metricId) external override {
        // Implementation would integrate with UMA oracle
        // Simplified for now
        require(false, "SpecializedVAMM: UMA integration not implemented");
    }

    function settleMetricMarket(bytes32 metricId) external override {
        // Implementation would handle settlement with oracle data
        // Simplified for now
        require(false, "SpecializedVAMM: settlement not implemented");
    }

    function claimSettlement(uint256 positionId) external override returns (uint256 payout) {
        // Implementation would handle settlement claims
        // Simplified for now
        require(false, "SpecializedVAMM: settlement not implemented");
    }

    // === INTERNAL FUNCTIONS ===

    function _getMetricMarkPrice(bytes32 metricId) internal view returns (uint256) {
        (uint256 baseReserves, uint256 quoteReserves) = _getMetricReserves(metricId);
        return (quoteReserves * PRICE_PRECISION) / baseReserves;
    }

    function _getMetricReserves(bytes32 metricId) internal view returns (uint256 baseReserves, uint256 quoteReserves) {
        uint256 metricVolume = totalMetricLongSize[metricId] + totalMetricShortSize[metricId];
        
        // Calculate dynamic multiplier
        uint256 dynamicMultiplier = minReserveMultiplier;
        if (metricVolume > 0) {
            uint256 volumeMultiplier = (metricVolume * PRICE_PRECISION) / volumeScaleFactor;
            dynamicMultiplier = volumeMultiplier > minReserveMultiplier ? volumeMultiplier : minReserveMultiplier;
            dynamicMultiplier = dynamicMultiplier < maxReserveMultiplier ? dynamicMultiplier : maxReserveMultiplier;
        }

        baseReserves = (baseVirtualReserves * dynamicMultiplier) / PRICE_PRECISION;
        
        // Create metric-specific pricing (simplified)
        quoteReserves = (baseReserves * startPrice) / PRICE_PRECISION;

        // Adjust for position imbalance
        int256 netLongSize = int256(totalMetricLongSize[metricId]) - int256(totalMetricShortSize[metricId]);
        if (netLongSize > 0) {
            uint256 reduction = (uint256(netLongSize) * PRICE_PRECISION) / (10 * baseReserves);
            baseReserves = baseReserves > reduction ? baseReserves - reduction : baseReserves / 2;
        } else if (netLongSize < 0) {
            uint256 increase = (uint256(-netLongSize) * PRICE_PRECISION) / (10 * baseReserves);
            baseReserves = baseReserves + increase;
        }
    }

    function _settlePosition(uint256 positionId, uint256 sizeToClose) internal returns (int256 pnl) {
        MetricPosition storage pos = metricPositions[positionId];
        MetricMarket storage market = metricMarkets[pos.metricId];
        
        require(market.isSettled, "SpecializedVAMM: market not settled");

        uint256 settlementValue = market.settlementValue;
        
        if (pos.positionType == PositionType.PREDICTION) {
            // Calculate prediction accuracy
            uint256 accuracy = pos.targetValue > settlementValue 
                ? settlementValue * PRICE_PRECISION / pos.targetValue
                : pos.targetValue * PRICE_PRECISION / settlementValue;
            
            pnl = int256(sizeToClose * accuracy / PRICE_PRECISION);
        } else {
            // Standard settlement PnL
            if (pos.isLong) {
                pnl = int256(sizeToClose * (settlementValue - pos.entryPrice) / PRICE_PRECISION);
            } else {
                pnl = int256(sizeToClose * (pos.entryPrice - settlementValue) / PRICE_PRECISION);
            }
        }

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
        centralVault.updatePnL(positionOwner[positionId], pnl);

        return pnl;
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

    // === QUERY FUNCTIONS ===

    function getMetricMarket(bytes32 metricId) external view override returns (MetricMarket memory) {
        return metricMarkets[metricId];
    }

    function getMetricPosition(uint256 positionId) external view override returns (MetricPosition memory) {
        return metricPositions[positionId];
    }

    function getMetricMarkPrice(bytes32 metricId) external view override returns (uint256) {
        return _getMetricMarkPrice(metricId);
    }

    function getMetricFundingRate(bytes32 metricId) external view override returns (int256) {
        return metricFundingStates[metricId].fundingRate;
    }

    function getMetricPositionsByUser(address user, bytes32 metricId) external view override returns (uint256[] memory) {
        uint256[] memory userPositions = userPositionIds[user];
        uint256 count = 0;
        
        // Count positions for this metric
        for (uint256 i = 0; i < userPositions.length; i++) {
            if (metricPositions[userPositions[i]].metricId == metricId && metricPositions[userPositions[i]].isActive) {
                count++;
            }
        }
        
        // Build result array
        uint256[] memory result = new uint256[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < userPositions.length; i++) {
            if (metricPositions[userPositions[i]].metricId == metricId && metricPositions[userPositions[i]].isActive) {
                result[index] = userPositions[i];
                index++;
            }
        }
        
        return result;
    }

    // === FUNDING FUNCTIONS (Simplified) ===

    function updateMetricFunding(bytes32 metricId) external override {
        // Simplified funding implementation
        FundingState storage fundingState = metricFundingStates[metricId];
        fundingState.lastFundingTime = block.timestamp;
    }

    function calculateDataFreshnessPenalty(bytes32 metricId) external view override returns (int256) {
        // Simplified implementation
        return 0;
    }

    function calculateSettlementRisk(bytes32 metricId) external view override returns (int256) {
        // Simplified implementation
        return 0;
    }

    // === ADMIN FUNCTIONS ===

    function pause() external onlyFactory {
        paused = true;
    }

    function unpause() external onlyFactory {
        paused = false;
    }

    // === VIEW FUNCTIONS ===

    function getAllowedMetrics() external view returns (bytes32[] memory) {
        return allowedMetrics;
    }

    function getVAMMInfo() external view returns (
        string memory category,
        uint256 totalVAMMs,
        uint256 totalPositions,
        uint256 totalVolume
    ) {
        category = vammCategory;
        totalVAMMs = allowedMetrics.length;
        
        uint256 positionCount = 0;
        uint256 volume = 0;
        
        for (uint256 i = 0; i < allowedMetrics.length; i++) {
            bytes32 metricId = allowedMetrics[i];
            volume += totalMetricLongSize[metricId] + totalMetricShortSize[metricId];
        }
        
        totalPositions = positionCount;
        totalVolume = volume;
    }
} 