// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ISimplePriceOracle.sol";

/**
 * @title SimplePriceOracle
 * @dev Simple price oracle for testing (no security features)
 */
contract SimplePriceOracle is ISimplePriceOracle {
    address public owner;
    uint256 private price;
    
    event PriceUpdated(uint256 newPrice, uint256 timestamp);
    
    constructor(uint256 _initialPrice) {
        owner = msg.sender;
        price = _initialPrice;
        emit PriceUpdated(_initialPrice, block.timestamp);
    }
    
    function getPrice() external view override returns (uint256) {
        return price;
    }
    
    function updatePrice(uint256 newPrice) external override {
        require(msg.sender == owner, "Not owner");
        require(newPrice > 0, "Invalid price");
        price = newPrice;
        emit PriceUpdated(newPrice, block.timestamp);
    }
    
    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "Not owner");
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }
} 