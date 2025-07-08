// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IPriceOracle.sol";

/**
 * @title MockPriceOracle
 * @dev Mock price oracle for testing and development
 */
contract MockPriceOracle is IPriceOracle {
    address public owner;
    uint256 private price;
    uint256 private lastUpdateTime;
    uint256 public maxPriceAge = 1 hours;
    bool public active = true;
    
    event PriceUpdated(uint256 newPrice, uint256 timestamp);
    event OracleStatusChanged(bool active);
    event MaxPriceAgeUpdated(uint256 newAge);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Oracle: not owner");
        _;
    }
    
    constructor(uint256 _initialPrice) {
        owner = msg.sender;
        price = _initialPrice;
        lastUpdateTime = block.timestamp;
    }
    
    /**
     * @dev Returns the current price with 18 decimals
     */
    function getPrice() external view override returns (uint256) {
        require(active, "Oracle: inactive");
        require(block.timestamp <= lastUpdateTime + maxPriceAge, "Oracle: price too old");
        return price;
    }
    
    /**
     * @dev Returns the current price with timestamp
     */
    function getPriceWithTimestamp() external view override returns (uint256, uint256) {
        require(active, "Oracle: inactive");
        return (price, lastUpdateTime);
    }
    
    /**
     * @dev Checks if the oracle is active and healthy
     */
    function isActive() external view override returns (bool) {
        return active && (block.timestamp <= lastUpdateTime + maxPriceAge);
    }
    
    /**
     * @dev Returns the maximum acceptable price age in seconds
     */
    function getMaxPriceAge() external view override returns (uint256) {
        return maxPriceAge;
    }
    
    /**
     * @dev Updates the price (admin only)
     */
    function updatePrice(uint256 _newPrice) external onlyOwner {
        require(_newPrice > 0, "Oracle: invalid price");
        price = _newPrice;
        lastUpdateTime = block.timestamp;
        emit PriceUpdated(_newPrice, block.timestamp);
    }
    
    /**
     * @dev Sets oracle active status
     */
    function setActive(bool _active) external onlyOwner {
        active = _active;
        emit OracleStatusChanged(_active);
    }
    
    /**
     * @dev Updates max price age
     */
    function setMaxPriceAge(uint256 _maxAge) external onlyOwner {
        require(_maxAge > 0, "Oracle: invalid age");
        maxPriceAge = _maxAge;
        emit MaxPriceAgeUpdated(_maxAge);
    }
    
    /**
     * @dev Simulates price movement (for testing)
     */
     
    function simulatePriceMovement(int256 changePercent) external onlyOwner {
        require(changePercent >= -5000 && changePercent <= 5000, "Oracle: change too large"); // Max 50% change
        
        int256 newPrice = int256(price) + (int256(price) * changePercent) / 10000;
        require(newPrice > 0, "Oracle: invalid result");
        
        price = uint256(newPrice);
        lastUpdateTime = block.timestamp;
        emit PriceUpdated(price, block.timestamp);
    }
    
    /**
     * @dev Transfers ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Oracle: invalid owner");
        owner = newOwner;
    }
} 