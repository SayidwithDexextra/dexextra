// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../../interfaces/ISpokeVault.sol";

/**
 * @title SpokeBridgeInboxWormhole
 * @notice Spoke-side bridge receiver for withdraw messages (HyperLiquid -> Spoke).
 *         Validates remote app/domain and instructs SpokeVault to release tokens to the user.
 *
 * Security model:
 * - Only callers with BRIDGE_ENDPOINT_ROLE may deliver messages.
 * - Each remote domain is mapped to an expected remote app.
 * - Payload: (uint8 msgType, address user, address token, uint256 amount, bytes32 withdrawId) with msgType==2.
 */
contract SpokeBridgeInboxWormhole is AccessControl, ReentrancyGuard {
    bytes32 public constant BRIDGE_ENDPOINT_ROLE = keccak256("BRIDGE_ENDPOINT_ROLE");

    address public immutable spokeVault;
    mapping(uint64 => bytes32) public remoteAppByDomain;

    uint8 private constant TYPE_WITHDRAW = 2;

    event RemoteAppSet(uint64 indexed domain, bytes32 indexed remoteApp);
    event WithdrawDelivered(uint64 indexed srcDomain, address indexed user, address token, uint256 amount, bytes32 withdrawId);

    error InvalidRemoteApp();
    error InvalidMessageType();

    constructor(address _spokeVault, address _admin) {
        require(_spokeVault != address(0) && _admin != address(0), "params");
        spokeVault = _spokeVault;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    function setRemoteApp(uint64 domain, bytes32 remoteApp) external onlyRole(DEFAULT_ADMIN_ROLE) {
        remoteAppByDomain[domain] = remoteApp;
        emit RemoteAppSet(domain, remoteApp);
    }

    function receiveMessage(
        uint64 srcDomain,
        bytes32 srcApp,
        bytes calldata payload
    ) external nonReentrant onlyRole(BRIDGE_ENDPOINT_ROLE) {
        bytes32 expected = remoteAppByDomain[srcDomain];
        if (expected == bytes32(0) || expected != srcApp) {
            revert InvalidRemoteApp();
        }
        (uint8 msgType, address user, address token, uint256 amount, bytes32 withdrawId) =
            abi.decode(payload, (uint8, address, address, uint256, bytes32));
        if (msgType != TYPE_WITHDRAW) {
            revert InvalidMessageType();
        }
        ISpokeVault(spokeVault).releaseToUser(user, token, amount, withdrawId);
        emit WithdrawDelivered(srcDomain, user, token, amount, withdrawId);
    }
}






