// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IVault.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title Vault
 * @dev Modular margin vault for the vAMM system
 */
contract Vault is IVault {
    address public owner;
    address public vamm;
    IERC20 public collateralToken;
    
    mapping(address => MarginAccount) private accounts;
    mapping(address => bool) public authorized;
    
    uint256 public constant LIQUIDATION_THRESHOLD = 5000; // 50% in basis points
    uint256 public constant BASIS_POINTS = 10000;
    
    bool public paused = false;
    
    // Events
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event MarginReserved(address indexed user, uint256 amount);
    event MarginReleased(address indexed user, uint256 amount);
    event PnLUpdated(address indexed user, int256 pnlDelta);
    event FundingApplied(address indexed user, int256 fundingPayment, uint256 fundingIndex);
    event UserLiquidated(address indexed user, uint256 penalty);
    event AuthorizedAdded(address indexed account);
    event AuthorizedRemoved(address indexed account);
    event VammUpdated(address indexed newVamm);
    event Paused();
    event Unpaused();
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Vault: not owner");
        _;
    }
    
    modifier onlyAuthorized() {
        require(authorized[msg.sender] || msg.sender == owner, "Vault: not authorized");
        _;
    }
    
    modifier whenNotPaused() {
        require(!paused, "Vault: paused");
        _;
    }
    
    modifier onlyVamm() {
        require(msg.sender == vamm, "Vault: not vamm");
        _;
    }
    
    constructor(address _collateralToken) {
        owner = msg.sender;
        collateralToken = IERC20(_collateralToken);
    }
    
    /**
     * @dev Sets the vAMM contract address
     */
    function setVamm(address _vamm) external onlyOwner {
        require(_vamm != address(0), "Vault: invalid vamm");
        vamm = _vamm;
        authorized[_vamm] = true;
        emit VammUpdated(_vamm);
        emit AuthorizedAdded(_vamm);
    }
    
    /**
     * @dev Adds an authorized contract
     */
    function addAuthorized(address account) external onlyOwner {
        require(account != address(0), "Vault: invalid address");
        authorized[account] = true;
        emit AuthorizedAdded(account);
    }
    
    /**
     * @dev Removes an authorized contract
     */
    function removeAuthorized(address account) external onlyOwner {
        authorized[account] = false;
        emit AuthorizedRemoved(account);
    }
    
    /**
     * @dev Pauses the vault
     */
    function pause() external onlyOwner {
        paused = true;
        emit Paused();
    }
    
    /**
     * @dev Unpauses the vault
     */
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }
    
    /**
     * @dev Deposits collateral for a user
     */
    function depositCollateral(address user, uint256 amount) external override whenNotPaused {
        require(amount > 0, "Vault: invalid amount");
        require(user != address(0), "Vault: invalid user");
        
        // If called by user directly, transfer from user
        if (msg.sender == user) {
            require(
                collateralToken.transferFrom(user, address(this), amount),
                "Vault: transfer failed"
            );
        } else {
            // If called by authorized contract, assume tokens are already in vault
            require(authorized[msg.sender], "Vault: not authorized");
        }
        
        accounts[user].collateral += amount;
        emit CollateralDeposited(user, amount);
    }
    
    /**
     * @dev Withdraws collateral for a user
     */
    function withdrawCollateral(address user, uint256 amount) external override whenNotPaused {
        require(amount > 0, "Vault: invalid amount");
        require(user != address(0), "Vault: invalid user");
        
        // Only user or authorized contracts can withdraw
        require(msg.sender == user || authorized[msg.sender], "Vault: not authorized");
        
        MarginAccount storage account = accounts[user];
        require(account.collateral >= amount, "Vault: insufficient collateral");
        
        // Check if withdrawal would leave sufficient margin
        uint256 availableMargin = getAvailableMargin(user);
        require(availableMargin >= amount, "Vault: insufficient available margin");
        
        account.collateral -= amount;
        require(
            collateralToken.transfer(user, amount),
            "Vault: transfer failed"
        );
        
        emit CollateralWithdrawn(user, amount);
    }
    
    /**
     * @dev Reserves margin for a position
     */
    function reserveMargin(address user, uint256 amount) external override onlyAuthorized whenNotPaused {
        require(amount > 0, "Vault: invalid amount");
        require(user != address(0), "Vault: invalid user");
        
        MarginAccount storage account = accounts[user];
        uint256 availableMargin = getAvailableMargin(user);
        require(availableMargin >= amount, "Vault: insufficient margin");
        
        account.reservedMargin += amount;
        emit MarginReserved(user, amount);
    }
    
    /**
     * @dev Releases reserved margin
     */
    function releaseMargin(address user, uint256 amount) external override onlyAuthorized whenNotPaused {
        require(amount > 0, "Vault: invalid amount");
        require(user != address(0), "Vault: invalid user");
        
        MarginAccount storage account = accounts[user];
        require(account.reservedMargin >= amount, "Vault: insufficient reserved margin");
        
        account.reservedMargin -= amount;
        emit MarginReleased(user, amount);
    }
    
    /**
     * @dev Updates PnL for a user
     */
    function updatePnL(address user, int256 pnlDelta) external override onlyAuthorized {
        require(user != address(0), "Vault: invalid user");
        
        accounts[user].unrealizedPnL += pnlDelta;
        emit PnLUpdated(user, pnlDelta);
    }
    
    /**
     * @dev Applies funding payment
     */
    function applyFunding(address user, int256 fundingPayment, uint256 fundingIndex) external override onlyAuthorized {
        require(user != address(0), "Vault: invalid user");
        
        MarginAccount storage account = accounts[user];
        account.unrealizedPnL += fundingPayment;
        account.lastFundingIndex = fundingIndex;
        
        emit FundingApplied(user, fundingPayment, fundingIndex);
    }
    
    /**
     * @dev Gets available margin for a user
     */
    function getAvailableMargin(address user) public view override returns (uint256) {
        MarginAccount storage account = accounts[user];
        int256 totalMargin = getTotalMargin(user);
        
        if (totalMargin <= 0) return 0;
        
        uint256 totalMarginUint = uint256(totalMargin);
        if (totalMarginUint <= account.reservedMargin) return 0;
        
        return totalMarginUint - account.reservedMargin;
    }
    
    /**
     * @dev Gets total margin (collateral + unrealized PnL)
     */
    function getTotalMargin(address user) public view override returns (int256) {
        MarginAccount storage account = accounts[user];
        return int256(account.collateral) + account.unrealizedPnL;
    }
    
    /**
     * @dev Checks if user can be liquidated
     */
    function canLiquidate(address user, uint256 maintenanceMarginRatio) external view override returns (bool) {
        MarginAccount storage account = accounts[user];
        
        if (account.reservedMargin == 0) return false; // No position
        
        int256 totalMargin = getTotalMargin(user);
        if (totalMargin <= 0) return true;
        
        uint256 requiredMargin = (account.reservedMargin * maintenanceMarginRatio) / BASIS_POINTS;
        return uint256(totalMargin) < requiredMargin;
    }
    
    /**
     * @dev Liquidates a user's position
     */
    function liquidate(address user, uint256 liquidationPenalty) external override onlyAuthorized {
        require(user != address(0), "Vault: invalid user");
        
        MarginAccount storage account = accounts[user];
        
        // Apply liquidation penalty
        if (liquidationPenalty > 0) {
            int256 penalty = int256(liquidationPenalty);
            account.unrealizedPnL -= penalty;
        }
        
        // Reset position-related data
        account.reservedMargin = 0;
        account.unrealizedPnL = 0;
        
        emit UserLiquidated(user, liquidationPenalty);
    }
    
    /**
     * @dev Gets user's margin account
     */
    function getMarginAccount(address user) external view override returns (MarginAccount memory) {
        return accounts[user];
    }
    
    /**
     * @dev Transfers ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Vault: invalid owner");
        owner = newOwner;
    }
    
    /**
     * @dev Emergency withdrawal by owner
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        require(paused, "Vault: not paused");
        IERC20(token).transfer(owner, amount);
    }
} 