// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title HubBridgeOutboxWormhole
 * @notice Hub-side bridge sender for withdraw messages (HyperLiquid -> Polygon/Arbitrum).
 *         Encodes payloads and emits events for integration with Wormhole relayer.
 *
 * NOTE: This contract emits events instead of directly calling a provider endpoint to avoid vendor lock.
 *       Integrate your Wormhole endpoint in a follow-up (or have an off-chain relayer observe events).
 */
contract HubBridgeOutboxWormhole is AccessControl, ReentrancyGuard {
    bytes32 public constant WITHDRAW_SENDER_ROLE = keccak256("WITHDRAW_SENDER_ROLE");

    // Map destination domain => remote app (bytes32)
    mapping(uint64 => bytes32) public remoteAppByDomain;

    // Type flags
    uint8 private constant TYPE_WITHDRAW = 2;

    event RemoteAppSet(uint64 indexed domain, bytes32 indexed remoteApp);
    event WithdrawSent(uint64 indexed dstDomain, bytes32 indexed dstApp, address indexed user, address token, uint256 amount, bytes32 withdrawId, bytes payload);

    constructor(address _admin) {
        require(_admin != address(0), "admin");
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(WITHDRAW_SENDER_ROLE, _admin);
    }

    function setRemoteApp(uint64 domain, bytes32 remoteApp) external onlyRole(DEFAULT_ADMIN_ROLE) {
        remoteAppByDomain[domain] = remoteApp;
        emit RemoteAppSet(domain, remoteApp);
    }

    /**
     * @dev Encode and emit a withdraw message for delivery to a spoke chain.
     */
    function sendWithdraw(
        uint64 dstDomain,
        address user,
        address token,
        uint256 amount,
        bytes32 withdrawId
    ) external nonReentrant onlyRole(WITHDRAW_SENDER_ROLE) {
        bytes32 dstApp = remoteAppByDomain[dstDomain];
        require(dstApp != bytes32(0), "dst app not set");
        bytes memory payload = abi.encode(TYPE_WITHDRAW, user, token, amount, withdrawId);
        emit WithdrawSent(dstDomain, dstApp, user, token, amount, withdrawId, payload);
    }
}






