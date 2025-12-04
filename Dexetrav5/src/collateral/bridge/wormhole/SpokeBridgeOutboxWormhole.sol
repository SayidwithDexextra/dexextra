// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SpokeBridgeOutboxWormhole
 * @notice Spoke-side bridge sender for deposit messages (Spoke -> HyperLiquid).
 *         Encodes payloads and emits events for integration with Wormhole relayer.
 *
 * NOTE: This contract emits events rather than directly integrating provider endpoints.
 *       Your relayer or a thin endpoint wrapper can observe and forward the payload.
 */
contract SpokeBridgeOutboxWormhole is AccessControl, ReentrancyGuard {
    bytes32 public constant DEPOSIT_SENDER_ROLE = keccak256("DEPOSIT_SENDER_ROLE");

    mapping(uint64 => bytes32) public remoteAppByDomain;
    uint8 private constant TYPE_DEPOSIT = 1;

    event RemoteAppSet(uint64 indexed domain, bytes32 indexed remoteApp);
    event DepositSent(uint64 indexed dstDomain, bytes32 indexed dstApp, address indexed user, address token, uint256 amount, bytes32 depositId, bytes payload);

    constructor(address _admin) {
        require(_admin != address(0), "admin");
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(DEPOSIT_SENDER_ROLE, _admin);
    }

    function setRemoteApp(uint64 domain, bytes32 remoteApp) external onlyRole(DEFAULT_ADMIN_ROLE) {
        remoteAppByDomain[domain] = remoteApp;
        emit RemoteAppSet(domain, remoteApp);
    }

    function sendDeposit(
        uint64 dstDomain,
        address user,
        address token,
        uint256 amount,
        bytes32 depositId
    ) external nonReentrant onlyRole(DEPOSIT_SENDER_ROLE) {
        bytes32 dstApp = remoteAppByDomain[dstDomain];
        require(dstApp != bytes32(0), "dst app not set");
        bytes memory payload = abi.encode(TYPE_DEPOSIT, user, token, amount, depositId);
        emit DepositSent(dstDomain, dstApp, user, token, amount, depositId, payload);
    }
}






