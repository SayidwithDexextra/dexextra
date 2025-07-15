// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IMetricRegistry
 * @dev Interface for registering and managing custom metrics
 */
interface IMetricRegistry {
    struct MetricDefinition {
        bytes32 metricId;
        string name;
        string description;
        string dataSource;
        string calculationMethod;
        address creator;
        uint256 createdAt;
        uint256 settlementPeriodDays;
        uint256 minimumStake;
        bool isActive;
        bytes32 umaIdentifier;
    }

    struct MetricSubmission {
        bytes32 metricId;
        uint256 value;
        uint256 timestamp;
        string sourceUrl;
        bytes32 dataHash;
        bytes32 ipfsProofHash;
        address submitter;
        bool isDisputed;
        bool isSettled;
    }

    // Events
    event MetricRegistered(
        bytes32 indexed metricId,
        string name,
        address indexed creator,
        uint256 minimumStake
    );
    
    event MetricDeactivated(bytes32 indexed metricId, string reason);
    
    event MetricSubmitted(
        bytes32 indexed metricId,
        uint256 value,
        address indexed submitter,
        bytes32 ipfsProofHash
    );

    // Registration functions
    function registerMetric(
        string calldata name,
        string calldata description,
        string calldata dataSource,
        string calldata calculationMethod,
        uint256 settlementPeriodDays,
        uint256 minimumStake
    ) external payable returns (bytes32 metricId);

    function deactivateMetric(bytes32 metricId, string calldata reason) external;

    // Query functions
    function getMetric(bytes32 metricId) external view returns (MetricDefinition memory);
    function getMetricByName(string calldata name) external view returns (MetricDefinition memory);
    function getActiveMetrics() external view returns (bytes32[] memory);
    function getMetricsByCreator(address creator) external view returns (bytes32[] memory);
    
    // Validation functions
    function validateMetricData(
        bytes32 metricId, 
        uint256 value, 
        bytes calldata proof
    ) external view returns (bool isValid, string memory reason);
    
    function isMetricActive(bytes32 metricId) external view returns (bool);
    function getMetricStakeRequirement(bytes32 metricId) external view returns (uint256);
} 