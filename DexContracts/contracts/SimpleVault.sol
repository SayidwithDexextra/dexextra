// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ISimpleVault.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title SimpleVault
 * @dev Simplified vault without security features for testing
 */
contract SimpleVault is ISimpleVault {
    address public owner;
    address public vamm;
    IERC20 public collateralToken;
    
    struct MarginAccount {
        uint256 collateral;
        uint256 reservedMargin;
        int256 unrealizedPnL;
    }
    
    mapping(address => MarginAccount) private accounts;
    
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event MarginReserved(address indexed user, uint256 amount);
    event MarginReleased(address indexed user, uint256 amount);
    event PnLUpdated(address indexed user, int256 pnlDelta);
    
    constructor(address _collateralToken) {
        owner = msg.sender;
        collateralToken = IERC20(_collateralToken);
    }
    
    function setVamm(address _vamm) external {
        require(msg.sender == owner, "Not owner");
        require(_vamm != address(0), "Invalid vamm");
        vamm = _vamm;
    }
    
    function getAvailableMargin(address user) public view override returns (uint256) {
        MarginAccount storage account = accounts[user];
        int256 totalMargin = int256(account.collateral) + account.unrealizedPnL;
        
        if (totalMargin <= 0) return 0;
        
        uint256 totalMarginUint = uint256(totalMargin);
        if (totalMarginUint <= account.reservedMargin) return 0;
        
        return totalMarginUint - account.reservedMargin;
    }
    
    function depositCollateral(address user, uint256 amount) external override {
        require(amount > 0, "Invalid amount");
        require(user != address(0), "Invalid user");
        
        // Simple transfer - no allowance checks for testing
        require(collateralToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        accounts[user].collateral += amount;
        
        emit CollateralDeposited(user, amount);
    }
    
    function withdrawCollateral(address user, uint256 amount) external override {
        require(amount > 0, "Invalid amount");
        require(user != address(0), "Invalid user");
        require(accounts[user].collateral >= amount, "Insufficient collateral");
        require(getAvailableMargin(user) >= amount, "Insufficient available margin");
        
        accounts[user].collateral -= amount;
        require(collateralToken.transfer(user, amount), "Transfer failed");
        
        emit CollateralWithdrawn(user, amount);
    }
    
    function reserveMargin(address user, uint256 amount) external override {
        require(msg.sender == vamm, "Not vamm");
        require(amount > 0, "Invalid amount");
        require(user != address(0), "Invalid user");
        require(getAvailableMargin(user) >= amount, "Insufficient margin");
        
        accounts[user].reservedMargin += amount;
        emit MarginReserved(user, amount);
    }
    
    function releaseMargin(address user, uint256 amount) external override {
        require(msg.sender == vamm, "Not vamm");
        require(amount > 0, "Invalid amount");
        require(user != address(0), "Invalid user");
        require(accounts[user].reservedMargin >= amount, "Insufficient reserved margin");
        
        accounts[user].reservedMargin -= amount;
        emit MarginReleased(user, amount);
    }
    
    function updatePnL(address user, int256 pnlDelta) external override {
        require(msg.sender == vamm, "Not vamm");
        require(user != address(0), "Invalid user");
        
        accounts[user].unrealizedPnL += pnlDelta;
        emit PnLUpdated(user, pnlDelta);
    }
    
    function getCollateralBalance(address user) external view override returns (uint256) {
        return accounts[user].collateral;
    }
    
    function getReservedMargin(address user) external view override returns (uint256) {
        return accounts[user].reservedMargin;
    }
    
    function getTotalMargin(address user) external view returns (int256) {
        MarginAccount storage account = accounts[user];
        return int256(account.collateral) + account.unrealizedPnL;
    }
    
    function getMarginAccount(address user) external view returns (MarginAccount memory) {
        return accounts[user];
    }
    
    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "Not owner");
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }
} 