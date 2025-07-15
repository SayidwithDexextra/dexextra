// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVault
 * @dev Interface for the margin vault contract
 */
interface IVault {
    struct MarginAccount {
        uint256 collateral;
        uint256 reservedMargin;
        int256 unrealizedPnL;
        uint256 lastFundingIndex;
    }

    /**
     * @dev Deposits collateral for a user
     */
    function depositCollateral(address user, uint256 amount) external;
    
    /**
     * @dev Withdraws collateral for a user
     */
    function withdrawCollateral(address user, uint256 amount) external;
    
    /**
     * @dev Reserves margin for a position
     */
    function reserveMargin(address user, uint256 amount) external;
    
    /**
     * @dev Releases reserved margin
     */
    function releaseMargin(address user, uint256 amount) external;
    
    /**
     * @dev Updates PnL for a user
     */
    function updatePnL(address user, int256 pnlDelta) external;
    
    /**
     * @dev Applies funding payment
     */
    function applyFunding(address user, int256 fundingPayment, uint256 fundingIndex) external;
    
    /**
     * @dev Gets available margin for a user
     */
    function getAvailableMargin(address user) external view returns (uint256);
    
    /**
     * @dev Gets total margin (collateral + unrealized PnL)
     */
    function getTotalMargin(address user) external view returns (int256);
    
    /**
     * @dev Checks if user can be liquidated
     */
    function canLiquidate(address user, uint256 maintenanceMarginRatio) external view returns (bool);
    
    /**
     * @dev Liquidates a user's position
     */
    function liquidate(address user, uint256 liquidationPenalty) external;
    
    /**
     * @dev Gets user's margin account
     */
    function getMarginAccount(address user) external view returns (MarginAccount memory);
} 