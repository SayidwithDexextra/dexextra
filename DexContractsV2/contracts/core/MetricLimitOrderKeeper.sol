// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MetricLimitOrderManager.sol";

// Local interface for Chainlink Automation
interface AutomationCompatibleInterface {
    function checkUpkeep(bytes calldata checkData)
        external
        returns (bool upkeepNeeded, bytes memory performData);

    function performUpkeep(bytes calldata performData) external;
}

/**
 * @title MetricLimitOrderKeeper
 * @dev Chainlink Automation keeper for executing limit orders
 */
contract MetricLimitOrderKeeper is AutomationCompatibleInterface {
    MetricLimitOrderManager public immutable orderManager;
    address public immutable factory;
    
    // Keeper parameters
    uint256 public constant MAX_ORDERS_PER_CHECK = 20;
    uint256 public constant MAX_ORDERS_PER_EXECUTION = 10;
    uint256 public minExecutionInterval = 30 seconds;
    uint256 public lastExecutionTime;
    
    // Gas management
    uint256 public estimatedGasPerOrder = 200000;
    uint256 public maxGasLimit = 2000000;
    
    // Performance tracking
    uint256 public totalExecutions;
    uint256 public totalOrdersExecuted;
    uint256 public totalGasUsed;
    mapping(address => uint256) public keeperExecutions;
    
    // Events
    event UpkeepPerformed(
        uint256 ordersChecked,
        uint256 ordersExecuted,
        uint256 gasUsed,
        bytes32[] executedOrders
    );
    
    event KeeperConfigUpdated(
        uint256 minInterval,
        uint256 gasPerOrder,
        uint256 maxGas
    );

    constructor(address _orderManager, address _factory) {
        orderManager = MetricLimitOrderManager(_orderManager);
        factory = _factory;
        lastExecutionTime = block.timestamp;
    }

    /**
     * @dev Chainlink Automation checkUpkeep function
     * @param checkData Encoded metric IDs to check for executable orders
     * @return upkeepNeeded Whether orders need execution
     * @return performData Encoded data for performUpkeep
     */
    function checkUpkeep(bytes calldata checkData)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        // Check if enough time has passed since last execution
        if (block.timestamp < lastExecutionTime + minExecutionInterval) {
            return (false, "");
        }
        
        // Decode metric IDs to check (if provided)
        bytes32[] memory metricsToCheck;
        if (checkData.length > 0) {
            metricsToCheck = abi.decode(checkData, (bytes32[]));
        } else {
            // Default: check all active metrics
            metricsToCheck = _getAllActiveMetrics();
        }
        
        // Find executable orders across all specified metrics
        bytes32[] memory executableOrders = new bytes32[](MAX_ORDERS_PER_CHECK);
        uint256 executableCount = 0;
        
        for (uint256 i = 0; i < metricsToCheck.length && executableCount < MAX_ORDERS_PER_CHECK; i++) {
            bytes32[] memory metricOrders = orderManager.getExecutableOrders(
                metricsToCheck[i], 
                MAX_ORDERS_PER_CHECK - executableCount
            );
            
            // Add to executable orders array
            for (uint256 j = 0; j < metricOrders.length && executableCount < MAX_ORDERS_PER_CHECK; j++) {
                executableOrders[executableCount] = metricOrders[j];
                executableCount++;
            }
        }
        
        // Determine if upkeep is needed
        upkeepNeeded = executableCount > 0;
        
        if (upkeepNeeded) {
            // Resize executable orders array to actual count
            bytes32[] memory finalOrders = new bytes32[](executableCount);
            for (uint256 i = 0; i < executableCount; i++) {
                finalOrders[i] = executableOrders[i];
            }
            
            // Limit to max execution batch size
            if (finalOrders.length > MAX_ORDERS_PER_EXECUTION) {
                bytes32[] memory limitedOrders = new bytes32[](MAX_ORDERS_PER_EXECUTION);
                for (uint256 i = 0; i < MAX_ORDERS_PER_EXECUTION; i++) {
                    limitedOrders[i] = finalOrders[i];
                }
                performData = abi.encode(limitedOrders);
            } else {
                performData = abi.encode(finalOrders);
            }
        }
        
        return (upkeepNeeded, performData);
    }

    /**
     * @dev Chainlink Automation performUpkeep function
     * @param performData Encoded order hashes to execute
     */
    function performUpkeep(bytes calldata performData) external override {
        uint256 gasStart = gasleft();
        
        // Decode orders to execute
        bytes32[] memory orderHashes = abi.decode(performData, (bytes32[]));
        
        // VALIDATION: Must have orders to execute and not exceed limits
        // FAILS: When orderHashes array is empty OR exceeds max execution limit
        // SUCCEEDS: When orders exist and are within execution limits
        // REASONING: Empty arrays waste gas without executing orders. Excessive batches
        // could exceed gas limits and fail transaction. Validation ensures efficient execution.
        require(
            orderHashes.length > 0 && orderHashes.length <= MAX_ORDERS_PER_EXECUTION,
            "MetricLimitOrderKeeper: Invalid order batch - must have 1 to max orders for efficient execution"
        );
        
        // Execute orders in batch
        uint256 successCount = 0;
        bytes32[] memory executedOrders = new bytes32[](orderHashes.length);
        
        for (uint256 i = 0; i < orderHashes.length; i++) {
            try orderManager.executeLimitOrder(orderHashes[i]) {
                executedOrders[successCount] = orderHashes[i];
                successCount++;
            } catch {
                // Continue with next order if one fails
                // This prevents one failed order from breaking entire batch
                continue;
            }
        }
        
        // Update tracking
        uint256 gasUsed = gasStart - gasleft();
        totalExecutions++;
        totalOrdersExecuted += successCount;
        totalGasUsed += gasUsed;
        keeperExecutions[msg.sender]++;
        lastExecutionTime = block.timestamp;
        
        // Resize executed orders array to actual count
        bytes32[] memory finalExecutedOrders = new bytes32[](successCount);
        for (uint256 i = 0; i < successCount; i++) {
            finalExecutedOrders[i] = executedOrders[i];
        }
        
        emit UpkeepPerformed(
            orderHashes.length,
            successCount,
            gasUsed,
            finalExecutedOrders
        );
    }

    /**
     * @dev Get all active metrics from factory (simplified implementation)
     */
    function _getAllActiveMetrics() internal view returns (bytes32[] memory) {
        // This is a simplified implementation
        // In practice, you might want to maintain a registry of active metrics
        // or query from the factory contract
        
        // For now, return empty array - checkData should specify metrics
        return new bytes32[](0);
    }

    /**
     * @dev Check specific metric for executable orders
     */
    function checkMetricOrders(bytes32 metricId, uint256 maxOrders)
        external
        view
        returns (bool hasExecutableOrders, bytes32[] memory executableOrders)
    {
        executableOrders = orderManager.getExecutableOrders(metricId, maxOrders);
        hasExecutableOrders = executableOrders.length > 0;
    }

    /**
     * @dev Batch check multiple metrics for executable orders
     */
    function checkMultipleMetrics(bytes32[] calldata metricIds, uint256 maxOrdersPerMetric)
        external
        view
        returns (
            bool hasAnyExecutableOrders,
            uint256 totalExecutableOrders,
            bytes32[] memory allExecutableOrders
        )
    {
        bytes32[] memory tempOrders = new bytes32[](metricIds.length * maxOrdersPerMetric);
        uint256 totalCount = 0;
        
        for (uint256 i = 0; i < metricIds.length; i++) {
            bytes32[] memory metricOrders = orderManager.getExecutableOrders(
                metricIds[i],
                maxOrdersPerMetric
            );
            
            for (uint256 j = 0; j < metricOrders.length; j++) {
                tempOrders[totalCount] = metricOrders[j];
                totalCount++;
            }
        }
        
        // Resize to actual count
        allExecutableOrders = new bytes32[](totalCount);
        for (uint256 i = 0; i < totalCount; i++) {
            allExecutableOrders[i] = tempOrders[i];
        }
        
        hasAnyExecutableOrders = totalCount > 0;
        totalExecutableOrders = totalCount;
    }

    /**
     * @dev Manual execution for testing or emergency use
     */
    function manualExecuteOrders(bytes32[] calldata orderHashes) external {
        // VALIDATION: Caller must be authorized keeper or owner
        // FAILS: When caller is not authorized to execute orders manually
        // SUCCEEDS: When caller is authorized keeper or contract owner
        // REASONING: Manual execution should be restricted to authorized parties only.
        // Unauthorized execution could be used maliciously or interfere with automation.
        require(
            orderManager.authorizedKeepers(msg.sender) || msg.sender == orderManager.owner(),
            "MetricLimitOrderKeeper: Only authorized keepers or owner can manually execute orders"
        );
        
        // Use the same logic as performUpkeep
        bytes memory performData = abi.encode(orderHashes);
        this.performUpkeep(performData);
    }

    /**
     * @dev Emergency pause function
     */
    function emergencyPause() external {
        require(msg.sender == orderManager.owner(), "MetricLimitOrderKeeper: Only owner can pause");
        // This would integrate with the order manager's pause functionality
        // orderManager.pause(); // If such function exists
    }

    // === CONFIGURATION FUNCTIONS ===

    function updateKeeperConfig(
        uint256 _minExecutionInterval,
        uint256 _estimatedGasPerOrder,
        uint256 _maxGasLimit
    ) external {
        require(msg.sender == orderManager.owner(), "MetricLimitOrderKeeper: Only owner");
        
        // VALIDATION: Configuration parameters must be within reasonable bounds
        // FAILS: When parameters are outside safe operating ranges
        // SUCCEEDS: When all parameters are within acceptable limits
        // REASONING: Invalid configurations could break automation or waste gas.
        // Bounds ensure system operates efficiently and reliably.
        require(
            _minExecutionInterval >= 10 seconds && _minExecutionInterval <= 1 hours &&
            _estimatedGasPerOrder >= 50000 && _estimatedGasPerOrder <= 500000 &&
            _maxGasLimit >= 500000 && _maxGasLimit <= 5000000,
            "MetricLimitOrderKeeper: Configuration parameters out of bounds - check intervals and gas limits"
        );
        
        minExecutionInterval = _minExecutionInterval;
        estimatedGasPerOrder = _estimatedGasPerOrder;
        maxGasLimit = _maxGasLimit;
        
        emit KeeperConfigUpdated(_minExecutionInterval, _estimatedGasPerOrder, _maxGasLimit);
    }

    // === VIEW FUNCTIONS ===

    function getKeeperStats() external view returns (
        uint256 executions,
        uint256 ordersExecuted,
        uint256 gasUsed,
        uint256 avgGasPerOrder,
        uint256 lastExecution
    ) {
        executions = totalExecutions;
        ordersExecuted = totalOrdersExecuted;
        gasUsed = totalGasUsed;
        avgGasPerOrder = totalOrdersExecuted > 0 ? totalGasUsed / totalOrdersExecuted : 0;
        lastExecution = lastExecutionTime;
    }

    function getKeeperConfig() external view returns (
        uint256 minInterval,
        uint256 gasPerOrder,
        uint256 maxGas,
        uint256 maxOrdersPerCheck,
        uint256 maxOrdersPerExecution
    ) {
        minInterval = minExecutionInterval;
        gasPerOrder = estimatedGasPerOrder;
        maxGas = maxGasLimit;
        maxOrdersPerCheck = MAX_ORDERS_PER_CHECK;
        maxOrdersPerExecution = MAX_ORDERS_PER_EXECUTION;
    }

    function estimateExecutionGas(uint256 orderCount) external view returns (uint256) {
        return orderCount * estimatedGasPerOrder + 50000; // Base gas overhead
    }

    function canExecuteNow() external view returns (bool canExecute, string memory reason) {
        if (block.timestamp < lastExecutionTime + minExecutionInterval) {
            return (false, "Too soon since last execution");
        }
        
        return (true, "Ready for execution");
    }

    /**
     * @dev Get suggested check data for specific metrics
     */
    function getSuggestedCheckData(bytes32[] calldata metricIds) external pure returns (bytes memory) {
        return abi.encode(metricIds);
    }

    /**
     * @dev Get status of keeper readiness
     */
    function getKeeperReadiness() external view returns (
        bool isReady,
        string memory status,
        uint256 timeSinceLastExecution,
        uint256 timeUntilNextExecution
    ) {
        timeSinceLastExecution = block.timestamp - lastExecutionTime;
        
        if (timeSinceLastExecution >= minExecutionInterval) {
            timeUntilNextExecution = 0;
            isReady = true;
            status = "Ready for execution";
        } else {
            timeUntilNextExecution = lastExecutionTime + minExecutionInterval - block.timestamp;
            isReady = false;
            status = "Waiting for minimum interval";
        }
    }
} 