// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IMetricVAMMFactory
 * @dev Interface for the factory that creates specialized MetricVAMM contracts
 */
interface IMetricVAMMFactory {
    struct VAMMTemplate {
        uint256 maxLeverage;           // Maximum leverage for this category
        uint256 tradingFeeRate;        // Trading fee in basis points
        uint256 liquidationFeeRate;    // Liquidation fee in basis points
        uint256 maintenanceMarginRatio; // Maintenance margin ratio
        uint256 initialReserves;       // Initial virtual reserves
        uint256 volumeScaleFactor;     // Volume scaling factor
        uint256 startPrice;            // Starting price for the VAMM
        bool isActive;                 // Template is active
        string description;            // Template description
    }

    struct VAMMInfo {
        address vammAddress;           // Deployed VAMM address
        string category;               // Category name (e.g., "Population", "Weather")
        bytes32[] allowedMetrics;      // Metrics this VAMM can trade
        string templateUsed;           // Template used for deployment
        address creator;               // Who created this VAMM
        uint256 deployedAt;           // Deployment timestamp
        bool isActive;                // VAMM is active
    }

    // Events
    event TemplateCreated(string indexed templateName, uint256 maxLeverage, uint256 tradingFeeRate);
    event TemplateUpdated(string indexed templateName, bool isActive);
    event VAMMDeployed(
        address indexed vammAddress,
        string indexed category,
        address indexed creator,
        string templateUsed,
        bytes32[] allowedMetrics
    );
    event VAMMDeactivated(address indexed vammAddress, string reason);
    event CategoryUpdated(string indexed category, address indexed newVAMM, address indexed oldVAMM);

    // Template management
    function createTemplate(
        string calldata templateName,
        uint256 maxLeverage,
        uint256 tradingFeeRate,
        uint256 liquidationFeeRate,
        uint256 maintenanceMarginRatio,
        uint256 initialReserves,
        uint256 volumeScaleFactor,
        uint256 startPrice,
        string calldata description
    ) external;

    function updateTemplate(string calldata templateName, bool isActive) external;
    function getTemplate(string calldata templateName) external view returns (VAMMTemplate memory);
    function getAllTemplates() external view returns (string[] memory);

    // VAMM deployment
    function deploySpecializedVAMM(
        string calldata category,
        bytes32[] calldata allowedMetrics,
        string calldata templateName
    ) external payable returns (address vammAddress);

    function deployCustomVAMM(
        string calldata category,
        bytes32[] calldata allowedMetrics,
        VAMMTemplate calldata customTemplate
    ) external payable returns (address vammAddress);

    // VAMM management
    function deactivateVAMM(address vammAddress, string calldata reason) external;
    function updateVAMMCategory(string calldata category, address newVAMM) external;

    // Query functions
    function getVAMMByCategory(string calldata category) external view returns (address);
    function getVAMMByMetric(bytes32 metricId) external view returns (address);
    function getVAMMInfo(address vammAddress) external view returns (VAMMInfo memory);
    function getAllVAMMs() external view returns (address[] memory);
    function getVAMMsByCreator(address creator) external view returns (address[] memory);
    function isVAMMDeployed(address vammAddress) external view returns (bool);

    // Global stats
    function getTotalVAMMs() external view returns (uint256);
    function getActiveVAMMs() external view returns (address[] memory);
    function getCategoriesCount() external view returns (uint256);
    function getAllCategories() external view returns (string[] memory);
} 