// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISpokeVault {
    /**
     * @dev Release USDC to the user when a valid hub WithdrawIntent message is delivered by the bridge inbox.
     * @param user Recipient on the spoke chain
     * @param token ERC20 token address to release (must be allowed)
     * @param amount Amount in USDC (6 decimals)
     * @param withdrawId Canonical id for idempotency
     */
    function releaseToUser(
        address user,
        address token,
        uint256 amount,
        bytes32 withdrawId
    ) external;

    event Released(address indexed user, uint256 amount, bytes32 withdrawId);
}


