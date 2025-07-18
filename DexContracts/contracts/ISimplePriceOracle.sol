// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISimplePriceOracle
 * @dev Simple interface for price oracle (testing only)
 */
interface ISimplePriceOracle {
    function getPrice() external view returns (uint256);
    function updatePrice(uint256 newPrice) external;
} 