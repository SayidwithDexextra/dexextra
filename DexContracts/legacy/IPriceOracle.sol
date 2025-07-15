// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPriceOracle
 * @dev Enhanced oracle interface for production vAMM
 */
interface IPriceOracle {
    /**
     * @dev Returns the current price with 18 decimals
     */
    function getPrice() external view returns (uint256);
    
    /**
     * @dev Returns the current price with timestamp
     */
    function getPriceWithTimestamp() external view returns (uint256 price, uint256 timestamp);
    
    /**
     * @dev Checks if the oracle is active and healthy
     */
    function isActive() external view returns (bool);
    
    /**
     * @dev Returns the maximum acceptable price age in seconds
     */
    function getMaxPriceAge() external view returns (uint256);
} 