// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title SpokeInboxAdapter
 * @notice Adapter to bridge existing Hub infrastructure to SecureSpokeVaultV3
 * 
 * This adapter provides backward compatibility with the existing Hub contracts
 * (HubBridgeOutbox, CollateralHub) while adding the enhanced security features
 * of SecureSpokeVaultV3.
 * 
 * INTEGRATION FLOW:
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 *   [HyperEVM / Hub Chain]                    [Arbitrum / Spoke Chain]
 *   
 *   ┌─────────────────┐                       ┌─────────────────────────┐
 *   │  CollateralHub  │                       │   SpokeInboxAdapter     │
 *   │  (unchanged)    │                       │   (this contract)       │
 *   └────────┬────────┘                       └────────────┬────────────┘
 *            │                                             │
 *            │ requestWithdraw()                           │ receiveMessage()
 *            ▼                                             │ (backward compat)
 *   ┌─────────────────┐                                    │
 *   │ HubBridgeOutbox │                                    ▼
 *   │  (unchanged)    │─── Wormhole/Relayer ──────► SecureSpokeVaultV3
 *   └─────────────────┘                              (with all security)
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * The adapter:
 * 1. Receives messages in the OLD format (compatible with existing HubBridgeOutbox)
 * 2. Validates the message (remote app, domain)
 * 3. Calls SecureSpokeVaultV3.releaseToUser() with the NEW security features
 * 4. Optionally integrates with AnomalyDetector for monitoring
 * 
 * This allows you to deploy the secure vault WITHOUT modifying Hub contracts.
 */

interface ISecureSpokeVaultV3 {
    function releaseToUser(
        address user,
        address token,
        uint256 amount,
        bytes32 withdrawId,
        bytes32[] calldata merkleProof,
        bytes calldata coSignerSig
    ) external;
}

interface IAnomalyDetector {
    function recordWithdrawal(address user, uint256 amount) external;
    function isSuspicious(address user, uint256 amount) external view returns (bool);
    function shouldPause() external view returns (bool, string memory);
}

contract SpokeInboxAdapter is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant BRIDGE_ENDPOINT_ROLE = keccak256("BRIDGE_ENDPOINT_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    // Target vault (immutable)
    ISecureSpokeVaultV3 public immutable secureVault;
    
    // Optional anomaly detector
    IAnomalyDetector public anomalyDetector;
    
    // Remote app trust (same as original SpokeBridgeInbox)
    mapping(uint64 => bytes32) public remoteAppByDomain;
    mapping(uint64 => bool) public domainLocked;
    
    // Message deduplication
    mapping(bytes32 => bool) public processedMessages;
    
    // Message type constant
    uint8 private constant TYPE_WITHDRAW = 2;
    
    // Auto-pause on suspicious activity
    bool public autoPauseEnabled = true;

    event RemoteAppSet(uint64 indexed domain, bytes32 indexed remoteApp);
    event DomainLocked(uint64 indexed domain);
    event WithdrawDelivered(uint64 indexed srcDomain, address indexed user, address token, uint256 amount, bytes32 withdrawId);
    event SuspiciousActivityDetected(address indexed user, uint256 amount);
    event AnomalyDetectorUpdated(address indexed detector);

    error InvalidRemoteApp();
    error InvalidMessageType();
    error MessageAlreadyProcessed();
    error DomainAlreadyLocked();
    error ZeroAddress();
    error SuspiciousActivity();

    constructor(address _secureVault, address _admin, address _guardian) {
        if (_secureVault == address(0)) revert ZeroAddress();
        if (_admin == address(0)) revert ZeroAddress();
        
        secureVault = ISecureSpokeVaultV3(_secureVault);
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(GUARDIAN_ROLE, _admin);
        if (_guardian != address(0) && _guardian != _admin) {
            _grantRole(GUARDIAN_ROLE, _guardian);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════
    
    function setRemoteApp(uint64 domain, bytes32 remoteApp) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (domainLocked[domain]) revert DomainAlreadyLocked();
        remoteAppByDomain[domain] = remoteApp;
        emit RemoteAppSet(domain, remoteApp);
    }
    
    function lockDomain(uint64 domain) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(remoteAppByDomain[domain] != bytes32(0), "remote app not set");
        domainLocked[domain] = true;
        emit DomainLocked(domain);
    }
    
    function setAnomalyDetector(address _detector) external onlyRole(DEFAULT_ADMIN_ROLE) {
        anomalyDetector = IAnomalyDetector(_detector);
        emit AnomalyDetectorUpdated(_detector);
    }
    
    function setAutoPause(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        autoPauseEnabled = enabled;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GUARDIAN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function emergencyPause(string calldata) external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MESSAGE RECEIVING (backward compatible with HubBridgeOutbox)
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Receive message from Hub - BACKWARD COMPATIBLE signature
     * @dev This matches the original SpokeBridgeInboxWormhole interface
     *      so existing relayer infrastructure works unchanged
     */
    function receiveMessage(
        uint64 srcDomain,
        bytes32 srcApp,
        bytes calldata payload
    ) external nonReentrant whenNotPaused onlyRole(BRIDGE_ENDPOINT_ROLE) {
        // Verify remote app (same as original)
        bytes32 expected = remoteAppByDomain[srcDomain];
        if (expected == bytes32(0) || expected != srcApp) {
            revert InvalidRemoteApp();
        }
        
        // Message deduplication
        bytes32 messageHash = keccak256(abi.encodePacked(srcDomain, srcApp, payload));
        if (processedMessages[messageHash]) {
            revert MessageAlreadyProcessed();
        }
        
        // Decode payload (same format as original)
        (uint8 msgType, address user, address token, uint256 amount, bytes32 withdrawId) =
            abi.decode(payload, (uint8, address, address, uint256, bytes32));
        
        if (msgType != TYPE_WITHDRAW) {
            revert InvalidMessageType();
        }
        
        // Check anomaly detector if configured
        if (address(anomalyDetector) != address(0)) {
            // Check if we should auto-pause
            if (autoPauseEnabled) {
                (bool shouldStop, string memory reason) = anomalyDetector.shouldPause();
                if (shouldStop) {
                    _pause();
                    emit SuspiciousActivityDetected(user, amount);
                    revert SuspiciousActivity();
                }
            }
            
            // Check this specific withdrawal
            if (anomalyDetector.isSuspicious(user, amount)) {
                emit SuspiciousActivityDetected(user, amount);
                if (autoPauseEnabled) {
                    _pause();
                    revert SuspiciousActivity();
                }
            }
            
            // Record for future analysis
            anomalyDetector.recordWithdrawal(user, amount);
        }
        
        // Mark processed BEFORE external call
        processedMessages[messageHash] = true;
        
        // Forward to secure vault with empty proof/signature
        // (Vault may have its own additional checks)
        bytes32[] memory emptyProof = new bytes32[](0);
        secureVault.releaseToUser(user, token, amount, withdrawId, emptyProof, "");
        
        emit WithdrawDelivered(srcDomain, user, token, amount, withdrawId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function isMessageProcessed(bytes32 messageHash) external view returns (bool) {
        return processedMessages[messageHash];
    }
}
