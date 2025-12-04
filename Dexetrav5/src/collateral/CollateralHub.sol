// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/ICollateralHub.sol";
import "./interfaces/ICoreVault.sol";

/**
 * @title CollateralHub
 * @notice Hub-side adapter that verifies spoke deposits and credits CoreVault,
 *         and emits withdraw intents that spokes can verify before releasing USDC.
 * @dev CoreVault is NOT modified. This contract requires ORDERBOOK_ROLE (or suitable role)
 *      on CoreVault to move ledger balances via transferCollateral(user<->operator).
 */
contract CollateralHub is ICollateralHub, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant WITHDRAW_REQUESTER_ROLE = keccak256("WITHDRAW_REQUESTER_ROLE");
    bytes32 public constant BRIDGE_INBOX_ROLE = keccak256("BRIDGE_INBOX_ROLE");

    // Hub connections
    address public coreVault;
    address public coreVaultOperator; // Ledger pool account used for balancing credits/debits

    // Spoke registry and idempotency stores
    mapping(uint64 => SpokeConfig) public spokes;
    mapping(bytes32 => bool) public processedDepositIds;
    mapping(bytes32 => bool) public processedWithdrawIds;

    event CoreVaultParamsUpdated(address indexed coreVault, address indexed operator);
    event SpokeToggled(uint64 indexed chainId, bool enabled);

    constructor(address _admin, address _coreVault, address _operator) {
        require(_admin != address(0), "admin");
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        coreVault = _coreVault;
        coreVaultOperator = _operator;
        emit CoreVaultParamsUpdated(_coreVault, _operator);
    }

    // ===== Admin =====
    function setCoreVaultParams(address _coreVault, address _operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_coreVault != address(0) && _operator != address(0), "zero");
        coreVault = _coreVault;
        coreVaultOperator = _operator;
        emit CoreVaultParamsUpdated(_coreVault, _operator);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ===== Spoke Registry =====
    function registerSpoke(uint64 chainId, SpokeConfig calldata cfg) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(cfg.spokeVault != address(0), "spoke");
        require(cfg.usdc != address(0), "usdc");
        spokes[chainId] = cfg;
        emit SpokeRegistered(chainId, cfg.spokeVault);
    }

    function setSpokeEnabled(uint64 chainId, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        SpokeConfig storage cfg = spokes[chainId];
        require(cfg.spokeVault != address(0), "unknown");
        cfg.enabled = enabled;
        emit SpokeToggled(chainId, enabled);
    }

    // ===== Credit via bridge receiver (inbox) =====
    function creditFromBridge(
        uint64 chainId,
        address user,
        uint256 amount,
        bytes32 depositId
    ) external override nonReentrant whenNotPaused onlyRole(BRIDGE_INBOX_ROLE) {
        require(user != address(0) && amount > 0, "params");
        require(!processedDepositIds[depositId], "deposit processed");

        SpokeConfig memory cfg = spokes[chainId];
        require(cfg.enabled, "spoke disabled");

        processedDepositIds[depositId] = true;
        _creditCoreVault(user, amount);
        emit Credited(user, amount, chainId, depositId);
    }

    // ===== Withdraw intent on hub (debit CoreVault and emit event) =====
    function requestWithdraw(
        address user,
        uint64 targetChainId,
        uint256 amount
    ) external override nonReentrant whenNotPaused returns (bytes32 withdrawId) {
        require(user != address(0) && amount > 0, "params");
        // Allow either the user or an authorized requester (e.g., relayer) to initiate
        require(msg.sender == user || hasRole(WITHDRAW_REQUESTER_ROLE, msg.sender), "unauthorized");

        withdrawId = keccak256(abi.encodePacked(block.chainid, user, targetChainId, amount, block.number));
        require(!processedWithdrawIds[withdrawId], "withdraw exists");
        processedWithdrawIds[withdrawId] = true;

        _debitCoreVault(user, amount);
        emit WithdrawIntent(user, targetChainId, amount, withdrawId);
    }

    // ===== Internal CoreVault hooks =====
    function _creditCoreVault(address user, uint256 amount) internal {
        // Credit math-only cross-chain ledger on CoreVault (not withdrawable on hub)
        // Requires this contract to have EXTERNAL_CREDITOR_ROLE on CoreVault
        ICoreVault(coreVault).creditExternal(user, amount);
    }

    function _debitCoreVault(address user, uint256 amount) internal {
        // Debit math-only cross-chain ledger on CoreVault
        // Requires this contract to have EXTERNAL_CREDITOR_ROLE on CoreVault
        ICoreVault(coreVault).debitExternal(user, amount);
    }
}


