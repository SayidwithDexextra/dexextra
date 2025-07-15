// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IMetricRegistry.sol";

/**
 * @title MetricRegistry
 * @dev Implementation of the metric registry for custom metrics management
 */
contract MetricRegistry is IMetricRegistry {
    address public owner;
    uint256 public registrationFee = 0.1 ether; // Base registration fee
    uint256 public minimumStakeMultiplier = 10; // Minimum stake is 10x registration fee
    
    mapping(bytes32 => MetricDefinition) public metrics;
    mapping(string => bytes32) public metricsByName;
    mapping(address => bytes32[]) public metricsByCreator;
    bytes32[] public activeMetrics;
    
    mapping(bytes32 => MetricSubmission[]) public metricSubmissions;
    mapping(bytes32 => bool) public metricExists;
    
    modifier onlyOwner() {
        require(msg.sender == owner, "MetricRegistry: Not owner");
        _;
    }
    
    modifier validMetric(bytes32 metricId) {
        require(metricExists[metricId], "MetricRegistry: Metric does not exist");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @dev Registers a new metric with compliance validation
     */
    function registerMetric(
        string calldata name,
        string calldata description,
        string calldata dataSource,
        string calldata calculationMethod,
        uint256 settlementPeriodDays,
        uint256 minimumStake
    ) external payable override returns (bytes32 metricId) {
        require(msg.value >= registrationFee, "MetricRegistry: Insufficient registration fee");
        require(bytes(name).length > 0, "MetricRegistry: Empty name");
        require(bytes(dataSource).length > 0, "MetricRegistry: Empty data source");
        require(settlementPeriodDays >= 1 && settlementPeriodDays <= 365, "MetricRegistry: Invalid settlement period");
        require(minimumStake >= registrationFee * minimumStakeMultiplier, "MetricRegistry: Stake too low");
        
        // Ensure metric name is unique
        require(metricsByName[name] == bytes32(0), "MetricRegistry: Name already exists");
        
        // Generate unique metric ID
        metricId = keccak256(abi.encodePacked(name, msg.sender, block.timestamp));
        require(!metricExists[metricId], "MetricRegistry: ID collision");
        
        // Validate compliance rules
        require(_validateCompliance(dataSource, calculationMethod), "MetricRegistry: Compliance violation");
        
        // Create UMA identifier
        bytes32 umaIdentifier = keccak256(abi.encodePacked("METRIC_", name));
        
        // Store metric definition
        metrics[metricId] = MetricDefinition({
            metricId: metricId,
            name: name,
            description: description,
            dataSource: dataSource,
            calculationMethod: calculationMethod,
            creator: msg.sender,
            createdAt: block.timestamp,
            settlementPeriodDays: settlementPeriodDays,
            minimumStake: minimumStake,
            isActive: true,
            umaIdentifier: umaIdentifier
        });
        
        // Update mappings
        metricsByName[name] = metricId;
        metricsByCreator[msg.sender].push(metricId);
        activeMetrics.push(metricId);
        metricExists[metricId] = true;
        
        emit MetricRegistered(metricId, name, msg.sender, minimumStake);
        
        return metricId;
    }
    
    /**
     * @dev Deactivates a metric (only creator or owner)
     */
    function deactivateMetric(bytes32 metricId, string calldata reason) external override validMetric(metricId) {
        MetricDefinition storage metric = metrics[metricId];
        require(msg.sender == metric.creator || msg.sender == owner, "MetricRegistry: Not authorized");
        require(metric.isActive, "MetricRegistry: Already inactive");
        
        metric.isActive = false;
        
        // Remove from active metrics array
        for (uint256 i = 0; i < activeMetrics.length; i++) {
            if (activeMetrics[i] == metricId) {
                activeMetrics[i] = activeMetrics[activeMetrics.length - 1];
                activeMetrics.pop();
                break;
            }
        }
        
        emit MetricDeactivated(metricId, reason);
    }
    
    /**
     * @dev Gets metric definition by ID
     */
    function getMetric(bytes32 metricId) external view override returns (MetricDefinition memory) {
        require(metricExists[metricId], "MetricRegistry: Metric does not exist");
        return metrics[metricId];
    }
    
    /**
     * @dev Gets metric definition by name
     */
    function getMetricByName(string calldata name) external view override returns (MetricDefinition memory) {
        bytes32 metricId = metricsByName[name];
        require(metricId != bytes32(0), "MetricRegistry: Metric name not found");
        return metrics[metricId];
    }
    
    /**
     * @dev Gets all active metric IDs
     */
    function getActiveMetrics() external view override returns (bytes32[] memory) {
        return activeMetrics;
    }
    
    /**
     * @dev Gets metrics created by a specific address
     */
    function getMetricsByCreator(address creator) external view override returns (bytes32[] memory) {
        return metricsByCreator[creator];
    }
    
    /**
     * @dev Validates metric data submission (basic implementation)
     */
    function validateMetricData(
        bytes32 metricId, 
        uint256 value, 
        bytes calldata proof
    ) external view override validMetric(metricId) returns (bool isValid, string memory reason) {
        MetricDefinition memory metric = metrics[metricId];
        
        if (!metric.isActive) {
            return (false, "Metric is not active");
        }
        
        if (value == 0) {
            return (false, "Value cannot be zero");
        }
        
        if (proof.length == 0) {
            return (false, "Proof cannot be empty");
        }
        
        // Additional validation could include:
        // - IPFS hash validation
        // - Source URL validation
        // - Data format checks
        
        return (true, "Valid");
    }
    
    /**
     * @dev Checks if metric is active
     */
    function isMetricActive(bytes32 metricId) external view override returns (bool) {
        return metricExists[metricId] && metrics[metricId].isActive;
    }
    
    /**
     * @dev Gets the stake requirement for a metric
     */
    function getMetricStakeRequirement(bytes32 metricId) external view override validMetric(metricId) returns (uint256) {
        return metrics[metricId].minimumStake;
    }
    
    /**
     * @dev Submits metric data (internal function for MetricVAMM)
     */
    function submitMetricData(
        bytes32 metricId,
        uint256 value,
        string calldata sourceUrl,
        bytes32 dataHash,
        bytes32 ipfsProofHash
    ) external validMetric(metricId) {
        require(metrics[metricId].isActive, "MetricRegistry: Metric not active");
        
        MetricSubmission memory submission = MetricSubmission({
            metricId: metricId,
            value: value,
            timestamp: block.timestamp,
            sourceUrl: sourceUrl,
            dataHash: dataHash,
            ipfsProofHash: ipfsProofHash,
            submitter: msg.sender,
            isDisputed: false,
            isSettled: false
        });
        
        metricSubmissions[metricId].push(submission);
        
        emit MetricSubmitted(metricId, value, msg.sender, ipfsProofHash);
    }
    
    /**
     * @dev Validates compliance with metric rules (internal)
     */
    function _validateCompliance(
        string calldata dataSource,
        string calldata calculationMethod
    ) internal pure returns (bool) {
        // Rule validation logic:
        // 1. Data source must be publicly accessible
        // 2. Calculation method must be deterministic
        // 3. Source must support historical data
        
        bytes memory sourceBytes = bytes(dataSource);
        bytes memory methodBytes = bytes(calculationMethod);
        
        // Basic validation - could be enhanced with URL parsing, etc.
        if (sourceBytes.length < 10 || methodBytes.length < 10) {
            return false;
        }
        
        // Check for required keywords in source
        string memory sourceLower = dataSource;
        if (_contains(sourceLower, "api") || _contains(sourceLower, "http") || _contains(sourceLower, "blockchain")) {
            return true;
        }
        
        return false;
    }
    
    /**
     * @dev Simple string contains check (helper function)
     */
    function _contains(string memory source, string memory substring) internal pure returns (bool) {
        bytes memory sourceBytes = bytes(source);
        bytes memory subBytes = bytes(substring);
        
        if (subBytes.length > sourceBytes.length) return false;
        
        for (uint256 i = 0; i <= sourceBytes.length - subBytes.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < subBytes.length; j++) {
                if (sourceBytes[i + j] != subBytes[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return true;
        }
        return false;
    }
    
    /**
     * @dev Updates registration fee (owner only)
     */
    function updateRegistrationFee(uint256 newFee) external onlyOwner {
        registrationFee = newFee;
    }
    
    /**
     * @dev Updates minimum stake multiplier (owner only)
     */
    function updateMinimumStakeMultiplier(uint256 newMultiplier) external onlyOwner {
        require(newMultiplier >= 1, "MetricRegistry: Invalid multiplier");
        minimumStakeMultiplier = newMultiplier;
    }
    
    /**
     * @dev Withdraws accumulated fees (owner only)
     */
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "MetricRegistry: No fees to withdraw");
        
        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "MetricRegistry: Fee withdrawal failed");
    }
} 