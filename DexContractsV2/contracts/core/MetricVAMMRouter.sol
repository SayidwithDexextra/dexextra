// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IMetricVAMM.sol";
import "../interfaces/ICentralizedVault.sol";
import "../interfaces/IMetricRegistry.sol";
import "../interfaces/IMetricVAMMFactory.sol";
import "./MetricLimitOrderManager.sol";

/**
 * @title MetricVAMMRouter
 * @dev Router contract providing unified interface across all specialized VAMM instances
 */
contract MetricVAMMRouter {
    // Core contracts
    IMetricVAMMFactory public immutable factory;
    ICentralizedVault public immutable centralVault;
    IMetricRegistry public immutable metricRegistry;
    MetricLimitOrderManager public limitOrderManager;
    
    // Access control
    address public owner;
    bool public paused;

    // Router stats
    uint256 public totalRouterVolume;
    uint256 public totalRouterFees;
    mapping(address => uint256) public userRouterVolume;

    struct PositionSummary {
        uint256 positionId;
        bytes32 metricId;
        address vammAddress;
        string category;
        bool isLong;
        uint256 size;
        uint256 entryPrice;
        int256 unrealizedPnL;
        IMetricVAMM.PositionType positionType;
    }

    struct PortfolioDashboard {
        uint256 totalCollateral;
        uint256 availableMargin;
        int256 totalUnrealizedPnL;
        uint256 marginRatio;
        uint256 activePositionsCount;
        uint256 activeVAMMsCount;
        PositionSummary[] positions;
    }

    // Events
    event RouteExecuted(
        address indexed user,
        address indexed vamm,
        bytes32 indexed metricId,
        string action,
        uint256 amount
    );
    event RouterVolumeUpdated(address indexed user, uint256 newVolume);

    modifier onlyOwner() {
        require(msg.sender == owner, "MetricVAMMRouter: only owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "MetricVAMMRouter: paused");
        _;
    }

    constructor(
        address _factory,
        address _centralVault,
        address _metricRegistry,
        address _limitOrderManager
    ) {
        // VALIDATION: Factory address must be a valid deployed contract for VAMM routing
        // FAILS: When _factory is zero address (0x0000...0000)
        // SUCCEEDS: When _factory points to deployed MetricVAMMFactory contract
        // REASONING: Router depends entirely on factory to find appropriate VAMMs for metrics.
        // Zero address cannot provide VAMM lookup functionality, making router unable to
        // route trades to correct specialized VAMMs. All routing operations would fail.
        require(
            _factory != address(0), 
            "MetricVAMMRouter: Factory address cannot be zero - router requires MetricVAMMFactory for VAMM discovery and trade routing"
        );
        
        // VALIDATION: Central vault address must be a valid deployed contract for collateral operations
        // FAILS: When _centralVault is zero address (0x0000...0000)
        // SUCCEEDS: When _centralVault points to deployed CentralizedVault contract
        // REASONING: Router provides unified interface for vault operations (deposits, withdrawals).
        // Zero address prevents collateral management, making router unable to handle user
        // funds or provide portfolio management functionality.
        require(
            _centralVault != address(0), 
            "MetricVAMMRouter: Central vault address cannot be zero - router requires CentralizedVault for unified collateral management"
        );
        
        // VALIDATION: Metric registry address must be a valid deployed contract for metric validation
        // FAILS: When _metricRegistry is zero address (0x0000...0000)
        // SUCCEEDS: When _metricRegistry points to deployed MetricRegistry contract
        // REASONING: Router validates metric existence and status before routing trades.
        // Zero address prevents metric validation, potentially allowing trades on
        // invalid or inactive metrics through the unified interface.
        require(
            _metricRegistry != address(0), 
            "MetricVAMMRouter: Metric registry address cannot be zero - router requires MetricRegistry for metric validation before routing"
        );
        
        // VALIDATION: Limit order manager address must be a valid deployed contract for order management
        // FAILS: When _limitOrderManager is zero address (0x0000...0000)
        // SUCCEEDS: When _limitOrderManager points to deployed MetricLimitOrderManager contract
        // REASONING: Router provides unified interface for limit order operations (creation, cancellation).
        // Zero address prevents limit order functionality, making router unable to provide
        // advanced order types and automated execution capabilities.
        require(
            _limitOrderManager != address(0), 
            "MetricVAMMRouter: Limit order manager address cannot be zero - router requires MetricLimitOrderManager for limit order functionality"
        );

        factory = IMetricVAMMFactory(_factory);
        centralVault = ICentralizedVault(_centralVault);
        metricRegistry = IMetricRegistry(_metricRegistry);
        limitOrderManager = MetricLimitOrderManager(_limitOrderManager);
        owner = msg.sender;
    }

    // === UNIFIED POSITION MANAGEMENT ===

    /**
     * @dev Open a position on any metric - router automatically finds the correct VAMM
     */
    function openPosition(
        bytes32 metricId,
        uint256 collateralAmount,
        bool isLong,
        uint256 leverage,
        uint256 targetValue,
        IMetricVAMM.PositionType positionType,
        uint256 minPrice,
        uint256 maxPrice
    ) external whenNotPaused returns (uint256 positionId) {
        address vammAddress = factory.getVAMMByMetric(metricId);
        
        // VALIDATION: Metric must have an associated VAMM for trading
        // FAILS: When no VAMM supports the specified metric (address = 0x0000...0000)
        // SUCCEEDS: When factory returns valid VAMM address for the metric
        // REASONING: Router cannot route trades without knowing which VAMM handles the metric.
        // Missing VAMM mapping indicates metric is not supported in any deployed VAMM,
        // making trading impossible. Users need to wait for VAMM deployment or choose different metric.
        require(
            vammAddress != address(0), 
            "MetricVAMMRouter: No VAMM available for metric - metric not supported in any deployed VAMM (check factory VAMM mappings or deploy new VAMM)"
        );

        IMetricVAMM vamm = IMetricVAMM(vammAddress);
        
        // Track volume for analytics
        uint256 positionSize = collateralAmount * leverage;
        totalRouterVolume += positionSize;
        userRouterVolume[msg.sender] += positionSize;

        positionId = vamm.openMetricPosition(
            metricId,
            collateralAmount,
            isLong,
            leverage,
            targetValue,
            positionType,
            minPrice,
            maxPrice
        );

        emit RouteExecuted(
            msg.sender,
            vammAddress,
            metricId,
            "openPosition",
            positionSize
        );
        emit RouterVolumeUpdated(msg.sender, userRouterVolume[msg.sender]);

        return positionId;
    }

    /**
     * @dev Close position across any VAMM
     */
    function closePosition(
        address vammAddress,
        uint256 positionId,
        uint256 sizeToClose,
        uint256 minPrice,
        uint256 maxPrice
    ) external whenNotPaused returns (int256 pnl) {
        // VALIDATION: VAMM address must be a factory-deployed and recognized VAMM
        // FAILS: When vammAddress is not deployed through factory or is invalid address
        // SUCCEEDS: When vammAddress is a legitimate VAMM deployed by the factory
        // REASONING: Router only routes to factory-managed VAMMs to ensure system integrity.
        // Arbitrary addresses could be malicious contracts that steal funds or manipulate
        // positions. Factory validation ensures VAMM legitimacy and proper integration.
        require(
            factory.isVAMMDeployed(vammAddress), 
            "MetricVAMMRouter: Invalid VAMM address - must be legitimate VAMM deployed through factory (check VAMM address and factory records)"
        );

        IMetricVAMM vamm = IMetricVAMM(vammAddress);
        
        // Get position info for tracking
        IMetricVAMM.MetricPosition memory position = vamm.getMetricPosition(positionId);
        
        pnl = vamm.closeMetricPosition(positionId, sizeToClose, minPrice, maxPrice);

        emit RouteExecuted(
            msg.sender,
            vammAddress,
            position.metricId,
            "closePosition",
            sizeToClose
        );

        return pnl;
    }

    /**
     * @dev Add to existing position across any VAMM
     */
    function addToPosition(
        address vammAddress,
        uint256 positionId,
        uint256 collateralAmount,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external whenNotPaused returns (uint256 newSize) {
        require(factory.isVAMMDeployed(vammAddress), "MetricVAMMRouter: invalid VAMM");

        IMetricVAMM vamm = IMetricVAMM(vammAddress);
        
        // Track additional volume
        uint256 additionalSize = collateralAmount * leverage;
        totalRouterVolume += additionalSize;
        userRouterVolume[msg.sender] += additionalSize;

        newSize = vamm.addToMetricPosition(
            positionId,
            collateralAmount,
            leverage,
            minPrice,
            maxPrice
        );

        // Get position info for event
        IMetricVAMM.MetricPosition memory position = vamm.getMetricPosition(positionId);

        emit RouteExecuted(
            msg.sender,
            vammAddress,
            position.metricId,
            "addToPosition",
            additionalSize
        );
        emit RouterVolumeUpdated(msg.sender, userRouterVolume[msg.sender]);

        return newSize;
    }

    // === MARKET CREATION ===

    /**
     * @dev Create market in appropriate VAMM for a metric
     */
    function createMarket(
        bytes32 metricId,
        uint256 settlementPeriodDays
    ) external whenNotPaused returns (bytes32 marketId) {
        address vammAddress = factory.getVAMMByMetric(metricId);
        require(vammAddress != address(0), "MetricVAMMRouter: no VAMM for metric");

        IMetricVAMM vamm = IMetricVAMM(vammAddress);
        marketId = vamm.createMetricMarket(metricId, settlementPeriodDays);

        emit RouteExecuted(
            msg.sender,
            vammAddress,
            metricId,
            "createMarket",
            0
        );

        return marketId;
    }

    // === UNIFIED PORTFOLIO VIEWS ===

    /**
     * @dev Get complete portfolio dashboard for a user across all VAMMs
     */
    function getPortfolioDashboard(address user) external view returns (PortfolioDashboard memory dashboard) {
        // Get vault summary
        (
            uint256 totalCollateral,
            uint256 availableMargin,
            int256 unrealizedPnL,
            uint256 marginRatio,
            uint256 activeVAMMs
        ) = centralVault.getPortfolioSummary(user);

        dashboard.totalCollateral = totalCollateral;
        dashboard.availableMargin = availableMargin;
        dashboard.totalUnrealizedPnL = unrealizedPnL;
        dashboard.marginRatio = marginRatio;
        dashboard.activeVAMMsCount = activeVAMMs;

        // Get all positions across all VAMMs
        dashboard.positions = getAllUserPositions(user);
        dashboard.activePositionsCount = dashboard.positions.length;

        return dashboard;
    }

    /**
     * @dev Get all positions for a user across all VAMMs
     */
    function getAllUserPositions(address user) public view returns (PositionSummary[] memory) {
        address[] memory allVAMMs = factory.getAllVAMMs();
        
        // First pass: count total positions
        uint256 totalPositions = 0;
        for (uint256 i = 0; i < allVAMMs.length; i++) {
            if (!factory.isVAMMDeployed(allVAMMs[i])) continue;
            
            try this.getUserPositionsFromVAMM(user, allVAMMs[i]) returns (PositionSummary[] memory positions) {
                totalPositions += positions.length;
            } catch {
                // Skip VAMMs that fail (might be paused or have issues)
                continue;
            }
        }

        // Second pass: collect all positions
        PositionSummary[] memory allPositions = new PositionSummary[](totalPositions);
        uint256 currentIndex = 0;

        for (uint256 i = 0; i < allVAMMs.length; i++) {
            if (!factory.isVAMMDeployed(allVAMMs[i])) continue;
            
            try this.getUserPositionsFromVAMM(user, allVAMMs[i]) returns (PositionSummary[] memory positions) {
                for (uint256 j = 0; j < positions.length; j++) {
                    allPositions[currentIndex] = positions[j];
                    currentIndex++;
                }
            } catch {
                continue;
            }
        }

        return allPositions;
    }

    /**
     * @dev Get user positions from a specific VAMM (external for try/catch)
     */
    function getUserPositionsFromVAMM(address user, address vammAddress) external view returns (PositionSummary[] memory) {
        IMetricVAMM vamm = IMetricVAMM(vammAddress);
        IMetricVAMMFactory.VAMMInfo memory vammInfo = factory.getVAMMInfo(vammAddress);
        
        // This is a simplified approach - in practice, you'd need to track position IDs
        // For now, we'll return empty array and let individual VAMMs handle position queries
        PositionSummary[] memory positions = new PositionSummary[](0);
        return positions;
    }

    // === ANALYTICS AND INSIGHTS ===

    /**
     * @dev Get price comparison across all VAMMs for similar metrics
     */
    function getMetricPriceComparison(bytes32 metricId) external view returns (
        address vammAddress,
        uint256 currentPrice,
        uint256 fundingRate,
        uint256 totalVolume
    ) {
        vammAddress = factory.getVAMMByMetric(metricId);
        require(vammAddress != address(0), "MetricVAMMRouter: metric not found");

        IMetricVAMM vamm = IMetricVAMM(vammAddress);
        currentPrice = vamm.getMetricMarkPrice(metricId);
        fundingRate = uint256(vamm.getMetricFundingRate(metricId));
        
        // Get volume from specialized VAMM (would need additional interface)
        totalVolume = 0; // Simplified
    }

    /**
     * @dev Get best available price for a trade across potential VAMMs
     */
    function getBestPrice(bytes32 metricId, uint256 tradeSize, bool isLong) external view returns (
        address bestVamm,
        uint256 bestPrice,
        uint256 estimatedSlippage
    ) {
        address vammAddress = factory.getVAMMByMetric(metricId);
        require(vammAddress != address(0), "MetricVAMMRouter: metric not found");

        // For now, return the only available VAMM
        // In a multi-VAMM system, this would compare across VAMMs
        bestVamm = vammAddress;
        
        IMetricVAMM vamm = IMetricVAMM(vammAddress);
        bestPrice = vamm.getMetricMarkPrice(metricId);
        
        // Simplified slippage calculation
        estimatedSlippage = (tradeSize * 100) / 1000000; // 0.01% per $1000
    }

    /**
     * @dev Get optimal position sizing recommendation
     */
    function getOptimalPositionSize(
        address user,
        bytes32 metricId,
        uint256 maxRiskPercent, // percentage of portfolio to risk (in basis points)
        uint256 leverage
    ) external view returns (
        uint256 recommendedCollateral,
        uint256 recommendedSize,
        uint256 riskRatio
    ) {
        // Get user's available margin
        uint256 availableMargin = centralVault.getAvailableMargin(user);
        
        // Calculate max risk amount
        uint256 maxRiskAmount = (availableMargin * maxRiskPercent) / 10000;
        
        // Account for leverage
        recommendedCollateral = maxRiskAmount / leverage;
        recommendedSize = recommendedCollateral * leverage;
        
        // Calculate risk ratio
        riskRatio = (recommendedSize * 10000) / availableMargin;
    }

    // === BATCH OPERATIONS ===

    /**
     * @dev Close multiple positions across different VAMMs in one transaction
     */
    function batchClosePositions(
        address[] calldata vammAddresses,
        uint256[] calldata positionIds,
        uint256[] calldata sizesToClose,
        uint256[] calldata minPrices,
        uint256[] calldata maxPrices
    ) external whenNotPaused returns (int256[] memory pnls) {
        require(
            vammAddresses.length == positionIds.length &&
            positionIds.length == sizesToClose.length &&
            sizesToClose.length == minPrices.length &&
            minPrices.length == maxPrices.length,
            "MetricVAMMRouter: arrays length mismatch"
        );

        pnls = new int256[](positionIds.length);
        
        for (uint256 i = 0; i < positionIds.length; i++) {
            pnls[i] = this.closePosition(
                vammAddresses[i],
                positionIds[i],
                sizesToClose[i],
                minPrices[i],
                maxPrices[i]
            );
        }

        return pnls;
    }

    // === CROSS-VAMM ARBITRAGE ===

    /**
     * @dev Execute arbitrage between VAMMs (if multiple VAMMs support same metric)
     */
    function executeArbitrage(
        bytes32 metricId,
        uint256 amount,
        address buyVamm,
        address sellVamm
    ) external whenNotPaused returns (int256 profit) {
        // This would be used if multiple VAMMs trade the same metric
        // For now, simplified since each metric has one VAMM
        require(false, "MetricVAMMRouter: arbitrage not available");
    }

    // === VAULT INTEGRATION ===

    /**
     * @dev Deposit collateral to centralized vault through router
     */
    function depositCollateral(uint256 amount) external whenNotPaused {
        centralVault.depositCollateral(amount);
        
        emit RouteExecuted(
            msg.sender,
            address(centralVault),
            bytes32(0),
            "deposit",
            amount
        );
    }

    /**
     * @dev Withdraw collateral from centralized vault through router
     */
    function withdrawCollateral(uint256 amount) external whenNotPaused {
        centralVault.withdrawCollateral(amount);
        
        emit RouteExecuted(
            msg.sender,
            address(centralVault),
            bytes32(0),
            "withdraw",
            amount
        );
    }

    // === LIMIT ORDER MANAGEMENT ===

    /**
     * @dev Create limit order through router
     */
    function createLimitOrder(
        bytes32 metricId,
        bool isLong,
        uint256 collateralAmount,
        uint256 leverage,
        uint256 triggerPrice,
        uint256 targetValue,
        IMetricVAMM.PositionType positionType,
        MetricLimitOrderManager.OrderType orderType,
        uint256 expiry,
        uint256 maxSlippage
    ) external whenNotPaused returns (bytes32 orderHash) {
        // Route to limit order manager
        orderHash = limitOrderManager.createLimitOrder(
            metricId,
            isLong,
            collateralAmount,
            leverage,
            triggerPrice,
            targetValue,
            positionType,
            orderType,
            expiry,
            maxSlippage
        );

        emit RouteExecuted(
            msg.sender,
            address(limitOrderManager),
            metricId,
            "createLimitOrder",
            collateralAmount
        );

        return orderHash;
    }

    /**
     * @dev Create gasless limit order through router with signature
     */
    function createLimitOrderWithSignature(
        MetricLimitOrderManager.LimitOrder memory order,
        bytes calldata signature
    ) external whenNotPaused returns (bytes32 orderHash) {
        // Route to limit order manager
        orderHash = limitOrderManager.createLimitOrderWithSignature(order, signature);

        emit RouteExecuted(
            order.user,
            address(limitOrderManager),
            order.metricId,
            "createLimitOrderGasless",
            order.collateralAmount
        );

        return orderHash;
    }

    /**
     * @dev Cancel limit order through router
     */
    function cancelLimitOrder(bytes32 orderHash, string calldata reason) external whenNotPaused {
        limitOrderManager.cancelLimitOrder(orderHash, reason);

        emit RouteExecuted(
            msg.sender,
            address(limitOrderManager),
            bytes32(0),
            "cancelLimitOrder",
            0
        );
    }

    /**
     * @dev Get user's active limit orders
     */
    function getUserActiveLimitOrders(address user) external view returns (MetricLimitOrderManager.LimitOrder[] memory) {
        return limitOrderManager.getUserActiveOrders(user);
    }

    /**
     * @dev Get executable orders for a metric
     */
    function getExecutableLimitOrders(bytes32 metricId, uint256 maxOrders) external view returns (bytes32[] memory) {
        return limitOrderManager.getExecutableOrders(metricId, maxOrders);
    }

    /**
     * @dev Get limit order details
     */
    function getLimitOrderDetails(bytes32 orderHash) external view returns (MetricLimitOrderManager.LimitOrder memory) {
        return limitOrderManager.getOrderDetails(orderHash);
    }

    /**
     * @dev Get limit order statistics
     */
    function getLimitOrderStats() external view returns (
        uint256 totalCreated,
        uint256 totalExecuted,
        uint256 totalCancelled,
        uint256 totalFeesCollected
    ) {
        return limitOrderManager.getOrderStats();
    }

    /**
     * @dev Set limit order manager (admin function)
     */
    function setLimitOrderManager(address newManager) external onlyOwner {
        require(newManager != address(0), "MetricVAMMRouter: Invalid limit order manager");
        limitOrderManager = MetricLimitOrderManager(newManager);
    }

    // === ADMIN FUNCTIONS ===

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MetricVAMMRouter: invalid owner");
        owner = newOwner;
    }

    // === VIEW FUNCTIONS ===

    function getRouterStats() external view returns (
        uint256 totalVolume,
        uint256 totalFees,
        uint256 totalVAMMs,
        uint256 totalActiveUsers
    ) {
        totalVolume = totalRouterVolume;
        totalFees = totalRouterFees;
        totalVAMMs = factory.getTotalVAMMs();
        
        // Active users would need to be tracked separately
        totalActiveUsers = 0; // Simplified
    }

    function getUserRouterStats(address user) external view returns (
        uint256 userVolume,
        uint256 totalPositions,
        uint256 activeVAMMs
    ) {
        userVolume = userRouterVolume[user];
        
        // Get portfolio summary for position counts
        (, , , , activeVAMMs) = centralVault.getPortfolioSummary(user);
        
        PositionSummary[] memory positions = getAllUserPositions(user);
        totalPositions = positions.length;
    }

    function isMetricTradeable(bytes32 metricId) external view returns (bool) {
        return factory.getVAMMByMetric(metricId) != address(0);
    }

    function getAvailableMetrics() external view returns (bytes32[] memory) {
        // This would aggregate all metrics from all VAMMs
        // Simplified implementation
        return new bytes32[](0);
    }
} 