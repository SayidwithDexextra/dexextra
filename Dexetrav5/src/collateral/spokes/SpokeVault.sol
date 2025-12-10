// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/ISpokeVault.sol";

/**
 * @title SpokeVault
 * @notice Chain-agnostic spoke vault that holds allowed ERC-20 tokens and releases funds
 *         when provided with a valid hub WithdrawIntent via the authorized bridge inbox.
 *         Deposits are passive: users transfer tokens directly to this contract address.
 */
contract SpokeVault is ISpokeVault, AccessControl, ReentrancyGuard {
	bytes32 public constant VAULT_ADMIN_ROLE = keccak256("VAULT_ADMIN_ROLE");
	bytes32 public constant BRIDGE_INBOX_ROLE = keccak256("BRIDGE_INBOX_ROLE");

	// Allowed tokens for release; deposit is passive (ERC20.transfer to vault)
	mapping(address => bool) public isAllowedToken;

	mapping(bytes32 => bool) public processedWithdrawIds;

	event BridgeInboxUpdated(address indexed inbox);
	event AllowedTokenUpdated(address indexed token, bool allowed);
	event Deposited(address indexed payer, address indexed token, uint256 amount);

	constructor(address[] memory _initialAllowedTokens, address _admin, address _bridgeInbox) {
		require(_admin != address(0), "params");
		// Initialize allowed tokens
		if (_initialAllowedTokens.length > 0) {
			for (uint256 i = 0; i < _initialAllowedTokens.length; i++) {
				address t = _initialAllowedTokens[i];
				if (t != address(0) && !isAllowedToken[t]) {
					isAllowedToken[t] = true;
					emit AllowedTokenUpdated(t, true);
				}
			}
		}
		_grantRole(DEFAULT_ADMIN_ROLE, _admin);
		_grantRole(VAULT_ADMIN_ROLE, _admin);
		if (_bridgeInbox != address(0)) {
			_grantRole(BRIDGE_INBOX_ROLE, _bridgeInbox);
			emit BridgeInboxUpdated(_bridgeInbox);
		}
	}

	function setBridgeInbox(address _inbox) external onlyRole(VAULT_ADMIN_ROLE) {
		require(_inbox != address(0), "zero");
		_grantRole(BRIDGE_INBOX_ROLE, _inbox);
		emit BridgeInboxUpdated(_inbox);
	}

	function addAllowedToken(address token) external onlyRole(VAULT_ADMIN_ROLE) {
		require(token != address(0), "zero");
		require(!isAllowedToken[token], "exists");
		isAllowedToken[token] = true;
		emit AllowedTokenUpdated(token, true);
	}

	function removeAllowedToken(address token) external onlyRole(VAULT_ADMIN_ROLE) {
		require(isAllowedToken[token], "not allowed");
		isAllowedToken[token] = false;
		emit AllowedTokenUpdated(token, false);
	}

	/**
	 * @notice Active deposit path (pulls tokens via transferFrom)
	 * @dev Requires prior ERC20 approval from the caller to this vault.
	 */
	function deposit(address token, uint256 amount) external nonReentrant {
		require(isAllowedToken[token], "token not allowed");
		require(amount > 0, "amount");
		require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transferFrom failed");
		emit Deposited(msg.sender, token, amount);
	}

	function releaseToUser(
		address user,
		address token,
		uint256 amount,
		bytes32 withdrawId
	) external override nonReentrant onlyRole(BRIDGE_INBOX_ROLE) {
		require(user != address(0) && amount > 0, "params");
		require(!processedWithdrawIds[withdrawId], "withdraw processed");
		require(isAllowedToken[token], "token not allowed");

		processedWithdrawIds[withdrawId] = true;
		require(IERC20(token).transfer(user, amount), "token transfer failed");
		emit Released(user, amount, withdrawId);
	}

	// Admin function to rescue tokens if needed
	function rescueTokens(address token, uint256 amount, address to) external onlyRole(VAULT_ADMIN_ROLE) {
		require(!isAllowedToken[token], "protected");
		require(IERC20(token).transfer(to, amount), "transfer failed");
	}
}






