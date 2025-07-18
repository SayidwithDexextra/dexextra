// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISimpleVault
 * @dev Simple interface for vault operations (testing only)
 */
interface ISimpleVault {
    function depositCollateral(address user, uint256 amount) external;
    function withdrawCollateral(address user, uint256 amount) external;
    function reserveMargin(address user, uint256 amount) external;
    function releaseMargin(address user, uint256 amount) external;
    function updatePnL(address user, int256 pnlDelta) external;
    function getCollateralBalance(address user) external view returns (uint256);
    function getReservedMargin(address user) external view returns (uint256);
    function getAvailableMargin(address user) external view returns (uint256);
} 