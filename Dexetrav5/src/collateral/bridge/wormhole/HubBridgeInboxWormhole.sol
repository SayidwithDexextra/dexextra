// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../../interfaces/ICollateralHub.sol";

/**
 * @title HubBridgeInboxWormhole
 * @notice Hub-side bridge receiver for deposit messages (Polygon/Arbitrum -> HyperLiquid).
 *         Validates remote app/domain and credits user on the hub via CollateralHub.creditFromBridge.
 *
 * Security model:
 * - Only callers with BRIDGE_ENDPOINT_ROLE may deliver messages (e.g., Wormhole relayer).
 * - Each remote domain (chain) is mapped to an expected remote app (bytes32-form address representation).
 * - Payload format is ABI-encoded: (uint8 msgType, address user, address token, uint256 amount, bytes32 id)
 *   where msgType==1 denotes a deposit credit message and `id` is the depositId (idempotent on hub).
 */
contract HubBridgeInboxWormhole is AccessControl, ReentrancyGuard {
    bytes32 public constant BRIDGE_ENDPOINT_ROLE = keccak256("BRIDGE_ENDPOINT_ROLE");

    // Hub CollateralHub to credit users on inbound messages
    address public immutable collateralHub;

    // Map remote domain (e.g., 137 for Polygon, 42161 for Arbitrum) => remote app (bytes32 Wormhole addr fmt)
    mapping(uint64 => bytes32) public remoteAppByDomain;

    // Type flags
    uint8 private constant TYPE_DEPOSIT = 1;

    event RemoteAppSet(uint64 indexed domain, bytes32 indexed remoteApp);
    event DepositDelivered(uint64 indexed srcDomain, address indexed user, address token, uint256 amount, bytes32 depositId);

    error InvalidEndpoint();
    error InvalidRemoteApp();
    error InvalidMessageType();

    constructor(address _collateralHub, address _admin) {
        require(_collateralHub != address(0) && _admin != address(0), "params");
        collateralHub = _collateralHub;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    function setRemoteApp(uint64 domain, bytes32 remoteApp) external onlyRole(DEFAULT_ADMIN_ROLE) {
        remoteAppByDomain[domain] = remoteApp;
        emit RemoteAppSet(domain, remoteApp);
    }

    /**
     * @dev Deliver a deposit credit message from a remote chain.
     * @param srcDomain Wormhole domain (chain id mapping) of the source chain
     * @param srcApp Bytes32 app address as seen by bridge (must match remoteAppByDomain)
     * @param payload ABI-encoded (uint8 msgType, address user, address token, uint256 amount, bytes32 depositId)
     */
    function receiveMessage(
        uint64 srcDomain,
        bytes32 srcApp,
        bytes calldata payload
    ) external nonReentrant onlyRole(BRIDGE_ENDPOINT_ROLE) {
        // Validate remote app
        bytes32 expected = remoteAppByDomain[srcDomain];
        if (expected == bytes32(0) || expected != srcApp) {
            revert InvalidRemoteApp();
        }

        // Decode and route
        (uint8 msgType, address user, address token, uint256 amount, bytes32 depositId) =
            abi.decode(payload, (uint8, address, address, uint256, bytes32));
        if (msgType != TYPE_DEPOSIT) {
            revert InvalidMessageType();
        }

        // Credit on hub (idempotency enforced inside CollateralHub)
        ICollateralHub(collateralHub).creditFromBridge(srcDomain, user, amount, depositId);
        emit DepositDelivered(srcDomain, user, token, amount, depositId);
    }
}






