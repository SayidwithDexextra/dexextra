// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IMetricVAMM
 * @dev Interface for the Metric-based Virtual Automated Market Maker
 */
interface IMetricVAMM {
    struct MetricPosition {
        uint256 positionId;
        bytes32 metricId;
        int256 size;
        bool isLong;
        uint256 entryPrice;
        uint256 targetValue; // For settlement positions
        uint256 settlementDate;
        uint256 entryFundingIndex;
        uint256 lastInteractionTime;
        bool isActive;
        bool isSettlementBased; // true for monthly settlement, false for continuous
        PositionType positionType;
    }

    struct MetricMarket {
        bytes32 metricId;
        uint256 settlementDate;
        uint256 settlementValue;
        bool isSettled;
        uint256 totalLongStake;
        uint256 totalShortStake;
        MarketStatus status;
        uint256 createdAt;
        address creator;
    }

    struct FundingState {
        int256 fundingRate;
        uint256 fundingIndex;
        uint256 lastFundingTime;
        int256 premiumFraction;
        int256 dataFreshnessPenalty;
        int256 settlementRiskAdjustment;
    }

    enum PositionType {
        CONTINUOUS,      // Traditional perpetual position
        SETTLEMENT,      // Monthly settlement position
        PREDICTION       // Prediction-based position
    }

    enum MarketStatus {
        ACTIVE,
        SETTLING,
        SETTLED,
        DISPUTED,
        CANCELLED
    }

    // Events
    event MetricMarketCreated(
        bytes32 indexed metricId,
        uint256 settlementDate,
        address indexed creator
    );

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
        uint256 sizeToClose,
        int256 pnl
    );

    event MetricMarketSettled(
        bytes32 indexed metricId,
        uint256 settlementValue,
        uint256 timestamp
    );

    event MetricFundingUpdated(
        bytes32 indexed metricId,
        int256 fundingRate,
        int256 dataFreshnessPenalty,
        int256 settlementRisk
    );

    event UMASettlementRequested(
        bytes32 indexed metricId,
        uint256 timestamp,
        bytes ancillaryData
    );

    // Metric market functions
    function createMetricMarket(
        bytes32 metricId,
        uint256 settlementPeriodDays
    ) external returns (bytes32 marketId);

    function openMetricPosition(
        bytes32 metricId,
        uint256 collateralAmount,
        bool isLong,
        uint256 leverage,
        uint256 targetValue,
        PositionType positionType,
        uint256 minPrice,
        uint256 maxPrice
    ) external returns (uint256 positionId);

    function addToMetricPosition(
        uint256 positionId,
        uint256 collateralAmount,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external returns (uint256 newSize);

    function closeMetricPosition(
        uint256 positionId,
        uint256 sizeToClose,
        uint256 minPrice,
        uint256 maxPrice
    ) external returns (int256 pnl);

    // Settlement functions
    function requestUMASettlement(bytes32 metricId) external;
    function settleMetricMarket(bytes32 metricId) external;
    function claimSettlement(uint256 positionId) external returns (uint256 payout);

    // Query functions
    function getMetricMarket(bytes32 metricId) external view returns (MetricMarket memory);
    function getMetricPosition(uint256 positionId) external view returns (MetricPosition memory);
    function getMetricMarkPrice(bytes32 metricId) external view returns (uint256);
    function getMetricFundingRate(bytes32 metricId) external view returns (int256);
    function getMetricPositionsByUser(address user, bytes32 metricId) external view returns (uint256[] memory);
    
    // Funding functions
    function updateMetricFunding(bytes32 metricId) external;
    function calculateDataFreshnessPenalty(bytes32 metricId) external view returns (int256);
    function calculateSettlementRisk(bytes32 metricId) external view returns (int256);
} 