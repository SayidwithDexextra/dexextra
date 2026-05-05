// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title WithdrawalVerifier
 * @notice Off-chain co-signer service for withdrawal approval
 * 
 * This contract allows trusted co-signers to pre-approve withdrawals.
 * Used in conjunction with SecureSpokeVaultV3 for additional security.
 * 
 * Flow:
 * 1. User requests withdrawal on Hub
 * 2. Off-chain service validates request (fraud detection, rate limiting, etc.)
 * 3. Co-signer signs approval
 * 4. Signature included in releaseToUser call
 * 5. Vault verifies signature before releasing funds
 */
contract WithdrawalVerifier is Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Authorized co-signers
    mapping(address => bool) public isCoSigner;
    address[] public coSigners;
    
    // Threshold for multi-sig (e.g., 2-of-3)
    uint256 public requiredSignatures;
    
    // Nonce per user to prevent replay
    mapping(address => uint256) public nonces;
    
    // Approved withdrawal hashes (for batch approvals)
    mapping(bytes32 => bool) public approvedWithdrawals;
    
    // Blacklisted addresses (fraud detection)
    mapping(address => bool) public blacklisted;
    
    // Daily limits per user (additional check)
    mapping(address => mapping(uint256 => uint256)) public userDailyWithdrawals;
    uint256 public maxUserDailyLimit = 10000 * 1e6; // 10k USDC
    
    event CoSignerAdded(address indexed signer);
    event CoSignerRemoved(address indexed signer);
    event WithdrawalApproved(bytes32 indexed withdrawalHash, address indexed approver);
    event WithdrawalBatchApproved(bytes32[] hashes, address indexed approver);
    event AddressBlacklisted(address indexed user, string reason);
    event AddressUnblacklisted(address indexed user);
    event ThresholdUpdated(uint256 newThreshold);

    error NotCoSigner();
    error AddressBlacklistedError();
    error UserDailyLimitExceeded();
    error InsufficientSignatures();
    error InvalidSignature();
    error AlreadyApproved();

    constructor(address[] memory _initialCoSigners, uint256 _requiredSignatures) Ownable(msg.sender) {
        require(_requiredSignatures <= _initialCoSigners.length, "threshold too high");
        require(_requiredSignatures > 0, "threshold must be > 0");
        
        for (uint256 i = 0; i < _initialCoSigners.length; i++) {
            isCoSigner[_initialCoSigners[i]] = true;
            coSigners.push(_initialCoSigners[i]);
            emit CoSignerAdded(_initialCoSigners[i]);
        }
        
        requiredSignatures = _requiredSignatures;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CO-SIGNER MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════
    
    function addCoSigner(address signer) external onlyOwner {
        require(!isCoSigner[signer], "already co-signer");
        isCoSigner[signer] = true;
        coSigners.push(signer);
        emit CoSignerAdded(signer);
    }
    
    function removeCoSigner(address signer) external onlyOwner {
        require(isCoSigner[signer], "not co-signer");
        require(coSigners.length > requiredSignatures, "would break threshold");
        
        isCoSigner[signer] = false;
        
        // Remove from array
        for (uint256 i = 0; i < coSigners.length; i++) {
            if (coSigners[i] == signer) {
                coSigners[i] = coSigners[coSigners.length - 1];
                coSigners.pop();
                break;
            }
        }
        
        emit CoSignerRemoved(signer);
    }
    
    function setThreshold(uint256 newThreshold) external onlyOwner {
        require(newThreshold <= coSigners.length, "threshold too high");
        require(newThreshold > 0, "threshold must be > 0");
        requiredSignatures = newThreshold;
        emit ThresholdUpdated(newThreshold);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // BLACKLIST MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════
    
    function blacklistAddress(address user, string calldata reason) external {
        require(isCoSigner[msg.sender] || msg.sender == owner(), "not authorized");
        blacklisted[user] = true;
        emit AddressBlacklisted(user, reason);
    }
    
    function unblacklistAddress(address user) external onlyOwner {
        blacklisted[user] = false;
        emit AddressUnblacklisted(user);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // WITHDRAWAL APPROVAL
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Generate the hash that needs to be signed
     */
    function getWithdrawalHash(
        address user,
        address token,
        uint256 amount,
        bytes32 withdrawId,
        uint256 chainId,
        address vault
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(user, token, amount, withdrawId, chainId, vault));
    }
    
    /**
     * @notice Approve a single withdrawal (stores on-chain)
     */
    function approveWithdrawal(
        address user,
        address token,
        uint256 amount,
        bytes32 withdrawId,
        uint256 chainId,
        address vault
    ) external {
        if (!isCoSigner[msg.sender]) revert NotCoSigner();
        if (blacklisted[user]) revert AddressBlacklistedError();
        
        // Check user daily limit
        uint256 today = block.timestamp / 1 days;
        uint256 newTotal = userDailyWithdrawals[user][today] + amount;
        if (newTotal > maxUserDailyLimit) revert UserDailyLimitExceeded();
        
        bytes32 hash = getWithdrawalHash(user, token, amount, withdrawId, chainId, vault);
        if (approvedWithdrawals[hash]) revert AlreadyApproved();
        
        approvedWithdrawals[hash] = true;
        userDailyWithdrawals[user][today] = newTotal;
        
        emit WithdrawalApproved(hash, msg.sender);
    }
    
    /**
     * @notice Batch approve multiple withdrawals
     */
    function batchApproveWithdrawals(bytes32[] calldata withdrawalHashes) external {
        if (!isCoSigner[msg.sender]) revert NotCoSigner();
        
        for (uint256 i = 0; i < withdrawalHashes.length; i++) {
            if (!approvedWithdrawals[withdrawalHashes[i]]) {
                approvedWithdrawals[withdrawalHashes[i]] = true;
            }
        }
        
        emit WithdrawalBatchApproved(withdrawalHashes, msg.sender);
    }
    
    /**
     * @notice Verify a signature is from a valid co-signer
     */
    function verifySignature(
        address user,
        address token,
        uint256 amount,
        bytes32 withdrawId,
        uint256 chainId,
        address vault,
        bytes calldata signature
    ) external view returns (bool valid, address signer) {
        bytes32 hash = getWithdrawalHash(user, token, amount, withdrawId, chainId, vault);
        bytes32 ethSignedHash = hash.toEthSignedMessageHash();
        
        signer = ethSignedHash.recover(signature);
        valid = isCoSigner[signer];
    }
    
    /**
     * @notice Verify multiple signatures meet threshold
     */
    function verifyMultiSignature(
        address user,
        address token,
        uint256 amount,
        bytes32 withdrawId,
        uint256 chainId,
        address vault,
        bytes[] calldata signatures
    ) external view returns (bool) {
        if (signatures.length < requiredSignatures) return false;
        
        bytes32 hash = getWithdrawalHash(user, token, amount, withdrawId, chainId, vault);
        bytes32 ethSignedHash = hash.toEthSignedMessageHash();
        
        address[] memory signers = new address[](signatures.length);
        uint256 validCount = 0;
        
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ethSignedHash.recover(signatures[i]);
            
            if (isCoSigner[signer]) {
                // Check for duplicates
                bool isDuplicate = false;
                for (uint256 j = 0; j < validCount; j++) {
                    if (signers[j] == signer) {
                        isDuplicate = true;
                        break;
                    }
                }
                
                if (!isDuplicate) {
                    signers[validCount] = signer;
                    validCount++;
                }
            }
        }
        
        return validCount >= requiredSignatures;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function isWithdrawalApproved(bytes32 hash) external view returns (bool) {
        return approvedWithdrawals[hash];
    }
    
    function getCoSigners() external view returns (address[] memory) {
        return coSigners;
    }
    
    function getUserDailyWithdrawn(address user) external view returns (uint256) {
        return userDailyWithdrawals[user][block.timestamp / 1 days];
    }
    
    function getUserRemainingLimit(address user) external view returns (uint256) {
        uint256 withdrawn = userDailyWithdrawals[user][block.timestamp / 1 days];
        return withdrawn >= maxUserDailyLimit ? 0 : maxUserDailyLimit - withdrawn;
    }
}
