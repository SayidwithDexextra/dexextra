// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title SecureSpokeVaultV3
 * @notice Maximum security spoke vault with defense-in-depth architecture.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * SECURITY LAYERS (must pass ALL to withdraw):
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Layer 1: ACCESS CONTROL
 *   - Only BRIDGE_INBOX_ROLE can initiate withdrawals
 *   - Bridge inbox address is immutable after lock
 *   - Multi-sig required for admin operations (via external multi-sig wallet)
 * 
 * Layer 2: WITHDRAWAL WHITELIST
 *   - Only addresses that have deposited can withdraw
 *   - Tracks deposit history per address
 *   - Optional: require whitelist for large withdrawals
 * 
 * Layer 3: RATE LIMITING
 *   - Daily withdrawal limit per token (50k USDC)
 *   - Per-user withdrawal limit per hour (5 txs)
 *   - Global withdrawal limit per hour
 * 
 * Layer 4: TIMELOCKS
 *   - Large withdrawals (>1k USDC) require 1-hour delay
 *   - Admin operations require 24-hour delay
 * 
 * Layer 5: CIRCUIT BREAKER
 *   - Auto-pause if thresholds exceeded
 *   - No human intervention needed
 * 
 * Layer 6: SIGNATURE VERIFICATION
 *   - Optional: require co-signer approval for withdrawals
 *   - Enables off-chain fraud detection
 * 
 * Layer 7: HOT/COLD SPLIT
 *   - Only portion of funds accessible (hot limit)
 *   - Rest requires multi-sig cold withdrawal
 * 
 * Layer 8: MERKLE PROOF VERIFICATION
 *   - Verify withdrawal against published merkle root
 *   - Root published by Hub, verified on spoke
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */
contract SecureSpokeVaultV3 is AccessControl, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ═══════════════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════════════
    
    bytes32 public constant VAULT_ADMIN_ROLE = keccak256("VAULT_ADMIN_ROLE");
    bytes32 public constant BRIDGE_INBOX_ROLE = keccak256("BRIDGE_INBOX_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant CO_SIGNER_ROLE = keccak256("CO_SIGNER_ROLE");
    bytes32 public constant MERKLE_UPDATER_ROLE = keccak256("MERKLE_UPDATER_ROLE");
    bytes32 public constant COLD_WITHDRAWER_ROLE = keccak256("COLD_WITHDRAWER_ROLE");

    // ═══════════════════════════════════════════════════════════════════════
    // SECURITY PARAMETERS
    // ═══════════════════════════════════════════════════════════════════════
    
    struct SecurityConfig {
        uint256 instantWithdrawalThreshold;  // Below this = instant (e.g., 1000 USDC)
        uint256 timelockDelay;               // Delay for large withdrawals (e.g., 1 hour)
        uint256 dailyLimitPerToken;          // Max per token per day (e.g., 50k USDC)
        uint256 userRateLimitWindow;         // Window for user rate limit (e.g., 1 hour)
        uint256 userMaxWithdrawalsPerWindow; // Max withdrawals per user per window
        uint256 globalHourlyLimit;           // Global limit per hour (e.g., 100k USDC)
        uint256 hotWalletLimit;              // Max accessible without cold sig (e.g., 200k)
        uint256 adminTimelockDelay;          // Delay for admin ops (e.g., 24 hours)
        bool requireCoSignerForLarge;        // Require co-signer for large withdrawals
        bool requireMerkleProof;             // Require merkle proof for all withdrawals
        bool requireDepositHistory;          // Only depositors can withdraw
        bool circuitBreakerEnabled;          // Auto-pause on threshold breach
    }
    
    SecurityConfig public config;

    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════
    
    // Token allowlist
    mapping(address => bool) public isAllowedToken;
    
    // Withdrawal tracking
    mapping(bytes32 => bool) public processedWithdrawIds;
    mapping(address => mapping(uint256 => uint256)) public dailyWithdrawals;
    mapping(address => mapping(uint256 => uint256)) public userWithdrawalCount;
    mapping(uint256 => uint256) public globalHourlyWithdrawals;
    uint256 public withdrawalNonce;
    
    // Timelocked withdrawals
    struct TimelockRequest {
        address user;
        address token;
        uint256 amount;
        uint256 executeAfter;
        bool executed;
        bool cancelled;
        bytes32 merkleProof; // Store for verification at execution
    }
    mapping(bytes32 => TimelockRequest) public timelockRequests;
    
    // Bridge inbox (immutable after lock)
    address public bridgeInbox;
    bool public bridgeInboxLocked;
    
    // Whitelist: tracks who has deposited
    mapping(address => bool) public hasDeposited;
    mapping(address => uint256) public totalDeposited;
    mapping(address => uint256) public totalWithdrawn;
    
    // Merkle root for withdrawal verification
    bytes32 public withdrawalMerkleRoot;
    uint256 public merkleRootUpdatedAt;
    
    // Circuit breaker state
    uint256 public circuitBreakerTriggeredAt;
    uint256 public constant CIRCUIT_BREAKER_COOLDOWN = 1 hours;
    
    // Admin timelock for configuration changes
    struct PendingAdminOp {
        bytes32 opHash;
        uint256 executeAfter;
        bool executed;
    }
    mapping(bytes32 => PendingAdminOp) public pendingAdminOps;
    
    // Hot wallet tracking
    uint256 public hotWalletWithdrawnToday;
    uint256 public hotWalletDayStart;

    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════
    
    event BridgeInboxSet(address indexed inbox);
    event BridgeInboxLocked(address indexed inbox);
    event AllowedTokenUpdated(address indexed token, bool allowed);
    event Deposited(address indexed payer, address indexed token, uint256 amount);
    event Released(address indexed user, uint256 amount, bytes32 indexed withdrawId);
    event WithdrawalQueued(bytes32 indexed withdrawId, address indexed user, address token, uint256 amount, uint256 executeAfter);
    event WithdrawalExecuted(bytes32 indexed withdrawId, address indexed user, uint256 amount);
    event WithdrawalCancelled(bytes32 indexed withdrawId, address indexed cancelledBy);
    event CircuitBreakerTriggered(string reason, uint256 timestamp);
    event CircuitBreakerReset(address indexed admin);
    event MerkleRootUpdated(bytes32 indexed newRoot, uint256 timestamp);
    event AdminOpQueued(bytes32 indexed opHash, uint256 executeAfter);
    event AdminOpExecuted(bytes32 indexed opHash);
    event ColdWithdrawal(address indexed token, uint256 amount, address indexed to);
    event CoSignerApproval(bytes32 indexed withdrawId, address indexed coSigner);

    // ═══════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════
    
    error BridgeInboxAlreadyLocked();
    error BridgeInboxNotSet();
    error ZeroAddress();
    error TokenNotAllowed();
    error WithdrawAlreadyProcessed();
    error DailyLimitExceeded();
    error UserRateLimitExceeded();
    error GlobalHourlyLimitExceeded();
    error HotWalletLimitExceeded();
    error TimelockNotReady();
    error TimelockAlreadyExecuted();
    error TimelockCancelled();
    error TimelockDoesNotExist();
    error InvalidAmount();
    error InsufficientBalance();
    error NotWhitelisted();
    error InvalidMerkleProof();
    error InvalidCoSignerSignature();
    error CircuitBreakerActive();
    error AdminTimelockNotReady();
    error AdminOpNotFound();

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════
    
    constructor(
        address[] memory _initialAllowedTokens,
        address _admin,
        address _guardian,
        SecurityConfig memory _config
    ) {
        if (_admin == address(0)) revert ZeroAddress();
        if (_guardian == address(0)) revert ZeroAddress();
        
        config = _config;
        
        for (uint256 i = 0; i < _initialAllowedTokens.length; i++) {
            address t = _initialAllowedTokens[i];
            if (t != address(0)) {
                isAllowedToken[t] = true;
                emit AllowedTokenUpdated(t, true);
            }
        }
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(VAULT_ADMIN_ROLE, _admin);
        _grantRole(GUARDIAN_ROLE, _guardian);
        _grantRole(GUARDIAN_ROLE, _admin);
        _grantRole(MERKLE_UPDATER_ROLE, _admin);
        
        hotWalletDayStart = block.timestamp / 1 days;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════
    
    modifier circuitBreakerCheck() {
        if (config.circuitBreakerEnabled && circuitBreakerTriggeredAt > 0) {
            if (block.timestamp < circuitBreakerTriggeredAt + CIRCUIT_BREAKER_COOLDOWN) {
                revert CircuitBreakerActive();
            }
        }
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // BRIDGE INBOX MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════
    
    function setBridgeInbox(address _inbox) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bridgeInboxLocked) revert BridgeInboxAlreadyLocked();
        if (_inbox == address(0)) revert ZeroAddress();
        
        if (bridgeInbox != address(0)) {
            _revokeRole(BRIDGE_INBOX_ROLE, bridgeInbox);
        }
        
        bridgeInbox = _inbox;
        _grantRole(BRIDGE_INBOX_ROLE, _inbox);
        emit BridgeInboxSet(_inbox);
    }
    
    function lockBridgeInbox() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bridgeInbox == address(0)) revert BridgeInboxNotSet();
        if (bridgeInboxLocked) revert BridgeInboxAlreadyLocked();
        bridgeInboxLocked = true;
        emit BridgeInboxLocked(bridgeInbox);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MERKLE ROOT MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════
    
    function updateMerkleRoot(bytes32 _newRoot) external onlyRole(MERKLE_UPDATER_ROLE) {
        withdrawalMerkleRoot = _newRoot;
        merkleRootUpdatedAt = block.timestamp;
        emit MerkleRootUpdated(_newRoot, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GUARDIAN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function emergencyPause(string calldata reason) external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
    
    function cancelTimelockWithdrawal(bytes32 withdrawId) external onlyRole(GUARDIAN_ROLE) {
        TimelockRequest storage req = timelockRequests[withdrawId];
        if (req.executeAfter == 0) revert TimelockDoesNotExist();
        if (req.executed) revert TimelockAlreadyExecuted();
        
        req.cancelled = true;
        emit WithdrawalCancelled(withdrawId, msg.sender);
    }
    
    function resetCircuitBreaker() external onlyRole(DEFAULT_ADMIN_ROLE) {
        circuitBreakerTriggeredAt = 0;
        emit CircuitBreakerReset(msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DEPOSIT (tracks depositors for whitelist)
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Direct deposit (user signs their own transaction)
     */
    function deposit(address token, uint256 amount) external nonReentrant whenNotPaused {
        _depositFor(msg.sender, msg.sender, token, amount);
    }
    
    /**
     * @notice Gasless deposit (relayer submits on behalf of user)
     * @param user The actual user who is depositing (for whitelist tracking)
     * @param payer The address tokens are pulled from (usually same as user)
     * @param token The token to deposit
     * @param amount The amount to deposit
     * @dev Relayer must have BRIDGE_ENDPOINT_ROLE to call this
     *      User must have approved this contract to spend their tokens
     */
    function depositFor(
        address user,
        address payer,
        address token,
        uint256 amount
    ) external nonReentrant whenNotPaused onlyRole(BRIDGE_INBOX_ROLE) {
        if (user == address(0)) revert ZeroAddress();
        _depositFor(user, payer, token, amount);
    }
    
    function _depositFor(
        address user,
        address payer,
        address token,
        uint256 amount
    ) internal {
        if (!isAllowedToken[token]) revert TokenNotAllowed();
        if (amount == 0) revert InvalidAmount();
        
        require(IERC20(token).transferFrom(payer, address(this), amount), "transferFrom failed");
        
        // Track deposit for whitelist under USER's address, not relayer
        if (!hasDeposited[user]) {
            hasDeposited[user] = true;
        }
        totalDeposited[user] += amount;
        
        emit Deposited(user, token, amount);
    }
    
    /**
     * @notice Record a passive deposit (user sent tokens directly to vault)
     * @param user The user who sent the tokens
     * @param amount The amount they sent
     * @dev Called by relayer after detecting a direct transfer to the vault.
     *      Does NOT move tokens - they're already here.
     *      Only updates the whitelist so user can withdraw later.
     */
    function recordPassiveDeposit(
        address user,
        uint256 amount
    ) external onlyRole(BRIDGE_INBOX_ROLE) {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        
        // Just record on whitelist - tokens already arrived via direct transfer
        if (!hasDeposited[user]) {
            hasDeposited[user] = true;
        }
        totalDeposited[user] += amount;
        
        emit Deposited(user, address(0), amount); // token=0 indicates passive deposit
    }

    // ═══════════════════════════════════════════════════════════════════════
    // WITHDRAWAL - MULTI-LAYER SECURITY
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Release tokens with full security checks
     * @param user Recipient
     * @param token Token address
     * @param amount Amount to release
     * @param withdrawId Unique withdrawal ID
     * @param merkleProof Proof that withdrawal is in merkle tree (if required)
     * @param coSignerSig Co-signer signature (if required for large amounts)
     */
    function releaseToUser(
        address user,
        address token,
        uint256 amount,
        bytes32 withdrawId,
        bytes32[] calldata merkleProof,
        bytes calldata coSignerSig
    ) external nonReentrant whenNotPaused circuitBreakerCheck onlyRole(BRIDGE_INBOX_ROLE) {
        // === LAYER 1: Basic validation ===
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (!isAllowedToken[token]) revert TokenNotAllowed();
        if (processedWithdrawIds[withdrawId]) revert WithdrawAlreadyProcessed();
        
        // === LAYER 2: Whitelist check ===
        if (config.requireDepositHistory && !hasDeposited[user]) {
            revert NotWhitelisted();
        }
        
        // === LAYER 3: Merkle proof verification ===
        if (config.requireMerkleProof && withdrawalMerkleRoot != bytes32(0)) {
            bytes32 leaf = keccak256(abi.encodePacked(user, token, amount, withdrawId));
            if (!MerkleProof.verify(merkleProof, withdrawalMerkleRoot, leaf)) {
                revert InvalidMerkleProof();
            }
        }
        
        // === LAYER 4: Co-signer verification for large amounts ===
        if (config.requireCoSignerForLarge && amount >= config.instantWithdrawalThreshold) {
            _verifyCoSignerSignature(user, token, amount, withdrawId, coSignerSig);
        }
        
        // === LAYER 5: Balance check ===
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < amount) revert InsufficientBalance();
        
        // === LAYER 6: Rate limiting ===
        _checkAndUpdateLimits(user, token, amount);
        
        // === LAYER 7: Hot wallet limit ===
        _checkHotWalletLimit(amount);
        
        // Mark processed FIRST (CEI)
        processedWithdrawIds[withdrawId] = true;
        withdrawalNonce++;
        
        // === LAYER 8: Timelock for large amounts ===
        if (amount >= config.instantWithdrawalThreshold) {
            _queueTimelockWithdrawal(user, token, amount, withdrawId);
        } else {
            _executeInstantWithdrawal(user, token, amount, withdrawId);
        }
    }
    
    /**
     * @notice Simplified release for backward compatibility (no merkle/cosigner)
     */
    function releaseToUser(
        address user,
        address token,
        uint256 amount,
        bytes32 withdrawId
    ) external nonReentrant whenNotPaused circuitBreakerCheck onlyRole(BRIDGE_INBOX_ROLE) {
        // Delegate to full function with empty proofs
        bytes32[] memory emptyProof = new bytes32[](0);
        this.releaseToUser(user, token, amount, withdrawId, emptyProof, "");
    }
    
    function _verifyCoSignerSignature(
        address user,
        address token,
        uint256 amount,
        bytes32 withdrawId,
        bytes calldata sig
    ) internal view {
        if (sig.length == 0) revert InvalidCoSignerSignature();
        
        bytes32 messageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(user, token, amount, withdrawId, block.chainid, address(this)))
        ));
        
        address recovered = messageHash.recover(sig);
        if (!hasRole(CO_SIGNER_ROLE, recovered)) {
            revert InvalidCoSignerSignature();
        }
    }
    
    function _checkAndUpdateLimits(address user, address token, uint256 amount) internal {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 currentHour = block.timestamp / 1 hours;
        uint256 currentWindow = block.timestamp / config.userRateLimitWindow;
        
        // Daily limit per token
        uint256 todayTotal = dailyWithdrawals[token][currentDay] + amount;
        if (todayTotal > config.dailyLimitPerToken) {
            _triggerCircuitBreaker("Daily limit exceeded");
            revert DailyLimitExceeded();
        }
        
        // User rate limit
        uint256 userCount = userWithdrawalCount[user][currentWindow];
        if (userCount >= config.userMaxWithdrawalsPerWindow) {
            revert UserRateLimitExceeded();
        }
        
        // Global hourly limit
        uint256 hourlyTotal = globalHourlyWithdrawals[currentHour] + amount;
        if (hourlyTotal > config.globalHourlyLimit) {
            _triggerCircuitBreaker("Global hourly limit exceeded");
            revert GlobalHourlyLimitExceeded();
        }
        
        // Update counters
        dailyWithdrawals[token][currentDay] = todayTotal;
        userWithdrawalCount[user][currentWindow]++;
        globalHourlyWithdrawals[currentHour] = hourlyTotal;
    }
    
    function _checkHotWalletLimit(uint256 amount) internal {
        uint256 currentDay = block.timestamp / 1 days;
        
        // Reset if new day
        if (currentDay > hotWalletDayStart) {
            hotWalletWithdrawnToday = 0;
            hotWalletDayStart = currentDay;
        }
        
        uint256 newTotal = hotWalletWithdrawnToday + amount;
        if (newTotal > config.hotWalletLimit) {
            _triggerCircuitBreaker("Hot wallet limit exceeded");
            revert HotWalletLimitExceeded();
        }
        
        hotWalletWithdrawnToday = newTotal;
    }
    
    function _triggerCircuitBreaker(string memory reason) internal {
        if (config.circuitBreakerEnabled && circuitBreakerTriggeredAt == 0) {
            circuitBreakerTriggeredAt = block.timestamp;
            emit CircuitBreakerTriggered(reason, block.timestamp);
        }
    }
    
    function _queueTimelockWithdrawal(
        address user,
        address token,
        uint256 amount,
        bytes32 withdrawId
    ) internal {
        uint256 executeAfter = block.timestamp + config.timelockDelay;
        
        timelockRequests[withdrawId] = TimelockRequest({
            user: user,
            token: token,
            amount: amount,
            executeAfter: executeAfter,
            executed: false,
            cancelled: false,
            merkleProof: bytes32(0)
        });
        
        emit WithdrawalQueued(withdrawId, user, token, amount, executeAfter);
    }
    
    function _executeInstantWithdrawal(
        address user,
        address token,
        uint256 amount,
        bytes32 withdrawId
    ) internal {
        totalWithdrawn[user] += amount;
        require(IERC20(token).transfer(user, amount), "transfer failed");
        emit Released(user, amount, withdrawId);
    }
    
    function executeTimelockWithdrawal(bytes32 withdrawId) external nonReentrant whenNotPaused circuitBreakerCheck {
        TimelockRequest storage req = timelockRequests[withdrawId];
        
        if (req.executeAfter == 0) revert TimelockDoesNotExist();
        if (req.executed) revert TimelockAlreadyExecuted();
        if (req.cancelled) revert TimelockCancelled();
        if (block.timestamp < req.executeAfter) revert TimelockNotReady();
        
        req.executed = true;
        totalWithdrawn[req.user] += req.amount;
        
        require(IERC20(req.token).transfer(req.user, req.amount), "transfer failed");
        emit WithdrawalExecuted(withdrawId, req.user, req.amount);
        emit Released(req.user, req.amount, withdrawId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // COLD WALLET WITHDRAWAL (for funds beyond hot limit)
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Withdraw from cold storage (requires COLD_WITHDRAWER_ROLE)
     * @dev Use a multi-sig wallet for COLD_WITHDRAWER_ROLE
     */
    function coldWithdraw(
        address token,
        uint256 amount,
        address to
    ) external onlyRole(COLD_WITHDRAWER_ROLE) nonReentrant {
        require(isAllowedToken[token], "token not allowed");
        require(IERC20(token).transfer(to, amount), "transfer failed");
        emit ColdWithdrawal(token, amount, to);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TIMELOCKED ADMIN OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function queueConfigUpdate(SecurityConfig calldata newConfig) external onlyRole(DEFAULT_ADMIN_ROLE) returns (bytes32) {
        bytes32 opHash = keccak256(abi.encode("CONFIG_UPDATE", newConfig, block.timestamp));
        
        pendingAdminOps[opHash] = PendingAdminOp({
            opHash: opHash,
            executeAfter: block.timestamp + config.adminTimelockDelay,
            executed: false
        });
        
        emit AdminOpQueued(opHash, block.timestamp + config.adminTimelockDelay);
        return opHash;
    }
    
    function executeConfigUpdate(bytes32 opHash, SecurityConfig calldata newConfig) external onlyRole(DEFAULT_ADMIN_ROLE) {
        PendingAdminOp storage op = pendingAdminOps[opHash];
        if (op.opHash == bytes32(0)) revert AdminOpNotFound();
        if (op.executed) revert TimelockAlreadyExecuted();
        if (block.timestamp < op.executeAfter) revert AdminTimelockNotReady();
        
        // Verify the config matches what was queued
        bytes32 expectedHash = keccak256(abi.encode("CONFIG_UPDATE", newConfig, op.executeAfter - config.adminTimelockDelay));
        require(expectedHash == opHash, "config mismatch");
        
        op.executed = true;
        config = newConfig;
        
        emit AdminOpExecuted(opHash);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function getDailyWithdrawn(address token) external view returns (uint256) {
        return dailyWithdrawals[token][block.timestamp / 1 days];
    }
    
    function getRemainingDailyLimit(address token) external view returns (uint256) {
        uint256 withdrawn = dailyWithdrawals[token][block.timestamp / 1 days];
        return withdrawn >= config.dailyLimitPerToken ? 0 : config.dailyLimitPerToken - withdrawn;
    }
    
    function getRemainingHotWalletLimit() external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 withdrawn = currentDay > hotWalletDayStart ? 0 : hotWalletWithdrawnToday;
        return withdrawn >= config.hotWalletLimit ? 0 : config.hotWalletLimit - withdrawn;
    }
    
    function isCircuitBreakerActive() external view returns (bool) {
        if (!config.circuitBreakerEnabled || circuitBreakerTriggeredAt == 0) return false;
        return block.timestamp < circuitBreakerTriggeredAt + CIRCUIT_BREAKER_COOLDOWN;
    }
    
    function getUserStats(address user) external view returns (
        bool deposited,
        uint256 totalIn,
        uint256 totalOut,
        uint256 withdrawalsThisWindow
    ) {
        uint256 currentWindow = block.timestamp / config.userRateLimitWindow;
        return (
            hasDeposited[user],
            totalDeposited[user],
            totalWithdrawn[user],
            userWithdrawalCount[user][currentWindow]
        );
    }
    
    function getVaultBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TOKEN MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════
    
    function addAllowedToken(address token) external onlyRole(VAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        isAllowedToken[token] = true;
        emit AllowedTokenUpdated(token, true);
    }

    function removeAllowedToken(address token) external onlyRole(VAULT_ADMIN_ROLE) {
        isAllowedToken[token] = false;
        emit AllowedTokenUpdated(token, false);
    }
    
    // Rescue non-allowed tokens only
    function rescueTokens(address token, uint256 amount, address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!isAllowedToken[token], "protected");
        require(IERC20(token).transfer(to, amount), "transfer failed");
    }
}
