// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICollateralHub {
    struct SpokeConfig {
        address spokeVault;
        address usdc;
        bool    enabled;
    }

    function registerSpoke(
        uint64 chainId,
        SpokeConfig calldata cfg
    ) external;

    // credit via bridge receiver
    function creditFromBridge(uint64 chainId, address user, uint256 amount, bytes32 depositId) external;

    function requestWithdraw(
        address user,
        uint64 targetChainId,
        uint256 amount
    ) external returns (bytes32 withdrawId);

    event SpokeRegistered(uint64 indexed chainId, address spokeVault);
    event Credited(address indexed user, uint256 amount, uint64 chainId, bytes32 depositId);
    event WithdrawIntent(address indexed user, uint64 indexed targetChainId, uint256 amount, bytes32 withdrawId);
}


