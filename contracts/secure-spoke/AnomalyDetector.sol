// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AnomalyDetector
 * @notice On-chain anomaly detection for withdrawal patterns
 * 
 * This contract tracks withdrawal statistics and can be queried by
 * the vault or off-chain services to detect suspicious patterns.
 * 
 * Detection heuristics:
 * 1. Velocity: too many withdrawals in short time
 * 2. Volume: unusual withdrawal amounts
 * 3. Concentration: single address getting too many withdrawals
 * 4. Time patterns: unusual time-of-day patterns
 * 5. New address: first-time withdrawers getting large amounts
 */
contract AnomalyDetector is Ownable {
    
    // ═══════════════════════════════════════════════════════════════════════
    // STATISTICS TRACKING
    // ═══════════════════════════════════════════════════════════════════════
    
    struct WindowStats {
        uint256 count;
        uint256 totalValue;
        uint256 maxSingleValue;
        uint256 uniqueAddresses;
    }
    
    // Rolling window stats (hourly)
    mapping(uint256 => WindowStats) public hourlyStats;
    mapping(uint256 => mapping(address => bool)) public addressSeenInHour;
    
    // Per-address stats
    struct AddressStats {
        uint256 totalWithdrawals;
        uint256 totalValue;
        uint256 firstWithdrawalTime;
        uint256 lastWithdrawalTime;
        uint256 largestWithdrawal;
    }
    mapping(address => AddressStats) public addressStats;
    
    // Historical averages (updated periodically)
    uint256 public avgHourlyCount;
    uint256 public avgHourlyValue;
    uint256 public avgWithdrawalSize;
    uint256 public stdDevWithdrawalSize;
    uint256 public lastStatsUpdate;
    
    // Anomaly thresholds
    uint256 public velocityThreshold = 3;      // 3x normal rate
    uint256 public volumeThreshold = 5;        // 5x normal volume
    uint256 public concentrationThreshold = 30; // 30% of hourly volume to one address
    uint256 public newAddressLargeThreshold = 5000 * 1e6; // 5k USDC for new addresses
    uint256 public stdDevMultiplier = 3;       // 3 standard deviations

    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════
    
    event WithdrawalRecorded(address indexed user, uint256 amount, uint256 timestamp);
    event AnomalyDetected(address indexed user, string anomalyType, uint256 severity);
    event ThresholdsUpdated(uint256 velocity, uint256 volume, uint256 concentration);
    event StatsUpdated(uint256 avgCount, uint256 avgValue, uint256 avgSize);

    // ═══════════════════════════════════════════════════════════════════════
    // SEVERITY LEVELS
    // ═══════════════════════════════════════════════════════════════════════
    
    uint256 public constant SEVERITY_LOW = 1;
    uint256 public constant SEVERITY_MEDIUM = 2;
    uint256 public constant SEVERITY_HIGH = 3;
    uint256 public constant SEVERITY_CRITICAL = 4;

    constructor() Ownable(msg.sender) {}

    // ═══════════════════════════════════════════════════════════════════════
    // RECORDING
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Record a withdrawal for anomaly tracking
     * @dev Should be called by the vault after each withdrawal
     */
    function recordWithdrawal(address user, uint256 amount) external {
        uint256 currentHour = block.timestamp / 1 hours;
        
        // Update hourly stats
        WindowStats storage stats = hourlyStats[currentHour];
        stats.count++;
        stats.totalValue += amount;
        if (amount > stats.maxSingleValue) {
            stats.maxSingleValue = amount;
        }
        if (!addressSeenInHour[currentHour][user]) {
            addressSeenInHour[currentHour][user] = true;
            stats.uniqueAddresses++;
        }
        
        // Update address stats
        AddressStats storage addrStats = addressStats[user];
        if (addrStats.firstWithdrawalTime == 0) {
            addrStats.firstWithdrawalTime = block.timestamp;
        }
        addrStats.totalWithdrawals++;
        addrStats.totalValue += amount;
        addrStats.lastWithdrawalTime = block.timestamp;
        if (amount > addrStats.largestWithdrawal) {
            addrStats.largestWithdrawal = amount;
        }
        
        emit WithdrawalRecorded(user, amount, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ANOMALY DETECTION
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Check if a withdrawal would be anomalous
     * @return severity 0 if normal, 1-4 if anomalous
     * @return reasons Array of detected anomaly types
     */
    function checkWithdrawal(
        address user,
        uint256 amount
    ) external view returns (uint256 severity, string[] memory reasons) {
        string[] memory tempReasons = new string[](5);
        uint256 reasonCount = 0;
        uint256 maxSeverity = 0;
        
        uint256 currentHour = block.timestamp / 1 hours;
        WindowStats storage stats = hourlyStats[currentHour];
        AddressStats storage addrStats = addressStats[user];
        
        // Check 1: Velocity (too many withdrawals this hour)
        if (avgHourlyCount > 0 && stats.count > avgHourlyCount * velocityThreshold) {
            tempReasons[reasonCount++] = "HIGH_VELOCITY";
            if (stats.count > avgHourlyCount * velocityThreshold * 2) {
                maxSeverity = _max(maxSeverity, SEVERITY_CRITICAL);
            } else {
                maxSeverity = _max(maxSeverity, SEVERITY_HIGH);
            }
        }
        
        // Check 2: Volume (too much value this hour)
        if (avgHourlyValue > 0 && stats.totalValue + amount > avgHourlyValue * volumeThreshold) {
            tempReasons[reasonCount++] = "HIGH_VOLUME";
            maxSeverity = _max(maxSeverity, SEVERITY_HIGH);
        }
        
        // Check 3: Concentration (single address getting too much)
        if (stats.totalValue > 0) {
            uint256 userShare = ((addrStats.totalValue + amount) * 100) / (stats.totalValue + amount);
            if (userShare > concentrationThreshold) {
                tempReasons[reasonCount++] = "HIGH_CONCENTRATION";
                maxSeverity = _max(maxSeverity, SEVERITY_MEDIUM);
            }
        }
        
        // Check 4: New address with large withdrawal
        if (addrStats.firstWithdrawalTime == 0 && amount > newAddressLargeThreshold) {
            tempReasons[reasonCount++] = "NEW_ADDRESS_LARGE";
            maxSeverity = _max(maxSeverity, SEVERITY_MEDIUM);
        }
        
        // Check 5: Unusually large single withdrawal (statistical outlier)
        if (avgWithdrawalSize > 0 && stdDevWithdrawalSize > 0) {
            uint256 threshold = avgWithdrawalSize + (stdDevWithdrawalSize * stdDevMultiplier);
            if (amount > threshold) {
                tempReasons[reasonCount++] = "STATISTICAL_OUTLIER";
                maxSeverity = _max(maxSeverity, SEVERITY_LOW);
            }
        }
        
        // Build return array
        reasons = new string[](reasonCount);
        for (uint256 i = 0; i < reasonCount; i++) {
            reasons[i] = tempReasons[i];
        }
        
        return (maxSeverity, reasons);
    }
    
    /**
     * @notice Quick check if withdrawal is clearly suspicious
     */
    function isSuspicious(address user, uint256 amount) external view returns (bool) {
        (uint256 severity, ) = this.checkWithdrawal(user, amount);
        return severity >= SEVERITY_MEDIUM;
    }
    
    /**
     * @notice Check if we should recommend pausing
     */
    function shouldPause() external view returns (bool, string memory reason) {
        uint256 currentHour = block.timestamp / 1 hours;
        WindowStats storage stats = hourlyStats[currentHour];
        
        // Critical velocity
        if (avgHourlyCount > 0 && stats.count > avgHourlyCount * velocityThreshold * 3) {
            return (true, "CRITICAL_VELOCITY");
        }
        
        // Critical volume
        if (avgHourlyValue > 0 && stats.totalValue > avgHourlyValue * volumeThreshold * 2) {
            return (true, "CRITICAL_VOLUME");
        }
        
        return (false, "");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STATISTICS UPDATE
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Update historical averages (call periodically)
     * @param _avgHourlyCount Average withdrawals per hour
     * @param _avgHourlyValue Average value per hour
     * @param _avgWithdrawalSize Average single withdrawal size
     * @param _stdDevWithdrawalSize Standard deviation of withdrawal sizes
     */
    function updateStatistics(
        uint256 _avgHourlyCount,
        uint256 _avgHourlyValue,
        uint256 _avgWithdrawalSize,
        uint256 _stdDevWithdrawalSize
    ) external onlyOwner {
        avgHourlyCount = _avgHourlyCount;
        avgHourlyValue = _avgHourlyValue;
        avgWithdrawalSize = _avgWithdrawalSize;
        stdDevWithdrawalSize = _stdDevWithdrawalSize;
        lastStatsUpdate = block.timestamp;
        
        emit StatsUpdated(_avgHourlyCount, _avgHourlyValue, _avgWithdrawalSize);
    }
    
    /**
     * @notice Update anomaly thresholds
     */
    function updateThresholds(
        uint256 _velocityThreshold,
        uint256 _volumeThreshold,
        uint256 _concentrationThreshold,
        uint256 _newAddressLargeThreshold,
        uint256 _stdDevMultiplier
    ) external onlyOwner {
        velocityThreshold = _velocityThreshold;
        volumeThreshold = _volumeThreshold;
        concentrationThreshold = _concentrationThreshold;
        newAddressLargeThreshold = _newAddressLargeThreshold;
        stdDevMultiplier = _stdDevMultiplier;
        
        emit ThresholdsUpdated(_velocityThreshold, _volumeThreshold, _concentrationThreshold);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function getCurrentHourStats() external view returns (
        uint256 count,
        uint256 totalValue,
        uint256 maxSingleValue,
        uint256 uniqueAddresses
    ) {
        uint256 currentHour = block.timestamp / 1 hours;
        WindowStats storage stats = hourlyStats[currentHour];
        return (stats.count, stats.totalValue, stats.maxSingleValue, stats.uniqueAddresses);
    }
    
    function getAddressRiskScore(address user) external view returns (uint256 score) {
        AddressStats storage stats = addressStats[user];
        
        // New address = higher risk
        if (stats.firstWithdrawalTime == 0) {
            score += 30;
        }
        
        // High withdrawal frequency = higher risk
        if (stats.totalWithdrawals > 10) {
            score += 10;
        }
        if (stats.totalWithdrawals > 50) {
            score += 20;
        }
        
        // Large total value = higher risk
        if (stats.totalValue > 100000 * 1e6) {
            score += 20;
        }
        
        // Recent activity = higher risk during attacks
        if (stats.lastWithdrawalTime > block.timestamp - 1 hours) {
            score += 10;
        }
        
        return score > 100 ? 100 : score;
    }
    
    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
}
